import { useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { saveShareImage } from '../lib/share-image'
import { OHU_SHARE_URL, shareOhuLink } from '../lib/ohu-sharing'
import styles from './ohu-share-panel.module.css'

type PosterModule = { renderSharePoster: (index: number) => Promise<Blob> }
const themes = ['森林绿', '橘子汽水', '晴空蓝']

/** One embedded page for links, QR art and platform-specific image saving. */
export function OhuSharePanel() {
  const [theme, setTheme] = useState(0)
  const [mode, setMode] = useState<'link' | 'image'>('link')
  const [image, setImage] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const mounted = useRef(true)
  const busyRef = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let active = true
    let reader: FileReader | undefined
    setImage(''); setLoading(true); setLoadError(''); setMessage('')
    const timer = window.setTimeout(() => {
      active = false
      if (mounted.current) { setLoading(false); setLoadError('分享图暂时未能生成，仍可分享链接。') }
    }, 15000)
    const path = new URL('/download/share-poster.mjs', window.location.origin).href
    void import(/* @vite-ignore */ path).then((mod: PosterModule) => mod.renderSharePoster(theme)).then(blob => {
      if (!active) return
      reader = new FileReader()
      reader.onload = () => {
        if (active && typeof reader?.result === 'string') { setImage(reader.result); setLoading(false); window.clearTimeout(timer) }
      }
      reader.onerror = () => { if (active) { setLoading(false); setLoadError('分享图生成失败，仍可分享链接。'); window.clearTimeout(timer) } }
      reader.readAsDataURL(blob)
    }).catch(() => { if (active) { setLoading(false); setLoadError('分享图生成失败，仍可分享链接。'); window.clearTimeout(timer) } })
    return () => { active = false; window.clearTimeout(timer); if (reader?.readyState === 1) reader.abort() }
  }, [theme, attempt])

  const platform = Capacitor.getPlatform()
  const imageAction = platform === 'android' ? '保存分享图到相册' : platform === 'ios' ? '分享图片' : '下载分享图'
  async function share() {
    if (busyRef.current || (mode === 'image' && !image)) return
    busyRef.current = true; setBusy(true); setMessage('')
    try {
      const result = mode === 'image' ? await saveShareImage(image, 'ohu-share.png') : await shareOhuLink()
      if (mounted.current) setMessage(result)
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : '分享未完成，请重试。')
    } finally { busyRef.current = false; if (mounted.current) setBusy(false) }
  }

  return <section className={styles.panel} aria-label="分享哦狐">
    <h2>把哦狐分享给同学</h2>
    <div className={styles.preview}>
      <img src={image || '/download/assets/share-qr.png'} alt={image ? '哦狐分享图，含官网二维码' : '哦狐官网二维码'} width={image ? 720 : 360} height={image ? 1080 : 360} />
      <span>扫码打开哦狐官网</span>
    </div>
    <div className={styles.options}>
      <label>分享方式<select value={mode} disabled={busy} onChange={event => { setMode(event.target.value as 'link' | 'image'); setMessage('') }}><option value="link">链接</option><option value="image">二维码分享图</option></select></label>
      {mode === 'image' ? <label>分享图样式<select value={theme} disabled={busy} onChange={event => setTheme(Number(event.target.value))}>{themes.map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label> : null}
    </div>
    {loadError ? <p className={styles.note}>{loadError} <button type="button" disabled={loading || busy} onClick={() => setAttempt(value => value + 1)}>重新生成</button></p> : null}
    <div className={styles.action}><button type="button" className={styles.primary} disabled={busy || (mode === 'image' && !image)} onClick={() => void share()}>{busy ? '正在处理…' : mode === 'link' ? '分享哦狐' : loading ? '正在生成分享图…' : imageAction}</button></div>
    {message ? <p className={styles.note} role="status">{message}</p> : null}
    <a className={styles.website} href={OHU_SHARE_URL} target="_blank" rel="noopener noreferrer">官网与安装说明 ↗</a>
    <a className={styles.website} href="/download/student.html" target="_blank" rel="noopener noreferrer">安卓 APK / iOS 安装包 →</a>
  </section>
}
