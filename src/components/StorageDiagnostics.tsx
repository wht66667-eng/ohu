import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './StorageDiagnostics.module.css'

type StorageReport = {
  localEntries: number | null
  localBytes: number | null
  usage: number | null
  quota: number | null
  checkedAt: number
}

function formatBytes(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '暂不可用'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function localStorageEstimate(): { entries: number | null; bytes: number | null } {
  try {
    const storage = window.localStorage
    let entries = 0
    let bytes = 0
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index)
      if (key == null) continue
      const value = storage.getItem(key) || ''
      entries++
      // localStorage is commonly accounted in UTF-16 code units; this is only a rough estimate.
      bytes += (key.length + value.length) * 2
    }
    return { entries, bytes }
  } catch {
    return { entries: null, bytes: null }
  }
}

export function StorageDiagnostics() {
  const [report, setReport] = useState<StorageReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false)

  const refresh = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const local = localStorageEstimate()
      let usage: number | null = null
      let quota: number | null = null
      try {
        const storage = navigator.storage
        if (storage?.estimate) {
          const estimate = await storage.estimate()
          usage = typeof estimate.usage === 'number' && Number.isFinite(estimate.usage) ? estimate.usage : null
          quota = typeof estimate.quota === 'number' && Number.isFinite(estimate.quota) ? estimate.quota : null
        }
      } catch {
        // Browser-level estimates can be unavailable in private or embedded contexts.
      }
      setReport({ localEntries: local.entries, localBytes: local.bytes, usage, quota, checkedAt: Date.now() })
      if (local.entries == null && usage == null) setError('当前环境暂时无法读取存储估算。')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const ratio = report?.usage != null && report.quota != null && report.quota > 0
    ? Math.min(100, Math.max(0, (report.usage / report.quota) * 100))
    : null

  return <section className={styles.card} aria-labelledby="storage-diagnostics-title">
    <div className={styles.heading}>
      <div><span>本机信息</span><h2 id="storage-diagnostics-title">存储占用估算</h2></div>
      <button type="button" onClick={() => void refresh()} disabled={busy}>{busy ? '读取中…' : '重新检查'}</button>
    </div>
    <p className={styles.intro}>在本机统计条目数并估算占用；不会上传或展示具体内容，也不会删除缓存。</p>
    {error ? <p className={styles.error} role="status">{error}</p> : null}
    {report ? <>
      <div className={styles.metrics}>
        <div><span>网站总占用</span><strong>{formatBytes(report.usage)}</strong></div>
        <div><span>浏览器提供的空间上限</span><strong>{formatBytes(report.quota)}</strong></div>
        <div><span>哦狐 localStorage 估算</span><strong>{formatBytes(report.localBytes)}</strong></div>
        <div><span>localStorage 条目数</span><strong>{report.localEntries == null ? '暂不可用' : `${report.localEntries} 项`}</strong></div>
      </div>
      {ratio != null ? <div className={styles.progressBlock}>
        <div className={styles.progressLabel}><span>网站总占用比例</span><strong>{ratio.toFixed(1)}%</strong></div>
        <div className={styles.track} role="progressbar" aria-label="网站总占用比例" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(ratio.toFixed(1))}><span style={{ width: `${ratio}%` }} /></div>
      </div> : null}
      <p className={styles.note}>浏览器总占用可能还包括同一网站的其他缓存；localStorage 大小是近似值。这里显示的是设备／浏览器数据，不是账号云端容量。{report.checkedAt ? ` 最近检查：${new Date(report.checkedAt).toLocaleTimeString()}` : ''}</p>
    </> : busy ? <p className={styles.loading} role="status">正在读取本机可提供的存储信息…</p> : <p className={styles.loading}>暂时没有可显示的估算值。</p>}
  </section>
}
