/**
 * freeRASP 运行时防护（仅原生壳启用）
 *
 * - 五端 applicationId 不同：启动时用 App.getInfo().id 填 packageName
 * - 签名哈希与 android/keystore/sunshine-release.jks 一致
 * - 校园 APK 多为侧载：模拟器/非商店安装不作为 Root 证据
 * - Root / 注入 / 正式包完整性异常：清空业务视图并切到原生阻断页
 */
import { App } from '@capacitor/app'
import { registerPlugin } from '@capacitor/core'
import { startFreeRASP, type SuspiciousAppInfo, type TalsecConfig } from 'capacitor-freerasp'
import { IS_NATIVE, PLATFORM } from './platform'
import { SHELL_APP_ID, getAppShell } from './app-shell'

/** sunshine-release.jks / alias sunshine 的 SHA-256（Base64） */
export const RELEASE_CERT_HASH_B64 = 'iLLF3XR0bIGxYDGVWIDaJuBLUWtFqLUQTQxmLJXl/RI='

const WATCHER_MAIL = 'sunshine-campus-security@users.noreply.github.com'

let started = false
let blocked = false
const gate = registerPlugin<{
  status(): Promise<{ debuggable: boolean }>
  block(): Promise<void>
}>('SecurityGate')

/** 原生转换完成前也不再向用户显示旧业务页面。 */
function blockBusinessView(): void {
  if (blocked) return
  blocked = true
  const root = document.getElementById('root')
  if (root) {
    root.replaceChildren()
    const message = document.createElement('p')
    message.textContent = '设备安全检查未通过。请在安全设备上使用哦狐。'
    message.setAttribute('role', 'alert')
    message.style.cssText = 'padding:32px;min-height:100vh;display:grid;place-items:center;text-align:center'
    root.appendChild(message)
  }
  void gate.block().catch(() => undefined)
}

export function isAppSecurityBlocked(): boolean { return blocked }

export async function initAppSecurity(): Promise<boolean> {
  if (!IS_NATIVE || started) return started
  if (typeof window === 'undefined') return false
  // Self-signed iPhone packages can belong to different teams. Do not start
  // a native integrity SDK with an unknown team identity; it can terminate
  // the app before the JavaScript error handler can recover.
  if (PLATFORM.os !== 'android') return false

  try {
    const info = await App.getInfo()
    const packageName = info.id || SHELL_APP_ID[getAppShell()] || 'com.sunshinecampus.app'
    /* Debug 签名与正式证书不同，不应把开发包判为篡改。 */
    const devBuild = (await gate.status()).debuggable

    const config: TalsecConfig = {
      androidConfig: {
        packageName,
        certificateHashes: [RELEASE_CERT_HASH_B64],
        // 校园侧载分发：不把「非 Play」当硬错误
        supportedAlternativeStores: [],
      },
      iosConfig: {
        appBundleId: 'com.sunshinecampus.app',
        appTeamId: 'PENDING',
      },
      watcherMail: WATCHER_MAIL,
      isProd: import.meta.env.PROD,
      killOnBypass: !devBuild,
    }

    const result = await startFreeRASP(config, {
      privilegedAccess: blockBusinessView,
      hooks: blockBusinessView,
      appIntegrity: () => { if (!devBuild) blockBusinessView() },
      obfuscationIssues: () => console.warn('[rasp] obfuscationIssues'),
      // 侧载与模拟器：告警级别降低，避免挡日常调试 / 校园包分发
      unofficialStore: () => console.info('[rasp] unofficial install (sideload OK for campus APK)'),
      simulator: () => console.info('[rasp] emulator detected'),
      debug: () => console.info('[rasp] debugger attached'),
      adbEnabled: () => console.info('[rasp] adb enabled'),
      multiInstance: () => console.warn('[rasp] multiple instances'),
      malware: (apps: SuspiciousAppInfo[]) => {
        if (!apps?.length) return
        console.warn('[rasp] suspicious apps count', apps.length)
      },
      screenshot: () => undefined,
      screenRecording: () => undefined,
      systemVPN: () => undefined,
      devMode: () => console.info('[rasp] developer mode'),
    })

    started = !!result?.started
    if (started) console.info('[rasp] freeRASP started for', packageName)
    return started
  } catch (e) {
    console.warn('[rasp] init failed', e)
    return false
  }
}
