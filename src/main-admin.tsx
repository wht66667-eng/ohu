import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './skins.css'
import './paper.css'
import './fonts.css'
import './sheet.css'
import AdminApp from './AdminApp'
import { applyNativeStatusBar } from './lib/native'
import { applyTheme, getStoredTheme, watchSystemTheme } from './lib/theme'
import { initAppSecurity, isAppSecurityBlocked } from './lib/app-security'
import { initLiveUpdate } from './lib/live-update'
import { initAppShell } from './lib/app-shell'
import { initCredentialProtection } from './lib/credential-storage'

applyTheme(getStoredTheme())
watchSystemTheme(() => { if (getStoredTheme() === 'system') applyTheme('system') })
void applyNativeStatusBar()
async function mountAdmin() {
  await initAppSecurity()
  if (isAppSecurityBlocked()) return
  await initCredentialProtection()
  void initLiveUpdate()
  await initAppShell()
  if (isAppSecurityBlocked()) return
  createRoot(document.getElementById('root')!).render(<StrictMode><AdminApp /></StrictMode>)
}
void mountAdmin()
