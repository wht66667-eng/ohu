import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import { clearEntryTrack } from '../lib/entry-track'
import { socialInviteRedeem, socialInviteStatus } from '../lib/social-invites'
import { validateInviteCodeFormat } from '../lib/social-invites-helpers'
import styles from './EntryChoice.module.css'

/**
 * 社工端登录门（M-ENTRY）：邮箱 / 手机验证码登录。
 * OTP 全部走 auth 层（sendEmailCode/submitEmailCode、sendPhoneCode/submitPhoneCode）；
 * 云控制台未开启对应登录方式时，auth 会返回可读原因，这里原样展示。
 * 登录方式的出口只有「返回身份选择」（清除本机端别后回到 EntryChoice）——社工端不做访客降级。
 *
 * TASK-A3（硬门口径，2026-11-14）：OTP 登录成功（auth.isSigned 变 true）后必须通过
 * 「邀请码绑定」步骤才可见任何 App 内容——调 social_invite_status，存在未撤销双人空间
 * 才渲染业务内容；未绑定只显示邀请码输入页；RPC 未部署（42883）/网络失败一律按错误态
 * 处理（重试 + 运维指引），状态保持未绑定，不放行、不降级浏览。
 */
export function SocialGate({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const [way, setWay] = useState<'email' | 'phone'>('email')
  const [account, setAccount] = useState('')
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [signing, setSigning] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  if (auth.isSigned) return <InviteBindGate>{children}</InviteBindGate>

  const sendCode = async () => {
    setError(''); setNotice('')
    if (way === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)) { setError('请输入正确的邮箱地址。'); return }
    if (way === 'phone' && !/^1\d{10}$/.test(account)) { setError('请输入正确的手机号。'); return }
    setSending(true)
    try {
      const reason = way === 'email' ? await auth.sendEmailCode(account) : await auth.sendPhoneCode(account)
      if (reason) setError(reason)
      else setNotice('验证码已发送，请在 3 分钟内输入。')
    } finally { setSending(false) }
  }

  const signIn = async () => {
    setError(''); setNotice('')
    if (!/^\d{4,8}$/.test(code.trim())) { setError('请输入收到的验证码。'); return }
    setSigning(true)
    try {
      const reason = way === 'email' ? await auth.submitEmailCode(code.trim()) : await auth.submitPhoneCode(code.trim())
      if (reason) setError(reason)
    } finally { setSigning(false) }
  }

  const switchWay = (next: 'email' | 'phone') => {
    setWay(next); setAccount(''); setCode(''); setError(''); setNotice('')
  }

  /** 返回身份选择：清除本机端别后整页刷新，EntryRouter 回到 EntryChoice */
  const backToEntryChoice = () => {
    clearEntryTrack()
    window.location.reload()
  }

  return <div className={styles.page}>
    <div className={styles.card}>
      <span className={styles.eyebrow}>社工端 · 验证码登录</span>
      <h1>登录哦狐</h1>
      <p className={styles.hint}>校外用户使用邮箱或手机验证码登录；学生端功能（教务同步）不在此入口。</p>
      <div className={styles.schoolList} role="group" aria-label="登录方式">
        <button type="button" className={`${styles.schoolRow} ${way === 'email' ? styles.picked : ''}`} onClick={() => switchWay('email')}>
          <b>邮箱验证码</b>
        </button>
        <button type="button" className={`${styles.schoolRow} ${way === 'phone' ? styles.picked : ''}`} onClick={() => switchWay('phone')}>
          <b>手机验证码</b>
        </button>
      </div>
      <input
        className={styles.input}
        type={way === 'email' ? 'email' : 'tel'}
        inputMode={way === 'email' ? 'email' : 'numeric'}
        placeholder={way === 'email' ? 'you@example.com' : '13800000000'}
        value={account}
        autoComplete="username"
        onChange={event => setAccount(event.target.value)}
      />
      <div className={styles.codeRow}>
        <input
          className={styles.input}
          type="text"
          inputMode="numeric"
          placeholder="验证码"
          maxLength={8}
          value={code}
          autoComplete="one-time-code"
          onChange={event => setCode(event.target.value)}
        />
        <button type="button" className={styles.sendBtn} disabled={sending || !account} onClick={() => void sendCode()}>
          {sending ? '发送中…' : '发送验证码'}
        </button>
      </div>
      <button type="button" className={styles.primary} disabled={signing || !code} onClick={() => void signIn()}>
        {signing ? '登录中…' : '登录'}
      </button>
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {error ? <p className={styles.errorText} role="alert">{error}</p> : null}
      <p className={styles.hint}>没有收到验证码？对应登录方式可能未在控制台开启；登录后还需学生或管理员发放的邀请码才能进入社工端。</p>
      <button type="button" className={styles.back} onClick={backToEntryChoice}>返回身份选择 ›</button>
    </div>
  </div>
}

/**
 * 邀请码绑定硬门（TASK-A3，2026-11-14 硬性要求口径）：
 * - 登录成功后先查 social_invite_status：存在未撤销双人空间 → 放行；否则只显示邀请码输入页；
 * - 过期/撤销/用满/格式错/未知码五类失败都给可读错误，可重输；redeem 成功立即进入正文；
 * - RPC 未部署（42883）或网络失败 = 无法核验绑定态 = 不放行：错误态给「重试」与运维指引
 *   （部署 docs/sql/social-invites-166.sql），不提供任何绕过；
 * - 出口只有「返回身份选择」（清端别回 EntryChoice），不提供访客浏览；
 * - 空间在首页面板被解除/屏蔽（ohhu-social-spaces-changed 事件，剩余 0）→ 回到邀请码绑定页；
 *   TASK-A6：社工端复用学生端壳，门本体只做硬门，双人空间/共享课表区块在首页组件。
 */
type BindPhase = 'bound' | 'unbound'

function InviteBindGate({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const uid = auth.user?.uid || ''
  /** 已完成绑码检查的 uid（≠当前 uid 时渲染「校验中」，避免 effect 里同步 setState） */
  const [checkedFor, setCheckedFor] = useState('')
  const [phase, setPhase] = useState<BindPhase>('unbound')
  /** 状态检查失败：非空表示处于错误态（含 RPC 未部署），不放行 */
  const [statusError, setStatusError] = useState('')
  const [statusMissing, setStatusMissing] = useState(false)
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (checkedFor === uid) return
    let alive = true
    socialInviteStatus().then((st) => {
      if (!alive) return
      setCheckedFor(uid)
      if (st.rpcMissing) {
        setStatusMissing(true)
        setStatusError(st.error || 'function not found (42883)')
        setPhase('unbound')
      } else if (st.error) {
        setStatusMissing(false)
        setStatusError(st.error)
        setPhase('unbound')
      } else {
        setStatusMissing(false)
        setStatusError('')
        setPhase(st.spaces.length > 0 ? 'bound' : 'unbound')
        setError('')
      }
    })
    return () => { alive = false }
  }, [uid, checkedFor])

  // 首页面板解除/屏蔽空间后（剩余 0）回到绑码页：重新校验绑定态
  useEffect(() => {
    const onSpacesChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ activeSpaces?: number }>).detail
      if (detail && detail.activeSpaces === 0) {
        setPhase('unbound')
        setCheckedFor('')
      }
    }
    window.addEventListener('ohhu-social-spaces-changed', onSpacesChanged)
    return () => { window.removeEventListener('ohhu-social-spaces-changed', onSpacesChanged) }
  }, [])

  const checked = !!uid && checkedFor === uid

  if (!checked) {
    return <div className={styles.page}>
      <div className={styles.card}>
        <span className={styles.eyebrow}>社工端 · 邀请码</span>
        <h1>正在校验邀请码…</h1>
        <p className={styles.hint}>正在确认你的账号是否已绑定邀请码。</p>
      </div>
    </div>
  }

  if (phase === 'bound' && !statusError) {
    // TASK-A6：社工端复用学生端壳，进入后由各页按 useEntryTrack 条件渲染；
    // 双人空间/共享课表区块迁至首页（components/SocialHomeSections.tsx），门本体只做硬门。
    // 空间在首页面板被解除/屏蔽后（剩余 0 事件）回到绑码页重新校验。
    return <>{children}</>
  }

  /** 返回身份选择：清除本机端别后整页刷新，EntryRouter 回到 EntryChoice */
  const backToEntryChoice = () => {
    clearEntryTrack()
    window.location.reload()
  }

  const submitBind = async () => {
    setError('')
    const raw = code.trim()
    if (!validateInviteCodeFormat(raw)) {
      setError('邀请码格式不正确：请输入 8 位码（如 ABCD-EF23）')
      return
    }
    setSubmitting(true)
    try {
      const res = await socialInviteRedeem(raw)
      if (res.ok) {
        setPhase('bound')
        setCode('')
        return
      }
      setError(res.error || '绑定未成功，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  if (statusError) {
    // 错误态（含 42883 未部署）：无法核验绑定态 = 不放行；只给重试与身份出口，无绕过。
    // 主按钮「重试」底部固定（TASK-A6：390px 单手可达），页面留出底部空间防遮挡。
    return <>
      <div className={styles.page} style={{ paddingBottom: 104 }}>
        <div className={styles.card}>
          <span className={styles.eyebrow}>社工端 · 邀请码</span>
          <h1>{statusMissing ? '邀请码服务尚未部署' : '邀请码状态读取失败'}</h1>
          {statusMissing ? <p className={styles.notice} role="status">邀请码体系尚未部署，当前无法核验绑定态，暂不能进入社工端</p> : null}
          <p className={styles.hint}>
            {statusMissing
              ? '请管理员先在服务端部署迁移 docs/sql/social-invites-166.sql（含 social_invites / social_spaces / schedule_shares 与全部 RPC），部署完成后点「重试」。'
              : '网络或服务暂时不可用，无法确认你的绑定状态；稍后点「重试」再试。'}
          </p>
          {statusError ? <p className={styles.errorText} role="alert">{statusError}</p> : null}
          <button type="button" className={styles.back} onClick={backToEntryChoice}>返回身份选择 ›</button>
        </div>
      </div>
      <div style={{ position: 'fixed', left: 16, right: 16, bottom: 'calc(14px + env(safe-area-inset-bottom, 0px))', zIndex: 50 }}>
        <button
          type="button"
          className={styles.primary}
          style={{ width: '100%', minHeight: 50, fontSize: 16, boxShadow: '0 8px 22px rgba(31, 91, 58, 0.30)' }}
          onClick={() => setCheckedFor('')}
        >
          重试
        </button>
      </div>
    </>
  }

  // 绑码页：与登录页共用 EntryChoice 视觉（森林绿主按钮/卡片间距）；主按钮底部固定，单手可达。
  return <>
    <div className={styles.page} style={{ paddingBottom: 104 }}>
      <div className={styles.card}>
        <span className={styles.eyebrow}>社工端 · 邀请码绑定</span>
        <h1>输入邀请码</h1>
        <p className={styles.hint}>
          哦狐社工端凭邀请码开通：向学生或管理员索取 8 位一次性邀请码，绑定后建立双人空间（默认 7 天有效）。
          绑定出错可随时重输。
        </p>
        <input
          className={styles.input}
          type="text"
          inputMode="text"
          placeholder="ABCD-EF23"
          maxLength={9}
          autoComplete="off"
          value={code}
          style={{ textAlign: 'center', letterSpacing: '0.14em', fontSize: 18, fontWeight: 700 }}
          onChange={event => setCode(event.target.value.toUpperCase())}
          onKeyDown={event => { if (event.key === 'Enter' && code.trim()) void submitBind() }}
        />
        {error ? <p className={styles.errorText} role="alert">{error}</p> : null}
        <button type="button" className={styles.back} onClick={backToEntryChoice}>返回身份选择 ›</button>
      </div>
    </div>
    <div style={{ position: 'fixed', left: 16, right: 16, bottom: 'calc(14px + env(safe-area-inset-bottom, 0px))', zIndex: 50 }}>
      <button
        type="button"
        className={styles.primary}
        style={{ width: '100%', minHeight: 50, fontSize: 16, boxShadow: '0 8px 22px rgba(31, 91, 58, 0.30)' }}
        disabled={submitting || !code.trim()}
        onClick={() => void submitBind()}
      >
        {submitting ? '绑定中…' : '绑定邀请码'}
      </button>
    </div>
  </>
}

