# 好友授权和决定事务修复（1.2.131）

此前服务端允许本人直接创建 `accepted` 申请和本人好友边，并允许收件人改写申请参与者；客户端的申请校验无法阻止绕过 UI 的请求。朋友圈可见性依赖这两条记录，因而存在越权风险。接受操作也由两个独立写入组成，后一步失败后再拒绝会遗留好友边。

## 实现

`docs/sql/friends-authorization-131.sql` 在同一部署事务中创建三项触发器和三个函数，收紧三个写策略及客户端 TRIGGER／TRUNCATE 权限。

- 创建申请只能是当前发送人的 pending 状态，收件人不能是自己或空值。
- 只有收件人能将 pending 改为 accepted／rejected；编号、双方 UID、消息、头像、姓名及原始时间均不可随决定改写。
- accepted 的 AFTER 触发器在同一数据库事务建立好友边；写边失败会撤销状态变更。既有任一方向的边保持原样；对同一无序账号对使用事务级 advisory lock，减少相反申请同时接受时的重复写入。
- 新前端 `src/lib/friends.ts` 只写申请决定并验证返回行，不再独立创建好友边。
- 兼容 130：旧代码先插入好友边。只有确实存在发送给当前用户的对应 pending 申请时，BEFORE INSERT 才以零行成功跳过这一步，不写半成品边；旧代码之后的状态更新触发真正的原子建边。其他客户端任意建边均拒绝。
- 三个触发器函数均关闭 PUBLIC／anon／authenticated 的 EXECUTE；特权函数固定 search_path，使用限定表名，并重新检查实际收件人。仅实际表 owner、SUPERUSER 或 BYPASSRLS 可绕过普通请求校验；继承 authenticated 的其他角色遵守相同边界。部署前检查函数 owner 能绕过好友表的客户端 RLS。

不修改或删除任何历史业务行、账号、动态、申请或好友边。历史上已有的无法确认来源的关系不会被自动认领、重写或删除；此次保证新的申请流程不再产生伪造状态和半成品边，历史数据如需审核应另行做有依据的人工核对。

## 验证

生产部署前只读目录备份 `docs/audit/friends-schema-before-131.json`：2026-10-22，生产 PostgreSQL 17.10，两张表的 owner 均为现有 CLI 管理角色，RLS 已启用且未 FORCE；客户端无公共 schema CREATE 或 BYPASSRLS，原有 TRIGGER／TRUNCATE 权限已纳入收紧范围。没有读取个人申请或动态行。

隔离 SQL 测试：`tools/friends-authorization-131.test.mjs` 使用 PGlite 0.5.11 的真实 PostgreSQL 18.6 引擎执行原始迁移 SQL、RLS、PL/pgSQL 触发器和失败事务回滚。15 个 SQL 场景均通过，包含初始 accepted 伪造、收件人改写参与者、继承 authenticated 的角色边界、直接建边、130 旧序列、故障后拒绝、历史数据保持、朋友圈真实 RLS、函数与表权限、重复迁移。旧客户端兼容是 SQL 与现有 SDK 调用形态验证，尚无真实账号端到端网络验收；相反申请测试按顺序执行，不等同于多连接并发验收。

客户端测试 `tools/friends-session.test.mjs` 共 17 项，覆盖接受失败、重试、拒绝、账号 A→B→A、迟到成功、页面锁定与登录态，结合 SQL 测试合计 33 项通过；再加朋友圈 9 项回归，共 42 项通过。TypeScript 检查通过。

审查中另外复现并修复了最初 SQL 的继承角色边界问题：若仅按角色名字跳过检查，继承 authenticated 的收件人可在拒绝时改写申请来源和正文。修复前的纯隔离证据为 `.codex/qa/friends131-inherited-before.json`；正式 SQL 已使用真实特权身份判断，新增用例验证拒绝与接受均不能改写参与者。

- 精确 SQL 哈希及 SQL 证据：`.codex/qa/friends131-sql-test.json`。
- 测试输出：`.codex/qa/friends131-final-tests.log`。
- 类型检查：`.codex/qa/friends131-types.log`。
- SQL 测试引擎隔离在 `.codex/qa/friends131-pg`，未修改应用依赖清单。干净副本运行前安装：`npm install --prefix .codex/qa/friends131-pg --no-save --package-lock=false --ignore-scripts @electric-sql/pglite@0.5.11`。

## 部署与验证工具

仅根代理审阅 SQL 后才应用。`tools/friends-db-131.mjs --backup` 保存不覆盖的原始只读备份。`--apply --reviewed-sha256 HASH` 只执行这份固定 SQL，要求备份环境匹配且精确同哈希隔离测试通过，不接受任意 SQL 参数。

部署后 `--audit` 验证三个触发器、函数不可调用、受限写策略和权限；`--role-check` 只用 EXPLAIN（无 ANALYZE）与 WHERE false 验证 authenticated 角色的查询／状态更新可规划，不执行业务更新。成功应用记录为 `docs/audit/friends-policy-deployed-131.json`，只读结果为 `friends-schema-readonly-131.json` 和 `friends-role-check-131.json`。

此说明创建时 SQL 仅完成本地隔离验证，尚未由子代理应用生产。最终生产状态须以根代理实际应用记录及后续目录核验为准。

相关 PostgreSQL 行为依据：[触发器行为](https://www.postgresql.org/docs/current/trigger-definition.html)、[行级安全](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)、[函数安全上下文](https://www.postgresql.org/docs/current/sql-createfunction.html)。
