import { useEffect, useState } from 'react'
import { IS_NATIVE } from '../lib/platform'
import { checkAppUpdate, type UpdateManifest } from '../lib/app-update'
import { getAppShell } from '../lib/app-shell'
import { copyText } from '../lib/campus-account'
import { launchScheme } from '../lib/express-app-probe'
import styles from './AppUpdateNotice.module.css'

const SKIP_KEY = 'ohu.app-update.notice.v1'
const SKIP_MS = 7 * 24 * 3600 * 1000
const HOST = 'https://jou-d4gq7a3cqf51e6caa-1394316826.tcloudbaseapp.com'

/**
 * 安装包更新公告：安装包版本落后时，在 App 顶部提示去官网下载新安装包。
 * 与 OtaUpdateHost（界面热更新）分开：热更新只换 Web 包，这里换的是 APK。
 * 公告只在原生端、进入 App 后出现；同一构建 7 天内关闭过就不再打扰。
 */
export function AppUpdateNotice() {
  const [manifest, setManifest] = useState<UpdateManifest | null>(null)
  const [forced, setForced] = useState(false)
  const [opening, setOpening] = useState(false)
  const [fallback, setFallback] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!IS_NATIVE) return
    let alive = true
    const timer = window.setTimeout(() => {
      void checkAppUpdate()
        .then((result) => {
          if (!alive || result.status === 'up_to_date' || result.status === 'error') return
          const next = result.manifest
          if (result.status !== 'forced') {
            try {
              const skip = JSON.parse(localStorage.getItem(SKIP_KEY) || 'null') as { build?: number; at?: number } | null
              if (Number(skip?.build || 0) >= next.latestBuild && Date.now() - Number(skip?.at || 0) < SKIP_MS) return
            } catch { /* ignore */ }
          }
          setForced(result.status === 'forced')
          setManifest(next)
        })
        .catch(() => { /* 设置页仍可手动检查更新 */ })
    }, 2500)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [])

  if (!manifest) return null
  const shell = getAppShell()
  const page = `${HOST}/download/${shell === 'admin' ? 'admin' : 'student'}.html`
  const notes = (manifest.notes || []).filter(Boolean)

  async function openWebsite() {
    if (opening) return
    setOpening(true)
    setCopied(false)
    try { setFallback(!await launchScheme(page)) }
    finally { setOpening(false) }
  }

  function dismiss() {
    try {
      localStorage.setItem(SKIP_KEY, JSON.stringify({ build: manifest!.latestBuild, at: Date.now() }))
    } catch { /* private browsing */ }
    setManifest(null)
  }

  return <aside className={styles.banner} role="status" aria-live="polite" aria-label="安装包更新公告">
    <div className={styles.copy}>
      <b>哦狐 {manifest.latestVersion} 已发布</b>
      <span>{notes[0] || '修复与体验改进，请到官网下载最新安装包。'}</span>
      <small>安装包需要到官网更新；课表、成绩等本机数据不会丢失。</small>
      {fallback ? <div className={styles.fallback}>
        <span role="status">{copied ? '官网链接已复制，请粘贴到浏览器。' : '没能打开浏览器，可以复制官网链接后手动打开。'}</span>
        <input type="url" aria-label="官网更新链接" value={page} readOnly onFocus={event => event.target.select()} />
        <button type="button" onClick={async () => setCopied(await copyText(page))}>复制官网链接</button>
      </div> : null}
    </div>
    <div className={styles.actions}>
      <button type="button" className={styles.cta} aria-busy={opening} disabled={opening}
        onClick={() => void openWebsite()}>{opening ? '正在打开…' : '去官网更新'}</button>
      {forced ? null : <button type="button" className={styles.close} aria-label="稍后再说" onClick={dismiss}>×</button>}
    </div>
  </aside>
}
