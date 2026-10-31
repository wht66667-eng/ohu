# 2000 同时在线：服务端与数据库容量增量审计

日期：2026-10-03。项目：`C:/Users/upwar/Documents/Codex/xm-main/xm-main`。本次只读检查源码、部署代码备份、已有 SQL、官方文档；执行一个内存夹具复现和一个公开 `/api/exam-generator/config` GET。没有读取凭证文件、调用数据库、执行写 RPC、发送模型请求、进行线上压测或修改业务源码。

“2000 同时在线”不等于“2000 个生成任务同时执行”。以下将当前热门读取与未来启用生成后的风险分开，不把理论请求数当成实测吞吐能力。没有云函数真实实例并发配置、数据库规格/连接与慢查询、完整线上索引和执行计划，因此不能给出已经能或不能承载 2000 人的保证。

## 最关键的六项剩余风险

### S01 · P1 · 文件生成缺少平台级任务队列与模型并发预算（启用前必须补）

**证据：** [examGenerator/index.js:166](C:/Users/upwar/Documents/Codex/xm-main/xm-main/cloudfunctions/examGenerator/index.js:166) 的 handler 直接处理每个请求；[205](C:/Users/upwar/Documents/Codex/xm-main/xm-main/cloudfunctions/examGenerator/index.js:205) 解析、[210](C:/Users/upwar/Documents/Codex/xm-main/xm-main/cloudfunctions/examGenerator/index.js:210) 预留次数、[217](C:/Users/upwar/Documents/Codex/xm-main/xm-main/cloudfunctions/examGenerator/index.js:217) 同步调用模型。没有应用级 global queue、信号量、用户速率或平台每日模型预算，也没有 admission/retry-after 逻辑。模型超时 [129](C:/Users/upwar/Documents/Codex/xm-main/xm-main/cloudfunctions/examGenerator/index.js:129) 为 35 秒；仓库部署配置 [cloudbaserc.json:22](C:/Users/upwar/Documents/Codex/xm-main/xm-main/cloudbaserc.json:22) 为函数 60 秒、512MB，但这不能证明线上平台的实际限流/实例设置。

**已有保护：** [file-generation.sql:26](C:/Users/upwar/Documents/Codex/xm-main/xm-main/docs/release/file-generation.sql:26) 的 `(uid,request_id)` 唯一约束防同单重复；[66](C:/Users/upwar/Documents/Codex/xm-main/xm-main/docs/release/file-generation.sql:66) 的 advisory transaction lock 原子保护同 UID 的次数账。它只在短数据库事务内持有，不跨模型请求；[99–114](C:/Users/upwar/Documents/Codex/xm-main/xm-main/docs/release/file-generation.sql:99) 没有拒绝同用户其他 requestId 的 running 任务。因此单次幂等不等于模型整体并发受控。

**风险与补全：** 活跃用户集中生成会直接形成大量长请求，竞争函数实例、模型 RPM/TPM 和数据库额度操作；上游限额触发后用户只收到泛化失败。先配置真实平台实例/并发限制并核对模型预算，再提供有限任务队列、每 UID 运行/排队上限、平台并发限额和明确繁忙响应；队列等待与已开始执行的 lease 分开，不能让等待时间耗掉现有五分钟运行租约。

**边界：** 仓库代码与桌面 `.server-private/deployed-code/examGenerator/index.js` SHA256 一致。公开 GET 当前返回 `enabled=false, priceCent=0, canPurchase=false`，所以这是未来开通前的容量门槛，不是当前 2000 人浏览时正在发生的模型风暴。平台外部限流可能已设置，本次没有取得证据。

### S02 · P1 · 额度/幂等检查之前先解析文件，失败与重复请求也消耗重资源

**证据：** [index.js:203–211](C:/Users/upwar/Documents/Codex/xm-main/xm-main/cloudfunctions/examGenerator/index.js:203) 先解码/解析文件，再 `file_generation_reserve` 检查 NO_CREDITS、JOB_RUNNING、重复成功等。解析 DOCX/PDF 时 [parsers.js:54](C:/Users/upwar/Documents/Codex/xm-main/xm-main/cloudfunctions/examGenerator/parsers.js:54) 每次新建 Worker，最多 10 秒，并设置 128MB old generation、16MB young generation；没有 worker pool 或解析并发上限。限制为 JS engine 范围，不能当作进程总内存硬上限，外部 Buffer/ArrayBuffer 不受此配置约束。[Node.js 官方 Worker 文档](https://nodejs.org/docs/latest-v20.x/api/worker_threads.html#new-workerfilename-options)

**本地复现：** 加载真实 handler，仅将认证、解析、数据库替换成内存夹具；同一个 UUID、同一个已认证 UID、零额度同时发 8 个请求，得到 `parsed=8, databaseCalls=8, modelCalls=0`，8 个响应均 402。没有真实 worker/模型/数据库或网络操作。

**补全：** 在文件 buffer 已算出 input hash 后，先做低成本限流及同 requestId/UID 的 admission；把重复成功/正在执行的请求直接返回原状态。可将预留移到解析前，解析失败原子退次数；或单独提供 preflight/claim 状态以免无效文件被计费。将解析纳入 worker pool 或隔离执行队列，限制每实例并发和总运行内存。

**边界：** 调用顺序与无用解析复现确定；真实云函数实例并发、文件解析耗时/内存及冷启动尚未测量。当前生成关闭，不会触发该解析路径。

### S03 · P1 · 热门列表和财务队列没有服务器排序/分页，规模增长首先伤正确性

**证据：** [market.ts:83–98](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/market.ts:83)、[canteen.ts:295–306](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/canteen.ts:295)、[shops.ts:304–315](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/shops.ts:304) 都用 `select('*')`，先 `limit`，再本地排序；没有 range/cursor/order。集市/任务 [market.ts:135–143](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/market.ts:135) 取 200 再展示 50，并不能保证返回最新 50。订单固定 100/300，未提供历史分页。

**财务影响：** [wallet.ts:279–295](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/wallet.ts:279) 提现先取 200，再将 pending 排到前面；未取回的新待审单依然无法出现。已有纯内存复现：201 条提现的最后一条待审，列表和徽标均为 0；301 条流水，最新 ID 301 未取回，钱包列表最新显示 ID 120。[完整复现与金额口径](C:/Users/upwar/Documents/Codex/2026-10-01/referenced-chatgpt-conversation-this-is-an-2/outputs/audit-commerce-admin-2026-10-03.md)

**补全：** 在服务器先筛选 pending/进行中，再按稳定 `(created_at,id)` 或单调 ID 排序并游标分页；首页只查需要的投影字段和 20–50 条。待办数和金额统计使用完整 server-side count/sum，不能扩大 limit 掩盖问题。`ORDER BY + LIMIT` 与匹配索引可以只取前 N 条，避免先扫描/排序所有行。[PostgreSQL 官方排序索引文档](https://www.postgresql.org/docs/current/indexes-ordering.html)

**边界：** 取法及正确性风险静态确定。当前线上表大小、每条返回字节数与实际执行计划未知，不能仅凭 limit 断言数据库正在全表扫描。

### S04 · P1 · 热门读取存在评价 N+1 和目录过量读取；未发现逐条 profile 查询

**证据：** 餐饮页面 [FoodPage.tsx:75](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/FoodPage.tsx:75) 查订单，订单数据层 [canteen.ts:449–454](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/canteen.ts:449) 另查一次档口目录，本页面 [83–88](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/FoodPage.tsx:83) 再为最多 12 张完成单各查一次评价。仅“刷新我的订单”部分最多约 14 次关系库读取。2000 个具有 12 张完成单的用户集中刷新时，理论上可放大至约 28000 次调用；这是极端场景算术，不是在线流量测量。

小店街 [shops.ts:474–507](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/shops.ts:474) 已用两次并行批量读取避免逐店 N+1，这是已有优化；但每次都拉最多 200 店+800 商品，再本地分组/展示。目录有 800 商品且 2000 人集中刷新时，商品行交付可达 160 万行/轮；实际商品大小、返回量和客户端周期由主报告另算。

**补全：** 评价状态按本次完成订单 ID 批量查询，或随订单视图/RPC 返回 `has_review`；档口摘要按订单涉及的 storeId 读取或短期缓存。小店街首页只查店铺卡片和有限商品预览，详情按店取商品；公共目录适合可版本化缓存，动态库存/营业状态使用独立、较小的更新路径。

**边界：** 本次 `market.ts/canteen.ts/shops.ts` 没找到逐行 `.from('profiles')`，作者名主要是记录字段；不要写“热门列表每条查 profile”。公共视图的 SQL 定义未完整备份，其内部是否关联 profile、聚合评分的成本未知。HTTP 返回 rows 数不等于 SQL 读取 rows 数。

### S05 · P1 · 峰值经营写入缺少进销存原子事务，库存一致性不能靠扩容解决

**证据：** [MoveSheet.tsx:61](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/components/MoveSheet.tsx:61) 从 UI 旧库存计算绝对新库存；[95–110](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/components/MoveSheet.tsx:95) 两次请求先 INSERT 流水再 UPDATE 库存；[shop.ts:175](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/shop.ts:175) 无版本条件或旧值比较。两终端从 10 分别售出 3/4，可将库存写成 7/6 而非正确 3；网络或负载使第二次请求失败时流水与库存分离。

**补全：** 将商品锁/校验、流水和按增减量更新合并到单一幂等服务端 RPC，盘点增加版本控制；峰值验证应包括同 SKU 并发、断网重试与补偿，不能只有页面吞吐。商品主键索引能快速定位行，不能使两个请求变成一个事务，也不能避免客户端覆盖。

**边界：** 客户端非原子方案静态确定。没有拿到线上全部库存触发器；后端可能额外拒绝不一致写入，需测试环境验证。线上下单的 `shop_order_place` 已设计为服务端原子操作，不把内部手工进销存缺陷扩大成所有下单都不原子。

### S06 · P1（容量核验缺口）· 经营聚合和业务历史表的实际索引覆盖尚不可验证

**证据：** [operations-governance.sql:313–329](C:/Users/upwar/Documents/Codex/xm-main/xm-main/docs/release/operations-governance.sql:313) 的经营名单 RPC 对每家店执行订单、商品、拼团多个相关 count；名单本身不分页。表大而匹配索引缺失/选择不佳时，这种组合会放大数据库扫描工作。当前可读 SQL 未包含原始交易/钱包/角色迁移定义，不能从可见文件证明这些业务查询已有覆盖索引，也不能反向断言线上没有索引。

**补全：** 用只读 `pg_indexes`/`pg_stat_user_indexes`/视图定义和真实执行计划盘点历史业务表；选择测试或低峰生产的无副作用查询，核验 `buyer_uid`/`rider_uid`/`store_id + status + 排序键`、`wallet_ledger(uid,account,id)`、`withdraw_apps(status,id)`、`role_apps(role,status,created_at)`。批量 grouped aggregate 代替逐店相关 count，并按真实结果决定 partial/composite 索引，不盲目给每列建索引。复合 B-tree 的前导过滤列与排序列关系需要按实际查询匹配。[PostgreSQL 官方多列索引文档](https://www.postgresql.org/docs/current/indexes-multicolumn.html)

**边界：** 聚合结构确定；缺索引、全表扫描及饱和是待验证条件。未做线上 EXPLAIN、压测或数据库读取，不给 DB QPS 上限结论。

## 可见迁移中的既有索引覆盖

以下指 SQL 声明能支持的查询类型，不是线上已创建/已命中的证明。

| 模块 | 可见声明与位置 | 能支持的范围/剩余限制 |
|---|---|---|
| 文件生成任务 | [file-generation.sql:26](C:/Users/upwar/Documents/Codex/xm-main/xm-main/docs/release/file-generation.sql:26) `(uid,request_id)` unique；[51](C:/Users/upwar/Documents/Codex/xm-main/xm-main/docs/release/file-generation.sql:51) `(uid,lease_expires_at)` where running | UID 内幂等查找与 UID 内到期回收；不是跨 UID 的排队/总并发限额。 |
| 文件生成账本 | [file-generation.sql:44](C:/Users/upwar/Documents/Codex/xm-main/xm-main/docs/release/file-generation.sql:44) `(job_id,kind)`、`(payment_provider,verified_payment_ref)` unique | 原子去重预留/退款/购买；不限制 parser/model 并发。 |
| 私人题库/试卷 | [qbank.sql:56–64](C:/Users/upwar/Documents/Codex/xm-main/xm-main/docs/release/qbank.sql:56) UID+created_at、UID+content_hash、paper_id+sort_order 等 | 本人时间列表、题目去重、试卷关联题排序已有明确覆盖基础；不用于公共交易或钱包。 |
| 官方题库 | [exam-bank.sql:47–50](C:/Users/upwar/Documents/Codex/xm-main/xm-main/docs/release/exam-bank.sql:47) `(exam_type,question_type,year,id)`、vocab `(exam_type,id)`、passage `(exam_type,id)` | 完整筛选前缀和词汇按 ID 分页可利用；只筛 exam_type 又按全局 id 排序不一定能直接用前者消除排序，需实际 plan。 |
| 广场/群聊 | [plaza.sql:13–26](C:/Users/upwar/Documents/Codex/xm-main/xm-main/docs/release/plaza.sql:13) `(room_id,id DESC)`、creator、posts id | 按 room 增量消息和作者查询具备索引；热帖 views/likes 另有 [plaza-post-stats.sql:12](C:/Users/upwar/Documents/Codex/xm-main/xm-main/docs/release/plaza-post-stats.sql:12)。 |
| 举报审核 | [reports_target_type.sql:43](C:/Users/upwar/Documents/Codex/xm-main/xm-main/docs/release/reports_target_type.sql:43) `(status,created_at DESC)` | 服务器按状态筛选并按时间排列的审核队列；客户端先 limit 再排序仍不能保证完整待办。 |
| 交易/钱包/角色 | 原始核心迁移在本次目录中不完整 | 实际索引未知；不得当作“已覆盖”或“全都没索引”。 |

## API 与已有保护的必要区分

- 官方题库 API 已有 [examApi/index.js:61–69](C:/Users/upwar/Documents/Codex/xm-main/xm-main/cloudfunctions/examApi/index.js:61) 默认 20、最大 100、服务器 `order('id') + range`；不能说所有 API 都无分页。但允许 page=10000，深页 offset 可能昂贵；响应 [18](C:/Users/upwar/Documents/Codex/xm-main/xm-main/cloudfunctions/examApi/index.js:18) 为 no-store，是否需要改游标/对获授权公共内容缓存取决于实际访问。源文件在 `cloudfunctions/examApi`，桌面部署备份没有同名目录，因此没有证明此函数当前由网关承接。
- 文件生成 JWT 公钥有实例内缓存与刷新合并：[auth.js:5–27](C:/Users/upwar/Documents/Codex/xm-main/xm-main/cloudfunctions/examGenerator/auth.js:5)。不是每条请求都去拉公钥。冷启动多实例各自首次取证书仍需平台观测。
- 文件大小、文本量、Worker 堆、解析时间、模型时间均已设界限；还缺平台整体 admission 和真实压力数据，不能写成“完全没有限制”。
- `file_generation_status` 和 `/jobs/:requestId` 读取会通过 `_file_generation_expire` 回收/退次数，实际可能写数据库；本次没有把它们当纯读取去调用。

本地复现：[容量只读内存夹具](C:/Users/upwar/Documents/Codex/2026-10-01/referenced-chatgpt-conversation-this-is-an-2/outputs/capacity-server-repro-2026-10-03.cjs)。现阶段最先改善的是服务器分页/待办过滤、批量评价读取、目录响应大小和库存事务；生成队列与并发预算在明确开通之前完成。压测必须另在隔离环境验证，不能从静态代码推算出云服务承载承诺。
