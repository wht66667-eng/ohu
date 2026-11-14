/**
 * 哦狐声音系统：本地离线音效 + 轻量合成背景音乐。
 * 音频文件由 tools/gen-sound-assets.py 原创合成，打包在 public/sounds/，不请求第三方音频。
 * 统一入口 playSound：总开关 / 分类开关 / 音量 / 免打扰 / 专注沉浸 / 防叠加节流都在这里收口。
 */
import { getSoundPreferences, isSoundQuietNow, subscribeSoundPreferences, type SoundGroup, type SoundPreferences } from './sound-prefs'
import { isFocusImmersive } from '../services/focus'

export const SoundEvent = {
  ButtonClick: 'click',
  PageSwitch: 'page',
  Success: 'success',
  TaskComplete: 'task',
  FoxHappy: 'fox-happy',
  FoxSleep: 'fox-sleep',
  FoxWake: 'fox-wake',
  Notification: 'notify',
  Achievement: 'achieve',
} as const
export type SoundEvent = typeof SoundEvent[keyof typeof SoundEvent]

const EVENT_GROUP: Record<SoundEvent, SoundGroup> = {
  click: 'click', page: 'page', success: 'success', task: 'task',
  'fox-happy': 'fox', 'fox-sleep': 'fox', 'fox-wake': 'fox', notify: 'notify', achieve: 'achieve',
}
const EVENT_FILES: Record<SoundEvent, readonly string[]> = {
  click: ['click.wav'], page: ['page.wav'], success: ['success.wav'], task: ['task.wav'],
  'fox-happy': ['fox-happy-1.wav', 'fox-happy-2.wav', 'fox-happy-3.wav'],
  'fox-sleep': ['fox-sleep.wav'], 'fox-wake': ['fox-wake.wav'], notify: ['notify.wav'], achieve: ['achieve.wav'],
}
/** 各事件相对主音量的微调，保证默认 35% 时听感轻柔。 */
const EVENT_TRIM: Record<SoundEvent, number> = {
  click: .5, page: .38, success: .6, task: .6, 'fox-happy': .55, 'fox-sleep': .5, 'fox-wake': .55, notify: .5, achieve: .62,
}
/** 同类事件最小间隔，避免连点/连切时重复叠加。 */
const GROUP_GAP: Record<SoundGroup, number> = { click: 90, page: 450, success: 500, task: 500, fox: 700, notify: 900, achieve: 3000 }
const GLOBAL_GAP = 120

let prefs: SoundPreferences = getSoundPreferences()
let context: AudioContext | null = null
let master: GainNode | null = null
const buffers = new Map<string, AudioBuffer>()
const loading = new Map<string, Promise<AudioBuffer | null>>()
let lastPlayAt = 0
const lastGroupAt = new Map<SoundGroup, number>()
let lastFoxVariant = -1
let installed = false

function ensureAudio(): AudioContext | null {
  try {
    if (!context) {
      context = new AudioContext()
      master = context.createGain()
      master.gain.value = prefs.volume
      master.connect(context.destination)
    }
    if (context.state === 'suspended') void context.resume().catch(() => undefined)
    return context
  } catch { return null }
}
function loadBuffer(file: string): Promise<AudioBuffer | null> {
  const cached = buffers.get(file)
  if (cached) return Promise.resolve(cached)
  const pending = loading.get(file)
  if (pending) return pending
  const task = fetch(`${import.meta.env.BASE_URL}sounds/${file}`)
    .then((response) => { if (!response.ok) throw new Error('missing'); return response.arrayBuffer() })
    .then((data) => context?.decodeAudioData(data) ?? null)
    .then((buffer) => { if (buffer) buffers.set(file, buffer); return buffer })
    .catch(() => null)
    .finally(() => { loading.delete(file) })
  loading.set(file, task)
  return task
}
function preloadBuffers() {
  for (const files of Object.values(EVENT_FILES)) for (const file of files) void loadBuffer(file)
}
function pickFile(event: SoundEvent): string {
  const files = EVENT_FILES[event]
  if (files.length === 1) return files[0]
  /* 狐狸开心音随机轮换，且绝不连续重复同一 variant。 */
  let index = Math.floor(Math.random() * files.length)
  if (index === lastFoxVariant) index = (index + 1) % files.length
  lastFoxVariant = index
  return files[index]
}

/** 统一播放入口；preview 仅用于设置页试听，绕过开关/免打扰/节流，但仍跟随音量。 */
export function playSound(event: SoundEvent, opts?: { preview?: boolean }): void {
  const preview = !!opts?.preview
  const now = Date.now()
  if (!preview) {
    if (!prefs.master || !prefs.events[EVENT_GROUP[event]]) return
    if (isSoundQuietNow(prefs) || isFocusImmersive()) return
    if (document.visibilityState === 'hidden') return
    const group = EVENT_GROUP[event]
    if (now - lastPlayAt < GLOBAL_GAP || now - (lastGroupAt.get(group) ?? 0) < GROUP_GAP[group]) return
    lastPlayAt = now
    lastGroupAt.set(group, now)
  }
  const ctx = ensureAudio()
  if (!ctx || !master) return
  const file = pickFile(event)
  void loadBuffer(file).then((buffer) => {
    if (!buffer || !context || !master) return
    if (!preview && document.visibilityState === 'hidden') return
    try {
      const source = context.createBufferSource(), trim = context.createGain()
      source.buffer = buffer
      trim.gain.value = EVENT_TRIM[event]
      source.connect(trim); trim.connect(master)
      source.start()
      source.onended = () => { source.disconnect(); trim.disconnect() }
    } catch { /* 设备不支持时静默降级，不影响功能。 */ }
  })
}

/* ---------------- App 背景音乐：原创合成轻垫，默认关闭 ---------------- */
const BGM_CHORDS: readonly (readonly number[])[] = [
  [261.63, 329.63, 392.0, 493.88],
  [220.0, 261.63, 329.63, 392.0],
  [174.61, 220.0, 261.63, 329.63],
  [196.0, 246.94, 293.66, 392.0],
]
let bgmGain: GainNode | null = null
let bgmTimer = 0
let bgmChord = 0
function bgmWanted() {
  return prefs.bgm && prefs.master && !isSoundQuietNow(prefs) && !isFocusImmersive() && document.visibilityState !== 'hidden'
}
function scheduleBgmChord() {
  if (!context || !bgmGain) return
  if (!bgmWanted()) { stopBgm(); return }
  const notes = BGM_CHORDS[bgmChord % BGM_CHORDS.length]
  bgmChord++
  const at = context.currentTime + .05, duration = 8.5
  for (const freq of notes) {
    try {
      const osc = context.createOscillator(), envelope = context.createGain()
      osc.type = 'triangle'; osc.frequency.value = freq
      envelope.gain.setValueAtTime(0, at)
      envelope.gain.linearRampToValueAtTime(.16, at + 2.4)
      envelope.gain.setValueAtTime(.16, at + duration - 3)
      envelope.gain.linearRampToValueAtTime(0, at + duration)
      osc.connect(envelope); envelope.connect(bgmGain)
      osc.start(at); osc.stop(at + duration + .1)
      osc.onended = () => { osc.disconnect(); envelope.disconnect() }
    } catch { /* ignore */ }
  }
}
function startBgm() {
  if (bgmTimer) return
  const ctx = ensureAudio()
  if (!ctx || !master) return
  bgmGain = ctx.createGain()
  bgmGain.gain.value = .5
  bgmGain.connect(master)
  scheduleBgmChord()
  bgmTimer = window.setInterval(scheduleBgmChord, 7000)
}
function stopBgm() {
  if (bgmTimer) { window.clearInterval(bgmTimer); bgmTimer = 0 }
  const fading = bgmGain
  bgmGain = null
  if (fading && context) {
    try {
      fading.gain.setTargetAtTime(0, context.currentTime, .25)
      window.setTimeout(() => fading.disconnect(), 1500)
    } catch { fading.disconnect() }
  }
}
function applyPrefs() {
  if (master && context) {
    try { master.gain.setTargetAtTime(prefs.volume, context.currentTime, .03) } catch { master.gain.value = prefs.volume }
  }
  if (bgmWanted()) startBgm()
  else stopBgm()
}

/**
 * 挂载学生端全局声音：首次手势预加载、页面隐藏暂停、按钮点击音。
 * 返回卸载函数；工作端不安装。
 */
export function installSoundManager(): () => void {
  if (installed) return () => undefined
  installed = true
  prefs = getSoundPreferences()
  const unsubscribe = subscribeSoundPreferences(() => { prefs = getSoundPreferences(); applyPrefs() })
  const preload = () => { ensureAudio(); preloadBuffers() }
  window.addEventListener('pointerdown', preload, { once: true, capture: true })
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      stopBgm()
      void context?.suspend().catch(() => undefined)
    } else {
      if (context?.state === 'suspended') void context.resume().catch(() => undefined)
      applyPrefs()
    }
  }
  document.addEventListener('visibilitychange', onVisibility)
  const onPageHide = () => { stopBgm(); void context?.suspend().catch(() => undefined) }
  window.addEventListener('pagehide', onPageHide)
  // 仅为明确标记的互动提供按钮音，普通导航和表单保持安静。
  const onClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null
    const el = target?.closest('[data-click-sound="on"]')
    if (!el || el.closest('[data-click-sound="off"]')) return
    if (el instanceof HTMLButtonElement && el.disabled) return
    playSound(SoundEvent.ButtonClick)
  }
  document.addEventListener('click', onClick)
  applyPrefs()
  return () => {
    installed = false
    unsubscribe()
    window.removeEventListener('pointerdown', preload, { capture: true })
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', onPageHide)
    document.removeEventListener('click', onClick)
    stopBgm()
    void context?.suspend().catch(() => undefined)
  }
}