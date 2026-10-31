import { useMemo, useState } from 'react'
import { DialogLayer } from '../ui/DialogLayer'
import { MeetPersonalityPortrait } from './MeetPersonalityPortrait'
import { MEET_PERSONALITIES, type MeetPersonality, type MeetPersonalityPreference } from '../../lib/meet-personality'
import styles from './meet-personality.module.css'

type Axis = 'EI' | 'SN' | 'TF' | 'JP'
type Question = { axis: Axis; prompt: string; left: string; right: string; leftCode: string; rightCode: string }
const QUESTIONS: Question[] = [
  { axis: 'EI', prompt: '第一次参加同学组织的活动，你通常会……', left: '主动打招呼，很快加入聊天', right: '先观察一会儿，熟悉后再加入', leftCode: 'E', rightCode: 'I' },
  { axis: 'EI', prompt: '小组活动结束后，哪种感觉更像你？', left: '和大家一起让我更有精神', right: '玩得开心，但之后想留点独处时间', leftCode: 'E', rightCode: 'I' },
  { axis: 'EI', prompt: '碰到一个有趣的新点子，你更可能……', left: '先说出来，边聊边补充', right: '先自己想清楚，再分享给熟悉的人', leftCode: 'E', rightCode: 'I' },
  { axis: 'SN', prompt: '一起完成任务时，你更喜欢……', left: '明确步骤、现成例子和具体安排', right: '先看看整体方向，再尝试新办法', leftCode: 'S', rightCode: 'N' },
  { axis: 'SN', prompt: '听别人讲一段经历，你通常先注意……', left: '发生了什么、细节和实际结果', right: '背后的意思、联系和可能性', leftCode: 'S', rightCode: 'N' },
  { axis: 'SN', prompt: '周末突然空出半天，你更想……', left: '做一件熟悉、确定会喜欢的事', right: '探索没试过的地方或活动', leftCode: 'S', rightCode: 'N' },
  { axis: 'TF', prompt: '小组意见不同时，你通常先……', left: '把事实和可行方案摆出来比较', right: '听听每个人在意什么，再找共识', leftCode: 'T', rightCode: 'F' },
  { axis: 'TF', prompt: '朋友请你评价一个作品，你更倾向于……', left: '坦率指出问题，帮助它变得更好', right: '先说喜欢的部分，再温和提出建议', leftCode: 'T', rightCode: 'F' },
  { axis: 'TF', prompt: '安排集体活动时，你更看重……', left: '规则一致、效率和结果公平', right: '每个人参与时是否舒服、被照顾到', leftCode: 'T', rightCode: 'F' },
  { axis: 'JP', prompt: '面对周末活动，你通常更喜欢……', left: '提前定好时间地点，心里有安排', right: '先留个大概，按当天状态灵活调整', leftCode: 'J', rightCode: 'P' },
  { axis: 'JP', prompt: '手头有几件待办时，你会……', left: '列出顺序，完成一件再做下一件', right: '看当下兴趣和进度，在几件事间切换', leftCode: 'J', rightCode: 'P' },
  { axis: 'JP', prompt: '活动临时有新变化，你通常会……', left: '先确认新方案，再安心继续', right: '觉得变化也有意思，边走边决定', leftCode: 'J', rightCode: 'P' },
]

function calculate(answers: Record<number, 'left' | 'right'>): { type: MeetPersonality | null; letters: string[]; ties: Axis[] } {
  const pairs: Array<[Axis, string, string]> = [['EI', 'E', 'I'], ['SN', 'S', 'N'], ['TF', 'T', 'F'], ['JP', 'J', 'P']]
  const letters: string[] = [], ties: Axis[] = []
  for (const [axis, left, right] of pairs) {
    let a = 0, b = 0
    QUESTIONS.forEach((question, index) => {
      if (question.axis !== axis || !answers[index]) return
      if (answers[index] === 'left') question.leftCode === left ? a++ : b++
      else question.rightCode === right ? b++ : a++
    })
    if (a === b) ties.push(axis)
    letters.push(a >= b ? left : right)
  }
  return { type: ties.length ? null : letters.join('') as MeetPersonality, letters, ties }
}

function PersonalityQuiz({ onClose, onApply }: { onClose: () => void; onApply: (value: MeetPersonality) => void }) {
  const [answers, setAnswers] = useState<Record<number, 'left' | 'right'>>({})
  const [index, setIndex] = useState(0)
  const [tieChoice, setTieChoice] = useState<Partial<Record<Axis, string>>>({})
  const [review, setReview] = useState(false)
  const result = useMemo(() => calculate(answers), [answers])
  const question = QUESTIONS[index]
  const axes: Axis[] = ['EI', 'SN', 'TF', 'JP']
  const resolvedLetters = result.letters.map((letter, position) => result.ties.includes(axes[position]) ? tieChoice[axes[position]] || '' : letter)
  const resolved = resolvedLetters.every(Boolean) ? resolvedLetters.join('') as MeetPersonality : null
  function finish() { if (resolved) { onApply(resolved); onClose() } }
  return <DialogLayer title="阿狐狐格小测验" onClose={onClose} full className={styles.quizDialog}>
    <div className={styles.quiz}>
      <header className={styles.quizHead}><div><span>OHU · PERSONALITY</span><h2>{review ? '看看你的结果' : '校园情境小测验'}</h2></div><button type="button" onClick={onClose}>关闭</button></header>
      <p className={styles.quizIntro}>原创趣味题，仅供自我了解和搭子偏好参考，不是心理诊断或科学测评；可以退出，也可以在结果里手动修改。</p>
      {!review ? <>
        <div className={styles.quizProgress}><span style={{ width: `${(Object.keys(answers).length / QUESTIONS.length) * 100}%` }} /></div>
        <p className={styles.questionCount}>第 {index + 1} / {QUESTIONS.length} 题</p>
        <h3 className={styles.question}>{question.prompt}</h3>
        <div className={styles.answerList}>
          {(['left', 'right'] as const).map((side) => <button type="button" key={side} aria-pressed={answers[index] === side} onClick={() => setAnswers(current => ({ ...current, [index]: side }))}>{side === 'left' ? question.left : question.right}</button>)}
        </div>
        <div className={styles.quizActions}><button type="button" disabled={index === 0} onClick={() => setIndex(value => value - 1)}>上一题</button>{index < QUESTIONS.length - 1 ? <button type="button" className={styles.quizPrimary} disabled={!answers[index]} onClick={() => setIndex(value => value + 1)}>下一题</button> : <button type="button" className={styles.quizPrimary} disabled={Object.keys(answers).length !== QUESTIONS.length} onClick={() => setReview(true)}>查看结果</button>}</div>
      </> : <>
        {result.ties.length ? <section className={styles.tiePickers}><strong>有几个维度比较平衡，按直觉选一边</strong>{result.ties.map(axis => <label key={axis}>{axis === 'EI' ? '更喜欢的社交节奏' : axis === 'SN' ? '更习惯的信息方式' : axis === 'TF' ? '更常用的决策方式' : '更自然的安排方式'}<select value={tieChoice[axis] || ''} onChange={event => setTieChoice(current => ({ ...current, [axis]: event.target.value }))}><option value="">请选择</option>{(axis.split('') as string[]).map(letter => <option key={letter} value={letter}>{letter} · {letter === 'E' ? '外向交流' : letter === 'I' ? '安静充电' : letter === 'S' ? '关注具体' : letter === 'N' ? '关注可能' : letter === 'T' ? '理性分析' : letter === 'F' ? '感受共情' : letter === 'J' ? '计划有序' : '灵活探索'}</option>)}</select></label>)}</section> : null}
        {resolved ? <div className={styles.resultCard}><MeetPersonalityPortrait type={resolved} size="large" /><span>{resolved}</span><h3>{MEET_PERSONALITIES.find(item => item.code === resolved)?.name}</h3><p>{MEET_PERSONALITIES.find(item => item.code === resolved)?.note}</p></div> : <p className={styles.tieHint}>选好平衡维度后，就能查看这次的趣味结果。</p>}
        <div className={styles.quizActions}><button type="button" onClick={() => setReview(false)}>修改答案</button><button type="button" className={styles.quizPrimary} disabled={!resolved} onClick={finish}>确认并使用</button></div>
      </>}
      <button type="button" className={styles.quizSkip} onClick={onClose}>跳过测验</button>
    </div>
  </DialogLayer>
}

function PersonalityGallery({ value, allowQuiz, onClose, onChange, onQuiz }: { value: MeetPersonalityPreference; allowQuiz: boolean; onClose: () => void; onChange: (value: MeetPersonalityPreference) => void; onQuiz: () => void }) {
  return <DialogLayer title="16 款阿狐狐格" onClose={onClose} full className={styles.quizDialog}>
    <div className={styles.gallery}>
      <header className={styles.quizHead}><div><span>OHU · FOX TYPES</span><h2>选一只合拍阿狐</h2></div><button type="button" onClick={onClose}>关闭</button></header>
      <p className={styles.quizIntro}>{allowQuiz ? '选你觉得像自己的狐格，也可以先做趣味小测；随时能修改或清除。' : '选择希望优先遇见的搭子类型；不设偏好时仍会显示其他合适活动。'}</p>
      <div className={styles.galleryGrid}>
        {MEET_PERSONALITIES.map(item => <button type="button" key={item.code} aria-pressed={value === item.code} onClick={() => { onChange(item.code); onClose() }}>
          <MeetPersonalityPortrait type={item.code} size="medium" /><strong>{item.code}</strong><span>{item.name}</span>
        </button>)}
      </div>
      <div className={styles.galleryActions}>
        <button type="button" onClick={() => { onChange(null); onClose() }}>{allowQuiz ? '暂不填写' : '不限狐格'}</button>
        {allowQuiz ? <button type="button" className={styles.quizPrimary} onClick={onQuiz}>去做趣味小测</button> : null}
      </div>
    </div>
  </DialogLayer>
}

export function MeetPersonalityPicker({ label, value, onChange, allowQuiz = false }: { label: string; value: MeetPersonalityPreference; onChange: (value: MeetPersonalityPreference) => void; allowQuiz?: boolean }) {
  const [quizOpen, setQuizOpen] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const selected = MEET_PERSONALITIES.find(item => item.code === value)
  return <div className={styles.picker}>
    <div className={styles.pickerSelect}><span>{label}</span><button type="button" className={styles.selectedType} onClick={() => setGalleryOpen(true)}>{selected ? <MeetPersonalityPortrait type={value!} size="small" /> : <span className={styles.typePlaceholder} aria-hidden="true">狐</span>}<span>{selected ? `${selected.code} · ${selected.name}` : allowQuiz ? '暂不填写' : '不限'}</span><span aria-hidden="true">⌄</span></button></div>
    {allowQuiz ? <div className={styles.pickerActions}>{selected ? <small>{selected.note}</small> : <small>可直接选型，也可以做题后再确认</small>}<button type="button" onClick={() => setQuizOpen(true)}>{value ? '重新测一下' : '做趣味小测'}</button></div> : null}
    {galleryOpen ? <PersonalityGallery value={value} allowQuiz={allowQuiz} onClose={() => setGalleryOpen(false)} onChange={onChange} onQuiz={() => { setGalleryOpen(false); setQuizOpen(true) }} /> : null}
    {quizOpen ? <PersonalityQuiz onClose={() => setQuizOpen(false)} onApply={onChange} /> : null}
  </div>
}
