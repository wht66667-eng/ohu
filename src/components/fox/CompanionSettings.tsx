import { useEffect, useRef, useState } from 'react'
import { getCompanionPreferences, MAX_COMPANION_DATA_LENGTH, saveCompanionPreferences, subscribeCompanionPreferences } from '../../lib/companion-preferences'
import { loadMomentImage, photoCanvas } from '../../lib/moment-photo'
import { useUiVariant } from '../../lib/ui-variant'
import styles from './UiThemeSettings.module.css'

/** 所有皮肤共用本机宠物设置；只解码图片，不接受可执行的第三方皮肤。 */
export function CompanionSettings() {
  const ink = useUiVariant() === 'ink'
  const defaultImage = `${import.meta.env.BASE_URL}${ink ? 'brand/ink/ink-fox.svg' : 'companions/foxgirl/idle-0.png'}`
  const [preferences, setPreferences] = useState(getCompanionPreferences), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const input = useRef<HTMLInputElement>(null), live = useRef(true), lock = useRef(false)
  useEffect(() => { live.current = true; const stop = subscribeCompanionPreferences(() => setPreferences(getCompanionPreferences())); return () => { live.current = false; stop() } }, [])
  async function choose(file?: File) {
    if (!file || lock.current) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { setMessage('请选择5 MB以内的PNG、JPG或WebP图片'); return }
    lock.current = true; setBusy(true); setMessage('')
    const url = URL.createObjectURL(file)
    try {
      const image = await loadMomentImage(url)
      if (!live.current) return
      if (image.naturalWidth * image.naturalHeight > 30_000_000) throw new Error('图片像素过大，请先缩小')
      const scale = Math.min(1, 320 / Math.max(image.naturalWidth, image.naturalHeight)), canvas = photoCanvas(image.naturalWidth * scale, image.naturalHeight * scale)
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
      const encoded = canvas.toDataURL('image/png')
      if (encoded.length > MAX_COMPANION_DATA_LENGTH) throw new Error('图片内容过于复杂，请换一张更小的图片')
      saveCompanionPreferences({ ...getCompanionPreferences(), image: encoded }); setMessage('已更换宠物，所有皮肤都会使用；拖动角色即可移动')
    } catch (error) { if (live.current) setMessage(error instanceof Error ? error.message : '宠物保存失败，请重试') }
    finally { URL.revokeObjectURL(url); lock.current = false; if (live.current) setBusy(false) }
  }
  function reset(kind: 'image' | 'position') {
    try { saveCompanionPreferences({ ...getCompanionPreferences(), [kind]: kind === 'image' ? '' : null }); setMessage(kind === 'image' ? '已恢复当前皮肤的默认宠物' : '已重置宠物位置') } catch { setMessage('无法保存设置，请检查本机存储空间') }
  }
  return <section className={styles.petSettings} aria-label="自定义陪伴宠物">
    <div className={styles.petHeading}><img width="64" height="72" src={preferences.image || defaultImage} data-ink-fox={ink && !preferences.image ? '' : undefined} alt="当前陪伴宠物" /><div><h3>陪伴宠物</h3><p>在支持陪伴的页面上，拖动角色移动，点一下打开菜单。</p></div></div>
    <div className={styles.petActions}><button type="button" disabled={busy} onClick={() => input.current?.click()}>{busy ? '正在处理…' : '选择宠物图片'}</button><button type="button" disabled={busy || !preferences.image} onClick={() => reset('image')}>恢复默认宠物</button><button type="button" disabled={busy} onClick={() => reset('position')}>重置位置</button></div>
    <p>支持PNG、JPG、WebP静态图片，透明PNG效果更好；图片仅存本机，不上传。</p>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void choose(file) }} />
    {message ? <p role="status">{message}</p> : null}
  </section>
}
