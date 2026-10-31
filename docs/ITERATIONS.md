# 阳光校园 · 迭代索引

仓库：https://github.com/xiao-jj-78/sunshine-campus  
总表与说明：[`CHANGELOG.md`](./CHANGELOG.md)

| 版本 | Code | 类型 | Git 标签 | GitHub Release | 说明文档 |
| --- | --- | --- | --- | --- | --- |
| 1.2.26 | 41 | OTA | — | — | 港城街机四款真玩法 |
| 1.2.25 | 40 | OTA | — | — | 港城游戏馆（连云港主题） |
| 1.2.24 | 39 | OTA | — | — | 冒险包门禁 + 连云港刷怪/售卖 |
| 1.2.23 | 38 | OTA | `app-1.2.23` | ✅ | UGC 发布 UI：反馈/评价/求助组队 |
| 1.2.22 | 37 | OTA | `app-1.2.22` | ✅ | [LANDING](./petdex/LANDING.md) 互助组队/探索备份/邀请码 |
| 1.2.21 | 36 | OTA | — | — | wild_win 接线 + 五端 APK |
| 1.2.20 | 35 | OTA | `app-1.2.20` | ✅ | 百度 TTS 备用 |
| 1.2.19 | 34 | 整包+OTA | `app-1.2.19` | ✅ | FocusLock 学生端 APK |
| 1.2.18 | 33 | OTA | `app-1.2.18` | ✅ | 宠物真对决 + 单词无尽 |
| 1.2.17 | 32 | OTA | `app-1.2.17` | ✅ | 单词 TTS/计划/倒计时（并入 1.2.18 提交） |
| 1.2.16 | 30 | OTA | `app-1.2.16` | ✅ | 热更死循环修复 |
| 1.2.15 | 30 | OTA | `app-1.2.15` | ✅ | 专注舱+定位（有重复更新提示） |
| 1.2.14 | 27 | 整包 | `v1.2.14` / `app-1.2.14` | ✅ | [petdex 交付](./release/1.2.14-petdex.md) |
| 1.2.10 | 22 | 整包 | `app-1.2.10` | ✅ | [1.2.10](./release/1.2.10.md) |
| 1.2.9 | 21 | 整包 | `app-1.2.9` | ✅ | [COS OTA](./release/1.2.9-cos-ota.md) |
| 1.2.6 | — | 整包 | `v1.2.6` | ✅ | [加固](./release/hardening-1.2.6.md) |
| 1.2.5 | — | 整包 | `v1.2.5` | ✅ | 五端壳 |

## 线上产物

| 通道 | URL |
| --- | --- |
| OTA manifest | https://jou-d4gq7a3cqf51e6caa-1394316826.tcloudbaseapp.com/ota/manifest.json |
| 整包 update.json | https://jou-d4gq7a3cqf51e6caa-1394316826.tcloudbaseapp.com/update.json |
| 学生端 APK 1.2.19 | https://jou-d4gq7a3cqf51e6caa-1394316826.tcloudbaseapp.com/downloads/SunshineCampus-User-1.2.19.apk |

## 维护约定

1. 每次发版先改 `docs/CHANGELOG.md`，再打 `app-x.y.z` 标签并 `gh release create`。  
2. **仅界面** → OTA；**原生插件/权限/FocusLock** → 整包 APK。  
3. 养成数值始终服务端 RPC 权威；图鉴解锁/对战进度若仍本地，须在 CHANGELOG 注明。
