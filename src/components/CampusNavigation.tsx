import type { MouseEvent } from 'react'
import { amapAppNavigationUrl, amapNavigationUrl, navigationModes, type NavigationMode } from '../lib/campus-map-navigation'
import { IS_NATIVE, PLATFORM } from '../lib/platform'
import { launchScheme } from '../lib/express-app-probe'
import { useToast } from '../context/ToastContext'
import s from './CampusNavigation.module.css'

export function CampusNavigation({ poi, onRequireLogin }: { poi: { lng: number; lat: number; name: string }; onRequireLogin: () => boolean }) {
  const toast = useToast()
  async function open(event: MouseEvent<HTMLAnchorElement>, mode: NavigationMode, appFirst = true) {
    if (!onRequireLogin()) { event.preventDefault(); return }
    if (!IS_NATIVE) return
    event.preventDefault()
    const url = amapNavigationUrl(poi, mode, false)
    if (appFirst && await launchScheme(amapAppNavigationUrl(poi, mode, PLATFORM.os))) return
    if (!await launchScheme(url)) window.location.assign(url)
  }
  if (!Number.isFinite(poi.lng) || !Number.isFinite(poi.lat)) return null
  return <section className={s.navigation} aria-label="高德导航">
    <b>去这里</b><div className={s.modes}>{navigationModes.map(({ mode, label }) => <a key={mode} href={amapNavigationUrl(poi, mode)} target="_blank" rel="noopener noreferrer" onClick={e => void open(e, mode).catch(() => toast.err('暂时无法打开高德，请使用网页版'))}>{label}</a>)}</div>
    <p>优先打开高德 App，未安装时使用网页。起点由高德定位，也可在高德中修改。</p>
    <details><summary>仅打开高德网页版</summary><div className={s.modes}>{navigationModes.map(({ mode, label }) => <a key={mode} href={amapNavigationUrl(poi, mode, false)} target="_blank" rel="noopener noreferrer" onClick={e => void open(e, mode, false).catch(() => toast.err('暂时无法打开高德网页'))}>{label}路线</a>)}</div></details>
  </section>
}
