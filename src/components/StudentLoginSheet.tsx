/**
 * 学生端登录弹窗：游客可以浏览，使用发布/互动/同步等功能时弹出。
 * 登录用学号 + 统一认证密码（校园网密码不同时单独填），验证通过后建立本机身份。
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { getAppShell } from '../lib/app-shell'
import { readOneClickCredentials } from '../lib/oneclick-credentials'
import { ensureLocalIdentity } from '../lib/local-identity'
import { verifyCampusIdentity } from '../lib/one-click'
import { IS_NATIVE } from '../lib/platform'
import { toast } from '../lib/toast'

export function StudentLoginSheet() {
  const auth = useAuth()
  const navigate = useNavigate()
  const localOnly = getAppShell() === 'user'
  const initial = readOneClickCredentials()
  const [studentId, setStudentId] = useState(initial.stuid || '')
  const [casPassword, setCasPassword] = useState('')
  const [vpnPassword, setVpnPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!auth.loginOpen) {
      setBusy(false)
      setStage('')
      setError('')
      setCasPassword('')
      setVpnPassword('')
    }
  }, [auth.loginOpen])

  if (!localOnly || !auth.loginOpen) return null

  async function submit() {
    if (busy) return
    const id = studentId.trim()
    if (!/^\d{6,20}$/.test(id)) { setError('请输入正确的学号。'); return }
    if (!casPassword) { setError('请输入统一认证密码。'); return }
    setBusy(true)
    setError('')
    setStage('正在验证…')
    try {
      if (IS_NATIVE) {
        await verifyCampusIdentity(id, vpnPassword.trim() || casPassword, casPassword, (_key, message) => {
          setStage(message)
        })
      }
      const identity = ensureLocalIdentity(id)
      if (!identity) throw new Error('本机身份保存失败，请检查存储空间。')
      setStage('登录成功')
      await auth.completeStudentLogin()
      toast.ok('已登录')
    } catch (cause) {
      const message = (cause as { message?: string })?.message || '登录失败，请检查学号与密码。'
      setError(message)
      setStage('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="登录"
      style={{
        position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(17,24,20,.42)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 12,
      }}
      onClick={(event) => { if (event.target === event.currentTarget) auth.closeLogin() }}
    >
      <div style={{ width: '100%', maxWidth: 520, borderRadius: 22, background: 'var(--card,#fff)', padding: '20px 18px 16px', boxShadow: '0 18px 60px rgba(0,0,0,.28)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <b style={{ fontSize: 19 }}>登录哦狐</b>
            <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
              {auth.loginReason || '登录后即可使用发布、互动与同步功能'}
            </p>
          </div>
          <button type="button" aria-label="关闭" onClick={auth.closeLogin} style={{ border: 0, background: 'transparent', fontSize: 20, color: 'var(--text-2)', padding: 4 }}>×</button>
        </div>

        <label style={{ display: 'block', marginTop: 16 }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>学号</span>
          <input
            value={studentId}
            inputMode="numeric"
            autoComplete="username"
            onChange={(event) => setStudentId(event.target.value)}
            placeholder="2023111111"
            style={{ width: '100%', height: 46, marginTop: 6, borderRadius: 12, border: '1px solid var(--line,rgba(0,0,0,.12))', padding: '0 12px', fontSize: 16, background: 'var(--bg,#f7f8f6)' }}
          />
        </label>

        <label style={{ display: 'block', marginTop: 12 }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>统一认证密码</span>
          <input
            value={casPassword}
            type="password"
            autoComplete="current-password"
            onChange={(event) => setCasPassword(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void submit() }}
            placeholder="统一身份认证密码"
            style={{ width: '100%', height: 46, marginTop: 6, borderRadius: 12, border: '1px solid var(--line,rgba(0,0,0,.12))', padding: '0 12px', fontSize: 16, background: 'var(--bg,#f7f8f6)' }}
          />
        </label>

        <label style={{ display: 'block', marginTop: 12 }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>校园网密码（和统一认证不同时填写）</span>
          <input
            value={vpnPassword}
            type="password"
            autoComplete="off"
            onChange={(event) => setVpnPassword(event.target.value)}
            placeholder="留空则使用统一认证密码"
            style={{ width: '100%', height: 46, marginTop: 6, borderRadius: 12, border: '1px solid var(--line,rgba(0,0,0,.12))', padding: '0 12px', fontSize: 16, background: 'var(--bg,#f7f8f6)' }}
          />
        </label>

        {stage ? <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--text-2)' }}>{stage}</p> : null}
        {error ? <p role="alert" style={{ margin: '10px 0 0', fontSize: 12.5, color: '#c2413a', lineHeight: 1.5 }}>{error}</p> : null}

        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          style={{ marginTop: 16, width: '100%', height: 46, borderRadius: 14, border: 0, background: 'var(--green,#1f8f5f)', color: '#fff', fontSize: 15, fontWeight: 600 }}
        >
          {busy ? '正在登录…' : '登录'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => { auth.closeLogin(); navigate('/study/oneclick') }}
          style={{ marginTop: 8, width: '100%', height: 40, borderRadius: 12, border: 0, background: 'transparent', color: 'var(--text-2)', fontSize: 13 }}
        >
          改用「一键获取」填写完整账号
        </button>
        <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--text-2)', textAlign: 'center', lineHeight: 1.5 }}>
          密码只用于本次登录验证，不会写入日志；登录后本机只保存学号身份。
        </p>
      </div>
    </div>
  )
}
