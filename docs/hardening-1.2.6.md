# 加固 / 动效 / 热更新（1.2.6 → 1.2.7）

## 已落地

| 项 | 说明 |
| --- | --- |
| freeRASP | `capacitor-freerasp`，启动时 `initAppSecurity()`；五端按 `App.getInfo().id` 填包名 |
| R8 | Release 已开 minify + shrink；ProGuard 补 freeRASP / Capgo keep |
| Motion | 底栏入场、发布钮、登录门禁卡片、首页顶栏/搜索/快捷入口 |
| Capgo 热更 | Capacitor 7 + `@capgo/capacitor-updater@7` + JDK17 patch；构建注入 `VITE_CAPGO_APP_ID` |
| APK 更新 | `public/update.json` 仍按壳分发五端整包（原生变更时用） |

签名哈希（sunshine-release.jks）：`iLLF3XR0bIGxYDGVWIDaJuBLUWtFqLUQTQxmLJXl/RI=`

## 策略说明

- 校园 APK 多为侧载 + MuMu：模拟器 / 非商店安装 **只打日志**，不杀进程。
- Root / Frida / 完整性失败：toast 告警；`killOnBypass: false`。
- **正式上架应用商店后**：可把 `killOnBypass` 改为 `true`，并收紧 `unofficialStore`；同时把 freeRASP 的商店包名列表改成实际上架渠道。

## Capgo 运维

见 `docs/release/capgo.md`。界面热更走 Capgo；壳 / 权限变更走 `update.json` + 新 APK。
