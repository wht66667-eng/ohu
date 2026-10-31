import { loadFocusVolume, saveFocusVolume } from './focus-settings'
import { peekFocusMusic, readFocusMusic } from './focus-music'

let context: AudioContext | null = null
let source: AudioBufferSourceNode | null = null
let filter: BiquadFilterNode | null = null
let gain: GainNode | null = null
let customAudio: HTMLAudioElement | null = null
let localUrl: string | null = null
let generation = 0
let volume = loadFocusVolume()
let audioError = ''
let playTimeout = 0
let cancelPendingPlay: (() => void) | null = null
const BUILTIN_STRENGTH = 0.3
const getContext = () => context ??= new AudioContext()
export const getFocusAudioError = () => audioError

/** Applies immediately to the running track and remains after pause/restart. */
export function setFocusAudioVolume(next: number) {
  volume = saveFocusVolume(next)
  if (customAudio) customAudio.volume = volume
  if (gain && context) gain.gain.setTargetAtTime(volume * BUILTIN_STRENGTH, context.currentTime, .04)
  window.dispatchEvent(new CustomEvent('focus-volume-change', { detail: volume }))
  return volume
}

export function stopFocusAudio() {
  generation++
  audioError = ''
  cancelPendingPlay?.(); cancelPendingPlay = null
  window.clearTimeout(playTimeout)
  try { source?.stop() } catch { /* already stopped */ }
  source?.disconnect(); filter?.disconnect(); gain?.disconnect()
  source = null; filter = null; gain = null
  if (customAudio) { customAudio.pause(); customAudio.removeAttribute('src'); customAudio.load(); customAudio = null }
  if (localUrl) { URL.revokeObjectURL(localUrl); localUrl = null }
}

export async function playFocusAudio(kind: string): Promise<boolean> {
  stopFocusAudio()
  const current = generation
  let timeout = 0
  volume = loadFocusVolume()
  if (kind === 'off') return true
  try {
    if (/^https:\/\//.test(kind) || kind.startsWith('local:')) {
      let url = kind
      if (kind.startsWith('local:')) {
        const id = kind.slice(6)
        const record = peekFocusMusic(id) || await readFocusMusic(id)
        if (current !== generation) return false
        if (!record || !(record.blob instanceof Blob) || !record.blob.size) throw new Error('这首本地音乐已不可用，请重新导入')
        url = URL.createObjectURL(record.blob)
        localUrl = url
      }
      const audio = new Audio(url)
      audio.loop = true; audio.volume = volume; audio.preload = 'auto'
      customAudio = audio
      const cancelled = new Promise<never>((_, reject) => {
        cancelPendingPlay = () => reject(new DOMException('Playback cancelled', 'AbortError'))
        timeout = window.setTimeout(() => reject(new Error(kind.startsWith('local:') ? '读取本地音乐超时，请重试' : '音乐链接加载超时，请检查网络或换一个链接')), 12000)
        playTimeout = timeout
      })
      await Promise.race([audio.play(), cancelled])
      window.clearTimeout(timeout)
      if (current !== generation) { audio.pause(); return false }
      cancelPendingPlay = null; playTimeout = 0
      return true
    }
    if (!['white', 'rain', 'cafe'].includes(kind)) throw new Error('这个音源不可用，请重新选择音乐')
    const ctx = getContext()
    await ctx.resume()
    if (current !== generation) return false
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 8, ctx.sampleRate)
    const samples = buffer.getChannelData(0)
    let brown = 0
    for (let index = 0; index < samples.length; index++) {
      const white = Math.random() * 2 - 1
      brown = (brown + white * .025) / 1.025
      samples[index] = kind === 'white' ? white * .25 + brown * 2 : kind === 'cafe' ? brown * 3 * (.65 + .1 * Math.sin(index / ctx.sampleRate * 1.3)) : white * .2 + brown * 2.4
    }
    const node = ctx.createBufferSource()
    source = node; node.buffer = buffer; node.loop = true
    filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = kind === 'cafe' ? 600 : kind === 'rain' ? 1800 : 2600
    gain = ctx.createGain(); gain.gain.value = volume * BUILTIN_STRENGTH
    node.connect(filter); filter.connect(gain); gain.connect(ctx.destination); node.start()
    return true
  } catch (error) {
    window.clearTimeout(timeout)
    if (current !== generation) return false
    const failure = error instanceof Error ? error : null
    const message = failure?.name === 'NotAllowedError' ? '播放需要你的操作，请点击声音按钮重试' : failure?.name === 'NotSupportedError' ? '设备无法播放这首音乐，请换成 MP3 或 M4A' : failure?.message || '音乐暂时无法播放，请重试或换一个音源'
    stopFocusAudio(); audioError = message
    return false
  }
}

export function remindFocusComplete(kind: 'sound' | 'vibrate' | 'none') {
  if (kind === 'vibrate') { navigator.vibrate?.([160, 80, 160]); return }
  if (kind !== 'sound' || volume === 0) return
  try {
    const ctx = getContext()
    if (ctx.state !== 'running') return
    for (let index = 0; index < 3; index++) {
      const tone = ctx.createOscillator(), envelope = ctx.createGain(), at = ctx.currentTime + index * .23
      tone.frequency.value = [660, 880, 990][index]
      envelope.gain.setValueAtTime(0, at); envelope.gain.linearRampToValueAtTime(Math.max(.001, volume * .15), at + .015); envelope.gain.exponentialRampToValueAtTime(.001, at + .21)
      tone.connect(envelope); envelope.connect(ctx.destination); tone.start(at); tone.stop(at + .22)
      tone.onended = () => { tone.disconnect(); envelope.disconnect() }
    }
  } catch { /* Device may not support WebAudio. */ }
}
export async function unlockFocusAudio() { try { await getContext().resume() } catch { /* A playback button may retry. */ } }
