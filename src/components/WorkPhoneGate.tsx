import { useEffect, useRef, useState, type FormEvent } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { PasswordInput } from './PasswordInput'
import { useAuth } from '../lib/auth'
import { getAppShell, SHELL_META } from '../lib/app-shell'
import { enterMotion } from '../lib/motion-pref'
import { isAdminShell } from '../lib/work-access'
import { captureImSession, currentImSession } from '../lib/im-session'
import { isFoxFreeVariant, useUiVariant } from '../lib/ui-variant'
import styles from './CampusGate.module.css'

type Tab = 'apply' | 'login'
type LoginMode = 'code' | 'pwd'

/** A signed account without confirmed work access must retain a way to retry or change accounts. */
export function WorkAccessGate() {
  const auth = useAuth()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const alive = useRef(true)
  const pending = useRef(false)
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const mountedOwner = useRef(captureImSession(uid))
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const booting = auth.phase === 'booting'
  const confirmed = auth.profile !== null

  function retryPermissions() {
    if (!alive.current || pending.current || uid && !currentImSession(mountedOwner.current)) return
    pending.current = true; setBusy('retry'); setError('')
    try {
      // Auth owns role reads; reloading preserves the session and retries that existing flow.
      window.location.reload()
    } catch {
      pending.current = false; setBusy(''); setError('暂时无法重新检查权限，请重试或退出后重新登录。')
    }
  }

  async function changeAccount() {
    const owner = captureImSession(uid)
    if (!alive.current || pending.current || !owner || !currentImSession(mountedOwner.current)) return
    pending.current = true; setBusy('logout'); setError('')
    try {
      await auth.logout()
      // Auth selects the guest state. Do not navigate or open login before logout finishes.
    } catch (cause) {
      if (alive.current && currentImSession(owner)) setError((cause as Error)?.message || '退出未完成，请重试。')
    } finally {
      pending.current = false
      if (alive.current && currentImSession(owner)) setBusy('')
    }
  }

  return <div className={styles.mask} role="dialog" aria-modal="true" aria-labelledby="work-access-title" aria-busy={!!busy || booting}>
    <section className={styles.card}>
      <h1 id="work-access-title">{booting ? '正在恢复登录状态' : confirmed ? '当前账号没有管理权限' : '管理员权限尚未确认'}</h1>
      <p className={styles.lead}>{booting ? '正在确认管理端账号，请稍候。长时间没有完成时，可以重新检查。' : confirmed ? '这个账号暂不能进入管理端。请联系站长开通管理员权限，或退出后使用已开通的账号登录。' : '权限可能尚在读取或暂时无法确认。请重新检查；仍无法进入时，可联系站长或退出后重新登录。'}</p>
      <button type="button" className={styles.btn} disabled={!!busy} onClick={retryPermissions}>{busy === 'retry' ? '正在重新检查…' : '重新检查权限'}</button>
      {auth.isSigned ? <button type="button" className={styles.btnGhost} disabled={!!busy} onClick={() => void changeAccount()}>{busy === 'logout' ? '正在退出…' : '退出并更换账号'}</button> : null}
      {error ? <p className={styles.err} role="alert">{error}</p> : null}
    </section>
  </div>
}

/**
 * 工作端开屏：先申请入驻，管理员通过后再登录进入工作台。
 * 学生端走 PhoneRegistrationGate（手机号注册 / 密码登录）。
 */
export function WorkPhoneGate() {
  const foxfree = isFoxFreeVariant(useUiVariant())
  const auth = useAuth()
  const reduce = useReducedMotion()
  const cardMotion = enterMotion(!!reduce)
  const shell = getAppShell()
  const title = SHELL_META[shell]?.label || '哦狐'
  const [tab, setTab] = useState<Tab>(() => isAdminShell(shell) ? 'login' : 'apply')
  const [loginMode, setLoginMode] = useState<LoginMode>('code')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (count <= 0) return
    const t = window.setTimeout(() => setCount((c) => c - 1), 1000)
    return () => window.clearTimeout(t)
  }, [count])

  async function sendCode() {
    if (count > 0 || busy) return
    setMsg('')
    setBusy(true)
    const e = await auth.sendPhoneCode(phone)
    setBusy(false)
    if (e) {
      setMsg(e)
      return
    }
    setCount(60)
    setMsg('验证码已发送，请查收短信')
  }

  async function onApplyCode(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setMsg('')
    setBusy(true)
    const err = await auth.submitPhoneCode(code)
    setBusy(false)
    if (err) {
      setMsg(err)
      return
    }
    if (isAdminShell(shell)) {
      setMsg('管理员账号需站长开通后使用「已通过登录」')
      await auth.logout()
      return
    }
    setMsg('验证成功，请填写入驻资料…')
  }

  async function onLoginCode(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setMsg('')
    setBusy(true)
    const err = await auth.submitPhoneCode(code)
    setBusy(false)
    if (err) {
      setMsg(err)
      return
    }
    setMsg('登录成功，正在校验权限…')
  }

  async function onPwdSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setMsg('')
    setBusy(true)
    const err = await auth.loginWithPassword(phone.trim(), password)
    setBusy(false)
    if (err) {
      setMsg(err)
      return
    }
    setMsg('登录成功，正在校验权限…')
  }

  return (
    <div className={styles.mask} role="dialog" aria-modal="true" aria-label="工作端入驻">
      <motion.div className={styles.card} {...cardMotion}>
        {foxfree ? null : <img
          src={`${import.meta.env.BASE_URL}pixel-fox/guide.png`}
          alt=""
          style={{ width: 88, height: 'auto', display: 'block', margin: '0 auto 8px' }}
        />}
        <h1>{title}</h1>
        <p className={styles.lead}>
          本端使用<strong>手机号</strong>。<strong>先申请入驻</strong>，管理员通过后才能登录工作台。
          学生用户端才用学号。
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button
            type="button"
            className={tab === 'apply' ? styles.btn : styles.btnGhost}
            style={{ flex: 1, marginTop: 0 }}
            onClick={() => {
              setTab('apply')
              setMsg('')
            }}
          >
            先申请
          </button>
          <button
            type="button"
            className={tab === 'login' ? styles.btn : styles.btnGhost}
            style={{ flex: 1, marginTop: 0 }}
            onClick={() => {
              setTab('login')
              setMsg('')
            }}
          >
            已通过登录
          </button>
        </div>

        {tab === 'apply' ? (
          <form onSubmit={onApplyCode}>
            <label className={styles.field}>
              <span>手机号</span>
              <input
                inputMode="numeric"
                autoComplete="tel"
                maxLength={11}
                placeholder="11 位手机号"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
              />
            </label>
            <label className={styles.field}>
              <span>验证码</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="短信验证码"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  style={{ flex: 1 }}
                />
                <button type="button" className={styles.btnGhost} disabled={count > 0 || busy} onClick={() => void sendCode()}>
                  {count > 0 ? `${count}s` : '获取'}
                </button>
              </div>
            </label>
            <p className={styles.hint}>
              {isAdminShell(shell)
                ? '管理端不开放自助申请，请联系站长开通后再登录。'
                : '验证后填写资料，等待管理员审核通过。'}
            </p>
            {!isAdminShell(shell) ? (
              <button type="submit" className={styles.btn} disabled={busy}>
                {busy ? '提交中…' : '验证并填写申请'}
              </button>
            ) : null}
          </form>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button
                type="button"
                className={loginMode === 'code' ? styles.btn : styles.btnGhost}
                style={{ flex: 1, marginTop: 0 }}
                onClick={() => setLoginMode('code')}
              >
                验证码
              </button>
              <button
                type="button"
                className={loginMode === 'pwd' ? styles.btn : styles.btnGhost}
                style={{ flex: 1, marginTop: 0 }}
                onClick={() => setLoginMode('pwd')}
              >
                密码
              </button>
            </div>
            {loginMode === 'code' ? (
              <form onSubmit={onLoginCode}>
                <label className={styles.field}>
                  <span>手机号</span>
                  <input
                    inputMode="numeric"
                    maxLength={11}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                  />
                </label>
                <label className={styles.field}>
                  <span>验证码</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      inputMode="numeric"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      style={{ flex: 1 }}
                    />
                    <button type="button" className={styles.btnGhost} disabled={count > 0 || busy} onClick={() => void sendCode()}>
                      {count > 0 ? `${count}s` : '获取'}
                    </button>
                  </div>
                </label>
                <button type="submit" className={styles.btn} disabled={busy}>
                  {busy ? '登录中…' : '登录'}
                </button>
              </form>
            ) : (
              <form onSubmit={onPwdSubmit}>
                <label className={styles.field}>
                  <span>手机号</span>
                  <input
                    inputMode="numeric"
                    maxLength={11}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                  />
                </label>
                <label className={styles.field}>
                  <span>App 密码</span>
                  <PasswordInput
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="不是教务密码"
                  />
                </label>
                <p className={styles.hint}>仅审核通过的账号可进入工作台。</p>
                <button type="submit" className={styles.btn} disabled={busy}>
                  {busy ? '登录中…' : '登录'}
                </button>
              </form>
            )}
          </>
        )}

        {msg ? <p className={styles.msg}>{msg}</p> : null}
      </motion.div>
    </div>
  )
}
