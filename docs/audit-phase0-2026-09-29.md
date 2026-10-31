# 阶段 0 · 项目审计报告（基线 1.2.33 / code 48）

> 审计时间：2026-09-29 · 审计人：产物为本次会话实时核对（`git`、`tcb db execute`、磁盘实测），非推测。
> 结论先行：**技术栈与任务书基本一致（Vite 8 + React 19 + CloudBase）**；阶段 1 大部分已在 1.2.33 完成，但**数据模型与阶段 2 要求不一致，需要迁移**；要求 A/B 两条改造**尚未开展**，是本轮重点。

---

## 一、技术栈确认（以实际项目为准）

| 项 | 任务书假设 | 实际 | 差异处理 |
| --- | --- | --- | --- |
| 框架 | Vite 8 + React 19 + RR7 | 一致：`vite ^8.3.0` / `react ^19.2.8` / `react-router-dom ^7.18.3` | 无 |
| SSR / API Route | 无 | 确认无 SSR、无 API Route，页面即组件 | 无 |
| 后端 | CloudBase | `@cloudbase/js-sdk ^3.9.3`，封装在 `src/lib/cb.ts` | 无 |
| EnvId | jou-d4gq7a3cqf51e6caa | 一致（`src/lib/cb.ts:10`，ap-shanghai） | 无 |
| DB 访问 | postgREST 链 | 一致：`cbRdb().from(t).select('*').eq(...)`，需 `as any` 兜底 | 无 |
| 主键 | text 主键 + text uid | 确认：既有表多为 text 主键 + text uid | 沿用，**不用 uuid** |
| RLS 写法 | `auth.uid()::text = uid` | 一致，已落地（`questions_self` / `papers_self`） | 无 |
| 路由模式 | H5 Browser / App Hash | 一致：`src/App.tsx` 的 `AppRouter`（`IS_NATIVE` 切换） | 无 |
| 多端壳 | 五端 | 一致：user/admin/rider/shop/stall，`shell-guard.ts` 白名单 | `/english` 已加入 1.2.33 |
| AI 接口 | askSunshine | `src/lib/ai-chat.ts`：`POST ${API_BASE}/api/chat`，body `{messages:[{role,content}]}`，返回 `{ok,reply,error,detail}` | 无 |
| Key 暴露 | 禁止 | 天然满足：`/api/chat` 是既有云函数，Key 仅服务端 | 无 |
| 其他依赖 | — | phaser 3.90 / three 0.186 / motion 13 / @tencentcloud/chat | 阶段 2-3 不动它 |

vite 构建要点（`vite.config.ts`）：`VITE_BASE` 驱动 H5 `/` 与 App `./` 两套产物；`/api` 本地走 proxy；`src/lib/gateway.ts` 决定 API_BASE（App 壳跨域打到网关域）。

---

## 二、路由表（46 条，仅列相关部分）

| 路由 | 组件 | 状态 |
| --- | --- | --- |
| `/english` | `EnglishHubPage` | **1.2.33 新增**（单词三页聚合 + 试卷列表 + 四级导入） |
| `/english/bank` | `BankPage` | **1.2.33 新增**（粘贴 → AI 出题 → 题库 → 组卷） |
| `/english/exam/:paperId` | `ExamPage` | **1.2.33 新增**（答题 + 判分 + 解析，结果态内嵌） |
| `/words` `/words/duel` `/words/endless` | 既有三页 | **未改动**（约束 1 满足） |
| `/study` `/study/focus` `/zhongce` `/schedule` | 学业线 | 1.2.32/33 改动过入口，非三页内部 |
| 其余 38 条 | 业务/管理/工作端 | 未动 |

任务书建议的 `/questions`、`/papers/:id/take`、`/papers/:id/result` **不再另铺**——功能已挂在 `/english/*` 短路由下，避免两套路由并存（任务书第十三节允许这样理解）。

---

## 三、数据库现状（实测 `information_schema`）

**已有业务表（节选）**：activities、activity_signups、admin_accounts、campus_links、canteen_*、cat_charity_items、character_assets、chat_messages、chat_threads、checkins、client_prefs、commission_rules、news、notifications、**papers**、partner_apps、pay_config、pet_*、profiles、questions …

**⚠️ 关键差异：1.2.33 已部署的 questions/papers 是「简化版」，不满足阶段 2 要求**

实测列：

| questions（现） | papers（现） |
| --- | --- |
| id / uid / subject / source / **qtype** / stem / **options(text JSON串)** / **answer(int)** / explain / created_at | id / uid / title / **qids(text)** / best_score / best_total / best_at / created_at |

缺：`source_type`、`source_ref`、`question_type` 枚举、`options jsonb`、`answer text`、`difficulty`、`tags text[]`、`content_hash`、唯一索引 **`uniq_questions_uid_hash`**，以及 **`paper_questions`、`paper_attempts` 两张表**。

- 两表均为今日新建，**线上 0 行**（尚无用户数据）→ 迁移成本≈0，直接 drop 重建即可，无需写数据迁移脚本。
- RLS 已启用 + `auth.uid()::text = uid` 策略已建（questions_self / papers_self）。
- SQL 落地机制：`tools/deploy-db.mjs` **只跑 `docs/release/*.sql` 里登记在 `FILES` 数组的文件**（`docs/sql/` 仅归档不执行）。`questions_papers.sql` 目前已同时放进两处并登记。

---

## 四、askSunshine 签名

```ts
askSunshine(messages: {role:'user'|'assistant'; content:string}[]): Promise<{
  ok: boolean; reply?: string; error?: string; detail?: string
}>
```
- 现有使用：`ChatPage`（历史最后 12 条）、`fox-ai.ts`（单词助记/对战解说）。
- 失败语义：`ok=false` 时 `error` ∈ {network, bad-response, 服务端码}，`detail` 为可读文案。
- 阶段 2 的错误分类（模型失败 / JSON 解析失败 / 无题 / 全重复 / 权限）都建立在这四个字段上。

---

## 五、可复用组件 / 基建

| 资产 | 位置 | 备注 |
| --- | --- | --- |
| 页面外壳风格 | `components/ui/panel.module.css`（`--pd-*` 变量：ink/muted/fox/pine/paper/line） | 新页面已复用；**只许追加类名，不许改既有类名** |
| 页头 | `components/PageHeader.tsx`（返回 → `lib/back.ts` 兜底） | 统一 |
| 二次确认 | `components/ConfirmSheet.tsx`（普通/带原因，danger 态） | 危险操作走它 |
| Toast | `context/ToastContext.tsx`（`toast.ok/err/warn` 三分色） | 短句反馈走它 |
| 动效底座 | `components/ui/motion-ui.tsx` + `advanced.tsx` | 保持克制，别滥用 |
| 跟手/ damp 组件 | `TiltPanel` / `DampedSheet` / `GlowBorder` / `SpringStagger` | 折叠说明面板建议用 `DampedSheet` 或 `Collapsible` |
| 应用壳/主题/动效偏好 | `lib/theme.ts`、`lib/motion-pref.ts` | 遵循减弱动效偏好 |
| **IndexDB 示例** | `lib/campus-db.ts`（唯一在写的 IndexedDB 实例） | 资源包缓存可照抄其打开/升级范式 |
| **包下载开关** | `lib/pack-download-gate.ts`（`VITE_PACK_DOWNLOAD=1` 才开，现关闭） | 现成 gate，可扩展为通用包 gate |
| 上传工具脚本 | `tools/upload-{harbor-world,lyg-games,pet-adventure}.mjs` | 现成 CloudBase storage 上传范式，可做 qbank 包上传模板 |
| 存储 | `cbStorage().from('images')`（`lib/account.ts`、`market.ts`、`canteen-image.ts`） | 目前只用 `images` 桶；阶段 3 需 `qbank-docs` 私有桶 |

---

## 六、现有 TS / Lint 基线

- `npx tsc -b --force`：**0 报错**（阶段 0 交付时基线）。
- `npx oxlint src`：**0 error / 85 warning**（全历史存量，多为 `set-state-in-effect`，非本次引入）。
- 建议把基线钉死：阶段 1-4 结束时不得新增 warning 数量超过 2 条。

---

## 七、半成品归属（沿用 / 重做）

| 文件 | 现状 | 判定 |
| --- | --- | --- |
| `src/lib/qbank.ts` | localStorage `qbank.v1` 首屏 + CloudBase 尽力同步；桥 Like engagement.ts | **改写**：换到新四表结构 + content_hash 去重 + service 分层（保留「本地优先+云端尽力」的思路） |
| `src/lib/qgen.ts` | Prompt 要求 JSON 数组、`extractJsonArray` 容错围栏 | **重做并下沉**到 `services/qbank/generate.ts` + `parse.ts`；补 JSON 校验清单与错误分类 |
| `src/data/cet-bank.ts` | 22 组翻译词汇对，**范文/翻译正文已在 1.2.33 移除** | **保留词汇元数据**（无版权的确定性词组），或按任务书彻底私有包化；现倾向于按任务书改为资源包（见第九节 C-7） |
| `src/pages/english/*` | 三页已可跑通主链路 | **沿用 + 去 AI 化改造**（错误/空状态保留但短句化） |
| `docs/sql/questions_papers.sql` | 旧结构归档 | 保留作历史，**不再执行** |
| `docs/release/questions_papers.sql` | 已登记 FILES 并已部署（旧结构） | 阶段 2 换 `qbank.sql`，旧文件从 FILES 移除避免重复执行 |
| `tools/deploy-db.mjs` | FILES 已追加 | 继续沿用，追加 `qbank.sql` |

---

## 八、去 AI 化文案审计表（要求 A）

> 范围优先：由我本轮引入的 `/english/*` 三页 + 入口附近；全站扫描结果附后。
> 规则：错误、空状态、权限、危险确认、表单校验 **保留但短句化**；科普长文 **收进「？」折叠/抽屉**。

| # | 位置 | 原文（摘） | 类型 | 处理 | 新文案 / 落点 |
| --- | --- | --- | --- | --- | --- |
| A1 | `EnglishHubPage.tsx:109-113` 四级真题卡 | 「2025 年 12 月真题里的三套翻译重点词汇（22 词 × 中英双向 = 44 题），一键生成互译选择题。作文范文等成段资料不随 App 分发，去「出题」页粘贴后 AI 出题。版权考虑，仅导入本人题库，不提供公开分享。」 | 科普长文 + 合规说明 | 折叠 | 常驻：`22 词 · 中英双向` + 标签「仅本人可见」；详情进「？」抽屉（固定三段：来源 / 范围 / 不公开说明） |
| A2 | `EnglishHubPage.tsx` banner | 「题库 N 题 · 试卷 M 份 · 已同步云端」 | 状态短句 | **保留**（≤12 字状态，符合规则 7） | 原样 + 同步状态图标化（✓/⟳） |
| A3 | `BankPage.tsx:127` 出题卡说明 | 「粘贴课文、笔记或真题原文（40 字以上），AI 生成自测题入库。资料不出现在题目里也不会外传。」 | 科普 + 隐私承诺 | 折叠 | 常驻：`粘贴资料 · AI 出题`；字数下限改**就地校验提示**；隐私说明进「？」 |
| A4 | `BankPage.tsx:222` 底部提示 | 「真题范文、错题原文等资料只存在你自己的设备与私有题库里…App 不附带任何真题正文——需要时自己粘贴即可。」 | 合规长文 | 进帮助弹窗 | 常驻一行：`仅本机 · 不出 APK` |
| A5 | `BankPage.tsx` 互译方向 tips | 三个 chip `双向/中→英/英→中` | 控件标签 | **保留**（动词短标签） | 原样 |
| A6 | `ExamPage.tsx:93` 结果区 | 「正确率 xx% · 历史最好 x/y」 | 状态 | **保留** | 原样；`重做一遍 / 回英语` 按钮保留 |
| A7 | 空状态 `EnglishHubPage` | 「还没有试卷。去「出题 / 题库」粘贴资料 AI 出题，或先导入四级词汇，再勾选题目一键组卷。」 | 空状态引导（必要） | **保留但拆短** | `还没有试卷` + 按钮 `去出题`（去掉解释从句） |
| A8 | 空状态 `BankPage` | 「题库还是空的：上方粘贴资料让 AI 出题，或回英语首页导入四级真题词汇。」 | 空状态引导 | 短句化 | `题库是空的` + 按钮 `粘贴出题` / `导入四级词汇` |
| A9 | 各类 toast（资料太短 / 模型没返回题 / 已删除 / 已入库 N 题） | 已为短句 | 反馈 | **保留**，按任务书补齐分类：模型失败 / JSON 失败 / 无题 / 全重复 / 权限 | 五类文案统一在 `qbank` service 里定义常量 |
| A10 | `StudyHubPage.tsx` 学业中心（存量） | 同步卡「一次验证码同时拉课表、成绩、考试。学号密码已从校园账号带入时，只需填验证码。」等 2 处长文 | 存量科普 | 阶段 1 范围内顺手改 | 常驻≤16 字状态 + 「？」说明（**不删 Funcionality，不改逻辑**） |

全站扫描补充（按长文案命中次数排序，供后续阶段排期）：`PartnerApplyPage`(3)、`AdminContentPage`(3)、`StudyHubPage`(2)、`ZhongcePage`、`TaskDetailPage`、`ItemDetailPage`、`ChatListPage`、`Admin*`(若干)。**建议顺序：先 /english/* 三页 → 学业线 → 管理/工作端**（后者本版若不动可只登记，不实施）。

---

## 九、资源包迁移清单（要求 B）

### 现状测量结果

| # | 资源 | 大小 | 当前打包方式 | 建议包 id | public/private | 版权风险 | 处理建议 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | `src/assets/img/*`（64 个文件） | **8 MB**（44 张确实进 dist） | `data/images.ts` import → Vite 产物 | `pack-ui-core`（首屏 6 张留 APK）+ `pack-ui-rest` | public | 自有，无 | **一期只做拆分评估**：hero/avatar 6 张保留 APK，其余商品/菜品图改包，预计 APK −3~5MB |
| B2 | `src/data/words/banks.ts` | 12 KB / **仅 105 词** | 源码 import，进 JS bundle | `pack-words-core` | public | 无 | 低于 50KB 阈值，**建议暂留源码**；但扩词到 >1000 词时必须包化（阶段 2 末决策） |
| B3 | `src/data/zhongce.ts` 综测细则 | 16 KB | 源码 import | `pack-zhongce-rules` | public | 无（校内公开文件） | 可延后；学年更新时才体现出价值 |
| B4 | `src/data/study.ts` 证书目录/里程碑 | 8 KB | 源码 import | `pack-study-certs` | public | 无 | 可延后 |
| B5 | `public/sunny-fox/*` 品牌吉祥物 | 821 KB | public 直拷 → APK assets | `pack-fox`（首屏 1 张留 APK） | public | 自有 IP | 拆分为资源包，APK 内仅留首屏 1 张 |
| B6 | 四级真题词汇 `data/cet-bank.ts` | 3 KB / 22 组 | 源码 import | `pack-cet4-2025-12`（**private**） | private | **高**（来源 docx 为新东方整理） | 按任务书阶段 4：**不进源码**。方案①彻底移除，改用户粘贴；方案②做 private 包走 `uid/<fileId>` 临时签名 URL。倾向 ① + ②并存：词组当私有包可选下载 |
| B7 | 题库 / papers / attempts | 0（运行时产生） | localStorage `qbank.v1` + CloudBase 表 | — | private | 依用户内容 | **已满足不打进 APK**（RLS 仅本人） |
| B8 | AI 出题 Prompt 模板 | 约 3 KB | `src/lib/qgen.ts` 内联 | `pack-qbank-prompts`（可选） | public/private | 无 | 模板本身无版权，**暂留源码**（便于热修 Prompt）；>50KB 才包化 |
| B9 | `dist` 累积旧 hash 产物 | 已见 4×`index-*.js`（各 ~2MB）+ 多份 `im-core/web` | `--emptyOutDir false` 反复覆盖同一目录 → 旧文件累积 | — | — | 无 | **构建流程问题**：每版用新 `--outDir dist-appN`，或限定 assets 白名单；建议写进 skill，预计 APK −2~4MB |
| B10 | `android/.../assets/public` | 8.4 MB | 已被 `.gitignore` 忽略（不进仓库，进 APK） | — | — | 无 | 保持 |
| B11 | 既有内容包 (`harbor-world-pack` 等) | 已归档到 `新建文件夹 (10)` | 仓库已删除（`git status` 显示 D） | — | — | — | 已满足「不进 APK / 不进仓库」 |

### 现有基建 vs 需要新建

- **已有**：`pack-download-gate.ts`（全局开关，默认关）、`tools/upload-*.mjs`（storage 上传脚本范式）、`campus-db.ts`（IndexedDB 打开/升级范式）。
- **缺**（阶段 2-4 需新建，建议放 `src/services/packs/`）：manifest 类型、远端 manifest fetch、下载器（进度/取消/重试/Range 续传）、本地缓存（IndexedDB）、hash 校验、版本更新、`uid/<fileId>` 私有签名 URL 取龛。
- manifest 字段按任务书：`{id,name,version,hash,size,url,scope,required,updatedAt,description}`，再加 `uid?`（私有绑定）、`type`（words/questions/images/docs）。

### 验收口径（可 grep）

```
# APK 产物中不应出现真题正文 / 大词库
grep -r "卢沟桥\|lucid waters\|city walks" dist-app*/assets/*.js   → 期望 0 命中
# 仓库中不应出现真题抽取文本
git status --short | grep -i "cet\|_cet_docx"                      → 期望无未 ignore 命中
```
> `_cet_docx_text.txt` 已在 1.2.33 删除；建议补 `.gitignore` 兜底项（`_cet_*.txt`、桌面 docx 名）。

---

## 十、风险点

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| R1 表结构换血 | 现 questions/papers 是简化版，线上 0 行 | 直接 drop 重建 + `qbank_rollback.sql`；不写数据迁移 |
| R2 AI 输出不稳定 | 已见：可能返回围栏/前后废话/空 | `parse.ts` 严格校验 + 五类错误提示，脏数据不入库 |
| R3 重复入库 | 现无 content_hash | 新增 `uniq_questions_uid_hash` + 入库前本地 hash 剔除 |
| R4 换端 CORS | App 壳 `https://localhost` 跨域打 `/api/chat` | fail-safe 短句文案 + 重试；不静默失败 |
| R5 localStorage 与云端 id 冲突 | 现有「本地生成 id + 云端合并」 | 统一前端生成 text id，以 `created_at` 较新为准，补唯一索引 |
| R6 资源包卡住主流程 | 未下载时功能不可用 | 占位 + 大小 + 下载按钮 + 取消/重试；核心流程不受阻塞 |
| R7 版权合规 | 真题/参考答案/付费资料 | 一律 private + `uid/<fileId>` + 临时签名 + 无公开入口；范文正文不进源码/APK/仓库 |
| R8 一次性大重构 | 任务书明令禁止 | 分阶段，每阶段白名单化；本阶段不动三页内部 |
| R9 构建 dir 累积 | 见 B9 | 新版新 outDir + skill 固化 |

---

## 十一、分阶段实施计划

| 阶段 | 目标 | 主要交付 | 依赖 |
| --- | --- | --- | --- |
| **阶段 1**（本次可做） | OP-B 收尾 + `/english/*` 去 AI 化 | 三页文案按表 A1-A9 改；`StudyHubPage`/入口补问号帮助；`npx tsc` 0 报错；遮说明可懂主流程 | 无 |
| **阶段 2** | OP-C 一期 + OP-D | `services/qbank/{generate,parse,import,papers,attempts}.ts`；`docs/release/qbank.sql` + `qbank_rollback.sql`（4 表 / 7 索引 / 4 RLS / 1 唯一索引）；BankPage 接新 service（预览可编辑、去重、筛选搜索）；ExamPage 判分 + Result 态；错误五分类短句 | 先 drop 旧两表 |
| **阶段 3** | OP-C 二期 | `cloudfunctions/docParse` + `qbank-docs` 私有桶 + `qbank_storage.sql`；分块 ≤4000 字、>20MB 拒绝、最多 2 次重试、单文档块数上限 | 阶段 2 完成 |
| **阶段 4** | OP-E 私有真题 | 私有包 manifest `pack-cet4-2025-12`；`source_type='cet4_2025_12'` 筛选；grep 验证 APK/仓库无正文；`.gitignore` 兜底 | 资源包下载器（阶段 2 一并建骨架） |
| **阶段 5** | OP-A 暂缓 | 只出观察建议：埋点口径、2-4 周周期、决策阈值 | — |

**建议本次先做阶段 1（低成本、立竿见影）+ 阶段 2 的 SQL 部分**，把会让后面返工的表结构一次定型。

---

## 十二、建议改动文件白名单（阶段 1 + 2）

**阶段 1**
```
src/pages/english/EnglishHubPage.tsx
src/pages/english/BankPage.tsx
src/pages/english/ExamPage.tsx
src/pages/english/english.module.css        （新增折叠/问号样式）
src/pages/study/StudyHubPage.tsx           （仅两处长文案）
（不改）src/pages/words/**        （约束 1）
（不改）src/data/mock.ts / App.tsx / shell-guard.ts   （1.2.33 已改好）
```

**阶段 2**
```
新增 src/services/qbank/generate.ts   generateQuestionsFromText(text, {count,type,difficulty,tags,dir})
新增 src/services/qbank/parse.ts      parseAIQuestionsJson(raw) -> {ok, questions, issues[]}
新增 src/services/qbank/import.ts     createQuestionsFromImport(rows, source_type)
新增 src/services/qbank/papers.ts     createPaper({title, questionIds|rule})
新增 src/services/qbank/attempts.ts   submitPaperAttempt(paperId, answers)
新增 src/services/qbank/hash.ts       contentHash(stem, answer, type)  (md5，纯前端无依赖)
新增 src/services/qbank/errors.ts     五类错误短句常量
改   src/lib/qbank.ts                 新四表结构 + 本地/云端同步
改   src/pages/english/BankPage.tsx   接 service：预览可编辑 + 去重 + 筛选搜索
改   src/pages/english/ExamPage.tsx   判分 + 结果/解析
新增 docs/release/qbank.sql
新增 docs/release/qbank_rollback.sql
改   docs/release/questions_papers.sql → 移出 FILES（改由 qbank.sql 负责）
改   tools/deploy-db.mjs
```
