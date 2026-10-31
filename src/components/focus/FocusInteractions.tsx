import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useToast } from '../../context/ToastContext'
import { applyTheme } from '../../lib/theme'
import { fadeOnly, fadeUp, fieldShake, floatingStart, focusStep, slideSheet, themeWash, uiTransition } from '../../lib/animations'
import { useUiMotion } from '../../lib/motion-pref'
import { FOCUS_NOISES, FOCUS_REMINDERS, FOCUS_THEMES, loadFocusOptions, loadFocusVolume, saveFocusOptions, type FocusOptions } from '../../lib/focus-settings'
import { setFocusAudioVolume } from '../../lib/focus-audio'
import { FOCUS_MUSIC_ACCEPT, formatMusicDuration, formatMusicSize, importFocusMusic, listFocusMusic, type FocusMusic } from '../../lib/focus-music'
import { FocusIcon, type FocusIconName } from './FocusIcon'
import ui from './focus-interactions.module.css'
import { SuccessMark } from '../ui/feedback'

export type FocusTab = 'timer' | 'tasks' | 'stats' | 'settings'
const TABS: { id: FocusTab; label: string; icon: FocusIconName }[] = [
  { id: 'timer', label: '专注计时', icon: 'timer' },
  { id: 'tasks', label: '任务列表', icon: 'tasks' },
  { id: 'stats', label: '数据统计', icon: 'stats' },
  { id: 'settings', label: '设置', icon: 'settings' },
]
const overlayRoot = () => document.querySelector('[data-app-body]') || document.body

export function FocusThemeToggle() {
  const reduce = useUiMotion()
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const reveal = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.dataset.theme === 'dark'))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => { observer.disconnect(); reveal.current?.remove() }
  }, [])
  async function toggle(button: HTMLButtonElement) {
    if (busyRef.current) return
    const next = dark ? 'light' : 'dark'
    if (reduce || !Element.prototype.animate) { applyTheme(next); return }
    const rect = button.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
    const circle = document.createElement('div')
    circle.className = ui.themeReveal
    circle.setAttribute('aria-hidden', 'true')
    Object.assign(circle.style, { width: `${radius * 2}px`, height: `${radius * 2}px`, left: `${x - radius}px`, top: `${y - radius}px`, background: `var(--theme-${next}-canvas)` })
    document.body.appendChild(circle)
    reveal.current = circle
    busyRef.current = true
    setBusy(true)
    const duration = uiTransition(false).duration * 1000
    try {
      await circle.animate(themeWash.grow, { duration: duration * 0.6, easing: 'ease-out', fill: 'forwards' }).finished
      applyTheme(next)
      await circle.animate(themeWash.fade, { duration: duration * 0.4, fill: 'forwards' }).finished
    } catch { applyTheme(next) } finally { circle.remove(); reveal.current = null; busyRef.current = false; setBusy(false) }
  }
  return <button type="button" className={ui.iconButton} disabled={busy} aria-label={dark ? '切换浅色模式' : '切换深色模式'} aria-pressed={dark} onClick={(event) => void toggle(event.currentTarget)}><FocusIcon name={dark ? 'sun' : 'moon'} /></button>
}

export function FocusNavigation({ active, onChange }: { active: FocusTab; onChange: (tab: FocusTab) => void }) {
  const reduce = useUiMotion()
  return createPortal(<nav className={ui.navigation} aria-label="专注功能">
    {TABS.map((tab) => <button type="button" key={tab.id} className={active === tab.id ? ui.navActive : ui.navButton} aria-label={tab.label} aria-current={active === tab.id ? 'page' : undefined} onClick={() => onChange(tab.id)}>
      <span className={ui.navIcon}><FocusIcon name={tab.icon} /></span>
      <AnimatePresence initial={false}>{active === tab.id ? <motion.span className={ui.navLabel} {...fadeUp(reduce)}>{tab.label}</motion.span> : null}</AnimatePresence>
    </button>)}
  </nav>, overlayRoot())
}

export function FocusFloatingStart({ onClick }: { onClick: () => void }) {
  const reduce = useUiMotion()
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    const container = document.querySelector<HTMLElement>('[data-app-page]')
    if (!container) return
    let previous = container.scrollTop
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        const next = container.scrollTop
        if (next < 16 || next < previous - 5) setCollapsed(false)
        else if (next > previous + 5) setCollapsed(true)
        previous = next
        frame = 0
      })
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => { container.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame) }
  }, [])
  return createPortal(<motion.button type="button" className={ui.floatingStart} {...floatingStart(reduce, collapsed)} aria-label="开始专注" onClick={onClick} onFocus={() => setCollapsed(false)}>
    <FocusIcon name="plus" />
    <AnimatePresence initial={false}>{!collapsed ? <motion.span {...fadeOnly(reduce)}>开始专注</motion.span> : null}</AnimatePresence>
  </motion.button>, overlayRoot())
}

export function FocusCopyButton({ text, label = '复制', className = '' }: { text: string; label?: string; className?: string }) {
  const toast = useToast()
  const reduce = useUiMotion()
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const timeout = useRef(0)
  useEffect(() => () => window.clearTimeout(timeout.current), [])
  async function copy() {
    if (copied || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
      else {
        const previous = document.activeElement as HTMLElement | null
        const input = document.createElement('textarea')
        input.value = text
        input.style.cssText = 'position:fixed;opacity:0;pointer-events:none;top:0;left:0'
        ;(document.querySelector('dialog[data-focus-dialog][open]') || overlayRoot()).appendChild(input)
        try { input.select(); if (!document.execCommand('copy')) throw new Error('Clipboard unavailable') }
        finally { input.remove(); previous?.focus() }
      }
      setCopied(true)
      timeout.current = window.setTimeout(() => setCopied(false), 1400)
    } catch { toast.err('复制失败，请允许剪贴板访问后重试') } finally { busyRef.current = false; setBusy(false) }
  }
  return <span className={`${ui.copyWrap} ${className}`}><button type="button" className={ui.copyButton} disabled={busy} aria-label={copied ? '已复制' : label} onClick={() => void copy()}><AnimatePresence initial={false} mode="wait"><motion.span key={copied ? 'done' : 'copy'} className={ui.copyIcon} {...fadeOnly(reduce)}>{copied ? <SuccessMark /> : <FocusIcon name="copy" size={17} />}</motion.span></AnimatePresence><span>{copied ? '已复制' : label}</span></button><span className={ui.srOnly} role="status">{copied ? '已复制到剪贴板' : ''}</span></span>
}

/** The native dialog supplies focus trapping, outside inertness and restoration. */
export function FocusDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const reduce = useUiMotion()
  const dialog = useRef<HTMLDialogElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const titleId = useId()
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    const host = document.querySelector<HTMLElement>('[data-app-body]')
    const resize = () => {
      const bounds = host?.getBoundingClientRect()
      if (!bounds) return
      Object.assign(element.style, { width: `${Math.min(480, bounds.width)}px`, maxHeight: `${Math.max(120, bounds.height - 16)}px`, bottom: `${Math.max(0, innerHeight - bounds.bottom)}px` })
    }
    resize()
    element.showModal()
    const observer = host ? new ResizeObserver(resize) : null
    if (host) observer?.observe(host)
    window.addEventListener('resize', resize)
    const onBack = (event: Event) => {
      const top = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1)
      if (event.defaultPrevented || top !== element) return
      event.preventDefault()
      closeRef.current()
    }
    window.addEventListener('app-overlay-back', onBack)
    return () => { observer?.disconnect(); window.removeEventListener('resize', resize); window.removeEventListener('app-overlay-back', onBack); element.close() }
  }, [])
  return createPortal(<motion.dialog ref={dialog} data-focus-dialog="" aria-labelledby={titleId} className={ui.dialog} {...slideSheet(reduce)} onCancel={(event) => { event.preventDefault(); closeRef.current() }} onClick={(event) => {
    if (event.target !== event.currentTarget) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeRef.current()
  }}><div className={ui.dialogGrip} aria-hidden="true" /><div className={ui.dialogHead}><h2 id={titleId}>{title}</h2><button type="button" className={ui.iconButton} aria-label="关闭弹窗" onClick={onClose}><FocusIcon name="close" /></button></div>{children}</motion.dialog>, document.body)
}

type Choice = { label: string; value: string }
/** Platform select preserves keyboard, screen reader and Android picker semantics. */
export function FocusSelect({ label, value, options, onChange, onAdd, addAudio = false }: { label: string; value: string; options: Choice[]; onChange: (value: string) => void; onAdd?: (choice: Choice) => void; addAudio?: boolean }) {
  const id = useId()
  const [customName, setCustomName] = useState('')
  const [customUrl, setCustomUrl] = useState('')
  const [error, setError] = useState('')
  function add() {
    if (!customName.trim()) { setError('请填写选项名称'); return }
    let next = customName.trim().slice(0, 24)
    if (addAudio) { try { const url = new URL(customUrl.trim()); if (url.protocol !== 'https:') throw new Error(); next = url.href } catch { setError('请填写有效的 HTTPS 音频链接'); return } }
    if (!options.some((option) => option.value === next)) onAdd?.({ label: customName.trim().slice(0, 24), value: next })
    onChange(next); setCustomName(''); setCustomUrl(''); setError('')
  }
  return <div className={ui.field}><label htmlFor={id} className={ui.fieldLabel}>{label}</label><div className={ui.selectWrap}><select id={id} className={ui.selectTrigger} value={value} onChange={(event) => onChange(event.target.value)}>{!options.some((option) => option.value === value) ? <option value={value}>{value}</option> : null}{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><FocusIcon name="down" size={16} /></div>
    {onAdd ? <details className={ui.addChoice}><summary>{addAudio ? '添加自己的声音' : '添加分类'}</summary><label htmlFor={`${id}-custom`} className={ui.srOnly}>{addAudio ? '声音名称' : '分类名称'}</label><input id={`${id}-custom`} value={customName} placeholder={addAudio ? '声音名称' : '分类名称'} maxLength={24} onChange={(event) => { setCustomName(event.target.value); setError('') }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add() } }} />{addAudio ? <><label htmlFor={`${id}-url`} className={ui.srOnly}>HTTPS 音频链接</label><input id={`${id}-url`} value={customUrl} placeholder="HTTPS 音频链接" type="url" onChange={(event) => { setCustomUrl(event.target.value); setError('') }} /></> : null}<FieldError message={error} /><button type="button" className={ui.secondaryButton} onClick={add}><FocusIcon name="plus" size={16} />添加并选中</button></details> : null}
  </div>
}

function FieldError({ message }: { message?: string }) {
  const reduce = useUiMotion()
  return <AnimatePresence initial={false}>{message ? <motion.p role="alert" className={ui.errorText} {...fadeUp(reduce)}>{message}</motion.p> : null}</AnimatePresence>
}

export function FocusMusicControls({ options, onChange, onImportState }: { options: FocusOptions; onChange: (options: FocusOptions) => void; onImportState?: (busy: boolean) => void }) {
  const latestOptions = useRef(options)
  latestOptions.current = options
  function updateOptions(next: FocusOptions) { latestOptions.current = next; onChange(next) }
  const [tracks, setTracks] = useState<FocusMusic[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [volume, setVolume] = useState(loadFocusVolume)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const importBusy = useRef(false)
  const alive = useRef(true)
  const requestId = useRef(0)
  const importStateRef = useRef(onImportState)
  importStateRef.current = onImportState
  const id = useId()
  useEffect(() => {
    alive.current = true
    const refresh = async () => {
      const request = ++requestId.current
      try { const list = await listFocusMusic(); if (alive.current && request === requestId.current) { setTracks(list); setLoading(false) } }
      catch (error) { if (alive.current && request === requestId.current) { setError(error instanceof Error ? error.message : '音乐库读取失败'); setLoading(false) } }
    }
    const changeVolume = (event: Event) => setVolume((event as CustomEvent<number>).detail)
    void refresh()
    window.addEventListener('focus-music-change', refresh)
    window.addEventListener('focus-volume-change', changeVolume)
    return () => { alive.current = false; window.removeEventListener('focus-music-change', refresh); window.removeEventListener('focus-volume-change', changeVolume); importStateRef.current?.(false) }
  }, [])
  async function importFile(file: File) {
    if (importBusy.current) return
    importBusy.current = true; setImporting(true); importStateRef.current?.(true); setError(''); setStatus('')
    try {
      const track = await importFocusMusic(file)
      if (!alive.current) return
      setTracks((previous) => [track, ...previous.filter((item) => item.id !== track.id)])
      updateOptions({ ...latestOptions.current, noise: `local:${track.id}` })
      setStatus(`已导入「${track.name}」，已选为专注音乐`)
    } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : '导入失败，请重试') }
    finally { importBusy.current = false; importStateRef.current?.(false); if (alive.current) { setImporting(false); if (fileInput.current) fileInput.current.value = '' } }
  }
  const selected = tracks.find((track) => options.noise === `local:${track.id}`)
  return <section className={ui.musicControls} aria-label="音乐与音量">
    <FocusSelect label="专注音乐" value={options.noise} options={[...FOCUS_NOISES, ...tracks.map((track) => ({ label: track.name, value: `local:${track.id}` })), ...options.customNoises]} onChange={(noise) => updateOptions({ ...latestOptions.current, noise })} addAudio onAdd={(choice) => updateOptions({ ...latestOptions.current, customNoises: [...latestOptions.current.customNoises, choice] })} />
    <input ref={fileInput} type="file" className={ui.srOnly} tabIndex={-1} aria-label="选择本地音乐文件" accept={FOCUS_MUSIC_ACCEPT} disabled={importing} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file) }} />
    <button type="button" className={`${ui.secondaryButton} ${ui.importButton}`} disabled={importing} onClick={() => fileInput.current?.click()}><FocusIcon name="plus" size={17} />{importing ? '正在导入音乐…' : '导入本地音乐'}</button>
    <p className={ui.helper}>MP3、M4A、WAV、OGG、FLAC，单个文件最多 50 MB。音乐保存在当前设备，可离线播放。</p>
    {loading ? <p className={ui.helper} role="status">正在读取导入的音乐…</p> : selected ? <div className={ui.musicMetadata}><FocusIcon name="sound" size={18} /><span>{selected.name}<small>{formatMusicDuration(selected.duration)} · {formatMusicSize(selected.size)} · 本地音乐</small></span></div> : options.noise.startsWith('local:') ? <p className={ui.errorText}>找不到这首音乐，请重新导入或选择其他音源。</p> : null}
    <FieldError message={error} />
    <p className={ui.importStatus} role="status">{status}</p>
    <div className={ui.volumeField}><div><label htmlFor={`${id}-volume`}>播放音量</label><output htmlFor={`${id}-volume`}>{Math.round(volume * 100)}%</output></div><input id={`${id}-volume`} type="range" min="0" max="50" step="1" value={Math.round(volume * 100)} aria-valuetext={`${Math.round(volume * 100)}%`} onChange={(event) => setVolume(setFocusAudioVolume(Number(event.target.value) / 100))} /><p className={ui.helper}>默认 15%，上限 50%。音量会立即应用；0% 为静音。</p></div>
  </section>
}

const STEPS = ['专注时长', '休息时长', '专注目标', '声音与提醒']
export function FocusSetupSheet({ initial, mode = 'start', onClose, onConfirm }: { initial: FocusOptions; mode?: 'start' | 'save'; onClose: () => void; onConfirm: (options: FocusOptions) => Promise<boolean> }) {
  const reduce = useUiMotion()
  const [options, setOptions] = useState(initial)
  const [duration, setDuration] = useState(String(initial.minutes))
  const [rest, setRest] = useState(String(initial.breakMinutes))
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1)
  const [error, setError] = useState('')
  const [shake, setShake] = useState(0)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [musicImporting, setMusicImporting] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  const focusFrame = useRef(0)
  const setStepBody = useCallback((element: HTMLDivElement | null) => {
    cancelAnimationFrame(focusFrame.current)
    body.current = element
    // AnimatePresence waits for the old step's exit before mounting this node.
    if (element) focusFrame.current = requestAnimationFrame(() => element.querySelector<HTMLElement>('input:not([type="file"]),select,button')?.focus())
  }, [])
  useEffect(() => () => cancelAnimationFrame(focusFrame.current), [])
  const fieldId = useId()
  useEffect(() => { if (!shake) return; const frame = requestAnimationFrame(() => body.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return () => cancelAnimationFrame(frame) }, [shake])
  function fail(message: string) { setError(message); setShake((n) => n + 1); body.current?.querySelector<HTMLInputElement>('input')?.focus() }
  async function next() {
    if (busyRef.current || musicImporting) return
    const minutes = Number(duration)
    const breakMinutes = Number(rest)
    if (step === 0 && (!duration || !Number.isInteger(minutes) || minutes < 5 || minutes > 120)) { fail('专注时长需在 5–120 分钟之间，请输入整数'); return }
    if (step === 1 && (!rest || !Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 30)) { fail('休息时长需在 0–30 分钟之间，请输入整数'); return }
    if (step === 2 && !options.title.trim()) { fail('请填写本次专注目标'); return }
    setError('')
    if (step < 3) { setDirection(1); setStep(step + 1); return }
    const nextOptions = { ...options, minutes, breakMinutes, title: options.title.trim() }
    busyRef.current = true
    setBusy(true)
    try { if (await onConfirm(nextOptions)) { saveFocusOptions(nextOptions); onClose() } } catch { fail('准备失败，请重试') } finally { busyRef.current = false; setBusy(false) }
  }
  return <FocusDialog title={mode === 'save' ? '设置下一轮专注' : '开始一轮专注'} onClose={() => { if (!busyRef.current) onClose() }}>
    <ol className={ui.steps} aria-label="设置进度">{STEPS.map((label, index) => <li key={label} className={index === step ? ui.stepActive : index < step ? ui.stepDone : ''} aria-current={index === step ? 'step' : undefined}><span>{index < step ? <FocusIcon name="check" size={14} /> : index + 1}</span><em>{label}</em></li>)}</ol>
    <form onSubmit={(event) => { event.preventDefault(); void next() }} noValidate><div className={ui.stepViewport}><AnimatePresence initial={false} mode="wait" custom={direction}><motion.div key={step} ref={setStepBody} className={ui.stepContent} custom={direction} variants={focusStep(reduce)} initial="enter" animate="center" exit="exit">
      <h3>{['安排这次专注的时间', '给自己留一点休息时间', '明确这次要完成的事', '选择声音和完成提醒'][step]}</h3>
      {step === 0 || step === 1 ? <><motion.div key={shake} className={`${ui.field} ${error ? ui.fieldInvalid : ''}`} {...fieldShake(!!error, reduce)}><label htmlFor={fieldId} className={ui.fieldLabel}>{step === 0 ? '专注时长' : '休息时长'}</label><div className={ui.numberField}><input id={fieldId} type="number" inputMode="numeric" min={step === 0 ? 5 : 0} max={step === 0 ? 120 : 30} step={1} value={step === 0 ? duration : rest} aria-invalid={!!error} aria-describedby={error ? `${fieldId}-error` : `${fieldId}-hint`} onChange={(event) => { const value = event.target.value; if (step === 0) setDuration(value); else setRest(value); const number = Number(value); if (value && Number.isInteger(number) && number >= (step === 0 ? 5 : 0) && number <= (step === 0 ? 120 : 30)) setError('') }} /><span>分钟</span></div><div id={`${fieldId}-error`}><FieldError message={error} /></div></motion.div><div className={ui.durationChoices}>{(step === 0 ? [15, 25, 45, 60] : [0, 5, 10, 15]).map((minutes) => <button type="button" key={minutes} className={Number(step === 0 ? duration : rest) === minutes ? ui.durationSelected : ''} aria-pressed={Number(step === 0 ? duration : rest) === minutes} onClick={() => { if (step === 0) setDuration(String(minutes)); else setRest(String(minutes)); setError('') }}>{minutes === 0 ? '不休息' : `${minutes} 分钟`}</button>)}</div><p id={`${fieldId}-hint`} className={ui.helper}>{step === 0 ? '可设 5–120 分钟，选择适合当前任务的时长。' : '完成后自动进入休息，休息时间不计入统计。'}</p></> : step === 2 ? <>
        <FocusSelect label="专注分类" value={options.theme} options={[...new Set([...FOCUS_THEMES, ...options.customThemes])].map((value) => ({ label: value, value }))} onChange={(theme) => setOptions((old) => ({ ...old, theme, title: !old.title || old.title === old.theme ? theme : old.title }))} onAdd={(choice) => setOptions((old) => ({ ...old, customThemes: [...old.customThemes, choice.value] }))} />
        <motion.div key={shake} className={`${ui.field} ${error ? ui.fieldInvalid : ''}`} {...fieldShake(!!error, reduce)}><label htmlFor={fieldId} className={ui.fieldLabel}>专注目标</label><input id={fieldId} value={options.title} maxLength={120} placeholder="例如：复习高数第二章" aria-invalid={!!error} aria-describedby={error ? `${fieldId}-error` : undefined} onChange={(event) => { setOptions({ ...options, title: event.target.value }); if (event.target.value.trim()) setError('') }} /><div id={`${fieldId}-error`}><FieldError message={error} /></div></motion.div>
      </> : <><FocusMusicControls options={options} onChange={setOptions} onImportState={setMusicImporting} /><FocusSelect label="完成提醒" value={options.reminder} options={FOCUS_REMINDERS} onChange={(reminder) => setOptions({ ...options, reminder: reminder as FocusOptions['reminder'] })} /><p className={ui.helper}>声音随暂停停止。系统提醒取决于通知权限；远程音频链接需要网络，本地音乐可离线播放。</p><div className={ui.sessionPreview}><FocusIcon name="timer" /><span>{options.title}<small>专注 {duration} 分钟，休息 {rest} 分钟</small></span></div><FieldError message={error} /></>}
    </motion.div></AnimatePresence></div><div className={ui.dialogFooter}><button type="button" className={ui.secondaryButton} disabled={busy || musicImporting} onClick={() => { if (step === 0) onClose(); else { setDirection(-1); setStep(step - 1); setError('') } }}>{step === 0 ? '取消' : '上一步'}</button><button type="submit" className={ui.primaryButton} disabled={busy || musicImporting}>{musicImporting ? '正在导入…' : busy ? '正在准备…' : step < 3 ? '下一步' : mode === 'save' ? '保存设置' : '开始专注'}</button></div></form>
  </FocusDialog>
}

export type FocusTask = { id: string; title: string; minutes: number; theme: string }
function loadTasks(key: string): FocusTask[] {
  try { const tasks: unknown = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(tasks) ? tasks.filter((task): task is FocusTask => typeof task?.id === 'string' && typeof task?.title === 'string' && typeof task?.theme === 'string' && Number.isInteger(task.minutes) && task.minutes >= 5 && task.minutes <= 120) : [] } catch { return [] }
}

export function FocusTaskList({ onPick, disabled, storageScope }: { onPick: (task: FocusTask) => void; disabled: boolean; storageScope: string }) {
  const toast = useToast()
  const taskKey = `focus.tasks.v2:${storageScope}`
  const [tasks, setTasks] = useState(() => loadTasks(taskKey))
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [minutes, setMinutes] = useState('25')
  const [theme, setTheme] = useState('学习')
  const [errors, setErrors] = useState<{ title?: string; minutes?: string }>({})
  const [shake, setShake] = useState(0)
  const reduce = useUiMotion()
  const titleInput = useRef<HTMLInputElement>(null)
  const minutesInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!shake) return
    const frame = requestAnimationFrame(() => (errors.title ? titleInput : minutesInput).current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [shake])
  const id = useId()
  function create() {
    const nextErrors = { title: title.trim() ? undefined : '请填写专注目标', minutes: minutes && Number.isInteger(Number(minutes)) && Number(minutes) >= 5 && Number(minutes) <= 120 ? undefined : '专注时长需在 5–120 分钟之间' }
    setErrors(nextErrors)
    if (nextErrors.title || nextErrors.minutes) { setShake((n) => n + 1); (nextErrors.title ? titleInput : minutesInput).current?.focus(); return }
    const next = [...tasks, { id: crypto.randomUUID(), title: title.trim(), minutes: Number(minutes), theme }]
    setTasks(next)
    try { localStorage.setItem(taskKey, JSON.stringify(next)) } catch { toast.warn('当前存储不可用，任务只在本次打开期间保留') }
    setCreating(false); setTitle(''); setMinutes('25'); setErrors({})
  }
  function remove(taskId: string) {
    const next = tasks.filter((task) => task.id !== taskId)
    setTasks(next)
    try { localStorage.setItem(taskKey, JSON.stringify(next)) } catch { toast.warn('当前存储不可用，重新打开后任务可能恢复') }
  }
  return <><div className={ui.sectionHead}><h2>专注任务</h2><button type="button" className={ui.secondaryButton} onClick={() => setCreating(true)}><FocusIcon name="plus" size={16} />新建任务</button></div><p className={ui.helper}>任务保存在当前设备，可重复选择，不会自动完成云端待办。</p>
    {tasks.length ? <div className={ui.taskList}>{tasks.map((task) => <article className={ui.taskCard} key={task.id}><div><span className={ui.taskCategory}>{task.theme}</span><h3>{task.title}</h3><p>{task.minutes} 分钟</p></div><div className={ui.taskActions}><FocusCopyButton text={`${task.title} · 专注 ${task.minutes} 分钟`} label="复制" /><button type="button" className={ui.primaryButton} disabled={disabled} onClick={() => onPick(task)}>开始这项</button><button type="button" className={ui.iconButton} aria-label={`删除任务：${task.title}`} onClick={() => remove(task.id)}><FocusIcon name="close" size={16} /></button></div></article>)}</div> : <div className={ui.emptyTasks}><FocusIcon name="tasks" size={30} /><p>先写下这次要完成的事</p><span>新建任务，或选择下方的今日待办。</span></div>}
    <AnimatePresence>{creating ? <FocusDialog title="新建专注任务" onClose={() => setCreating(false)}><form onSubmit={(event) => { event.preventDefault(); create() }} noValidate><motion.div key={`title-${shake}`} className={`${ui.field} ${errors.title ? ui.fieldInvalid : ''}`} {...fieldShake(!!errors.title, reduce)}><label htmlFor={`${id}-title`} className={ui.fieldLabel}>专注目标</label><input id={`${id}-title`} ref={titleInput} value={title} maxLength={120} placeholder="例如：读完第一章" aria-invalid={!!errors.title} aria-describedby={errors.title ? `${id}-title-error` : undefined} onChange={(event) => { setTitle(event.target.value); if (event.target.value.trim()) setErrors((old) => ({ ...old, title: undefined })) }} /><div id={`${id}-title-error`}><FieldError message={errors.title} /></div></motion.div><motion.div key={`minutes-${shake}`} className={`${ui.field} ${errors.minutes ? ui.fieldInvalid : ''}`} {...fieldShake(!!errors.minutes, reduce)}><label htmlFor={`${id}-minutes`} className={ui.fieldLabel}>专注时长（分钟）</label><input id={`${id}-minutes`} ref={minutesInput} type="number" inputMode="numeric" min={5} max={120} value={minutes} aria-invalid={!!errors.minutes} aria-describedby={errors.minutes ? `${id}-minutes-error` : undefined} onChange={(event) => { setMinutes(event.target.value); const number = Number(event.target.value); if (event.target.value && Number.isInteger(number) && number >= 5 && number <= 120) setErrors((old) => ({ ...old, minutes: undefined })) }} /><div id={`${id}-minutes-error`}><FieldError message={errors.minutes} /></div></motion.div><FocusSelect label="任务分类" value={theme} options={[...new Set([...FOCUS_THEMES, ...loadFocusOptions().customThemes])].map((value) => ({ label: value, value }))} onChange={setTheme} /><div className={ui.dialogFooter}><button type="button" className={ui.secondaryButton} onClick={() => setCreating(false)}>取消</button><button type="submit" className={ui.primaryButton}>创建任务</button></div></form></FocusDialog> : null}</AnimatePresence>
  </>
}




