/**
 * CloudBase SDK 单例：前端直连上海 PG 环境（个人版）
 * - 认证 auth（v3 supabase-like：username/password 登录 + 手机验证码 OTP）
 * - 关系库 rdb（postgREST 风格 .from(...).select/insert/update 链）
 * - 存储 storage（pgstore 桶，如 images）
 */
import cloudbase from '@cloudbase/js-sdk'

/** 联调环境 EnvId：jou（上海 ap-shanghai，PG 个人版）。正式环境切换时改这里即可 */
export const CB_ENV_ID = 'jou-d4gq7a3cqf51e6caa'
export const CB_REGION = 'ap-shanghai' as const

const app = cloudbase.init({
  env: CB_ENV_ID,
  region: CB_REGION,
  /**
   * 登录态持久化方式：**必须用 local（localStorage），不能用 SDK 默认的 session。**
   *
   * 2026-10-10 事故：图片全部无法上传。链路是这样的——
   *   1. SDK 默认 persistenceTag='session'，会话写进 sessionStorage；
   *   2. Capacitor WebView 冷启动后 sessionStorage 被清，会话读不回来；
   *   3. auth.tsx 的 bootstrap 发现「无会话」，静默 signInAnonymously() 变游客；
   *   4. 而 images 桶所在 `storage.objects` 表的 INSERT 策略 write_check 是
   *      `((auth.role() = 'authenticated') AND (bucket_id = 'images'))`
   *      —— 匿名用户的 auth.role() 不是 'authenticated'，写入被 RLS 拒绝。
   *
   * 实测三种形态：
   *   无会话    → 401 MISSING_CREDENTIALS
   *   匿名会话  → 403 STORAGE_ACCESS_DENIED
   *   （PG RLS error: new row violates row-level security policy for table "objects"）
   *   正式会话  → 200 成功
   * 因此在哪都对：不是路径问题（avatars/ 同样 403），纯粹是角色问题。
   *
   * local 存 localStorage，跨冷启动保留；代价仅是同设备多账号切换需显式登出。
   */
  persistence: 'local',
})

/** auth 客户端实例（同样显式指定 local，避免被 init 之外的默认值覆盖） */
export function cbAuth() {
  return app.auth({ persistence: 'local' })
}

/** PG 关系库客户端（每次调用返回可用 client，可链式 .from(...)） */
export function cbRdb() {
  return app.rdb()
}

/** pgstore 存储客户端（app.storage.from('images')…） */
export function cbStorage() {
  return app.storage
}
