/* 哦狐官网品牌音乐《遇见哦狐 · A Little World of OHU》
 * 克制原则：默认不自动播放；记住上次选择；切页续播不重新开始；页面隐藏时暂停。
 * 多页面站点没有共享 Audio：状态与进度存 localStorage，新页面在用户首次手势后恢复播放。
 */
const KEY = 'ohu.site.music.v1'
const TRACK = 'assets/a-little-world-of-ohu.mp3'
const DEFAULTS = { playing: false, volume: 0.35, muted: false, loop: true, time: 0 }

function readState() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!raw || typeof raw !== 'object') return { ...DEFAULTS }
    return {
      playing: raw.playing === true,
      volume: typeof raw.volume === 'number' && Number.isFinite(raw.volume) ? Math.min(1, Math.max(0, raw.volume)) : DEFAULTS.volume,
      muted: raw.muted === true,
      loop: typeof raw.loop === 'boolean' ? raw.loop : DEFAULTS.loop,
      time: typeof raw.time === 'number' && Number.isFinite(raw.time) && raw.time >= 0 ? raw.time : 0,
    }
  } catch { return { ...DEFAULTS } }
}

const state = readState()
let lastPersist = 0
function persist(force = false) {
  const now = Date.now()
  if (!force && now - lastPersist < 2000) return
  lastPersist = now
  try { localStorage.setItem(KEY, JSON.stringify({ ...state, time: Number.isFinite(audio.currentTime) ? audio.currentTime : state.time })) } catch { /* 隐私模式下放不了也记不住，静默降级 */ }
}

const NOTE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'
const PLAY = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5Z"/></svg>'
const PAUSE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
const SPEAKER = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9Z"/><path d="M16 9.5a4 4 0 0 1 0 5"/></svg>'
const MUTED = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9Z"/><path d="m16 9 5 6m0-6-5 6"/></svg>'
const LOOP = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2.5 21 6l-4 3.5"/><path d="M21 6H8a5 5 0 0 0-5 5v1"/><path d="M7 21.5 3 18l4-3.5"/><path d="M3 18h13a5 5 0 0 0 5-5v-1"/></svg>'

const root = document.createElement('div')
root.className = 'ohu-music'
root.dataset.playing = 'false'
root.innerHTML = `
  <div class="ohu-music-panel" hidden role="group" aria-label="品牌音乐播放器">
    <div class="ohu-music-head">
      <div><p class="ohu-music-title">遇见哦狐</p><p class="ohu-music-sub">A Little World of OHU · 原创品牌音乐</p></div>
      <button type="button" class="ohu-music-close" aria-label="收起播放器">×</button>
    </div>
    <div class="ohu-music-controls">
      <button type="button" class="ohu-music-play" aria-label="播放"></button>
      <span class="ohu-music-volume"><input type="range" min="0" max="100" step="5" aria-label="音量"></span>
      <button type="button" class="ohu-music-icon ohu-music-mute" aria-label="静音" aria-pressed="false"></button>
      <button type="button" class="ohu-music-icon ohu-music-loop" aria-label="循环播放" aria-pressed="true"></button>
    </div>
    <p class="ohu-music-hint">默认不自动播放；你的播放选择会记在这台设备上。</p>
  </div>
  <button type="button" class="ohu-music-toggle" aria-label="品牌音乐" aria-expanded="false">${NOTE}</button>`
document.body.appendChild(root)

const panel = root.querySelector('.ohu-music-panel')
const toggle = root.querySelector('.ohu-music-toggle')
const closeBtn = root.querySelector('.ohu-music-close')
const playBtn = root.querySelector('.ohu-music-play')
const volumeInput = root.querySelector('.ohu-music-volume input')
const muteBtn = root.querySelector('.ohu-music-mute')
const loopBtn = root.querySelector('.ohu-music-loop')

const audio = new Audio()
audio.preload = 'metadata'
audio.src = TRACK
audio.volume = state.volume
audio.muted = state.muted
audio.loop = state.loop

function syncUi() {
  const playing = !audio.paused && !audio.ended
  root.dataset.playing = String(playing)
  playBtn.innerHTML = playing ? PAUSE : PLAY
  playBtn.setAttribute('aria-label', playing ? '暂停' : '播放')
  muteBtn.innerHTML = audio.muted ? MUTED : SPEAKER
  muteBtn.setAttribute('aria-pressed', String(audio.muted))
  muteBtn.setAttribute('aria-label', audio.muted ? '取消静音' : '静音')
  loopBtn.innerHTML = LOOP
  loopBtn.setAttribute('aria-pressed', String(audio.loop))
  if (document.activeElement !== volumeInput) volumeInput.value = String(Math.round(audio.volume * 100))
}
function setOpen(open) {
  panel.hidden = !open
  toggle.setAttribute('aria-expanded', String(open))
}
toggle.addEventListener('click', () => setOpen(panel.hidden))
closeBtn.addEventListener('click', () => { setOpen(false); toggle.focus() })
document.addEventListener('pointerdown', (event) => { if (!panel.hidden && !root.contains(event.target)) setOpen(false) })
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !panel.hidden) { setOpen(false); toggle.focus() } })

/* 新页面恢复上次进度；上次在播放时，等首次用户手势再续播（浏览器自动播放策略）。 */
let resumeArmed = false
function armResume() {
  if (resumeArmed) return
  resumeArmed = true
  const resume = () => {
    resumeArmed = false
    window.removeEventListener('pointerdown', resume, true)
    window.removeEventListener('keydown', resume, true)
    audio.play().then(syncUi).catch(() => { state.playing = false; persist(true); syncUi() })
  }
  window.addEventListener('pointerdown', resume, { once: true, capture: true })
  window.addEventListener('keydown', resume, { once: true, capture: true })
}
audio.addEventListener('loadedmetadata', () => {
  if (state.time > 0 && Number.isFinite(audio.duration) && state.time < audio.duration - 1) audio.currentTime = state.time
  if (state.playing) armResume()
})
playBtn.addEventListener('click', () => {
  if (audio.paused) { audio.play().then(() => { state.playing = true; persist(true); syncUi() }).catch(() => syncUi()) }
  else { audio.pause(); state.playing = false; persist(true); syncUi() }
})
audio.addEventListener('play', () => { state.playing = true; persist(true); syncUi() })
audio.addEventListener('pause', () => { state.playing = false; syncUi() })
audio.addEventListener('ended', () => { state.playing = false; persist(true); syncUi() })
audio.addEventListener('timeupdate', () => { if (!audio.paused) persist() })
volumeInput.addEventListener('input', () => {
  audio.volume = Number(volumeInput.value) / 100
  if (audio.volume > 0 && audio.muted) audio.muted = false
  state.volume = audio.volume
  state.muted = audio.muted
  persist(); syncUi()
})
muteBtn.addEventListener('click', () => { audio.muted = !audio.muted; state.muted = audio.muted; persist(true); syncUi() })
loopBtn.addEventListener('click', () => { audio.loop = !audio.loop; state.loop = audio.loop; persist(true); syncUi() })

/* 页面隐藏时暂停；回到前台若上次在播放则尝试恢复，失败则等手势。 */
let resumeOnVisible = false
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (!audio.paused) { resumeOnVisible = true; audio.pause() }
    persist(true)
  } else if (resumeOnVisible) {
    resumeOnVisible = false
    audio.play().then(() => { state.playing = true; syncUi() }).catch(() => armResume())
  }
})
window.addEventListener('pagehide', () => persist(true))
/* 其他标签页调整音量/静音/循环时跟随；播放状态不跨标签页抢控制。 */
window.addEventListener('storage', (event) => {
  if (event.key !== KEY) return
  const next = readState()
  state.volume = next.volume; state.muted = next.muted; state.loop = next.loop
  audio.volume = next.volume; audio.muted = next.muted; audio.loop = next.loop
  syncUi()
})
syncUi()