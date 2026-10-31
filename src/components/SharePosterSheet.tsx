import { useEffect, useState } from 'react'
import { saveShareImage } from '../lib/share-image'

type PosterModule = { renderSharePoster: (index: number) => Promise<Blob> }
const names = ['森林绿', '橘子汽水', '晴空蓝']

export function SharePosterSheet({ onClose }: { onClose: () => void }) {
  const [theme, setTheme] = useState(0)
  const [image, setImage] = useState('')
  const [message, setMessage] = useState('正在生成分享图…')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    setImage(''); setMessage('正在生成分享图…')
    const path = new URL('/download/share-poster.mjs', window.location.origin).href
    void import(/* @vite-ignore */ path).then((mod: PosterModule) => mod.renderSharePoster(theme)).then(blob => {
      const reader = new FileReader()
      reader.onload = () => { if (active && typeof reader.result === 'string') { setImage(reader.result); setMessage('安卓 App 保存到 Ohhu 相册；iPhone 打开系统分享面板；浏览器下载图片。') } }
      reader.onerror = () => { if (active) setMessage('生成图片失败，请重试。') }
      reader.readAsDataURL(blob)
    }).catch(() => { if (active) setMessage('生成图片失败，请检查网络或重新打开。') })
    return () => { active = false }
  }, [theme])
  async function save() {
    if (!image || busy) return
    setBusy(true); setMessage('正在保存到相册…')
    try { setMessage(await saveShareImage(image, 'ohu-share.png')) }
    catch (error) { setMessage(error instanceof Error ? error.message : '保存失败，请检查相册权限后重试。') }
    finally { setBusy(false) }
  }
  return <div role="dialog" aria-modal="true" aria-label="分享哦狐" style={{ position: 'fixed', inset: 0, zIndex: 10000, background: '#10281dcc', display: 'grid', placeItems: 'center', padding: 18 }}>
    <div style={{ width: 'min(100%, 420px)', maxHeight: '90dvh', overflow: 'auto', background: '#fffefa', borderRadius: 22, padding: 18, textAlign: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><strong>分享哦狐</strong><button type="button" onClick={onClose} aria-label="关闭">关闭</button></div>
      {image && <img src={image} alt="哦狐分享卡" style={{ width: 'min(75%, 240px)', maxHeight: '50dvh', objectFit: 'contain', margin: '12px auto' }} />}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>{names.map((name, i) => <button type="button" key={name} aria-pressed={theme === i} onClick={() => setTheme(i)}>{name}</button>)}</div>
      <button type="button" disabled={!image || busy} onClick={() => void save()} style={{ marginTop: 12, padding: '12px 28px', background: '#17654d', color: 'white', border: 0, borderRadius: 12 }}>{busy ? '正在处理…' : '保存 / 分享图片'}</button>
      <p role="status" style={{ fontSize: 14 }}>{message}</p>
    </div>
  </div>
}
