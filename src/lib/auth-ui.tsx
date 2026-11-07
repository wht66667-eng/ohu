/**
 * 登录/注册 与 补资料 UI
 * - AuthSheets：入口（挂在 AuthProvider 内）
 * - LoginSheet：账号（手机号 / 邮箱自适应）+ 密码登录；注册与找回密码走验证码
 * - CredSheet：用户主动设置／修改密码，与昵称和资料填写分开
 * - ProfileSheet：昵称与可折叠的选填资料
 * - EditSheet：资料编辑（换头像 / 换名字）
 */
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { cbAuth, cbRdb } from './cb'
import { registrationIdentity } from './registration-identity'
import { errText, useAuth } from './auth'
import { uploadAvatar } from './account'
import { avatar } from '../data/images'
import { toast } from './toast'
import { PasswordInput } from '../components/PasswordInput'
import { AvatarCropper } from '../components/AvatarCropper'
import { FoxPosePicker } from '../components/fox/FoxPosePicker'
import { FoxRequestIndicator } from '../components/fox/FoxRequestIndicator'
import { foxV1StickerFile, type FoxV1StickerId } from './fox-v1-assets'
import { isWorkShell } from './app-shell'
import { OptionalProfileFields } from '../components/OptionalProfileFields'
import {
  ACCOUNT_INVALID_HINT,
  ACCOUNT_LABEL,
  ACCOUNT_PLACEHOLDER,
  EMAIL_DISABLED_HINT,
  EMAIL_LOGIN,
} from './feature-flags'

export function AuthSheets() {
  const auth = useAuth()
  if (!auth.loginOpen && !auth.profileOpen && !auth.editOpen && !auth.credOpen) return null
  return (
    <>
      {auth.loginOpen && <LoginSheet />}
      {auth.credOpen && auth.isSigned && <CredSheet key={auth.user?.uid} />}
      {auth.profileOpen && <ProfileSheet key={auth.user?.uid} />}
      {auth.editOpen && auth.isSigned && <EditSheet key={auth.user?.uid} />}
    </>
  )
}

function Mask({ onClick, children }: { onClick?: () => void; children: ReactNode }) {
  return (
    <div className="sheet-mask" onMouseDown={onClick}>
      {children}
    </div>
  )
}

/* ---------------- 登录 / 注册面板 ---------------- */
/*
 * 登录页只保留一个账号框 + 一个密码框：
 * 账号框自适应——11 位数字按手机号走，带 @ 的按邮箱走，其余按用户名走。
 * 不再做「手机号登录 / 邮箱登录」两个 tab，字段最少。
 *
 * 省钱关键：密码登录全程不发短信、不发邮件。
 * 验证码只在「注册」和「忘记密码」两个低频场景才发。
 */
type LoginView = 'login' | 'register' | 'reset'

/** 账号类型自动识别：决定发短信还是发邮件、走哪个登录接口 */
function accountKind(acc: string): 'phone' | 'email' | 'username' | '' {
  const v = acc.trim()
  if (!v) return ''
  if (/^1\d{10}$/.test(v)) return 'phone'
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return 'email'
  return 'username'
}

const REMEMBER_KEY = 'ohhu-remember-account'

/** 「记住账号」只存账号字符串，不存任何凭据（密码 / token 都不落地） */
function readRemembered(): string {
  try { return localStorage.getItem(REMEMBER_KEY) || '' } catch { return '' }
}
function writeRemembered(acc: string) {
  try {
    if (acc) localStorage.setItem(REMEMBER_KEY, acc)
    else localStorage.removeItem(REMEMBER_KEY)
  } catch { /* 隐私模式或存储被禁时忽略 */ }
}

function LoginSheet() {
  const auth = useAuth()
  const work = isWorkShell()
  const [view, setView] = useState<LoginView>('login')
  const [account, setAccount] = useState(() => readRemembered())
  const [remember, setRemember] = useState(() => !!readRemembered())
  const [password, setPassword] = useState('')
  const [studentId, setStudentId] = useState('')
  const registration = useRef<((token: string) => Promise<void>) | null>(null)
  function invalidateRegistration() {
    registration.current = null
    setCode('')
    setCount(0)
  }
  const [code, setCode] = useState('')
  const [request, setRequest] = useState<'login' | 'send-code' | 'verify-code' | null>(null)
  const busy = request !== null
  const [err, setErr] = useState('')
  const [count, setCount] = useState(0)
  const kind = accountKind(account)

  // 发送按钮倒计时
  useEffect(() => {
    if (count <= 0) return
    const t = window.setTimeout(() => setCount((c) => c - 1), 1000)
    return () => window.clearTimeout(t)
  }, [count])

  /** 切换视图时清掉验证码与倒计时，避免上一场景的中间态串进来 */
  function go(next: LoginView) {
    if (busy) return
    invalidateRegistration()
    setStudentId('')
    setPassword('')
    setView(next)
    setErr('')
    setCode('')
    setCount(0)
  }

  /** 注册 / 忘记密码共用：按账号类型自动发短信或邮件验证码 */
  const sendVerify = async () => {
    if (count > 0 || busy) return
    setErr('')
    /* 开关关着时不碰邮件通道：既省钱也避免用户掉进没开通的死路 */
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
      if (view === 'register') {
        registration.current = null
        if (password.length < 6 || password.length > 128) { setErr('请输入 6 至 128 位登录密码'); return }
        const identity = registrationIdentity(kind, account)
        const started = await cbAuth().signUp({ ...identity, password })
        const verify = started.data?.verifyOtp
        if (started.error || !verify) { setErr(errText(started.error || '注册验证码请求未完成，请重试')); return }
        registration.current = async token => {
          const result = await verify({ token })
          if (result.error) throw new Error('验证码错误或已过期，请重新核对')
        }
        setCount(60)
        toast.ok('注册验证码已发送')
        return
      }
      const e = kind === 'phone'
        ? await auth.sendPhoneCode(account)
        : await auth.sendEmailCode(account)
      if (e) { setErr(e); return }
      setCount(60)
      toast.warn(kind === 'phone' ? '验证码已发送，请注意查收短信' : '验证码已发送，请注意查收邮件（可能在垃圾箱）')
    } catch (error) {
      setErr(errText(error))
    } finally { setRequest(null) }
  }

  const submitVerify = async (ev: FormEvent) => {
    ev.preventDefault()
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
      if (view === 'register') {
        if (!registration.current) { setErr('请先获取注册验证码'); return }
        await registration.current(code.trim())
        registration.current = null
        const error = await auth.loginWithPassword(account.trim(), password)
        if (error) { setView('login'); setErr('账号已注册，请使用密码登录'); return }
        if (studentId.trim()) {
          try {
            const session = await cbAuth().getSession()
            const uid = session.data?.session?.user?.id
            if (typeof uid !== 'string' || !uid || session.data?.session?.user?.is_anonymous) throw new Error()
            const saved = await cbRdb().from('profiles').upsert({ uid, student_id: studentId.trim() }, { onConflict: 'uid' })
            if (saved.error) throw new Error()
          } catch { toast.warn('账号已注册，学号可在个人资料中补填') }
        }
        writeRemembered(remember ? account.trim() : '')
        return
      }
      const e = kind === 'phone'
        ? await auth.submitPhoneCode(code)
        : await auth.submitEmailCode(code)
      if (e) { setErr(e); return }
      /* 注册成功后会弹「设置密码」；忘记密码也是先验证进来再重设，同一条路径 */
      writeRemembered(remember ? account.trim() : '')
    } catch (error) {
      setErr(error instanceof Error ? error.message : '验证码验证失败，请重试')
    } finally { setRequest(null) }
  }

  const submitPwd = async (ev: FormEvent) => {
    ev.preventDefault()
    if (busy) return
    setErr('')
    /* 邮箱登录受开关控制，关着时连登录请求都不发 */
    if (kind === 'email' && !EMAIL_LOGIN) {
      setErr(EMAIL_DISABLED_HINT)
      return
    }
    const acc = account.trim()
    setRequest('login')
    try {
      // 手机号 / 邮箱 / 学号用户名统一走 loginWithPassword（内部按账号形态分流）
      const e = await auth.loginWithPassword(acc, password)
      if (e) { setErr(e); return }
      writeRemembered(remember ? acc : '')
      toast.ok('登录成功')
    } catch (error) {
      setErr(error instanceof Error ? error.message : '登录失败，请重试')
    } finally { setRequest(null) }
  }

  const close = () => {
    if (busy) return
    auth.closeLogin()
  }

  return (
    <Mask onClick={close}>
      <div className="sheet-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div>
            <b className="sheet-title">{view === 'register' ? '注册哦狐账号' : view === 'reset' ? '找回密码' : work ? '工作端登录' : '校园互帮 · 登录'}</b>
            <p className="sheet-sub">{view === 'register' ? '使用手机号和密码注册' : auth.loginReason}</p>
          </div>
          <button type="button" className="sheet-close" onClick={close} disabled={busy} aria-label="关闭">
            ✕
          </button>
        </div>

        {view === 'login' ? (
          <form className="auth-form" onSubmit={submitPwd}>
            <label className="af-field">
              <span>{ACCOUNT_LABEL}</span>
              <input
                className="field-input"
                placeholder={ACCOUNT_PLACEHOLDER}
                value={account}
                onChange={(e) => setAccount(e.target.value.trim())}
                autoComplete="username"
                autoFocus
                disabled={busy}
              />
            </label>
            <label className="af-field">
              <span>密码</span>
              <PasswordInput
                className="field-input"
                placeholder={work ? 'App 登录密码' : '登录密码'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className="auth-remember">
              <input
                type="checkbox"
                checked={remember}
                disabled={busy}
                onChange={(e) => {
                  setRemember(e.target.checked)
                  /* 取消勾选立刻抹掉已存的账号，不留在本地 */
                  if (!e.target.checked) writeRemembered('')
                }}
              />
              <span>记住账号</span>
            </label>
            <button className="auth-btn" disabled={busy} type="submit" aria-busy={request === 'login'}>
              {request === 'login' ? <FoxRequestIndicator label="正在登录…" pose="waving" /> : '登录'}
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={submitVerify}>
            <label className="af-field">
              <span>{ACCOUNT_LABEL}</span>
              <div className="code-row">
                <input
                  className="field-input"
                  placeholder={ACCOUNT_PLACEHOLDER}
                  value={account}
                  onChange={e => { setAccount(e.target.value.trim()); invalidateRegistration() }}
                  autoComplete="username"
                  disabled={busy}
                />
                <button type="button" className="send-btn" disabled={count > 0 || busy} onClick={sendVerify} aria-busy={request === 'send-code'}>
                  {request === 'send-code' ? <FoxRequestIndicator label="发送中…" /> : count > 0 ? `${count}s 后重发` : '获取验证码'}
                </button>
              </div>
            </label>
            {view === 'register' && <label className="af-field"><span>设置登录密码</span><PasswordInput className="field-input" autoComplete="new-password" placeholder="至少 6 位" value={password} disabled={busy} onChange={e => { setPassword(e.target.value); invalidateRegistration() }} /></label>}
            <label className="af-field">
              <span>验证码</span>
              <input
                className="field-input"
                autoComplete="one-time-code"
                maxLength={8}
                placeholder={kind === 'email' ? '邮箱里的验证码' : '短信里的验证码'}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^0-9a-zA-Z]/g, ''))}
                disabled={busy}
              />
            </label>
            {view === 'register' && <details><summary>学号（选填）</summary><label className="af-field"><span>学号</span><input className="field-input" value={studentId} maxLength={32} disabled={busy} onChange={e => setStudentId(e.target.value)} /></label></details>}
            {view === 'reset' && <p className="auth-hint">验证通过后即可设置新密码。</p>}
            <button className="auth-btn" disabled={busy} type="submit" aria-busy={request === 'verify-code'}>
              {request === 'verify-code' ? <FoxRequestIndicator label="正在验证…" /> : view === 'reset' ? '验证并重置' : '完成注册'}
            </button>
          </form>
        )}

        <p className="auth-footer">
          {view === 'login' ? '管理端仅限管理员学号 + 密码登录' : (
            <>
              已有账号？
              <button type="button" className="auth-link" disabled={busy} onClick={() => go('login')}>去登录</button>
            </>
          )}
        </p>


        {err ? <p className="auth-err" role="alert">{err}</p> : null}
      </div>
    </Mask>
  )
}

/* ---------------- 主动设置密码：不与昵称或学籍资料绑定 ---------------- */
function CredSheet() {
  const auth = useAuth()
  const [pwd, setPwd] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (count <= 0) return
    const timer = window.setTimeout(() => setCount(value => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [count])
  async function sendCode() {
    if (count || busy) return
    setErr(''); setBusy(true)
    try {
      const error = await auth.sendCredCode()
      if (error) setErr(error)
      else setCount(60)
    } finally { setBusy(false) }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setErr(''); setBusy(true)
    try {
      const error = await auth.saveCredentials({ password: pwd, code })
      if (error) setErr(error)
      else toast.ok('密码已设置，可用手机号和密码登录')
    } finally { setBusy(false) }
  }
  const close = () => { if (!busy) auth.dismissCred() }
  const phoneDigits = (auth.user?.phone || '').replace(/\D/g, '').slice(-11)
  const phone = /^1\d{10}$/.test(phoneDigits) ? `${phoneDigits.slice(0, 3)}****${phoneDigits.slice(-4)}` : '绑定手机号'
  return <Mask onClick={close}><div className="sheet-card" onMouseDown={event => event.stopPropagation()}>
    <div className="sheet-head"><div><b className="sheet-title">{auth.user?.hasPassword ? '修改登录密码' : '设置登录密码'}</b><p className="sheet-sub">{auth.user?.hasPassword ? '验证手机号后即可修改登录密码。' : '检查到您的账号没有密码，现在请在这个窗口补上您的密码'}</p></div><button type="button" className="sheet-close" disabled={busy} onClick={close} aria-label="关闭">✕</button></div>
    <form className="auth-form" onSubmit={submit}>
      <label className="af-field"><span>新密码</span><PasswordInput className="field-input" placeholder="至少 6 位" autoComplete="new-password" value={pwd} disabled={busy} onChange={event => setPwd(event.target.value)} /></label>
      <label className="af-field"><span>短信验证码</span><div className="code-row"><input className="field-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6 位验证码" value={code} disabled={busy} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} /><button className="send-btn" type="button" disabled={busy || count > 0} onClick={() => void sendCode()}>{count ? `${count}s 后重发` : '获取验证码'}</button></div></label>
      <p className="auth-hint">发送至 {phone}，仅用于验证本次密码设置。</p>
      {err ? <p className="auth-err" role="alert">{err}</p> : null}
      <button className="auth-btn" type="submit" disabled={busy}>{busy ? '保存中…' : '保存密码'}</button>
    </form>
  </div></Mask>
}

function ProfileSheet() {
  const auth = useAuth()
  const [nickname, setNickname] = useState(auth.profile?.username || '')
  const [building, setBuilding] = useState(auth.profile?.building || '')
  // 学籍信息：全部选填，填了才能在「大厅」进同学院交流群
  const [realName, setRealName] = useState(auth.profile?.realName || '')
  const [studentId, setStudentId] = useState(auth.profile?.studentId || '')
  const [grade, setGrade] = useState(auth.profile?.grade || '')
  const [major, setMajor] = useState(auth.profile?.major || '')
  const [college, setCollege] = useState(auth.profile?.college || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    if (busy) return
    setErr('')
    setBusy(true)
    const e = await auth.saveProfile({
      username: nickname,
      building,
      isAdmin: !!auth.profile?.isAdmin,
      realName,
      studentId,
      grade,
      major,
      college,
    })
    setBusy(false)
    if (e) {
      setErr(e)
      return
    }
    toast.ok('资料已保存')
  }

  return (
    <Mask onClick={() => !busy && auth.dismissProfile()}>
      <div className="sheet-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div>
            <b className="sheet-title">编辑资料</b>
            <p className="sheet-sub">只需一个昵称，其他资料可以以后再填。</p>
          </div>
          <button
            type="button"
            className="sheet-close"
            onClick={() => !busy && auth.dismissProfile()}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <label className="af-field">
            <span>昵称</span>
            <input
              className="field-input"
              placeholder="如：3 栋小王"
              maxLength={20}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
          </label>
          <OptionalProfileFields value={{ building, realName, studentId, grade, major, college }} disabled={busy} onChange={next => {
            setBuilding(next.building); setRealName(next.realName); setStudentId(next.studentId); setGrade(next.grade); setMajor(next.major); setCollege(next.college)
          }} />
          <button className="auth-btn" disabled={busy} type="submit">
            {busy ? '保存中…' : '保存'}
          </button>
          {err ? <p className="auth-err" role="alert">{err}</p> : null}
        </form>
      </div>
    </Mask>
  )
}

/* ---------------- 资料编辑面板：换头像 / 换名字 ---------------- */
function EditSheet() {
  const auth = useAuth()
  const initialName = auth.profile?.username || auth.user?.nickname || ''
  const initialAvatar = auth.user?.avatarUrl || ''
  const initialMotto = auth.user?.profileMotto || ''
  const initialIntro = auth.user?.profileIntro || ''

  const [nick, setNick] = useState(initialName)
  const [pic, setPic] = useState(initialAvatar)
  const [motto, setMotto] = useState(initialMotto)
  const [intro, setIntro] = useState(initialIntro)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [pending, setPending] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // 选完图先进裁剪：拖动 / 缩放定好构图再上传
  const choose = (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0]
    // 先取出 File 再清空 input，否则同一张图第二次选择不触发 change
    ev.target.value = ''
    if (!file || busy) return
    setErr('')
    setPending(file)
  }

  const cropDone = async (file: File) => {
    setBusy(true)
    const up = await uploadAvatar(file)
    setBusy(false)
    if (up.error) {
      setErr(up.error)
      return
    }
    setPic(up.url || '')
    setPending(null)
  }

  const chooseFox = async (pose: FoxV1StickerId) => {
    if (busy) return
    setBusy(true)
    setErr('')
    try {
      const up = await uploadAvatar(await foxV1StickerFile(pose))
      if (up.error) setErr(up.error)
      else setPic(up.url || '')
    } catch { setErr('这张阿狐头像暂时无法使用，请重试') }
    finally { setBusy(false) }
  }

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    if (busy) return
    const name = nick.trim()
    if (!name) {
      setErr('昵称不能为空')
      return
    }
    setErr('')
    setBusy(true)
    // 只提交真正改动的字段，避免无谓的写请求
    if (pic !== initialAvatar) {
      const e1 = await auth.saveAvatar(pic)
      if (e1) {
        setBusy(false)
        setErr(e1)
        return
      }
    }
    if (name !== initialName.trim()) {
      const e2 = await auth.rename(name)
      if (e2) {
        setBusy(false)
        setErr(e2)
        return
      }
    }
    if (motto.trim() !== initialMotto || intro.trim() !== initialIntro) {
      const personalError = await auth.savePersonalIntro(motto, intro)
      if (personalError) {
        setBusy(false)
        setErr(personalError)
        return
      }
    }
    setBusy(false)
    toast.ok('资料已更新')
    auth.closeEdit()
  }

  return (
    <>
      <Mask onClick={() => !busy && auth.closeEdit()}>
      <div className="sheet-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div>
            <b className="sheet-title">编辑资料</b>
            <p className="sheet-sub">换个头像和名字，让同学更容易认出你</p>
          </div>
          <button
            type="button"
            className="sheet-close"
            onClick={() => !busy && auth.closeEdit()}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <div className="avatar-edit">
            <button
              type="button"
              className="avatar-pick"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              aria-label="选择头像图片"
            >
              <img src={pic || avatar.student} alt="头像预览" />
              <span className="avatar-pick-tip">换头像</span>
            </button>
            <div className="avatar-actions">
              <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
                从相册选择
              </button>
              {pic ? (
                <button type="button" disabled={busy} onClick={() => setPic('')}>
                  恢复默认头像
                </button>
              ) : null}
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={choose} />
          </div>
          <details className="auth-optional"><summary>更多头像（选填）</summary><FoxPosePicker disabled={busy} onChoose={(pose) => void chooseFox(pose)} /></details>

          <label className="af-field">
            <span>昵称</span>
            <input
              className="field-input"
              placeholder="如：3 栋小王"
              maxLength={20}
              value={nick}
              onChange={(e) => setNick(e.target.value)}
            />
          </label>

          <details className="auth-optional"><summary>名言与个人介绍（选填）</summary>
          <label className="af-field">
            <span>个人名言 <small>选填 · 最多 40 字</small></span>
            <input
              className="field-input"
              placeholder="写一句喜欢的话"
              maxLength={40}
              value={motto}
              disabled={busy}
              onChange={(e) => setMotto(e.target.value)}
            />
          </label>

          <label className="af-field">
            <span>个人介绍 <small>选填 · 最多 160 字</small></span>
            <textarea
              className="field-input"
              placeholder="让同学多了解你一点"
              maxLength={160}
              rows={3}
              value={intro}
              disabled={busy}
              onChange={(e) => setIntro(e.target.value)}
            />
          </label>

          <p className="auth-hint">头像与昵称用于哦狐社交展示。个人名言和介绍不会公开到全站，仅在你主动发送好友申请时展示给申请接收人。</p>
          </details>
          <button className="auth-btn" type="submit" disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </button>
          {err ? <p className="auth-err" role="alert">{err}</p> : null}
        </form>
      </div>
      </Mask>
      {pending ? (
        <AvatarCropper
          file={pending}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={(f) => void cropDone(f)}
        />
      ) : null}
    </>
  )
}
