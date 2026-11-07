/**
 * freeRASP 运行时防护（仅原生壳启用）
 *
 * - 五端 applicationId 不同：启动时用 App.getInfo().id 填 packageName
 * - 签名哈希与 android/keystore/sunshine-release.jks 一致
 * - 校园 APK 多为侧载 + MuMu 调试：模拟器/非商店安装只告警，不杀进程
 * - Root / Frida / 完整性破坏：toast 告警；可按需在设置里加强
 */
import { App } from '@capacitor/app'
import { startFreeRASP, type SuspiciousAppInfo, type TalsecConfig } from 'capacitor-freerasp'
import { IS_NATIVE, PLATFORM } from './platform'
import { SHELL_APP_ID, getAppShell } from './app-shell'
import { toast } from './toast'

/** sunshine-release.jks / alias sunshine 的 SHA-256（Base64） */
export const RELEASE_CERT_HASH_B64 = 'iLLF3XR0bIGxYDGVWIDaJuBLUWtFqLUQTQxmLJXl/RI='

const WATCHER_MAIL = 'sunshine-campus-security@users.noreply.github.com'

let started = false
/** Root 等环境告警每会话最多一次，且用短 warn，避免压住 Petdex 顶栏 */
const raspOnce = new Set<string>()

function softWarn(title: string, key?: string) {
  if (key) {
    if (raspOnce.has(key)) return
    raspOnce.add(key)
  }
  try {
    toast.warn(title, { duration: 1600 })
  } catch {
    console.warn('[rasp]', title)
  }
}

function hardWarn(title: string, key?: string) {
  softWarn(title, key)
  console.error('[rasp]', title)
}

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
    /* 侧载调试包用 debug 证书签名，必然过不了 release 证书校验；只在正式包告警。 */
    const devBuild = import.meta.env.DEV || /\.(devtest|debug)$/.test(packageName)

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
      // 开发/MuMu 常会触发 bypass 相关检测，先不自动杀进程
      killOnBypass: false,
    }

    const result = await startFreeRASP(config, {
      privilegedAccess: () => softWarn('检测到设备已 Root，部分功能可能不可用', 'root'),
      hooks: () => hardWarn('检测到异常注入环境（如 Frida），请勿在不安全设备登录', 'hooks'),
      appIntegrity: () => { if (!devBuild) hardWarn('应用完整性校验失败，请从官方渠道重装', 'integrity') },
      obfuscationIssues: () => console.warn('[rasp] obfuscationIssues'),
      // 侧载与模拟器：告警级别降低，避免挡日常调试 / 校园包分发
      unofficialStore: () => console.info('[rasp] unofficial install (sideload OK for campus APK)'),
      simulator: () => console.info('[rasp] emulator detected'),
      debug: () => console.info('[rasp] debugger attached'),
      adbEnabled: () => console.info('[rasp] adb enabled'),
      multiInstance: () => softWarn('检测到应用多开，请关闭分身后再使用', 'multi'),
      malware: (apps: SuspiciousAppInfo[]) => {
        if (!apps?.length) return
        softWarn(`检测到可疑应用 ${apps.length} 个，请留意设备安全`, 'malware')
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
