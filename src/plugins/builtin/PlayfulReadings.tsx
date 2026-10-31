import { useEffect, useState } from 'react'
import styles from './PlayfulReadings.module.css'

type ToggleProps = { enabled: boolean; onToggle: () => void }

const CARDS = [
  ['愚者', '给新开始留一点空间。今天可以先迈出一个轻松的小步。'],
  ['魔术师', '看看手边已经拥有的资源，挑一件事把它们用起来。'],
  ['女祭司', '先安静听听自己的想法，再决定是否需要回应。'],
  ['皇后', '给自己补充一点照顾：休息、喝水，或和朋友聊聊。'],
  ['皇帝', '把一件重要的小事安排清楚，减少临时决定。'],
  ['教皇', '向可信任的人请教，也可以重新看看已有的经验。'],
  ['恋人', '在两个选择之间，想想哪一个更符合你在意的事。'],
  ['战车', '把注意力放回眼前一步，不必一次解决所有问题。'],
  ['力量', '温和而坚定地表达边界，也给自己一点耐心。'],
  ['隐者', '留一段不被打扰的时间，整理最近的思绪。'],
  ['命运之轮', '计划之外也会有变化，先准备一个灵活的备选。'],
  ['正义', '核对事实与约定，再做对自己和他人都公平的决定。'],
  ['倒吊人', '换个角度看同一件事，也许能发现新的解法。'],
  ['死神', '放下一个已经不适合的做法，为新习惯腾出位置。'],
  ['节制', '把任务拆小，给学习、休息和社交留出平衡。'],
  ['恶魔', '留意让自己分心的循环，试着减少一个小诱因。'],
  ['高塔', '如果计划被打乱，先处理最紧急的一件，再慢慢调整。'],
  ['星星', '给长期目标留一点希望，也记下今天能完成的一步。'],
  ['月亮', '信息不完整时先别急着下结论，可以再确认一次。'],
  ['太阳', '记录一件今天做得不错的事，让进步变得看得见。'],
  ['审判', '回顾最近的选择，从中带走经验，不必反复责怪自己。'],
  ['世界', '完成一个阶段后，给自己一点肯定，再开始下一段。'],
] as const

const SIGNS = ['白羊座', '金牛座', '双子座', '巨蟹座', '狮子座', '处女座', '天秤座', '天蝎座', '射手座', '摩羯座', '水瓶座', '双鱼座']
const PROMPTS = [
  '今天适合先完成一件十分钟内能收尾的小事。',
  '给日程留一点弹性，临时变化也能从容应对。',
  '主动问候一位朋友，简单的交流也会带来好心情。',
  '遇到难题时先写下已知条件，再决定下一步。',
  '休息不是偷懒，短暂放松后再回来继续。',
  '把想法说清楚，比猜测对方的意思更轻松。',
  '今天可以尝试一个熟悉任务的新方法。',
  '做决定前核对信息，给自己一点思考时间。',
  '记得肯定已经完成的部分，再安排剩下的事。',
  '遇到分歧时，先确认双方真正想解决的问题。',
  '去户外走一小段，让注意力换个节奏。',
  '给重要任务设一个温和的开始时间，先动起来。',
] as const

const NUMBER_NOTES = [
  '行动与尝试：选一个小目标，今天先做第一步。',
  '合作与倾听：找个人交换想法，留意彼此的不同。',
  '表达与创造：把一个点子写下来，不要求一次完美。',
  '秩序与基础：整理桌面或计划，为接下来的任务减负。',
  '变化与体验：给日常加一点新鲜感，同时照顾好节奏。',
  '关心与连结：在帮助别人时，也记得给自己留空间。',
  '观察与思考：暂时放慢速度，先弄清楚自己真正需要什么。',
  '坚持与边界：专注于可控的部分，合理安排精力。',
  '回顾与收尾：完成一件拖延的小事，给自己一个句号。',
] as const

function randomIndex(length: number): number {
  if (length <= 1) return 0
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    const value = new Uint32Array(1)
    crypto.getRandomValues(value)
    return value[0] % length
  }
  return Math.floor(Math.random() * length)
}

function ToggleButton({ enabled, onToggle }: ToggleProps) {
  return <button type="button" className={enabled ? styles.secondary : styles.primary} onClick={onToggle} aria-label={enabled ? '停用此插件' : '启用此插件'} aria-pressed={enabled}>{enabled ? '使用中 · 点击停用' : '未使用 · 点击启用'}</button>
}

export function TarotReflection({ enabled, onToggle }: ToggleProps) {
  const [draw, setDraw] = useState<{ name: string; note: string; reversed: boolean } | null>(null)
  useEffect(() => { if (!enabled) setDraw(null) }, [enabled])
  return <div className={styles.controls}>
    <ToggleButton enabled={enabled} onToggle={onToggle} />
    {enabled ? <div className={styles.tool}>
      <p className={styles.disclaimer}>仅供娱乐与自我反思，不预测未来，也不替代专业建议。</p>
      <button type="button" className={styles.draw} onClick={() => {
        const card = CARDS[randomIndex(CARDS.length)]
        const reversed = randomIndex(2) === 1
        setDraw({ name: card[0], note: reversed ? `换个方向想想：${card[1]}` : card[1], reversed })
      }}>抽一张灵感牌</button>
      {draw ? <div className={styles.result} aria-live="polite"><b>{draw.name} · {draw.reversed ? '逆位视角' : '正位视角'}</b><span>{draw.note}</span></div> : null}
    </div> : null}
  </div>
}

export function ZodiacReflection({ enabled, onToggle }: ToggleProps) {
  const [sign, setSign] = useState(SIGNS[0])
  const [prompt, setPrompt] = useState('')
  useEffect(() => { if (!enabled) setPrompt('') }, [enabled])
  return <div className={styles.controls}>
    <ToggleButton enabled={enabled} onToggle={onToggle} />
    {enabled ? <div className={styles.tool}>
      <label className={styles.label}>选择星座
        <select className={styles.select} value={sign} onChange={(event) => { setSign(event.target.value); setPrompt('') }}>{SIGNS.map((item) => <option key={item}>{item}</option>)}</select>
      </label>
      <button type="button" className={styles.draw} onClick={() => setPrompt(PROMPTS[randomIndex(PROMPTS.length)])}>看看今日灵感</button>
      {prompt ? <div className={styles.result} aria-live="polite"><b>{sign} · 今日小提示</b><span>{prompt}</span></div> : null}
      <p className={styles.disclaimer}>随机生成的娱乐内容，不是个人运势预测；不需要填写生日。</p>
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
