/**
 * Capacitor 配置
 * 界面热更新：国内 COS/CDN（见 tools/ota-upload-cos.mjs + src/lib/live-update.ts）
 */
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.sunshinecampus.app',
  appName: '哦狐',
  webDir: 'dist-app',
  server: {
    androidScheme: 'https',
    allowNavigation: [
      '*.tcloudbase.com',
      '*.tcloudbaseapp.com',
      '*.tcb.qcloud.la',
      '*.myqcloud.com',
    ],
  },
  android: {
    // Native WindowInsets populate CSS safe-area values; avoid double margins.
    adjustMarginsForEdgeToEdge: 'disable',
    // TEST ONLY: 真机联调期开启 WebView 调试，随测试包一起回退。
    webContentsDebuggingEnabled: true,
  },
  plugins: {
    CapacitorUpdater: {
      autoUpdate: false,
      // 冷启动较慢时避免误回滚；须配合 main 首行 ota-ready notifyAppReady
      appReadyTimeout: 60000,
      // 大包下载时拉长空闲超时，减少「下载失败」
      responseTimeout: 120,
      // 内置包版本标签（与 APK versionName 对齐；热更包用 manifest.version）
      version: '1.2.155',
    },
  },
}

export default config
