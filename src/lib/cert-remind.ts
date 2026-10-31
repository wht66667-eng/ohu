/**
 * 考证 / 考级提醒：本机日程 + 系统通知 + 到点弹窗检测
 * 通知 id 段 52000–52999，与上课(5xxxx 课)/考试(51000)错开。
 */
import { certCatalog } from '../data/study'
import { ensureAlarmChannel, idleSchedule } from './alarm-notify'
import { captureQbankSession, isQbankSessionCurrent } from './qbank'
import { runPersonalReminder } from './personal-reminders'

export type CertReminder = {
  certId: string
  name: string
  /** 考试/报名截止日 ISO date YYYY-MM-DD */
  date: string
  /** 可选备注，如「笔试」「查分」 */
  note: string
  /** 创建时间 */
  savedAt: string
}

// Unowned v1 reminders are preserved for an explicit future import, never auto-claimed.
const key = (uid: string) => `study.cert-reminders.v2:uid:${encodeURIComponent(uid)}`

export function loadCertReminders(strict = false): CertReminder[] {
  const { uid } = captureQbankSession()
  if (!uid) return []
  try {
    const raw = localStorage.getItem(key(uid))
    if (!raw) return []
    const stored = JSON.parse(raw)
    if (strict && (stored?.ownerUid !== uid || !Array.isArray(stored?.rows))) throw new Error('invalid reminder store')
    const arr = stored?.ownerUid === uid ? stored.rows as CertReminder[] : []
    return Array.isArray(arr) ? arr.filter((r) => typeof r?.certId === 'string' && typeof r?.date === 'string' && !!parseCertAnchor(r.date)) : []
  } catch {
    if (strict) throw new Error('本机考证日期暂时无法读取，原记录仍保留，请重试')
    return []
  }
}

function persist(rows: CertReminder[], session = captureQbankSession()) {
  if (!session.uid || !isQbankSessionCurrent(session)) throw new Error('请登录当前账号后保存考证日期')
  try {
    const target = key(session.uid), encoded = JSON.stringify({ ownerUid: session.uid, rows })
    localStorage.setItem(target, encoded)
    if (localStorage.getItem(target) !== encoded) throw new Error('storage unavailable')
  }
  catch { throw new Error('本机考证日期保存失败，请检查可用存储后重试') }
}

export function upsertCertReminder(input: {
  certId: string
  date: string
  note?: string
}, session = captureQbankSession()): CertReminder {
  if (!session.uid || !isQbankSessionCurrent(session)) throw new Error('账号已变化，请重新保存考证日期')
  if (!parseCertAnchor(input.date)) throw new Error('请填写有效的考证日期')
  const cat = certCatalog.find((c) => c.id === input.certId)
  const name = cat?.name || input.certId
  const next: CertReminder = {
    certId: input.certId,
    name,
    date: input.date,
    note: (input.note || '').trim(),
    savedAt: new Date().toISOString(),
  }
  const rest = loadCertReminders(true).filter((r) => r.certId !== input.certId)
  persist([...rest, next], session)
  return next
}

export function removeCertReminder(certId: string, session = captureQbankSession()) {
  persist(loadCertReminders(true).filter((r) => r.certId !== certId), session)
}

export function getCertReminder(certId: string): CertReminder | null {
  return loadCertReminders().find((r) => r.certId === certId) || null
}

/** 解析本地日期 00:00；考试日默认上午 9 点开考提示锚点 */
export function parseCertAnchor(date: string): Date | null {
  const m = (date || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const dateValue = new Date(+m[1], +m[2] - 1, +m[3], 9, 0, 0, 0)
  return dateValue.getFullYear() === +m[1] && dateValue.getMonth() === +m[2] - 1 && dateValue.getDate() === +m[3] ? dateValue : null
}

export function certCountdown(date: string): { label: string; days: number; past: boolean } {
  const d = parseCertAnchor(date)
  if (!d) return { label: '未设日期', days: 999, past: false }
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const examDay = new Date(d)
  examDay.setHours(0, 0, 0, 0)
  const days = Math.round((examDay.getTime() - startOfToday.getTime()) / 86400_000)
  if (days < 0) return { label: '已过期', days, past: true }
  if (days === 0) return { label: '今天', days: 0, past: false }
  if (days === 1) return { label: '明天', days: 1, past: false }
  return { label: `${days} 天后`, days, past: false }
}

/** 安排系统本地通知：考前 7 天 20:00、前 1 天 20:00、当天 8:00 */
export function rescheduleCertReminders(): Promise<{ count: number; message: string }> {
  return runPersonalReminder('cert', async ({ session, current, plugin, schedule }) => {
  const list = loadCertReminders().filter((r) => !certCountdown(r.date).past)

  try {
    if (plugin) {
      if (!list.length) return { count: 0, message: '已清除系统考证提醒' }
      const perm = await plugin.requestPermissions()
      if (!current()) return { count: 0, message: '账号已变化，旧提醒已撤销' }
      if (perm.display !== 'granted') return { count: 0, message: '未授予通知权限' }

      await ensureAlarmChannel('cert-remind-v2', '考证提醒', '按已保存的考证日期安排本地通知')

      const items: Array<{ id: number; title: string; body: string; at: Date }> = []
      list.slice(0, 333).forEach((r, i) => {
        const start = parseCertAnchor(r.date)
        if (!start) return
        const slots: Array<{ at: Date; title: string }> = []
        const d7 = new Date(start)
        d7.setDate(d7.getDate() - 7)
        d7.setHours(20, 0, 0, 0)
        const d1 = new Date(start)
        d1.setDate(d1.getDate() - 1)
        d1.setHours(20, 0, 0, 0)
        const d0 = new Date(start)
        d0.setHours(8, 0, 0, 0)
        slots.push({ at: d7, title: `考证倒计时 · ${r.name}` })
        slots.push({ at: d1, title: `明天考证 · ${r.name}` })
        slots.push({ at: d0, title: `今日考证 · ${r.name}` })
        slots.forEach((s, j) => {
          if (s.at.getTime() <= Date.now()) return
          items.push({
            id: 52000 + i * 3 + j,
            at: s.at,
            title: s.title,
            body: `${r.date}${r.note ? ` · ${r.note}` : ''} · 记得准考证与文具`,
          })
        })
      })

      if (!items.length) return { count: 0, message: '提醒时间已过，请改日期' }
      const applied = await schedule({
        notifications: items.map((it) => ({
          id: it.id,
          title: it.title,
          body: it.body,
          schedule: idleSchedule(it.at),
          channelId: 'cert-remind-v2',
          extra: { type: 'cert', ownerUid: session.uid, reminderAt: it.at.toISOString(), expiresAt: new Date(it.at.getTime() + 60_000).toISOString() },
        })),
      })
      if (!applied) return { count: 0, message: '账号已变化，旧提醒已撤销' }
      const confirmed = await plugin.getPending()
      if (!current()) return { count: 0, message: '账号已变化，旧提醒已撤销' }
      const ids = new Set(confirmed.notifications.map((item) => item.id))
      const count = items.filter((item) => ids.has(item.id)).length
      return { count, message: count === items.length ? `已安排 ${count} 条考证提醒` : '部分提醒未能安排，请检查系统通知权限后重试' }
    }

    if (!list.length) return { count: 0, message: '暂无考证提醒' }
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      await Notification.requestPermission()
    }
    if (!current()) return { count: 0, message: '账号已变化，旧提醒已撤销' }
    return {
      count: list.length,
      message: `已保存 ${list.length} 项考证日期（打开 App 时会弹窗提醒）`,
    }
  } catch (e) {
    return { count: 0, message: (e as Error).message || '考证提醒安排失败' }
  }
  })
}

/** 应用内：今天 / 明天 / 7 天内到期的考证（用于弹窗） */
export function getDueCertReminders(): CertReminder[] {
  return loadCertReminders().filter((r) => {
    const c = certCountdown(r.date)
    if (c.past) return false
    return c.days <= 7
  })
}

/** 虚拟测试账号样例（不写库，仅本机演示） */
export const VIRTUAL_CERT_DEMO: CertReminder = {
  certId: 'cet4',
  name: '英语四级 CET-4（虚拟试响）',
  date: new Date().toISOString().slice(0, 10),
  note: '虚拟账号演示 · 非真实报名',
  savedAt: new Date().toISOString(),
}
