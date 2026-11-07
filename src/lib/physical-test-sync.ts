import { TIMETABLE_API_BASE } from './timetable'
import { captureQbankSession, isQbankSessionCurrent } from './qbank'
import { withTimeout } from './abort-signal'
import { savePhysicalTestBatch, type PhysicalTestRecord } from './physical-test-results'

async function post(path: string, body: unknown, signal: AbortSignal) {
  const r = await fetch(`${TIMETABLE_API_BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: withTimeout(signal, 55_000),
  })
  const data = await r.json().catch(() => null)
  if (!r.ok || data?.ok !== true) throw new Error(typeof data?.message === 'string' ? data.message : r.status === 404 ? '体测同步接口尚未部署，请稍后再试。' : '体测系统暂不可达，原记录已保留。')
  return data
}
export async function physicalSyncAvailable(signal: AbortSignal) {
  const r = await fetch(`${TIMETABLE_API_BASE}/api/integrations/capabilities`, { signal: withTimeout(signal, 10_000) })
  const data = await r.json().catch(() => null)
  return r.ok && data?.ok === true && data?.physical?.enabled === true
}
export async function preparePhysicalSync(signal: AbortSignal): Promise<{ sid: string; image: string | null }> {
  const data = await post('/api/physical/captcha', {}, signal)
  if (typeof data.sid !== 'string' || !data.sid || data.image !== null && (typeof data.image !== 'string' || !/^data:image\/(png|jpeg|gif);base64,/.test(data.image))) throw new Error('体测验证码返回异常，请重试。')
  return { sid: data.sid, image: data.image }
}
export async function queryPhysicalSync(sid: string, username: string, password: string, captcha: string, signal: AbortSignal): Promise<PhysicalTestRecord[]> {
  const session = captureQbankSession()
  if (!session.uid) throw new Error('请先登录哦狐再保存体测成绩。')
  const data = await post('/api/physical/query', { sid, username: username.trim(), password, captcha: captcha.trim(), consent: true, httpConsent: true }, signal)
  if (!isQbankSessionCurrent(session)) throw new Error('账号已切换，本次成绩没有保存。')
  if (data.source !== 'jou-tice' || !Array.isArray(data.records)) throw new Error('体测成绩来源或格式异常，未写入数据。')
  return savePhysicalTestBatch(data.records, session)
}
