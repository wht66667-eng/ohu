import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './skins.css'
import './sheet.css'
import App from './App.tsx'
import { applyNativeStatusBar } from './lib/native'
import { applyTheme, getStoredTheme, watchSystemTheme } from './lib/theme'
import { warmCampusDb } from './lib/campus-db'
import { initAppSecurity } from './lib/app-security'
import { initLiveUpdate } from './lib/live-update'
import { initAppShell } from './lib/app-shell'

/* 主题须在首帧前应用，避免闪白/闪黑 */
applyTheme(getStoredTheme())
watchSystemTheme(() => {
  if (getStoredTheme() === 'system') applyTheme('system')
})

/* 状态栏必须在首帧前就配好：套壳下 WebView 默认会顶一条系统色的横条，
   等 React 挂载再改就会先闪一下。这里不 await——它只影响原生外观，
   不该拖慢首屏与启动屏淡出。H5 下该调用直接返回。 */
void applyNativeStatusBar()

/* 原生安全与热更新：异步，不挡首屏 */
void initAppSecurity()
void initLiveUpdate()

/* 校园入口专用库：目录种子写入 IndexedDB */
warmCampusDb()

/* Resolve the local native package before any route or consent reads its shell. */
async function mountApp() {
  await initAppShell()
  createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
}
void mountApp()
