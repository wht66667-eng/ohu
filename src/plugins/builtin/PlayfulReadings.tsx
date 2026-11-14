import { useEffect, useRef, useState } from 'react'
import { TarotAiPanel, ZodiacAiPanel } from './TarotAiPanel'
import { useUiMotion } from '../../lib/motion-pref'
import { useAuth } from '../../lib/auth'
import { journalId, saveJournal } from '../../lib/campus-journal'
import { localDateKey } from '../../lib/chat-fortune'
import { toast } from '../../lib/toast'
import { CHINESE_ZODIAC, WESTERN_ZODIAC, fortuneArtwork, dailyFortunePrompt } from './fortune-cards'
import { TAROT_CARDS, TAROT_GROUPS, type TarotBackId, type TarotCardArt, type TarotGroup } from './tarot-cards'
import { FortuneIllustration } from './FortuneIllustration'
import styles from './PlayfulReadings.module.css'

type ToggleProps = { enabled: boolean; onToggle: () => void }
type CardNotes = { symbol: string; family: string; note: string; reversedNote: string }
type ReadingCard = TarotCardArt & CardNotes
type ReadingProps = { enabled: boolean; onToggle?: () => void }

function useReadingOwner(): string {
  const auth = useAuth()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  return uid ? `user:${uid}` : 'guest'
}

async function saveReadingToJournal(owner: string, title: string, body: string) {
  const now = Date.now()
  await saveJournal({
    owner, id: journalId(), day: localDateKey(), kind: 'journal', title, body,
    mood: '', photos: [], pinned: false, createdAt: now, updatedAt: now,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
  toast.ok('已存入今天的手账')
}

const MAJOR_REVERSED = [
  '先确认承担得起的代价，再决定要不要迈出这一步。',
  '把精力从想证明自己，移回一件今天能动手的事。',
  '把直觉和已知事实分开，等信息更清楚再判断。',
  '留意照顾别人时是否忘了自己，今天给自己留出一点时间。',
  '看看哪条规则已经不合适，给执行方式留一点弹性。',
  '遇到别人习以为常的建议，先想想它适不适合你。',
  '如果选择让你犹豫，把自己的需求和外界期待分别写下来。',
  '如果同时朝几个方向用力，先停一下，只保留一个眼下的目标。',
  '不必靠硬撑证明勇气。找出一个可以求助或减轻压力的地方。',
  '留意独处是否变成回避。试着联系一位让你放松的人。',
  '先把能控制和暂时不能控制的事分开，给计划留一个备选。',
  '如果你已下结论，找一条可能与它相反的事实重新核对。',
  '问问自己仍在等待什么，能否给这段等待设一个截止时间。',
  '想想哪种旧做法拖慢了你，试着只替换其中的一小步。',
  '留意哪里投入过多或恢复不足，今天先调整其中一项。',
  '给一个容易反复的习惯加一点阻力，比如把诱因移出视线。',
  '先留意你在回避的变动，挑一个可逆的小调整试试。',
  '当远目标让人泄气，先记录一项已经做到的事。',
  '把担心写成一句可核对的问题，避免让想象替代事实。',
  '暂时放下“必须很开心”的要求，留意一件确实让你舒服的小事。',
  '留意是否在用过去的失误评价现在的自己，改成一条具体改进。',
  '找出让这一阶段一直悬着的一件小事，决定收尾还是明确延期。',
]

const MAJOR_NOTES: CardNotes[] = [
  ['✧', '旅程', '给新开始留一点空间。今天可以先迈出一个轻松的小步。'],
  ['✦', '创造', '看看手边已经拥有的资源，挑一件事把它们用起来。'],
  ['☾', '直觉', '先安静听听自己的想法，再决定是否需要回应。'],
  ['❀', '滋养', '给自己补充一点照顾：休息、喝水，或和朋友聊聊。'],
  ['♜', '秩序', '把一件重要的小事安排清楚，减少临时决定。'],
  ['⌘', '经验', '向可信任的人请教，也可以重新看看已有的经验。'],
  ['♡', '选择', '在两个选择之间，想想哪一个更符合你在意的事。'],
  ['➤', '行动', '把注意力放回眼前一步，不必一次解决所有问题。'],
  ['♌', '勇气', '温和而坚定地表达边界，也给自己一点耐心。'],
  ['♧', '独处', '留一段不被打扰的时间，整理最近的思绪。'],
  ['◉', '变化', '计划之外也会有变化，先准备一个灵活的备选。'],
  ['⚖', '平衡', '核对事实与约定，再做对自己和他人都公平的决定。'],
  ['▽', '换位', '换个角度看同一件事，也许能发现新的解法。'],
  ['✣', '转变', '放下一个已经不适合的做法，为新习惯腾出位置。'],
  ['≈', '调和', '把任务拆小，给学习、休息和社交留出平衡。'],
  ['⛓', '觉察', '留意让自己分心的循环，试着减少一个小诱因。'],
  ['ϟ', '重整', '如果计划被打乱，先处理最紧急的一件，再慢慢调整。'],
  ['✳', '希望', '给长期目标留一点希望，也记下今天能完成的一步。'],
  ['☽', '想象', '信息不完整时先别急着下结论，可以再确认一次。'],
  ['☼', '明朗', '记录一件今天做得不错的事，让进步变得看得见。'],
  ['♬', '回望', '回顾最近的选择，从中带走经验，不必反复责怪自己。'],
  ['◎', '完成', '完成一个阶段后，给自己一点肯定，再开始下一段。'],
].map(([symbol, family, note], index) => ({ symbol, family, note, reversedNote: MAJOR_REVERSED[index] }))

const SUITS = [
  { id: 'wands', symbol: '✦', family: '火花', note: '行动与创意', pause: '先放慢执行，确认目标仍值得投入。' },
  { id: 'cups', symbol: '◇', family: '心意', note: '感受与关系', pause: '先辨认自己的感受，再回应他人的期待。' },
  { id: 'swords', symbol: '⌁', family: '思路', note: '判断与沟通', pause: '把推测和已知事实分开，再决定怎么表达。' },
  { id: 'pentacles', symbol: '⬡', family: '日常', note: '资源与日常', pause: '先检查手头的时间和资源，再承诺下一步。' },
] as const
const RANKS = ['ace', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'page', 'knight', 'queen', 'king'] as const
const RANK_PROMPTS = [
  ['试一个小开端。', '先缩小开头的规模。'],
  ['比较两个选项，看看各自需要什么。', '暂缓二选一，检查是否还有第三条路。'],
  ['看看谁能提供反馈，交换一个具体想法。', '先对齐各自的期待，再决定要不要协作。'],
  ['给当前进度留一个稳定的检查点。', '找出一项过紧的安排，给它留一点弹性。'],
  ['遇到摩擦时，挑出最值得解决的一点。', '避免为赢一场争论消耗整天的精力。'],
  ['认清哪些支持已在手边，适当地回应。', '核对付出与获得是否失衡。'],
  ['在众多选项里，选一个可验证的试验。', '删掉最不现实的一项，降低选择负担。'],
  ['用可重复的小动作推进当前目标。', '停下来检查重复投入是否真的有效。'],
  ['回看个人积累，肯定一个具体进步。', '把独自硬撑的部分交给可以帮忙的人。'],
  ['做一次收尾，确认还要带走什么。', '把过重的任务拆开，先放下一项次要负担。'],
  ['带着好奇问一个能得到具体答案的问题。', '先练一小段，再承诺最终效果。'],
  ['挑一个值得推进的方向，今天做第一步。', '别在冲动时加码，先核对准备情况。'],
  ['先理解需求，再用手上的能力照顾它。', '先照顾自己的边界，再决定能帮多少。'],
  ['说清楚原则和责任，给下一步定个边界。', '确认掌控是否过多，把一部分决定交还给当事人。'],
] as const
const TAROT_NOTES = new Map<string, CardNotes>([
  ...MAJOR_NOTES.map((notes, index): [string, CardNotes] => [`major-${String(index).padStart(2, '0')}`, notes]),
  ...SUITS.flatMap(suit => RANKS.map((rank, index): [string, CardNotes] => [`${suit.id}-${rank}`, {
    symbol: suit.symbol,
    family: suit.family,
    note: `${suit.note}方面，${RANK_PROMPTS[index][0]}`,
    reversedNote: `${RANK_PROMPTS[index][1]}${suit.pause}`,
  }])),
])
const DECK: ReadingCard[] = TAROT_CARDS.map(card => {
  const notes = TAROT_NOTES.get(card.id)
  if (!notes) throw new Error(`塔罗牌缺少解读映射：${card.id}`)
  return { ...card, ...notes }
})

const CONSTELLATIONS = {
  aries: { glyph: '♈', date: '3.21—4.19', points: [[10, 27], [19, 13], [34, 17], [43, 31], [31, 39]] },
  taurus: { glyph: '♉', date: '4.20—5.20', points: [[13, 12], [27, 24], [38, 12], [35, 31], [21, 40]] },
  gemini: { glyph: '♊', date: '5.21—6.21', points: [[12, 12], [16, 38], [31, 13], [37, 40], [25, 27]] },
  cancer: { glyph: '♋', date: '6.22—7.22', points: [[10, 32], [19, 14], [29, 11], [38, 23], [29, 39]] },
  leo: { glyph: '♌', date: '7.23—8.22', points: [[11, 16], [24, 11], [36, 19], [33, 34], [19, 40]] },
  virgo: { glyph: '♍', date: '8.23—9.22', points: [[10, 31], [15, 13], [25, 17], [31, 10], [39, 33]] },
  libra: { glyph: '♎', date: '9.23—10.23', points: [[11, 16], [23, 11], [36, 19], [17, 31], [33, 38]] },
  scorpio: { glyph: '♏', date: '10.24—11.22', points: [[10, 37], [15, 18], [24, 12], [31, 23], [39, 12]] },
  sagittarius: { glyph: '♐', date: '11.23—12.21', points: [[11, 36], [20, 25], [29, 15], [39, 12], [31, 32]] },
  capricorn: { glyph: '♑', date: '12.22—1.19', points: [[11, 13], [22, 24], [34, 12], [38, 31], [23, 40]] },
  aquarius: { glyph: '♒', date: '1.20—2.18', points: [[10, 17], [19, 29], [29, 14], [38, 29], [28, 39]] },
  pisces: { glyph: '♓', date: '2.19—3.20', points: [[11, 16], [20, 30], [33, 12], [39, 30], [24, 40]] },
} as const
const SIGNS = WESTERN_ZODIAC.map(sign => ({ ...sign, ...CONSTELLATIONS[sign.id] }))
const STAR_POSITIONS = [
  [12, 8], [47, 6], [81, 11], [22, 20], [63, 17], [91, 25], [6, 38], [51, 31], [74, 38], [16, 48],
  [38, 46], [87, 52], [8, 63], [27, 71], [55, 64], [72, 75], [95, 69], [17, 88], [45, 83], [84, 91],
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

function ReadingIntro({ title, detail, illustration }: {
  title: string
  detail: string
  illustration?: { series: 'western-zodiac' | 'chinese-zodiac'; id: string }
}) {
  return <header className={styles.readingIntro}>
    <div><h2>{title}</h2><p>{detail}</p></div>
    {illustration ? <img src={fortuneArtwork(illustration.series, illustration.id)} alt=""
      width={640} height={960} loading="lazy" decoding="async" /> : null}
  </header>
}

const TAROT_STEPS = ['洗牌', '切牌', '选牌', '解读'] as const

function TarotProgress({ phase }: { phase: TarotRound['phase'] }) {
  const active = phase === 'cutting' ? 1 : phase === 'choosing' ? 2 : phase === 'revealed' ? 3 : 0
  return <ol className={styles.roundProgress} aria-label="本轮进度">
    {TAROT_STEPS.map((step, index) => <li key={step} aria-current={active === index ? 'step' : undefined}
      data-done={index < active ? '' : undefined}>{step}</li>)}
  </ol>
}

function TarotBack({ back }: { back: TarotBackId }) {
  return <span className={styles.tarotBackArt} aria-hidden="true">
    <span>✦</span>
    <img key={back} src={fortuneArtwork('tarot', `back-${back}`)} alt="" draggable={false}
      onError={event => { event.currentTarget.hidden = true }} />
  </span>
}

function TarotRoundDeck({ back, shuffling }: { back: TarotBackId; shuffling?: boolean }) {
  return <div className={`${styles.deckStack} ${shuffling ? styles.shuffleDeck : ''}`} aria-hidden="true">
    {[0, 1, 2].map(card => <span key={card} className={styles.deckCardBack}><TarotBack back={back} /></span>)}
  </div>
}

const SPREADS = {
  daily: { title: '每日一张', places: ['今日灵感'] },
  single: { title: '单张', places: ['当前问题'] },
  three: { title: '三张', places: ['过去', '现在', '下一步'] },
  cross: { title: '十字 · 10 张', places: ['现状', '阻力', '根源', '过往', '目标', '下一步', '自身态度', '外部环境', '期待与担忧', '可尝试的方向'] },
} as const
type TarotSpread = keyof typeof SPREADS
const SPREAD_CHOICES = ['single', 'three', 'cross', 'daily'] as const
const CUTS = [['前段切牌', 19], ['中段切牌', 39], ['后段切牌', 58]] as const

function dailyCard(date: Date) {
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000
  const seed = Math.imul(day ^ (day >>> 7), 0x45d9f3b) >>> 0
  return { card: DECK[seed % DECK.length], reversed: (seed >>> 17) % 2 === 1 }
}

type DrawnCard = { card: ReadingCard; reversed: boolean }
type TarotRound =
  | { phase: 'ready' | 'shuffling' }
  | { phase: 'cutting'; deck: ReadingCard[] }
  | { phase: 'choosing'; hand: DrawnCard[]; picked: number[] }
  | { phase: 'revealed'; cards: DrawnCard[]; date?: string }

function focusReadingStep(target: HTMLElement | null) {
  if (!target) return
  target.focus({ preventScroll: true })
  const scroller = target.closest('[data-fortune-scroll],[data-app-page]')
  if (!scroller) return
  const surface = scroller.getBoundingClientRect()
  const header = scroller.querySelector('[data-fortune-navigation]')?.getBoundingClientRect()
  const bounds = target.getBoundingClientRect()
  const top = Math.max(surface.top, header?.bottom ?? surface.top) + 8
  if (bounds.top < top || bounds.bottom > surface.bottom - 92) {
    target.scrollIntoView({ block: 'center', behavior: 'instant' })
  }
}

export function TarotReflection({ enabled, onToggle, active = true }: ReadingProps & { active?: boolean }) {
  const reduceMotion = useUiMotion()
  const [spread, setSpread] = useState<TarotSpread>('single')
  const [round, setRound] = useState<TarotRound>({ phase: 'ready' })
  const [aiOpen, setAiOpen] = useState(false)
  const timer = useRef<number | null>(null)
  const cutButton = useRef<HTMLButtonElement>(null)
  const firstCard = useRef<HTMLButtonElement>(null)
  const resultTitle = useRef<HTMLHeadingElement>(null)
  const previousPhase = useRef(round.phase)
  const { places } = SPREADS[spread]
  const count = places.length
  const back: TarotBackId = spread === 'daily' || spread === 'cross' ? 'moon' : spread === 'three' ? 'rest' : 'origin'
  const reading = round.phase === 'revealed' ? round.cards.map(({ card, reversed }, index) =>
    `${places[index]}：${card.name}（${reversed ? '逆位视角' : '正位视角'}）`).join('；') : null
  const owner = useReadingOwner()
  const [saving, setSaving] = useState(false)

  async function saveSpread() {
    if (saving || round.phase !== 'revealed') return
    setSaving(true)
    const body = [`牌阵：${SPREADS[spread].title}`, ...round.cards.map(({ card, reversed }, index) =>
      `${places[index]}：${card.name}（${card.id}）· ${reversed ? '逆位' : '正位'}\n${reversed ? card.reversedNote : card.note}`)].join('\n')
    try { await saveReadingToJournal(owner, `塔罗 · ${SPREADS[spread].title}`, body) } catch { toast.err('保存失败，请重试。') } finally { setSaving(false) }
  }

  function stopShuffle() {
    if (timer.current === null) return
    window.clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => stopShuffle, [])
  useEffect(() => {
    if (!enabled) {
      stopShuffle()
      setRound({ phase: 'ready' })
      setAiOpen(false)
    }
  }, [enabled])
  useEffect(() => {
    if (round.phase === previousPhase.current) return
    previousPhase.current = round.phase
    if (!active) return
    if (round.phase === 'cutting') focusReadingStep(cutButton.current)
    if (round.phase === 'choosing') focusReadingStep(firstCard.current)
    if (round.phase === 'revealed') focusReadingStep(resultTitle.current)
  }, [active, round.phase])

  function selectSpread(next: TarotSpread) {
    if (next === spread) return
    stopShuffle()
    setSpread(next)
    setRound({ phase: 'ready' })
  }

  function startRound() {
    if (timer.current !== null) return
    if (spread === 'daily') {
      const date = new Date()
      setRound({ phase: 'revealed', cards: [dailyCard(date)], date: date.toLocaleDateString('zh-CN') })
      return
    }
    const deck = shuffle(DECK)
    const showCut = () => {
      timer.current = null
      setRound({ phase: 'cutting', deck })
    }
    if (reduceMotion) showCut()
    else {
      setRound({ phase: 'shuffling' })
      timer.current = window.setTimeout(showCut, 560)
    }
  }

  function cutDeck(offset: number) {
    if (round.phase !== 'cutting') return
    const { deck } = round
    const hand = [...deck.slice(offset), ...deck.slice(0, offset)].slice(0, count === 10 ? 12 : 6)
      .map(card => ({ card, reversed: randomIndex(2) === 1 }))
    setRound({ phase: 'choosing', hand, picked: [] })
  }

  function pickCard(index: number) {
    setRound(current => {
      if (current.phase !== 'choosing') return current
      const { picked } = current
      if (picked.includes(index)) return { ...current, picked: picked.filter(card => card !== index) }
      if (picked.length === count) return current
      return { ...current, picked: [...picked, index] }
    })
  }

  function revealCards(automatic: boolean) {
    setRound(current => {
      if (current.phase !== 'choosing') return current
      const { hand, picked } = current
      if (!automatic && picked.length !== count) return current
      const remaining = hand.map((_, index) => index).filter(index => !picked.includes(index))
      const revealed = [...picked, ...remaining].slice(0, count)
      return { phase: 'revealed', cards: revealed.map(index => hand[index]) }
    })
  }

  return <div className={styles.controls}>
    {onToggle ? <ToggleButton enabled={enabled} onToggle={onToggle} /> : null}
    {enabled ? <div className={`${styles.tool} ${styles.tarotTool}`}>
      <ReadingIntro title="塔罗牌桌" detail="选一个牌阵，用牌面提示梳理你的想法。" />
      <div className={styles.spreadPicker} role="group" aria-label="选择塔罗牌阵">
        {SPREAD_CHOICES.map(choice => <button type="button" key={choice} aria-pressed={spread === choice}
          onClick={() => selectSpread(choice)}>{SPREADS[choice].title}</button>)}
      </div>

      {spread === 'daily' ? <p className={styles.disclaimer}>同一天会翻开同一张牌。</p> : <TarotProgress phase={round.phase} />}

      {round.phase === 'ready' || round.phase === 'shuffling' ? <>
        <div className={`${styles.drawStage} ${round.phase === 'shuffling' ? styles.shuffleStage : ''}`} aria-busy={round.phase === 'shuffling'}>
          <TarotRoundDeck back={back} shuffling={round.phase === 'shuffling'} />
        </div>
        <button type="button" className={styles.draw} onClick={startRound} aria-disabled={round.phase === 'shuffling'}>
          {round.phase === 'shuffling' ? '正在洗牌…' : spread === 'daily' ? '翻开今日牌' : '洗牌'}
        </button>
        <span className={styles.visuallyHidden} role="status">{round.phase === 'shuffling' ? '正在洗牌' : ''}</span>
      </> : null}

      {round.phase === 'cutting' ? <>
        <div className={styles.drawStage}><TarotRoundDeck back={back} /></div>
        <p className={styles.handStatus} role="status">洗牌完成。选一个切点，或直接选牌。</p>
        <div className={styles.roundActions} role="group" aria-label="切牌">
          {CUTS.map(([label, offset], index) => <button type="button" key={offset}
            ref={index === 0 ? cutButton : undefined} className={styles.secondary} onClick={() => cutDeck(offset)}>{label}</button>)}
        </div>
        <button type="button" className={styles.draw} onClick={() => cutDeck(0)}>跳过切牌</button>
      </> : null}

      {round.phase === 'choosing' ? <>
        <div className={styles.handStatus} role="status">
          <strong>已选 {round.picked.length} / {count} 张</strong>
          <span>{round.picked.length === count ? '可以翻牌，再点已选牌可取消。' : `选一张放到「${places[round.picked.length]}」`}</span>
        </div>
        <div className={styles.tarotHand} role="group" aria-label="待选塔罗牌">
          {round.hand.map((_, index) => {
            const position = round.picked.indexOf(index)
            return <button key={index} type="button" ref={index === 0 ? firstCard : undefined}
              aria-label={`第 ${index + 1} 张牌${position >= 0 ? `，${places[position]}` : ''}`}
              aria-pressed={position >= 0} aria-disabled={position < 0 && round.picked.length === count}
              onClick={() => pickCard(index)}>
              <TarotBack back={back} />
              {position >= 0 ? <span className={styles.handIndex} aria-hidden="true">{position + 1}</span> : null}
            </button>
          })}
        </div>
        <button type="button" className={styles.draw} disabled={round.picked.length !== count}
          onClick={() => revealCards(false)}>翻开已选的牌</button>
        <div className={styles.roundActions}>
          {round.picked.length < count ? <button type="button" className={styles.secondary} onClick={() => revealCards(true)}>
            {round.picked.length ? '补齐并翻牌' : '自动选牌并翻开'}
          </button> : null}
          <button type="button" className={styles.secondary} onClick={startRound}>重新洗牌</button>
        </div>
      </> : null}

      {round.phase === 'revealed' ? <>
        <h2 ref={resultTitle} tabIndex={-1} className={styles.roundTitle}>本次牌面</h2>
        {round.date ? <p className={styles.handStatus}>{round.date} · 每日一张</p> : null}
        <div className={styles.drawStage}>
          <div className={`${styles.readingCards} ${count === 10 ? styles.crossCards : count === 3 ? styles.threeCards : ''}`}>
            {round.cards.map(({ card, reversed }, index) => <div className={styles.readingSlot} key={card.id} data-position={index + 1}>
              <div className={styles.cardStage}>
                <div className={`${styles.tarotCard} ${reversed ? styles.reversedCard : ''}`}>
                  <TarotCardFace card={card} reversed={reversed} />
                </div>
              </div>
              <span className={styles.cardPosition}>{count === 10 ? index + 1 : places[index]}</span>
            </div>)}
          </div>
        </div>
        <ol className={styles.readingNotes} aria-label="逐张牌的提示">
          {round.cards.map(({ card, reversed }, index) => <li className={styles.cardMeaning} key={card.id}>
            <span>{count === 10 ? `${index + 1}. ` : ''}{places[index]} · {reversed ? '逆位视角' : '正位视角'}</span>
            <b>{card.name}</b>
            <p>{reversed ? card.reversedNote : card.note}</p>
          </li>)}
        </ol>
        <div className={styles.roundActions}>
          <button type="button" className={styles.secondary} onClick={saveSpread} disabled={saving}>{saving ? '保存中…' : '存这次牌阵'}</button>
        </div>
        <button type="button" className={styles.draw} onClick={startRound}>{spread === 'daily' ? '重新查看今日牌' : '再玩一次'}</button>
      </> : null}

      <details className={styles.tarotAi} onToggle={event => setAiOpen(event.currentTarget.open)}>
        <summary>用 AI 了解塔罗或解读牌面</summary>
        <TarotAiPanel active={active && aiOpen} reading={reading} />
      </details>
      <p className={styles.localNote}>抽牌在本机完成，默认不保存；点「存这次牌阵」才写入当天手账。</p>
    </div> : null}
  </div>
}

function TarotCardFace({ card, reversed }: { card: ReadingCard; reversed: boolean }) {
  const symbolicFace = <div className={styles.cardFrame}>
    <span className={styles.cardRoman}>{card.family}</span>
    <span className={styles.cardGlyph} aria-hidden="true">{card.symbol}</span>
    <span className={styles.cardName}>{card.name}</span>
    <span className={styles.cardStars} aria-hidden="true">✦　·　✧</span>
  </div>
  return <FortuneIllustration series="tarot" id={card.id} alt={`哦狐塔罗「${card.name}」牌面`}
    previewTitle={card.name} reversed={reversed} fallback={symbolicFace} />
}

export function TarotArtworkGallery() {
  const [open, setOpen] = useState(false)
  const [group, setGroup] = useState<TarotGroup>('major')
  return <details className={styles.artGallery} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>浏览 78 张塔罗牌</summary>
    {open ? <>
      <div className={styles.galleryFilters} role="group" aria-label="筛选塔罗牌组">
        {TAROT_GROUPS.map(([id, title]) => <button key={id} type="button" aria-pressed={group === id}
          onClick={() => setGroup(id)}>{title}</button>)}
      </div>
      <div className={styles.artGalleryGrid}>
        {TAROT_CARDS.filter(card => card.group === group).map(card => <figure key={card.id}>
          <FortuneIllustration series="tarot" id={card.id} alt={`哦狐塔罗「${card.name}」牌面`}
            previewTitle={card.name} lazy />
          <figcaption><b>{card.name}</b><span lang="en">{card.english}</span></figcaption>
        </figure>)}
      </div>
    </> : null}
  </details>
}

function constellationPath(points: readonly (readonly [number, number])[]) {
  return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')
}

export function ZodiacReflection({ enabled, active }: { enabled: boolean; active: boolean }) {
  const [selected, setSelected] = useState<number | null>(null)
  const picker = useRef<HTMLDivElement>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const activeSign = selected === null ? null : SIGNS[selected]
  useEffect(() => {
    if (!enabled) {
      setSelected(null)
      setAiOpen(false)
    }
  }, [enabled])

  function reset() {
    focusReadingStep(picker.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? null)
    setSelected(null)
  }

  return <div className={styles.controls}>
    {enabled ? <div className={`${styles.tool} ${styles.zodiacTool}`}>
      <ReadingIntro title="点亮你的星座" detail="点亮一组星点，翻开星座牌，看看今天可以做的一件小事。" illustration={selected === null ? { series: 'western-zodiac', id: 'scorpio' } : undefined} />
      <div className={styles.skyMap}>
        <div className={styles.skyDust} aria-hidden="true">{STAR_POSITIONS.map(([x, y], index) => <i key={index} style={{ left: `${x}%`, top: `${y}%` }} />)}</div>
        <div ref={picker} className={styles.starPicker} role="group" aria-label="选择星座星图">
          {SIGNS.map((sign, index) => {
            const active = selected === index
            return <button type="button" key={sign.id} aria-label={`选择${sign.name}，日期范围${sign.date}`}
              aria-pressed={active} onClick={() => setSelected(index)}>
              <svg viewBox="5 5 44 40" aria-hidden="true">
                {active ? <path className={styles.starLines} pathLength="1" d={constellationPath(sign.points)} /> : null}
                {sign.points.map(([x, y], point) => <circle key={point} className={styles.constellationStar} cx={x} cy={y} r={active ? 2.4 : 1.9} />)}
              </svg>
              <span>{sign.name}</span>
            </button>
          })}
        </div>
      </div>
      {activeSign && selected !== null ? <FortuneResult
        series="western-zodiac" id={activeSign.id} name={activeSign.name} english={activeSign.english}
        symbol={activeSign.glyph} detail={activeSign.date} prompt={dailyFortunePrompt(selected)}
        onReset={reset}
      /> : null}
      <details className={styles.tarotAi} onToggle={event => setAiOpen(event.currentTarget.open)}>
        <summary>问 AI 星座知识</summary>
        <ZodiacAiPanel active={active && aiOpen} />
      </details>
    </div> : null}
  </div>
}

function FortuneResult({ series, id, name, english, symbol, detail, prompt, onReset }: {
  series: 'western-zodiac' | 'chinese-zodiac'
  id: string
  name: string
  english: string
  symbol?: string
  detail?: string
  prompt: string
  onReset: () => void
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { focusReadingStep(heading.current) }, [id])
  const owner = useReadingOwner()
  const [saving, setSaving] = useState(false)

  async function paste() {
    if (saving) return
    setSaving(true)
    const label = series === 'western-zodiac' ? '星座' : '生肖'
    const body = [`${label}：${name}${english ? `（${english}）` : ''}`, detail ? `日期范围：${detail}` : '', `今日行动：${prompt}`].filter(Boolean).join('\n')
    try { await saveReadingToJournal(owner, `${label} · ${name}`, body) } catch { toast.err('保存失败，请重试。') } finally { setSaving(false) }
  }

  return <section className={styles.fortuneResult} aria-label={`${name}的卡牌解读`}>
    <FortuneIllustration series={series} id={id} alt={`哦狐奶白狐的${name}主题插画`} previewTitle={name} />
    <div className={styles.fortuneCopy}>
      <div>
        <h2 ref={heading} tabIndex={-1}>{symbol && <span aria-hidden="true">{symbol} </span>}{name}</h2>
        <span lang="en">{english}</span>
        {detail ? <span>{detail}</span> : null}
      </div>
      <p><b>今日行动</b>{prompt}</p>
      <button type="button" className={styles.resetSign} onClick={paste} disabled={saving}>{saving ? '保存中…' : '贴进今天'}</button>
      <button type="button" className={styles.resetSign} onClick={onReset}>
        {series === 'western-zodiac' ? '换个星座' : '换个生肖'}
      </button>
    </div>
  </section>
}

export function ChineseZodiacReading() {
  const [selected, setSelected] = useState<number | null>(null)
  const picker = useRef<HTMLDivElement>(null)
  const active = selected === null ? null : CHINESE_ZODIAC[selected]

  function reset() {
    focusReadingStep(picker.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? null)
    setSelected(null)
  }

  return <div className={`${styles.tool} ${styles.zodiacTool}`}>
    <ReadingIntro title="挑一张生肖牌" detail="选一个喜欢的生肖，翻开插画和今日提示。无需填写出生年份。" illustration={selected === null ? { series: 'chinese-zodiac', id: 'dragon' } : undefined} />
    <div ref={picker} className={styles.animalPicker} role="group" aria-label="选择生肖">
      {CHINESE_ZODIAC.map(({ id, name }, index) => <button
        key={id} type="button" aria-pressed={selected === index}
        onClick={() => setSelected(index)}>{name}</button>)}
    </div>
    {active ? <FortuneResult series="chinese-zodiac" id={active.id} name={active.name} english={active.english}
      prompt={dailyFortunePrompt(active.number)} onReset={reset} /> : null}
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
