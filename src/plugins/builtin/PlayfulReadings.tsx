import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { requestAgnes } from '../../lib/agnes-ai'
import styles from './PlayfulReadings.module.css'

type ToggleProps = { enabled: boolean; onToggle: () => void }
type ReadingCard = { name: string; symbol: string; family: string; note: string }

const MAJOR_ARCANA: ReadingCard[] = [
  ['愚者', '✧', '旅程', '给新开始留一点空间。今天可以先迈出一个轻松的小步。'],
  ['魔术师', '✦', '创造', '看看手边已经拥有的资源，挑一件事把它们用起来。'],
  ['女祭司', '☾', '直觉', '先安静听听自己的想法，再决定是否需要回应。'],
  ['皇后', '❀', '滋养', '给自己补充一点照顾：休息、喝水，或和朋友聊聊。'],
  ['皇帝', '♜', '秩序', '把一件重要的小事安排清楚，减少临时决定。'],
  ['教皇', '⌘', '经验', '向可信任的人请教，也可以重新看看已有的经验。'],
  ['恋人', '♡', '选择', '在两个选择之间，想想哪一个更符合你在意的事。'],
  ['战车', '➤', '行动', '把注意力放回眼前一步，不必一次解决所有问题。'],
  ['力量', '♌', '勇气', '温和而坚定地表达边界，也给自己一点耐心。'],
  ['隐者', '♧', '独处', '留一段不被打扰的时间，整理最近的思绪。'],
  ['命运之轮', '◉', '变化', '计划之外也会有变化，先准备一个灵活的备选。'],
  ['正义', '⚖', '平衡', '核对事实与约定，再做对自己和他人都公平的决定。'],
  ['倒吊人', '▽', '换位', '换个角度看同一件事，也许能发现新的解法。'],
  ['死神', '✣', '转变', '放下一个已经不适合的做法，为新习惯腾出位置。'],
  ['节制', '≈', '调和', '把任务拆小，给学习、休息和社交留出平衡。'],
  ['恶魔', '⛓', '觉察', '留意让自己分心的循环，试着减少一个小诱因。'],
  ['高塔', 'ϟ', '重整', '如果计划被打乱，先处理最紧急的一件，再慢慢调整。'],
  ['星星', '✳', '希望', '给长期目标留一点希望，也记下今天能完成的一步。'],
  ['月亮', '☽', '想象', '信息不完整时先别急着下结论，可以再确认一次。'],
  ['太阳', '☼', '明朗', '记录一件今天做得不错的事，让进步变得看得见。'],
  ['审判', '♬', '回望', '回顾最近的选择，从中带走经验，不必反复责怪自己。'],
  ['世界', '◎', '完成', '完成一个阶段后，给自己一点肯定，再开始下一段。'],
].map(([name, symbol, family, note]) => ({ name, symbol, family, note }))

const SUITS = [
  { name: '权杖', symbol: '✦', family: '火花', note: '把想法变成一个可以开始的小动作。' },
  { name: '圣杯', symbol: '◇', family: '心意', note: '留意自己的感受，也给关系一点耐心。' },
  { name: '宝剑', symbol: '⌁', family: '思路', note: '把问题拆开，先核对事实再作决定。' },
  { name: '星币', symbol: '⬡', family: '日常', note: '照顾好手边的具体事务，一步步积累。' },
] as const
const RANKS = ['王牌', '二', '三', '四', '五', '六', '七', '八', '九', '十', '侍从', '骑士', '王后', '国王'] as const
const MINOR_ARCANA: ReadingCard[] = SUITS.flatMap((suit) => RANKS.map((rank, index) => ({
  name: `${suit.name}·${rank}`,
  symbol: suit.symbol,
  family: suit.family,
  note: index === 0 ? `从一个小开端开始。${suit.note}` : `${suit.note} 今天可先关注一件与「${rank}」牌意相呼应的小事。`,
})))
const DECK = [...MAJOR_ARCANA, ...MINOR_ARCANA]

const SIGNS = [
  { name: '白羊座', glyph: '♈', date: '3.21—4.19', points: [[10, 27], [19, 13], [34, 17], [43, 31], [31, 39]] },
  { name: '金牛座', glyph: '♉', date: '4.20—5.20', points: [[13, 12], [27, 24], [38, 12], [35, 31], [21, 40]] },
  { name: '双子座', glyph: '♊', date: '5.21—6.21', points: [[12, 12], [16, 38], [31, 13], [37, 40], [25, 27]] },
  { name: '巨蟹座', glyph: '♋', date: '6.22—7.22', points: [[10, 32], [19, 14], [29, 11], [38, 23], [29, 39]] },
  { name: '狮子座', glyph: '♌', date: '7.23—8.22', points: [[11, 16], [24, 11], [36, 19], [33, 34], [19, 40]] },
  { name: '处女座', glyph: '♍', date: '8.23—9.22', points: [[10, 31], [15, 13], [25, 17], [31, 10], [39, 33]] },
  { name: '天秤座', glyph: '♎', date: '9.23—10.23', points: [[11, 16], [23, 11], [36, 19], [17, 31], [33, 38]] },
  { name: '天蝎座', glyph: '♏', date: '10.24—11.22', points: [[10, 37], [15, 18], [24, 12], [31, 23], [39, 12]] },
  { name: '射手座', glyph: '♐', date: '11.23—12.21', points: [[11, 36], [20, 25], [29, 15], [39, 12], [31, 32]] },
  { name: '摩羯座', glyph: '♑', date: '12.22—1.19', points: [[11, 13], [22, 24], [34, 12], [38, 31], [23, 40]] },
  { name: '水瓶座', glyph: '♒', date: '1.20—2.18', points: [[10, 17], [19, 29], [29, 14], [38, 29], [28, 39]] },
  { name: '双鱼座', glyph: '♓', date: '2.19—3.20', points: [[11, 16], [20, 30], [33, 12], [39, 30], [24, 40]] },
] as const
const STAR_POSITIONS = [
  [12, 8], [47, 6], [81, 11], [22, 20], [63, 17], [91, 25], [6, 38], [51, 31], [74, 38], [16, 48],
  [38, 46], [87, 52], [8, 63], [27, 71], [55, 64], [72, 75], [95, 69], [17, 88], [45, 83], [84, 91],
] as const
const PROMPTS = [
  '先完成一件十分钟内能收尾的小事。', '给日程留一点弹性，临时变化也能从容应对。',
  '主动问候一位朋友，简单的交流也会带来好心情。', '遇到难题时先写下已知条件，再决定下一步。',
  '休息不是偷懒，短暂放松后再回来继续。', '把想法说清楚，比猜测对方的意思更轻松。',
  '今天可以尝试一个熟悉任务的新方法。', '做决定前核对信息，给自己一点思考时间。',
  '肯定已经完成的部分，再安排剩下的事。', '遇到分歧时，先确认双方真正想解决的问题。',
  '去户外走一小段，让注意力换个节奏。', '给重要任务设一个温和的开始时间，先动起来。',
] as const

const NUMBER_NOTES = [
  '行动与尝试：选一个小目标，今天先做第一步。', '合作与倾听：找个人交换想法，留意彼此的不同。',
  '表达与创造：把一个点子写下来，不要求一次完美。', '秩序与基础：整理桌面或计划，为接下来的任务减负。',
  '变化与体验：给日常加一点新鲜感，同时照顾好节奏。', '关心与连结：在帮助别人时，也记得给自己留空间。',
  '观察与思考：暂时放慢速度，先弄清楚自己真正需要什么。', '坚持与边界：专注于可控的部分，合理安排精力。',
  '回顾与收尾：完成一件拖延的小事，给自己一个句号。',
] as const

function randomIndex(length: number): number {
  if (length <= 1) return 0
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    const ceiling = Math.floor(0x1_0000_0000 / length) * length
    const value = new Uint32Array(1)
    do { crypto.getRandomValues(value) } while (value[0] >= ceiling)
    return value[0] % length
  }
  return Math.floor(Math.random() * length)
}

function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = randomIndex(index + 1)
    ;[result[index], result[target]] = [result[target], result[index]]
  }
  return result
}

function ToggleButton({ enabled, onToggle }: ToggleProps) {
  return <button type="button" className={enabled ? styles.secondary : styles.primary} onClick={onToggle} aria-label={enabled ? '停用此插件' : '启用此插件'} aria-pressed={enabled}>{enabled ? '使用中 · 点击停用' : '未使用 · 点击启用'}</button>
}

export function TarotReflection({ enabled, onToggle }: ToggleProps) {
  const [spread, setSpread] = useState<1 | 3>(1)
  const [phase, setPhase] = useState<'ready' | 'shuffling' | 'revealed'>('ready')
  const [drawn, setDrawn] = useState<Array<{ card: ReadingCard; reversed: boolean }>>([])
  const [question, setQuestion] = useState('')
  const [chatQuestion, setChatQuestion] = useState('')
  const [chatAnswer, setChatAnswer] = useState('')
  const [aiAnswer, setAiAnswer] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiConsent, setAiConsent] = useState(false)
  const [conversation, setConversation] = useState('')
  const aiRequest = useRef<AbortController | null>(null)
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); aiRequest.current?.abort() }, [])
  useEffect(() => {
    if (!enabled) {
      if (timer.current !== null) window.clearTimeout(timer.current)
      aiRequest.current?.abort(); aiRequest.current = null; setAiBusy(false)
      timer.current = null
      setPhase('ready')
      setDrawn([])
      setQuestion(''); setChatQuestion(''); setChatAnswer(''); setAiAnswer(''); setConversation(''); setAiError(''); setAiConsent(false)
    }
  }, [enabled])

  function drawCards(withAi = false) {
    if (phase === 'shuffling') return
    const cards = shuffle(DECK).slice(0, spread).map((card) => ({ card, reversed: randomIndex(2) === 1 }))
    setDrawn([])
    setAiAnswer('')
    setAiError('')
    setPhase('shuffling')
    timer.current = window.setTimeout(async () => {
      setDrawn(cards)
      setPhase('revealed')
      timer.current = null
      if (withAi) {
        const prompt = `用户正在进行塔罗自我反思。${conversation ? `此前关于塔罗的交流：\n${conversation.slice(-2500)}\n` : ''}用户的问题：${question.trim()}\n本次由哦狐本机随机抽取的牌：${cards.map(({ card, reversed }, index) => `${places[index]}：${card.name}（${reversed ? '逆位视角' : '正位视角'}；牌意提示：${card.note}）`).join('；')}\n请先简短说明牌面只是一种反思视角，再逐张联系问题解释，最后给出一个温和、可自行判断的小行动。不要预测结果或替用户作重大决定。`
        const controller = new AbortController()
        aiRequest.current?.abort(); aiRequest.current = controller
        setAiBusy(true)
        try { const answer = await requestAgnes('playful-reading', prompt, controller.signal); if (!controller.signal.aborted) setAiAnswer(answer) }
        catch (error) { if (!controller.signal.aborted) setAiError(error instanceof Error ? error.message : 'AI 暂时无法解读，请稍后重试。') }
        finally { if (aiRequest.current === controller) { aiRequest.current = null; setAiBusy(false) } }
      }
    }, 760)
  }

  async function chatAboutTarot() {
    const text = chatQuestion.trim()
    if (!text || aiBusy) return
    if (!aiConsent) { setAiError('先阅读发送说明并勾选确认。'); return }
    const controller = new AbortController(); aiRequest.current?.abort(); aiRequest.current = controller
    setAiBusy(true); setAiError(''); setChatAnswer('')
    try {
      const answer = await requestAgnes('chat', `请以塔罗文化知识和自我反思为主题回答。只提供常见象征与玩法背景，不声称能够预测现实。\n${conversation ? `此前交流：\n${conversation.slice(-2500)}\n` : ''}用户问题：${text}`, controller.signal)
      if (!controller.signal.aborted) { setChatAnswer(answer); setConversation(current => `${current}\n用户：${text}\n哦狐 AI：${answer}`.slice(-5000)) }
    } catch (error) { if (!controller.signal.aborted) setAiError(error instanceof Error ? error.message : 'AI 暂时无法回应，请稍后重试。') }
    finally { if (aiRequest.current === controller) { aiRequest.current = null; setAiBusy(false) } }
  }

  const places = spread === 1 ? ['今日灵感'] : ['过去', '现在', '下一步']
  return <div className={styles.controls}>
    <ToggleButton enabled={enabled} onToggle={onToggle} />
    {enabled ? <div className={`${styles.tool} ${styles.tarotTool}`}>
      <div className={styles.cosmicHeader}><span className={styles.kicker}>一副牌 · 一点灵感</span><span className={styles.deckCount}>78 张</span></div>
      <p className={styles.disclaimer}>把牌当作一个自我提问的起点。结果仅供娱乐与反思，不预测未来，也不替代专业建议。</p>
      <section className={styles.aiPrelude} aria-label="先了解塔罗或直接抽牌">
        <div><b>先聊聊，或直接开始</b><span>可以先问塔罗的专业知识；也可跳过 AI，直接本机翻牌。</span></div>
        <label className={styles.label}>想了解什么？<textarea className={styles.aiInput} rows={2} maxLength={3000} value={chatQuestion} onChange={event => { setChatQuestion(event.target.value); setAiConsent(false); setAiError('') }} placeholder="例如：单张牌和三张牌阵有什么区别？" /></label>
        <p className={styles.aiDisclosure}>使用 AI 时，本次问题、相关对话摘要及本机抽取的牌名会发送给哦狐 AI 服务及模型服务商处理。请勿输入个人敏感信息。</p>
        <label className={styles.aiConsent}><input type="checkbox" checked={aiConsent} onChange={event => setAiConsent(event.target.checked)} /><span>我已阅读并同意发送当前问题</span></label>
        <button type="button" className={styles.secondary} disabled={aiBusy || !chatQuestion.trim() || !aiConsent} onClick={() => void chatAboutTarot()}>{aiBusy ? 'AI 正在回复…' : '先和 AI 聊聊'}</button>
        {chatAnswer ? <div className={styles.aiReply}><b>哦狐 AI · 塔罗知识</b><span>{chatAnswer}</span></div> : null}
        <label className={styles.label}>这次想反思的问题<input className={styles.aiInput} maxLength={1000} value={question} onChange={event => { setQuestion(event.target.value); setAiConsent(false); setAiError('') }} placeholder="例如：我怎样更好地安排这周的复习？（可选）" /></label>
      </section>
      <div className={styles.spreadPicker} role="group" aria-label="选择塔罗牌阵">
        <button type="button" aria-pressed={spread === 1} disabled={phase === 'shuffling'} onClick={() => { setSpread(1); setPhase('ready'); setDrawn([]) }}>单张 · 今日</button>
        <button type="button" aria-pressed={spread === 3} disabled={phase === 'shuffling'} onClick={() => { setSpread(3); setPhase('ready'); setDrawn([]) }}>三张 · 过去现在下一步</button>
      </div>
      <div className={`${styles.drawStage} ${phase === 'shuffling' ? styles.shuffleStage : ''}`} aria-busy={phase === 'shuffling'}>
        {phase !== 'revealed' ? <div className={`${styles.deckStack} ${phase === 'shuffling' ? styles.shuffleDeck : ''}`} aria-hidden="true">
          <span className={styles.deckCardBack} /><span className={styles.deckCardBack} /><span className={styles.deckCardBack}>
            <span className={styles.backRosette}>✦</span><span className={styles.backOrb}>☾</span><span className={styles.backRosette}>✦</span>
          </span>
        </div> : <div className={`${styles.readingCards} ${spread === 3 ? styles.threeCards : ''}`} aria-live="polite">
          {drawn.map(({ card, reversed }, index) => <div className={styles.readingSlot} key={`${card.name}-${index}`}>
            <div className={styles.cardStage}>
              <div className={`${styles.tarotCard} ${reversed ? styles.reversedCard : ''}`} aria-label={`${card.name}，${reversed ? '逆位视角' : '正位视角'}`}>
                <div className={styles.cardFrame}>
                  <span className={styles.cardRoman}>{card.family}</span>
                  <span className={styles.cardGlyph} aria-hidden="true">{card.symbol}</span>
                  <span className={styles.cardName}>{card.name}</span>
                  <span className={styles.cardStars} aria-hidden="true">✦　·　✧</span>
                </div>
              </div>
            </div>
            <span className={styles.cardPosition}>{places[index]}</span>
            <div className={styles.cardMeaning}><b>{card.name} · {reversed ? '逆位视角' : '正位视角'}</b><span>{reversed ? `换个方向想想：${card.note}` : card.note}</span></div>
          </div>)}
        </div>}
        {phase === 'shuffling' ? <span className={styles.shuffleStatus} role="status">正在洗牌…</span> : null}
      </div>
      <button type="button" className={styles.draw} onClick={() => drawCards(false)} disabled={phase === 'shuffling'}>{phase === 'shuffling' ? '正在洗牌…' : phase === 'revealed' ? '直接再翻一次' : spread === 1 ? '直接翻一张牌' : '直接展开牌阵'}</button>
      <button type="button" className={styles.aiDraw} onClick={() => drawCards(true)} disabled={phase === 'shuffling' || aiBusy || !question.trim() || !aiConsent}>{aiBusy && phase === 'shuffling' ? '正在洗牌…' : aiBusy ? 'AI 正在结合牌面解读…' : 'AI 翻牌并解读我的问题'}</button>
      {aiError ? <p className={styles.aiError} role="alert">{aiError}</p> : null}
      {aiAnswer ? <div className={styles.aiReply} aria-live="polite"><b>哦狐 AI · 牌面反思</b><span>{aiAnswer}</span><small>这是娱乐与自我反思内容，不预测现实结果，不替代专业建议。</small></div> : null}
      <p className={styles.localNote}>抽取过程在本机完成，不保存抽牌记录。</p>
    </div> : null}
  </div>
}

function constellationPath(points: readonly (readonly [number, number])[]) {
  return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')
}

function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0)
  return Math.floor((date.getTime() - start.getTime()) / 86_400_000)
}

export function ZodiacReflection({ enabled, onToggle }: ToggleProps) {
  const [selected, setSelected] = useState<number | null>(null)
  const [connected, setConnected] = useState(false)
  useEffect(() => { if (!enabled) { setSelected(null); setConnected(false) } }, [enabled])
  const prompt = useMemo(() => {
    if (selected === null || !connected) return null
    return PROMPTS[(selected * 5 + dayOfYear(new Date())) % PROMPTS.length]
  }, [connected, selected])

  function choose(index: number) {
    setSelected(index)
    setConnected(false)
  }

  function handleConstellationKey(event: KeyboardEvent<SVGGElement>, index: number) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      choose(index)
    }
  }

  return <div className={styles.controls}>
    <ToggleButton enabled={enabled} onToggle={onToggle} />
    {enabled ? <div className={`${styles.tool} ${styles.zodiacTool}`}>
      <div className={styles.cosmicHeader}><span className={styles.kicker}>星空互动 · 今日行动</span><span className={styles.deckCount}>12 星座</span></div>
      <p className={styles.disclaimer}>点亮星图中的一组星点，让它连成你的星座。星图为互动示意，不代表真实天文位置。无需填写生日；提示是轻松的自我提醒，不是运势预测。</p>
      <div className={styles.skyMap}>
        <div className={styles.skyDust} aria-hidden="true">{STAR_POSITIONS.map(([x, y], index) => <i key={index} style={{ left: `${x}%`, top: `${y}%` }} />)}</div>
        <svg className={styles.constellations} viewBox="0 0 400 240" role="group" aria-label="选择星座星图">
          {SIGNS.map((sign, index) => {
            const x = 13 + (index % 4) * 96
            const y = 7 + Math.floor(index / 4) * 78
            const active = selected === index
            return <g key={sign.name} transform={`translate(${x} ${y})`} role="button" tabIndex={0} aria-label={`选择${sign.name}，日期范围${sign.date}`} aria-pressed={active} className={`${styles.constellation} ${active ? styles.selectedConstellation : ''}`} onClick={() => choose(index)} onKeyDown={(event) => handleConstellationKey(event, index)}>
              <title>{sign.name} · {sign.date}</title>
              <circle className={styles.starHitArea} cx="25" cy="25" r="34" />
              {active ? <path className={`${styles.starLines} ${connected ? styles.connectedLines : ''}`} d={constellationPath(sign.points)} /> : null}
              {sign.points.map(([px, py], pointIndex) => <circle key={pointIndex} className={styles.constellationStar} cx={px} cy={py} r={active ? 2.7 : 1.9} />)}
              <text className={styles.signGlyph} x="25" y="59" textAnchor="middle">{active && connected ? sign.glyph : '✦'}</text>
              <text className={styles.signName} x="25" y="73" textAnchor="middle">{active ? sign.name : sign.name.slice(0, 2)}</text>
            </g>
          })}
        </svg>
        <span className={styles.skyCaption}>选择一组星点</span>
      </div>
      {selected !== null ? <div className={`${styles.selectedSign} ${connected ? styles.signConnected : ''}`} aria-live="polite">
        <span className={styles.selectedGlyph}>{connected ? SIGNS[selected].glyph : '✦'}</span>
        <div><b>{connected ? `${SIGNS[selected].name} · 已点亮` : `已选择${SIGNS[selected].name}`}</b><span>{SIGNS[selected].date}</span></div>
      </div> : null}
      {selected !== null && !connected ? <button type="button" className={styles.draw} onClick={() => setConnected(true)}>连起星点，看看今日提示</button> : null}
      {prompt ? <div className={`${styles.result} ${styles.zodiacResult}`} aria-live="polite"><span className={styles.resultEyebrow}>今日给自己的小建议</span><b>{SIGNS[selected!].glyph}　{SIGNS[selected!].name}</b><span>{prompt}</span><button type="button" className={styles.resetSign} onClick={() => { setSelected(null); setConnected(false) }}>重新选择星座</button></div> : null}
    </div> : null}
  </div>
}

export function BirthdayNumberPlay({ enabled, onToggle }: ToggleProps) {
  const [date, setDate] = useState('')
  const [number, setNumber] = useState<number | null>(null)
  useEffect(() => { if (!enabled) { setDate(''); setNumber(null) } }, [enabled])
  function calculate() {
    const digits = date.replaceAll('-', '').split('').map(Number)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || digits.length !== 8) return
    let sum = digits.reduce((total, digit) => total + digit, 0)
    while (sum > 9) sum = String(sum).split('').reduce((total, digit) => total + Number(digit), 0)
    setNumber(sum)
  }
  return <div className={styles.controls}>
    <ToggleButton enabled={enabled} onToggle={onToggle} />
    {enabled ? <div className={styles.tool}>
      <label className={styles.label}>生日（只在本机临时计算）<input className={styles.select} type="date" value={date} onChange={(event) => { setDate(event.target.value); setNumber(null) }} /></label>
      <button type="button" className={styles.draw} onClick={calculate} disabled={!date}>生成趣味数字</button>
      {number !== null ? <div className={styles.result} aria-live="polite"><b>数字 {number} · 趣味主题</b><span>{NUMBER_NOTES[number - 1]}</span></div> : null}
      <p className={styles.disclaimer}>输入仅用于当前页面计算，不保存、不上传。数字解读没有科学预测依据，只作娱乐。</p>
    </div> : null}
  </div>
}
