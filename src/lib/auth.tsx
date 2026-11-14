/**
 * 认证上下文 AuthProvider + useAuth
 *
 * 会话模型：
 * - booting  初始恢复中
 * - guest    无任何会话（首次访问）
 * - anon     已匿名登录（游客，可浏览公开视图）
 * - signed   真实用户（username/password 账号或手机验证码账号）
 *
 * 登录方式（平台实测约束）：
 * - username/password：预置/管理端创建账号（signInWithPassword）
 * - 手机号验证码：signInWithOtp 发送验证码 -> verifyOtp 完成，首次使用自动建档
 * - 邮箱验证码：getVerification({ email }) 取凭证 -> signInWithEmail({ verificationInfo,
 *   verificationCode, email }) 完成，首次使用自动建档。
 *   ⚠️ 需控制台「身份认证 → 登录方式」开启邮箱验证码，未开启会报 provider email not found。
 *
 * 正方教务（学号 + 教务密码）不用于登录，仅在「课表」页绑定同步课表 / 成绩 / 考试。
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { cbAuth, cbRdb } from './cb'
import { SessionReadGuard } from './auth-session'
import { captureQbankSession, isQbankSessionCurrent, setQbankUid } from './qbank'
import { applyPasswordSetup, passwordSetupError, passwordSetupMessage, type PasswordSetupInput } from './password-setup'
import { selectImSession } from './im-session'
import { markBootReady } from './boot'
import { resetLauncherMoodForAccountChange } from './app-icon'
import { toast } from './toast'
import { getAppShell } from './app-shell'
import { LOCAL_IDENTITY_EVENT, clearLocalIdentity, loadLocalIdentity } from './local-identity'
import { readLocalProfile, saveLocalProfile } from './local-profile'
import { clearCloudIdentity, cloudIdentityStudentId, cloudIdentityUid, ensureCloudIdentity } from './cloud-identity'

export type AuthPhase = 'booting' | 'guest' | 'anon' | 'signed'

export interface AuthUser {
  uid: string
  nickname: string
  phone: string
  /** 自定义头像地址（空串表示用默认头像） */
  avatarUrl: string
  /** 主动设置的名言，仅随好友申请快照发送 */
  profileMotto: string
  /** 主动设置的个人介绍，仅随好友申请快照发送 */
  profileIntro: string
  isAnonymous: boolean
  /** 账号密码登录用的用户名（auth user_metadata.username；与展示昵称可能不同） */
  loginName: string
  /** 是否已设置登录密码；验证码注册后不自动要求补设。 */
  hasPassword: boolean
  /** 元数据中是否明确给出密码状态；缺字段时不能误判为无密码。 */
  passwordStatusKnown: boolean
}

/** 密码设置与昵称、学籍资料分别保存。 */
export type CredentialInput = PasswordSetupInput

export interface AuthProfile {
  username: string
  building: string
  isAdmin: boolean
  /** 是否最高管理员（站长，可管理后台成员 / 封禁用户） */
  isSuperAdmin?: boolean
  /** 封禁时间（ISO 字符串），非空表示该账号已被封禁 */
  bannedAt?: string | null
  /** 封禁原因 */
  bannedNote?: string
  /** 真实姓名（选填） */
  realName?: string
  /** 学号（选填） */
  studentId?: string
  /** 年级：大一 / 大二 / 大三 / 大四 / 大五 / 研究生（选填） */
  grade?: string
  /** 专业（选填） */
  major?: string
  /** 所属学院 key（选填；填了才能进同学院交流群） */
  college?: string
}

export interface AuthApi {
  phase: AuthPhase
  user: AuthUser | null
  profile: AuthProfile | null
  isSigned: boolean
  /** 登录面板可见性 */
  loginOpen: boolean
  loginReason: string
  /** 补资料面板可见性 */
  profileOpen: boolean
  /** 资料编辑面板（换头像 / 换名字）可见性 */
  editOpen: boolean
  /** 用户主动设置／修改密码的面板可见性 */
  credOpen: boolean
  ensureGuest: () => Promise<void>
  ensureSignedIn: (reason: string) => Promise<boolean>
  openLogin: (reason?: string) => void
  closeLogin: () => void
  /** 学生端学号登录成功后调用：刷新本机身份并放行等待中的操作 */
  completeStudentLogin: () => Promise<void>
  loginWithPassword: (account: string, password: string) => Promise<string | null>
  sendPhoneCode: (phone: string) => Promise<string | null>
  submitPhoneCode: (code: string) => Promise<string | null>
  /** 邮箱验证码登录（需控制台开启邮箱验证码）；未开启时返回可读的错误原因 */
  sendEmailCode: (email: string) => Promise<string | null>
  submitEmailCode: (code: string) => Promise<string | null>
  logout: () => Promise<void>
  askProfile: () => Promise<boolean>
  saveProfile: (p: AuthProfile) => Promise<string | null>
  /** 更换头像：url 为空串表示恢复默认头像 */
  saveAvatar: (url: string) => Promise<string | null>
  /** 保存好友申请中展示的个人名言与介绍 */
  savePersonalIntro: (motto: string, intro: string) => Promise<string | null>
  /** 修改昵称（写 profiles.username） */
  rename: (username: string) => Promise<string | null>
  openProfile: () => void
  dismissProfile: () => void
  openEdit: () => void
  closeEdit: () => void
  /** 打开设置密码面板（设置页入口） */
  openCred: () => void
  /** 关闭设置密码面板 */
  dismissCred: () => void
  /** 发送设置密码用的短信验证码（reauthenticate，会消耗一次短信） */
  sendCredCode: () => Promise<string | null>
  /** 提交：仅用验证码设置当前账号密码，不更改昵称或资料 */
  saveCredentials: (p: CredentialInput) => Promise<string | null>
}

const AuthCtx = createContext<AuthApi | null>(null)

/** 学生端不再有手机号登录：所有「去登录」都落到本机学号登录弹窗。 */

function localAuthUser(studentId: string, uid: string): AuthUser {
  return {
    uid,
    nickname: `同学 ${studentId}`,
    phone: '',
    avatarUrl: '',
    profileMotto: '',
    profileIntro: '',
    isAnonymous: false,
    loginName: studentId,
    hasPassword: false,
    passwordStatusKnown: true,
  }
}

export function errText(e: unknown): string {
  if (typeof e === 'string' && e.trim()) return e.trim()
  if (!e) return '操作失败，请稍后重试'
  const anyE = e as { message?: unknown; msg?: unknown; helpMessage?: unknown; code?: unknown }
  const msg = typeof anyE.message === 'string' && anyE.message ? anyE.message : anyE.msg
  if (typeof msg === 'string' && msg) return msg
  /**
   * CloudBase Auth 的错误对象经常只有 helpMessage 有内容（message 为空），
   * 例如 failed_precondition：「前置条件不满足：该手机号已被其他账号绑定 / 目标用户不存在」。
   * 不读 helpMessage 的话界面只会显示「操作失败，请稍后重试」，排查无从下手。
   */
  const help = anyE.helpMessage
  if (typeof help === 'string' && help.trim()) {
    const first = help
      .split('\n')
      .map((s) => s.trim())
      .find(Boolean) || ''
    const plain = first.replace(/^\[[^\]]*\]\s*/, '') || '操作失败，请稍后重试'
    const code = typeof anyE.code === 'string' && anyE.code ? anyE.code : ''
    return code ? `${plain}（${code}）` : plain
  }
  return '操作失败，请稍后重试'
}

/** 只接受真正的用户标识：SDK 冷启动时 user.id 可能是内部函数，必须挡掉 */
function safeUid(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return ''
}

function toUser(raw: unknown): AuthUser | null {
  const r = raw as {
    id?: unknown
    uid?: unknown
    phone?: unknown
    is_anonymous?: boolean
    user_metadata?: {
      uid?: unknown
      username?: unknown
      nickName?: unknown
      nickname?: unknown
      name?: unknown
      phone?: unknown
      avatar_url?: unknown
      avatarUrl?: unknown
      picture?: unknown
      profile_motto?: unknown
      profile_intro?: unknown
      hasPassword?: unknown
      has_password?: unknown
    }
  }
  if (!r) return null
  const m = r.user_metadata || {}
  // uid 兜底顺序：session.user.id -> session.user.uid -> metadata.uid
  const uid = safeUid(r.id) || safeUid(r.uid) || safeUid(m.uid)
  return {
    uid,
    nickname: String(m.nickname || m.nickName || m.name || m.username || ''),
    phone: String(r.phone || m.phone || ''),
    // 头像可能落在 metadata 的三个键上（写入用 avatar_url，历史数据是 avatarUrl / picture）
    avatarUrl: String(m.avatar_url || m.avatarUrl || m.picture || ''),
    profileMotto: String(m.profile_motto || ''),
    profileIntro: String(m.profile_intro || ''),
    isAnonymous: !!r.is_anonymous,
    // 登录用户名单独取 username：改名只同步 nickname，不会动它
    loginName: String(m.username || ''),
    // 平台在 user_metadata 里回写 hasPassword；读不到时显示为未设置，不自动弹窗。
    hasPassword: m.hasPassword === true || m.has_password === true,
    passwordStatusKnown: typeof m.hasPassword === 'boolean' || typeof m.has_password === 'boolean',
  }
}

/**
 * 从当前会话恢复用户。
 *
 * 冷启动首次 getSession() 可能拿到「尚未解析完」的会话（user.id 是 SDK 内部函数、
 * is_anonymous 为 false），此时 uid 取不到真实值，若直接当成登录用户会带着脏 uid
 * 去查库（表现为 404 / 空数据）。这里做有限次重试，等会话解析完成再返回。
 */
async function snapshotUser(): Promise<AuthUser | null> {
  for (let i = 0; i < 4; i += 1) {
    const res = await cbAuth().getSession()
    const u = toUser(res?.data?.session?.user)
    if (!u) return null
    if (u.uid) return u
    await new Promise((r) => setTimeout(r, 60 * (i + 1)))
  }
  return null
}

/** profiles 中与鉴权相关的列（封禁判定 + 管理员标识 + 展示名） */
interface ProfileRow {
  username?: string
  building?: string
  is_admin?: boolean
  is_super_admin?: boolean
  banned_at?: string | null
  banned_note?: string | null
  real_name?: string | null
  student_id?: string | null
  grade?: string | null
  major?: string | null
  college?: string | null
}

/** 读本人档案；任何异常都降级为 null（调用方按「无档案」渲染） */
async function readProfileRow(uid: string): Promise<ProfileRow | null> {
  try {
    const res = await cbRdb()
      .from('profiles')
      .select(
        'username,building,is_admin,is_super_admin,banned_at,banned_note,real_name,student_id,grade,major,college',
      )
      .eq('uid', uid)
      .limit(1)
    const rows = (res as { data?: unknown }).data as ProfileRow[] | null
    return rows?.[0] ?? null
  } catch {
    return null
  }
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth 必须在 <AuthProvider> 内使用')
  return ctx
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<AuthPhase>('booting')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [profile, setProfile] = useState<AuthProfile | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const [loginReason, setLoginReason] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [credOpen, setCredOpen] = useState(false)
  /** 每个活跃账号仅自动提示一次；关闭后可从设置再次打开。 */
  const passwordNoticeUid = useRef('')

  /** 防抖：同一次封禁会话只提示一次（登录/恢复/刷新可能触发多次 refresh） */
  const bannedNotified = useRef(false)

  /** 短信 OTP 回调：signInWithOtp 返回的 verifyOtp（发送与校验分两步） */
  const otpRef = useRef<((p: { token: string | number; messageId?: string }) => Promise<unknown>) | null>(null)

  /**
   * 邮箱验证码登录的中间件凭证。
   * 与短信不同：邮箱走 `getVerification({ email })` 拿 verificationInfo，
   * 再 `signInWithEmail({ verificationInfo, verificationCode, email })` 两步，
   * 所以这里存的是凭证本身 + 发码时的邮箱（校验时必须是同一个邮箱，防止换号提交）。
   */
  const emailOtpRef = useRef<{ verificationInfo: unknown; email: string } | null>(null)

  /**
   * 设置密码用的回调：reauthenticate() 会先给当前账号手机号发一条验证码，
   * 返回的 updateUser({ nonce, password }) 内部走 sudo + setPassword，
   * 因此手机验证码注册（无旧密码）的账号也能设置/重置登录密码。
   */
  const credVerifyRef = useRef<{ uid: string; session: ReturnType<typeof captureQbankSession>; verify: (p: { nonce: string; password: string }) => Promise<unknown> } | null>(null)
  const loginPending = useRef<((ok: boolean) => void) | null>(null)
  const profilePending = useRef<((ok: boolean) => void) | null>(null)
  const guestBusy = useRef<Promise<void> | null>(null)

  /** 依据 session 刷新 phase/user/profile */
  const sessionRead = useRef(new SessionReadGuard())
  /* 学生端：学号本机身份；不再使用手机号 / 云端账号。管理端仍走原有账号。 */
  const localOnly = getAppShell() === 'user'
  const refresh = useCallback(async () => {
    if (localOnly) {
      const identity = loadLocalIdentity()
      if (!identity) {
        sessionRead.current.reset()
        setQbankUid(null)
        selectImSession(null)
        setUser(null)
        setProfile(null)
        setPhase('guest')
        return
      }
      setQbankUid(identity.uid)
      if (cloudIdentityStudentId() !== identity.studentId) clearCloudIdentity()
      selectImSession(cloudIdentityUid() || null)
      setUser(localAuthUser(identity.studentId, identity.uid))
      setProfile(readLocalProfile(identity.uid, identity.studentId))
      setPhase('signed')
      if (!cloudIdentityUid()) {
        // 云身份缺失（首次登录/旧明文身份作废/换取失败）时后台补换身份码，不阻塞本机功能
        void ensureCloudIdentity(identity.studentId).then((ok) => {
          if (!ok) return
          const cur = loadLocalIdentity()
          if (cur?.studentId === identity.studentId) void refresh()
        })
      }
      return
    }
    const ticket = sessionRead.current.begin()
    let u: AuthUser | null = null
    try {
      u = await snapshotUser()
    } catch {
      u = null
    }
    if (!sessionRead.current.current(ticket)) return
    // uid 取不到（会话尚未解析完成）等价于「还没有可用会话」：不查库，等下一次 refresh
    if (!u || !u.uid) {
      sessionRead.current.select(ticket, '')
      setQbankUid(null)
      selectImSession(null)
      setUser(null)
      setProfile(null)
      bannedNotified.current = false
      setPhase((p) => (p === 'booting' ? 'guest' : p))
      return
    }
    if (sessionRead.current.uid !== u.uid) {
      if (sessionRead.current.uid) void resetLauncherMoodForAccountChange()
      setProfile(null)
    }
    sessionRead.current.select(ticket, u.uid)
    // Select private local storage before React renders the new user's pages.
    setQbankUid(u.isAnonymous ? null : u.uid)
    selectImSession(u.isAnonymous ? null : u.uid)
    setUser(u)
    if (!u.isAnonymous && u.passwordStatusKnown && !u.hasPassword) {
      if (passwordNoticeUid.current !== u.uid) {
        passwordNoticeUid.current = u.uid
        setCredOpen(true)
      }
    } else if (u.hasPassword) {
      passwordNoticeUid.current = ''
    }
    if (u.isAnonymous) {
      // A confirmed anonymous session differs from a temporarily unresolved cold start.
      window.dispatchEvent(new Event('ohhu-reminder-auth-anonymous'))
      setProfile(null)
      setPhase('anon')
      return
    }
    setPhase('signed')
    const row = await readProfileRow(u.uid)
    if (!sessionRead.current.accepts(ticket, u.uid)) return
    if (row?.banned_at) {
      // 账号已被封禁：提示原因并立即登出，不能继续使用平台
      if (!bannedNotified.current) {
        bannedNotified.current = true
        const note = (row.banned_note || '').trim()
        toast.err(
          note
            ? `你的账号已被封禁，无法使用平台服务。原因：${note}`
            : '你的账号已被封禁，无法使用平台服务',
        )
      }
      await cbAuth()
        .signOut()
        .catch(() => undefined)
      if (!sessionRead.current.accepts(ticket, u.uid)) return
      window.dispatchEvent(new CustomEvent('ohhu-reminder-owner-logout', { detail: { ownerUid: u.uid } }))
      void resetLauncherMoodForAccountChange()
      sessionRead.current.reset()
      setQbankUid(null)
      selectImSession(null)
      setProfile(null)
      setUser(null)
      setPhase('guest')
      return
    }
    setProfile(
      row
        ? {
            username: row.username || '',
            building: row.building || '',
            isAdmin: !!row.is_admin,
            isSuperAdmin: !!row.is_super_admin,
            bannedAt: row.banned_at ? String(row.banned_at) : null,
            bannedNote: row.banned_note || '',
            realName: row.real_name || '',
            studentId: row.student_id || '',
            grade: row.grade || '',
            major: row.major || '',
            college: row.college || '',
          }
        : null,
    )
  }, [])

  // 挂载恢复会话 + 无会话时静默匿名登录 + 订阅登录态变化（多标签页 / 令牌刷新后同步）
  useEffect(() => {
    if (localOnly) {
      void (async () => {
        try {
          const cur = await snapshotUser()
          if (!cur) await cbAuth().signInAnonymously()
        } catch {
          /* 匿名只读不可用时静默降级，页面显示空态 */
        }
        const identity = loadLocalIdentity()
        if (identity?.studentId) await ensureCloudIdentity(identity.studentId)
        await refresh()
      })().finally(() => {
        setPhase((p) => (p === 'booting' ? 'guest' : p))
        markBootReady('auth')
      })
      /* 学生壳无云端会话变化可言：本机身份写入（门禁认证通过 / 一键获取补做）与
         清除时监听广播，把游客态即时刷新成已登录，避免「首页已认证、我的页要求重新登录」的分裂。 */
      const onIdentityChange = () => { void refresh() }
      window.addEventListener(LOCAL_IDENTITY_EVENT, onIdentityChange)
      return () => { window.removeEventListener(LOCAL_IDENTITY_EVENT, onIdentityChange) }
    }
    void (async () => {
      await refresh()
      try {
        const cur = await snapshotUser()
        if (!cur) {
          const res = await cbAuth().signInAnonymously()
          if (res.error) throw res.error
          await refresh()
        }
      } catch {
        // 匿名登录不可用时静默降级：门禁会引导手机号注册 / 密码登录
      }
    })().finally(() => {
      setPhase((p) => (p === 'booting' ? 'guest' : p))
      markBootReady('auth')
    })
    const sub = cbAuth().onAuthStateChange(() => {
      void refresh()
    })
    return () => {
      sub?.data?.subscription?.unsubscribe?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 无云端会话时恢复游客会话，具体权限由各业务接口判定。 */
  const ensureGuest = useCallback(async () => {
    if (guestBusy.current) return guestBusy.current
    guestBusy.current = (async () => {
      try {
        const cur = await snapshotUser()
        if (!cur) {
          const r = await cbAuth().signInAnonymously()
          if (r.error) throw r.error
        }
      } catch {
        // 游客不可用时静默：列表页自动降级为空态
      }
      try {
        await refresh()
      } catch {
        // noop
      }
    })().finally(() => {
      guestBusy.current = null
    })
    return guestBusy.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh])

  const finishLogin = useCallback(() => {
    otpRef.current = null
    emailOtpRef.current = null
    loginPending.current?.(true)
    loginPending.current = null
    setLoginOpen(false)
    setLoginReason('')
  }, [])

  const closeLogin = useCallback(() => {
    loginPending.current?.(false)
    loginPending.current = null
    setLoginOpen(false)
    setLoginReason('')
  }, [])

  const openLogin = useCallback((reason = '该操作需要先登录') => {
    if (localOnly) {
      setLoginReason(reason)
      setLoginOpen(true)
      return
    }
    setLoginReason(reason)
    setLoginOpen(true)
  }, [localOnly])

  /** 用户名/手机号 + 密码登录（先清空旧会话避免账号冲突） */
  const loginWithPassword = useCallback(
    async (account: string, password: string): Promise<string | null> => {
      if (localOnly) return '学生端已改为学号本机登录，请到「一键获取」填写学号与校园密码。'
      const acc = account.trim()
      if (!acc || !password) return '请填写账号与密码'
      try {
        await cbAuth().signOut().catch(() => undefined)
        const a = cbAuth() as unknown as {
          signInWithPassword: (p: { phone?: string; username?: string; password: string }) => Promise<{ error?: unknown } | null>
          signInWithEmailAndPassword: (email: string, password: string) => Promise<{ error?: unknown } | null>
        }
        const isPhone = /^1\d{10}$/.test(acc)
        const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(acc)
        /*
         * 三条都是「密码登录」，全程不发短信也不发邮件——验证码只在注册 / 找回密码时才用。
         * 手机号 → phone；邮箱 → 邮箱专用接口；其余（学号 / 用户名）→ username。
         */
        const res = isPhone
          ? await a.signInWithPassword({ phone: acc, password })
          : isEmail
            ? await a.signInWithEmailAndPassword(acc, password)
            : await a.signInWithPassword({ username: acc, password })
        if (res?.error) return errText(res.error)
        await refresh()
        finishLogin()
        return null
      } catch (e) {
        return errText(e)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refresh, finishLogin],
  )

  /** 要求真实登录；返回 true 表示已登录（关闭面板可中止） */
  const ensureSignedIn = useCallback(
    (reason: string) =>
      new Promise<boolean>((resolve) => {
        if (localOnly) {
          if (loadLocalIdentity()) resolve(true)
          else {
            loginPending.current = resolve
            setLoginReason(reason)
            setLoginOpen(true)
          }
          return
        }
        void (async () => {
          if (phase === 'signed' && user) {
            resolve(true)
            return
          }
          loginPending.current = resolve
          setLoginReason(reason)
          setLoginOpen(true)
        })()
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phase, user, localOnly],
  )

  const completeStudentLogin = useCallback(async () => {
    if (!localOnly) return
    const identity = loadLocalIdentity()
    if (identity?.studentId && cloudIdentityStudentId() !== identity.studentId) {
      clearCloudIdentity()
      await ensureCloudIdentity(identity.studentId)
    }
    await refresh()
    loginPending.current?.(true)
    loginPending.current = null
    setLoginOpen(false)
    setLoginReason('')
  }, [localOnly, refresh])

  /** 发送手机验证码（signInWithOtp；首次使用自动注册，老用户直接登录） */
  const sendPhoneCode = useCallback(async (phone: string): Promise<string | null> => {
    if (localOnly) return '学生端已取消手机号登录，请使用学号。'
    const p = phone.trim()
    if (!/^1\d{10}$/.test(p)) return '请输入正确的 11 位手机号'
    try {
      const res = await cbAuth().signInWithOtp({ phone: p, options: { shouldCreateUser: true } })
      if (res.error) return errText(res.error)
      const verifyOtp = res.data?.verifyOtp as
        | ((p: { token: string | number; messageId?: string }) => Promise<unknown>)
        | undefined
      if (!verifyOtp) return '发送失败，请稍后重试'
      otpRef.current = verifyOtp
      return null
    } catch (e) {
      return errText(e)
    }
  }, [])

  /** 提交短信验证码完成登录 */
  const submitPhoneCode = useCallback(
    async (code: string): Promise<string | null> => {
      if (localOnly) return '学生端已取消手机号登录，请使用学号。'
      const verify = otpRef.current
      if (!verify) return '请先获取验证码'
      const c = code.trim()
      if (!c) return '请输入验证码'
      try {
        await cbAuth().signOut().catch(() => undefined)
        const res = (await verify({ token: c })) as { error?: { message?: string } }
        if (res.error) return errText(res.error)
        await refresh()
        finishLogin()
        return null
      } catch (e) {
        return errText(e)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refresh, finishLogin],
  )

  /**
   * 发送邮箱验证码（邮箱验证码注册 / 登录）。
   * 需要控制台「身份认证 → 登录方式」先开启邮箱验证码，否则会报
   * `provider email not found` / `invalid_env`，errText 会把原因直出给用户。
   */
  const sendEmailCode = useCallback(async (email: string): Promise<string | null> => {
    if (localOnly) return '学生端已取消邮箱登录，请使用学号。'
    const m = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(m)) return '请输入正确的邮箱地址'
    try {
      /* SDK 的类型定义没跟上 getVerification，运行时是有的，这里显式声明 */
      const a = cbAuth() as unknown as {
        getVerification: (p: { email: string }) => Promise<Record<string, unknown> | null | undefined>
      }
      const res = await a.getVerification({ email: m })
      if (!res) return '验证码发送失败，请稍后重试'
      /* 官方示例里 res 本身就是 verificationInfo；少数版本包了一层，两种都认 */
      const info = (res as { verificationInfo?: unknown }).verificationInfo ?? res
      if (!info) return '验证码发送失败，请稍后重试'
      emailOtpRef.current = { verificationInfo: info, email: m }
      return null
    } catch (e) {
      return errText(e)
    }
  }, [])

  /** 提交邮箱验证码完成登录（注册与登录同一条路径，首次自动建档） */
  const submitEmailCode = useCallback(
    async (code: string): Promise<string | null> => {
      if (localOnly) return '学生端已取消邮箱登录，请使用学号。'
      const held = emailOtpRef.current
      if (!held) return '请先获取邮箱验证码'
      const c = code.trim()
      if (!c) return '请输入邮箱里的验证码'
      try {
        const a = cbAuth() as unknown as {
          signInWithEmail: (p: {
            verificationInfo: unknown
            verificationCode: string
            email: string
          }) => Promise<{ error?: unknown } | null | undefined>
        }
        const res = await a.signInWithEmail({
          verificationInfo: held.verificationInfo,
          verificationCode: c,
          email: held.email,
        })
        if (res?.error) return errText(res.error)
        await refresh()
        finishLogin()
        return null
      } catch (e) {
        return errText(e)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refresh, finishLogin],
  )

  const logout = useCallback(async () => {
    if (localOnly) {
      clearLocalIdentity()
      clearCloudIdentity()
      setQbankUid(null)
      selectImSession(null)
      setProfile(null)
      setUser(null)
      setCredOpen(false)
      setPhase('guest')
      try { await cbAuth().signOut() } catch { /* Session remains cleared locally. */ }
      return
    }
    const reminderOwner = sessionRead.current.uid
    if (reminderOwner) window.dispatchEvent(new CustomEvent('ohhu-reminder-owner-logout', { detail: { ownerUid: reminderOwner } }))
    if (reminderOwner) void resetLauncherMoodForAccountChange()
    sessionRead.current.reset()
    setQbankUid(null)
    selectImSession(null)
    otpRef.current = null
    emailOtpRef.current = null
    credVerifyRef.current = null
    passwordNoticeUid.current = ''
    bannedNotified.current = false
    setProfile(null)
    setUser(null)
    setCredOpen(false)
    setPhase('guest')
    clearCloudIdentity()
    try { await cbAuth().signOut() } catch { /* Session remains cleared locally. */ }
  }, [])

  /** 要求资料完整（昵称必填）。发布前调用。 */
  const askProfile = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        if (profile) {
          resolve(true)
          return
        }
        profilePending.current = resolve
        setProfileOpen(true)
      }),
    [profile],
  )

  const saveProfile = useCallback(
    async (p: AuthProfile): Promise<string | null> => {
      if (!user) return '请先登录'
      const username = p.username.trim()
      if (!username) return '昵称不能为空'
      if (localOnly) {
        const next: AuthProfile = { ...p, username, isAdmin: false, isSuperAdmin: false }
        if (!saveLocalProfile(user.uid, next)) return '本机保存失败，请检查存储空间'
        setProfile(next)
        setUser((current) => (current ? { ...current, nickname: username } : current))
        return null
      }
      try {
        const rdb = cbRdb().from('profiles') as unknown as {
          upsert: (r: object, o?: object) => Promise<{ error?: unknown }>
        }
        const res = await rdb.upsert(
          {
            uid: user.uid,
            username,
            building: p.building.trim(),
            real_name: p.realName ?? null,
            student_id: p.studentId ?? null,
            grade: p.grade ?? null,
            major: p.major ?? null,
            college: p.college ?? null,
          },
          { onConflict: 'uid' },
        )
        if (res.error) return errText(res.error)
        if (sessionRead.current.uid !== user.uid) return '账号已变化，请重新登录'
        setProfile((prev) => ({
          username,
          building: p.building.trim(),
          isAdmin: prev?.isAdmin ?? false,
          isSuperAdmin: prev?.isSuperAdmin ?? false,
          bannedAt: prev?.bannedAt ?? null,
          bannedNote: prev?.bannedNote ?? '',
          realName: p.realName ?? prev?.realName ?? '',
          studentId: p.studentId ?? prev?.studentId ?? '',
          grade: p.grade ?? prev?.grade ?? '',
          major: p.major ?? prev?.major ?? '',
          college: p.college ?? prev?.college ?? '',
        }))
        profilePending.current?.(true)
        profilePending.current = null
        setProfileOpen(false)
        return null
      } catch (e) {
        return errText(e)
      }
    },
    [user],
  )

  /**
   * 更换头像：写入账号资料（auth user_metadata.avatar_url）。
   * 头像不属于业务表字段，改这里不影响 profiles 的读写与权限守卫。
   */
  const saveAvatar = useCallback(
    async (url: string): Promise<string | null> => {
      if (!user) return '请先登录'
      if (localOnly) return null
      const next = url.trim()
      try {
        const res = (await cbAuth().updateUser({ avatar_url: next })) as { error?: unknown }
        if (res?.error) return errText(res.error)
        // 会话缓存里的 metadata 未必立刻更新，先用服务端最新值覆盖一次
        try {
          const fresh = (await cbAuth().getUser()) as { data?: { user?: unknown } }
          const nu = toUser(fresh?.data?.user)
          if (nu && nu.uid === user.uid && sessionRead.current.uid === user.uid) {
            // 服务端没回写这张图时以本地值为准，免得界面弹回默认头像
            setUser({ ...nu, avatarUrl: nu.avatarUrl || next })
            return null
          }
        } catch {
          // noop：读不到就退回本地乐观更新
        }
        setUser((prev) => (prev?.uid === user.uid && sessionRead.current.uid === user.uid ? { ...prev, avatarUrl: next } : prev))
        return null
      } catch (e) {
        return errText(e)
      }
    },
    [user],
  )

  const savePersonalIntro = useCallback(
    async (motto: string, intro: string): Promise<string | null> => {
      if (!user) return '请先登录'
      if (localOnly) return null
      const nextMotto = motto.trim().slice(0, 40)
      const nextIntro = intro.trim().slice(0, 160)
      try {
        // CloudBase Auth persists custom user metadata such as avatar_url although
        // its SDK UserAttributes declaration only lists built-in profile fields.
        const updateUser = cbAuth().updateUser as unknown as (attributes: Record<string, unknown>) => Promise<{ error?: unknown }>
        const result = await updateUser({ profile_motto: nextMotto, profile_intro: nextIntro })
        if (result?.error) return errText(result.error)
        if (sessionRead.current.uid !== user.uid) return '账号已变化，请重新登录'
        setUser((previous) => previous?.uid === user.uid && sessionRead.current.uid === user.uid
          ? { ...previous, profileMotto: nextMotto, profileIntro: nextIntro }
          : previous)
        return null
      } catch (error) {
        return errText(error)
      }
    },
    [user],
  )

  /** 修改昵称：沿用 saveProfile 写 profiles.username，并尽力同步账号昵称 */
  const rename = useCallback(
    async (username: string): Promise<string | null> => {
      const e = await saveProfile({
        ...profile,
        username,
        building: profile?.building || '',
        isAdmin: !!profile?.isAdmin,
      })
      if (e) return e
      void Promise.resolve(cbAuth().updateUser({ nickname: username.trim() })).catch(() => undefined)
      return null
    },
    [profile, saveProfile],
  )

  const dismissProfile = useCallback(() => {
    profilePending.current?.(false)
    profilePending.current = null
    setProfileOpen(false)
  }, [])

  /** 用户中心：主动打开补资料面板（不阻塞等待） */
  const openProfile = useCallback(() => {
    profilePending.current = null
    setProfileOpen(true)
  }, [])

  /** 资料编辑面板：换头像 / 换名字（由「我的」页唤起） */
  const openEdit = useCallback(() => setEditOpen(true), [])
  const closeEdit = useCallback(() => setEditOpen(false), [])

  /** 设置页入口：只有用户主动操作才打开密码面板。 */
  const openCred = useCallback(() => {
    credVerifyRef.current = null
    setCredOpen(true)
  }, [])

  /** 关闭面板并丢弃本次验证码回调。 */
  const dismissCred = useCallback(() => {
    credVerifyRef.current = null
    setCredOpen(false)
  }, [])

  /**
   * 发送设置密码用的验证码。
   * 平台约束：登录态下无法直接写入密码（updateUser 拒绝 password 字段），
   * 必须走 reauthenticate：给当前账号手机号发码 → 用码换 sudo_token → setPassword。
   */
  const sendCredCode = useCallback(async (): Promise<string | null> => {
    if (localOnly) return '学生端已取消手机号账号密码。'
    if (!user) return '请先登录'
    if (!user.phone) return '当前账号没有可用手机号，无法设置密码'
    const session = captureQbankSession()
    credVerifyRef.current = null
    try {
      const res = (await cbAuth().reauthenticate()) as {
        data?: {
          updateUser?: ((p: { nonce: string; password: string }) => Promise<unknown>) | null
        }
        error?: unknown
      }
      if (res?.error) return errText(res.error)
      const verify = res?.data?.updateUser
      if (typeof verify !== 'function') return '验证码发送失败，请稍后重试'
      if (!isQbankSessionCurrent(session) || session.uid !== user.uid) return '账号已切换，请重新打开密码设置'
      credVerifyRef.current = { uid: user.uid, session, verify }
      return null
    } catch (e) {
      return errText(e)
    }
  }, [user])

  /** 只设置当前账号密码，不写登录用户名，不修改任何个人或学籍资料。 */
  const saveCredentials = useCallback(async (input: CredentialInput): Promise<string | null> => {
    if (localOnly) return '学生端已取消手机号账号密码。'
    if (!user) return '请先登录'
    const invalid = passwordSetupError(input)
    if (invalid) return invalid
    const held = credVerifyRef.current
    if (!held) return '请先获取验证码'
    if (held.uid !== user.uid || !isQbankSessionCurrent(held.session)) return '账号已切换，请重新获取验证码'
    try {
      const result = await applyPasswordSetup(input, held.verify) as { error?: unknown } | undefined
      if (result?.error) return passwordSetupMessage(errText(result.error))
      if (!isQbankSessionCurrent(held.session)) return '账号已切换，请回原账号查看密码设置结果'
      credVerifyRef.current = null
      await refresh()
      if (!isQbankSessionCurrent(held.session)) return '账号已切换，请回原账号查看密码设置结果'
      setUser(previous => previous?.uid === held.uid ? { ...previous, hasPassword: true, passwordStatusKnown: true } : previous)
      setCredOpen(false)
      return null
    } catch (error) { return passwordSetupMessage(errText(error)) }
  }, [user, refresh])

  const api = {
    phase,
    user,
    profile,
    isSigned: phase === 'signed' && !!user,
    loginOpen,
    loginReason,
    profileOpen,
    editOpen,
    credOpen,
    ensureGuest,
    ensureSignedIn,
    openLogin,
    closeLogin,
    completeStudentLogin,
    loginWithPassword,
    sendPhoneCode,
    submitPhoneCode,
    sendEmailCode,
    submitEmailCode,
    logout,
    askProfile,
    saveProfile,
    saveAvatar,
    savePersonalIntro,
    rename,
    openProfile,
    dismissProfile,
    openEdit,
    closeEdit,
    openCred,
    dismissCred,
    sendCredCode,
    saveCredentials,
  }

  return <AuthCtx.Provider value={api}>{children}</AuthCtx.Provider>
}
