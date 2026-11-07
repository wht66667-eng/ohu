import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { isFoxDockOn, onFoxDockToggle, setFoxDockOn } from '../../lib/fox-dock-pref'
import { companionPoint, getCompanionPreferences, saveCompanionPreferences, subscribeCompanionPreferences, type CompanionPosition } from '../../lib/companion-preferences'
import styles from './FoxgirlCompanion.module.css'

/** 跨皮肤共用的陪伴入口；拖动只改变本机位置，编辑和专注流程由外壳隐藏。 */
export function FoxgirlCompanion() {
  const navigate = useNavigate(), { pathname } = useLocation()
  const [visible, setVisible] = useState(isFoxDockOn), [open, setOpen] = useState(false)
  const [preferences, setPreferences] = useState(getCompanionPreferences)
  const [size, setSize] = useState({ width: 0, height: 0 }), [position, setPosition] = useState<CompanionPosition | null>(preferences.position)
  const [message, setMessage] = useState(''), [failedImage, setFailedImage] = useState('')
  const host = useRef<HTMLElement>(null), suppressClick = useRef(false)
  const drag = useRef<{ id: number; clientX: number; clientY: number; x: number; y: number; maxX: number; maxY: number; next: CompanionPosition | null; moved: boolean } | null>(null)
  useEffect(() => onFoxDockToggle(setVisible), [])
  useEffect(() => subscribeCompanionPreferences(() => { const next = getCompanionPreferences(); setPreferences(next); if (!drag.current) setPosition(next.position) }), [])
  useEffect(() => {
    const parent = host.current?.parentElement; if (!parent) return
    const measure = () => setSize({ width: parent.clientWidth, height: parent.clientHeight })
    measure(); const observer = new ResizeObserver(measure); observer.observe(parent)
    return () => observer.disconnect()
  }, [pathname])
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => { if (event.target instanceof Node && !host.current?.contains(event.target)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', closeOutside); window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', closeOutside); window.removeEventListener('keydown', escape) }
  }, [open])
  function persist(next: CompanionPosition | null) {
    setPosition(next)
    try { saveCompanionPreferences({ ...getCompanionPreferences(), position: next }); setMessage('') }
    catch { setMessage('位置暂未保存，本次仍可移动') }
  }
  if (!['/', '/services', '/profile', '/plaza'].includes(pathname)) return null
  const custom = preferences.image && preferences.image !== failedImage
  /* 全部皮肤都显示陪伴宠物：默认狐娘形象，可在设置中换成自定义图片 */
  const point = companionPoint(position, size.width, size.height)
  /* 气泡面板相对狐狸定位；尾巴水平位置对齐狐狸中心，并限制在面板圆角内 */
  const panelLeft = Math.max(8, Math.min(size.width - 280, point.x - 140)) - point.x
  const panelTop = Math.max(8, Math.min(size.height - 300, point.y - 280)) - point.y
  const panelTailX = Math.max(18, Math.min(262, 38 - panelLeft))
  const panelStyle = { left: panelLeft, top: panelTop, right: 'auto', bottom: 'auto', maxHeight: Math.max(160, size.height - 16), '--tail-x': `${panelTailX}px` } as CSSProperties
  return <aside ref={host} className={styles.companion} data-companion="" style={size.width ? { left: point.x, top: point.y } : undefined} aria-label="陪伴宠物">
    {!visible ? <button className={styles.restore} type="button" onClick={() => setFoxDockOn(true)}>陪伴</button> : <>
      {open ? <div className={styles.panel} style={panelStyle}>
        <div className={styles.panelHead}>
          <img className={styles.panelAvatar} src={custom ? preferences.image : `${import.meta.env.BASE_URL}companions/foxgirl/pat-0.png`} width="36" height="36" alt="" draggable={false} onError={() => { if (custom) setFailedImage(preferences.image) }} />
          <div className={styles.panelText}>
            <b>需要帮忙吗？</b>
            <p>拖动宠物可移动位置，也可在外观设置中换成自己的图片。</p>
          </div>
        </div>
        <button type="button" className={styles.panelPrimary} onClick={() => navigate('/chat')}>打开 AI 问答<span className={styles.panelArrow} aria-hidden="true">→</span></button>
        <div className={styles.panelRow}>
          <button type="button" className={styles.panelGhost} onClick={() => navigate('/settings?section=appearance')}>自定义宠物</button>
          <button type="button" className={styles.panelGhost} onClick={() => { setOpen(false); setFoxDockOn(false) }}>收起陪伴</button>
        </div>
        {message ? <p className={styles.panelNote} role="status">{message}</p> : null}
      </div> : null}
      <button type="button" className={styles.character} aria-label="陪伴宠物：点击打开菜单，拖动或方向键移动" aria-expanded={open}
        onPointerDown={event => {
          if (event.button !== 0) return
          suppressClick.current = false
          drag.current = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: point.x, y: point.y, maxX: point.maxX, maxY: point.maxY, next: position, moved: false }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={event => {
          const start = drag.current; if (!start || start.id !== event.pointerId) return
          const dx = event.clientX - start.clientX, dy = event.clientY - start.clientY
          if (!start.moved && Math.hypot(dx, dy) < 5) return
          start.moved = true; suppressClick.current = true; setOpen(false)
          start.next = { x: start.maxX ? Math.max(0, Math.min(1, (start.x + dx - 8) / start.maxX)) : 0, y: start.maxY ? Math.max(0, Math.min(1, (start.y + dy - 8) / start.maxY)) : 0 }
          setPosition(start.next)
        }}
        onPointerUp={event => { const start = drag.current; drag.current = null; if (start?.moved) persist(start.next); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
        onPointerCancel={() => { drag.current = null; setPosition(getCompanionPreferences().position) }}
        onLostPointerCapture={() => { if (drag.current) { drag.current = null; setPosition(getCompanionPreferences().position) } }}
        onClick={() => { if (suppressClick.current) { suppressClick.current = false; return }; setOpen(value => !value) }}
        onKeyDown={event => { const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]; if (!delta) return; event.preventDefault(); persist({ x: Math.max(0, Math.min(1, (position?.x ?? 1) + delta[0] * 12 / Math.max(1, point.maxX))), y: Math.max(0, Math.min(1, (position?.y ?? 1) + delta[1] * 12 / Math.max(1, point.maxY))) }) }}>
        <img src={custom ? preferences.image : `${import.meta.env.BASE_URL}companions/foxgirl/${open ? 'pat-0' : 'idle-0'}.png`} width="240" height="240" alt="" draggable={false} decoding="async" onError={() => { if (custom) setFailedImage(preferences.image) }} />
      </button>
    </>}
  </aside>
}
