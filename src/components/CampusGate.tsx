import { useState, type ReactNode } from 'react'
import { CAMPUS_BRIDGE_AVAILABLE } from '../lib/campus-bridge'
import { loadLocalIdentity } from '../lib/local-identity'
import { startBackgroundSync, type GateCredentials } from '../lib/background-sync'
import { OneClickPage } from '../pages/study/OneClickPage'

const GATE_KEY = 'ohu.campus-gate.v1'

type GateRecord = { studentId: string; at: number }

function verifiedFor(studentId: string): boolean {
  try {
    const raw = JSON.parse(localStorage.getItem(GATE_KEY) || 'null') as GateRecord | null
    return !!raw && raw.studentId === studentId
  } catch {
    return false
  }
}

/** 记录本机已通过学号 + 校园网 + 统一认证的首次认证。 */
export function markCampusVerified(studentId: string) {
  try {
    localStorage.setItem(GATE_KEY, JSON.stringify({ studentId, at: Date.now() }))
  } catch { /* 存储不可用时仅本次会话有效 */ }
}

/**
 * 学生端入口门禁：首次进入必须在一键获取页完成 学号 + 校园网 + 统一认证 登录，
 * 同步成功后才放行，并把课表/成绩/考试等缓存到本机。
 */
export function CampusGate({ children }: { children: ReactNode }) {
  const identity = loadLocalIdentity()
  const [ready, setReady] = useState(() => !!identity && verifiedFor(identity.studentId))
  const [showHelp, setShowHelp] = useState(false)

  if (!CAMPUS_BRIDGE_AVAILABLE) return children
  if (ready) return children

  return <>
    <div style={{ height: '100dvh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
      <button type="button" onClick={() => setShowHelp(true)} style={{ display: 'block', width: '100%', padding: '10px 16px', border: 0, background: '#fff8e6', color: '#7a4b12', fontSize: 12, textAlign: 'left' }}>
        密码规则：校园网 2023 级后 8 位 / 2024 级起后 8 位 + @Jou；统一认证 Jou@ + 后 8 位。点此查看完整说明 ›
      </button>
      <OneClickPage gate={{ onPass: (credentials: GateCredentials) => {
        const now = loadLocalIdentity()
        if (now) markCampusVerified(now.studentId)
        setReady(true)
        void startBackgroundSync(credentials)
      } }} />
    </div>

    {showHelp ? <div role="dialog" aria-modal="true" aria-labelledby="gate-help-title" style={{ position: 'fixed', inset: 0, background: 'rgba(13,28,21,0.44)', display: 'grid', placeItems: 'center', padding: 22, zIndex: 80 }}>
      <div style={{ width: '100%', maxWidth: 380, maxHeight: '78vh', overflowY: 'auto', background: 'var(--card, #fff)', borderRadius: 18, padding: '20px 18px 16px', display: 'grid', gap: 12, boxShadow: '0 18px 40px rgba(20,40,30,0.25)' }}>
        <h2 id="gate-help-title" style={{ margin: 0, fontSize: 18 }}>密码规则提醒</h2>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
          <b>校园网 / VPN 密码</b><br />
          2023 级及以前：默认身份证后 8 位。<br />
          2024 级起：身份证后 8 位 + @Jou。
        </p>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
          <b>统一认证密码</b><br />
          初始为 Jou@ + 身份证后 8 位，区分大小写。
        </p>
        <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>首次认证会登录学校系统并同步课表、成绩、考试；密码只在本机使用。</p>
        <button type="button" onClick={() => setShowHelp(false)} style={{ minHeight: 44, borderRadius: 12, border: 0, background: 'var(--green, #16735b)', color: '#fff', fontSize: 15, fontWeight: 600 }}>知道了，开始认证</button>
      </div>
    </div> : null}
  </>
}
