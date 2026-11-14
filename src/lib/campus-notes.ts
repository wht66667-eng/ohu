import { cbRdb } from './cb'

export const NOTE_CATEGORIES = { partner: '找搭子', lost: '失物招领', help: '求助', event: '校园活动' } as const
export type CampusNoteCategory = keyof typeof NOTE_CATEGORIES
export type CampusNote = {
  id: number
  category: CampusNoteCategory
  body: string
  status: 'open' | 'expired' | 'resolved' | 'withdrawn' | 'hidden'
  created_at: string
  expires_at: string
  mine: boolean
}

const PAGE_SIZE = 30
const errors = {
  campus_note_session_required: '访客会话已失效，请刷新便签墙后重试。',
  campus_note_request_conflict: '这次发布请求已使用，请修改便签内容后重试。',
  campus_note_invalid: '请检查便签内容，最多 280 字。',
  campus_note_write_restricted: '当前账号暂时无法发便签。',
  campus_note_rate_limit: '一天最多发布 5 条便签。',
}

const DEVICE_KEY = 'ohu.campus-notes.device.v1'
let deviceKey = ''

function noteDeviceKey() {
  if (deviceKey) return deviceKey
  try {
    const saved = localStorage.getItem(DEVICE_KEY)
    if (saved && /^[0-9a-f]{64}$/.test(saved)) return deviceKey = saved
  } catch { /* Private browsing may disable persistent storage. */ }
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  deviceKey = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  try { localStorage.setItem(DEVICE_KEY, deviceKey) } catch { /* Retain ownership for this session. */ }
  return deviceKey
}

async function request(name: string, args: Record<string, unknown>) {
  const client = cbRdb() as unknown as { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data?: unknown; error?: unknown }> }
  const result = await client.rpc(name, { ...args, p_device_key: noteDeviceKey() })
  if (result.error) {
    const message = typeof result.error === 'string' ? result.error : String((result.error as { message?: unknown }).message ?? '')
    const rpcCode = typeof result.error === 'object' ? (result.error as { code?: string }).code : undefined
    if (rpcCode === 'PGRST202' || rpcCode === '42883' || /could not find the function/i.test(message)) {
      throw new Error('便签墙服务暂未接通，可以先写本机便签。')
    }
    const code = (Object.keys(errors) as (keyof typeof errors)[]).find(item => message.includes(item))
    throw new Error(code ? errors[code] : '便签服务暂不可用，请稍后重试。')
  }
  return result.data
}

export async function listCampusNotes(mine: boolean, before?: number) {
  const data = await request('campus_notes_public_list', { p_before: before ?? null, p_mine: mine })
  if (!Array.isArray(data)) throw new Error('便签列表暂时无法读取。')
  const rows = data.map(row => ({ ...row, id: Number(row.id) })) as CampusNote[]
  return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE }
}

export async function publishCampusNote(category: CampusNoteCategory, body: string, requestId: string) {
  const id = Number(await request('campus_notes_public_publish', { p_request_id: requestId, p_category: category, p_body: body }))
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('未确认发布结果，请用同一条便签重试。')
}

export async function closeCampusNote(id: number, status: 'resolved' | 'withdrawn') {
  if (await request('campus_notes_public_close', { p_id: id, p_status: status }) !== true) throw new Error('这条便签已经结束或不可操作。')
}

export async function reportCampusNote(id: number) {
  if (await request('campus_notes_public_report', { p_id: id }) !== true) throw new Error('这条便签已不可举报。')
}
