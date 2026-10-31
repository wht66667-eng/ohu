/**
 * 一键提醒效果：震动 + 语音播报 +（可选）系统通知
 * Native / H5 均可调用；能力缺失时静默降级。
 */
import { IS_NATIVE } from './platform'

const PREF_VIBRATE = 'sc_alert_vibrate'
const PREF_SPEAK = 'sc_alert_speak'

export function getAlertVibrateEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_VIBRATE) !== '0'
  } catch {
    return true
  }
}

export function setAlertVibrateEnabled(on: boolean) {
  try {
    localStorage.setItem(PREF_VIBRATE, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export function getAlertSpeakEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_SPEAK) !== '0'
  } catch {
    return true
  }
}

export function setAlertSpeakEnabled(on: boolean) {
  try {
    localStorage.setItem(PREF_SPEAK, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export type AlertBurstOpts = {
  title: string
  body: string
  /** 是否朗读 body（默认跟随设置） */
  speak?: boolean
  /** 是否震动（默认跟随设置） */
  vibrate?: boolean
  /** 短提示音；与语音播报独立。浏览器需已允许音频播放。 */
  ring?: boolean
  /** 额外推一条即时系统通知（默认 false，弹窗由调用方负责） */
  notify?: boolean
}

/** 震动：优先 navigator.vibrate，模式 短-停-短-停-长 */
export async function burstVibrate(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      return navigator.vibrate([180, 80, 180, 80, 320])
    }
  } catch {
    /* ignore */
  }
  return false
}

/** A short local tone; Android scheduled notifications use their system channel instead. */
export async function burstRing(): Promise<boolean> {
  try {
    const host = window as Window & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
    const Audio = host.AudioContext || host.webkitAudioContext
    if (!Audio) return false
    const context = new Audio()
    if (context.state === 'suspended') await context.resume()
    if (context.state !== 'running') { await context.close(); return false }
    const tone = context.createOscillator(), volume = context.createGain()
    tone.type = 'sine'; tone.frequency.value = 880
    volume.gain.setValueAtTime(0, context.currentTime)
    volume.gain.linearRampToValueAtTime(.12, context.currentTime + .02)
    volume.gain.linearRampToValueAtTime(0, context.currentTime + .4)
    tone.connect(volume); volume.connect(context.destination)
    tone.onended = () => { void context.close() }
    tone.start(); tone.stop(context.currentTime + .42)
    return true
  } catch { return false }
}

/** 中文语音播报（Web Speech API；无可用语音则跳过） */
export function burstSpeak(text: string): boolean {
  try {
    if (typeof window === 'undefined' || !window.speechSynthesis) return false
    const clean = (text || '').replace(/\s+/g, ' ').trim()
    if (!clean) return false
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(clean)
    u.lang = 'zh-CN'
    u.rate = 1.05
    u.pitch = 1
    const voices = window.speechSynthesis.getVoices()
    const zh = voices.find((v) => /zh(-|_|$)|Chinese|中文/i.test(`${v.lang} ${v.name}`))
    if (zh) u.voice = zh
    window.speechSynthesis.speak(u)
    return true
  } catch {
    return false
  }
}

async function burstNotify(title: string, body: string): Promise<boolean> {
  try {
    if (IS_NATIVE) {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      const perm = await LocalNotifications.requestPermissions()
      if (perm.display !== 'granted') return false
      await LocalNotifications.createChannel({
        id: 'one-tap-alert',
        name: '一键提醒',
        description: '考证 / 考试即时提醒',
        importance: 5,
        visibility: 1,
        sound: 'default',
        vibration: true,
      }).catch(() => undefined)
      const id = 53000 + (Date.now() % 900)
      await LocalNotifications.schedule({
        notifications: [
          {
            id,
            title,
            body,
            schedule: { at: new Date(Date.now() + 800), allowWhileIdle: true },
            channelId: 'one-tap-alert',
            extra: { type: 'one-tap' },
          },
        ],
      })
      return true
    }
    if (typeof Notification === 'undefined') return false
    if (Notification.permission === 'default') await Notification.requestPermission()
    if (Notification.permission !== 'granted') return false
    new Notification(title, { body, silent: false })
    return true
  } catch {
    return false
  }
}

/** 一键提醒：震动 + 语音 + 可选系统通知。弹窗由 UI 层负责。 */
export async function fireAlertBurst(opts: AlertBurstOpts): Promise<{
  vibrated: boolean
  spoken: boolean
  notified: boolean
  rang: boolean
}> {
  const wantVibrate = opts.vibrate ?? getAlertVibrateEnabled()
  const wantSpeak = opts.speak ?? getAlertSpeakEnabled()
  const vibrated = wantVibrate ? await burstVibrate() : false
  const spoken = wantSpeak ? burstSpeak(`${opts.title}。${opts.body}`) : false
  const notified = opts.notify ? await burstNotify(opts.title, opts.body) : false
  const rang = opts.ring ? await burstRing() : false
  return { vibrated, spoken, notified, rang }
}
