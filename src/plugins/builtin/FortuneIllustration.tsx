import { useState, type ReactNode } from 'react'
import { DialogLayer } from '../../components/ui/DialogLayer'
import { fortuneArtwork, type FortuneSeries } from './fortune-cards'
import styles from './PlayfulReadings.module.css'

export function FortuneIllustration({ series, id, alt, fallback, lazy = false, previewTitle, reversed = false }: {
  series: FortuneSeries
  id: string
  alt: string
  fallback?: ReactNode
  lazy?: boolean
  previewTitle?: string
  reversed?: boolean
}) {
  const src = fortuneArtwork(series, id)
  const [failedSource, setFailedSource] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  if (failedSource === src) {
    return fallback ?? <div className={styles.artFallback} role="status"><span aria-hidden="true">✦</span>卡面暂不可用<button type="button" onClick={() => setFailedSource('')}>重试</button></div>
  }
  const artwork = <img className={styles.fortuneArt} src={src} alt={alt} data-reversed={reversed || undefined} width={640} height={960}
    loading={lazy ? 'lazy' : 'eager'} decoding="async" onError={() => { setFailedSource(src); setPreviewOpen(false) }} />
  if (!previewTitle) return artwork

  return <>
    <button className={styles.artPreviewTrigger} type="button" aria-label={`放大查看${previewTitle}`}
      onClick={() => setPreviewOpen(true)}>{artwork}<span aria-hidden="true" className={styles.zoomMark}>⤢</span></button>
    {previewOpen ? <DialogLayer title={previewTitle} className={styles.artPreviewDialog} onClose={() => setPreviewOpen(false)}>
      <header><h2>{previewTitle}</h2><button type="button" onClick={() => setPreviewOpen(false)}>关闭</button></header>
      {artwork}
    </DialogLayer> : null}
  </>
}
