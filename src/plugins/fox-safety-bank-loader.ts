import type { SafetyQuestion } from './fox-safety'

let pending: Promise<SafetyQuestion[]> | undefined

/** Fixed bundled asset, available in the APK without contacting the fox server. */
export function loadBundledSafetyBank(): Promise<SafetyQuestion[]> {
  if (pending) return pending
  const abort = new AbortController()
  const timer = window.setTimeout(() => abort.abort(), 12000)
  pending = fetch(new URL('./data/fox-safety-bank.json', import.meta.url), { signal: abort.signal })
    .then(async response => {
      if (!response.ok) throw new Error('内置题库加载失败，请重试。')
      const data = await response.json() as { schemaVersion?: number; questions?: SafetyQuestion[] }
      if (data.schemaVersion !== 1 || !Array.isArray(data.questions) || !data.questions.length) throw new Error('内置题库格式不正确，请更新哦狐。')
      return data.questions
    }).catch(() => { pending = undefined; throw new Error('内置题库未能加载，请重试。网页版首次打开需要加载资源，APK 使用随包题库。') })
    .finally(() => window.clearTimeout(timer))
  return pending
}
