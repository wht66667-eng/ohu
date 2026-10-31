import type { IconStateKey } from './app-icon'
import { getUiVariant, foxCampusAssetUrl, themeAssetUrl, isFoxFreeVariant } from './ui-variant'

/** The reference fox is shared across every surface; props and expressions explain context. */
export const FOX_POSES = [
  'avatar', 'welcome', 'reading', 'focus', 'parcel', 'shopping', 'guide',
  'search', 'chat', 'loading', 'food', 'contact', 'cheer', 'trophy', 'jump',
  'waiting', 'encourage', 'puzzled', 'sad', 'determined', 'lonely', 'calling', 'pleading',
] as const
export type FoxPose = typeof FOX_POSES[number]

export function foxAssetUrl(pose: FoxPose): string {
  const campus: Partial<Record<FoxPose, string>> = { welcome: 'welcome', guide: 'welcome', chat: 'welcome', contact: 'welcome', avatar: 'avatar', reading: 'reading', focus: 'reading', puzzled: 'puzzled', search: 'puzzled', waiting: 'puzzled' }
  if (isFoxFreeVariant(getUiVariant())) return ''
  if (pose === 'loading') return `${import.meta.env.BASE_URL}brand/ohu-original/fox-loader-wave-v2.png`
  if (getUiVariant() === 'minimal') return themeAssetUrl('fox.svg')
  if ((getUiVariant() === 'fox' || getUiVariant() === 'cute') && campus[pose]) return foxCampusAssetUrl(`${campus[pose]}.webp`)
  return `${import.meta.env.BASE_URL}pixel-fox/${pose}.png`
}

export const FOX_MOOD_POSES: Record<IconStateKey, FoxPose> = {
  default: 'avatar',
  streak_1: 'welcome', streak_3: 'cheer', streak_7: 'trophy', streak_14: 'jump',
  away_2: 'waiting', away_5: 'encourage', away_8: 'puzzled', away_12: 'sad',
  away_15: 'determined', away_20: 'lonely', away_25: 'calling', away_30: 'pleading',
}

export function foxPoseForPath(pathname: string): FoxPose {
  if (/^\/(chat|chats|messages|im)(\/|$)/.test(pathname)) return 'chat'
  if (/^\/(task|tasks|express)(\/|$)/.test(pathname)) return 'parcel'
  if (/^\/(market|shops|shop|goods|item)(\/|$)/.test(pathname)) return 'shopping'
  if (/^\/(food|canteen)(\/|$)/.test(pathname)) return 'food'
  if (/^\/study\/focus(\/|$)/.test(pathname)) return 'focus'
  if (/^\/(study|english|words|schedule|todo)(\/|$)/.test(pathname)) return 'reading'
  if (/^\/(info|plaza|search)(\/|$)/.test(pathname)) return 'search'
  if (/^\/(contact|feedback)(\/|$)/.test(pathname)) return 'contact'
  if (/^\/(services|work|settings)(\/|$)/.test(pathname)) return 'guide'
  return 'welcome'
}
