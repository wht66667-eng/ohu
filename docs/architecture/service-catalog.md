# 哦狐服务与部署能力目录

核对日期：2026-10-31  
核对范围：当前工作区的代码、CloudBase 配置、网关路由文件、服务 README，以及已归档的 2026-10-15 只读 schema 元数据快照。未连接生产数据库刷新结构，未调用线上健康检查；快照只是其采集时的状态，不得视为当前授权或运行状态。

## 状态口径

- **源码／配置存在**：本地找到代码或部署配置；不代表线上已部署。
- **源码停用**：服务代码明确拒绝业务请求；若网关路由仍启用，访问仍会返回停用响应。
- **未接入部署清单**：代码目录存在，但未在当前 `cloudbaserc.json` 或本地网关路由文件中找到部署登记。
- **线上状态未核实**：需要只读云端配置或健康检查，本次未执行。

## 服务清单

| 服务 | 用途 | 工作区依据 | 本地可确认的部署目标／路由 | 状态与健康检查 | 负责人 |
|---|---|---|---|---|---|
| 学生端／管理端 Web | App 页面与管理工作台 | `src/App.tsx`、`src/AdminApp.tsx`、`package.json` | CloudBase 静态托管 `https://jou-d4gq7a3cqf51e6caa-1394316826.tcloudbaseapp.com`；规范下载入口 `/download/` | 2026-10-31 再次发布 1.2.145；官网、学生／管理下载页、iOS 教程、APK、更新清单与 user/admin OTA manifest 返回 HTTP 200，线上身份均为 1.2.145／145；此结果只覆盖静态页面、包文件与 OTA，不证明生产数据库／云函数状态 | 未登记 |
| CloudBase Auth | 哦狐账号会话 | `src/lib/cb.ts`、`src/lib/auth.tsx` | 环境 ID 写在 `src/lib/cb.ts`；本地未找到独立 Auth 部署清单 | 用户登录与生产配置未核实 | 未登记 |
| CloudBase PostgreSQL | 业务关系数据、RLS、RPC | `src/lib/cb.ts`、`docs/sql/`、`docs/release/`、`tools/deploy-db.mjs` | `jou-d4gq7a3cqf51e6caa`，上海区域；云端结构未读取 | 当前工作区的迁移登记与文件不完整；生产 schema、RLS、RPC 和迁移版本未核实。`docs/release/` 当前仅有 `meet-invitations.sql` | 未登记 |
| CloudBase pgstore | 图片、头像等对象存储 | `src/lib/cb.ts`；存储桶 `images` 的策略背景见其中注释 | 由同一 CloudBase 环境 SDK 提供 | 桶策略、容量、生产可用性未核实 | 未登记 |
| `jou-api` 云托管 | 江苏海洋大学教务验证码、课表、成绩与考试代理 | `tools/jou-api/README.md`、`src/lib/timetable.ts`、`.env.production` 的 `VITE_TIMETABLE_API` 配置 | README 记载 CloudRun 服务 `jou-api`，经 `/api/timetable` 与 `/api/health` 路由 | README 提供 `GET /api/health`；本次未请求线上服务。单 worker／单实例是当前内存验证码会话的约束 | 未登记 |
| `campusAuth` 云函数 | 历史学号建档兼容接口 | `cloudfunctions/campusAuth/index.js`、`cloudfunctions/campusAuth/_route.json` | `cloudbaserc.json` 登记 Node.js 18；路由 `/api/campus-auth` | 源码对业务请求返回 403 `VERIFIED_REGISTRATION_REQUIRED`；路由配置本地为启用。线上配置未核实 | 未登记 |
| `docParse` 云函数 | 登录后解析 TXT／DOCX／PDF 并分块 | `cloudfunctions/docParse/` | `cloudbaserc.json` 登记 Node.js 18；路由 `/api/docparse` | 本地路由文件存在；限流需要共享 RPC；线上部署与 RPC 状态未核实 | 未登记 |
| `examApi` 云函数源码 | 公开只读题库／词汇接口 | `cloudfunctions/examApi/` | 有函数源码和依赖清单；当前 `cloudbaserc.json` 未登记该函数，本地目录也未发现 `_route.json` | 是否在其他环境或仓库部署未知；不可仅凭源码目录宣称可用 | 未登记 |
| `examGenerator` 云函数 | 文件资料生成自测题，默认关闭 | `cloudfunctions/examGenerator/`、`cloudbaserc.json` | 当前 `cloudbaserc.json` 登记 Node.js 20；README 说明预期 `/api/exam-generator/*` 路由，但本地函数目录未发现路由文件 | `FILE_EXAM_ENABLED` 在本地部署配置中为 `false`；服务凭证、路由与生产开关未核实 | 未登记 |
| `agnesAi` 云函数（新增源码） | Agnes 八项 AI 工具的服务端代理 | `cloudfunctions/agnesAi/`、`cloudbaserc.json` | 源码配置为 Node.js 20；本地路由 `/api/agnes`；环境变量模板见该目录 README | **源码与本地路由已登记，未部署**。Agnes 密钥尚未配置；调用前要求非匿名登录并通过共享限流 | 未登记 |
| 原 `/api/chat` AI 服务 | 现有聊天接口，`docParse` 的旧说明也提到复用 | `src/lib/ai-chat.ts`、`src/lib/gateway.ts` | 客户端走 CloudBase 网关的 `/api/chat` | 后端实现、独立仓库／函数来源及线上健康检查未在当前工作区找到 | 未登记 |

## 数据库迁移与限流 RPC 缺口

- `tools/deploy-db.mjs` 现会在执行前检查全部登记文件存在且含可执行语句，并支持 `npm run check:db-migrations` 纯本地检查；缺文件时先列全清单并在提交 SQL 前中止。当前 `docs/release/` 目录只有 `meet-invitations.sql`，不能据此重建完整生产库；预检不验证 SQL 正确性、生产执行历史或失败原子性。
- `cloudfunctions/examGenerator/README.md` 提到 `docs/release/file-generation.sql`，但该文件当前不在 `docs/release/`。README 对其执行状态的描述不能替代当前工作区的迁移文件或生产只读核验。
- `docParse`、`examGenerator`、`examApi`、`agnesAi` 的限流实现均调用 `rate_limit_hit`。本次在 `docs/sql/` 与 `docs/release/` 未找到该 RPC 的本地定义；生产端是否已存在未知。
- `docs/audit/cloud-schema-readonly-2026-10-15.json` 是历史元数据快照（采集范围明确排除业务数据和函数执行）。该快照记录 `function_rate_limits` 当时未启用 RLS，`authenticated` 对该表有读／写／更新／删除权限，`anon` 有读取权限；`rate_limit_hit(text,text,integer,integer)` 当时为 `SECURITY DEFINER` 且允许 `anon` 与 `authenticated` 执行。由于没有函数正文、当前云端授权复核或端用户调用验证，尚不能判断具体可利用影响，也不能把这些授权当作当前状态；但这些元数据足以要求优先复核限流控制面。源码中服务端调用 `rate_limit_hit` 失败会关闭高成本 AI 请求，不会消除此 RPC／表的直接授权面。
- 不新建空迁移，不重放未核验的 SQL，也不对生产库执行写入。恢复缺失的权威迁移源，或获得只读生产 schema／RPC 快照后，再确定如何补基线。

## 发布身份与线上核验（2026-10-31）

- 源码身份：`package.json`、`src/lib/app-version.ts` 和 `android/app/build.gradle` 标记 1.2.145／145。
- 本地用户 APK：50,268,870 字节，SHA-256 `41ccb0ad53e90a6bb8958c7ee5dd4a08b1180c19c96528bf961b83d7ac6c9f11`；管理 APK：45,875,029 字节，SHA-256 `72b684b4db093f853d71480e149cf9c73341f461e3780c8d184e8294c1d71915`。两件线上文件均 HTTP 200 全量下载后重新计算，与发布清单匹配。
- 远端 `/update.json` 为 1.2.145／145；下载页、`/admin`、学生／管理 OTA manifest、1.2.145 OTA bundles 均已发布。OTA manifest 均为版本／webBuild 1.2.145／145，最低原生构建 144；下载 URL 分别为 `downloads/SunshineCampus-User-1.2.145.apk` 与 `downloads/SunshineCampus-Admin-1.2.145.apk`。
- iOS 清单 `/download/ios-latest.json` 返回 `unavailable`，`/download/source-identity.json` 为 1.2.145／145 且 `iosDownloadAvailable:false`。旧 1.2.140 IPA 未随网站上传，当前没有同版本通过身份、大小和 SHA-256 校验的 IPA。GitHub CLI 当前账号对目标仓库仍为 `pull:true, push:false`，不能触发仓库内 iOS workflow。
- `npm run release:prepare -- --reuse-apk` 与 `npm run release:publish` 已执行；官网与 APK／OTA 已发布，不代表生产数据库或 AI 云函数已部署。当前 Windows 缺 Xcode；指定 GitHub 仓库状态另见下节。
- 规范官网／下载地址为 `https://jou-d4gq7a3cqf51e6caa-1394316826.tcloudbaseapp.com/download/`；CloudBase 默认 HTTPS 域名可用，但尚未绑定用户自有品牌域名。绑定需要已注册域名及 DNS 控制权，不将外部自签工具域名当作哦狐官网。

## 数据库迁移登记逐项清点（2026-10-30）

只读解析 `tools/deploy-db.mjs` 的 `FILES` 数组并检查工作区文件；未执行 SQL。登记数组共 15 项，全部缺失：

| 登记迁移 | 工作区状态 |
|---|---|
| `client_prefs.sql` | 缺失 |
| `character_assets.sql` | 缺失 |
| `campus_links.sql` | 缺失 |
| `plaza.sql` | 缺失 |
| `plaza-sanctions.sql` | 缺失 |
| `news-broadcast.sql` | 缺失 |
| `qbank.sql` | 缺失 |
| `reports_target_type.sql` | 缺失 |
| `plaza-avatar.sql` | 缺失 |
| `plaza-post-stats.sql` | 缺失 |
| `plaza-post-fk.sql` | 缺失 |
| `plaza-post-media.sql` | 缺失 |
| `college-groups.sql` | 缺失 |
| `function-rate-limit.sql` | 缺失 |
| `ugc-images.sql` | 缺失 |

`docs/release/` 唯一 SQL 文件为未登记的 `meet-invitations.sql`，大小 29,373 字节，SHA-256：`5f7dfa0ec3381744f85e4927281a09cfdd1aa2138e103d946473a7176d71406e`。校验和仅用于当前工作区文件识别，不代表已在生产执行或内容安全可重放。部署脚本注释中的生产执行历史是既有文字记录，本次没有进行线上核对。

## 已选 GitHub 仓库核对（2026-10-30）

用户指定的正式仓库为 [`wht66667-eng/ohu`](https://github.com/wht66667-eng/ohu)。2026-10-31 通过 GitHub 只读 API 与 CLI 核对，仓库仍为空且无 Actions workflow，无法触发当前版本 iOS 构建或作为当前工作区回退基线，也无法从中恢复 15 项登记迁移。

此前检查的 `xiao-jj-78/sunshine-campus` 只是按描述和文件名找到的候选仓库，不是用户指定的正式仓库；其旧版本及迁移记录不再作为哦狐当前代码的依据。没有向 `wht66667-eng/ohu` 推送文件或创建提交，也没有下载 SQL。
## 下一轮核对顺序

1. 在正式仓库收到当前工作区的代码提交后，再做提交级比较；迁移仍须等生产数据库只读 schema／RPC 清单和执行记录确认，证据一致前不补造、不恢复、不覆盖、不执行 SQL。
2. 条件具备后，只读核对 CloudBase 的函数清单、网关路由、CloudRun 版本及数据库 schema／RLS／RPC；记录读取时间和环境，禁止导出用户数据。
3. 对照本目录与线上核对结果，区分源码、配置、已部署、健康检查已验证四种状态。
4. 取得数据库基线后，建立空白隔离环境的迁移重建和回滚演练，再开始依赖新表或 RPC 的功能。

## 更新规则

每次更新都记录核对日期和证据来源；只有实际查询或执行过的项目才能从“未核实”改成已部署／已验证。负责人、线上版本和生产状态未知时保留“未登记／未核实”，不要根据目录名推测。





