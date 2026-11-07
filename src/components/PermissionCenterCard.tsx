/**
 * 设置页「权限中心」：已安装用户也能一键补齐全部系统权限。
 * 首次引导里也有同一份清单（data/shell-onboarding.ts）。
 */
import { useEffect, useState } from 'react'
import { SHELL_ONBOARDING } from '../data/shell-onboarding'
import {
  checkAllPermissions,
  requestAllPermissions,
  type PermissionRow,
  type PermissionStatus,
} from '../lib/permission-center'

const STATUS_TEXT: Record<PermissionStatus, string> = {
  granted: '已允许',
  denied: '已拒绝',
  prompt: '待开启',
  manual: '需在系统页打开',
  unsupported: '不支持',
}

const STATUS_COLOR: Record<PermissionStatus, string> = {
  granted: '#1f8f5f',
  denied: '#c2413a',
  prompt: 'var(--text-2)',
  manual: '#b26a00',
  unsupported: 'var(--text-2)',
}

const ITEMS = SHELL_ONBOARDING.user.perms

export function PermissionCenterCard() {
  const [rows, setRows] = useState<PermissionRow[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      void checkAllPermissions().then((next) => { if (!cancelled) setRows(next) })
    }
    refresh()
    document.addEventListener('visibilitychange', refresh)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  async function run() {
    if (busy) return
    setBusy(true)
    try {
      setRows(await requestAllPermissions(setRows))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section style={{ marginTop: 14, padding: '14px 14px 12px', borderRadius: 16, background: 'var(--card,#fff)', border: '1px solid var(--line,rgba(0,0,0,.06))' }}>
      <b style={{ fontSize: 15 }}>权限中心</b>
      <p style={{ margin: '4px 0 10px', fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
        通知、精确闹钟、电池白名单、悬浮窗、相机、位置。精确闹钟/电池/悬浮窗会跳到系统页，需要手动打开开关。
      </p>
      <div style={{ display: 'grid', gap: 8 }}>
        {ITEMS.map((item) => {
          const status = rows.find((row) => row.key === item.key)?.status
          return (
            <div key={item.key} style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ minWidth: 0 }}>
                <b style={{ fontSize: 13.5, display: 'block' }}>{item.title}</b>
                <span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{item.desc}</span>
              </span>
              <em style={{ flex: 'none', fontStyle: 'normal', fontSize: 12, color: status ? STATUS_COLOR[status] : 'var(--text-2)' }}>
                {status ? STATUS_TEXT[status] : '检查中…'}
              </em>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void run()}
        style={{ marginTop: 12, width: '100%', height: 42, borderRadius: 12, border: 0, background: 'var(--green,#1f8f5f)', color: '#fff', fontSize: 14, fontWeight: 600 }}
      >
        {busy ? '正在逐项开启…' : '一键全部开启'}
      </button>
    </section>
  )
}
