import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { IconBack, IconSend } from '../components/Icons'
import { DialogLayer } from '../components/ui/DialogLayer'
import { askSunshine, tidyReplyText, type ChatMsg } from '../lib/ai-chat'
import { requestAgnes } from '../lib/agnes-ai'
import { hasCloudIdentity } from '../lib/cloud-identity'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../lib/auth'
import { avatar, resolveAvatar } from '../data/images'
import { isFoxFreeVariant, useUiVariant } from '../lib/ui-variant'
import { submitMessageKey } from '../lib/keyboard-viewport'
import { goBack } from '../lib/back'
import { birthDateInfo, fortuneChatIntent, readFortunePreferences, saveFortunePreferences, type FortuneChatIntent, type FortunePreferences, type FortuneWorkbenchMode } from '../lib/chat-fortune'
import { DailyFortune, FortuneSettings } from './ChatFortune'
import styles from './ChatPage.module.css'

const FortuneWorkbench = lazy(() => import('./TodayFortunePage').then(module => ({ default: module.FortuneWorkbench })))
const FORTUNE_REPLY = {
  tarot: '塔罗牌桌准备好了。选一个牌阵，就可以洗牌和翻牌。',
  stars: '打开星图，点亮一个星座看看。',
  animals: '挑一张生肖牌，看看插画和今日提示。',
  daily: '每日解读由生日和各自的开关决定。',
  'daily-stars': '可以查看你的每日星座解读，或到设置里开启。',
  'daily-animals': '可以查看你的每日生肖解读，或到设置里开启。',
  settings: '可以在这里填写生日，分别开启星座和生肖解读。',
} satisfies Record<FortuneChatIntent, string>

type Msg = { id: number; from: 'ai' | 'me'; text: string; local?: boolean; fortune?: FortuneChatIntent }

const GREETING = '你好！我是小海阿狐，很高兴认识你！\n我可以帮你查课表、解答问题、提供校园生活与学习建议。陪你度过美好的大学生活！'
const MESSAGE_LIMIT = 4000

const CHIPS = [
  { label: '查课表', text: '帮我看看最近几天的课表安排' },
  { label: '找食堂', text: '食堂今天有什么好吃的推荐？' },
  { label: '我想求助', text: '我需要帮忙，怎么发布校园互助？' },
  { label: '心情倾诉', text: '今天心情不太好，想找人聊聊' },
]

/**
 * 每轮问答末尾追加的「说话方式」约束。
 *
 * 线上实测发现两个问题：
 *  1) 模型会把 /secondhand、/tasks、/apply 这类内部路由路径直接写进回答，
 *     用户看到的是一串莫名其妙的斜杠英文。
 *  2) 回答里混 emoji，手机 WebView 缺字形会渲染成「☐」豆腐块。
 * 后端云函数不方便改，所以在前端把规则附在消息末尾（离回答最近，权重最高）。
 */
const STYLE_RULE = [
  '（回答上面这位同学的问题时，请遵守：）',
  '1. 用「小海阿狐」的口吻：热情、简短、像同学聊天，称呼用户为「你」。',
  '2. 绝对不要出现以斜杠开头的英文路径或代码，例如 /tasks、/apply、/secondhand；',
  '   要指引功能时只说中文界面名称，比如「在首页点『校园互助』」。',
  '3. 不要用 markdown 语法：不要 # 标题、不要 ** 加粗、不要 - 列表、不要 ``` 代码块。',
  '4. 回答控制在 3 句话以内，需要分点就用「1. 2. 3.」这种中文序号，每行一条。',
  '5. 不要使用任何 emoji 或特殊符号表情，纯文字即可。',
  '6. 不要提到「知识库」「文档」「检索」这类内部字眼，直接给结论。',
].join('\n')

export function ChatPage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const initial = params.get('fortune')
  const initialMode = initial === 'tarot' || initial === 'stars' || initial === 'animals' ? initial : null
  const [workspace, setWorkspace] = useState<FortuneWorkbenchMode | null>(initialMode)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const scrollList = useRef<HTMLDivElement>(null)
  const toast = useToast()
  const auth = useAuth()
  const foxfree = isFoxFreeVariant(useUiVariant())
  const myAvatar = resolveAvatar(auth.user?.avatarUrl, auth.user?.uid || auth.user?.nickname || '')
  const [list, setList] = useState<Msg[]>([{ id: 1, from: 'ai', text: GREETING }])
  const [text, setText] = useState('')
  const [thinking, setThinking] = useState(false)
  const [approvedService, setApprovedService] = useState<'guest' | 'agnes' | null>(null)
  const [confirmation, setConfirmation] = useState<{ question: string; owner: string; service: 'guest' | 'agnes' } | null>(null)
  const seq = useRef(10)
  const requestSeq = useRef(0)
  const request = useRef<AbortController | null>(null)
  const pendingMessage = useRef<{ id: number; question: string } | null>(null)
  const sessionKey = auth.user?.uid || (auth.isSigned ? 'signed' : 'guest')
  const sessionKeyRef = useRef(sessionKey)
  sessionKeyRef.current = sessionKey
  const [savedFortune, setSavedFortune] = useState(() => ({ owner: sessionKey, value: readFortunePreferences(sessionKey) }))
  const fortune = savedFortune.owner === sessionKey ? savedFortune.value : readFortunePreferences(sessionKey)
  const birth = useMemo(() => birthDateInfo(fortune.birthday), [fortune.birthday])
  const hasDaily = !!birth && (fortune.stars || (fortune.animals && birth.animalIndex !== null))

  function saveFortune(value: FortunePreferences) {
    if (sessionKey !== sessionKeyRef.current || !saveFortunePreferences(sessionKey, value)) return false
    setSavedFortune({ owner: sessionKey, value })
    if (value.birthday && (value.stars || value.animals)) {
      scrollList.current?.scrollTo({ top: 0, behavior: 'instant' })
    }
    return true
  }

  function dailyTarget(intent: FortuneChatIntent) {
    if (intent === 'daily-stars' && birth && fortune.stars) return 'chat-daily-stars'
    if (intent === 'daily-animals' && birth?.animalIndex != null && fortune.animals) return 'chat-daily-animals'
    return intent === 'daily' && hasDaily ? 'chat-daily-fortune' : null
  }

  function openFortune(intent: FortuneChatIntent) {
    if (intent === 'tarot' || intent === 'stars' || intent === 'animals') {
      setWorkspace(intent)
      return
    }
    const target = dailyTarget(intent)
    if (target) document.getElementById(target)?.focus()
    else setSettingsOpen(true)
  }

  useEffect(() => {
    requestSeq.current++
    request.current?.abort()
    request.current = null
    pendingMessage.current = null
    setList([{ id: 1, from: 'ai', text: GREETING }])
    setText('')
    setThinking(false)
    setApprovedService(null)
    setConfirmation(null)
    setWorkspace(initialMode)
    setSettingsOpen(false)
    setSavedFortune({ owner: sessionKey, value: readFortunePreferences(sessionKey) })
  }, [sessionKey, initialMode])

  useEffect(() => {
    const last = list.at(-1)
    if (last?.id !== 1 && scrollList.current) {
      scrollList.current.scrollTop = scrollList.current.scrollHeight
    }
  }, [list, thinking])

  useEffect(() => () => {
    requestSeq.current++
    request.current?.abort()
  }, [])

  function nextId() {
    seq.current += 1
    return seq.current
  }

  async function send(q: string, confirmedService?: 'guest' | 'agnes') {
    const question = q.trim()
    if (!question || thinking || request.current) return
    if (question.length > MESSAGE_LIMIT) {
      toast(`单条消息最多 ${MESSAGE_LIMIT} 字，请分段发送`)
      return
    }
    const intent = fortuneChatIntent(question)
    if (intent) {
      setText('')
      const messageId = nextId()
      const responseId = nextId()
      setList(items => [...items, { id: messageId, from: 'me', text: question, local: true },
        { id: responseId, from: 'ai', text: FORTUNE_REPLY[intent], local: true, fortune: intent }])
      if (!dailyTarget(intent)) openFortune(intent)
      return
    }
    const service = auth.isSigned || hasCloudIdentity() ? 'agnes' : 'guest'
    if (approvedService !== service && confirmedService !== service) {
      setConfirmation({ question, owner: sessionKey, service })
      return
    }
    setText('')

    const history: ChatMsg[] = list
      .filter(message => !message.local)
      .map((m) => ({ role: m.from === 'ai' ? ('assistant' as const) : ('user' as const), content: m.text }))
      .concat({ role: 'user', content: question })

    const messageId = nextId()
    pendingMessage.current = { id: messageId, question }
    setList((xs) => [...xs, { id: messageId, from: 'me', text: question }])
    setThinking(true)
    const owner = sessionKey
    const sequence = ++requestSeq.current
    const controller = new AbortController()
    request.current = controller

    try {
      let reply: string
      if (service === 'agnes') {
        const transcript = [...history.slice(-12), { role: 'user' as const, content: STYLE_RULE }]
          .map(message => `${message.role === 'user' ? '同学' : '小海阿狐'}：${message.content}`).join('\n').slice(-9000)
        reply = await requestAgnes('chat', transcript, controller.signal)
      } else {
        const res = await askSunshine([
          ...history.slice(-12),
          { role: 'user' as const, content: STYLE_RULE },
        ], controller.signal)
        if (!res.ok || !res.reply) throw new Error(res.error === 'network' ? '网络不太顺畅，稍后再试试' : res.detail || '小海阿狐暂时没有回应')
        reply = res.reply
      }
      const displayReply = tidyReplyText(reply)
      if (!displayReply || displayReply.length > 20000) throw new Error('小海阿狐这次没有返回可显示的内容，请重试。')
      if (owner === sessionKeyRef.current && sequence === requestSeq.current) {
        setList((xs) => [...xs, { id: nextId(), from: 'ai', text: displayReply }])
        if (pendingMessage.current?.id === messageId) pendingMessage.current = null
      }
    } catch (error) {
      if (!controller.signal.aborted && owner === sessionKeyRef.current && sequence === requestSeq.current) {
        setText((current) => current || question)
        setList((xs) => xs.filter((message) => message.id !== messageId))
        if (pendingMessage.current?.id === messageId) pendingMessage.current = null
        const message = error instanceof Error ? error.message : '小海阿狐暂时没有回应'
        toast(`${message}，你可以编辑输入框后重试。`)
      }
    } finally {
      if (request.current === controller) {
        request.current = null
        if (owner === sessionKeyRef.current && sequence === requestSeq.current) setThinking(false)
      }
    }

  }

  function cancelThinking() {
    const active = request.current
    const pending = pendingMessage.current
    if (!active || !pending) return
    requestSeq.current++
    request.current = null
    pendingMessage.current = null
    active.abort()
    setThinking(false)
    setList((items) => items.filter((message) => message.id !== pending.id))
    setText((current) => current || pending.question)
    toast('已停止本机等待；若请求已送达服务端，模型处理无法撤回。问题已放回输入框。')
  }

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <button className={styles.back} onClick={() => goBack(nav, '/services')} aria-label="返回">
          <IconBack />
        </button>
        <img className={styles.avatarLg} src={avatar.sun} alt="小海阿狐" width="40" height="40" />
        <div className={styles.who}>
          <b>小海阿狐</b>
          <span>你的校园生活助手</span>
        </div>
        <button type="button" className={styles.fortuneSettingsEntry} onClick={() => setSettingsOpen(true)}>每日解读设置</button>
      </header>

      <div ref={scrollList} className={`${styles.list} hide-scroll`}>
        {hasDaily ? <DailyFortune preferences={fortune} /> : null}
        {list.map((m) => (
          <div key={m.id} className={`${styles.row} ${m.from === 'me' ? styles.me : ''}`}>
            {m.from === 'ai' ? <img className={`${styles.avatarSm} ${styles.assistantAvatar}`} src={avatar.sun} alt="" width="32" height="32" /> : null}
            <div className={styles.bubble}>
              {m.text.split('\n').map((line, i) => (
                <span key={i} style={{ display: 'block' }}>
                  {line}
                </span>
              ))}
              {m.fortune ? <button type="button" className={styles.fortuneAction} onClick={() => openFortune(m.fortune!)}>
                {m.fortune === 'tarot' ? '打开塔罗牌桌' : m.fortune === 'stars' ? '打开星图' : m.fortune === 'animals' ? '打开生肖牌' : dailyTarget(m.fortune) ? '查看每日解读' : '打开每日解读设置'}
              </button> : null}
            </div>
            {m.from === 'me' ? <img className={styles.avatarSm} src={myAvatar} alt="" /> : null}
          </div>
        ))}
        {thinking ? (
          <div className={styles.row}>
            {foxfree ? null : <img className={`${styles.avatarSm} ${styles.assistantAvatar}`} src={avatar.sun} alt="" width="32" height="32" />}
            <div className={styles.bubble} role="status" aria-live="polite">小海阿狐正在思考…</div>
            <button type="button" className={styles.cancelRequest} onClick={cancelThinking}>停止等待</button>
          </div>
        ) : null}
      </div>

      <div className={`${styles.chips} hide-scroll`}>
        <button type="button" className={styles.chip} disabled={thinking} onClick={() => void send('我想抽塔罗')}>抽塔罗</button>
        {CHIPS.map((c) => (
          <button key={c.label} type="button" className={styles.chip} disabled={thinking} onClick={() => setText(c.text)}>
            {c.label}
          </button>
        ))}
      </div>

      <form
        className={styles.composer}
        onSubmit={(e) => {
          e.preventDefault()
          void send(text)
        }}
      >
        <textarea rows={1} enterKeyHint="enter" aria-label="输入你想问的" aria-describedby="chat-message-count" maxLength={MESSAGE_LIMIT} value={text} onChange={(e) => setText(e.target.value)} placeholder="输入你想问的…" onKeyDown={(event) => { if (submitMessageKey(event)) { event.preventDefault(); void send(text) } }} />
        <button className={styles.send} type="submit" disabled={thinking || !text.trim()} onPointerDown={(event) => event.preventDefault()} aria-label="发送">
          <IconSend /><span>发送</span>
        </button>
      </form>
      <small id="chat-message-count" className={styles.composerCount}>{text.length}/{MESSAGE_LIMIT} 字 · 长通知请分段粘贴</small>
      {settingsOpen ? <DialogLayer title="每日解读设置" onClose={() => setSettingsOpen(false)}>
        <FortuneSettings key={sessionKey} preferences={fortune} onSave={saveFortune} onClose={() => setSettingsOpen(false)} />
      </DialogLayer> : null}
      {workspace ? <DialogLayer title="今日天机" full className={styles.fortuneWorkspace} onClose={() => setWorkspace(null)}>
        <Suspense fallback={<p role="status" className={styles.fortuneLoading}>正在打开牌桌…</p>}>
          <FortuneWorkbench initialReading={workspace} onClose={() => setWorkspace(null)} />
        </Suspense>
      </DialogLayer> : null}
      {confirmation?.owner === sessionKey ? <DialogLayer title="发送给小海阿狐" onClose={() => setConfirmation(null)}>
        <div className={styles.confirmation}>
          <h2>发送给小海阿狐</h2>
          <p>本次会话的问题和最近对话会发送给{confirmation.service === 'agnes' ? '哦狐 AI 服务及 Agnes AI' : '哦狐问答服务'}，用于生成回复。请避免输入密码、学号或联系方式。</p>
          <div className={styles.confirmationActions}>
            <button type="button" onClick={() => setConfirmation(null)}>返回编辑</button>
            <button type="button" onClick={() => {
              setApprovedService(confirmation.service)
              setConfirmation(null)
              void send(confirmation.question, confirmation.service)
            }}>同意并发送</button>
          </div>
        </div>
      </DialogLayer> : null}
    </div>
  )
}
