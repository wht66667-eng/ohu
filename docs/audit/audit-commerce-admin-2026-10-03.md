# 交易、餐饮、小店、钱包、管理员与五端业务闭环审计

审计日期：2026-10-03。源码基线：`C:/Users/upwar/Documents/Codex/xm-main/xm-main`，HEAD `5f97138`。已阅读 `design-system/campus-ui.md` 与 `.codex/skills/ui-refactor-sunshine/SKILL.md`；本报告以真实路由、权限与资金状态为准，不因旧注释或 TODO 单独判定未完成。

全部检查为只读。仅进行一次公开支付配置 GET 与本地内存夹具复现；没有调用数据库、订单/支付/退款/提现/审核 RPC，没有部署，没有改动业务源码，也没有读取密钥文件。线上数据库 RLS、核心触发器和 RPC 未直接审计，相关结论明确保留验证边界。

## 当前已具备的能力

- 餐饮端已有档口菜单、下单、档口接单/出餐/取餐完成、骑手抢单/配送推进、管理员派单入口，不能称为“餐饮后端都没做”。
- 小店已有实际店主身份核验、申请审批建店、商品货架、服务端下单/库存回补、订单看板、拼团、进销存、营业时段与经营资格撤销接口。
- 档口和骑手已有钱包、流水、提现申请；管理员已有线下打款核销/驳回、费率配置和经营统计。它采用人工打款模型，缺少自动转账本身并不构成故障。
- 五端有各自首页与路由限制；角色准入并非只看本地开关，小店会核验服务端 `shop_stores.owner_uid`。经营治理 SQL 明确保留历史订单与流水，不能误判为撤权直接删账。

## 已确认的优先问题

### C01 · P1 · 真实收款仍未接入（线上模式已核对）

**实际场景：** 用户在发布版本餐饮/小店收银台点“微信支付”。当前线上函数处于 `mock` 模式，不产生真实扣款；如果希望项目开始实际收费，这条链路尚不成立。即使配齐商户参数切到 `live`，保存的部署代码仍直接拒绝真实下单/回调，Android/iOS 原生端也未实现调起支付。

**证据：** 只读 GET `https://jou-d4gq7a3cqf51e6caa-1394316826.ap-shanghai.app.tcloudbase.com/api/pay/config` 返回 `mode=mock`、`liveReady=false`。仓库 `cloudfunction/pay/index.js` 与桌面 `.server-private/deployed-code/pay/index.js` SHA256 一致。实际执行分支见 [支付函数：真实下单返回 501](C:/Users/upwar/Documents/Codex/xm-main/xm-main/cloudfunction/pay/index.js:189)、[真实回调未验签并返回 501](C:/Users/upwar/Documents/Codex/xm-main/xm-main/cloudfunction/pay/index.js:239)、[原生端真实支付不支持](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/native-pay.ts:67)。本地以占位配置执行对应处理函数，真实下单和带签名头回调均返回 501。

**补全方案：** 实现服务端订单金额回查、真实商户下单、回调验签/解密/幂等落账、支付查询补偿；为 App 接 OpenSDK 或合规 H5 支付，为普通浏览器提供可用通道。上线前用一笔真实小额订单验证付款、履约、退款、到账及对账。生产 UI 在服务未开通时应明确保留线下付款，避免“支付成功”被当成实际到账。

**确定性：** 线上当前模式 + 源码静态确定。没有读取 PG `pay_config.mode`，没有验证 mock 订单是否进入提现可用余额；不能据此宣称已发生真实资金损失。收费前这属于阻断项；若项目明确仅演示，应按测试功能管理。

### C02 · P1 · 餐饮买家端缺少完整订单详情与恢复入口

**实际场景：** 买家关闭收银台、付款失败、想取消未接单餐单，或等骑手送餐时，没有完整的餐饮订单操作页。餐饮“我的订单”仅显示档口、业务状态与金额，无法在该处重付/取消/确认收餐，也不显示取餐码、支付态、骑手进度和联系电话。有旧的待评价订单时，进行中订单会被待评价列表替代。

**证据：** [FoodPage 获取后仅保留最近 8 单](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/FoodPage.tsx:82)；[待评价列表替代最近订单，只提供评价按钮](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/FoodPage.tsx:239)；[唯一餐饮收银台只依赖新下单后的 cashier 状态](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/FoodPage.tsx:524)。全 `src` 检索，`setOrderStatus` 的页面调用仅在档口工作台；`kind="canteen"` 的收银台只有上述一处。消息中心虽显示餐单摘要，但仅跳回 `/food`。作为对照，小店已有 [订单重新付款入口](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/ShopStreetPage.tsx:472)。

**补全方案：** 增加餐饮订单列表/详情，优先展示进行中订单，并独立展示待评价；接入服务器允许的取消、重新付款和确认动作，展示取餐码、支付/履约状态、配送阶段及联系方式，配轮询/实时更新和失败重试。服务端继续校验状态，前端不要独立决定交易终态。

**确定性：** 当前用户可达前端静态确定；数据库是否支持所有所需动作需联调。待评价遮住进行中订单无需线上数据即可由渲染分支确定。

### C03 · P1 · 管理员撤销经营资格后缺少接管未完成订单的操作台

**实际场景：** 管理员撤销一家档口/小店时仍有已接单或已备好订单。经营者随后被工作端准入/页面拒绝，页面告知“待履约订单由管理员处理”；管理端却没有对应的订单接管、拒绝、取消、收尾或退款入口。

**证据：** [治理页只显示待履约数、撤销和清理按钮](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/components/AdminOperationManager.tsx:56)；[档口撤权后直接返回拒绝页](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/StallWorkbenchPage.tsx:316)；[小店 suspended 后直接返回拒绝页](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/ShopWorkbenchPage.tsx:405)。管理员财务经营页 [仅读订单和统计](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/components/FinanceStores.tsx:57)，没有状态推进调用；管理员角色页仅能处理已出餐配送单的派单。治理 SQL 的 [shop_order_status 已允许管理员操作](C:/Users/upwar/Documents/Codex/xm-main/xm-main/docs/release/operations-governance.sql:599)，但管理页面没有接上。

**补全方案：** 治理完成后直接进入该店的遗留订单队列；提供管理员接管、可审计的取消/拒单、已发生履约的结案、库存回补以及资金退款处理，关联处理原因与操作者。不要只增加提示语。

**确定性：** 前端接管缺口静态确定；SQL 文件存在相应后台能力不能证明已部署，需线上只读清单和测试环境联调确认。

### C04 · P1 · 小店进销存流水与库存更新不是原子操作

**实际场景：** 两台设备同时售出同一商品，均读取库存 10，分别售出 3、4；两个客户端分别把库存写成 7 和 6，最终不保证为正确的 3。或流水 INSERT 成功、随后库存 UPDATE 网络失败，账本已记录而库存未变。

**证据：** [MoveSheet 基于弹层里的旧 stock 计算绝对 nextStock](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/components/MoveSheet.tsx:61)；[先 addMovement 再 updateProductStock，两次请求](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/components/MoveSheet.tsx:95)；[库存更新只按 id 写绝对值，没有版本/旧库存条件](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/shop.ts:175)。代码主动提供了“流水已记录，但库存同步失败”的分支，刷新无法保证恢复账实一致。

**补全方案：** 改为单个服务端进销存 RPC：锁定商品/校验身份和库存、写流水、按增减量更新库存并在一个事务提交；用请求幂等键抵御断网重试；盘点采用版本或锁避免覆盖期间发生的销售。

**确定性：** 客户端两阶段写入及丢更新/部分成功路径静态确定；未获取线上全部触发器，是否另有保护需核验。不要未经核实宣称线上已有账差。

### C05 · P1 · 订单、提现与审核列表先截断后排序，会漏掉真正待处理记录

**实际场景：** 数据量增长后，管理员可能看到“无待审提现”，但数据库还有新申请；档口/小店累计订单超过固定条数后，新订单可能不在客户端取回的集合里。页面在已截断子集上排序，无法找回未获取的记录。

**证据：** [wallet.queryRows 只 limit，无服务器排序](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/wallet.ts:36)；[fetchAllWithdraws 先取 200，再 pending 优先排序](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/wallet.ts:279)；[待审数基于同一 200 条子集，读错返回 0](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/wallet.ts:292)。同模式存在于 [餐饮订单 300 条](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/canteen.ts:683)、[小店订单 300 条](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/shops.ts:588)、[角色申请 300/成员 200 条](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/roles.ts:221)。

本地执行真实 `wallet.ts`（仅替换数据库为内存夹具）：201 条提现，前 200 条已处理、最后 1 条待审，`fetchAllWithdraws(200)` 得到待审 0 条，待审徽标 0；301 条流水的真实最新 ID=301，而钱包默认列表显示最新 ID=120。数据库不保证没有 ORDER BY 的结果顺序，这个取法无法保证“最新”或“待审优先”。

**补全方案：** 待办查询先在服务器筛选 `pending`/进行中；服务端排序后使用游标分页；徽标用真实 count/RPC 聚合，失败显示未同步状态。历史列表独立分页，不能让历史记录挤掉待处理订单。关联店铺摘要按订单涉及的 ID 精确查询，避免另外的 200 条店铺上限导致名称缺失。

**确定性：** 静态确定 + 本地夹具复现。当前线上数据是否已经达到门槛未知；无须假设已经丢单才修正查询。

### C06 · P1 · 角色停用后，工作端无法进入保留的历史钱包

**实际场景：** 骑手/档口角色被 suspended，账号仍有历史余额或提现记录。钱包页面本来保留该角色的资金账户，但对应专用 App 的全局准入直接阻止所有业务页面渲染；等待审核界面只给申请/退出，没有历史钱包入口。工作壳也拒绝直接访问 `/wallet`。

**证据：** [auth.hasRole 只认 active](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/auth.tsx:843) → [工作端 hasWorkAccess 依赖该角色](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/work-access.ts:28) → [PhoneShell gateOk 决定 children 是否渲染](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/components/PhoneShell.tsx:99) 及 [无准入时只挂 WorkAccessGate](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/components/PhoneShell.tsx:200)。[shell-path-policy 把 /wallet 列为学生专属](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/shell-path-policy.ts:12)。与 [WalletPage 保留 suspended 角色账户](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/WalletPage.tsx:38) 的意图不一致。

**补全方案：** 将经营/配送准入与历史资金账户读取分开；停用后仍允许该 UID 访问只读钱包、历史提现、平台申诉/结算入口。是否可继续提现按服务器明确规则判断，不能因整体工作台门禁使其无法核对自己的余额。

**确定性：** 专用工作端可达性静态确定；不是“资金被删除”。同 UID 从学生 H5 的可达性和服务端提现规则另需账号联调。

### C07 · P2 · 财务与佣金统计把固定子集写成“累计/本月/全部”

**实际场景：** 运营用“累计已打款”核账，骑手用“本月佣金”核收入，或管理员切“全部”经营统计。对应值只统计最近一个固定大小且未保证排序的返回子集；即使修好排序，本月超过 300 笔或累计超过 200 笔仍会少计。

**证据：** [收入摘要仅取 300 条](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/wallet.ts:246)，[UI 却称本月与累计佣金](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/RiderWorkbenchPage.tsx:506)；[提现统计从加载的 200 条计算](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/components/FinanceWithdrawals.tsx:24)，[显示“累计已打款”](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/components/FinanceWithdrawals.tsx:71)；[经营统计仅从 fetchOrdersAll 的 300 单再筛店铺/时间](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/components/FinanceStores.tsx:75)。本地夹具 301 条流水，唯一当月收入在第 301 条，`fetchIncomeSummary` 返回当月金额 0，实际为 100 分。

**补全方案：** 时间筛选、sum/count 放到服务端；累计额采用钱包流水的完整聚合；展示明确口径和最后同步时间。若暂不能做，立即将文案改为“已加载记录合计”并注明数量/时间范围。

**确定性：** 静态确定 + 本地复现，不代表线上已出现该数据量。

### C08 · P2 · 小店货架库存和进销存库存是两套账，未形成统一销售账本

**实际场景：** 同一件商品在“货架商品”和“进销存”分别建档。学生线上下单扣 `shop_goods.stock`，店主内部记账改 `shop_products.stock`/写 `shop_movements`。二者没有来源商品映射，订单销售不会由当前前端生成进销存出库、成本/毛利流水，店主必须重复维护。

**证据：** [工作台分别加载 shelf 与 products/movements](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/ShopWorkbenchPage.tsx:155)；[内部商品模型无货架商品关联](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/shop.ts:18)；[shop_order_status 取消仅回补 shop_goods](C:/Users/upwar/Documents/Codex/xm-main/xm-main/docs/release/operations-governance.sql:660)；`src` 的实际订单推进只调用 `shop_order_status`，没有调用进销存流水函数。

**补全方案：** 产品层统一 SKU 或显式建立货架/内部商品关联，订单成交自动写幂等出库与成本快照，取消/退款关联回补，人工售出保留独立来源。若两套库存是刻意独立，应在 UI 明示各自用途，不能让店主误以为销售已自动记账。

**确定性：** 前端模型与调用静态确定；线上是否存在未备份的跨表自动同步触发器未知。属于完整经营闭环的补全点，独立手工账本定位下不应称为销售故障。

### C09 · P2 · 闲置/任务目前主要是信息撮合，成交/接单确认链路未接到页面

**实际场景：** 买家/接单者看到内容后可查看联系方式、私信；卖家可标为已出，任务发布者可下架/重开。平台没有用户可达的成交意向、双方履约确认、任务接单与完成、交易评价/纠纷链路。

**证据：** [闲置底栏仅标已出/联系方式/私信](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/ItemDetailPage.tsx:376)；[任务底栏仅下架重开/联系方式/私信](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/TaskDetailPage.tsx:312)。[deal.ts 包含 createDeal/setDealStatus/addEvaluation](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/deal.ts:130)，但全 `src` 检索无页面调用（详情页仅用评论方法）。不能因为这些函数存在就认定成交功能已完成。

**补全方案：** 若定位保持校园信息撮合，明确“联系后自行交接”的服务边界即可；若要求平台交易闭环，补可达的意向/接单、服务端抢占与状态流转、履约双方确认、评价和举报/纠纷入口，再决定是否接资金托管。

**确定性：** 当前页面能力静态确定；这是产品范围选择，不把“未做平台担保交易”直接认作漏洞。

## 收费与规模化前还需核验的事项

### V01 · P1 · 取消支付后的 15 分钟超时恢复只在支付读取路径触发

**实际场景：** 买家开线上支付后失败/取消并关闭，档口订单变 `unpaid`。页面提示“15 分钟后自动转线下”，但订单轮询仅读表，不调用会处理过期的 `order_pay_read`；餐饮买家还没有重付入口（C02）。如果数据库门禁本身没有过期清扫，接单按钮会持续被阻止。

**证据：** [readOrderPay 的封装](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/pay.ts:147)，全 `src` 仅在支付轮询/支付成功回读内部调用；[收银台超时自动转换提示](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/components/CashierSheet.tsx:223)；[档口接单禁用由原始 pay_status 决定](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/StallWorkbenchPage.tsx:484)。

**补全方案：** 获取实际 `order_pay_read`、履约门禁和定时清扫实现；在测试环境验证开单取消后超过 15 分钟、买家退出、店主持续轮询的恢复。必要时增加服务端定时清扫或让订单列表 RPC 返回已清扫快照，避免依赖买家再次进入支付流程。

**确定性：** 客户端没有列表清扫调用静态确定；是否造成线上永久卡单需要数据库实现/测试环境确认，不能只凭旧注释断言。

### V02 · P1 · 真实退款、已付拒单与退款后的钱包冲销尚缺完整可审计链路

**实际场景：** 将来真实付款后商家拒单、买家取消、服务退款，应退真实资金，并同步订单/库存/结算流水。当前支付函数路由只有 create/query/notify/config；`/api/pay/refund` 本地返回 404。`pay_status` 虽有 `refunded` 类型，不能代表真实退款已实现。

**证据：** [支付函数实际路由](C:/Users/upwar/Documents/Codex/xm-main/xm-main/cloudfunction/pay/index.js:287)；[小店取消/拒单只更新订单与库存](C:/Users/upwar/Documents/Codex/xm-main/xm-main/docs/release/operations-governance.sql:642)；[钱包流水种类只有 withdraw_refund（提现退回），没有订单退款种类](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/wallet.ts:83)。没有找到用户或管理员可达的真实退款操作与状态页。

**补全方案：** 与 C01 同批完成退款申请/审核/真实渠道退款/回调和查询补偿，保存独立退款记录，处理已结算账本冲销和幂等库存回补。取消成功不能冒充到账退款成功。

**确定性：** 真实支付通道退款接口及前端流程缺失静态确定；没有审计线上 PG 是否自动调整 mock 的 refunded 状态，因此不宣称“当前订单已被真实扣款却无法退”。

### V03 · P1 · 学号账号开店后，跨手机端登录的 UID 关联需要明确方案

**实际场景：** 用户以学号账号在学生端申请并通过小店审批，店铺绑定该 UID；小店 App 只引导手机号登录。若该 Auth 用户未绑定同一手机号，手机验证码登录可能产生/使用另一 UID，无法获得原店铺。小店工作端本身没有申请入口，而要求回学生端。

**证据：** [工作端要求手机号](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/components/WorkPhoneGate.tsx:93)；[小店门禁要求去学生端申请](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/components/WorkAccessGate.tsx:66)；[店主核验要求 owner_uid 严格一致](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/shop-access.ts:19)。认证审计同伴确认当前前端未发现绑定/关联手机号的 API 流程；学生门禁通过后也可能手动 SMS 登录，因此不能声称所有小店都无法跨端登录。

**补全方案：** 提供明确的手机号绑定/账号关联流程，审批前提示工作端登录要求；以同 UID 关联身份而非人工复制店铺。用已绑定/未绑定学号账号和纯手机号账号分别验证申请、通过、App 登录、撤权和历史资金访问。

**确定性：** 页面约束静态确定；是否已经在 Auth 后台关联手机号需线上测试账号确认。

### V04 · P2 · 小店“送货到楼”与骑手端并未接通

**实际场景：** 小店订单可选“送货到楼”，但骑手订单池只读餐饮表，不包含小店单。小店订单只通过店主 created→accepted→ready→done 流转，没有骑手字段/派送进度。

**证据：** [小店订单模型无 rider_uid/delivery_status](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/shops.ts:110)；[骑手池只读 canteen_orders](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/rider.ts:253)；[小店卡 ready 直接店主点完成](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/components/ShopOrderCard.tsx:120)。

**补全方案：** 若承诺平台骑手配送，建立统一配送任务/订单来源 kind，接上派单、状态、联系人和佣金；若小店自行配送，在下单页明确“店主配送”，显示可追踪的送出/送达状态。不可把有 delivery 枚举当成五端配送已经互通。

**确定性：** 前端跨表隔离静态确定；业务是否要求平台配送需确认，店主自送定位下不是故障。

## 验证记录与下一步

本地复现文件：[只读复现脚本](C:/Users/upwar/Documents/Codex/2026-10-01/referenced-chatgpt-conversation-this-is-an-2/outputs/audit-commerce-admin-repro-2026-10-03.cjs)。执行仅加载支付处理代码和钱包查询代码，数据库替换为内存夹具，不产生任何网络或数据写入。

| 检查 | 结果 |
|---|---|
| 线上公开支付 config GET | mode=mock，liveReady=false |
| 仓库与部署备份支付代码 | SHA256 一致 |
| 本地 LIVE 下单（占位完整配置） | 501 |
| 本地 LIVE 回调（占位完整配置/签名头） | 501 |
| 本地退款路由 | 404 |
| 201 条提现，最后 1 条待审 | 页面待审和徽标均 0 |
| 301 条流水，仅最后 1 条属于当月 | 本月统计 0（真实夹具当月为 100 分） |
| 301 条流水的钱包默认 120 条列表 | 最新显示 ID=120（真实最新 ID=301） |

未发现足以从本次只读证据确认的 P0 越权/真实资金损失。优先先完成餐饮买家订单、管理员遗留订单接管、查询分页/待办数、进销存事务以及停用后的历史钱包可达性。真实支付、退款和账户关联作为收费/五端正式运营的上线门槛；数据库 RLS、支付配置、结算幂等及退款冲销用测试环境联调，不能在真实用户订单上直接演练。
