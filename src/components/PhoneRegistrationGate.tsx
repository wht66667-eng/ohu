import { useEffect, useState, type FormEvent } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { PasswordInput } from './PasswordInput'
import { FoxRequestIndicator } from './fox/FoxRequestIndicator'
import { useAuth } from '../lib/auth'
import { enterMotion } from '../lib/motion-pref'
import {
  ACCOUNT_INVALID_HINT,
  ACCOUNT_LABEL,
  ACCOUNT_PLACEHOLDER,
  EMAIL_DISABLED_HINT,
  EMAIL_LOGIN,
} from '../lib/feature-flags'
import styles from './CampusGate.module.css'

interface PhoneRegistrationGateProps {
  onUnlocked: () => void
}

/**
 * login = 账号 + 密码（主路径）；register = 验证码注册；reset = 验证码进来后重设密码。
 * 登录与注册共用一个账号框：11 位数字按手机号走，带 @ 的按邮箱走。
 */
type GateView = 'login' | 'register' | 'reset'

/** 账号类型自动识别：决定发短信还是发邮件、走哪个登录接口 */
function accountKind(acc: string): 'phone' | 'email' | 'username' | '' {
  const v = acc.trim()
  if (!v) return ''
  if (/^1\d{10}$/.test(v)) return 'phone'
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return 'email'
  return 'username'
}

const REMEMBER_KEY = 'ohhu-remember-account'

/** 「记住账号」只存账号字符串，密码与 token 都不落地 */
function readRemembered(): string {
  try { return localStorage.getItem(REMEMBER_KEY) || '' } catch { return '' }
}
function writeRemembered(acc: string) {
  try {
    if (acc) localStorage.setItem(REMEMBER_KEY, acc)
    else localStorage.removeItem(REMEMBER_KEY)
  } catch { /* 隐私模式或存储被禁时忽略 */ }
}

/**
 * 学生端开屏门禁。
 * - 登录：手机号或邮箱 + 密码（**不发短信也不发邮件**，日常零成本）
 * - 注册 / 忘记密码：验证码核验，这两个场景才发短信或邮件
 * - 邮箱通道受 EMAIL_LOGIN 开关控制：关着时输入邮箱直接提示，不发码也不放行
 * 正方教务（学号 + 教务密码）不用于登录，已移到「课表」页绑定同步。
 *
 * 挂载现状（2026-10-14）：学生端**已不再开屏挂这个门**（启动直接进 App，设置等公开内容随便看），
 * 登录 / 注册按需走 `ensureSignedIn` → `<AuthSheets />` 的 LoginSheet。本组件保留可随时挂回。
 */
export function PhoneRegistrationGate({ onUnlocked }: PhoneRegistrationGateProps) {
  const auth = useAuth()
  const reduce = useReducedMotion()
  const cardMotion = enterMotion(!!reduce)
  const [view, setView] = useState<GateView>('login')
  const [account, setAccount] = useState(() => readRemembered())
  const [remember, setRemember] = useState(() => !!readRemembered())
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [count, setCount] = useState(0)
  const [request, setRequest] = useState<'login' | 'send-code' | 'verify-code' | null>(null)
  const busy = request !== null
  const [err, setErr] = useState('')
  const kind = accountKind(account)

  useEffect(() => {
    if (count <= 0) return
    const t = window.setTimeout(() => setCount((c) => c - 1), 1000)
    return () => window.clearTimeout(t)
  }, [count])

  /** 换视图时清掉验证码与倒计时，避免上一场景的中间态串进来 */
  function go(next: GateView) {
    if (busy) return
    setView(next)
    setErr('')
    setCodeSent(false)
    setCount(0)
    setCode('')
  }

  /** 按账号类型自动发短信或邮件验证码（只在注册 / 找回密码时调用） */
  async function sendVerify() {
    if (busy) return
    setErr('')
    if (kind === 'email' && !EMAIL_LOGIN) {
      setErr(EMAIL_DISABLED_HINT)
      return
    }
    if (kind !== 'phone' && kind !== 'email') {
      setErr(ACCOUNT_INVALID_HINT)
      return
    }
    setRequest('send-code')
    try {
      const e = kind === 'phone'
        ? await auth.sendPhoneCode(account)
        : await auth.sendEmailCode(account)
      if (e) { setErr(e); return }
      setCodeSent(true)
      setCount(60)
    } catch (error) {
      setErr(error instanceof Error ? error.message : '验证码发送失败，请重试')
    } finally { setRequest(null) }
  }

  async function submitVerify(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setErr('')
    if (kind === 'email' && !EMAIL_LOGIN) {
      setErr(EMAIL_DISABLED_HINT)
      return
    }
    if (!code.trim()) {
      setErr('请输入验证码')
      return
    }
    setRequest('verify-code')
    try {
      const e2 = kind === 'phone'
        ? await auth.submitPhoneCode(code)
        : await auth.submitEmailCode(code)
      if (e2) { setErr(e2); return }
      writeRemembered(remember ? account.trim() : '')
      onUnlocked()
    } catch (error) {
      setErr(error instanceof Error ? error.message : '验证码验证失败，请重试')
    } finally { setRequest(null) }
  }

  async function submitLogin(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setErr('')
    if (kind === 'email' && !EMAIL_LOGIN) {
      setErr(EMAIL_DISABLED_HINT)
      return
    }
    if (!account.trim() || !password) {
      setErr('请输入账号与密码')
      return
    }
    setRequest('login')
    try {
      const e2 = await auth.loginWithPassword(account, password)
      if (e2) { setErr(e2); return }
      writeRemembered(remember ? account.trim() : '')
      onUnlocked()
    } catch (error) {
      setErr(error instanceof Error ? error.message : '登录失败，请重试')
    } finally { setRequest(null) }
  }

  return (
    <div className={styles.mask} role="dialog" aria-modal="true" aria-label="登录阳光校园">
      <motion.div className={styles.card} {...cardMotion}>
        <h1>欢迎来到阳光校园</h1>
        <p className={styles.lead}>
          {view === 'login'
            ? EMAIL_LOGIN
              ? '用手机号或邮箱加密码登录。还没有账号？点下方「去注册」。'
              : '用手机号加密码登录。还没有账号？点下方「去注册」。'
            : EMAIL_LOGIN
              ? '用手机号或邮箱接收验证码，验证通过即可完成注册。'
              : '用手机号接收验证码，验证通过即可完成注册。'}
        </p>

        {view === 'login' ? (
          <form onSubmit={submitLogin}>
            <label className={styles.field}>
              <span>{ACCOUNT_LABEL}</span>
              <input
                className={styles.input}
                placeholder={ACCOUNT_PLACEHOLDER}
                autoComplete="username"
                value={account}
                onChange={(e) => setAccount(e.target.value.trim())}
                disabled={busy}
              />
            </label>
            <label className={styles.field}>
              <span>密码</span>
              <PasswordInput
                className={styles.input}
                placeholder="登录密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className={styles.remember}>
              <input
                type="checkbox"
                checked={remember}
                disabled={busy}
                onChange={(e) => {
                  setRemember(e.target.checked)
                  /* 取消勾选立刻抹掉已存的账号 */
                  if (!e.target.checked) writeRemembered('')
                }}
              />
              <span>记住账号</span>
            </label>
            <button className={styles.btn} type="submit" disabled={busy} aria-busy={request === 'login'}>
              {request === 'login' ? <FoxRequestIndicator label="正在登录…" pose="waving" /> : '登录'}
            </button>
          </form>
        ) : (
          <form onSubmit={submitVerify}>
            <label className={styles.field}>
              <span>{ACCOUNT_LABEL}</span>
              <input
                className={styles.input}
                placeholder={ACCOUNT_PLACEHOLDER}
                autoComplete="username"
                value={account}
                onChange={(e) => setAccount(e.target.value.trim())}
                disabled={codeSent || busy}
              />
            </label>
            {codeSent ? (
              <label className={styles.field}>
                <span>验证码</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className={styles.input}
                    autoComplete="one-time-code"
                    maxLength={8}
                    placeholder={kind === 'email' ? '邮箱里的验证码' : '短信里的验证码'}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/[^0-9a-zA-Z]/g, '').slice(0, 8))}
                    disabled={busy}
                    style={{ flex: 1 }}
                    autoFocus
                  />
                  <button
                    type="button"
                    className={styles.btnGhost}
                    disabled={count > 0 || busy}
                    onClick={() => void sendVerify()}
                    aria-busy={request === 'send-code'}
                  >
                    {request === 'send-code' ? <FoxRequestIndicator label="发送中…" /> : count > 0 ? `${count}s` : '重发'}
                  </button>
                </div>
              </label>
            ) : null}
            <p className={styles.hint}>
              验证码只在注册和找回密码时发送；日常登录用密码，不消耗短信与邮件额度。
            </p>
            {codeSent ? (
              <button className={styles.btn} type="submit" disabled={busy || !code.trim()} aria-busy={request === 'verify-code'}>
                {request === 'verify-code' ? <FoxRequestIndicator label="正在验证…" /> : view === 'reset' ? '验证并重置' : '注册 / 登录'}
              </button>
            ) : (
              <button
                className={styles.btn}
                type="button"
                disabled={busy}
                onClick={() => void sendVerify()}
                aria-busy={request === 'send-code'}
              >
                {request === 'send-code' ? <FoxRequestIndicator label="发送中…" /> : '获取验证码'}
              </button>
            )}
          </form>
        )}

        {err ? <p className={styles.err} role="alert">{err}</p> : null}

        {/*
          邮箱验证码需要在控制台「身份认证 → 登录方式」先开启，没开时服务端会直接拒。
          这时给一条明确出口，别让用户在死路上重发。
        */}
        {view !== 'login' && err && /邮箱|email|未开启|not found/i.test(err) ? (
          <button type="button" className={styles.btnGhost} disabled={busy} onClick={() => { setErr(''); setAccount('') }}>
            换用手机号注册
          </button>
        ) : null}

        <p className={styles.footer}>
          {view === 'login' ? (
            <>
              没有账号？
              <button type="button" className={styles.link} disabled={busy} onClick={() => go('register')}>去注册</button>
              <span className={styles.dot} aria-hidden="true">|</span>
              <button type="button" className={styles.link} disabled={busy} onClick={() => go('reset')}>忘记密码</button>
            </>
          ) : (
            <>
              已有账号？
              <button type="button" className={styles.link} disabled={busy} onClick={() => go('login')}>去登录</button>
            </>
          )}
        </p>

        <p className={styles.hint} style={{ marginTop: 10, marginBottom: 0 }}>
          登录即表示同意<a href="/terms" target="_blank" rel="noreferrer">用户协议</a>和
          <a href="/privacy" target="_blank" rel="noreferrer">隐私政策</a>
        </p>
      </motion.div>
    </div>
  )
}
