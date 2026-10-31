import { cbRdb } from './cb'
import { captureQbankSession, isQbankSessionCurrent } from './qbank'
import { classesOnDate, loadScheduleCache, scheduleStudentIdForSnapshot, validateScheduleSnapshot } from './schedule-cache'
import { loadSavedStuid } from './schedule-credentials'
import { isMeetPersonality, type MeetPersonality } from './meet-personality'

export type MeetActivity = 'study' | 'billiards' | 'mahjong' | 'badminton' | 'meal' | 'other'
export type MeetVibe = 'any' | 'E' | 'I'
export type MeetRoom = {
  id: string; code: string; title: string; organizerName: string
  startsOn: string; days: number; durationMinutes: number; activity: MeetActivity
  targetSize: number; campus: string; visibility: 'private' | 'public'; vibe: MeetVibe
  createdAt: string; closedAt: string | null; confirmedStart: string | null; confirmedEnd: string | null
  mine: boolean; detailsVisible: boolean; participantCount: number; personalityMatch: boolean
  participants: { name: string; vibe: MeetVibe; personalityType: MeetPersonality | null }[]
  slotCounts: { slot: string; count: number }[]
}
export type MeetRoomPreview = Pick<MeetRoom, 'id' | 'code' | 'title' | 'startsOn' | 'activity' | 'targetSize' | 'campus' | 'participantCount'> & { personalityMatch: boolean }
export type MeetReply = { name: string; vibe: MeetVibe; personalityType: MeetPersonality | null; preferredPersonality: MeetPersonality | null; slots: string[] }
export type CreateMeetInput = {
  title: string; startsOn: string; days: number; durationMinutes: number; organizerName: string
  activity: MeetActivity; targetSize: number; campus: string; visibility: 'private' | 'public'; vibe: MeetVibe
  personalityType: MeetPersonality | null; preferredPersonality: MeetPersonality | null; slots: string[]
}

const CODE = /^[a-f0-9]{32}$/i
const SLOT = /^\d{4}-\d{2}-\d{2}T(?:0[8-9]|1\d|2[01]):(?:00|30)$/
const ACTIVITIES = new Set<MeetActivity>(['study', 'billiards', 'mahjong', 'badminton', 'meal', 'other'])
const VIBES = new Set<MeetVibe>(['any', 'E', 'I'])
type Json = Record<string, unknown>
function record(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
}
function text(value: unknown): string { return typeof value === 'string' ? value : '' }
function integer(value: unknown): number { return Number.isInteger(value) ? value as number : 0 }
function isMeetVibe(value: unknown): value is MeetVibe { return typeof value === 'string' && VIBES.has(value as MeetVibe) }

function normalizeRoom(value: unknown): MeetRoom {
  const raw = record(value)
  if (!CODE.test(text(raw.code)) || !text(raw.id) || !text(raw.title) || !/^\d{4}-\d{2}-\d{2}$/.test(text(raw.startsOn))
    || !ACTIVITIES.has(raw.activity as MeetActivity) || ![30, 60, 90, 120].includes(integer(raw.durationMinutes))
    || integer(raw.days) < 1 || integer(raw.days) > 7 || integer(raw.targetSize) < 2 || integer(raw.targetSize) > 20
    || (raw.visibility !== 'private' && raw.visibility !== 'public') || !Array.isArray(raw.participants) || !Array.isArray(raw.slotCounts)) {
    throw new Error('活动信息暂时无法读取，请稍后重试')
  }
  return {
    id: text(raw.id), code: text(raw.code).toLowerCase(), title: text(raw.title), organizerName: text(raw.organizerName),
    startsOn: text(raw.startsOn), days: integer(raw.days), durationMinutes: integer(raw.durationMinutes), activity: raw.activity as MeetActivity,
    targetSize: integer(raw.targetSize), campus: text(raw.campus), visibility: raw.visibility, vibe: isMeetVibe(raw.vibe) ? raw.vibe : 'any',
    createdAt: text(raw.createdAt), closedAt: text(raw.closedAt) || null,
    confirmedStart: text(raw.confirmedStart) || null, confirmedEnd: text(raw.confirmedEnd) || null,
    mine: raw.mine === true, detailsVisible: raw.detailsVisible === true, participantCount: integer(raw.participantCount), personalityMatch: raw.personalityMatch === true,
    participants: raw.participants.map((entry: unknown) => record(entry)).map((entry: Json) => ({ name: text(entry.name), vibe: isMeetVibe(entry.vibe) ? entry.vibe : 'any', personalityType: isMeetPersonality(entry.personalityType) ? entry.personalityType : null })),
    slotCounts: raw.slotCounts.map((entry: unknown) => record(entry)).filter((entry: Json) => SLOT.test(text(entry.slot)))
      .map((entry: Json) => ({ slot: text(entry.slot), count: integer(entry.count) })),
  }
}

async function rpc(name: string, params: Json = {}): Promise<unknown> {
  const session = captureQbankSession()
  const result = await (cbRdb() as unknown as { rpc: (name: string, params: Json) => Promise<{ data?: unknown; error?: { message?: string } | null }> }).rpc(name, params)
  if (!isQbankSessionCurrent(session)) throw new Error('账号已切换，请重新操作')
  if (result?.error) throw new Error(result.error.message || '活动服务暂时不可用，请稍后重试')
  if (result?.data == null) throw new Error('活动服务暂时不可用，请稍后重试')
  return result.data
}
function roomValue(value: unknown): MeetRoom {
  return normalizeRoom(Array.isArray(value) && value.length === 1 ? value[0] : value)
}
function roomList(value: unknown): MeetRoom[] {
  if (!Array.isArray(value)) throw new Error('活动列表暂时无法读取，请稍后重试')
  return value.map(normalizeRoom)
}
function previewList(value: unknown): MeetRoomPreview[] {
  return roomList(value).map(({ id, code, title, startsOn, activity, targetSize, campus, participantCount, personalityMatch }) =>
    ({ id, code, title, startsOn, activity, targetSize, campus, participantCount, personalityMatch }))
}
function storageKey(code: string, owner: string): string {
  return `ohu.meet.reply.v1:${encodeURIComponent(owner || 'guest')}:${code.toLowerCase()}`
}
type StoredReply = MeetReply & { token: string }
function readStored(code: string, owner = captureQbankSession().uid): StoredReply | null {
  try {
    const raw = record(JSON.parse(localStorage.getItem(storageKey(code, owner)) || 'null'))
    if (!/^[a-f0-9]{64}$/i.test(text(raw.token))) return null
    return { token: text(raw.token), name: text(raw.name), vibe: isMeetVibe(raw.vibe) ? raw.vibe : 'any',
      personalityType: isMeetPersonality(raw.personalityType) ? raw.personalityType : null,
      preferredPersonality: isMeetPersonality(raw.preferredPersonality) ? raw.preferredPersonality : null,
      slots: Array.isArray(raw.slots) ? raw.slots.filter((slot): slot is string => typeof slot === 'string' && SLOT.test(slot)) : [] }
  } catch { return null }
}
function saveStored(code: string, data: StoredReply, owner = captureQbankSession().uid): void {
  try {
    const key = storageKey(code, owner); const encoded = JSON.stringify(data)
    localStorage.setItem(key, encoded)
    if (localStorage.getItem(key) !== encoded) throw new Error()
  } catch { throw new Error('本机无法保存参与记录，请检查浏览器存储设置') }
}
function generateToken(): string {
  if (!globalThis.crypto?.getRandomValues) throw new Error('当前浏览器无法安全保存参与记录，请使用新版浏览器')
  const bytes = new Uint8Array(32); globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}
function normalizedReply(input: MeetReply): MeetReply {
  const name = input.name.trim()
  if (!name || name.length > 24) throw new Error('请填写 1–24 字的昵称')
  if (!isMeetVibe(input.vibe)) throw new Error('请选择性格偏好')
  if (input.personalityType !== null && !isMeetPersonality(input.personalityType)) throw new Error('人格类型无效')
  if (input.preferredPersonality !== null && !isMeetPersonality(input.preferredPersonality)) throw new Error('搭子人格偏好无效')
  if (!Array.isArray(input.slots) || input.slots.length === 0 || input.slots.length > 196 || input.slots.some((slot) => !SLOT.test(slot))) throw new Error('请先选择愿意参加的时间')
  return { name, vibe: input.vibe, personalityType: input.personalityType, preferredPersonality: input.preferredPersonality, slots: [...new Set(input.slots)].sort() }
}
export function readMeetReply(code: string): MeetReply | null {
  if (!CODE.test(code)) return null
  const result = readStored(code)
  return result?.name ? { name: result.name, vibe: result.vibe, personalityType: result.personalityType, preferredPersonality: result.preferredPersonality, slots: result.slots } : null
}

export async function createMeet(input: CreateMeetInput): Promise<MeetRoom> {
  const reply = normalizedReply({ name: input.organizerName, vibe: input.vibe, personalityType: input.personalityType, preferredPersonality: input.preferredPersonality, slots: input.slots })
  if (!captureQbankSession().uid) throw new Error('请先登录哦狐再发起活动')
  const token = generateToken()
  const value = await rpc('meet_create', {
    p_title: input.title.trim(), p_starts_on: input.startsOn, p_days: input.days, p_duration_minutes: input.durationMinutes,
    p_organizer_name: reply.name, p_activity: input.activity, p_target_size: input.targetSize, p_campus: input.campus.trim(),
    p_visibility: input.visibility, p_vibe: reply.vibe, p_slots: reply.slots, p_token: token,
    p_personality_type: reply.personalityType, p_preferred_personality: reply.preferredPersonality,
  })
  const room = roomValue(value)
  // The signed-in organizer can recover their response via their account on another device.
  try { saveStored(room.code, { ...reply, token }) } catch { /* The server has already created the activity. */ }
  return room
}
export async function getMeet(code: string): Promise<MeetRoom> {
  if (!CODE.test(code)) throw new Error('活动链接不完整')
  const reply = readStored(code)
  return roomValue(await rpc('meet_get_member', { p_code: code.toLowerCase(), p_token: reply?.token || null }))
}
export async function respondMeet(code: string, input: MeetReply): Promise<MeetRoom> {
  if (!CODE.test(code)) throw new Error('活动链接不完整')
  const reply = normalizedReply(input)
  const previous = readStored(code)
  const token = previous?.token || generateToken()
  // Store the capability before submitting. A guest can still edit a confirmed reply after a network interruption.
  if (!previous) saveStored(code, { token, name: '', vibe: 'any', personalityType: null, preferredPersonality: null, slots: [] })
  const room = roomValue(await rpc('meet_respond', { p_code: code.toLowerCase(), p_name: reply.name, p_token: token, p_slots: reply.slots, p_vibe: reply.vibe, p_personality_type: reply.personalityType, p_preferred_personality: reply.preferredPersonality }))
  try { saveStored(code, { ...reply, token }) } catch { /* The accepted server response remains valid. */ }
  return room
}
export async function listMyMeets(): Promise<MeetRoom[]> { return roomList(await rpc('meet_list')) }
export async function discoverMeets(input: { campus: string; activity: '' | MeetActivity; slots: string[]; preferredVibe?: MeetVibe; personalityType?: MeetPersonality | null; preferredPersonality?: MeetPersonality | null }): Promise<MeetRoomPreview[]> {
  if (!input.campus.trim()) throw new Error('请先填写学校')
  if (!input.slots.length) throw new Error('请先选择愿意参加的时间')
  if (!captureQbankSession().uid) throw new Error('请先登录哦狐账号')
  return previewList(await rpc('meet_discover', { p_campus: input.campus.trim(), p_activity: input.activity, p_slots: input.slots, p_preferred_vibe: input.preferredVibe || 'any', p_personality_type: input.personalityType || null, p_preferred_personality: input.preferredPersonality || null }))
}

/** Offer course-free half hours as a draft. The user still reviews and submits them. */
export function suggestMeetTimesFromSchedule(startsOn: string, days: number): string[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startsOn)
  if (!match || !Number.isInteger(days) || days < 1 || days > 7) throw new Error('请选择有效的活动日期')
  const owner = captureQbankSession().uid
  if (!owner) throw new Error('登录并同步自己的课表后，就能参考没课时间；也可以直接手动选择')
  const first = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)
  if (!Number.isFinite(first.getTime()) || first.getFullYear() !== Number(match[1]) || first.getMonth() + 1 !== Number(match[2]) || first.getDate() !== Number(match[3])) throw new Error('请选择有效的活动日期')
  const snapshot = loadScheduleCache()
  const studentId = scheduleStudentIdForSnapshot(snapshot, loadSavedStuid(), owner)
  const pad = (n: number) => String(n).padStart(2, '0')
  const result: string[] = []
  for (let index = 0; index < days; index++) {
    const date = new Date(first); date.setDate(first.getDate() + index)
    if (validateScheduleSnapshot(snapshot, studentId, date, undefined, owner).status !== 'ready') {
      throw new Error('课表尚未同步，或所选日期不在课表覆盖范围内；请先同步课表或手动选择')
    }
    const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    const busy = classesOnDate(date, snapshot.rows)
    for (let minute = 8 * 60; minute < 22 * 60; minute += 30) {
      const slot = `${key}T${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`
      const instant = new Date(`${slot}:00+08:00`)
      if (instant.getTime() <= Date.now()) continue
      if (!busy.some((course) => minute < course.endMin && minute + 30 > course.startMin)) result.push(slot)
    }
  }
  return result
}
export async function confirmMeet(code: string, start: string): Promise<MeetRoom> {
  return roomValue(await rpc('meet_confirm', { p_code: code.toLowerCase(), p_start: start }))
}
export async function closeMeet(code: string): Promise<MeetRoom> {
  return roomValue(await rpc('meet_close', { p_code: code.toLowerCase() }))
}
export async function leaveMeet(code: string): Promise<MeetRoom> {
  if (!CODE.test(code)) throw new Error('活动链接不完整')
  const owner = captureQbankSession().uid
  const stored = readStored(code, owner)
  if (!stored && !owner) throw new Error('未找到本机参与记录，无法退出')
  const room = roomValue(await rpc('meet_leave', { p_code: code.toLowerCase(), p_token: stored?.token || generateToken() }))
  try { localStorage.removeItem(storageKey(code, owner)) } catch { /* Server has already released the place. */ }
  return room
}

function chinaSlot(date: Date): string {
  return new Date(date.getTime() + 8 * 60 * 60_000).toISOString().slice(0, 16)
}
/** Recommend only continuous slots every current participant explicitly selected. */
export function recommendedMeetSlots(room: MeetRoom): { start: string; end: string }[] {
  if (room.participantCount < 2) return []
  const counts = new Map(room.slotCounts.map(({ slot, count }) => [slot, count]))
  const stepCount = room.durationMinutes / 30
  const result: { start: string; end: string }[] = []
  for (const slot of [...counts.keys()].sort()) {
    const start = new Date(`${slot}:00+08:00`)
    if (!Number.isFinite(start.getTime()) || chinaSlot(start) !== slot || start.getTime() <= Date.now()) continue
    const end = new Date(start.getTime() + room.durationMinutes * 60_000)
    const endSlot = chinaSlot(end)
    if (endSlot.slice(0, 10) !== slot.slice(0, 10) || endSlot.slice(11) > '22:00') continue
    const allFree = Array.from({ length: stepCount }, (_, i) => chinaSlot(new Date(start.getTime() + i * 30 * 60_000)))
      .every((key) => counts.get(key) === room.participantCount)
    if (allFree) result.push({ start: slot, end: endSlot })
  }
  return result
}
