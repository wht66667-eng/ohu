import { useEffect, useRef, useState } from 'react'
import { IS_NATIVE } from '../lib/platform'
import {
  currentOtaRuntime,
  downloadAndQueueOta,
  fetchOtaManifest,
  getOtaCompatibilityError,
  hasMatchingPendingOta,
  shouldApplyOta,
  type OtaManifest,
} from '../lib/live-update'
import { APP_VERSION, checkAppUpdate, openUpdateDownload } from '../lib/app-update'
import styles from './OtaUpdateHost.module.css'

const LS_SKIP = 'sc.ota.skip.v1'

type Phase = 'hidden' | 'prompt' | 'downloading' | 'ready' | 'error'

/**
 * 进门弹窗：发现界面更新时提示下载，带进度条与重试。
 * 下载成功后用原生 set() 立刻切包，避免「重启后又要更新」死循环。
 */
export function OtaUpdateHost() {
  const [phase, setPhase] = useState<Phase>('hidden')
  const [remote, setRemote] = useState<OtaManifest | null>(null)
  const [localVer, setLocalVer] = useState(APP_VERSION)
  const [nativeVersion, setNativeVersion] = useState('')
  const [blocked, setBlocked] = useState(false)
  const [apkBusy, setApkBusy] = useState(false)
  const [percent, setPercent] = useState(0)
  const [error, setError] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (!IS_NATIVE || started.current) return
    started.current = true

    const run = async () => {
      await new Promise((r) => setTimeout(r, 900))
      const rem = await fetchOtaManifest()
      if (!rem) return
      const runtime = await currentOtaRuntime()
      const local = runtime.version
      setLocalVer(local)
      setNativeVersion(runtime.native?.version || '')
      const incompatible = getOtaCompatibilityError(rem, runtime)
      if (incompatible) {
        setRemote(rem)
        setError(incompatible)
        setBlocked(true)
        setPhase('error')
        return
      }
      if (!shouldApplyOta(rem, local, runtime)) return

      // 已下载排队：自动切过去，不再弹「发现新版本」
      if (await hasMatchingPendingOta(rem)) {
        const result = await downloadAndQueueOta(rem)
        if (result.ok) return
        setRemote(rem)
        setError(result.error)
        setPhase('error')
        return
      }

      try {
        const skip = JSON.parse(localStorage.getItem(LS_SKIP) || 'null') as {
          version?: string
          build?: number
          at?: number
        } | null
        if (
          skip?.version === rem.version &&
          Number(skip.build || 0) === Number(rem.build || 0) &&
          Date.now() - Number(skip.at || 0) < 6 * 3600 * 1000
        ) {
          return
        }
      } catch {
        /* ignore */
      }
      setRemote(rem)
      setPhase('prompt')
    }
    void run().catch(() => { /* A transient startup failure can be retried from Settings. */ })
  }, [])

  if (phase === 'hidden' || !remote) return null

  const mb = remote.size ? Math.max(1, Math.round(remote.size / 1024 / 1024)) : 0
  const notes = (remote.notes || []).filter(Boolean).slice(0, 3)

  async function startDownload() {
    if (!remote) return
    setPhase('downloading')
    setPercent(0)
    setError('')
    const r = await downloadAndQueueOta(remote, (p) => setPercent(p.percent))
    // set() 成功时页面会立刻被原生 reload，下面通常执行不到
    if (r.ok) {
      if (r.alreadyCurrent) {
        setPhase('hidden')
        return
      }
      setPhase('ready')
      setPercent(100)
    } else {
      setError(r.error)
      setPhase('error')
    }
  }

  function dismissLater() {
    try {
      localStorage.setItem(
        LS_SKIP,
        JSON.stringify({ version: remote!.version, build: remote!.build, at: Date.now() }),
      )
    } catch {
      /* ignore */
    }
    setPhase('hidden')
  }

  async function openCompatibleApk() {
    if (apkBusy) return
    setApkBusy(true)
    try {
      const result = await checkAppUpdate()
      if (result.status === 'error') setError(result.message)
      else if (result.status === 'up_to_date') setError('线上暂未提供所需的新安装包，请稍后检查更新或联系管理员。')
      else if (openUpdateDownload(result.manifest)) setError('已打开下载页面。请安装对应端的新 APK，然后重新打开应用。')
      else setError('暂未提供当前应用端的下载地址，请联系管理员。')
    } catch {
      setError('暂时无法检查安装包，请检查网络后重试。')
    } finally { setApkBusy(false) }
  }

  return (
    <div className={styles.mask} role="dialog" aria-label="界面更新">
      <div className={styles.card}>
        <div className={styles.badge}>界面更新</div>
        <h2 className={styles.title}>
          {blocked ? '请先更新安装包' : phase === 'ready' ? '正在切换到最新界面…' : `一键更新到 ${remote.version}`}
        </h2>
        <p className={styles.sub}>
          当前 v{localVer}
          {nativeVersion ? ` · 安装包 v${nativeVersion}` : ''}
          {mb > 0 ? ` · 约 ${mb}MB` : ''}
          {phase === 'ready'
            ? ' · 请稍候自动刷新'
            : ' · 这是完整最新包，不用按 1.2.20、1.2.21 逐级安装，中间做过的功能都在里面'}
        </p>
        {notes.length > 0 ? (
          <ul className={styles.notes}>
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}

        {phase === 'downloading' ? (
          <div className={styles.progressWrap}>
            <div className={styles.bar}>
              <i style={{ width: `${Math.max(4, percent)}%` }} />
            </div>
            <span className={styles.pct}>正在下载 {Math.round(percent)}%</span>
          </div>
        ) : null}

        {phase === 'error' ? <p className={styles.err}>{error || '下载失败'}</p> : null}

        <div className={styles.actions}>
          {phase === 'prompt' ? (
            <>
              <button type="button" className={styles.ghost} onClick={dismissLater}>
                稍后
              </button>
              <button type="button" className={styles.main} onClick={() => void startDownload()}>
                一键更新到最新
              </button>
            </>
          ) : null}
          {phase === 'downloading' ? (
            <button type="button" className={styles.ghost} disabled>
              请稍候…
            </button>
          ) : null}
          {phase === 'error' ? (
            <>
              <button type="button" className={styles.ghost} onClick={dismissLater}>
                关闭
              </button>
              {!blocked ? <button type="button" className={styles.main} onClick={() => void startDownload()}>
                重试
              </button> : <button type="button" className={styles.main} disabled={apkBusy} onClick={() => void openCompatibleApk()}>
                {apkBusy ? '正在检查…' : '更新安装包'}
              </button>}
            </>
          ) : null}
          {phase === 'ready' ? (
            <button type="button" className={styles.main} onClick={() => void startDownload()}>
              立即切换
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
