# 哦狐 Flutter 学生端

全新用户体系的 Flutter 学生端，Android 优先，后续适配 iPhone。管理端与官网继续为网页。

> 状态：S2 阶段骨架。业务功能按 S3/S4/S5 分阶段迁移；全部现有功能迁移完成后才开放用户内测。

## 环境

- Flutter 3.47.9 / Dart 3.13.7（SDK: `C:\flutter`）
- 包名：`cn.ohu.app`（与旧 Capacitor 包 `com.sunshinecampus.app` 隔离，避免数据串号）
- CloudBase 环境：`jou-d4gq7a3cqf51e6caa`

## 目录

```
lib/
  app/              # 启动、路由、主题、依赖组装
  core/
    auth/           # 新用户、会话代次、登录门禁
    network/        # 认证 HTTP、统一错误、取消、超时、追踪
    storage/        # 安全令牌、本地数据库（按用户与代际分桶）
    ui/             # 通用状态、无障碍、弹层
  features/
    home/ services/ messages/ discover/ account/   # 五个底部主入口
    schedule/ grades/ exams/ physical/ chaoxing/ todos/ focus/ english/ ai/
    friends/ chat/ moments/ plaza/ meet/ campus_map/ plugins/ companion/ moderation/
android/            # 原生服务、接收器、权限与渠道
ios/                # 后续适配
test/               # 单元与 Widget 测试
```

## 开发命令

```bash
flutter pub get
dart analyze lib test      # 静态分析（路径含括号时用 dart analyze 而非 flutter analyze）
flutter test               # 单元与 Widget 测试
flutter build apk --debug  # Android 开发构建
```

### Windows 中文路径构建说明

本仓库路径含中文字符（`新建文件夹 (4)`），Android Gradle Plugin 与 CMake/NDK 不支持非 ASCII 路径，
会导致 `libdartjni.so` 构建失败。已在 `android/gradle.properties` 设置
`android.overridePathCheck=true`，但 CMake 仍需从 ASCII 路径构建。

**本机构建方法**：创建目录联接后从联接路径执行：

```powershell
# 仅需执行一次
New-Item -ItemType Junction -Path "C:\ohu_flutter" `
  -Target "C:\Users\upwar\Desktop\新建文件夹 (4)\flutter_app"

# 之后所有 Flutter 命令从 C:\ohu_flutter 执行
cd C:\ohu_flutter
flutter build apk --debug
```

CI（Ubuntu）路径无此问题，直接构建即可。

## 状态管理

全工程统一使用 [Riverpod](https://riverpod.dev/)，不混用其他方案。路由使用 `go_router`。

## 主题

三套主题功能完全一致，仅 token / 图标 / 插画密度不同：经典狐狸版、微绿版（默认）、简单版。

## 安全边界

- 客户端仅使用公开初始化配置与当前用户 token；管理密钥、数据库连接、签名材料留在服务端或 CI 凭据库。
- 本地数据库按用户 UID 与会话代次分桶，退出后旧请求不回写。
- HTTP 200 不等于业务成功；非 JSON 响应视为网关配置错误。

## 依赖与未完成项

- S1（新身份/权限与备份可恢复性）尚未完成，认证仓库的远程调用以 TODO 标注，需在 S1-01 验证同环境 Auth 重新注册机制后接通。
- NFC（S2-06）、原生桥（提醒/相册/小组件，S2-05）待后续在 `packages/ohu_native_bridge` 中实现。
