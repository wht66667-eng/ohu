# 哦狐三端发布与更新

继续使用现有功能、账号、管理员权限和云端数据。电脑后台与手机管理端均保留完整管理功能；学生端保留现有校园功能。

| 入口 | 使用方式 | 更新方式 |
| --- | --- | --- |
| 电脑后台 | 浏览器访问 `/admin`；本地双击 `启动电脑后台.cmd` | 发布网页后重新加载 |
| 手机管理端 | `SunshineCampus-Admin-版本.apk`，包名 `com.sunshinecampus.admin` | 管理 APK 与 `/ota/admin/manifest.json` |
| 手机学生端 | `SunshineCampus-User-版本.apk`，包名 `com.sunshinecampus.app` | 学生 APK 与 `/ota/user/manifest.json` |

电脑打开网站首页会进入后台；学生网页预览可用 `/?view=student`。后台消息、通知、通讯录和设置会保留 `/admin/...` 地址。后台页面与接口继续要求现有的管理员或站长权限。

## 本地启动

依赖已安装。新电脑先执行 `npm ci`。

双击 `启动电脑后台.cmd`，保持窗口打开，访问 `http://127.0.0.1:43123/admin`。使用现有账号登录；这是本机预览地址。

手机 APK 沿用 `android/keystore/sunshine-release.jks` 原签名。密码通过进程环境 `SUNSHINE_STORE_PASSWORD` / `SUNSHINE_KEY_PASSWORD` 或被 Git 排除的 `android/keystore/release-signing.properties` 提供。现有本机配置已迁入该文件。不要把密钥目录放入网站、ZIP 或交付源码；工具不会生成替代密钥。

## 一键准备

双击 `准备三端发布.cmd`，或执行 `npm run release:prepare`。

依次检查类型、构建网站、生成并校验两个 APK、准备两端 OTA，最后生成 `.release-out/release-packet.json`。该操作只写本地产物，不上传、不修改云端数据。

| 本地产物 | 内容 |
| --- | --- |
| `.release-out/apk/版本-构建号/` | 学生 APK、管理 APK、校验记录 |
| `.release-out/web-upload/` | 电脑后台与现有 H5 网页，不含手机更新清单 |
| `.release-out/apk-upload-assets/downloads/` | 通过校验的 APK 下载文件 |
| `.release-out/apk-upload-manifest/update.json` | 与两个 APK 一致的版本、下载地址和 SHA-256 |
| `.ota-out/prepared/user/版本-构建号/` | 学生 OTA 清单 |
| `.ota-out/prepared/admin/版本-构建号/` | 管理 OTA 清单 |
| `.ota-out/bundles/user/`、`.ota-out/bundles/admin/` | 包含版本、构建号和校验码的不可变 ZIP |

单独打包可双击 `生成手机安装包.cmd`；单独准备 OTA 可双击 `准备双端热更新.cmd`。APK 与 `dist-app` 隔离，不能被打进界面更新 ZIP。

## 验证与正式发布

先在手机验证全新安装或覆盖安装、原有账号登录与业务操作。学生包不能覆盖管理包；同一端覆盖升级保持原包名与签名。

`npm run test:release` 执行核心回归检查。`npm run release:publish:plan` 显示目标环境与上传顺序，仍不上传。

确认产物后，`npm run release:publish` 会实际上传，需要本机已安装并登录目标环境的 CloudBase `tcb` 命令。它重新校验 APK/ZIP，然后先上传安装包和 ZIP，再上传网页，最后切换版本发现清单。

网页独立发布使用 `npm run build:web`、`npm run deploy:hosting`。网页部署会排除 `update.json`、`downloads/`、`ota/`，避免用随包兜底版本覆盖手机更新。两端 OTA 仍可独立发布。

## 后续升版本

整包发布先执行 `python tools/patch-version.py 新版本 新构建号`。本轮整理版为 `1.2.123 / 123`，下一版示例为 `1.2.124 124`。脚本同步 package、锁文件、Android、Capacitor、Web 元数据；构建号必须高于手机已装版本，不要覆盖已分发的同号产物。

仅界面更新时，递增 `src/lib/app-version.ts` 的 `WEB_VERSION` / `WEB_BUILD`，保持 package.json 与锁文件版本一致，保留 Android 原生版本。先用 `npm run ota:prepare` 准备，验证后用 `npm run ota:upload -- --shell both --skip-recompress` 上传。默认最低原生构建号来自 Android 工程；只在确认旧壳兼容后用 `--min-native-build` 放宽。

安装包版本取自 Android；界面版本取自当前 Web 包。同号界面修复需要递增 Web 构建号。低于最低原生版本的手机会被引导先升级 APK。切包后在可用页面挂载时确认就绪，下载完成不代表启动成功。

## 验证边界

本轮检查覆盖三端入口、权限门禁、下载分流、原生/界面版本分离、同号修复、精确缓存匹配、回滚、目录保护和网页部署隔离。浏览器已查看登录、桌面布局和窄屏菜单；管理布局测试采用隔离身份，不代表已用真实账号完成线上增删。

手机安装、通知权限、真实 OTA 切包仍需真机验证。线上清单本轮未修改，本地打包成功不代表已经线上发布。
