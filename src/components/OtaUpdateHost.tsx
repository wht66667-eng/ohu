import { useEffect, useRef, useState } from 'react'
import { IS_NATIVE } from '../lib/platform'
import {
  currentOtaRuntime,
  downloadAndQueueOta,
  fetchOtaManifest,
  getOtaCompatibilityError,
  shouldApplyOta,
  type OtaManifest,
} from '../lib/live-update'
import { APP_VERSION } from '../lib/app-update'
import styles from './OtaUpdateHost.module.css'

const LS_SKIP = 'sc.ota.skip.v1'
const SKIP_MS = 6 * 3600 * 1000

type Phase = 'hidden' | 'prompt' | 'downloading' | 'ready' | 'error'

/**
 * 热更新提示：只让用户选「更新 / 不更新」，不再自动切包、不再阻断使用。
 * 安装包与应用端不匹配时静默跳过（设置页仍可手动检查）。
 */
export function OtaUpdateHost() {
  const [phase, setPhase] = useState<Phase>('hidden')
  const [remote, setRemote] = useState<OtaManifest | null>(null)
  const [localVer, setLocalVer] = useState(APP_VERSION)
  const [nativeVersion, setNativeVersion] = useState('')
  const [percent, setPercent] = useState(0)
  const [error, setError] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (!IS_NATIVE || started.current) return
    started.current = true

    const run = async () => {
      await new Promise((resolve) => setTimeout(resolve, 900))
      const rem = await fetchOtaManifest()
      if (!rem) return
      const runtime = await currentOtaRuntime()
      const local = runtime.version
      setLocalVer(local)
      setNativeVersion(runtime.native?.version || '')
      if (getOtaCompatibilityError(rem, runtime)) return
      if (!shouldApplyOta(rem, local, runtime)) return

      try {
        const skip = JSON.parse(localStorage.getItem(LS_SKIP) || 'null') as {
          version?: string
          build?: number
          at?: number
        } | null
        if (
          skip?.version === rem.version &&
          Number(skip.build || 0) === Number(rem.build || 0) &&
          Date.now() - Number(skip.at || 0) < SKIP_MS
        ) {
          return
        }
      } catch {
        /* ignore */
      }
      setRemote(rem)
      setPhase('prompt')
    }
    void run().catch(() => { /* 设置页仍可手动检查更新 */ })
  }, [])

  if (phase === 'hidden' || !remote) return null

  const mb = remote.size ? Math.max(1, Math.round(remote.size / 1024 / 1024)) : 0
  const notes = (remote.notes || []).filter(Boolean).slice(0, 3)

  async function startDownload() {
    if (!remote) return
    setPhase('downloading')
    setPercent(0)
    setError('')
    const result = await downloadAndQueueOta(remote, (progress) => setPercent(progress.percent))
    if (result.ok) {
      if (result.alreadyCurrent) {
        setPhase('hidden')
        return
      }
      setPhase('ready')
      setPercent(100)
    } else {
      setError(result.error)
      setPhase('error')
    }
  }

  function skipNow() {
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

  return (
    <div className={styles.mask} role="dialog" aria-label="界面更新">
      <div className={styles.card}>
        <div className={styles.badge}>界面更新</div>
        <h2 className={styles.title}>
          {phase === 'ready' ? '更新已就绪' : '发现新的界面版本'}
        </h2>
        <p className={styles.sub}>
          当前 v{localVer}
          {nativeVersion ? ` · 安装包 v${nativeVersion}` : ''}
          {mb > 0 ? ` · 约 ${mb}MB` : ''}
          {' · 更新后自动重启，不影响本地数据'}
        </p>
        {notes.length > 0 ? (
          <ul className={styles.notes}>
            {notes.map((note) => (
              <li key={note}>{note}</li>
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

        {phase === 'error' ? <p className={styles.err}>{error || '下载失败，请稍后重试'}</p> : null}

        <div className={styles.actions}>
          {phase === 'prompt' ? (
            <>
              <button type="button" className={styles.ghost} onClick={skipNow}>
                不更新
              </button>
              <button type="button" className={styles.main} onClick={() => void startDownload()}>
                更新
              </button>
            </>
          ) : null}
          {phase === 'downloading' ? (
            <button type="button" className={styles.ghost} disabled>
              正在下载…
            </button>
          ) : null}
          {phase === 'error' ? (
            <>
              <button type="button" className={styles.ghost} onClick={skipNow}>
                不更新
              </button>
              <button type="button" className={styles.main} onClick={() => void startDownload()}>
                重试
              </button>
            </>
          ) : null}
          {phase === 'ready' ? (
            <button type="button" className={styles.main} onClick={() => void startDownload()}>
              立即生效
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
