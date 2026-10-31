import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './skins.css'
import './sheet.css'
import AdminApp from './AdminApp'
import { applyNativeStatusBar } from './lib/native'
import { applyTheme, getStoredTheme, watchSystemTheme } from './lib/theme'
import { initAppSecurity } from './lib/app-security'
import { initLiveUpdate } from './lib/live-update'
import { initAppShell } from './lib/app-shell'

applyTheme(getStoredTheme())
watchSystemTheme(() => { if (getStoredTheme() === 'system') applyTheme('system') })
void applyNativeStatusBar()
void initAppSecurity()
void initLiveUpdate()

async function mountAdmin() {
  await initAppShell()
  createRoot(document.getElementById('root')!).render(<StrictMode><AdminApp /></StrictMode>)
}
void mountAdmin()
