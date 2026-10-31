# 红队测试方案 · 阳光校园（自有系统）

> 日期：2026-10-13
> 范围：**仅限自有系统**（自有 App / 自有后端 / 自有云环境 `jou-d4gq7a3cqf51e6caa`）
> 方法：静态代码审计（已完成）+ 模拟器/真机动态验证（待执行）
> 本文不做任何未经授权的第三方系统测试。

---

## 0. 结论先行：把那份 7 层清单映射到真实攻击面

原始清单列了 7 层攻击手段，但**对本项目的实际威胁等级与直觉完全不同**。先给结论：

| # | 清单里的层 | 本项目是否有有效靶子 | 依据 | 优先级 |
| :-- | :--- | :--- | :--- | :--- |
| ① | 框架基础 Magisk/Zygisk/LSPosed/LSPatch/Shamiko | **无靶子** | 项目无 root 检测、无完整性校验、无模拟器检测；所有校验点都不依赖设备环境 | P3 |
| ② | 环境隐藏 Shamiko/HideMyApplist/PropSpoof/DevHook | **无靶子** | 没有检测要骗（同 ①）。`HideMyApplist` 针对"检测已装可疑包"，本项目无此逻辑 | P3 |
| ③ | 定位伪造 LocationSpoofer/FakeLocation/GPS-Joystick | **无靶子** | `ACCESS_FINE_LOCATION` 虽在 Manifest，但代码内唯一用途是 `src/lib/weather.ts` 取天气经纬度；**没有定位签到/打卡** | P3 |
| ④ | 传感器伪造 SensorHook/SensorInjector/StepHook | **有靶子，但当前影响为零** | `src/lib/health.ts` 步数**只写 localStorage、不上云**，不参与任何共享排名或积分。伪造只骗到用户自己 | P3（一旦上排行榜/积分立刻升 P0） |
| ⑤ | 摄像头/人脸绕过 CameraHook/FaceBypass/ScreenCaptureInject | **不适用** | 项目无相机采集、无活体检测（全库无「活体」「人脸」命中） | 不适用 |
| ⑥ | 辅助工具 Frida/Objection/SSLUnpinning | **P0 靶子** | 但**不需要 unpinning**：出 debug 包即可直连抓包 | P0 |
| ⑦ | 模拟器专用 内核字符串抹除/硬件伪装 | **无靶子** | 同 ①。反过来讲：**在 MuMu 里能正常跑起来，本身就是"无模拟器检测"的证据** | P3 |

**一句话**：清单里 5 层（①②③⑤⑦）对当前代码是空靶，因为本项目**没有做设备环境校验**。真正的高危面不在清单里，而在下面这四类。

### 真正的高危攻击面（本方案重点）

本 App 是 `Capacitor WebView + CloudBase JS-SDK 直连` 架构，信任边界落在**客户端直连数据库**上。

| 编号 | 攻击面 | 一句话风险 | 优先级 |
| :-- | :--- | :--- | :--- |
| **A** | **自提权** | `profiles.is_admin` / `is_super_admin` 是前端直接读的字段，若 RLS 未做列级限制，普通用户可把自己的档案改成管理员 | **P0** |
| **B** | **双壳绕过** | 学生端与管理端**共用同一份 web 产物**，管理端路由就在学生包里；`window.__SC_SHELL__` 是唯一的运行时开关 | **P0** |
| **C** | **越权直连读写** | 前端用 JS-SDK 直接读写集合，RLS 一旦有缺口即可横向读他人数据 | **P0** |
| **D** | **教务凭据** | 教务系统密码以 **localStorage 混淆**方式落盘（非加密），可逆还原 | **P1** |

`docs/admin-permissions.md` 里已经写明原则——「服务端以 `is_admin_user()` / `is_super_admin_user()` 为准；前端开关只做入口隐藏，**不能当作安全边界**」。本方案的作用就是**验证这句原则在 RLS 与 RPC 层面是否真的成立**。

---

## 1. 测试边界与红线

必须遵守，否则测试本身会变成事故：

1. **只在测试环境或测试账号上执行**；生产库只做只读探测，不做写入。
2. **自提权类用例（RT-01/02）完成后立即还原原值**，并在记录表里写明改前值、改后值、还原时间。
3. **不批量导出真实用户数据**。越权读用例只取 1 条并脱敏记录，不落盘原始内容。
4. **不做拒绝服务**，不做压力/并发轰炸。
5. **教务相关用例只用测试账号**的教务凭据，绝不使用真实同学的。
6. 本文档及测试产物**不提交到公开仓库**；`docs/audit/` 已在仓库内，若仓库有外部协作者，建议移入 `docs/audit/_private/` 并加入 `.gitignore`。

---

## 2. 环境搭建

> 核心原则：**能不动 root / LSPosed 就别动。** 自有系统测试用官方通道可复现、可回归、成本低一个数量级。清单里的 Magisk+Zygisk+LSPosed+LSPatch+Shamiko 那一整套，本项目**没有使用场景**。

### 2.1 三条测试通道（按性价比排序）

| 通道 | 成本 | 覆盖能力 | 建议 |
| :--- | :--- | :--- | :--- |
| **T1 · 浏览器 H5** | 最低 | 直改 localStorage、DevTools 断点、直调 SDK —— 覆盖约 80% 用例 | **优先用这条** |
| **T2 · MuMu 模拟器 + ADB** | 中 | 验证 WebView 真实行为、原生插件（计步）、改包重签 | 补充 |
| **T3 · 真机 debug 包** | 中 | 抓包、真实传感器路径 | 仅在 T1/T2 无法复现时 |

### 2.2 T1 · 浏览器通道

```bash
cd <repo>
npm run dev          # Vite dev server
```

打开 DevTools，Console 里可直接操作与 App 完全相同的存储键：

```js
// 查看全部运动/打卡/凭据相关键
Object.keys(localStorage).filter(k => /xm_sports|campus\.gate|credSkip|ohhu/.test(k))

// 例：确认步数是纯本地（预期能看到 xm_sports_daily.v2:uid:<uid>）
localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('xm_sports_daily')))
```

这条通道能验证 RT-01 到 RT-11 的绝大部分，且不需要任何模拟器。

### 2.3 T2 · MuMu 模拟器 + ADB

**已知环境（本次实测）**

| 项 | 值 |
| :--- | :--- |
| MuMu 安装目录 | `D:\Program Files\Netease\MuMu` |
| MuMu 自带 adb | `D:\Program Files\Netease\MuMu\nx_main\adb.exe` |
| Android SDK adb | `C:\Users\upwar\AppData\Local\Android\Sdk\platform-tools\adb.exe` |
| 当前状态 | 模拟器实例**未启动**（只有 `MuMuNxMain` 界面进程 + `MuMuNxService`） |

**步骤**

```bash
ADB="C:/Users/upwar/AppData/Local/Android/Sdk/platform-tools/adb.exe"

# 1) 先启动 MuMu 模拟器实例（等进入桌面）
# 2) 连 ADB —— MuMu 端口按版本不同，逐个试
for p in 16384 7555 21503 5555; do
  $ADB connect 127.0.0.1:$p 2>&1 | grep -q connected && echo "命中端口: $p" && break
done

# 3) 确认
$ADB devices -l
$ADB shell getprop ro.product.model          # 顺便记录：这是"无模拟器检测"的基线证据
$ADB shell getprop ro.build.version.release
```

**装包与包名**

| Shell | 包名 |
| :--- | :--- |
| 学生端 | `com.sunshinecampus.app` |
| 管理端 | `com.sunshinecampus.admin` |

```bash
$ADB install -r android/app/build/outputs/apk/user/debug/app-user-debug.apk
```

> **必须用 debug 变体。** 理由是 debug 包可以 `run-as` 读应用私有目录（拿 localStorage 落盘文件）、且不带 pinning —— 直接省掉清单第 6 层的 SSLUnpinning / Frida 一整套。

**读 WebView 的 localStorage（debug 包专用）**

```bash
PKG=com.sunshinecampus.app
$ADB shell run-as $PKG ls -R /data/data/$PKG/app_webview/Local\ Storage/leveldb/ 2>/dev/null
$ADB shell run-as $PKG cat "/data/data/$PKG/app_webview/Local Storage/leveldb/000005.ldb" | strings | grep -a jwPassword
```

### 2.4 官方 mock 通道（如果将来要做定位/传感器类用例）

**这些是 Android 官方的测试接口，不需要 Root、不需要 LSPosed**：

```bash
PKG=com.sunshinecampus.app

# 定位：授予 mock location 权限（官方测试做法）
$ADB shell appops set $PKG android:mock_location allow

# 传感器：MuMu 自带传感器注入面板（设置 → 传感器）；AVD 系可用 adb emu sensor set
```

> 注：本项目当前 GPS 只用于天气，这条通道目前只作为「将来若新增定位签到」的基线准备。

### 2.5 抓包通道（自有后端）

```bash
# mitmproxy 装 CA 到模拟器用户证书后：
mitmproxy -p 8080
$ADB shell settings put global http_proxy 10.0.2.2:8080   # 按模拟器实际网关调整
```

**先抓 debug 包**。只有在 release 包上验证 pinning 是否生效时才需要额外手段——而那是「验证加固是否生效」的正向测试，不是绕过。

---

## 3. 用例矩阵

判定口径：**能否在只持有普通学生账号的前提下，达成越权结果**。

### 3.1 P0 · 权限与越权

| 编号 | 用例 | 操作 | 通过判据（安全） | 失败判据（漏洞） |
| :-- | :--- | :--- | :--- | :--- |
| **RT-01** | 自提权 `is_admin` | 普通账号会话内，对 `profiles` 自己那行写入 `is_admin: true` | 服务端拒绝（RLS 拦 / 报错 / 字段不生效） | 写入成功且重登后管理员入口出现 |
| **RT-02** | 自提权 `is_super_admin` | 同上，写 `is_super_admin: true` | 拒绝 | 成功且可见「成员治理」 |
| **RT-03** | 双壳绕过 | 在学生包内把 `window.__SC_SHELL__` 置为 `admin` 后重载 | 管理端路由虽出现，但所有写操作仍被服务端拒绝 | 能实际执行管理操作 |
| **RT-04** | 越权读他人档案 | 以 A 账号查询 B 的 `profiles` 行（含手机号/学号/真实姓名） | 返回空 / 被拒 | 返回 B 的敏感字段 |
| **RT-05** | 越权读私域内容 | 以非群成员身份读同校群的消息 / 非好友私聊 | 返回空 / 被拒 | 读到内容 |
| **RT-06** | 越权写 | 以普通账号改他人帖子 / 发管理端公告 | 拒绝 | 成功 |
| **RT-07** | RPC 越权 | 普通账号直接调 `admin_add_member` / `admin_remove_member` / `admin_ban_user` | 服务端按 `is_super_admin_user()` 拒绝 | 调用成功 |
| **RT-08** | 封禁绕过 | 手工把本机 `profiles.banned_at` 置空或跳过前端判断 | 服务端仍拦截 | 绕过成功 |
| **RT-09** | 匿名会话能力探测 | `signInAnonymously()` 后枚举可读集合 | 匿名仅能读公开内容 | 能读到用户数据 |
| **RT-10** | 教务凭据还原 | 从 localStorage / leveldb 取出混淆值并还原 | 还原失败（真加密） | 还原出明文教务密码 |
| **RT-11** | 本地数据篡改影响面 | 篡改本地步数 / 打卡 / 成长值 | 仅影响本机展示，无跨用户影响 | 影响了排行榜 / 积分 / 他人可见数据 |

**RT-01 的具体打法（推荐）**

在 dev 构建里加一个**只在 dev 生效的红队探针**（release 构建 tree-shake 掉），避免手搓 SDK 调用：

```ts
// src/lib/redteam-probe.ts —— 仅在 import.meta.env.DEV 下挂载
if (import.meta.env.DEV) {
  ;(window as any).__rt = {
    async setFlag(uid: string, patch: Record<string, unknown>) {
      const { data, error } = await tcb.from('profiles').update(patch).eq('uid', uid).select()
      console.log('[RT] update result', { data, error })
      return { data, error }
    },
    async readOther(uid: string) {
      const { data, error } = await tcb.from('profiles')
        .select('uid,username,phone,student_id,is_admin').eq('uid', uid).limit(1)
      console.log('[RT] read result', { data, error })
      return { data, error }
    },
  }
  console.log('[RT] probe mounted: window.__rt')
}
```

配套的 `tcb` 取现成的客户端实例（`src/lib/cb.ts` 或同类封装），不要新建连接。

### 3.2 P1 · 通信与完整性

| 编号 | 用例 | 操作 | 通过判据（安全） |
| :-- | :--- | :--- | :--- |
| RT-12 | 请求重放 | 用 mitmproxy 重放同一条写请求 5 次 | 服务端有幂等/时间戳校验，重复请求被拒或结果不变 |
| RT-13 | 改包重签名 | 重打包 + 换签名后是否仍能登录使用 | 有签名校验则会失败；**无校验即为 P1 缺陷**（这是 A/B 两类攻击的前置条件） |
| RT-14 | 本地门禁标记绕过 | 直接置 `campus.gate.unlocked.v1 = '1'` / `credSkip:<uid> = '1'` | 仅影响本机流程引导，不产生越权（当前设计如此） |
| RT-15 | release 包 pinning 生效性 | 在 release 包上用 mitmproxy 抓自有接口 | 抓不到（pinning 生效）；能抓到则为 P1 |

### 3.3 P3 · 清单里的层（当前无靶子，仅留档基线）

| 编号 | 用例 | 期望结果 |
| :--- | :--- | :--- |
| RT-20 | 模拟器/root 检测缺失确认 | MuMu 中正常运行 + `getprop` 显示模拟器特征仍不被拦 → 确认无检测（当前设计如此，非缺陷；若未来接入风控 SDK 再复核） |
| RT-21 | 步数伪造（多路径） | ① App 自带手动录入即可改数；② H5 降级计步走 DeviceMotion 峰值检测（阈值 12.5 m/s²），DevTools 里 `window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: {x:0,y:20,z:0} }))` 即可造步；③ 直改 localStorage。三条路径都"成功"，但**影响仅限本机** |

---

## 4. 已确认的代码证据（静态审计）

| 证据点 | 位置 | 说明 |
| :--- | :--- | :--- |
| 步数纯本地 | `src/lib/health.ts:106-148` | `updateTodaySteps()` 只写 localStorage；文件头注释明确「不上传云端」 |
| 计步 Web 降级通道 | `src/lib/health.ts:378-401` | DeviceMotion + 阈值 12.5 / 10 的峰值检测（注释自述「不保证精度，仅作降级兜底」） |
| 原生计步 | `android/app/src/main/java/com/sunshinecampus/app/HealthPlugin.java` | `TYPE_STEP_COUNTER` + `ACTIVITY_RECOGNITION` |
| 步数消费方唯一 | `src/pages/SportsPage.tsx:183,199,283,311` | 只有运动页读取，无排行榜/积分联动 |
| 打卡 = 登录 | `src/lib/engagement.ts:4,246,292` | 「登录 / 进门 = 打卡」，无定位成分 |
| 教务凭据落盘 | `src/lib/campus-account.ts:3,26,34,78-100` | 自述「仅 localStorage 混淆存储」；含 `sealSecret/openSecret` 与 legacy 明文迁移路径 |
| 双壳注入 | `android/app/src/main/java/com/sunshinecampus/app/MainActivity.java:75` | `window.__SC_SHELL__='<shell>'` |
| 双壳消费 | `src/lib/app-shell.ts:42,59,83` | 默认回退 `'user'`；`isAdminShell() === 'admin'` |
| 前端直读管理标志 | 打包产物 `assets/auth-*.js` | `from('profiles').select('...,is_admin,is_super_admin,...')`；同处还有 `from('profiles').upsert({...})` —— **客户端对 profiles 有写权限，这是 RT-01 的直接依据** |
| 服务端原则 | `docs/admin-permissions.md` | 「前端开关只做入口隐藏，不能当作安全边界」 |
| 云函数面 | `cloudfunctions/` | `campusAuth` / `docParse` / `examApi` / `examGenerator`，**无风控类函数** |
| 已有验收工具 | `npm run security:check` → `tools/security-predeploy-check.mjs` | 本次红队应与其结论交叉比对 |

---

## 5. 判定分级

| 级别 | 含义 | 处置 |
| :--- | :--- | :--- |
| **P0** | 仅持普通账号即可越权（提权 / 横向读写） | 上线前必修 |
| **P1** | 需要重打包 / 抓包等额外手段才能达成 | 尽快修（加固或 RLS 补齐） |
| **P2** | 仅影响本机数据，不影响他人 | 记录，可选修 |
| **N/A** | 该攻击面对本项目无靶子 | 留档，接入相关能力时复核 |

---

## 6. 加固建议（按攻击面对应）

**A · 自提权（RT-01/02）**
- RLS 在 `profiles` 的 **update** 上做**列级白名单**：允许改 `username/building/real_name/student_id/grade/major/college/avatar_url`，显式拒绝 `is_admin`/`is_super_admin`/`banned_at`/`banned_note`。
- CloudBase 安全规则里用「新值必须等于旧值」表达不可变字段（或改用云函数/RPC 独占写入这两个字段）。
- 管理标志的最终判定一律走 `is_admin_user()` / `is_super_admin_user()`，前端只用来显隐。

**B · 双壳（RT-03）**
- `src/lib/app-shell.ts` 的 `isAdminShell()` **不得作为任何写操作的前置条件**，只做 UI 分流。
- 构建层面：学生端产物应把 `/admin/*` 路由与页面 **tree-shake 掉**（而不是同一份 bundle 靠运行时开关），这样即使改了 `__SC_SHELL__` 也无代码可跑。这与你们「共用一份 web bundle」的取舍有冲突，需要评估——短期至少保证服务端零信任。

**C · 越权直连（RT-04~09）**
- 逐集合核对 RLS：`profiles` / 群消息 / 私聊 / 公告，读策略必须按 `auth.uid` 或群成员关系收敛。
- 匿名会话（`signInAnonymously`）只授予公开只读集合。

**D · 教务凭据（RT-10）**
- 不要用 localStorage 混淆落盘教务密码。改用 Android Keystore / iOS Keychain 支撑的 SecureStorage，并做到「用时解密、不常驻」。
- 更彻底：改为不存密码，走一次性 token 或让用户在需要时重新输入。
- 老用户的 legacy 明文迁移路径要确认不会长期保留明文副本。

**E · 通信与完整性（RT-12/13/15）**
- release 包加证书固定 + 请求签名 + 时间戳，防重放。
- 评估加**签名校验 / 完整性校验**，否则改包重签名永远是最短路径（RT-13 是 A/B 的前置条件）。

**F · 步数/健康（RT-11/21）**
- 现状（纯本地）不需要防伪。**一旦引入排行榜、积分、成长值兑换，必须**：服务端只接受 `TYPE_STEP_COUNTER` 累计值而非客户端自报数值、做时间序列单调性与速率上限校验、与活动识别/定位交叉验证，并在服务端留存提交历史。
- 现在就把这条写进产品评审清单，避免"先上线排行榜再补校验"。

---

## 7. 记录模板

每个用例一行，证据另附日志/截图路径：

| 编号 | 日期 | 账号 | 环境 | 操作摘要 | 结果 | 判定 | 证据 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| RT-01 | | 学生测试号 | T1 浏览器 | `profiles.update({is_admin:true})` | 服务端拒绝 | P0 通过（安全） | `docs/audit/evidence/rt-01.log` |
| RT-01b | | 学生测试号 | T2 MuMu | 同上 | — | — | — |
| … | | | | | | | |

### 执行顺序建议

1. **T1 浏览器通道**跑 RT-01/02/04/07/09/10/11 —— 一个下午能出结论，且不碰生产写入。
2. 结论为「拒绝」→ 说明服务端守住了，记录并归档。
3. 结论为「成功」→ **立刻还原 + 记录原值 + 升级为 P0 缺陷**，当天出加固方案。
4. T2/T3 只用于复现 T1 中无法判定的项（原生插件路径、改包重签）。

---

## 8. 与原始 7 层清单的对照总结

| 原始层 | 结论 | 处理 |
| :--- | :--- | :--- |
| 1 框架基础 | 无需引入 | 归档 |
| 2 环境隐藏 | 无靶子 | 归档 |
| 3 定位伪造 | 无靶子（GPS 仅天气） | 归档；若新增定位签到再启用 |
| 4 传感器伪造 | 有靶子但零影响 | 归档 + 写进产品红线（上排行榜前必修） |
| 5 摄像头/人脸绕过 | 不适用 | 归档 |
| 6 辅助工具 | **用 debug 包替代 Frida/Unpinning** | 转为 T2 通道 |
| 7 模拟器专用 | 无靶子 | 归档（MuMu 能跑本身就是证据） |

**本次红队真正的价值在清单之外**：客户端直连数据库的信任边界（A/B/C）+ 教务凭据落盘（D）。

---

*本方案基于静态代码审计与本地环境侦察编写，尚未执行任何动态攻击验证。动态用例开始前请确认第 1 节红线。*
