# Android 本地安装验收：1.2.136

日期：2026-10-26（北京时间）。用户要求先将最新 APK 更新到 USB 连接的手机，再继续提醒排查。

## 本轮完成

- 安装前系统读取：学生端 com.sunshinecampus.app，1.2.134 / build 134。
- 本地已有历史 1.2.135 安装包，未覆盖；将本次源码版本同步为 1.2.136 / build 136。
- 使用原发布签名，构建 arm64-v8a 学生端正式 APK，校验包名、版本、签名和 APK v2 签名通过。
- APK：.release-out/apk/1.2.136-136/SunshineCampus-User-1.2.136.apk
- 体积：38,731,968 字节；SHA-256：47d3ce8d5360c8fd730e719f978fe774ebbfcb024c0c697f2da43be4e66da862。
- 已传入手机 Download/Ohu-User-1.2.136.apk，并执行保留数据的覆盖安装，系统返回 Success。
- 安装后再次读取：versionName=1.2.136，versionCode=136；数据目录标识与安装前一致；未卸载或清理应用数据。
- 已启动 MainActivity；精确闹钟 appop 仍为 allow；更新后系统能查到该包的 RTC_WAKEUP 提醒排程。

## 验证

- npx tsc -b：通过。
- APK 正式构建（内含 TypeScript、Vite、Capacitor 同步、Gradle/R8 与签名校验）：通过。
- app-version、app-update、live-update、course-reminder-effects-settings、course-reminder-delivery-native、reminder-plan-native、reminder-plan-session：54 项通过。
- 构建提示 boot/campus-start.css 在 Vite 阶段尚不存在；后续生成后已确认 dist-app/boot/campus-start.css 存在。

## 尚需实机验收

系统存在排程不代表所有业务提醒已经正确。重复通知、下课后通知、锁屏或划掉最近任务后的送达，以及独立铃声/震动设置，仍需要结合手机当前课程与实际到点记录逐项核对，不宣称已彻底解决。

本轮未发布热更新、未上传安装包到线上、未修改云端数据。未完成的个人页精修、管理员地点编辑和全页素材验收另行继续。
