# 哦狐 F-Droid 上架准备与阻塞记录

更新时间：2026-10-31（Asia/Shanghai）
目标：F-Droid 官方主仓库（不是仅生成一个 APK 或自建仓库）
当前 Android 来源：[`wht66667-eng/ohu`](https://github.com/wht66667-eng/ohu)，公开 `main`，当前应用版本 `1.2.146`（versionCode `146`），学生包名 `com.sunshinecampus.app`。

## 当前结论

**尚未提交收录申请，也不应把当前 APK 直接提交当作上架。** F-Droid 官方主仓库要求以可公开审查的源码构建，并检查整套应用、依赖和素材许可。哦狐仓库当前没有根目录许可证或任何被 Git 跟踪的 `LICENSE` 文件；著作权人尚未为公众授予复制、修改和再分发代码的许可。这是首要阻塞，不能替著作权人擅自选许可证。

除此之外，哦狐学生端使用账号、CloudBase 数据库／存储、教务代理和哦狐服务端接口。F-Droid 需要审查这些服务依赖及是否应标记 `NonFreeNet`／`TetheredNet`；不能承诺主仓库一定接受。学生端 APK 还需在 F-Droid 的构建环境完成源码构建，并核对所有前端、原生库、插件、图像、字体及词库素材的许可证与再分发权。

## 已核验事实

- GitHub 仓库公开，默认分支 `main`；本轮 F-Droid 构建隔离及审计资料已推送到 `main`，提交 `2e07b60`（已通过 `git ls-remote` 核对远端引用）。
- Android 学生应用 ID 为 `com.sunshinecampus.app`；管理端 ID 为 `com.sunshinecampus.admin`。首轮申请目标应限学生端，不申请管理端。
- 已新增 `fdroid` Android build type 和独立学生端准备脚本 `tools/prepare-fdroid-android.mjs`。脚本将 Android 工程复制到忽略目录 `android-fdroid/`，从副本的 Capacitor 插件清单及 Gradle 文件中剔除 Capgo updater、freeRASP/Talsec 和 Google Services 配置，不改普通 APK 的原生依赖清单。`fdroid` build type 使用 release 依赖匹配、关闭签名及 shrink，以便 F-Droid 自己签名。
- 已运行 `npm run build:app -- --shell user --fdroid`，并用生成副本完成 `:app:assembleUserFdroid` 本地构建。产物是未签名 APK：`android-fdroid/app/build/outputs/apk/user/fdroid/app-user-fdroid-unsigned.apk`；Gradle 输出元数据确认为 `com.sunshinecampus.app`、`1.2.146`、versionCode `146`。SHA-256：`329830F1DAD7B493E661A1EC6886CE053406AAE2BBC452E614D1E620817AC188`。这是本机 Windows 构建结果，不等同于 F-Droid buildserver 的干净、可复现构建，也不是可直接发布的签名包。
- F-Droid Web bundle 已通过字符串扫描：包含专用“此构建不使用哦狐热更新”提示；未发现 `fetchOtaManifest`、Capgo 更新地址／标识或 `capacitor-freerasp`／Talsec 代码字符串。生成的 Android staging 副本中也未检出这些插件的 Gradle 注册项。该扫描只覆盖已知标识，不替代完整 SBOM 和人工许可审核。
- 为适配本机 Android Gradle 变体，`android/app/build.gradle` 的 F-Droid build type 设置 `matchingFallbacks = ['release']`；普通 `release` 配置不变。当前 Windows 用户级 Gradle 配置将代理指向无人监听的 `127.0.0.1:7897`，本次构建通过一次性 Gradle init 脚本将依赖下载改走可用的 `127.0.0.1:7892`；项目构建文件未写入代理地址。
- Android 应用构建依赖 Vite/Capacitor 生成 Web 资源；F-Droid 的最终配方需要在受控构建准备阶段取得锁定版本的 npm 源码依赖，并确保 Gradle 构建阶段不下载未经核验的二进制。
- 项目保留 Capgo 原生 OTA 更新器。配置 `autoUpdate: false`，且源码更新函数由设置页／更新页显式触发下载；但 F-Droid 政策要求下载额外可执行内容时有明确 opt-in，并解释这会绕过 F-Droid 的代码检查。应为 F-Droid 构建禁用 OTA，或经维护者确认后提供满足该政策的显式警告流程。
- 当前 Capacitor Android 插件列表同时包含 Talsec freeRASP 和 Capgo updater。freeRASP 插件仓库的桥接层为 MIT，但它会从 Talsec Maven 仓库依赖 `TalsecSecurity-Community-Capacitor:19.2.3`；Capgo updater 还依赖 `com.google.android.gms:play-services-tasks`、`com.google.android.play:app-update`／`app-update-ktx`。官方政策明确排除专有 Google Play Services／Firebase 等库；因此 F-Droid 学生 variant 必须同时从 Web bundle 与原生依赖图中移除这些插件，不能只隐藏“检查更新”按钮。
- Android `build.gradle` 声明 Google Services 插件，但只有存在 `google-services.json` 时才应用；仓库不应依赖私有 Firebase 配置。尚未在 F-Droid 环境验证该条件构建。
- 源码搜索没有发现 Firebase Analytics、Crashlytics、广告或常见商业统计 SDK 的应用调用；这只是初步搜索，不替代完整依赖扫描。
- 仓库当前没有 F-Droid 所需的许可证选择、素材许可证清单、`fastlane/metadata/android` 商店资料、F-Droid 构建元数据或已验证的可复现构建记录。
- 新增自动盘点脚本 `tools/fdroid-license-inventory.mjs` 及报告 [`F-DROID-LICENSE-INVENTORY.md`](./F-DROID-LICENSE-INVENTORY.md)：锁定 396 个 npm 包中有 2 个缺少 `license` 元数据（`@cloudbase/signature-nodejs`、`@cloudbase/wx-cloud-client-sdk`），66 个包根目录未见常见许可证文件名，另有包声明多许可证选项；192 个 `public/` 文件逐项列入素材清单但均待人工核验来源与再分发权。报告仅作自动初筛，不能作为合法授权证明。
- `public/` 下有 192 个文件；未发现统一的插图、品牌图、地图数据、词库和字体来源／许可证清册。应用当前使用的狐狸形象和校园宣传图需确认著作权及分发授权；不能只依赖代码许可证覆盖素材。
- 当前 `git tag --list` 与 GitHub Releases 均未发现版本标签／发行记录；提交前需建立与源码及 APK versionCode 对应的不可变上游版本标签。
- 当前电脑未安装 `glab`，因此无法从 GitLab CLI 登录或代表账号提交 RFP issue／fdroiddata 合并请求。GitHub CLI 登录不等于 GitLab 授权。

## F-Droid 官方规则参考

- [Inclusion Policy](https://fdroid.gitlab.io/jekyll-fdroid/en/docs/Inclusion_Policy/)：代码、依赖与资产须符合自由软件收录政策；主仓库从公开源码构建。
- [FAQ for App Developers](https://fdroid.gitlab.io/jekyll-fdroid/en/docs/FAQ_-_App_Developers/)：整个应用及其依赖都要符合许可要求；仅有 APK 不够；源码、构建产物和资产许可需对应。
- [Submitting to F-Droid Quick Start Guide](https://fdroid.gitlab.io/jekyll-fdroid/en/docs/Submitting_to_F-Droid_Quick_Start_Guide/)：可向 `fdroid/rfp` 提交打包请求，或向 `fdroiddata` 提交带构建元数据的合并请求。
- [Build Metadata Reference](https://fdroid.gitlab.io/jekyll-fdroid/docs/Build_Metadata_Reference/)：应用 ID、仓库、版本、构建指令与反特性通过元数据描述。
- [Anti-Features](https://fdroid.gitlab.io/jekyll-fdroid/en/docs/Anti-Features/)：包括 proprietary network service 和难以替换的网络服务等需要透明标记的情形。

## 提交前工作清单

| 项目 | 状态 | 完成条件 |
|---|---|---|
| 著作权人选择并提交应用许可证 | **阻塞：须由著作权人决定** | 在仓库添加准确 SPDX 许可证文本，并确认所有贡献者／素材均有再授权权利 |
| 依赖与素材 SBOM／许可证盘点 | **自动初筛已完成；人工核验未完成** | 396 个 npm 包、192 个 public 文件已生成 CSV；识别 2 个缺许可元数据包、66 个无常见许可证文件名的包；仍需确认最终 APK 依赖闭包、每个包及素材的上游许可和再分发权 |
| 服务依赖与隐私／反特性说明 | 未开始 | 列明登录、CloudBase、教务及其他后端；确定离线／替代服务能力和需申报的 F-Droid Anti-Features |
| F-Droid 专用学生构建变体 | **本地实现并构建通过；F-Droid buildserver 待验** | 学生包 `userFdroid` 不含管理端、不含签名；Web 与 staging Android 副本移除 Capgo/Talsec；显示 F-Droid 构建不使用哦狐热更新；本地 unsigned 产物及 hash 已记录 |
| F-Droid 构建配方 | 未开始 | `fdroiddata` build metadata 与 npm/Gradle 离线依赖来源未准备；需从干净检出在 F-Droid buildserver 完成配方和可复现性验证 |
| 版本标签与上游源码归档 | 未开始 | 发布不可变 Git tag，源码归档、版本号、versionCode 和产物身份一致 |
| 商店文案及截图 | 未开始 | 完成 `fastlane/metadata/android` 文案、图标、真实截图、更新日志与联系方式 |
| GitLab 提交身份 | **阻塞：本机未配置 GitLab CLI 登录** | 用户登录 GitLab 后，由已授权账号提交公开 RFP issue 或 fdroiddata MR |
| F-Droid 审核与发布 | 未开始 | 维护者接受打包、构建与政策审核后合并并发布；时间由 F-Droid 决定 |

## 许可证选择说明

本文件不代替软件许可证，也没有改变代码授权。常见选择包括：

- **Apache-2.0**：允许广泛复制、修改和再分发，并包含明确专利条款；衍生作品可采用其他许可证。
- **GPL-3.0-or-later**：允许复制、修改和分发，但分发衍生版本时须按 GPL 继续提供对应源码和相同自由度。
- **AGPL-3.0-or-later**：在 GPL 条款外，针对修改后通过网络提供服务的情形增加源码提供要求。

选择取决于著作权人的授权意图，且必须先核对项目贡献和素材许可兼容性。添加许可证会向公众授予广泛的法定使用权，不能仅为过审而随意挑选。

## 提交流程

1. 解决上面的许可证和来源清单阻塞。
2. 完成仅包含学生端、无私密配置的 F-Droid build variant；不改变现有用户 APK 的签名、包名或发布通道。当前已有本地 unsigned 产物，不代表 F-Droid 签名或正式发行。
3. 在 Linux/ASCII 路径下使用 F-Droid buildserver 做干净构建；解决 npm/Gradle 依赖的离线获取方式，记录工具版本、完整日志、APK SHA-256，并检查生成包的包名／versionCode／权限／依赖。
4. 完成应用商店文案、图标、截图和来源标注。
5. 使用 GitLab 账号向 [Requests for Packaging](https://gitlab.com/fdroid/rfp/-/issues/) 提交学生端打包请求；或准备 [fdroiddata](https://gitlab.com/fdroid/fdroiddata) 元数据合并请求。
6. 按维护者意见修复问题；审核完成并进入官方仓库前，官网只能写“申请中”，不得写“已上架”。

## 账号更新方式

F-Droid 使用其维护的签名密钥分发仓库版本。它与哦狐当前下载页提供的开发者签名 APK 使用的签名不同，用户通常不能直接覆盖安装；需在首次从 F-Droid 安装时迁移，并在产品说明中清楚提示。不得把开发者签名 APK 的签名块伪装成 F-Droid 的构建产物。
