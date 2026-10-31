# 哦狐 iOS 打包材料与交付 · 1.2.131

本次准备学生端、管理端两套独立 iOS 工程及专用界面资源，版本 1.2.131，构建号 131。Android 使用 `.apk`，iOS 的可安装归档为 `.ipa`。当前 Windows 电脑没有 Xcode，也没有已配置的云端 macOS 构建与 Apple 签名材料，因此此次交付工程 ZIP，**尚未生成、签名或上架 IPA**。

材料暂不具备的项目按要求留空。请在自己的 Apple 后台、云构建的 Secrets 或本地受控文件中补齐；本表不填写密码、私钥正文。

## 待补材料

| 材料 | 待填值 / 安全保存位置 |
| --- | --- |
| Apple Developer 账号主体 | |
| Apple Developer Program 有效状态 / 到期日 | |
| Apple Team ID | |
| 学生端已注册 Bundle ID | |
| 管理端已注册 Bundle ID | |
| 学生端 App Store Connect App ID | |
| 管理端 App Store Connect App ID | |
| 发布方式：TestFlight / App Store / 指定设备测试 | |
| Apple Development 或 Apple Distribution 证书文件位置 | |
| 含私钥的 `.p12` 文件安全保存位置 | |
| `.p12` 密码所在 Secrets 名称 / 密码管理器位置 | |
| 学生端 `.mobileprovision` 文件位置 | |
| 管理端 `.mobileprovision` 文件位置 | |
| 指定设备测试所需 iPhone / iPad UDID 清单位置 | |
| 学生端 TestFlight 邀请链接 | |
| 管理端 TestFlight 邀请链接 | |
| 学生端 App Store 链接 | |
| 管理端 App Store 链接 | |
| macOS 构建提供方 / 仓库 / 构建环境 | |
| Xcode 版本 / iPhoneOS SDK 版本 | |
| 如需自动上传：App Store Connect API Key ID | |
| 如需自动上传：Issuer ID | |
| 如需自动上传：`.p8` 私钥安全保存位置 | |
| 后续如接云推送：APNs Key ID / Team ID | |
| 后续如接云推送：APNs `.p8` 私钥安全保存位置 | |
| 隐私政策地址 / 支持地址 | |
| 商店截图 / 最终图标 / 描述 / 联系方式 | |
| 隐私披露、年龄分级、审核测试账号 | |
| 当前 iOS 上架状态 | |

工程暂用学生端 `com.sunshinecampus.app`、管理端 `com.sunshinecampus.admin`，显示名分别为“哦狐”“哦狐·管理”。这些是项目配置，**不代表已在 Apple 账号中注册或具有使用资格**。两端必须使用分别匹配的描述文件；请先补齐上表中实际登记的标识。

## 交付目录

- `Ohhu-iOS-1.2.131-131.zip`：同一份独立构建源码、两套 Xcode 工程、两套专用 Web 资产、原生 vendor 依赖及许可证、手动云构建工作流。
- 学生工程：`ios-user/App/App.xcodeproj`；管理工程：`ios-admin/App/App.xcodeproj`。
- `ios-tools/build-ios-web.mjs`：显式选择 `--shell user` 或 `--shell admin`，管理端继续使用独立入口与学生模块排除检查。
- `ios-tools/native-build.mjs`：未签名编译检查与签名 IPA 导出分开；材料缺失直接报错，不产生“已打包成功”的假结果。
- `ios-tools/verify-ios.mjs`、`ios-patch-audit.json`：检查端别、标识、界面资产哈希、iOS 更新隔离及源工程未被改动。

ZIP 不包含原项目 `.env`、Android 工程、Android 签名密钥、Apple 证书、`node_modules`、云数据库备份或个人业务导出。vendor 已带原生插件源码与许可证；Xcode 首次仍需联网解析 Capacitor、插件上游 Swift 依赖及 freeRASP 的二进制依赖。重新构建界面还需先执行 `npm ci --no-audit --no-fund`。

## 已做的 iOS 平台适配

- 安装更新只接受自行配置的 Apple 官方 TestFlight / App Store HTTPS 链接，空着时明确提示待配置，不查询 Android 的 `update.json`，不下载 APK。
- iOS 界面热更新当前关闭，不访问 Android OTA，不自动安装共享热更；另建 iOS 渠道并验收后再考虑启用。
- 空 Team ID 时不启动 freeRASP；填入有效 Team ID 后采用当前真实 Bundle ID，不把管理端当成学生端。
- iOS 课程铃声使用系统通知声音；独立震动以 iPhone 系统设置为准，不能照搬安卓通知渠道与后台守护。排程容量、窗口与实际回传数量见包内提醒检查说明。
- 项目现有哦狐图标用于工程，商店最终宣传材料仍留空。

快递当前保留平台网页入口。安卓专用的跨 App 直达、常驻提醒守护、系统闹钟方式与桌面悬浮提醒不会宣称在 iPhone 生效。没有配置 APNs 云提醒；iOS 提醒需完成实机锁屏、划掉任务、静音与专注模式验收，Windows 的界面检查不能替代这些结论。

## 使用云 Mac 或已有 Mac 编译

不必购买实体 Mac，但最终编译需要可运行 Xcode 的 macOS 环境。解压后安装 Node.js 24，并使用带 **iOS 26 或更新 SDK** 的 Xcode。最低运行目标 iOS 15 与编译 SDK 是不同概念；当前提交要求以 Apple 公告为准，脚本会打印并检查实际 SDK。[Apple 提交要求](https://developer.apple.com/news/upcoming-requirements/?id=04282026a)

未签名编译与打包（仍不能直接安装）：

```sh
npm ci --no-audit --no-fund
node ios-tools/build-ios-web.mjs --shell user
node ios-tools/native-build.mjs --shell user --mode unsigned
```

管理端把 `user` 改成 `admin`，产物分别进入 `build/user`、`build/admin`。只有 macOS 上真正编译成功，脚本才会核对实际 `Release-iphoneos/App.app` 的标识、版本及构建号，打包为 `Ohhu-user-1.2.131-131-unsigned.ipa` 或对应管理端文件，并解包复核 Payload。该文件仍未签名，收据明确写 `signed:false`、`installable:false`，可作为后续本人账号签名工具的输入，不能直接安装。**本次 Windows 交付没有执行这一过程，所以 ZIP 内没有现成 unsigned IPA。**

也可直接用 Xcode 打开对应 `.xcodeproj`，等待 Swift 包解析；没有使用 CocoaPods，不要误打开不存在的 `.xcworkspace`。重新生成界面应使用本包脚本，直接 `cap sync` 会覆盖本包专用 vendor 引用与配置。

签名导出需在环境变量或云端 Secrets 填入：`IOS_TEAM_ID`、`IOS_CERTIFICATE_P12_BASE64`、`IOS_CERTIFICATE_PASSWORD`，以及对应的 `IOS_PROFILE_USER_BASE64` / `IOS_PROFILE_ADMIN_BASE64`。再使用同一 Team ID 重建对应端界面，执行 `native-build.mjs --mode signed`。脚本核对描述文件的 Team、Bundle ID、有效期和发布方式，并在导出后检查签名与 IPA 哈希；不自动上传商店。证书类型和权限要求见 [Apple 证书说明](https://developer.apple.com/help/account/certificates/certificates-overview)。

## Windows 发起 GitHub macOS 构建

把解压后目录的**内容**放在自己授权的仓库根目录，保留 `.github/workflows/ios-build.yml`。该工作流只接受手动运行；本次没有创建远程仓库，也没有触发云构建或付费任务。

在仓库 Actions 中手动选学生端或管理端、`unsigned` 或 `signed`。默认是未签名编译；签名模式必须先配上段 Secrets。可选 Variables 为两端各自的 `IOS_APPSTORE_USER_URL`、`IOS_APPSTORE_ADMIN_URL`、`IOS_TESTFLIGHT_USER_URL`、`IOS_TESTFLIGHT_ADMIN_URL`，留空即显示待配置，不回退另一个端的链接。自行在 Mac 运行时，可用 `IOS_APPSTORE_URL`、`IOS_TESTFLIGHT_URL` 设置当前选中端的链接。工作流从 runner 已安装的 Xcode 中选择满足 SDK 要求的版本；没有合适版本就失败，不会降低要求假称可上传。

工作流成功后才会上传本次结果。`unsigned` 模式提供经过实际 App 身份与 Payload 复核的 `*-unsigned.ipa`，还需本人签名；`signed` 模式只有证书与导出包校验通过，才提供签名 IPA。未签名云构建不要求提供 Apple `.p12`，也不会把已有付费 Team ID 写入该构建。临时签名文件与钥匙串由脚本清理。签名 Secrets 的组织方式参考 [GitHub 官方 Xcode 签名示例](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications)。

## 仅个人 iPhone 测试的另一条路线

若暂时没有付费 Apple Developer 账号或发布证书，可先用上述云 Mac 路线取得真实 `*-unsigned.ipa`，再在 Windows 上使用本人 Apple ID 的签名工具自行签名安装。Sideloadly 官方提供 Windows 版本及免费 Apple ID 方式，免费签名通常需要每 7 天续签，并受 Apple 的账号、设备、能力与数量限制；它不能替代前面的 Xcode 编译。[Sideloadly 官方说明](https://sideloadly.io/)

长期给其他用户分发，仍建议准备正式 Apple 材料并走 TestFlight 或 App Store；指定设备测试还需匹配的设备清单和描述文件。企业签名只适用于符合资格的组织内部场景，不能视为公共分发方案。TrollStore 依赖特定历史 iOS 版本，不能作为所有 iPhone 的通用安装方式；是否支持以其官方列表为准。[TrollStore 官方仓库](https://github.com/opa334/TrollStore)

AltStore、SideStore、LiveContainer 等属于各自的安装或运行流程，不代表已有本项目 IPA。本次没有替用户安装、运行或购买这些工具，没有执行越狱，也没有把任何已上架应用案例当成哦狐的上架证明。

Xcode Cloud 也可以作为以后选择，但首次工作流需要从 Xcode 配置，不能把未创建的 Apple 项目当成已能从 Windows 网页直接构建。本次未配置 Xcode Cloud。[Apple 首次工作流说明](https://developer.apple.com/documentation/xcode/configuring-your-first-xcode-cloud-workflow)

AppUploader 等辅助上传或证书工具不能代替 Xcode 编译，也不能将 APK 转成 IPA。Android 的发布与本次工程交付是独立的；拿到有效 Apple 材料及可执行的 macOS 构建环境后，才能继续签名、真机验收与提交。
