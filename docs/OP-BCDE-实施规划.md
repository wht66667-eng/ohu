# 阳光校园 · OP-B / C / D / E 实施规划（OP-A 暂缓）

> 版本基线：package.json 1.2.32 / 五端 APK 1.2.32
> 编写时间：2026-09-29
> 本文档只做规划，不含代码。每阶段开工前按「阶段卡」逐项落地。

---

## 0. 技术栈校正（重要）

任务书假设为 Next.js + Supabase，**实际项目不是**。以下全部按实际项目执行：

| 项 | 任务书假设 | 实际项目 | 影响 |
|---|---|---|---|
| 框架 | Next.js | Vite 8 + React 19 + react-router-dom 7 | 无 SSR / 无 API Route，页面即组件 |
| 后端 | Supabase | 腾讯云开发 CloudBase（`@cloudbase/js-sdk`） | 客户端 `src/lib/cb.ts`：`cbRdb()` / `cbAuth()` / `cbStorage()` |
| 环境 | — | EnvId `jou-d4gq7a3cqf51e6caa`，ap-shanghai | 见 `src/lib/cb.ts` |
| DB 访问 | supabase-js | postgREST 风格链 `.from().select().eq()` | 写法近似，类型需 `as any` 兜底 |
| 主键 | uuid | 既有表多为 **text 主键 + text uid** | `user_id uuid default auth.uid()` 改为 `uid text not null` |
| RLS 写法 | `auth.uid() = user_id` | **`auth.uid()::text = uid`** | 必须带 `::text` 转换 |
| 路由模式 | 单一 | H5 `BrowserRouter` / App `HashRouter` | 见 `src/App.tsx` 的 `AppRouter` |
| 多端壳 | 无 | 五端（user/admin/rider/shop/stall） | 新路由必须进 `src/lib/shell-guard.ts` 白名单 |
| AI 接口 | — | `askSunshine()` @ `src/lib/ai-chat.ts` | `POST ${API_BASE}/api/chat`，body `{messages:[{role,content}]}` |

**约束 4（不暴露 Key）已天然满足**：`/api/chat` 是既有云函数，Key 只在服务端，前端零 Key。
**约束 2（不新增后端）**：一期复用 `askSunshine()`，只加前端 service，不动云函数。

---

## 1. 现状盘点

### 1.1 现有英语三页（不可改内部逻辑）

| 路由 | 文件 | 依赖 |
|---|---|---|
| `/words` | `src/pages/words/WordsPage.tsx` | `data/words/banks.ts`、`services/words/{srs,plans,speech,rewards}.ts` |
| `/words/duel` | `src/pages/words/WordDuelPage.tsx` | 同上 + `srs.distractors` |
| `/words/endless` | `src/pages/words/WordEndlessPage.tsx` | `services/words/endless.ts` |

三页互有 `Link` 跳转，`/study` StudyHub 有「单词记忆」快捷格指向 `/words`。**规划只新增外层入口，不碰这三个文件。**

### 1.2 已落地的半成品（另一会话在途，需先确认归属）

```
src/lib/qbank.ts          题库数据层（localStorage + 云端镜像）
src/lib/qgen.ts           AI 出题（generateQuestions / extractJsonArray）
src/data/cet-bank.ts      四级真题种子 ← 版权红线，见 §7
src/pages/english/EnglishHubPage.tsx   /english 聚合页
src/pages/english/BankPage.tsx         /english/bank 出题+题库
src/pages/english/ExamPage.tsx         /english/exam/:paperId 答题
src/pages/english/english.module.css
docs/sql/questions_papers.sql          2 表草稿（未部署）
```

`src/App.tsx` 已挂 3 条路由：`/english`、`/english/bank`、`/english/exam/:paperId`。

### 1.3 已知缺口

- `tsc --noEmit -p tsconfig.app.json` 有报错（EnglishHubPage / ExamPage），**基线未通过**。
- `docs/sql/` 不在 `tools/deploy-db.mjs` 的部署清单内 → 线上其实没有 questions/papers 表，前端静默降级 localStorage，容易误判验收通过。
- 数据模型缺 `paper_questions` / `paper_attempts`，`papers.qids` 用 JSON 字符串存题序 → 不满足判分/解析/去重要求。
- `shell-guard.ts` 未加 `/english` → 工作端壳会被拦回各自首页。

---

## 2. 目标架构

```
入口层  /english（聚合）  /questions（题库）  /papers（试卷）   [/words 三页 原样复用]
           │
服务层  generateQuestionsFromText()  parseAIQuestionsJson()  createPaper()  submitPaperAttempt()
           │                              ↳ 复用 askSunshine()，一期零新后端
数据层  questions / papers / paper_questions / paper_attempts
           ↳ CloudBase PG，RLS: auth.uid()::text = uid，仅本人读写
```

### 2.1 路由规划

| 路由 | 用途 | 状态 |
|---|---|---|
| `/english` | 英语聚合页（单词三页入口 + 题库/试卷入口） | 已建，待验收 |
| `/english/bank` | 出题 / 题库（粘贴导入 + 列表 + 编辑删除） | 已建，等价 `/questions` + `/questions/import` |
| `/english/exam/:paperId` | 答题 | 已建，等价 `/papers/:id/take` |
| `/questions` | 题库列表（筛选/搜索/来源） | 建议合并进 `/english/bank` |
| `/questions/import` | 粘贴导入 | 同上 |
| `/questions/new` | 手动新增 | 待建 |
| `/papers` | 试卷列表 | 建议合并进 `/english` |
| `/papers/new` | 组卷 | 待建（或在 bank 页勾选组卷） |
| `/papers/:id/result` | 结果页 | 待建（现在结果直接在答题页内） |
| `/private/cet4` | OP-E 私有真题库入口 | 阶段 4 可选 |

> **建议**：路由已按 `/english/*` 成型且更短，不必再铺一套 `/questions`、`/papers`。把任务书的路由建议理解为「功能清单」而非「URL 清单」，避免两套路由并存。

---

## 3. 数据模型（CloudBase 改写版）

`docs/release/qbank.sql`（**必须放 `docs/release/` 并加进 `tools/deploy-db.mjs` 的 FILES**）

```sql
create table if not exists public.questions (
  id            text primary key,
  uid           text not null,
  source_type   text not null default 'paste',   -- paste | ai | manual | docx | cet4_2025_12
  source_ref    text,
  subject       text not null default '未分类',
  question_type text not null default 'single_choice', -- single_choice|multi_choice|judge|blank
  stem          text not null,
  options       jsonb not null default '[]'::jsonb,
  answer        text not null,
  explanation   text not null default '',
  difficulty    int  not null default 3,
  tags          text[] not null default '{}',
  content_hash  text not null,
  created_at    timestamptz not null default now()
);

create table if not exists public.papers (
  id         text primary key,
  uid        text not null,
  title      text not null,
  config     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.paper_questions (
  id          text primary key,
  uid         text not null,
  paper_id    text not null references public.papers(id) on delete cascade,
  question_id text not null references public.questions(id) on delete cascade,
  sort_order  int not null default 0,
  score       numeric not null default 1
);

create table if not exists public.paper_attempts (
  id            text primary key,
  uid           text not null,
  paper_id      text not null references public.papers(id) on delete cascade,
  answers       jsonb not null default '{}'::jsonb,
  score         numeric not null default 0,
  correct_count int not null default 0,
  total_count   int not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists idx_questions_uid   on public.questions (uid, created_at desc);
create index if not exists idx_questions_hash  on public.questions (uid, content_hash);
create index if not exists idx_questions_src   on public.questions (uid, source_type);
create index if not exists idx_papers_uid      on public.papers (uid, created_at desc);
create index if not exists idx_pq_paper        on public.paper_questions (paper_id, sort_order);
create index if not exists idx_pa_paper        on public.paper_attempts (paper_id, created_at desc);

alter table public.questions       enable row level security;
alter table public.papers          enable row level security;
alter table public.paper_questions enable row level security;
alter table public.paper_attempts  enable row level security;

drop policy if exists questions_self on public.questions;
create policy questions_self on public.questions
  for all using (auth.uid()::text = uid) with check (auth.uid()::text = uid);
-- papers / paper_questions / paper_attempts 同构（后两张自带 uid 列，可直判）

drop policy if exists pq_via_paper on public.paper_questions;
create policy pq_via_paper on public.paper_questions
  for all using (auth.uid()::text = uid) with check (auth.uid()::text = uid);
drop policy if exists pa_via_paper on public.paper_attempts;
create policy pa_via_paper on public.paper_attempts
  for all using (auth.uid()::text = uid) with check (auth.uid()::text = uid);
```

配套回滚：`docs/release/qbank_rollback.sql`
```sql
drop table if exists public.paper_attempts cascade;
drop table if exists public.paper_questions cascade;
drop table if exists public.papers cascade;
drop table if exists public.questions cascade;
```

**去重**：`content_hash = md5(stem || '|' || answer || '|' || question_type)`，入库前批量剔除已存在 hash；建议加 `create unique index ... on questions (uid, content_hash)` 兜底。

---

## 4. 阶段卡

### 阶段 1 · OP-B 英语聚合页

**目标**：`/english` 可访问；三页无回归；首页/服务页入口可点；移动端不崩。

**改动文件**
- `src/App.tsx`：确认 `/english` 路由（已挂）
- `src/lib/shell-guard.ts`：`USER_ONLY_PREFIXES` 追加 `/english`
- `src/data/mock.ts`：`homeServices` + `campusServices` 各加 1 条「英语学习 → /english」
- `src/pages/study/StudyHubPage.tsx`：（可选）「单词记忆」旁加「英语学习」快捷格
- `src/pages/english/*`：修现有 TS 报错，不改三页

**SQL**：无

**测试与验收**
1. `npx tsc --noEmit -p tsconfig.app.json` 零报错
2. `/english` 三个单词卡分别跳 `/words`、`/words/duel`、`/words/endless`
3. 三页各自核心流程走一遍（背词翻卡、速对一局、无尽一局）——确认无回归
4. 首页入口、服务页入口可点
5. 移动端视口 375px 无横向溢出、无遮挡
6. HashRouter 场景（App 壳）深链可直达

**风险 / 回滚**
- 风险：`shell-guard` 漏加 → 工作端壳打不开。回滚：删除该条路由与 mock 入口即可，不影响任何现有功能。

---

### 阶段 2 · OP-C 一期 + OP-D 题库导入

**目标**：粘贴文本 → AI 出题 → JSON 校验 → 预览/编辑 → 入库 → 组卷 → 答题 → 判分 → 解析；所有数据仅本人可见。

**改动文件**
```
新增 src/services/qbank/generate.ts   generateQuestionsFromText(text, config)
新增 src/services/qbank/parse.ts      parseAIQuestionsJson(raw)
新增 src/services/qbank/import.ts     createQuestionsFromImport()
新增 src/services/qbank/papers.ts     createPaper() / listPapers()
新增 src/services/qbank/attempts.ts   submitPaperAttempt()
改   src/lib/qbank.ts                 切到新表结构（questions/papers/paper_questions/paper_attempts）
改   src/lib/qgen.ts                  Prompt 强制只输出 JSON；产出对齐 question_type 枚举
改   src/pages/english/BankPage.tsx   接新 service
改   src/pages/english/ExamPage.tsx   判分 + 结果/解析
新增 src/pages/english/ResultPage.tsx （或 ExamPage 内结果态）
新增 docs/release/qbank.sql + qbank_rollback.sql
改   tools/deploy-db.mjs              FILES 追加 qbank.sql
```

**服务层契约**
```ts
generateQuestionsFromText(text, {count, type, difficulty, tags}) -> Promise<{ok, questions, error}>
parseAIQuestionsJson(raw) -> {ok, questions, issues: string[]}
createQuestionsFromImport(rows, source_type) -> {created, dup, failed}
createPaper({title, questionIds|rule}) -> PaperRow
submitPaperAttempt(paperId, answers) -> {score, correctCount, totalCount, perQuestion}
```

**Prompt 硬性要求**：只输出 JSON、不要 Markdown 围栏、不要解释；答案必须落在选项 key 集合内；解析 ≤ 80 字；不编造资料外信息。

**校验清单（前端必做）**
- 字段缺失 / 空题干 → 丢弃并计入 issues
- 答案不在选项内 → 修正或丢弃
- 重复题（content_hash）→ 剔除
- 解析过长 → 截断
- 题型非法 → 归一到 single_choice
- 模型返回 0 题 → 友好提示「模型没返回有效题目，请换一段资料重试」

**错误分类提示**：模型失败 / JSON 解析失败 / 无题目 / 全重复 / 权限失败 各一种文案。

**SQL**：见 §3

**测试与验收**
1. 粘贴 200 字英文材料 → 生成 5 题 → 预览可编辑单题 → 入库
2. 同一段材料重复导入两次 → 第二次「全部重复」， questions 表不增量
3. 题库列表：按来源/题型/标签筛选 + 关键词搜索 + 编辑 + 删除 + 查看来源
4. 组卷：手动选题 3 题 → 生成试卷 → 答题 → 提交 → 得分/正确率/逐题解析/错题标记
5. 刷新页面数据不丢；换账号登录看不到他人数据；退出登录不可见
6. SQL 验证：以 A 账号写入，B 账号 `select` 返回 0 行

**风险 / 回滚**
- 风险：AI 输出不稳定 → 严格校验 + 失败提示，脏数据绝不入库
- 风险：离线包（APK）/`capacitor://` 跨域 → `/api/chat` 可能 CORS 失败，需 fail-safe 文案
- 风险：本地 localStorage 与云端双写 id 冲突 → 统一由前端生成 text id，云端按 `created_at` 较新者覆盖
- 回滚：删 service + 页面，`qbank_rollback.sql` 删表；旧 2 表结构若已部署也一并 drop

---

### 阶段 3 · OP-C 二期 PDF/Word 云函数解析

**目标**：上传 PDF/Word → 私有 storage → 云函数解析 → 分块 → askSunshine 出题 → 入库。

**改动文件**
```
新增 cloudfunctions/docParse/{index.js,package.json}
新增 docs/release/qbank_storage.sql（bucket 策略）
改   src/lib/qbank.ts / BankPage.tsx（上传入口）
```

**要点**
- bucket `qbank-docs` 私有；路径 `uid/<fileId>`；storage policy 仅本人读写
- 云函数：摘要/分块（每块 ≤ 4000 字）→ 逐块出题 → 聚合去重 → 写回
- 超时 / 大文件（> 20MB 拒绝）/ 分片 / 失败重试（最多 2 次）/ 单次成本上限（最多 N 块）
- 前端轮询或一次性等待，失败可重试

**验收**：上传 docx → 出题入库；换账号无法访问该文件；失败有重试按钮与明确提示。

---

### 阶段 4 · OP-E 四六级真题私有题库

**目标**：桌面《2025年12月四级真题答案合辑.docx》只做**仅本人可见**的私有题库。

**方案（合规优先）**
1. **不把真题正文写进源码**。现有 `src/data/cet-bank.ts` 含真题范文/翻译原文，违反约束 5，必须改为：
   - 只保留**词汇表**这类确定性、无版权争议的元数据，或
   - 彻底移除，改为「用户在 `/english/bank` 粘贴真题文本 → 走 OP-D 通用入库管线」
2. 入库时打 `source_type = 'cet4_2025_12'`，题库页提供「来源 = 四级真题 2025-12」筛选
3. 不提供公开链接 / 公开搜索 / 公开下载 / 分享入口
4. `questions` 表 RLS 仅本人 → 天然满足「仅本人可见」

**清理项（必须做）**
- `_cet_docx_text.txt`（仓库根目录，真题抽取文本）→ 加进 `.gitignore` 或直接移出仓库
- 检查 `git status` 确认真题相关文件都是 ignored / untracked 且不会被 `git add .` 带入

**验收**：当前登录用户可见；退出登录不可见；B 账号 `select` 返回 0 行；全站无分享/下载入口；仓库内 grep 不到真题正文。

---

### 阶段 5 · OP-A 暂缓

**本版不做**：番茄升一级入口、底栏直达。

**观察建议（不实施）**
- 埋点看：首页「番茄专注」卡点击量、 `/study/focus` 直达 vs 经 `/study` 中转的比例、完成率（完成/开启）、日均开启次数
- 观察周期：建议 2–4 周、覆盖一个完整考试周与非考试周
- 决策阈值（示例）：若「经 /study 中转占比 > 60%」且「日均开启 ≥ 1.5 次」，再考虑升一级入口；否则保持现状

---

## 5. 全局硬性约束对照

| # | 约束 | 落实方式 |
|---|---|---|
| 1 | 三页原样复用 | 只新增路由/入口，不碰 `src/pages/words/**` |
| 2 | 一期不新增后端 | 复用 `askSunshine()` |
| 3 | RLS 仅本人 | 4 张表全部 `auth.uid()::text = uid` |
| 4 | 不暴露 Key | 前端零 Key，云函数已有 |
| 5 | 不公开版权资料 | 真题不入源码、不分享、不公开搜索下载 |
| 6 | OP-A 暂缓 | 阶段 5 只出观察建议 |
| 7 | 不改无关代码 | 每阶段改动文件白名单化 |
| 8 | SQL 幂等可回滚有索引有 RLS | `if not exists` + rollback + 6 条索引 + 4 张 RLS |
| 9 | 先读后写 | 阶段 0 已完成 |

---

## 6. 执行顺序与检查点

```
[阻塞] 确认 src/pages/english/* 与 src/lib/qbank.ts 等半成品归属
   └─ 沿用 → 先修 tsc 报错 → 阶段 1 验收 → 阶段 2
   └─ 重做 → 按 §2 路由清单从零铺
阶段 1  OP-B        （无 SQL）
阶段 2  OP-C一期+OP-D（4 表 + RLS + deploy-db 接线）
阶段 3  OP-C二期    （新云函数 + 私有 storage）
阶段 4  OP-E        （合规整改 + 私有来源筛选）
阶段 5  OP-A        （只出观察建议，不写代码）
```

每阶段交付物：**改动文件清单 / SQL 迁移与 RLS / 测试与验收步骤 / 风险与回滚 / 下一阶段建议**。
