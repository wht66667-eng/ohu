/** NON-PRODUCTION. Imported only by vite.ui-review.config.ts on the isolated 43127 origin. */
import { useSyncExternalStore } from 'react'
import { selectImSession } from '../src/lib/im-session'
import { saveScheduleCache } from '../src/lib/schedule-cache'
import { chatBubbleTime, chatTopicLabel, chatTopicPath, normMessage } from '../src/lib/chat'
import type { ChatMessageItem } from '../src/lib/chat'

export { chatBubbleTime, chatTopicLabel, chatTopicPath, normMessage }
export const CHAT_MSG_PAGE_SIZE = 30
export const CHAT_PAGE_SIZE = 20
const listeners = new Set<() => void>()
let uid = 'local:ui-review-a', revision = 1, delayMs = 180
let auth = authFor(uid)
function authFor(owner: string) {
  return { isSigned: !!owner, phase: owner ? 'signed' : 'guest', user: owner ? { uid: owner, isAnonymous: false, name: owner.endsWith('b') ? '样例乙' : '样例甲' } : null,
    ensureSignedIn: async () => !!uid }
}
export const subscribeQbank = (notify: () => void) => { listeners.add(notify); return () => { listeners.delete(notify) } }
export const getQbankRevision = () => revision
export const captureQbankSession = () => ({ uid, revision })
export const isQbankSessionCurrent = (session: { uid: string; revision: number }) => session.uid === uid && session.revision === revision
export const useAuth = () => useSyncExternalStore(subscribeQbank, () => auth, () => auth)
export function selectPreviewIdentity(owner: string) {
  if (uid === owner) return
  selectImSession(owner || null)
  uid = owner; revision++; auth = authFor(owner)
  if (owner) seedSchedule()
  listeners.forEach(notify => notify())
}
export const getPreviewIdentity = () => uid
export const setPreviewDelay = (value: number) => { delayMs = value }
export const getPreviewDelay = () => delayMs
const wait = () => new Promise<void>(resolve => setTimeout(resolve, delayMs))

// These are explicit synthetic courses, stored by the real account-owned local cache implementation.
export function seedSchedule() {
  const sample = [
    { day: 1, sections: [1, 2], name: '高等数学 · 本地样例', room: '样例教学楼 A204', teacher: '样例教师甲' },
    { day: 2, sections: [3, 4], name: '大学英语 · 本地样例', room: '样例教学楼 B301', teacher: '样例教师乙' },
    { day: 3, sections: [5, 6], name: '数据结构与算法课程 · 长名称样例', room: '样例实验楼 C405', teacher: '样例教师丙' },
    { day: 3, sections: [9, 10], name: '晚间英语学习 · 本地样例', room: '样例教学楼 B301', teacher: '样例教师乙' },
    { day: 4, sections: [1, 2], name: '线性代数 · 本地样例', room: '样例教学楼 A208', teacher: '样例教师丁' },
    { day: 5, sections: [3, 4], name: '计算机实验 · 本地样例', room: '样例实验楼 D102', teacher: '样例教师戊' },
    { day: 5, sections: [7, 8], name: '校园实践 · 本地样例', room: '样例活动中心', teacher: '样例教师己' },
    { day: 7, sections: [9, 10], name: '周末选修 · 本地样例', room: '样例教学楼 E203', teacher: '样例教师庚' },
  ]
  saveScheduleCache(Array.from({ length: 20 }, (_, i) => sample.map(row => ({ ...row, week: i + 1 }))).flat(), 'UI-REVIEW', captureQbankSession())
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="300" viewBox="0 0 540 300"><rect width="540" height="300" fill="#e6f2ed"/><path d="M0 240L130 130L260 210L380 90L540 200V300H0Z" fill="#96c7b1"/><text x="270" y="55" text-anchor="middle" fill="#164e3c" font-size="26">本地样例图片</text></svg>`
export const sampleImage = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
const captchaSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="52"><rect width="160" height="52" fill="#e6f2ed"/><text x="15" y="36" font-size="24" fill="#164e3c">LOCAL</text></svg>`
export const fetchCaptcha = async () => ({ ok: true, sid: 'NON-PRODUCTION-LOCAL', image: `data:image/svg+xml,${encodeURIComponent(captchaSvg)}` })
export const queryAcademic = async () => { throw new Error('这是本地 UI 样例；教务查询已禁用，请勿填写真实凭据。') }
export const queryTimetable = queryAcademic
export const queryAcademicAuto = queryAcademic
export const runAutoSync = async () => ({ ok: false, needCaptcha: false, passwordWrong: false, message: '本地 UI 样例禁止教务同步，请勿填写真实凭据。', rows: [], grades: [], exams: [] })
export const loadSavedStuid = () => uid ? 'UI-REVIEW' : ''
export const loadSavedPassword = () => ''
export const hasUnboundCampusCredentials = () => false
export const isRememberPasswordEnabled = () => false
export const saveTimetableCredentials = () => false
export const clearSavedPassword = () => {}
export const saveGradesCache = () => true
export const saveExamsCache = () => true
export const rescheduleClassReminders = async () => ({ count: 0, message: '本地样例不安排通知' })
export const rescheduleExamReminders = async () => ({ count: 0 })
export const checkInAppClassPopup = () => null
export const notifyClassNow = async () => ({ count: 0, message: '本地样例禁止系统通知' })

export type PeriodPair = [string, string]
export const DEFAULT_TM: PeriodPair[] = [['08:00', '08:45'], ['08:55', '09:40'], ['10:00', '10:45'], ['10:55', '11:40'], ['14:00', '14:45'], ['14:55', '15:40'], ['15:50', '16:35'], ['16:45', '17:30'], ['17:40', '18:25'], ['19:00', '19:45'], ['19:55', '20:40']]
let periods = DEFAULT_TM.map(pair => [...pair] as PeriodPair), custom = false
export const getOfficialPeriods = () => DEFAULT_TM.map(pair => [...pair] as PeriodPair)
export const loadLocalPeriods = () => periods.map(pair => [...pair] as PeriodPair)
export const isCustomPeriods = () => custom
export const officialSeasonLabel = () => '样例秋冬作息'
export const toMin = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
export const fetchRemotePeriods = async () => null
export const sanitizePeriods = (value: PeriodPair[]) => value.length === 11 && value.every(pair => pair.every(time => /^([01]\d|2[0-3]):[0-5]\d$/.test(time)) && toMin(pair[0]) < toMin(pair[1])) ? value : null
export const savePeriods = async (value: PeriodPair[], options?: { custom?: boolean }) => { periods = value.map(pair => [...pair] as PeriodPair); custom = options?.custom !== false; return { error: null } }

const stores = new Map<string, ChatMessageItem[]>()
function store(owner: string, thread = 7) {
  const key = `${owner}:${thread}`
  if (!stores.has(key)) stores.set(key, Array.from({ length: 100 }, (_, i) => message(i + 1, owner, thread)))
  return stores.get(key)!
}
function message(id: number, owner: string, thread: number, body?: string, image?: string): ChatMessageItem {
  const mine = id % 4 === 0
  return { id, thread_id: thread, sender_uid: mine ? owner : 'local:ui-review-peer', sender_name: mine ? '我 · 样例' : '同学 · 样例', sender_role: 'user',
    body: body ?? `本地样例消息 ${id}：${id % 7 === 0 ? '今天的小组讨论改到下午，我们整理一下课程笔记，再到教学楼一楼见面。' : '这是用于核对聊天气泡、时间和滚动位置的合成内容。'}`,
    kind: image || id % 19 === 0 ? 'image' : 'text', media_url: image || (id % 19 === 0 ? sampleImage : ''),
    created_at: new Date(Date.now() - (101 - id) * 60_000).toISOString(), is_mine: mine }
}
/** Synchronous storage hooks for the guarded message-only fixture; never exported by production code. */
export const getPreviewMessageRows = (owner: string, thread: number) => store(owner, thread).map(row => ({ ...row }))
export function writePreviewMessage(owner: string, thread: number, body: string, image?: string) {
  const list = store(owner, thread), id = (list[list.length - 1]?.id || 0) + 1
  const item = { ...message(id, owner, thread, body, image), created_at: new Date().toISOString(), sender_uid: owner, is_mine: true }
  list.push(item)
  return { ...item }
}
export async function fetchChatMessages(thread: number, limit = 30, before?: number | null) {
  const owner = uid, snapshot = owner ? store(owner, thread).filter(row => before == null || row.id < before).slice(-limit).map(row => ({ ...row })) : []
  const more = owner ? store(owner, thread).some(row => row.id < (snapshot[0]?.id ?? 0)) : false
  await wait()
  return { error: owner ? null : '本地样例已退出', data: { items: snapshot, has_more: more, next_cursor: more ? { before_id: snapshot[0].id } : null } }
}
async function sendLocal(thread: number, body: string, image?: string) {
  const owner = uid
  if (!owner) return { error: '本地样例已退出', data: null }
  await wait()
  const list = store(owner, thread), id = (list[list.length - 1]?.id || 0) + 1
  const item = { ...message(id, owner, thread, body, image), sender_uid: owner, is_mine: true }
  list.push(item)
  return { error: null, data: { message: item, thread: { id: thread } } }
}
export const chatSendMessage = (thread: number, body: string) => sendLocal(thread, body)
export const chatSendImage = (thread: number, image: string) => sendLocal(thread, '[图片]', image)
export const chatMarkRead = async () => ({ error: null, cleared: 0, myUnread: 0 })
export async function queryRows<T>(table: string) {
  const owner = uid
  await wait()
  if (table !== 'chat_threads') return { rows: [] as T[], error: '本地预览未模拟此查询，已阻止远程访问' }
  return { rows: (owner ? [{ id: 7, topic_type: 'plaza_user', topic_id: null, topic_title: '本地样例话题', user_uid: owner, user_name: '样例账号', peer_uid: 'local:ui-review-peer', peer_name: '同学 · 本地样例' }] : []) as T[], error: null }
}
export function appendPreviewMessages(count = 1, thread = 7) {
  if (!uid) return
  const list = store(uid, thread)
  for (let i = 0; i < count; i++) { const id = (list[list.length - 1]?.id || 0) + 1; list.push({ ...message(id, uid, thread, `新到本地样例 ${id}：读历史时应提示，不拉回底部。`), is_mine: false, sender_uid: 'local:ui-review-peer' }) }
}
export const uploadChatImage = async (file: File) => { await wait(); return { error: null, url: URL.createObjectURL(file) } }
export const uploadPlazaImage = uploadChatImage
export const STICKER_LIMIT = 24
export const getStickers = () => []
export const pullStickers = async () => []
export const subscribeStickers = () => () => {}
export const addSticker = (_owner: string, url: string, text = '') => [{ url, text }]
export const removeSticker = () => {}

// Fails closed if an unmocked component accidentally tries to reach a CloudBase client.
export const cbAuth = () => ({ currentUser: auth.user })
export const cbRdb = () => { throw new Error('NON-PRODUCTION UI fixture: remote database disabled') }
export const cbStorage = () => { throw new Error('NON-PRODUCTION UI fixture: remote storage disabled') }

selectImSession(uid)
