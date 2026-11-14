import { openExternalUrl } from './campus-links'
import { launchScheme, openChaoxingApp } from './express-app-probe'

export const CHAOXING_OFFICIAL_URL = 'https://app.chaoxing.com/'

/** Opens the installed Android app; otherwise opens Chaoxing's official download page. */
export async function openChaoxing(): Promise<'app' | 'official-site'> {
  if (await openChaoxingApp().catch(() => false)) return 'app'
  if (await launchScheme(CHAOXING_OFFICIAL_URL)) return 'official-site'
  openExternalUrl(CHAOXING_OFFICIAL_URL)
  return 'official-site'
}
