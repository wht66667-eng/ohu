import { FOX_V1_STICKERS, foxV1StickerUrl, type FoxV1StickerId } from './fox-v1-assets'
import { FOX_V1_EVENT, getFoxV1Summary, type LoginMoodSummary } from './fox-v1'

export type StartupLayout = 'face' | 'achievement' | 'comic'
let openingLayout: StartupLayout | undefined

function hasKnownHistory(summary: LoginMoodSummary) {
  return !!summary.userId && summary.hasHistory && !summary.pendingSync && summary.totalLoginDays > 0
}

/** Unknown or anonymous records never produce a made-up achievement. */
export function chooseStartupLayout(summary: LoginMoodSummary, random = Math.random): StartupLayout {
  const known = hasKnownHistory(summary)
  const weights: Array<[StartupLayout, number]> = known
    ? summary.missedDays >= 2 ? [['face', 3], ['achievement', 1], ['comic', 4]]
      : summary.currentStreakDays >= 3 ? [['face', 2], ['achievement', 4], ['comic', 2]]
        : [['face', 4], ['achievement', 2], ['comic', 2]]
    : [['face', 4], ['comic', 2]]
  let draw = Math.max(0, Math.min(.999999, random())) * weights.reduce((sum, [, weight]) => sum + weight, 0)
  for (const [layout, weight] of weights) { draw -= weight; if (draw < 0) return layout }
  return 'face'
}

function sticker(id: string): FoxV1StickerId {
  return FOX_V1_STICKERS.find((item) => item.id === id)?.id || 'login_day_01'
}
function setText(id: string, text: string) {
  const element = document.getElementById(id)
  if (element) element.textContent = text
}
function setSticker(id: string, pose: FoxV1StickerId) {
  const element = document.getElementById(id) as HTMLImageElement | null
  if (element && element.getAttribute('src') !== foxV1StickerUrl(pose)) element.src = foxV1StickerUrl(pose)
}

/** Text updates when real records arrive; the selected composition never restarts. */
export function updateStartupCover() {
  const splash = document.getElementById('boot-splash')
  if (!splash || splash.dataset.dismissed) return
  const summary = getFoxV1Summary()
  const known = hasKnownHistory(summary)
  if (!openingLayout) {
    const requested = import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === 'boot'
      ? new URLSearchParams(window.location.search).get('startup') : null
    openingLayout = requested === 'face' || requested === 'achievement' || requested === 'comic'
      ? requested : chooseStartupLayout(summary)
  }
  splash.dataset.layout = openingLayout
  const mood = known ? sticker(summary.moodId) : 'login_day_01'
  setSticker('boot-face-image', mood)
  setText('boot-face-title', known && summary.missedDays >= 2 ? '回来就好，慢慢继续' : '校园里，又见面啦')
  setText('boot-face-copy', known && summary.missedDays >= 2 ? '阿狐在这里，陪你从今天继续。' : '带上好心情，开始今天的校园生活。')
  const achievement = summary.currentStreakDays >= 30 ? 'login_day_30'
    : summary.currentStreakDays >= 7 ? 'login_day_07' : summary.currentStreakDays >= 3 ? 'login_day_03' : 'login_day_01'
  setSticker('boot-achievement-image', known ? achievement : 'login_day_01')
  setText('boot-total-days', known ? String(summary.totalLoginDays) : '—')
  setText('boot-streak-days', known ? String(summary.currentStreakDays) : '—')
  setText('boot-achievement-copy', known ? '每一次相见，都留在真实的记录里。' : '登录记录恢复后，会在这里与你相见。')
  const returning = known && summary.missedDays >= 2
  setSticker('boot-comic-first', returning ? mood : 'login_day_01')
  setSticker('boot-comic-second', 'random_study')
  setSticker('boot-comic-third', known && summary.currentStreakDays >= 3 ? achievement : 'random_chaos')
  setText('boot-comic-caption-first', returning ? '好久不见' : '带上好心情')
  setText('boot-comic-caption-second', '按自己的节奏')
  setText('boot-comic-caption-third', returning ? '从今天继续' : '校园里见')
  setText('boot-comic-title', returning ? '今天，重新出发' : '校园日常，阿狐在场')
}

export function mountStartupCover() {
  updateStartupCover()
  window.addEventListener(FOX_V1_EVENT, updateStartupCover)
  return () => window.removeEventListener(FOX_V1_EVENT, updateStartupCover)
}
