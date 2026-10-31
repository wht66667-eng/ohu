import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { CampusNavigation } from '../components/CampusNavigation'
import { HomeServiceIcon } from '../components/HomeServiceIcon'
import { FoxSheetPose } from '../components/fox/FoxSheetPose'
import { captureQbankSession, isQbankSessionCurrent } from '../lib/qbank'
import { useQbankRevision } from '../lib/useQbankRevision'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../lib/auth'
import { fetchCampusPois, fetchCampuses, type Campus, type CampusPoi } from '../lib/campus-map'
import { mergeCampusPois, readLocalPins } from '../lib/campus-map-local'
import { ensureAlarmChannel } from '../lib/alarm-notify'
import { IS_NATIVE, PLATFORM } from '../lib/platform'
import { openPerfectCampusApp } from '../lib/express-app-probe'
import styles from './CampusServicePages.module.css'

const CARD_OFFICIAL = 'https://xxzx.jou.edu.cn/info/1131/2481.htm'
const PERFECT_CAMPUS = 'https://app.59wanmei.com/new/index.html'
const LIBRARY_GUIDE = 'https://lib.jou.edu.cn/info/1105/1791.htm'

type BusStop = { name: string; time: string | null }
type BusTrip = { vehicle: string; driver: string; phone: string; direction: 'outbound' | 'inbound'; stops: BusStop[] }
const BUS_VERSION = { semester: '2026-2027 秋季作息版', from: '2026-10-01', to: '2027-04-30', source: '江苏海洋大学信息化中心通知（2026-04-28）', url: 'https://xxzx.jou.edu.cn/info/1281/3251.htm' }
const BUS_STOPS = {
  outbound: ['通灌西门', '苍梧2号门', '苍梧1号门', '淮海花园', '宋跳'],
  inbound: ['宋跳', '淮海花园', '苍梧1号门', '苍梧2号门', '通灌西门'],
}
const busRows: Array<[string, string, string, string, string, string]> = [
  ['苏G 6660E','07:15','07:30','07:31','07:33','07:48'], ['苏G 6669E','09:15','09:30','09:31','09:33','09:48'],
  ['苏G 6660E','09:55','10:10','10:11','10:13','10:28'], ['苏G 6669E','11:50','12:05','12:06','12:08',''],
  ['苏G 6660E','13:15','13:30','13:31','13:33','13:48'], ['苏G 6669E','15:05','15:20','15:21','15:23','15:38'],
  ['苏G 6660E','15:50','16:05','16:06','16:08','16:23'], ['苏G 6669E','16:45','17:00','17:01','17:03','17:18'],
  ['苏G 6660E','17:40','17:55','17:56','17:58','18:13'], ['苏G L2713','18:15','18:30','18:31','18:33','18:48'],
  ['苏G 6669E','18:35','18:50','18:51','18:53',''],
]
const inboundRows: Array<[string, string, string, string, string, string]> = [
  ['苏G 6669E','07:30','','07:32','07:33','07:48'], ['苏G 6660E','09:10','09:25','09:27','09:28','09:43'],
  ['苏G 6669E','09:55','10:10','10:12','10:13','10:28'], ['苏G 6660E','11:50','12:05','12:07','12:08','12:23'],
  ['苏G 6669E','13:30','','13:32','13:33','13:48'], ['苏G 6660E','15:05','15:20','15:22','15:23','15:38'],
  ['苏G 6669E','15:50','16:05','16:07','16:08','16:23'], ['苏G 6660E','16:45','17:00','17:02','17:03','17:18'],
  ['苏G 6669E','17:40','17:55','17:57','17:58','18:13'], ['苏G 6660E','18:35','18:50','18:52','18:53','19:08'],
  ['苏G L2713','20:50','21:05','21:07','21:08','21:23'],
]
const drivers: Record<string, { driver: string; phone: string }> = {
  '苏G 6669E': { driver: '王师傅', phone: '15951492822' }, '苏G 6660E': { driver: '刘师傅', phone: '15161376665' }, '苏G L2713': { driver: '何师傅', phone: '15961399996' },
}
const BUS_TRIPS: BusTrip[] = [
  ...busRows.map(([vehicle, ...times]) => ({ vehicle, direction: 'outbound' as const, stops: BUS_STOPS.outbound.map((name, i) => ({ name, time: times[i] || null })), ...drivers[vehicle] })),
  ...inboundRows.map(([vehicle, ...times]) => ({ vehicle, direction: 'inbound' as const, stops: BUS_STOPS.inbound.map((name, i) => ({ name, time: times[i] || null })), ...drivers[vehicle] })),
]
const BUS_REMINDER_PREFIX = 'ohu.bus-subscriptions.v2'
const BUS_REMINDER_LEGACY_KEY = 'ohu.bus-subscriptions.v1'
const BUS_REMINDER_CLAIM_KEY = 'ohu.bus-subscriptions.v1.claimed-by'
type BusSubscription = { id: number; direction: BusTrip['direction']; from: string; to: string; time: string; weekday: number; label: string }
const WEEKDAYS = ['周一','周二','周三','周四','周五','周六','周日']
const timestamp = (date: string) => new Date(`${date}T23:59:59`).getTime()

function busReminderKey(uid: string) {
  return `${BUS_REMINDER_PREFIX}:${uid ? `uid:${encodeURIComponent(uid)}` : 'guest'}`
}
function loadBusSubscriptions(uid: string): BusSubscription[] {
  try {
    const value = JSON.parse(localStorage.getItem(busReminderKey(uid)) || '[]')
    return Array.isArray(value) ? value.filter((item): item is BusSubscription => !!item && Number.isInteger(item.id)
      && (item.direction === 'outbound' || item.direction === 'inbound') && typeof item.from === 'string'
      && typeof item.to === 'string' && typeof item.time === 'string' && Number.isInteger(item.weekday)
      && item.weekday >= 1 && item.weekday <= 7 && typeof item.label === 'string') : []
  } catch { return [] }
}
function loadLegacyBusSubscriptions(): BusSubscription[] {
  try {
    const value = JSON.parse(localStorage.getItem(BUS_REMINDER_LEGACY_KEY) || '[]')
    if (!Array.isArray(value)) return []
    return value.filter((item): item is BusSubscription => !!item && Number.isInteger(item.id)
      && (item.direction === 'outbound' || item.direction === 'inbound')
      && Object.values(BUS_STOPS).some(stops => stops.includes(item.from) && stops.includes(item.to))
      && typeof item.time === 'string' && /^\d{2}:\d{2}$/.test(item.time)
      && Number.isInteger(item.weekday) && item.weekday >= 1 && item.weekday <= 7 && typeof item.label === 'string'
      && BUS_TRIPS.some(trip => trip.direction === item.direction && trip.stops.some((stop, index) => stop.name === item.from && stop.time === item.time && index < trip.stops.findIndex(end => end.name === item.to && end.time))))
  } catch { return [] }
}
function loadLegacyBusClaimOwner(): string | null {
  try {
    const value = JSON.parse(localStorage.getItem(BUS_REMINDER_CLAIM_KEY) || 'null')
    return value && typeof value.ownerUid === 'string' ? value.ownerUid : null
  } catch { return null }
}
function busNotificationId(value: Omit<BusSubscription, 'id'>, uid: string) {
  const input = `${uid || 'guest'}:${value.direction}:${value.from}:${value.to}:${value.time}:${value.weekday}`
  let hash = 2166136261
  for (const char of input) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return 730000 + (hash >>> 0) % 1_900_000_000
}
function isBusVersionCurrent(now = Date.now()) { return now >= new Date(`${BUS_VERSION.from}T00:00:00`).getTime() && now <= timestamp(BUS_VERSION.to) }

export function BusPage() {
  useQbankRevision()
  const session = captureQbankSession()
  return <BusPageContent key={`${session.uid}:${session.revision}`} ownerUid={session.uid} />
}

function BusPageContent({ ownerUid }: { ownerUid: string }) {
  const toast = useToast()
  const [direction, setDirection] = useState<BusTrip['direction']>('outbound')
  const [from, setFrom] = useState(BUS_STOPS.outbound[0])
  const [to, setTo] = useState(BUS_STOPS.outbound.at(-1)!)
  const [weekday, setWeekday] = useState(1)
  const [subscriptions, setSubscriptions] = useState<BusSubscription[]>(() => loadBusSubscriptions(ownerUid))
  const [legacySubscriptions] = useState<BusSubscription[]>(loadLegacyBusSubscriptions)
  const [legacyOwnerUid, setLegacyOwnerUid] = useState<string | null>(loadLegacyBusClaimOwner)
  const [showLegacyRestore, setShowLegacyRestore] = useState(false)
  const [showStaleCleanup, setShowStaleCleanup] = useState(false)
  const [busy, setBusy] = useState(false)
  const current = isBusVersionCurrent()
  const stops = BUS_STOPS[direction]
  const staleSubscriptions = subscriptions.filter(item => !BUS_TRIPS.some(trip => trip.direction === item.direction
    && trip.stops.some((stop, index) => stop.name === item.from && stop.time === item.time
      && index < trip.stops.findIndex(end => end.name === item.to && end.time))))
  const trips = useMemo(() => BUS_TRIPS.filter(trip => trip.direction === direction).map(trip => {
    const start = trip.stops.find(stop => stop.name === from)
    const end = trip.stops.find(stop => stop.name === to)
    return { trip, start, end }
  }).filter((row): row is { trip: BusTrip; start: BusStop & { time: string }; end: BusStop & { time: string } } => !!row.start?.time && !!row.end?.time && row.trip.stops.findIndex(stop => stop.name === to) > row.trip.stops.findIndex(stop => stop.name === from)).sort((a,b) => a.start.time.localeCompare(b.start.time)), [direction, from, to])

  function changeDirection(next: BusTrip['direction']) {
    setDirection(next)
    const nextStops = BUS_STOPS[next]
    setFrom(nextStops[0]); setTo(nextStops[nextStops.length - 1])
  }
  async function restoreLegacySubscriptions() {
    const session = captureQbankSession()
    if (session.uid !== ownerUid || (legacyOwnerUid !== null && legacyOwnerUid !== ownerUid)) return
    if (!IS_NATIVE) { toast.err('旧班车提醒只能在哦狐手机 App 中恢复'); return }
    if (!legacySubscriptions.length) { toast.err('没有找到可恢复的旧班车提醒'); return }
    setBusy(true)
    const stagedIds: number[] = []
    const accountKey = busReminderKey(ownerUid)
    const previousAccountValue = localStorage.getItem(accountKey)
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      const permission = await LocalNotifications.checkPermissions()
      const result = permission.display === 'granted' ? permission : await LocalNotifications.requestPermissions()
      if (result.display !== 'granted') { toast.err('请先允许哦狐发送通知，再恢复班车提醒'); return }
      if (!isQbankSessionCurrent(session)) { toast.err('账号已切换，请重新进入班车页'); return }
      const channelId = PLATFORM.os === 'android' ? 'ohu-bus-reminders-v1' : undefined
      if (channelId) await ensureAlarmChannel(channelId, '班车提醒', '常坐班车发车前 15 分钟提醒', { importance: 5, visibility: 1, vibration: true })
      const merged = [...subscriptions]
      for (const legacy of legacySubscriptions) {
        const base = { direction: legacy.direction, from: legacy.from, to: legacy.to, time: legacy.time, weekday: legacy.weekday, label: legacy.label }
        const id = busNotificationId(base, ownerUid)
        if (merged.some(item => item.id === id)) continue
        const trip = BUS_TRIPS.find(item => item.direction === legacy.direction && item.stops.some((stop, index) => stop.name === legacy.from && stop.time === legacy.time && index < item.stops.findIndex(end => end.name === legacy.to && end.time)))
        if (!trip) continue
        const [hourText, minuteText] = legacy.time.split(':')
        const departure = new Date(); departure.setHours(Number(hourText), Number(minuteText), 0, 0)
        const remind = new Date(departure.getTime() - 15 * 60_000)
        stagedIds.push(id)
        await LocalNotifications.schedule({ notifications: [{ id, title: '班车即将发车', body: `${WEEKDAYS[legacy.weekday - 1]} ${legacy.from} 发车，前往 ${legacy.to}。凭校园卡或完美校园乘车，先到先得。`, schedule: { on: { weekday: legacy.weekday === 7 ? 1 : legacy.weekday + 1, hour: remind.getHours(), minute: remind.getMinutes() }, every: 'week', allowWhileIdle: true }, ...(channelId ? { channelId } : {}), extra: { type: 'bus-subscription', ownerUid: ownerUid || 'guest', from: legacy.from, to: legacy.to, vehicle: trip.vehicle } }] })
        merged.push({ id, ...base })
      }
      if (!isQbankSessionCurrent(session)) {
        if (stagedIds.length) await LocalNotifications.cancel({ notifications: stagedIds.map(id => ({ id })) }).catch(() => undefined)
        toast.err('账号已切换，本次没有恢复班车提醒'); return
      }
      if (merged.length === subscriptions.length) { toast.err('没有可恢复的新班车提醒'); return }
      localStorage.setItem(accountKey, JSON.stringify(merged))
      localStorage.setItem(BUS_REMINDER_CLAIM_KEY, JSON.stringify({ ownerUid, claimedAt: new Date().toISOString() }))
      const protectedIds = new Set(merged.map(item => item.id))
      const oldIds = legacySubscriptions.filter(item => !protectedIds.has(item.id)).map(item => ({ id: item.id }))
      let oldPlanCleanupFailed = false
      if (oldIds.length) {
        try { await LocalNotifications.cancel({ notifications: oldIds }) } catch { oldPlanCleanupFailed = true }
      }
      setSubscriptions(merged); setLegacyOwnerUid(ownerUid); setShowLegacyRestore(false)
      if (oldPlanCleanupFailed) toast.warn(`已恢复 ${merged.length - subscriptions.length} 条提醒，但旧通知未能全部清理，可能收到重复提醒`)
      else toast.ok(`已恢复 ${merged.length - subscriptions.length} 条班车提醒到当前账号`)
    } catch {
      if (stagedIds.length) {
        try { const { LocalNotifications } = await import('@capacitor/local-notifications'); await LocalNotifications.cancel({ notifications: stagedIds.map(id => ({ id })) }) } catch { /* preserve legacy settings if staged plans cannot be rolled back */ }
      }
      if (previousAccountValue === null) localStorage.removeItem(accountKey)
      else localStorage.setItem(accountKey, previousAccountValue)
      toast.err('恢复没有完成，旧班车设置仍保留；请检查通知权限后重试')
    } finally { setBusy(false) }
  }
  async function toggleSubscription(trip: BusTrip, time: string) {
    if (!current) return
    const base = { direction, from, to, time, weekday, label: `${WEEKDAYS[weekday - 1]} ${from} ${time} → ${to}` }
    const session = captureQbankSession()
    if (session.uid !== ownerUid) return
    const id = busNotificationId(base, ownerUid)
    const exists = subscriptions.some(item => item.id === id)
    setBusy(true)
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      if (!IS_NATIVE) { toast.err('班车提醒需要在哦狐手机 App 中设置，网页关闭后不能可靠安排本地通知'); return }
      const permission = await LocalNotifications.checkPermissions()
      const result = permission.display === 'granted' ? permission : await LocalNotifications.requestPermissions()
      if (result.display !== 'granted') { toast.err('请先允许哦狐发送通知，再订阅班车提醒'); return }
      if (!isQbankSessionCurrent(session)) { toast.err('账号已切换，请在当前账号重新设置班车提醒'); return }
      const channelId = PLATFORM.os === 'android' ? 'ohu-bus-reminders-v1' : undefined
      if (channelId) await ensureAlarmChannel(channelId, '班车提醒', '常坐班车发车前 15 分钟提醒', { importance: 5, visibility: 1, vibration: true })
      await LocalNotifications.cancel({ notifications: [{ id }] }).catch(() => undefined)
      const next = exists ? subscriptions.filter(item => item.id !== id) : [...subscriptions, { id, ...base }]
      if (!exists) {
        const [hourText, minuteText] = time.split(':')
        const departure = new Date(); departure.setHours(Number(hourText), Number(minuteText), 0, 0)
        const remind = new Date(departure.getTime() - 15 * 60_000)
        await LocalNotifications.schedule({ notifications: [{ id, title: '班车即将发车', body: `${WEEKDAYS[weekday - 1]} ${from} 发车，前往 ${to}。凭校园卡或完美校园乘车，先到先得。`, schedule: { on: { weekday: weekday === 7 ? 1 : weekday + 1, hour: remind.getHours(), minute: remind.getMinutes() }, every: 'week', allowWhileIdle: true }, ...(channelId ? { channelId } : {}), extra: { type: 'bus-subscription', ownerUid: ownerUid || 'guest', from, to, vehicle: trip.vehicle } }] })
      }
      if (!isQbankSessionCurrent(session)) {
        await LocalNotifications.cancel({ notifications: [{ id }] }).catch(() => undefined)
        toast.err('账号已切换，本次提醒没有保存；请在当前账号重试')
        return
      }
      localStorage.setItem(busReminderKey(ownerUid), JSON.stringify(next)); setSubscriptions(next)
      toast.ok(exists ? '已取消本机提醒' : '已订阅本机提醒：发车前 15 分钟通知')
    } catch { toast.err('班车提醒设置失败，请检查通知权限后重试') }
    finally { setBusy(false) }
  }
  async function clearStaleSubscriptions() {
    const session = captureQbankSession()
    if (session.uid !== ownerUid || !staleSubscriptions.length) return
    setBusy(true)
    try {
      if (IS_NATIVE) {
        const { LocalNotifications } = await import('@capacitor/local-notifications')
        await LocalNotifications.cancel({ notifications: staleSubscriptions.map(item => ({ id: item.id })) })
      }
      if (!isQbankSessionCurrent(session)) { toast.err('账号已切换，旧提醒没有清理；请在当前账号重新进入班车页'); return }
      const staleIds = new Set(staleSubscriptions.map(item => item.id))
      const next = subscriptions.filter(item => !staleIds.has(item.id))
      localStorage.setItem(busReminderKey(ownerUid), JSON.stringify(next))
      setSubscriptions(next); setShowStaleCleanup(false)
      toast.ok(`已清理 ${staleIds.size} 条旧班车提醒设置`)
    } catch { toast.err('旧提醒未能清理，请稍后重试；原设置仍保留') }
    finally { setBusy(false) }
  }

  return <main className={styles.page}>
    <PageHeader title="校园班车" />
    {IS_NATIVE && legacySubscriptions.length > 0 && (legacyOwnerUid === null || legacyOwnerUid === ownerUid) && <section className={styles.panel} aria-label="恢复旧班车提醒">
      <h2>发现旧班车提醒</h2>
      <p>这些提醒来自旧版本机设置，没有记录账号。只有确认它们属于当前账号后，才会复制并重新安排到当前设备。</p>
      <p>可恢复 {legacySubscriptions.length} 条：{legacySubscriptions.slice(0, 2).map(item => item.label).join('、')}{legacySubscriptions.length > 2 ? '…' : ''}</p>
      {!showLegacyRestore ? <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => setShowLegacyRestore(true)}>查看恢复选项</button> : <div className={styles.segment}>
        <button type="button" disabled={busy} onClick={() => void restoreLegacySubscriptions()}>{busy ? '正在恢复…' : '确认属于我，恢复到此账号'}</button>
        <button type="button" disabled={busy} onClick={() => setShowLegacyRestore(false)}>暂不恢复</button>
      </div>}
    </section>}
    {staleSubscriptions.length > 0 && <section className={styles.panel} aria-label="清理过期班车提醒">
      <h2>有 {staleSubscriptions.length} 条提醒与当前时刻表不匹配</h2>
      <p>它们仍保存在本机，可能按旧班次继续响。核对后可以清理；不会影响课表和待办提醒。</p>
      <p>{staleSubscriptions.slice(0, 3).map(item => item.label).join('、')}{staleSubscriptions.length > 3 ? '…' : ''}</p>
      {!showStaleCleanup ? <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => setShowStaleCleanup(true)}>查看清理选项</button> : <div className={styles.segment}>
        <button type="button" disabled={busy} onClick={() => void clearStaleSubscriptions()}>{busy ? '正在清理…' : '确认取消这些旧提醒'}</button>
        <button type="button" disabled={busy} onClick={() => setShowStaleCleanup(false)}>暂时保留</button>
      </div>}
    </section>}
    <section className={styles.intro}><span className={styles.eyebrow}>江苏海洋大学 · 班车信息</span><h2>选好站点，看看合适的班次</h2><p>班车凭校园卡或“完美校园”乘车，先到先得；目前没有实时车辆定位。</p><FoxSheetPose pose="walking" className={styles.heroFox} /><small className={styles.foxLine}>阿狐陪你找班车</small></section>
    <div className={styles.notice} role="note"><b>{BUS_VERSION.semester} · 有效期至 {BUS_VERSION.to}</b><span>班次按学校最新通知整理，节假日及临时调整以官方通知为准。<a href={BUS_VERSION.url} target="_blank" rel="noreferrer">查看官方时刻表 ↗</a></span></div>
    <section className={styles.panel} aria-label="查询班次">
      <div className={styles.segment}><button type="button" aria-pressed={direction==='outbound'} onClick={() => changeDirection('outbound')}>通灌 → 苍梧 → 宋跳</button><button type="button" aria-pressed={direction==='inbound'} onClick={() => changeDirection('inbound')}>宋跳 → 苍梧 → 通灌</button></div>
      <div className={styles.routeFields}><label>出发站<select value={from} onChange={event => { const next=event.target.value; setFrom(next); if(stops.indexOf(next)>=stops.indexOf(to)) setTo(stops[stops.indexOf(next)+1]) }}>{stops.slice(0,-1).map(stop => <option key={stop}>{stop}</option>)}</select></label><span aria-hidden="true">→</span><label>到达站<select value={to} onChange={event => setTo(event.target.value)}>{stops.slice(stops.indexOf(from)+1).map(stop => <option key={stop}>{stop}</option>)}</select></label></div>
      {trips.length ? <div className={styles.busList}>{trips.map(({trip,start,end}) => {
        const base = { direction, from, to, time: start.time, weekday, label: `${WEEKDAYS[weekday - 1]} ${from} ${start.time} → ${to}` }
        const id = busNotificationId(base, ownerUid)
        const active = subscriptions.some(item => item.id === id)
        return <article key={`${trip.direction}-${trip.vehicle}-${start.time}`} className={styles.busTrip}>
          <div className={styles.tripTop}><span className={styles.time}>{start.time}</span><span className={styles.arrow}>→</span><span className={styles.time}>{end.time}</span><span className={styles.vehicle}>{trip.vehicle}</span></div>
          <div className={styles.driver}>{trip.driver} · <a href={`tel:${trip.phone}`}>{trip.phone}</a></div>
          <details className={styles.stopDetails}><summary>查看沿途站点时间</summary><ol>{trip.stops.map(stop => <li key={stop.name}><span>{stop.name}</span><b>{stop.time || '时刻表未显示'}</b></li>)}</ol></details>
          <button type="button" className={active ? styles.secondaryButton : styles.primaryButton} disabled={busy || !current} onClick={() => void toggleSubscription(trip, start.time)}>{active ? '已订阅 · 取消' : '发车前 15 分钟提醒'}</button>
        </article>
      })}</div> : <div className={styles.empty}>这两个站点之间没有同时列明时间的班次。缺失站点时刻不会推断。</div>}
      <fieldset className={styles.weekdays}><legend>订阅常坐星期</legend><div>{WEEKDAYS.map((day,index)=><button key={day} type="button" disabled={!current} aria-pressed={weekday===index+1} onClick={()=>setWeekday(index+1)}>{day}</button>)}</div></fieldset>
    </section>
    <section className={styles.panel}><h2>乘车与联系</h2><p>乘车凭校园卡或“完美校园”APP，无需购票，先到先得。</p><p>投诉建议：<a href="tel:85895000">刘老师 85895000</a></p><small>来源：<a href={BUS_VERSION.url} target="_blank" rel="noreferrer">{BUS_VERSION.source}</a>。节假日、临时调度及后续学期以学校通知为准。</small></section>
    <div className={styles.footerLinks}><Link to="/campus-card">校园卡入口</Link><Link to="/settings?section=reminders">通知权限设置</Link></div>
  </main>
}

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (value: number) => value * Math.PI / 180
  const dLat = toRad(b.lat-a.lat), dLng = toRad(b.lng-a.lng)
  const x = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x)))
}
function formatDistance(meters: number) { return meters < 1000 ? `${meters} m` : `${(meters/1000).toFixed(1)} km` }
function readFoodFavorites(uid: string) {
  try { const value = JSON.parse(localStorage.getItem(`ohu.food-favorites.${uid || 'guest'}`) || '[]'); return Array.isArray(value) ? value.map(String) : [] } catch { return [] }
}

export function NearbyFoodPage() {
  const auth = useAuth(); const toast = useToast()
  const uid = auth.user?.uid || ''
  const [campuses, setCampuses] = useState<Campus[]>([])
  const [pois, setPois] = useState<Array<CampusPoi & { campusName: string }>>([])
  const [campus, setCampus] = useState('all')
  const [query, setQuery] = useState('')
  const [favorites, setFavorites] = useState<string[]>(() => readFoodFavorites(uid))
  const [position, setPosition] = useState<{lat:number;lng:number} | null>(null)
  const [busy, setBusy] = useState(true)
  const [candidateCount, setCandidateCount] = useState(0)
  const [error, setError] = useState('')
  const [locError, setLocError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  useEffect(() => { setFavorites(readFoodFavorites(uid)) }, [uid])
  useEffect(() => {
    let live = true
    setBusy(true)
    setError('')
    void (async () => {
      try {
        const result = await fetchCampuses('lyg')
        if (!live) return
        setCampuses(result.rows)
        if (result.error) { setError(result.error); return }
        const loaded = await Promise.all(result.rows.map(async item => {
          const [poiResult, localRows] = await Promise.all([fetchCampusPois(item.id), Promise.resolve(readLocalPins(uid, 'lyg', item.id))])
          const allFoodRows = mergeCampusPois(poiResult.rows, localRows).filter(row => row.category.includes('美食'))
          return { rows: allFoodRows.filter(row => row.verification_status === 'verified' && !/农贸|市场|集市/.test(`${row.name} ${row.category}`)).map(row => ({...row, campusName:item.name})), candidateCount: allFoodRows.length, error: poiResult.error }
        }))
        if (!live) return
        const bad = loaded.find(item => item.error)?.error
        setError(bad || '')
        setPois(loaded.flatMap(item => item.rows))
        setCandidateCount(loaded.reduce((count,item)=>count+item.candidateCount,0))
      } catch {
        if (live) setError('附近地点暂时加载失败')
      } finally {
        if (live) setBusy(false)
      }
    })()
    return () => { live = false }
  }, [uid, loadAttempt])
  const visible = useMemo(() => {
    const key = query.trim().toLocaleLowerCase('zh-CN')
    return pois.filter(poi => (campus === 'all' || String(poi.campus_id) === campus) && (!key || `${poi.name} ${poi.campusName} ${poi.note || ''}`.toLocaleLowerCase('zh-CN').includes(key)))
      .map(poi => ({...poi, distance:position ? distanceMeters(position,{lat:poi.lat,lng:poi.lng}) : null}))
      .sort((a,b) => a.distance != null && b.distance != null ? a.distance-b.distance : a.name.localeCompare(b.name,'zh-CN'))
  }, [pois,campus,query,position])
  function locate() {
    setLocError('')
    if (!navigator.geolocation) { setLocError('此设备暂不支持定位，请直接选择校区浏览。'); return }
    navigator.geolocation.getCurrentPosition(value => setPosition({lat:value.coords.latitude,lng:value.coords.longitude}), () => setLocError('没有获取到位置。你仍可按校区查看美食，不会显示虚假距离。'), {enableHighAccuracy:true,timeout:10000,maximumAge:60000})
  }
  function toggleFavorite(poi: CampusPoi) {
    const key = `${poi.campus_id}:${poi.id}`
    const next = favorites.includes(key) ? favorites.filter(value=>value!==key) : [...favorites,key]
    try { localStorage.setItem(`ohu.food-favorites.${uid || 'guest'}`,JSON.stringify(next)); setFavorites(next) } catch { toast.err('本机存储不可用，暂时无法保存收藏') }
  }
  const requireLogin = () => { if (auth.isSigned) return true; auth.openLogin('登录后使用地点导航'); return false }
  return <main className={styles.page}>
    <PageHeader title="附近美食" />
    <section className={styles.foodIntro}><span className={styles.eyebrow}>校园周边 · 真实地点</span><h2>想吃什么，先看看附近</h2><p>地点来自哦狐地图中已录入的餐饮 POI。当前暂不提供点餐或在线支付。</p></section>
    <div className={styles.foodTools}><label className={styles.search}><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索店名或校区" aria-label="搜索店名或校区" /></label><button type="button" className={styles.locateButton} onClick={locate}>{position ? '已按距离排序' : '使用当前位置'}</button></div>
    {locError ? <p className={styles.infoLine} role="status">{locError}</p> : null}
    <div className={styles.campusChips}><button type="button" aria-pressed={campus==='all'} onClick={()=>setCampus('all')}>全部校区</button>{campuses.map(item=><button key={item.id} type="button" aria-pressed={campus===String(item.id)} onClick={()=>setCampus(String(item.id))}>{item.name}</button>)}</div>
    {busy && pois.length ? <p className={styles.infoLine} role="status" aria-live="polite">正在刷新地点；暂时保留已加载结果。</p> : null}
    {busy && !pois.length ? <div className={styles.empty} role="status" aria-live="polite">正在读取地图地点…</div> : error && !pois.length ? <div className={styles.empty} role="alert">{error}<button type="button" disabled={busy} onClick={()=>setLoadAttempt(value=>value+1)}>{busy ? '正在重试…' : '重试加载'}</button></div> : visible.length ? <section className={styles.foodList} aria-label="附近美食地点">{visible.map(poi=>{
      const favoriteKey=`${poi.campus_id}:${poi.id}`
      return <article className={styles.foodCard} key={favoriteKey}>
        {poi.image_urls?.[0] ? <img src={poi.image_urls[0]} alt="" loading="lazy" /> : <div className={styles.foodThumb} aria-hidden="true"><HomeServiceIcon title="附近美食" simple /></div>}
        <div className={styles.foodCopy}><div className={styles.foodTitle}><h2>{poi.name}</h2><button type="button" aria-label={favorites.includes(favoriteKey)?'取消收藏':'收藏地点'} aria-pressed={favorites.includes(favoriteKey)} onClick={()=>toggleFavorite(poi)}>{favorites.includes(favoriteKey)?'♥':'♡'}</button></div><p>{poi.campusName} · {poi.verification_status==='verified'?'已核验':poi.verification_status==='local'?'本机地点':'地图地点'}{poi.distance!=null?` · 距离 ${formatDistance(poi.distance)}`:''}</p>{poi.note?<p className={styles.foodNote}>{poi.note}</p>:null}<small>{poi.source_url?'来源链接已记录':'商家营业时间与人均价格尚未录入'}</small><CampusNavigation poi={poi} onRequireLogin={requireLogin} /></div>
      </article>
    })}</section> : <div className={styles.empty}>{error ? `云端地点读取异常：${error}。` : candidateCount ? `目前有 ${candidateCount} 个待核验美食类地点，包含农贸市场；核验为真实餐饮门店后才会进入推荐。` : '当前还没有经过核验的餐饮地点。'}<span>这里不会把待核验地点或市场冒充成餐厅。你可以在地图添加真实餐饮地点并提交管理员审核。</span>{error ? <button type="button" disabled={busy} onClick={()=>setLoadAttempt(value=>value+1)}>{busy ? '正在重试…' : '重试加载'}</button> : null}<Link to="/campus-map">打开地图提交地点</Link></div>}
    {error && pois.length ? <div className={styles.loadWarning} role="alert"><span>部分地点读取失败：仍显示已加载结果。</span><button type="button" disabled={busy} onClick={()=>setLoadAttempt(value=>value+1)}>{busy ? '正在重试…' : '重试'}</button></div> : null}
    <p className={styles.disclaimer}>地点信息由学校或用户提交，营业时间和价格以商家实际情况为准。</p>
  </main>
}

export function CampusCardPage() {
  return <main className={styles.page}><PageHeader title="校园卡" />
    <section className={styles.resourceHero}><span className={styles.resourceIcon}>▣</span><span className={styles.eyebrow}>江苏海洋大学 · 官方服务</span><h2>校园卡服务</h2><p>校园卡余额、充值、消费流水和挂失由学校及完美校园管理。哦狐不收集卡密，也不代办资金操作。</p><FoxSheetPose pose="phone" className={styles.heroFox} /><small className={styles.foxLine}>阿狐带你去官方入口</small></section>
    <section className={styles.panel}><h2>前往官方服务</h2><a className={styles.primaryLink} href={PERFECT_CAMPUS} target="_blank" rel="noreferrer" onClick={event => { if (!IS_NATIVE || PLATFORM.os !== 'android') return; event.preventDefault(); void openPerfectCampusApp().then(opened => { if (!opened) window.open(PERFECT_CAMPUS, '_blank') }) }}>打开完美校园官方入口 <span>↗</span></a><p className={styles.infoLine}>安卓手机已安装时优先打开完美校园；否则打开官方入口。请在完美校园中选择“江苏海洋大学”。</p><a className={styles.secondaryLink} href={CARD_OFFICIAL} target="_blank" rel="noreferrer">查看江苏海洋大学信息化中心说明 ↗</a><span className={styles.panelFox}><FoxSheetPose pose="waving" /><small>出发前记得带好校园卡</small></span></section>
    <div className={styles.credentialNotice}><b>乘车凭证</b><span>校园班车可凭校园卡或“完美校园”APP 乘车，先到先得。</span></div>
    <p className={styles.source}>学校信息化中心介绍了完美校园的校园卡查询、充值和挂失服务。账号认证与金额操作请在官方系统内完成。</p>
  </main>
}

export function LibraryPage() {
  return <main className={styles.page}><PageHeader title="图书馆座位" />
    <section className={styles.resourceHero}><span className={styles.resourceIcon}>▤</span><span className={styles.eyebrow}>江苏海洋大学图书馆</span><h2>从官方入口预约座位</h2><p>座位预约、现场签到和使用规则由“我去图书馆”系统管理。哦狐不模拟登录，也不代替你选座。</p><FoxSheetPose pose="reading" className={styles.heroFox} /><small className={styles.foxLine}>阿狐陪你找个安静座位</small></section>
    <section className={styles.panel}><h2>预约前先了解</h2><ol className={styles.steps}><li>用手机打开图书馆公布的预约指引。</li><li>按指引扫描页面二维码，进入“我去图书馆”。</li><li>选择江苏海洋大学与校区，再按规则选座。</li><li>到馆后按要求完成蓝牙或二维码签到。</li></ol><a className={styles.primaryLink} href={LIBRARY_GUIDE} target="_blank" rel="noreferrer">打开图书馆官方预约指引 <span>↗</span></a><a className={styles.secondaryLink} href="https://lib.jou.edu.cn/" target="_blank" rel="noreferrer">访问江苏海洋大学图书馆 ↗</a><span className={styles.panelFox}><FoxSheetPose pose="studying" /><small>选座和签到请按图书馆规则操作</small></span></section>
    <p className={styles.source}>预约入口与签到方式参考江苏海洋大学图书馆于 2024-04-16 发布的操作说明。若学校更新了指引，请以图书馆最新通知为准。</p>
  </main>
}
