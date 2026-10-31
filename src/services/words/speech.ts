/**
 * 单词 / 短句朗读
 * - 英文优先有道词典语音（Android WebView 常无 speechSynthesis）
 * - 失败再回落 Web Speech API
 * - 中文解说走 Web Speech（zh-CN），失败则静默（界面仍有文字）
 */

let unlockTried = false
let audioEl: HTMLAudioElement | null = null

/** 部分 Android WebView 需先在用户手势里 unlock */
export function unlockSpeech(): void {
  if (unlockTried || typeof window === 'undefined') return
  unlockTried = true
  try {
    if (window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance('')
      u.volume = 0
      window.speechSynthesis.speak(u)
      window.speechSynthesis.cancel()
    }
  } catch {
    /* ignore */
  }
  try {
    audioEl = new Audio()
    audioEl.preload = 'none'
  } catch {
    /* ignore */
  }
}

/** 只要能播音频或 TTS 之一就算可朗读 */
export function canSpeak(): boolean {
  if (typeof window === 'undefined') return false
  return true
}

function youdaoUrl(word: string, accent: 'us' | 'uk' = 'us'): string {
  const type = accent === 'uk' ? '1' : '2'
  return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word.trim())}&type=${type}`
}

/** 百度翻译 TTS（有道失败时的备用） */
function baiduTtsUrl(word: string): string {
  return `https://fanyi.baidu.com/gettts?lan=en&text=${encodeURIComponent(word.trim())}&spd=3&source=web`
}

function playAudioUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    try {
      if (!audioEl) audioEl = new Audio()
      const a = audioEl
      try {
        a.pause()
      } catch {
        /* ignore */
      }
      a.onended = () => done(true)
      a.onerror = () => done(false)
      a.src = url
      const p = a.play()
      if (p && typeof p.then === 'function') {
        p.then(() => done(true)).catch(() => done(false))
      } else {
        done(true)
      }
      window.setTimeout(() => done(false), 5000)
    } catch {
      done(false)
    }
  })
}

function speakWeb(text: string, lang: string): boolean {
  if (typeof window === 'undefined' || !window.speechSynthesis || !text.trim()) return false
  try {
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text.trim())
    u.lang = lang
    u.rate = lang.startsWith('zh') ? 1 : 0.92
    u.pitch = 1
    const voices = window.speechSynthesis.getVoices()
    if (lang.startsWith('en')) {
      const en =
        voices.find((v) => /en-GB/i.test(v.lang) && /female|samantha|google/i.test(v.name)) ||
        voices.find((v) => /^en(-|$)/i.test(v.lang)) ||
        voices.find((v) => /en/i.test(v.lang))
      if (en) u.voice = en
    } else if (lang.startsWith('zh')) {
      const zh =
        voices.find((v) => /zh-CN|cmn-Hans/i.test(v.lang)) || voices.find((v) => /zh/i.test(v.lang))
      if (zh) u.voice = zh
    }
    window.speechSynthesis.speak(u)
    return true
  } catch {
    return false
  }
}

/** 英文单词：有道音频 → Web Speech */
export async function speakWordAsync(word: string, lang = 'en-US'): Promise<boolean> {
  const w = word.trim()
  if (!w) return false
  unlockSpeech()
  stopSpeak()
  if (/^[a-zA-Z][a-zA-Z\s'-]*$/.test(w)) {
    const okUs = await playAudioUrl(youdaoUrl(w, 'us'))
    if (okUs) return true
    const okUk = await playAudioUrl(youdaoUrl(w, 'uk'))
    if (okUk) return true
    const okBd = await playAudioUrl(baiduTtsUrl(w))
    if (okBd) return true
  }
  return speakWeb(w, lang)
}

/** 同步触发（页面按钮用）；内部异步播 */
export function speakWord(word: string, lang = 'en-US'): boolean {
  if (!word.trim()) return false
  void speakWordAsync(word, lang)
  return true
}

/** 中文短句（阿狐解说等） */
export async function speakZhAsync(text: string): Promise<boolean> {
  const t = text.trim()
  if (!t) return false
  unlockSpeech()
  stopSpeak()
  if (speakWeb(t, 'zh-CN')) return true
  // 无系统中文 TTS 时不再强求；界面有文字
  return false
}

export function speakZh(text: string): void {
  void speakZhAsync(text)
}

export function stopSpeak() {
  try {
    window.speechSynthesis?.cancel()
  } catch {
    /* ignore */
  }
  try {
    if (audioEl) {
      audioEl.pause()
      audioEl.removeAttribute('src')
      audioEl.load()
    }
  } catch {
    /* ignore */
  }
}
