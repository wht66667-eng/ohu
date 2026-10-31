# 阳光校园生活服务 · 搭建说明

> 当前已整理为电脑管理后台、手机管理端、手机学生端。启动与发布请优先阅读 [三端发布与更新](docs/release-and-update.md)；以下保留既有业务与后端说明。

手机端 H5 原型壳（手机外框 + 底部导航）对接 CloudBase 云端后端的完整工程。

## 1. 安装与启动

在 `xm-main` 目录下依次执行：`npm install`，然后 `npm run dev`。

浏览器打开 http://localhost:43123 。端口可在 `vite.config.ts` 的 `server.port` 调整。
生产构建：`npm run build`（先 `tsc -b` 类型检查，再 `vite build`），产物在 `dist/`。
本地预览产物：`npm run preview`。

## 2. 连的是哪个后端

数据与认证：`src/lib/cb.ts` 的 `CB_ENV_ID` / `CB_REGION`。
云函数（AI 问答 / 楼栋申请 / 课表查询）：本地由 `vite.config.ts` 的 `server.proxy` 把 `/api/*` 反代到网关域。

## 3. 验证已连通真实后端

冷启动时 `AuthProvider` 会在没有会话时静默做一次匿名登录（`anon` 角色只能读 `v_*_public` 脱敏视图），因此游客状态即可看到真实数据。

- 首页「校园公告」显示云端公告标题，「任务&二手最新」显示真实条目（如某条二手物品与价格）。
- 二手集市 / 信息站能列出真实数据；任务大厅、订餐档口若显示空态，说明云端确实还没有该类数据。
- 打开 DevTools 的 Network，应能看到发往 `*.tcloudbasegateway.com` 的关系库请求返回 200。
- 全站 Console 不应出现 `FetchError`，出现即代表会话没建立（见第 5 节）。

## 4. 游客与登录的差别

游客走 `v_*_public` 脱敏视图，看得到内容、看不到联系方式；登录后额外解锁我的发布、报名、下单、宠物与消息中心。
触发受限操作时会自动弹登录面板，支持账号密码与手机验证码两种方式；被封禁的账号登录后会提示原因并自动登出。

## 5. 常见问题排查

**列表全部显示 `FetchError: undefined`。**
关系库客户端在拿到会话之前不会真正发出请求。检查 `AuthProvider` 挂载时是否完成了匿名登录：正常应先看到 `POST .../auth/v1/signin/anonymously` 返回 200，随后才是 `.../v1/rdb/rest/v_*` 请求。

**`/api/*` 返回 404。**
线上函数路由只挂在 HTTPSERVICE 网关默认域上，静态托管域（`*.tcloudbaseapp.com`）不能绑函数路由，所以页面托管在该域时同源请求 `/api/*` 会落到静态桶。
`src/lib/gateway.ts` 已按运行域自动改用网关绝对地址，页面里不要写死域名，统一经 `API_BASE` 拼接。

**写入被拒（permission / RLS）。**
匿名角色对主表读写全拒，属预期行为。敏感操作需先登录；治理类操作走 SECURITY DEFINER 的 RPC。

**UGC 图片 403。**
图片先传到 `images` 桶，`img_state` 三态门控；未过审或已下架的图片拿不到，属正常。

**冷启动首个关系库请求带了奇怪的 uid（形如 `uid=eq.function sub() { [native code] }`）。**
SDK 冷启动时 `getSession()` 可能先返回「尚未解析完」的会话：`user.id` 是 SDK 内部函数、`is_anonymous` 还是 false。
`auth.tsx` 的 `snapshotUser()` 会重试到取到真实 uid 为止，`refresh()` 在 uid 为空时直接按「无会话」处理而不查库，
所以不会再发出脏查询。若在新代码里又看到这种现象，多半是绕开了 `AuthProvider` 自己读 `auth.user.uid`，
请改回 `useAuth()` 的 `isSigned` / `user.uid`。

**端口被占用。**
`server.strictPort` 为真，端口冲突会直接报错退出。释放端口或改 `vite.config.ts` 的 `server.port`。

## 6. 自营角色体系（档口 / 骑手 / 小店）

普通同学在「设置 - 角色工作台」提交申请，管理员在「角色审核台」通过后自动开通对应工作台。

### 6.1 需要先在后端执行的迁移

后端仓库 `campus-life-h5` 的 `cloudbase/migrations/` 下新增了两个迁移，**按文件名顺序执行**（CloudBase 控制台 SQL 编辑器或 CLI）：

| 顺序 | 文件 | 作用 |
| --- | --- | --- |
| 1 | `20260932000000_role_system.sql` | 统一角色层：`role_apps`（申请单）、`role_members`（成员名册）、`role_is_member` / `role_apply` / `role_review` / `role_suspend` / `role_resume`，以及存量回填 |
| 2 | `20260932010000_shop_role_gate.sql` | 小店门禁收口：`shop_products` / `shop_movements` 的写策略从「本人」收紧为「本人且持有 shop 角色」 |

两个文件都是幂等的（`IF NOT EXISTS` / 先 `DROP POLICY` 再 `CREATE`），失败可重复执行。

### 6.2 执行后校验

```sql
-- 名册是否建立（应能看到回填进来的老骑手 / 档口主 / 小店店主）
select role, status, count(*) from public.role_members group by role, status;
-- 申请单
select role, status, count(*) from public.role_apps group by role, status;
-- 当前登录用户是否持有某角色
select public.role_is_member('shop');
```

### 6.3 端到端验收路径

1. 打开 `/settings`，在「角色工作台」点任一未开通角色 → 弹出申请表单（档口 / 骑手 / 小店字段不同）→ 提交成功提示「等待管理员审核」，下方出现「待审核」进度胶囊。
2. 用管理员账号打开 `/settings` → 「管理员 - 角色审核台」右侧出现橙色待审徽标 → 进入 `/admin/roles`。
3. 在审核台对应角色分段点「通过并开通」：档口会自动建 `canteen_stores` 并写入 `ref_id`，骑手自动开通 `rider_profiles`；成员立即出现在「成员名册」。
4. 回到申请人账号刷新 `/settings`：该角色变为彩色入口卡，点按进入 `/work/stall`、`/work/rider`、`/work/shop`。
5. 停用验证：审核台对成员点「停用」后，申请人刷新设置页入口变为「已停用」，且骑手不能再抢单、档口转为歇业。

### 6.4 新增路由

| 路由 | 页面 | 可见条件 |
| --- | --- | --- |
| `/work/stall` | 档口工作台：档口资料 / 订单看板 / 菜品管理 / 今日小结 | 持有 `stall` 角色 |
| `/work/rider` | 骑手工作台：接单开关 / 待接单池 / 我的配送 / 配送统计 | 持有 `rider` 角色 |
| `/work/shop` | 小店工作台：概览 / 商品档案 / 入库-售出-盘点 / 流水账本 | 持有 `shop` 角色 |
| `/admin/roles` | 角色审核台：申请审核 / 成员名册 / 骑手配送调度 | `profiles.is_admin` |

无权限访问时页面显示整屏引导卡（说明原因 + 返回设置页），不会出现空白页。

### 6.5 权限口径

- 前端入口只读 `role_members`（登录时一次性拉取，见 `AuthProvider` 的 `roles` / `hasRole`），**不做权限判断**。
- 真正的写权限在服务端：`role_*` RPC 全部为 SECURITY DEFINER 且校验 `is_admin_user()`；小店写入额外要求 `role_is_member('shop')`。
- 停用/恢复会同步业务侧：骑手 `rider_profiles.status` + `online=false`、档口 `canteen_stores.status='closed'`，避免「前端入口关了但服务端还能写」的漂移。

## 7. 部署

### 7.1 线上环境

| 项 | 值 |
| --- | --- |
| 站点地址 | https://jou-d4gq7a3cqf51e6caa-1394316826.tcloudbaseapp.com |
| 云函数网关域 | https://jou-d4gq7a3cqf51e6caa-1394316826.ap-shanghai.app.tcloudbase.com |
| 环境 ID | `jou-d4gq7a3cqf51e6caa`（ap-shanghai） |

### 7.2 发布步骤

```bash
npm run build          # tsc -b 类型检查 + vite build，产物落 dist/
npm run deploy:hosting # 上传 dist/ 到静态托管（tools/deploy-hosting.mjs）
```

`deploy:hosting` 优先使用本机 `tcb` CLI，未安装时自动改用 `npx @cloudbase/cli`；没有 CLI 登录态的机器可先设置
`CLOUDBASE_API_KEY` 再执行。脚本会先校验产物（`index.html` 存在、`assets/` 非空、资源引用的是域根绝对路径），
再上传，最后打印自检地址。环境 ID 取自 `src/lib/cb.ts`，不会与前端连的后端漂移。

不便用 CLI 时，也可在支持 CloudBase MCP 的编辑器里让 AI 执行静态托管上传，或在控制台直接拖拽 `dist/`。

### 7.3 环境级配置（线上已就绪，换环境时才需重做）

1. **SPA 回退**：未知路径与子路由必须回退到 `index.html`，否则刷新 `/profile`、`/pet`、`/work/*` 会 404。
   线上已配置 `ErrorDocument = index.html`、并把 404 重写到 `index.html`。
2. **Web 安全域名**：静态托管域必须在「环境 - 安全配置 - Web 安全域名」白名单内，否则浏览器会拦掉
   `auth/v1/signin/anonymously` 的跨域预检——页面能打开但读不到云端数据。线上该域已在白名单中。
3. `/api/*` 无需额外配置：`src/lib/gateway.ts` 在非网关域下会自动改用网关绝对地址（见第 5 节）。

### 7.4 发布后验收清单

- 打开站点，首页渲染真实数据（校园公告、「任务&二手最新」）。
- 直接访问 `/profile`、`/pet` 并刷新，页面正常打开而不是 404。
- DevTools Network 里 `auth/v1/signin/anonymously` 返回 200，其后 `/v1/rdb/rest/v_*` 返回 200（见第 3 节）。
- 全站 Console 无 `FetchError`。
- 登录态用例（发布、报名、下单、宠物定制等）需用真实账号人工验收：环境用户配额已满、短信验证码无法自动化，
  自动验收只能覆盖游客（匿名）路径。

### 7.5 其他托管方式

预览沙箱（Cloud Studio）也可托管同一份产物：`npx serve -s -p 43123 .`（`-s` 即 SPA 回退）。
该域同样受环境级 Web 安全域名白名单约束，未加白名单时页面能打开但读不到云端数据；本地 `localhost:43123` 默认可用，所以本地联调不受影响。

## 8. 目录速览

- `src/lib/`：数据层（`cb.ts` 客户端、`gateway.ts` 网关基址、`auth.tsx` 认证、`roles.ts` 自营角色、各业务取数模块）。
- `src/data/`：纯静态目录（`pet.ts` 宠物静态目录、`mock.ts` 只留首页入口文案、`images.ts` 素材）。
- `src/pages/` 页面与 `src/components/` 手机壳组件，样式统一用 CSS Modules。
- 工作台相关：`src/pages/{Stall,Rider,Shop}WorkbenchPage.tsx`、`src/pages/AdminRolesPage.tsx`、`src/pages/work.module.css`；
  复用组件 `RoleApplySheet`（角色申请）、`OrderCard`（档口/骑手共用订单卡）、`DishSheet`、`ProductSheet`、`MoveSheet`。

## 9. 开发约定

- 列表读 `v_*_public` 脱敏视图，登录后才读主表拿联系方式。
- 取数统一返回 `{ rows, error }`，错误文案经 `errText` 提炼后交给全局 toast。
- 列表页统一用 `usePollingRows`：首屏拉取、8 秒轮询、切后台暂停，依赖里已含认证 phase。
- 新增 `/api` 调用必须经 `gateway.ts` 的 `API_BASE` 拼接，不要写死域名。换环境只改 `cb.ts` 的环境常量与 `vite.config.ts` 的 `UPSTREAM`。
- 站内行为通过 `src/lib/pet-hooks.ts` 上报宠物成长：fire-and-forget，游客与未领养会被服务端静默忽略。
- 角色入口统一用 `useAuth().roles` / `hasRole(role)` 判断，不要在页面里自己查 `role_members`；申请与审核一律走 `src/lib/roles.ts`，不要绕过它直写表。

## 10. 钱包 / 财务台 / 营业时间 / 通知中心

补齐经营侧能力：**资金只记账、平台线下打款、后台审核核销**（不接线上支付），外加结构化营业时间、平台强制打烊与站内通知中心。

### 10.1 需要先在后端执行的迁移

根目录 `cloudbase/migrations/` 下新增 9 个迁移，**按文件名顺序执行**（CloudBase MCP 的 `managePgDatabase(action=applyMigration)`，或控制台 SQL 编辑器逐个粘贴）：

| 顺序 | 文件 | 作用 |
| --- | --- | --- |
| 1 | `20260933000000_wallet_schema.sql` | 建 `wallets`（可用/冻结余额）、`wallet_ledger`（收支流水）、`withdraw_apps`（提现申请）、`commission_rules`（抽成费率）、`notifications`（站内通知）与索引、RLS；`canteen_orders` 追加结算列 |
| 2 | `20260933010000_wallet_rpc.sql` | `order_settle()` 结算实现 + 订单终态 `AFTER UPDATE` 触发器；`withdraw_apply` / `withdraw_review` / `commission_set` RPC 与授权收口 |
| 3 | `20260933020000_store_hours.sql` | `canteen_stores` 加 `hours_slots` / `force_closed` / `force_close_note`；`canteen_store_open()` 追加「未被平台强制打烊」判断（下单门禁收口在此，不重建 RLS）；商家自改强制状态的守卫触发器；`store_force_close` RPC |
| 4 | `20260933030000_notify_center.sql` | 订单事件触发器（下单通知档口主、状态变化通知买家/档口/骑手、结算入账通知双方）+ `notify_push` / `notify_mark_read` / `notify_mark_all_read` |
| 5 | `20260933040000_settle_delivery_fix.sql` | 结算修正：配送单终态是 `delivery_status='done'`（`status` 停在 `ready`），原触发条件会漏结算骑手佣金与档口收入；放宽条件为「`status='done' OR delivery_status='done'」并做一次幂等补偿结算 |
| 6 | `20260933050000_commission_toggle.sql` | `commission_set` 增加第 5 个参数 `p_enabled`，支持单档口「恢复跟随全局」（置 `enabled=false`，保留已填比例） |
| 7 | `20260933060000_wallet_hardening.sql` | 资金 5 张表收回 `authenticated` 的平台默认写权限，只留 `SELECT`，写入必须走 SECURITY DEFINER RPC |
| 8 | `20260933070000_store_hours_gate.sql` | `canteen_store_open()` 追加营业时段判定（Asia/Shanghai + ISODOW，`[start, end)`），与前端 `storeOpenInfo` 同口径，堵住「界面显示已打烊、接口仍能下单」的绕过路径 |
| 9 | `20260933080000_notify_order_dedup.sql` | 通知去重：配送分支由 `ELSE` 收窄为 `ELSIF pool→taken`，否则一单会重复推 4 条「骑手已接单 / 配送任务已领取」 |

全部幂等（`IF NOT EXISTS` / `CREATE OR REPLACE` / 先 `DROP` 再建），失败可重复执行。第 7 个迁移只改授权；第 8、9 个只替换函数体 —— 均不动策略与数据。

### 10.2 执行后校验

```sql
-- 表是否建立（应返回 5 行）
select table_name from information_schema.tables
 where table_schema='public'
   and table_name in ('wallets','wallet_ledger','withdraw_apps','commission_rules','notifications');

-- 结算列是否落库
select column_name from information_schema.columns
 where table_schema='public' and table_name='canteen_orders'
   and column_name in ('settle_status','platform_fee_cent','store_income_cent','rider_income_cent','settled_at');

-- 触发器是否就位（settle / notify_ins / notify_upd / force_guard 四个）
select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid
 where not t.tgisinternal and c.relname in ('canteen_orders','canteen_stores') order by 1,2;

-- 授权收口：authenticated 应只有 SELECT，anon 应无任何权限（第 7 个迁移后）
select table_name, string_agg(privilege_type, ',' order by privilege_type) as privs
  from information_schema.role_table_grants
 where table_schema='public' and grantee='authenticated'
   and table_name in ('wallets','wallet_ledger','withdraw_apps','commission_rules','notifications')
 group by table_name order by table_name;

-- 费率是否已有全局默认（没有则 order_settle 走内置默认 500bp / 1000bp）
select scope, ref_id, commission_bp, rider_bp, enabled from public.commission_rules order by scope, ref_id;
```

### 10.3 数据口径（改动前必读）

- **金额单位**：新表与新字段一律 **integer 分**，字段名以 `_cent` 结尾；只有 `canteen_orders.total` 是 integer 元，换算关系为 `total * 100`。前端展示统一走 `src/lib/wallet.ts` 的 `money()` / `fen2yuan()`，页面里不要手写 `(x/100).toFixed(2)`。
- **比例单位**：一律 **基点 bp**（万分之一），`500 bp = 5%`，结算为整数运算 `round(total_cent * bp / 10000)`，无浮点误差。
- **费率解析优先级**：`scope='store' AND ref_id=档口id AND enabled` → `scope='global' AND ref_id=0 AND enabled` → 内置默认（`commission_bp=500`, `rider_bp=1000`）。
- **结算触发**：`canteen_orders` 的 `AFTER UPDATE` 触发器，命中「`settle_status='none'` 且订单到达业务终态」（pickup 看 `status='done'`，delivery 看 `delivery_status='done'`），内部先 `SELECT ... FOR UPDATE` 锁行再入账并置 `settle_status='settled'`，天然幂等。
- **下单门禁**：`canteen_store_open(store_id)` 统一判定「档口 `status='open'` 且未被平台强制打烊且在营业时段内」，`canteen_orders` 的 INSERT 策略引用该函数；商家自设开关与平台强制打烊互不覆盖。
- **营业时间**：`hours_slots jsonb` 形如 `[{d:1,start:"10:30",end:"13:30"}]`（`d` 为 1=周一…7=周日）；`hours_text` 保留为展示文案，`hours_slots` 为空时前端回退用旧文本，旧数据零迁移。

### 10.4 新增路由与入口

| 路由 / 入口 | 页面 | 可见条件 |
| --- | --- | --- |
| `/wallet` | 我的钱包：余额卡（可用/冻结）+ 日期分组流水 + 提现记录 + 提现申请 | 已登录；多身份时顶部可切换档口/骑手账户 |
| `/admin/finance` | 财务与费率：提现审核 / 费率设置 / 商家经营（含强制打烊）三段 | `profiles.is_admin` |
| `/notify` | 通知中心：未读置顶（浅绿底 + 绿条）+ 点击标记已读并跳 `link` + 全部已读 | 已登录 |
| `设置 - 账号` | 「我的钱包」入口 | 已登录 |
| `设置 - 管理员` | 「财务与费率」入口（带待审数量徽标） | `profiles.is_admin` |
| `消息 - 顶部` | 「通知中心」入口（带未读红点，20 秒轮询） | 已登录 |
| `档口/骑手工作台 - 钱包页签` | 复用 `WalletPanel`，无独立导航栏 | 持有 `stall` / `rider` 角色 |
| `档口工作台 - 档口资料` | 「营业时间」按周配置（`HoursSheet`）；被强制打烊时页签上方橙色告警条 | 同上 |
| `美食页 档口卡片` | 「营业中 / 已打烊 / 今日休息 / 平台暂停营业」胶囊，非营业时禁加购 | 全部访客 |

新增数据层：`src/lib/wallet.ts`（钱包/流水/提现/费率/收入摘要）、`src/lib/hours.ts`（`slotsToText` / `storeOpenInfo` / `todaySummary`）、`src/lib/notify.ts`（列表/未读数/已读）。
新增组件：`WithdrawSheet`（提现弹层）、`HoursSheet`（营业时间弹层）、`WalletPanel`（钱包面板）、`FinanceStores`（商家经营分段）。

### 10.5 端到端验收路径

资金链路（需真实账号人工验收，短信验证码无法自动化）：

1. **下单**：学生端在营业中的档口下单 → 档口主的 `/notify` 出现「新订单」未读，`消息` 页红点 +1。
2. **推进**：档口接单/出餐 → 买家收到状态通知；配送单骑手抢单 → 送达并点「确认送达」。
3. **结算**：订单达终态后自动结算（无需人工点任何按钮）。用管理员进 `/admin/finance` 的「商家经营」核对：该档口的出餐量 +1、营业额与「档口实收 / 平台抽成 / 骑手佣金」三项之和等于订单金额；档口主与骑手的 `/wallet` 流水各出现一笔 `order_income` / `commission`。
4. **提现**：档口主进 `/wallet` 点「申请提现」→ 填金额（超过可用余额会被服务端拒绝）、真实姓名、支付宝 → 提交后可用余额减少、冻结金额增加，提现记录出现「待打款」。
5. **审核**：管理员进 `/admin/finance - 提现审核` → 「通过并已打款」后该单转「已通过」且冻结清零（线下已完成打款）；若点「驳回」并填原因，金额退回可用余额，申请人收到含原因的站内通知。
6. **费率**：`费率设置` 改全局默认（如 5% → 3%）并保存，页面实时换算示例同步变化；给某档口单独设定后再点「恢复跟随全局」，该档口回落到全局值。
7. **强制打烊**：`商家经营` 选中档口点「强制打烊」并填原因 → 学生端该档口卡片变「平台暂停营业」且不能加购，档口工作台顶部出现橙色告警条与原因，档口主收到通知；解除后自动恢复。
8. **营业时间**：档口主在档口资料的「营业时间」按周配置时段（如周一至周五 10:30-13:30）→ 学生端卡片在时段内显示「营业中」、时段外显示「已打烊」，当天无时段显示「今日休息」。

真库链路自动验收（无需真实账号，事务内跑完自动回滚，零残留）：由于环境里还没有档口与订单数据、短信验证码也无法自动化，资金链路用一段 `DO` 块在数据库内按状态机跑完整流程，末尾主动 `RAISE EXCEPTION` 让整个事务回滚并把每步实测值带在错误信息里。已实测通过的结果：

| 环节 | 实测值 |
| --- | --- |
| 出餐自动入池 | `status='ready'` 后 `delivery_status='pool'`、`rider_uid` 清空 |
| 未达终态不结算 | `{"pending": true, "settled": false}` |
| 结算（20 元、默认 500bp / 1000bp） | `settled`，`fee=100` / `storeIncome=1700` / `riderIncome=200`（分） |
| 幂等重算 | `{"already": true, "settled": false}`，余额不变 |
| 三方入账 | `platform 100` / `档口 1700` / `骑手 200` |
| 提现冻结 | 提 1000 分后 `balance=700`、`frozen=1000` |
| 超额提现 | 拒绝并返回「余额不足，当前可提现 7.00 元」 |
| 审核通过 | `status=approved`，`frozen=0` |
| 审核驳回 | 金额退回，`balance` 复原、`frozen=0`；空原因被拒绝 |
| 营业门禁 | `hours_slots=[]` → `true`；配成其他星期 → `false`；配成本周 → `true` |
| 商家自改强制状态 | 被守卫触发器拒绝 |
| 管理员强制打烊 | `forceClosed=true`、`canteen_store_open=false`、档口主收到通知 |
| 通知去重 | 同一单「骑手已接单」买家 1 条、骑手 1 条（修复前各 4 条） |

收尾核对 `canteen_stores` / `canteen_orders` / `wallets` / `wallet_ledger` / `withdraw_apps` / `notifications` / `rider_profiles` 中 `__t_%` 测试数据计数全为 0，确认回滚干净。

游客（匿名）自动验收：`npm run dev` 后打开 `/wallet`、`/notify` 应显示登录门控，`/admin/finance` 应显示「仅管理员可访问」引导卡，`/food` 档口卡片显示营业状态胶囊，全站 Console 无 `FetchError` 与 401。

### 10.6 回滚语句

```sql
-- 9）通知去重回滚：把 canteen_order_notify_trigger() 里的
--    ELSIF OLD.delivery_status = 'pool' AND NEW.delivery_status = 'taken' THEN
--    改回 ELSE（即 20260933030000_notify_center.sql 的原始定义）
-- 8）营业时段门禁回滚：canteen_store_open(bigint) 还原为
--    「status='open' AND force_closed=false」（即 20260933020000_store_hours.sql 的定义）
-- 7）授权收口回滚（仅应在补齐 RLS 写策略后执行）
GRANT INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.wallets TO authenticated;
-- 其余 4 张表同理
-- 6）commission_set 回到 4 参版本
DROP FUNCTION IF EXISTS public.commission_set(text, bigint, integer, integer, boolean);
-- 5）结算触发器回到只认 status='done'，并把 canteen_settle_impl 还原为 20260933010000 的定义
DROP TRIGGER IF EXISTS trg_canteen_orders_settle ON public.canteen_orders;
CREATE TRIGGER trg_canteen_orders_settle AFTER UPDATE ON public.canteen_orders
  FOR EACH ROW WHEN (new.settle_status='none' AND old.settle_status='none' AND new.status='done')
  EXECUTE FUNCTION public.canteen_order_settle_trigger();
-- 4）通知中心
DROP TRIGGER IF EXISTS trg_canteen_orders_notify_ins ON public.canteen_orders;
DROP TRIGGER IF EXISTS trg_canteen_orders_notify_upd ON public.canteen_orders;
DROP TRIGGER IF EXISTS trg_canteen_stores_force_guard ON public.canteen_stores;
DROP TABLE IF EXISTS public.notifications;
-- 3）营业时间：先还原 canteen_store_open()，再删列
ALTER TABLE public.canteen_stores DROP COLUMN IF EXISTS hours_slots;
ALTER TABLE public.canteen_stores DROP COLUMN IF EXISTS force_closed, DROP COLUMN IF EXISTS force_close_note;
-- 1~2）资金表（注意：会连同全部流水与提现记录一起删除）
DROP TRIGGER IF EXISTS trg_canteen_orders_settle ON public.canteen_orders;
DROP TABLE IF EXISTS public.withdraw_apps, public.wallet_ledger, public.wallets, public.commission_rules;
ALTER TABLE public.canteen_orders
  DROP COLUMN IF EXISTS settle_status, DROP COLUMN IF EXISTS platform_fee_cent,
  DROP COLUMN IF EXISTS store_income_cent, DROP COLUMN IF EXISTS rider_income_cent,
  DROP COLUMN IF EXISTS settled_at;
```

### 10.7 已知边界

- **不做微信订阅消息**：`wx.requestSubscribeMessage` 与订阅消息下发是小程序专属能力，本工程是浏览器 H5，仓库内没有小程序工程与订阅模板 ID；公众号模板消息还要求用户关注服务号并绑定 openid。故本期交付「服务端事件 → `notifications` 表 → 通知中心 + 未读红点 + 轮询」的完整站内闭环，表中保留 `kind` / `link` / `ref_id` 供后续接小程序端或服务号复用。
- **不接线上支付**：提现为线下打款 + 后台点「通过」核销，平台不自建支付通道。
- **提现敏感信息**：`withdraw_apps` 的姓名与支付宝账号只有本人与管理员可见（RLS 收口为「本人或 `is_admin_user()`」），不进入任何 `v_*_public` 视图。
- **自动化验收边界**：环境用户配额已满且短信验证码无法自动化，自动验收只能覆盖游客（匿名）路径；登录态用例按 10.5 人工走一遍。
