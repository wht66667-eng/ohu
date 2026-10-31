import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { CampusIcon } from '../components/CampusIcon'
import { DialogLayer } from '../components/ui/DialogLayer'
import { SubmitButton } from '../components/ui/motion-ui'
import { FoxInline } from '../components/fox/FoxInline'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../lib/auth'
import { usePollingRows } from '../lib/hooks'
import { cancelSignup, createActivity, fetchActivitySignups, setActivityStatus, signupActivity, type ActivitySignup } from '../lib/bulletin'
import { fetchMorningTeams, type MorningTeam } from '../lib/morning-teams'
import { MORNING_TEAM_CATEGORY, MORNING_TEAM_TAG, formatMorningStart, morningTeamState, nextMorningStart, parseLocalStart, validateMorningDraft } from '../lib/morning-team-rules'
import styles from './MorningTeamsPage.module.css'

type Modal = { kind: 'create'; ownerUid: string } | { kind: 'join' | 'leave' | 'cancel' | 'members' | 'detail'; team: MorningTeam; ownerUid: string }

function requestDialogClose(element: HTMLElement) {
  element.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))
}

function SheetHeader({ title }: { title: string }) {
  return <div className={styles.sheetHeader}><h2>{title}</h2><button type="button" className={styles.close} aria-label="关闭" onClick={(event) => requestDialogClose(event.currentTarget)}>×</button></div>
}

function FormField({ label, id, children, hint }: { label: string; id: string; children: ReactNode; hint?: string }) {
  return <div className={styles.field}><label htmlFor={id}>{label}</label>{children}{hint ? <small>{hint}</small> : null}</div>
}

function CreateSquad({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const auth = useAuth()
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [location, setLocation] = useState('')
  const [start, setStart] = useState(() => nextMorningStart())
  const [duration, setDuration] = useState(45)
  const [seats, setSeats] = useState('4')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const alive = useRef(true)
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const uidRef = useRef(uid)
  uidRef.current = uid
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (lock.current) return
    const invalid = validateMorningDraft({ title, location, start, seats, duration })
    if (invalid) { setError(invalid); return }
    lock.current = true
    setBusy(true)
    setError('')
    try {
      if (!uid || !(await auth.ensureSignedIn('发起阳光跑小队需要登录'))) return
      if (!alive.current || uidRef.current !== uid) return
      const date = parseLocalStart(start)!
      const result = await createActivity({
        title: title.trim(), organizer: auth.profile?.username || auth.user?.nickname || '同学',
        description: description.trim(), tag: MORNING_TEAM_TAG, location: location.trim(),
        start_at: date.toISOString(), end_at: new Date(date.getTime() + duration * 60000).toISOString(),
        seats: Number(seats), cover: '', creator_name: auth.profile?.username || auth.user?.nickname || '同学', category: MORNING_TEAM_CATEGORY,
      })
      if (!alive.current || uidRef.current !== uid) return
      if (result.error) { setError(result.error); return }
      toast.ok('阳光跑小队已发起')
      onDone()
    } catch { if (alive.current && uidRef.current === uid) setError('发布未完成，请检查网络后重试') }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }

  return <DialogLayer title="发起阳光跑小队" onClose={onClose} allowClose={!busy}>
    <SheetHeader title="发起阳光跑小队" />
    <p className={styles.sheetIntro}>约好时间和集合点，一起跑一段。</p>
    <form className={styles.form} onSubmit={submit} aria-busy={busy}>
      <fieldset disabled={busy}>
        <FormField label="小队名称" id="morning-title"><input id="morning-title" value={title} maxLength={40} required placeholder="例如：明早操场轻松跑" onChange={(event) => setTitle(event.target.value)} /></FormField>
        <FormField label="集合点" id="morning-location"><input id="morning-location" value={location} maxLength={40} required placeholder="例如：东操场入口" onChange={(event) => setLocation(event.target.value)} /></FormField>
        <FormField label="出发时间" id="morning-start" hint="晨跑时段 04:00–11:59"><input id="morning-start" type="datetime-local" value={start} required onChange={(event) => setStart(event.target.value)} /></FormField>
        <div className={styles.fieldPair}>
          <FormField label="预计时长" id="morning-duration"><select id="morning-duration" value={duration} onChange={(event) => setDuration(Number(event.target.value))}>{[30, 45, 60, 90].map((minutes) => <option key={minutes} value={minutes}>{minutes} 分钟</option>)}</select></FormField>
          <FormField label="同行名额" id="morning-seats" hint="1–30 人，不含发起人"><input id="morning-seats" type="number" inputMode="numeric" min={1} max={30} step={1} required value={seats} onChange={(event) => setSeats(event.target.value)} /></FormField>
        </div>
        <FormField label="路线与约定（选填）" id="morning-description" hint="说明会公开展示，请勿填写私人联系方式"><textarea id="morning-description" rows={3} value={description} maxLength={200} placeholder="路线、跑步节奏、雨天安排…" onChange={(event) => setDescription(event.target.value)} /></FormField>
      </fieldset>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <SubmitButton type="submit" state={busy ? 'busy' : 'idle'} label="发起小队" busyText="正在发布…" className={styles.primary} />
    </form>
  </DialogLayer>
}

function SignupSquad({ team, onClose, onDone }: { team: MorningTeam; onClose: () => void; onDone: () => void }) {
  const auth = useAuth()
  const toast = useToast()
  const [name, setName] = useState(auth.profile?.username || auth.user?.nickname || '')
  const [contact, setContact] = useState(auth.user?.phone || '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const alive = useRef(true)
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const uidRef = useRef(uid)
  uidRef.current = uid
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (lock.current) return
    if (!name.trim() || !contact.trim() || name.trim().length > 40 || contact.trim().length > 40) { setError('请填写称呼和联系方式，各不超过 40 个字'); return }
    if (morningTeamState(team) !== '可加入') { setError('这支小队当前不可加入，请刷新列表'); return }
    lock.current = true
    setBusy(true)
    setError('')
    try {
      if (!uid || !(await auth.ensureSignedIn('加入阳光跑小队需要登录'))) return
      if (!alive.current || uidRef.current !== uid) return
      const result = await signupActivity({ activity_id: team.id, uid, name: name.trim(), contact: contact.trim(), building: auth.profile?.building || '' }, { category: MORNING_TEAM_CATEGORY })
      if (!alive.current || uidRef.current !== uid) return
      if (result.error) { setError(result.error); return }
      toast.ok('已加入阳光跑小队')
      onDone()
    } catch { if (alive.current && uidRef.current === uid) setError('报名未完成，请检查网络后重试') }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }

  return <DialogLayer title="加入阳光跑小队" onClose={onClose} allowClose={!busy}>
    <SheetHeader title="加入小队" /><p className={styles.sheetIntro}>{team.title} · {formatMorningStart(team.start_at)}</p>
    <form className={styles.form} onSubmit={submit} aria-busy={busy}>
      <fieldset disabled={busy}>
        <FormField label="怎么称呼你" id="morning-name"><input id="morning-name" value={name} required maxLength={40} onChange={(event) => setName(event.target.value)} /></FormField>
        <FormField label="联系方式" id="morning-contact" hint="填写手机号或微信，方便发起人确认集合安排"><input id="morning-contact" value={contact} required maxLength={40} onChange={(event) => setContact(event.target.value)} /></FormField>
      </fieldset>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      <SubmitButton type="submit" state={busy ? 'busy' : 'idle'} label="确认加入" busyText="正在报名…" className={styles.primary} />
    </form>
  </DialogLayer>
}

function MemberList({ team, onClose }: { team: MorningTeam; onClose: () => void }) {
  const [attempt, setAttempt] = useState(0)
  const [rows, setRows] = useState<ActivitySignup[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    void fetchActivitySignups(team.id).then((result) => {
      if (!alive) return
      setRows(result.rows)
      setError(result.error || '')
      setLoading(false)
    }).catch(() => { if (alive) { setError('名单暂时无法读取'); setLoading(false) } })
    return () => { alive = false }
  }, [team.id, attempt])
  return <DialogLayer title="小队报名名单" onClose={onClose}><SheetHeader title="报名名单" /><p className={styles.sheetIntro}>{team.title}</p>
    {loading ? <p role="status">正在读取报名名单…</p> : error ? <div className={styles.state}><p role="alert">{error}</p><button type="button" className={styles.secondary} onClick={() => setAttempt((value) => value + 1)}>重新读取</button></div> : rows.length ? <ul className={styles.members}>{rows.map((member) => <li key={member.id}><b>{member.name || '同学'}</b><span>{member.contact || '未填写联系方式'}</span>{member.building ? <small>{member.building}</small> : null}</li>)}</ul> : <p>还没有同学报名。发起人不计入同行名额。</p>}
  </DialogLayer>
}

export function MorningTeamsPage() {
  const auth = useAuth()
  const toast = useToast()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const uidRef = useRef(uid)
  uidRef.current = uid
  const [filter, setFilter] = useState<'all' | 'mine'>('all')
  const [modal, setModal] = useState<Modal | null>(null)
  const [now, setNow] = useState(Date.now)
  const [busy, setBusy] = useState(false)
  const [operationError, setOperationError] = useState('')
  const lock = useRef(false)
  const alive = useRef(true)
  const teams = usePollingRows<MorningTeam>(() => fetchMorningTeams(uid), [uid], 30000)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { setModal(null); setOperationError('') }, [uid])
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') setNow(Date.now()) }, 10000)
    return () => window.clearInterval(timer)
  }, [])
  const shown = useMemo(() => teams.rows.filter((team) => team.viewerUid === uid && (filter === 'mine' ? team.joined || team.owned : team.status === 'open' && Date.parse(team.start_at) > now)), [teams.rows, filter, now, uid])
  const activeModal = modal?.ownerUid === uid ? modal : null

  async function openMutation(kind: 'create' | 'join', team?: MorningTeam) {
    if (!(await auth.ensureSignedIn(kind === 'create' ? '发起阳光跑小队需要登录' : '加入阳光跑小队需要登录'))) return
    const signedUid = uidRef.current
    if (!alive.current || !signedUid) return
    setOperationError('')
    if (kind === 'create') setModal({ kind, ownerUid: signedUid })
    else if (team) setModal({ kind, team, ownerUid: signedUid })
  }

  async function confirmMutation() {
    if (!activeModal || activeModal.kind !== 'leave' && activeModal.kind !== 'cancel' || lock.current) return
    const action = activeModal
    if (!uid || uidRef.current !== uid) return
    lock.current = true
    setBusy(true)
    setOperationError('')
    try {
      const result = action.kind === 'leave' ? await cancelSignup(action.team.id, uid) : await setActivityStatus(action.team.id, 'cancelled')
      if (!alive.current || uidRef.current !== uid) return
      if (result.error) { setOperationError(result.error); return }
      toast.ok(action.kind === 'leave' ? '已退出小队' : '阳光跑小队已取消')
      setModal(null)
      teams.reload()
    } catch { if (alive.current && uidRef.current === uid) setOperationError('操作未完成，请检查网络后重试') }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }

  function done() { setModal(null); teams.reload() }
  function actionButtons(team: MorningTeam) {
    const status = morningTeamState(team, now)
    if (team.owned) return <><button type="button" className={styles.secondary} onClick={() => setModal({ kind: 'members', team, ownerUid: uid })}>报名名单</button>{team.status === 'open' && Date.parse(team.end_at) > now ? <button type="button" className={styles.textButton} onClick={() => { setOperationError(''); setModal({ kind: 'cancel', team, ownerUid: uid }) }}>取消小队</button> : null}</>
    if (team.joined) return <><span className={styles.joined}>你已加入</span>{Date.parse(team.start_at) > now && team.status === 'open' ? <button type="button" className={styles.secondary} onClick={() => { setOperationError(''); setModal({ kind: 'leave', team, ownerUid: uid }) }}>退出小队</button> : null}</>
    return <button type="button" className={styles.primary} disabled={status !== '可加入' || teams.loading || !!teams.error} onClick={() => void openMutation('join', team)}>{status === '可加入' ? '加入小队' : status}</button>
  }

  return <div className={styles.page}>
    <PageHeader title="阳光跑小队" right={<Link className={styles.headerLink} to="/sports">运动记录</Link>} />
    <main className={styles.main}>
      <section className={styles.hero}>
        <div className={styles.heroIcon}><CampusIcon name="partner" size={28} /></div>
        <div><span className={styles.eyebrow}>约同学，一起出发</span><h2>明早，结伴跑一段</h2><p>选一支小队，或约好自己的集合时间。</p></div>
        <button type="button" className={styles.primary} onClick={() => void openMutation('create')}><CampusIcon name="plus" size={18} />发起阳光跑小队</button>
      </section>
      <div className={styles.listHead}><div className={styles.filters} role="group" aria-label="小队筛选">{([['all', '待出发的小队'], ['mine', '我的小队']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} className={filter === value ? styles.filterOn : ''} onClick={() => setFilter(value)}>{label}</button>)}</div><button type="button" className={styles.refresh} disabled={teams.loading} onClick={teams.reload}>刷新</button></div>
      {teams.error ? <div className={styles.errorBox} role="alert"><p>{teams.error}</p><button type="button" className={styles.secondary} disabled={teams.loading} onClick={teams.reload}>重试</button></div> : null}
      {filter === 'mine' && !uid ? <div className={styles.state}><FoxInline variant="empty" size={48} text="登录后查看你的小队" sub="你发起和加入的晨跑会保存在这里" /><button type="button" className={styles.primary} onClick={() => auth.openLogin('查看我的阳光跑小队')}>登录</button></div> : shown.length === 0 ? <div className={styles.state}><FoxInline variant={teams.loading ? 'loading' : teams.error ? 'error' : 'empty'} size={48} text={teams.loading ? '正在寻找阳光跑小队…' : teams.error ? '暂时没能读取小队' : filter === 'mine' ? '你还没有发起或加入小队' : '还没有待出发的小队'} sub={teams.loading || teams.error ? undefined : '发起一次晨跑，约同学一起出发'} />{!teams.loading && !teams.error ? <button type="button" className={styles.secondary} onClick={() => void openMutation('create')}>发起第一支小队</button> : null}</div> : <div className={styles.list} aria-busy={teams.loading}>{shown.map((team) => <article className={styles.card} key={team.id}>
        <div className={styles.cardTop}><span className={styles.time}><CampusIcon name="sun" size={17} />{formatMorningStart(team.start_at)}</span><span className={styles.status}>{team.owned ? '你发起的' : morningTeamState(team, now)}</span></div>
        <h3>{team.title}</h3><p className={styles.location}>集合 · {team.location || '集合点待确认'}</p>
        <p className={styles.description}>{team.description || '出发前与发起人确认路线和节奏。'}</p>
        <div className={styles.meta}><span>{team.organizer || team.creator_name || '同学'} 发起</span><span>{team.signupCountKnown ? `${team.signup_count} 人已加入 · ` : ''}{team.seats > 0 ? `${team.seats} 个同行名额` : '不限名额'}</span></div>
        <div className={styles.actions}><button type="button" className={styles.textButton} onClick={() => setModal({ kind: 'detail', team, ownerUid: uid })}>查看约定</button>{actionButtons(team)}</div>
      </article>)}</div>}
      <p className={styles.note}>报名后请按时集合；天气变化时先确认安排。小队组队不自动开启运动记录。</p>
    </main>
    {activeModal?.kind === 'create' ? <CreateSquad onClose={() => setModal(null)} onDone={done} /> : null}
    {activeModal?.kind === 'join' ? <SignupSquad team={activeModal.team} onClose={() => setModal(null)} onDone={done} /> : null}
    {activeModal?.kind === 'members' ? <MemberList team={activeModal.team} onClose={() => setModal(null)} /> : null}
    {activeModal?.kind === 'detail' ? <DialogLayer title="晨跑约定" onClose={() => setModal(null)}><SheetHeader title={activeModal.team.title} /><dl className={styles.detail}><dt>出发时间</dt><dd>{formatMorningStart(activeModal.team.start_at)}</dd><dt>集合点</dt><dd>{activeModal.team.location}</dd><dt>路线与约定</dt><dd>{activeModal.team.description || '发起人还未补充，请出发前确认。'}</dd></dl></DialogLayer> : null}
    {activeModal?.kind === 'leave' || activeModal?.kind === 'cancel' ? <DialogLayer title={activeModal.kind === 'leave' ? '退出阳光跑小队' : '取消阳光跑小队'} onClose={() => setModal(null)} allowClose={!busy}><SheetHeader title={activeModal.kind === 'leave' ? '退出这支小队？' : '取消这次晨跑？'} /><p className={styles.sheetIntro}>{activeModal.team.title}</p><p>{activeModal.kind === 'leave' ? '退出后会释放你的同行名额，之后仍可报名未满的小队。' : '取消后小队不再接受报名。请及时联系已报名同学，确认行程取消。'}</p>{operationError ? <p className={styles.error} role="alert">{operationError}</p> : null}<SubmitButton state={busy ? 'busy' : 'idle'} label={activeModal.kind === 'leave' ? '确认退出' : '确认取消小队'} className={styles.primary} onClick={() => void confirmMutation()} /></DialogLayer> : null}
  </div>
}
