# 哦狐学生端 · 验收状态（2026-11-07）

包名：`com.sunshinecampus.app.devtest`（学生端 debug）
设备：模拟器 `127.0.0.1:16384`（Android 15，1080×1920）
真机：Xiaomi 2607DRA18C `922b546b` **未连接**

## 已验证

| 功能 | 证据 | 状态 |
|---|---|---|
| 课表 | 一键获取返回 142 条 | ✅ |
| 成绩 | 12 条 | ✅ |
| 考试 | 4 条（只保留有日期+时间的真实考试） | ✅ |
| 体测 | 3 条；本次/历年/标准三视图；独立「更新体测」 | ✅ |
| PU 成绩 | 4.85 总学分，10 条明细；A 0 / B 3.05 / C 0.6 / 劳动 1.2；token 复用 | ✅ |
| PU 解除授权 | 清 localStorage token/sid + 本机缓存 | ✅ |
| 公选 UI | 成绩 tab 卡片 + `/study/quality` 详情页；种子数据 4.25/3.05/1.2/3614 | ✅（UI） |
| 公选请求体 | `{"outid":"<学号>"}`，单测 4 项 | ✅（代码） |
| 学习通生产代理 | `chaoxing.enabled=true`；`/api/health` 200 | ✅ |
| 学习通 App→代理 | 假账号从 App 提交，返回「学习通登录未通过…」 | ✅ |
| 学习通 Cookie 导入 | `uid/_uid/fid/vc3`；mooc1 → mooc2-ans 双入口；失败自动展开 | ✅（代码） |
| 图书馆 | `/library` 官方指引 + 微信说明，明确不代登录/代选座 | ✅ |
| 解析/兼容测试 | 28 项全绿（abort/chaoxing/quality/pu/zf/schedule-schools） | ✅ |

## 生产接口

```
GET https://jou-.../api/integrations/capabilities
{"chaoxing":{"enabled":true,"readOnly":true},"ok":true,...}

GET https://jou-.../api/health
200，version 2.4.1-security150

POST /api/learning/chaoxing/query（假账号）
422 CHAOXING_READ_FAILED
```

## 待完成 / 需要输入

1. **真机验收**：Xiaomi `922b546b` 重新连接后安装最新 APK，跑一遍课表/PU/体测。
2. **公选真实数据**：需要一次真实 VPN + 统一认证登录；当前只验证到请求体与解析层。
3. **学习通真实数据**：需要真实学习通账号或浏览器 Cookie；代理与 App 链路已通。
4. **图书馆选座**：官方系统是微信「我去图书馆」，App 内只能提供入口与说明，无法代登录/代选座。
5. **身份令牌**：PU token/sid 已复用；图书馆没有 CAS 令牌通道；教务会话仍在 WebView 内。

## 重新构建

```powershell
$env:VITE_BASE='./'; $env:VITE_APP_SHELL='user'
$env:VITE_CAPGO_APP_ID='com.sunshinecampus.app'; $env:VITE_FDROID_BUILD='0'
node node_modules/vite/bin/vite.js build --outDir dist-app --base ./ --emptyOutDir false
npx cap sync android
cd android; .\gradlew.bat assembleUserDebug --no-daemon
adb install -r app/build/outputs/apk/user/debug/app-user-debug.apk
```
