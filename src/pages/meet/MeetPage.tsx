import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { MeetAvailabilityPicker } from '../../components/meet/MeetAvailabilityPicker'
import { MeetShareCode } from '../../components/meet/MeetShareCode'
import { MeetPersonalityPicker } from '../../components/meet/MeetPersonalityPicker'
import { FoxSheetPose } from '../../components/fox/FoxSheetPose'
import { useAuth } from '../../lib/auth'
import { buildMeetShareUrl } from '../../lib/meet-share-url'
import { buildMeetIcs } from '../../lib/meet-calendar'
import { downloadIcs } from '../../lib/schedule-cache'
import { captureQbankSession } from '../../lib/qbank'
import { useQbankRevision } from '../../lib/useQbankRevision'
import { useUiVariant } from '../../lib/ui-variant'
import {
  closeMeet, confirmMeet, createMeet, discoverMeets, getMeet, leaveMeet, listMyMeets, readMeetReply,
  recommendedMeetSlots, respondMeet, suggestMeetTimesFromSchedule,
  type MeetActivity, type MeetRoom, type MeetRoomPreview, type MeetVibe,
} from '../../lib/meet-api'
import styles from './MeetPage.module.css'
import { meetPersonalityName, meetPersonalitySimilarity, readMeetPersonalityProfile, saveMeetPersonalityProfile, type MeetPersonality } from '../../lib/meet-personality'

const ACTIVITIES: Array<{ id: MeetActivity; label: string; icon: string }> = [
  { id: 'study', label: '一起自习', icon: '✎' },
  { id: 'billiards', label: '打台球', icon: '●' },
  { id: 'mahjong', label: '打麻将', icon: '🀄' },
  { id: 'badminton', label: '打羽毛球', icon: '⌁' },
  { id: 'meal', label: '一起吃饭', icon: '♨' },
  { id: 'other', label: '其他活动', icon: '✦' },
]
const VIBES: Array<{ id: MeetVibe; label: string; desc: string }> = [
  { id: 'any', label: '不限', desc: '哪种都可以' },
  { id: 'E', label: 'E 人', desc: '热闹自来熟' },
  { id: 'I', label: 'I 人', desc: '安静慢热型' },
]
const activityName = (id: MeetActivity) => ACTIVITIES.find((item) => item.id === id)?.label || '活动'
const vibeName = (id: MeetVibe) => VIBES.find((item) => item.id === id)?.label || '不限'
const todayChina = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const messageOf = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请稍后重试'
const slotLabel = (start: string, end: string) => {
  const date = /^\d{4}-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(start)
  const endTime = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/.exec(end)
  return date && endTime ? `${Number(date[1])} 月 ${Number(date[2])} 日 ${date[3]}–${endTime[1]}` : `${start}–${end}`
}

/** A meeting needs consecutive chosen half-hours, not just the right total. */
function hasContinuousTime(slots: string[], duration: number): boolean {
  const selected = new Set(slots)
  const pieces = Math.ceil(duration / 30)
  return slots.some((slot) => {
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(slot)
    if (!match) return false
    const minute = Number(match[2]) * 60 + Number(match[3])
    return Array.from({ length: pieces }, (_, index) => {
      const value = minute + index * 30
      return value < 22 * 60 && selected.has(`${match[1]}T${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`)
    }).every(Boolean)
  })
}

function ActivitySelect({ value, onChange }: { value: MeetActivity; onChange: (value: MeetActivity) => void }) {
  return <div className={styles.activityGrid} role="group" aria-label="选择活动项目">
    {ACTIVITIES.map((item) => <button key={item.id} type="button" className={styles.activity} aria-pressed={value === item.id} onClick={() => onChange(item.id)}>
      <span aria-hidden="true">{item.icon}</span><strong>{item.label}</strong>
    </button>)}
  </div>
}

function VibeSelect({ value, onChange, hint }: { value: MeetVibe; onChange: (value: MeetVibe) => void; hint?: string }) {
  return <>
    <div className={styles.chips} role="group" aria-label="社交偏好">
      {VIBES.map((item) => <button key={item.id} type="button" data-vibe={item.id} aria-pressed={value === item.id} onClick={() => onChange(item.id)}>
        <strong>{item.label}</strong><small>{item.desc}</small>
      </button>)}
    </div>
    {hint ? <p className={styles.hint}>{hint}</p> : null}
  </>
}

function RoomCard({ room }: { room: MeetRoomPreview }) {
  return <Link to={`/meet/${encodeURIComponent(room.code)}`} className={styles.roomCard}>
    <span className={styles.roomIcon} aria-hidden="true">{ACTIVITIES.find((item) => item.id === room.activity)?.icon || '✦'}</span>
    <span className={styles.roomCopy}><strong>{room.title}</strong><small>{activityName(room.activity)} · {room.campus || '校园活动'} · {room.startsOn}</small></span>
    <span className={styles.roomCount}>{room.personalityMatch ? <small className={styles.matchBadge}>狐格偏好匹配 · </small> : null}{room.participantCount}/{room.targetSize} 人 <span aria-hidden="true">›</span></span>
  </Link>
}

function MeetHome() {
  const auth = useAuth()
  const navigate = useNavigate()
  const handdrawn = useUiVariant() === 'handdrawn'
  const [mode, setMode] = useState<'find' | 'create' | 'mine'>('find')
  const [activity, setActivity] = useState<MeetActivity>('study')
  const [title, setTitle] = useState('')
  const [name, setName] = useState('')
  const [campus, setCampus] = useState('江苏海洋大学')
  const [startsOn, setStartsOn] = useState(todayChina)
  const [days, setDays] = useState(7)
  const [duration, setDuration] = useState(60)
  const [targetSize, setTargetSize] = useState(4)
  const [visibility, setVisibility] = useState<'private' | 'public'>('public')
  const [vibe, setVibe] = useState<MeetVibe>('any')
  const [preferredVibe, setPreferredVibe] = useState<MeetVibe>('any')
  const [personalityType, setPersonalityType] = useState<MeetPersonality | null>(() => readMeetPersonalityProfile(auth.user?.uid || '').type)
  const [preferredPersonality, setPreferredPersonality] = useState<MeetPersonality | null>(() => readMeetPersonalityProfile(auth.user?.uid || '').preferred)
  const [slots, setSlots] = useState<string[]>([])
  const [results, setResults] = useState<MeetRoomPreview[] | null>(null)
  const [mine, setMine] = useState<MeetRoom[] | null>(null)
  const [mineOwner, setMineOwner] = useState('')
  const [mineError, setMineError] = useState('')
  const [mineLoadAttempt, setMineLoadAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)
  const inFlight = useRef(false)
  const previousUid = useRef(auth.user?.uid || '')
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { saveMeetPersonalityProfile(auth.user?.uid || '', { type: personalityType, preferred: preferredPersonality }) }, [auth.user?.uid, personalityType, preferredPersonality])
  useEffect(() => {
    const next = auth.user?.uid || ''
    if (previousUid.current && previousUid.current !== next) {
      setName(auth.user?.nickname || ''); setSlots([]); setResults(null); setMine(null); setError('')
    } else if (next) setName((value) => value || auth.user?.nickname || '')
    previousUid.current = next
  }, [auth.user?.uid, auth.user?.nickname])
  useEffect(() => {
    if (mode !== 'mine' || !auth.isSigned) return
    let current = true
    const owner = auth.user?.uid || ''
    setMine(null); setMineOwner(owner); setMineError(''); setError('')
    void listMyMeets().then((rows) => { if (current) setMine(rows) }).catch((failure) => { if (current) setMineError(messageOf(failure)) })
    return () => { current = false }
  }, [mode, auth.isSigned, auth.user?.uid, mineLoadAttempt])

  async function signed(reason: string) {
    if (auth.isSigned) return true
    return auth.ensureSignedIn(reason)
  }
  async function submitFind(event: React.FormEvent) {
    event.preventDefault()
    if (inFlight.current) return
    if (!campus.trim()) { setError('请填写学校名称，再找同校搭子。'); return }
    if (!hasContinuousTime(slots, duration)) { setError(`请至少选择连续 ${duration} 分钟的可参加时间。`); return }
    inFlight.current = true; setBusy(true); setError(''); setResults(null)
    try {
      if (!await signed('登录哦狐后，查找同校公开活动')) return
      const rooms = await discoverMeets({ campus: campus.trim(), activity, slots, preferredVibe, personalityType, preferredPersonality })
      if (alive.current) setResults(rooms)
    } catch (failure) { if (alive.current) setError(messageOf(failure)) }
    finally { inFlight.current = false; if (alive.current) setBusy(false) }
  }
  function fillFromSchedule() {
    try {
      const next = suggestMeetTimesFromSchedule(startsOn, days)
      setSlots(next); setResults(null)
      setError(next.length ? '' : '这段日期没有找到可参考的课表空档，请手动选择。')
    } catch (failure) { setError(messageOf(failure)) }
  }
  async function submitCreate(event: React.FormEvent) {
    event.preventDefault()
    if (inFlight.current) return
    if (!name.trim()) { setError('请填写怎么称呼你。'); return }
    if (!title.trim()) { setError('请填写活动名称。'); return }
    if (visibility === 'public' && !campus.trim()) { setError('公开找搭子时，请填写学校名称。'); return }
    if (!hasContinuousTime(slots, duration)) { setError(`请至少选择连续 ${duration} 分钟的可参加时间。`); return }
    inFlight.current = true; setBusy(true); setError('')
    try {
      if (!await signed('登录哦狐后，发起碰个空活动')) return
      const room = await createMeet({ title: title.trim(), startsOn, days, durationMinutes: duration, organizerName: name.trim(), activity, targetSize, campus: campus.trim(), visibility, vibe, personalityType, preferredPersonality, slots })
      if (alive.current) navigate(`/meet/${encodeURIComponent(room.code)}`)
    } catch (failure) { if (alive.current) setError(messageOf(failure)) }
    finally { inFlight.current = false; if (alive.current) setBusy(false) }
  }

  return <div className={styles.page}>
    <PageHeader title="碰个空" />
    <section className={styles.hero}>
      <div><span className={styles.eyebrow}>OHU · MEET UP</span><h2>有空，就一起！</h2><p>找同校搭子，约一场想做的事。</p></div>
      <FoxSheetPose pose={handdrawn ? 'reading' : 'waving'} className={styles.heroFox} />
    </section>
    <div className={styles.nav} role="group" aria-label="选择碰个空功能">
      {([['find', '找搭子'], ['create', '发起活动'], ['mine', '我的活动']] as const).map(([id, label]) =>
        <button type="button" key={id} disabled={busy} aria-pressed={mode === id} onClick={() => { setMode(id); setError(''); setResults(null) }}>{label}</button>)}
    </div>
    {mode === 'mine' ? <section className={styles.section}>
      <div className={styles.sectionTitle}><div><span>YOUR MEETUPS</span><h2>我的活动</h2></div></div>
      {!auth.isSigned ? <div className={styles.empty}>{handdrawn ? <img className={styles.emptyFox} src="/brand/handdrawn/fox-greeting.png" alt="" aria-hidden="true" /> : null}<p>登录后查看你发起和参与的活动。</p><button className={styles.primary} type="button" onClick={() => void signed('登录哦狐后查看我的活动')}>登录查看</button></div>
        : mineOwner !== (auth.user?.uid || '') ? <p className={styles.state} role="status">正在加载活动…</p>
          : mineError ? <div className={styles.empty}><p className={styles.error} role="alert">{mineError}</p><button className={styles.secondary} type="button" onClick={() => setMineLoadAttempt((value) => value + 1)}>重试加载</button></div>
          : mine === null ? <p className={styles.state} role="status">正在加载活动…</p>
          : mine.length ? <div className={styles.roomList}>{mine.map((room) => <RoomCard key={room.id} room={room} />)}</div>
            : <div className={styles.empty}>{handdrawn ? <img className={styles.emptyFox} src="/brand/handdrawn/fox-greeting.png" alt="" aria-hidden="true" /> : null}<p>还没有活动，找同学一起碰个空吧。</p><button className={styles.secondary} type="button" onClick={() => setMode('create')}>发起活动</button></div>}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </section> : <form className={styles.form} onSubmit={(event) => void (mode === 'find' ? submitFind(event) : submitCreate(event))}>
      <section className={styles.section}>
        <div className={styles.sectionTitle}><div><span>CHOOSE YOUR PLAN</span><h2>{mode === 'find' ? '想找什么搭子？' : '今天想做什么？'}</h2></div><small>选一个项目</small></div>
        <ActivitySelect value={activity} onChange={(value) => { setActivity(value); setResults(null) }} />
        {mode === 'create' ? <label className={styles.field}><span>活动名称</span><input maxLength={50} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`例如：${activityName(activity)} · 一起出发`} required /></label> : null}
        <label className={styles.field}><span>学校名称</span><input maxLength={60} value={campus} onChange={(event) => { setCampus(event.target.value); setResults(null); if (mode === 'find') setError('') }} placeholder="填写学校，用于寻找同校同学" required={mode === 'find' || visibility === 'public'} /></label>
        {mode === 'find' ? <><p className={styles.hint}>按你填写的学校筛选，学校信息尚未认证。</p><div className={styles.field}><span>希望搭子是什么风格 <small>选填</small></span><VibeSelect value={preferredVibe} onChange={(value) => { setPreferredVibe(value); setResults(null) }} hint="优先展示风格更合拍的活动；其他符合时间的活动仍会显示。" /></div><div className={styles.field}><MeetPersonalityPicker label="我的狐格类型（选填）" value={personalityType} onChange={value => { setPersonalityType(value); setResults(null) }} allowQuiz /><p className={styles.hint}>人格标签只用于软排序；不填写也能找搭子。发现列表不显示其他人的人格。</p></div><div className={styles.field}><MeetPersonalityPicker label="希望匹配的狐格类型" value={preferredPersonality} onChange={value => { setPreferredPersonality(value); setResults(null) }} /></div></> : null}
      </section>
      <section className={styles.section}>
        <div className={styles.sectionTitle}><div><span>MAKE SOME TIME</span><h2>什么时候有空？</h2></div></div>
        <div className={styles.fields2}>
          <label className={styles.field}><span>从哪天开始</span><input type="date" min={todayChina()} value={startsOn} onChange={(event) => { setStartsOn(event.target.value); setSlots([]); setResults(null) }} required /></label>
          <label className={styles.field}><span>查找天数</span><select value={days} onChange={(event) => { setDays(Number(event.target.value)); setSlots([]); setResults(null) }}><option value={1}>1 天</option><option value={3}>3 天</option><option value={7}>7 天</option></select></label>
        </div>
        <label className={styles.field}><span>活动大约需要多久</span><select value={duration} onChange={(event) => { setDuration(Number(event.target.value)); setResults(null) }}><option value={30}>30 分钟</option><option value={60}>1 小时</option><option value={90}>1.5 小时</option><option value={120}>2 小时</option></select></label>
        <button type="button" className={styles.scheduleHint} disabled={busy} onClick={fillFromSchedule}>✦ 从我的课表参考没课时间</button>
        <p className={styles.hint}>没课不等于有空，请手动调整并确认。</p>
        <MeetAvailabilityPicker startsOn={startsOn} days={days} value={slots} onChange={(next) => { setSlots(next); setResults(null) }} disabled={busy} />
      </section>
      {mode === 'create' ? <section className={styles.section}>
        <div className={styles.sectionTitle}><div><span>YOUR GROUP</span><h2>组建你的队伍</h2></div></div>
        <div className={styles.fields2}>
          <label className={styles.field}><span>怎么称呼你</span><input maxLength={24} value={name} onChange={(event) => setName(event.target.value)} placeholder="你的昵称" required /></label>
          <label className={styles.field}><span>需要几个人（含你）</span><select value={targetSize} onChange={(event) => setTargetSize(Number(event.target.value))}>{Array.from({ length: 19 }, (_, index) => index + 2).map((count) => <option key={count} value={count}>{count} 人</option>)}</select></label>
        </div>
        <div className={styles.field}><span>我的社交风格 <small>选填，仅作介绍</small></span><VibeSelect value={vibe} onChange={setVibe} hint="标记你是 E 人还是 I 人，让一起参加的同学更了解你。" /></div>
        <div className={styles.field}><MeetPersonalityPicker label="我的狐格类型（选填）" value={personalityType} onChange={setPersonalityType} allowQuiz /></div>
        <div className={styles.field}><MeetPersonalityPicker label="希望来的搭子狐格" value={preferredPersonality} onChange={setPreferredPersonality} /></div>
        <div className={styles.field}><span>谁可以看到</span><div className={styles.visibility}>
          <button type="button" aria-pressed={visibility === 'public'} onClick={() => setVisibility('public')}><strong>同校公开</strong><small>让同校同学找到活动</small></button>
          <button type="button" aria-pressed={visibility === 'private'} onClick={() => setVisibility('private')}><strong>仅邀请</strong><small>通过链接或二维码加入</small></button>
        </div></div>
      </section> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <button className={styles.primary} type="submit" disabled={busy}>{busy ? (mode === 'find' ? '正在找搭子…' : '正在发起…') : (mode === 'find' ? '看看谁也有空' : '发起碰个空')}</button>
      {mode === 'find' && results !== null ? <section className={styles.section} aria-live="polite">
        <div className={styles.sectionTitle}><div><span>FOUND FOR YOU</span><h2>合适的活动</h2></div><small>{results.length} 个</small></div>
        {results.length ? <div className={styles.roomList}>{results.map((room) => <RoomCard key={room.id} room={room} />)}</div> : <div className={styles.empty}>{handdrawn ? <img className={styles.emptyFox} src="/brand/handdrawn/fox-greeting.png" alt="" aria-hidden="true" /> : null}<p>暂时没有符合时间的活动。换个时间，或自己发起一个吧。</p><button type="button" className={styles.secondary} onClick={() => { setMode('create'); setError('') }}>我来发起</button></div>}
      </section> : null}
    </form>}
  </div>
}

function MeetDetail({ code }: { code: string }) {
  const auth = useAuth()
  const handdrawn = useUiVariant() === 'handdrawn'
  const [room, setRoom] = useState<MeetRoom | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [vibe, setVibe] = useState<MeetVibe>('any')
  const [personalityType, setPersonalityType] = useState<MeetPersonality | null>(null)
  const [preferredPersonality, setPreferredPersonality] = useState<MeetPersonality | null>(null)
  const [slots, setSlots] = useState<string[]>([])
  const [editing, setEditing] = useState(false)
  const alive = useRef(true)
  const operation = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    const saved = readMeetReply(code)
    const profile = readMeetPersonalityProfile(auth.user?.uid || '')
    setName(saved?.name || ''); setVibe(saved?.vibe || 'any'); setPersonalityType(saved ? saved.personalityType : profile.type); setPreferredPersonality(saved ? saved.preferredPersonality : profile.preferred); setSlots(saved?.slots || [])
    setEditing(!saved)
  }, [code, auth.user?.uid])
  useEffect(() => {
    if (auth.phase === 'booting') return
    let current = true
    setLoading(true); setError('')
    void getMeet(code).then((item) => { if (current) setRoom(item) }).catch((failure) => { if (current) { setRoom(null); setError(messageOf(failure)) } }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [code, auth.phase, auth.user?.uid, loadAttempt])
  useEffect(() => { if (auth.user?.nickname) setName((value) => value || auth.user!.nickname) }, [auth.user?.nickname, auth.user?.uid])
  const suggestions = useMemo(() => room ? recommendedMeetSlots(room) : [], [room])
  const share = useMemo(() => buildMeetShareUrl(code), [code])
  const calendar = useMemo(() => room ? buildMeetIcs(room, activityName(room.activity)) : null, [room])
  const saved = readMeetReply(code)
  async function refresh() {
    if (operation.current) return
    operation.current = true; setBusy(true); setActionError('')
    try { const updated = await getMeet(code); if (alive.current) { setRoom(updated); setNotice('活动已更新') } }
    catch (failure) { if (alive.current) setActionError(messageOf(failure)) }
    finally { operation.current = false; if (alive.current) setBusy(false) }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!room || operation.current) return
    if (!name.trim()) { setActionError('请填写怎么称呼你。'); return }
    if (!hasContinuousTime(slots, room.durationMinutes)) { setActionError(`请至少选择连续 ${room.durationMinutes} 分钟的可参加时间。`); return }
    operation.current = true; setBusy(true); setActionError(''); setNotice('')
    try {
      if (room.visibility === 'public' && !auth.isSigned && !await auth.ensureSignedIn('登录哦狐后加入同校公开活动')) return
      const updated = await respondMeet(code, { name: name.trim(), vibe, personalityType, preferredPersonality, slots })
      if (alive.current) { setRoom(updated); setEditing(false); setNotice('你的可参加时间已提交。') }
    } catch (failure) { if (alive.current) setActionError(messageOf(failure)) }
    finally { operation.current = false; if (alive.current) setBusy(false) }
  }
  function fillFromSchedule() {
    if (!room) return
    try {
      const next = suggestMeetTimesFromSchedule(room.startsOn, room.days)
      setSlots(next)
      setActionError(next.length ? '' : '这段日期没有找到可参考的课表空档，请手动选择。')
      if (next.length) setNotice('已参考你的课表填入，请按实际情况调整。')
    } catch (failure) { setActionError(messageOf(failure)) }
  }
  async function confirm(start: string) {
    if (operation.current) return
    operation.current = true; setBusy(true); setActionError(''); setNotice('')
    try { const updated = await confirmMeet(code, start); if (alive.current) { setRoom(updated); setNotice('时间已确定，快分享给大家吧。') } }
    catch (failure) { if (alive.current) setActionError(messageOf(failure)) }
    finally { operation.current = false; if (alive.current) setBusy(false) }
  }
  async function close() {
    if (operation.current || !window.confirm('确定结束这个活动吗？结束后同学将无法继续加入。')) return
    operation.current = true; setBusy(true); setActionError(''); setNotice('')
    try { const updated = await closeMeet(code); if (alive.current) { setRoom(updated); setNotice('活动已结束。') } }
    catch (failure) { if (alive.current) setActionError(messageOf(failure)) }
    finally { operation.current = false; if (alive.current) setBusy(false) }
  }
  async function leave() {
    if (operation.current || !window.confirm('确定退出这个活动吗？你的空闲时间将不再参与匹配。')) return
    operation.current = true; setBusy(true); setActionError(''); setNotice('')
    try {
      const updated = await leaveMeet(code)
      if (alive.current) { const profile = readMeetPersonalityProfile(auth.user?.uid || ''); setRoom(updated); setName(''); setVibe('any'); setPersonalityType(profile.type); setPreferredPersonality(profile.preferred); setSlots([]); setEditing(true); setNotice('已退出活动。') }
    } catch (failure) { if (alive.current) setActionError(messageOf(failure)) }
    finally { operation.current = false; if (alive.current) setBusy(false) }
  }
  return <div className={styles.page}>
    <PageHeader title="碰个空" right={room ? <button className={styles.textButton} type="button" disabled={busy} onClick={() => void refresh()}>刷新</button> : undefined} />
    {loading ? <div className={styles.section}><p className={styles.state}>正在打开活动…</p></div>
      : error || !room ? <div className={styles.section}><p className={styles.error} role="alert">{error || '活动不存在或已失效。'}</p><button type="button" className={styles.secondary} onClick={() => setLoadAttempt((value) => value + 1)}>重新加载</button> <Link className={styles.linkButton} to="/meet">返回碰个空</Link></div>
        : <>
          <section className={styles.detailHero}>
            <div className={styles.detailTop}><span>{activityName(room.activity)} · {room.visibility === 'public' ? '同校公开' : '好友邀请'}</span><span>{room.closedAt ? '已结束' : room.confirmedStart ? '已定时间' : '正在组队'}</span></div>
            <h2>{room.title}</h2><p>{room.detailsVisible && room.organizerName ? `由 ${room.organizerName} 发起` : '填写参加时间后即可查看队伍详情'}{room.campus ? ` · ${room.campus}` : ''}</p>
            <div className={styles.detailMeta}><strong>{room.participantCount}<small> / {room.targetSize} 人</small></strong><span>计划 {room.durationMinutes} 分钟</span></div>
            {!room.closedAt && !room.confirmedStart ? <a className={styles.heroCta} href="#met-join-time">填写时间，加入活动</a> : null}
            <FoxSheetPose pose={handdrawn ? 'reading' : 'waving'} className={styles.detailFox} />
          </section>
          {notice ? <p className={styles.success} role="status">{notice}</p> : null}
          {actionError ? <p className={styles.error} role="alert">{actionError}</p> : null}
          <section className={styles.section}>
            <div className={styles.sectionTitle}><div><span>THE GROUP</span><h2>成员确认状态</h2></div><small>已加入 {room.participantCount} · 目标 {room.targetSize}</small></div>
            {!room.detailsVisible ? <p className={styles.hint}>提交参加时间后，可查看已加入的同学。</p>
              : room.participants.length ? <div className={styles.people}>{room.participants.map((person, index) => {
                const similarity = personalityType && person.personalityType ? meetPersonalitySimilarity(personalityType, person.personalityType) : null
                return <span key={`${person.name}-${index}`}><i aria-hidden="true">{person.name.slice(0, 1)}</i><span className={styles.personCopy}><b>{person.name}</b><small>{person.personalityType ? `${person.personalityType} · ${meetPersonalityName(person.personalityType)}` : person.vibe === 'any' ? '' : vibeName(person.vibe)}</small>{similarity !== null ? <small className={styles.personalityMatchScore}>与你相似 {similarity}/4</small> : null}</span></span>
              })}</div> : <p className={styles.hint}>还没有同学填写时间。</p>}
          </section>
          {room.confirmedStart && room.confirmedEnd ? <section className={`${styles.section} ${styles.confirmed}`}><span>时间定啦</span><h2>{slotLabel(room.confirmedStart, room.confirmedEnd)}</h2><p>时间已确定，地点与提醒见下方「见面信息」。</p></section>
            : <section className={styles.section}>
              <div className={styles.sectionTitle}><div><span>COMMON TIME</span><h2>大家都方便的时间</h2></div></div>
              {!room.detailsVisible ? <p className={styles.hint}>加入活动后可查看大家都方便的时间。</p>
                : suggestions.length ? <div className={styles.slots}>{suggestions.slice(0, 20).map((slot) => <div key={slot.start}><strong>{slotLabel(slot.start, slot.end)}</strong>{room.mine && room.participantCount >= room.targetSize && !room.closedAt ? <button type="button" disabled={busy} onClick={() => void confirm(slot.start)}>选这个时间</button> : <span>{room.participantCount} 人可参加</span>}</div>)}</div>
                : <p className={styles.hint}>{room.participantCount < 2 ? '等至少两位同学填好时间，就能找共同空档。' : '暂时没有共同时间，可以调整各自选择。'}</p>}
              {room.mine && room.participantCount < room.targetSize && !room.closedAt ? <p className={styles.hint}>人数达到 {room.targetSize} 人后，发起人可以确定时间。</p> : null}
            </section>}
          {!room.closedAt && !room.confirmedStart ? <section className={styles.section} id="met-join-time">
            <div className={styles.sectionTitle}><div><span>YOUR TIME</span><h2>{saved ? '你填写的时间' : '你什么时候有空？'}</h2></div>{saved && !editing ? <button type="button" className={styles.textButton} onClick={() => setEditing(true)}>修改</button> : null}</div>
            {!editing && saved ? <p className={styles.hint}>已选择 {saved.slots.length} 个半小时时段，可随时修改。</p> : <form onSubmit={(event) => void submit(event)}>
              <label className={styles.field}><span>怎么称呼你</span><input maxLength={24} value={name} onChange={(event) => setName(event.target.value)} placeholder="填写昵称" required /></label>
              <div className={styles.field}><span>我的社交风格 <small>选填，仅作介绍</small></span><VibeSelect value={vibe} onChange={setVibe} hint="标记你是 E 人还是 I 人，让发起人更了解你。" /></div>
              <div className={styles.field}><MeetPersonalityPicker label="我的狐格类型（选填）" value={personalityType} onChange={setPersonalityType} allowQuiz /><p className={styles.hint}>加入后，已获准查看活动详情的成员能看到你选择的类型；不填写也可以参加。</p></div>
              <div className={styles.field}><MeetPersonalityPicker label="希望匹配的狐格类型" value={preferredPersonality} onChange={setPreferredPersonality} /></div>
              <button type="button" className={styles.scheduleHint} disabled={busy} onClick={fillFromSchedule}>✦ 从我的课表参考没课时间</button>
              <p className={styles.hint}>没课不等于有空，请手动调整并确认。</p>
              <MeetAvailabilityPicker startsOn={room.startsOn} days={room.days} value={slots} onChange={setSlots} disabled={busy} />
              <button className={styles.primary} disabled={busy} type="submit">{busy ? '正在提交…' : saved ? '保存我的时间' : '填写时间，加入活动'}</button>
            </form>}
          </section> : null}
          <section className={styles.section}>
            <div className={styles.sectionTitle}><div><span>PLACE &amp; REMINDER</span><h2>见面信息</h2></div></div>
            <p className={styles.hint}>{room.campus ? `校区：${room.campus}。具体集合地点还没有记录，请在活动里和成员确认。` : '具体集合地点还没有记录，请在活动里和成员确认。'}</p>
            <p className={styles.hint}>建议提前 5–10 分钟到达；校园活动请保持安静，遵守场地规则。</p>
            {calendar ? <button type="button" className={styles.calendarAction} onClick={() => { downloadIcs('哦狐碰个空活动.ics', calendar); setNotice('已发起日历文件下载。打开文件可导入系统日历；集合地点仍需与成员确认。') }}>导出日历（.ics）</button> : <p className={styles.hint}>活动时间格式暂不可导出，请刷新活动信息。</p>}
          </section>
          <section className={styles.section}>
            <div className={styles.sectionTitle}><div><span>PROGRESS</span><h2>活动进度</h2></div></div>
            <div className={styles.progress}>
              {[
                { label: '邀请中', done: true },
                { label: '时间已确认', done: !!room.confirmedStart || !!room.closedAt },
                { label: '已结束', done: !!room.closedAt },
              ].map((stage, index) => <span key={stage.label} className={stage.done ? styles.stepDone : styles.step}><i>{index + 1}</i><b>{stage.label}</b></span>)}
            </div>
            <p className={styles.hint}>{room.closedAt ? '活动已结束，记录仍可查看。' : room.confirmedStart ? '时间已确认，可以分享邀请或导出日历。' : '还差一起方便的时间，邀请更多同学填一下吧。'}</p>
          </section>
          <section className={styles.section}>
            <div className={styles.sectionTitle}><div><span>INVITE YOUR FRIENDS</span><h2>喊朋友一起来</h2></div></div>
            <p className={styles.hint}>分享链接或二维码，朋友打开网页就能查看邀请。</p>
            {share.url ? <MeetShareCode url={share.url} title={room.title} activity={activityName(room.activity)} targetSize={room.targetSize} dateLabel={room.startsOn} /> : <p className={styles.state}>{share.reason}</p>}
          </section>
          {saved && !room.mine && !room.closedAt && !room.confirmedStart ? <button type="button" className={styles.close} onClick={() => void leave()} disabled={busy}>退出活动</button> : null}
          {room.mine && !room.closedAt && !room.confirmedStart ? <button type="button" className={styles.close} onClick={() => void close()} disabled={busy}>结束活动</button> : null}
          <p className={styles.privacyTip}>小贴士：请尊重同学隐私，组局仅在校园范围内活动，不要发布或询问私人宿舍等敏感位置信息。</p>
        </>}
  </div>
}

export function MeetPage() {
  const { code } = useParams<{ code: string }>()
  const auth = useAuth()
  useQbankRevision()
  const session = captureQbankSession()
  const identityKey = `${auth.user?.uid || 'guest'}:${session.uid}:${session.revision}`
  return code ? <MeetDetail key={`${identityKey}:${code}`} code={code} /> : <MeetHome key={identityKey} />
}
