# 首页、账号、社交与消息只读审计（2026-10-03）

仓库：`C:/Users/upwar/Documents/Codex/xm-main/xm-main`；核对 HEAD `5f97138`，OTA 1.2.87。已阅读 `design-system/campus-ui.md` 与 `.codex/skills/ui-refactor-sunshine/SKILL.md`。依据真实调用链审计；没有修改仓库、部署、数据库写入或向真实用户发消息，也没有读取凭证文件。

线上代码备份只作为当前实现的交叉证据：`C:/Users/upwar/Desktop/新建文件夹 (6)/.server-private/deployed-code/campusAuth/index.js` 与仓库同样停用了未经服务端教务验证的首次学号建档。数据库实际 RLS、存储桶权限和原生表现未在本子任务连接线上验证。

P0：本范围没有证据充分的 P0。P1 表示已影响登录、私信内容、隐私边界或核心举报闭环；P2 表示状态准确性、交互或产品补全。下列“静态确定”指当前源码可确认；不等于已经做过真机复现。

## 当前已经完成、不能沿用旧报告的问题

- 私信入口已统一走 `openDmThread → chat_thread_open → /chats/{id}`；大厅走 `plaza_messages`，不是仍等待腾讯 IM 接入。不要将停用腾讯 IM 当成缺陷。
- 当前未读摘要会保留成功来源的数字，并单独提示通知/私信读取失败；没有用失败结果制造 0 未读，也不再叠加腾讯 IM 未读。证据：[MessageEntry.tsx](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/components/MessageEntry.tsx:24)、[message-unread-summary.ts](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/message-unread-summary.ts:8)、[MessagesPage.tsx](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/MessagesPage.tsx:297)。旧“部分未更新”截图不能证明当前缺陷。
- 首页已具备本人校区选择、课表归属/学期校验、最近待办、六项可排序服务、AI 入口、真实校园动态/互助信息。常用服务与最近使用按 UID 隔离，本机存储失败会提示。证据：[HomePage.tsx](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/HomePage.tsx:85)、[home-preferences.ts](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/home/home-preferences.ts:36)、[service-recent.ts](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/service-recent.ts:10)。
- 首页校园动态与互助信息会分别展示部分同步失败；通知页也不会在接口失败时显示“没有通知”。证据：[HomePage.tsx](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/HomePage.tsx:506)、[NotifyPage.tsx](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/NotifyPage.tsx:153)。
- 广场图片、表情、贴纸确实有当前上传/发消息链路，不应报为仅有按钮。已有本地校验、体积限制、错误提示和处罚门禁；私信文本发送也有乐观发送与失败重试。已运行当前 13 个相关本地测试，全部通过（`chat-dm-entry.test.mjs`、`plaza-media.test.mjs`、`auth-session.test.mjs`）；这些测试不覆盖以下会话页账号切换和分页缺陷，也不能证明线上桶权限或数据库策略正确。

## S01 · P1 · 学生端手机号密码登录被路由成学号认证

**影响：** 手机验证码注册后、设置了昵称与 App 密码的普通学生账号，按设置页承诺使用“手机号＋密码”登录，会得到“学号账号登录失败”。验证码登录和工作端手机号登录仍有正常路径。

**证据：** [auth-ui.tsx:98](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/auth-ui.tsx:98) 用 `!work && /^\d{8,16}$/.test(acc)` 选择 `loginWithCampus`；11 位手机号命中。该函数调用 [campus-app-auth.ts:23](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/campus-app-auth.ts:23) 的 `signInWithPassword({ username: stuid, password })`，失败后没有 phone fallback。正确的 phone 分支在 [auth.tsx:478](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/auth.tsx:478)，但学生表单绕过了它。

注册后的真实 username 并非固定为手机号：[auth.tsx:788](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/auth.tsx:788) 读取用户输入昵称，:800 以该昵称更新 username。因此，例如 username 为“阿狐同学”的手机号账号确实受影响；若用户恰把 username 设成手机号则可能碰巧成功。工作端 `WorkPhoneGate` 直接调用 `loginWithPassword`，不受这一分类错误影响。

**补全：** 先按 11 位手机号判断并走 phone 认证，再区分学号与其它 username；将“校园身份验证”和“App 账号密码”在表单中明确。为 username 不等于 phone 的账号补充表单级回归。

**判定：静态确定。** 线上复现应使用测试手机号账号，username 设为非手机号，设置密码后从学生端账号密码面板登录。

## S02 · P1 · 会话页退出/切换账号后保留上一账号消息

**影响：** 学生端停留在私信页时，另一窗口退出或切换账号，当前页仍能显示上一账号已读取的消息、话题和图片；旧请求回包也只以会话编号确认归属。

**证据：** [ChatRoomPage.tsx:117](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/ChatRoomPage.tsx:117) 的未登录分支只 `setLoading(false)` 并返回，没有清空 head/latest/older/outgoing/preview。首屏 effect 在 :147 依赖 `threadId, signed, retryTick`，未依赖 UID；:158 仅在 threadId 变化时清理 older/outgoing。:106 与 :186 的回包保护只看 threadRef，没有账号归属。:308 的 `list.map` 不受 signed 限制，:353 只隐藏输入框。

[PhoneShell.tsx:108](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/components/PhoneShell.tsx:108) 学生 gateOk 基于校园门禁，不随 App UID 退出失效，:200 的 children 没有 UID key。认证在 [auth.tsx:415](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/auth.tsx:415) 订阅了 auth state change，多窗口变化属于支持场景。

**补全：** 以 UID＋threadId 定义会话页身份并清理所有私有 UI 状态；对首屏、轮询、翻页、发送与图片上传全链路使用身份 ticket。未登录/非参与者时显示登录或无权访问状态，禁止渲染旧消息。可复用当前 ChatListPage 的 UID key 和 AsyncOwner 模式。

**判定：静态确定；多窗口或真机流程待复现。** 不代表能绕过服务端读取其它用户新数据，问题是本地已读取的私有内容没有失效。

## S03 · P1 · 私信轮询覆盖最新页，造成已显示历史出现缺口

**影响：** 持续聊天时早先消息会从当前视图消失。打开时不超过 30 条的会话，后来超过 30 条，也不会出现“查看更早消息”按钮；刷新后才恢复。已翻过历史的会话还会产生位于历史页与最新页之间的空洞。

**证据：** [ChatRoomPage.tsx:107](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/ChatRoomPage.tsx:107) 每 5 秒轮询后用最新 30 条替换 latest；:136 仅首屏设置 more，轮询没有更新 has_more。:164 的翻页边界使用 older 的最早 ID。

例如已经显示 older=41–70、latest=71–100，收到第 101 条后 latest 变成 72–101，第 71 条从合并列表消失；后续“更早”仍查询 `<41`，无法补回 71。若首屏是 1–30 且 more=false，轮询返回 2–31 后第 1 条消失，more 仍为 false。

**补全：** 按 ID 合并已加载消息，维护连续的最早历史边界；根据服务端分页事实更新 more，检测大批新消息导致的 gap 并补取。不要只增加 setMore，仍须解决被最新页覆盖的中间消息。

**判定：静态确定。** 服务端消息仍在库中，问题是客户端分页呈现。

## S04 · P1 · 大厅举报目标 ID 带 pg- 前缀，管理端不能定位、删除或处罚

**影响：** 学生看到“举报已提交”，管理员虽能看到举报，却不能从举报执行“删除原文”“禁言”“封大厅”。

**证据：** [PlazaPage.tsx:33](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/plaza/PlazaPage.tsx:33) 将数据库数字 ID 转成 `pg-${row.id}` 作为 UI ID；:670 将这个 ID 直接交给 reportHint；:502 保存为 target_id。管理端 [AdminReportsPage.tsx:50](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/AdminReportsPage.tsx:50) 与 :64 直接 `Number(r.target_id)`，`Number('pg-123')` 为 NaN，于是 authorOf 返回 null、dropTarget 提示没有关联原文。帖子举报使用数字 ID，不受此问题影响。

**补全：** LobbyMsg 单独保留数据库 numeric ID，UI key 与目标 ID 分开；新举报写纯数字字符串，兼容解析或修复历史 `pg-` 记录。举报 detail 应保存有限原文摘要和作者信息，方便原文被删除后的核查。

**判定：静态确定。** 验证仅需测试账号发一条测试大厅消息并举报，不应对真实用户执行处罚。

## S05 · P1 · 消息中心“我的发布”点击任务/闲置后回首页

**影响：** 用户从消息中心查看自己发布的任务或闲置，无法进入对应详情，看起来像消息记录失效。

**证据：** [MessagesPage.tsx:170](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/MessagesPage.tsx:170) 跳 `/tasks/${id}`，:183 跳 `/market/${id}`。实际路由是 [App.tsx:56](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/App.tsx:56) 的 `/item/:id` 与 :57 的 `/task/:id`；:122 将未注册路径重定向到 `/`。

**补全：** 改为已注册详情路径，建立可复用的详情路由生成函数；按消息入口、首页卡片、列表卡片和通知链接交叉检查。可增加旧错误路径兼容跳转，保留外部旧链接体验。

**判定：静态确定。**

## S06 · P1 · 账号删除/注销没有可追踪的产品闭环

**影响：** 用户可以退出登录，但不能在 App 中发起并跟踪账号注销或个人资料删除，无法知道账号、教务本机凭证、帖子、私信图片及相关数据是否清理、何时完成。

**证据：** [SettingsPage.tsx:813](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/SettingsPage.tsx:813) 的账号页仅有钱包、密码设置与退出；[auth.tsx:620](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/auth.tsx:620) logout 仅清认证和内存状态。对 src、cloudfunction/、cloudfunctions/ 的账号删除相关入口/调用检索没有找到删除账号功能。现有 [ContactPage.tsx:59](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/ContactPage.tsx:59) 是普通留言，没有专门的删除申请类型、校验、工单状态或数据清理接口。

仓库政策 [隐私政策与用户协议.md:49](C:/Users/upwar/Documents/Codex/xm-main/xm-main/docs/legal/隐私政策与用户协议.md:49) 声明注销后删除或匿名化，:53 指向联系渠道；:62 的邮箱仍明确标注为示例。可能存在人工受理，但源码不足以证明人工删除与执行记录已完成，因此这里属于功能未闭环，并非断言从来没有人工处理。

**补全：** 增加重新认证后的注销申请，说明未结订单/余额等真实限制；提供撤回期、处理状态及完成回执。服务端实施账号停用、公开内容处理、私有上传清理与保留记录；客户端清理该 UID 的私有缓存和校园凭证，保留必要业务证据的范围应写明。

**判定：静态确定缺少 App/API 闭环；人工后台流程需核实。**

## S07 · P1 · 引导要求同意用户协议和隐私政策，但没有提供全文入口

**影响：** 首次使用必须勾选“已阅读”，实际只能看到简要免责声明和说明书，无法在同意前查看完整协议、数据收集/保留/删除说明，也不能从设置重新查阅。

**证据：** [FirstRunHost.tsx:134](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/components/FirstRunHost.tsx:134) 仅渲染 meta.disclaimer/meta.manual，:154 的同意文字不是链接；[first-run.ts:29](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/first-run.ts:29) 仅写入 v1 同意布尔值。完整政策仅在 docs/legal 文件内。App 路由没有协议页面，[settings-section.ts:1](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/settings-section.ts:1) 的分类也没有隐私/协议入口。

**补全：** 在勾选前提供用户协议与隐私政策可阅读全文，设置中保留长期入口；显示适用主体、更新时间、真实联系渠道和数据权限说明，保存协议版本及同意时间。这里只指出产品可访问性缺失，不根据源码作法规合规结论。

**判定：静态确定。**

## S08 · P2 · 广场动态同步大厅失败或被跳过时仍提示成功

**影响：** 用户以为动态同时出现在大厅，实际上大厅同步可能没有发生；也可能先看到错误，再立即看到成功提示。

**证据：** [PlazaPage.tsx:445](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/plaza/PlazaPage.tsx:445) 在 hall ban 时跳过镜像；:448 镜像失败仅显示 error；:453 只以 syncLobby 复选框决定“已发动态，并同步到大厅”，没有依据 mirrored 成功结果。

**补全：** 保存两个写入结果，分别显示“动态已发布，大厅同步失败/因限制未同步”，允许只重试大厅镜像，避免重复发布动态。

**判定：静态确定。**

## S09 · P2 · 广场排行/搜索把读取失败表现为无结果

**影响：** 网络或权限故障后，排行显示没有数据，搜索显示没有找到帖子；用户不能区分真的没有结果与数据没有读到，排行也缺少明确重试。

**证据：** [PlazaPage.tsx:162](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/plaza/PlazaPage.tsx:162) loadHot 将失败列表设为空而不保存错误；:729 以空列表展示 emptyHint。搜索 :175–177 在失败后只 toast 并清空结果，仍保持 searched=true，:807 又显示无结果空态。普通 feed 有错误区分，说明这是遗漏而非整体状态方案缺失。

**补全：** 为排行两种来源和搜索分别保存 loading/error/result，保留成功来源的排行；错误有重试按钮，并避免错误触发空态。旧数据继续显示时标注未刷新。

**判定：静态确定。**

## S10 · P2 · 通知只取最近 100 条，未读数量可能被低估且历史不可翻页

**影响：** 通知多的买家或运营账号，较早未读不会计入首页/消息中心数字，也无法在通知页找回；最近 100 条都已读时可能显示“全部已读”，而更早通知仍未读。

**证据：** [notify.ts:137](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/notify.ts:137) 固定默认上限 100，:144 limit；:156–158 对最近 100 条统计 unread。[NotifyPage.tsx:33](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/NotifyPage.tsx:33) 同样只拉 100 条，没有 cursor 或 load more。

**补全：** 服务端提供当前用户全量未读 count，通知列表采用 id cursor；服务端 RLS 继续限制本人读取。若暂时保留窗口计数，文案必须明确“最近通知”，不能称“全部已读”。

**判定：静态确定算法上限；实际是否已有超过窗口的用户需线上只读计数核验。**

## S11 · P2 · 发帖、选图和登录仍使用旧遮罩，交互没有统一到 DialogLayer

**影响：** 键盘焦点可以进入遮罩背后的页面，Escape 关闭与焦点恢复缺失；原生返回对页面内部的发帖/选图遮罩可能回退路由而非关闭弹层，丢失上下文。

**证据：** [PlazaPage.tsx:821](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/plaza/PlazaPage.tsx:821) 发帖用 div mask，:866 图片预览同样；[ImageSourceSheet.tsx:48](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/components/ImageSourceSheet.tsx:48) 只有 role=dialog，未用 modal top layer；[auth-ui.tsx:32](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/auth-ui.tsx:32) 登录 Mask 只是 div。它们没有焦点锁、Escape 或 app-overlay-back 注册。

[native.ts:120](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/native.ts:120) 的存量遮罩返回兜底遇到位于 data-app-page 内的节点就不处理，所以不能以“已有统一 native back 兜底”证明发帖/选图已接管返回。登录遮罩位于页面外，可能被这个兜底关闭，不应把三种遮罩一概报成原生返回失败。

当前共享 [DialogLayer.tsx:33](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/components/ui/DialogLayer.tsx:33) 已实现 showModal、焦点恢复和 app-overlay-back 接管。

**补全：** 迁移到同一个 DialogLayer，并保留忙碌不可关闭、草稿保护、退出动画与返回按钮约定；对长表单的软键盘和图片选择器做 Android 真机检查。

**判定：静态确定缺少语义/焦点管理；原生返回和层级表现需真机复现。**

## S12 · P2 · 学号门禁仍承诺“学号就是 App 账号”，与已关闭的建档逻辑不符

**影响：** 新学生教务同步成功后预期已经登录 App，实际学号 App 账号若未预置仍登录失败，后续发布/私信还需要手机号注册；用户容易误认为教务密码错误。

**证据：** [CampusGate.tsx:265](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/components/CampusGate.tsx:265) 承诺“登录成功后学号就是 App 账号…无需再登”，但 :72 已先放行门禁，:73 后台再进行独立 App 认证。当前 [campus-app-auth.ts:2](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/campus-app-auth.ts:2) 仅登录已有账号；[campusAuth/index.js:21](C:/Users/upwar/Documents/Codex/xm-main/xm-main/cloudfunctions/campusAuth/index.js:21) 和线上代码备份均拒绝未经验证建档。首次说明书已正确区分两类登录，但门禁主要文案尚未同步。

**补全：** 门禁明确表示绑定教务用于同步，App 账号需另行登录；同步完成后展示 App 登录状态，未开通时直接给手机注册入口。不要恢复未经服务端验证的旧建档接口来迎合旧文案。

**判定：静态确定；新学号是否已经后台预置需用测试账号核验。**

## S13 · P2 · 私信缺少举报与阻止继续联系的入口

**影响：** 用户收到骚扰内容后只能从会话列表“移除”，对方再次发送时会话自动恢复；不能在该会话中关联具体消息提交举报，也不能阻止继续联系。

**证据：** [ChatRoomPage.tsx](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/ChatRoomPage.tsx:264) 只有返回、话题与收发图片/文本；[reports.ts:8](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/reports.ts:8) 举报目标不含 chat_message/chat_thread；[ChatListPage.tsx](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/ChatListPage.tsx:229) 的确认说明明确对方再发消息会回来。数据库补丁 [chat-media.sql](C:/Users/upwar/Documents/Codex/xm-main/xm-main/docs/release/chat-media.sql:112) 的 chat_send 会清对方 hidden_at，未见 block 判定。

**补全：** 添加针对具体消息的举报、会话内安全入口，以及双向或单向 block 表与服务器投递校验；区分“隐藏会话”和“阻止联系”，避免用户把移除当作拉黑。证据读取应只对有权处理举报的运营角色开放。

**判定：静态确定前端与当前补丁缺少该闭环；数据库是否另有隐藏策略需只读核验。**

## 本次验证层级

| 项目 | 证据层级 | 本次实际执行 |
| --- | --- | --- |
| S01 手机号分类 | 源码＋内存逻辑样例 | 核对表单分支与注册 username 写入；内存验证合成的 11 位手机号命中学号正则。未发送验证码或实际登录。 |
| S02 会话账号失效 | 源码静态 | 核对页面依赖、回包保护、渲染条件与 PhoneShell 挂载；未运行 React 页面切换测试，未做多标签页/真机实测。 |
| S03 分页覆盖 | 源码＋内存逻辑样例 | 以 older=41–70 与 newest=72–101 重现 71 缺失，确认 nextOlderCursor=41；源码截取确认轮询替换 latest 且不更新 more。未连接会话 RPC。 |
| S04 举报编号 | 源码＋内存逻辑样例 | 验证 `Number('pg-123')` 为 NaN，与管理端拒绝条件一致。未写举报或执行处罚。 |
| S05 消息详情路径 | 源码静态 | 交叉检索发布记录目标、已注册详情路径及 wildcard fallback；未点击浏览器。 |
| S06/S07 注销、协议 | 源码静态 | 检索账号页面、Auth API、后端入口、政策文件和引导 UI；未核验人工运营台或邮箱是否配置。 |
| S08/S09 成功与异常状态 | 源码静态 | 追踪两个写入结果、排行与搜索 error/empty 分支；未做页面网络故障注入。 |
| S10 通知上限 | 源码静态 | 确认两处 limit=100 与前端计数，没有连接线上计数。 |
| S11 弹层 | 源码静态 | 核对共享 DialogLayer、页面旧遮罩、native back 的 contains 判定；未测试键盘/原生返回。 |
| S12 门禁文案 | 源码＋线上代码备份 | 仓库与备份 campusAuth 内容一致，均停用未验证建档；未以新学号尝试登录。 |
| S13 私信治理 | 源码静态 | 未见消息举报/屏蔽入口，已有 SQL 隐藏恢复行为已核对；线上额外策略未查。 |
| 现有相关回归 | 本地隔离测试 | 运行当前 chat-dm-entry、plaza-media、auth-session 共 13 项，全部通过；测试 mock 认证/数据库，不会访问真实服务。 |
| V01–V04 | 待线上验证 | 仅列需要核验的条件，未宣称已证实线上漏洞。 |

以上源码行号对应本次审计基线 HEAD `5f97138`；主任务随后对 MessageEntry、shell-notify 等开展性能修改，相关已完成项的行号应以基线或最终差异为准，S01–S13 核心缺陷文件在本子任务未改动。

## 需要线上验证的边界（不能当作已证实线上漏洞）

| 编号/优先级 | 待核验项与证据 | 实际风险与补全方式 |
| --- | --- | --- |
| V01 / P1 | 私信图片也存 images 桶并调用 [chat-image.ts:69](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/chat-image.ts:69) getPublicUrl；[ChatRoomPage.tsx:318](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/ChatRoomPage.tsx:318) 直接渲染；现有清会话只是单方隐藏。 | 需用测试对象确认未登录能否访问此 URL、对象是否能删除/撤回。若公开读，私有图片链接获得者可绕过会话权限长期访问；改私有桶＋按参与者签发短期地址，并在注销/内容删除中管理对象。代码能确定“使用公开 URL”，不能仅据此确定线上桶权限。 |
| V02 / P1 | [plaza.ts:59](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/plaza.ts:59) 的文本词表位于客户端；消息/帖子直接 INSERT；[plaza-media.sql](C:/Users/upwar/Documents/Codex/xm-main/xm-main/docs/release/plaza-media.sql:1) 仅加媒体字段/类型约束。当前 src 没有 secCheck 调用。 | 需只读检查线上触发器、约束、对象审核与隔离状态。不能因为前端没调用 secCheck 就断言云端没有审核。若仅客户端词表，绕过客户端可发布未审核文本/图片；补服务端审核与速率限制，媒体审核通过后再公开展示。plaza-sanctions.sql 已有处罚 RLS，不能把前端 sanctions lookup 失败放行误报为必然绕过处罚。 |
| V03 / P1 | 学号只作为 username 认证，工作端使用 phone；前端未发现绑定 phone 到当前 UID 的功能；店铺准入依赖 owner_uid。 | 已有未绑定手机的学号 UID 申请小店后，手机登录可能得到另一 UID，无法拥有已审核店铺。学生端可以手动以同手机号 UID 申请，因此不能断言所有小店都会断链。请用“学号且未绑手机号”“已绑手机号”两类测试账号核验；补重新认证后的手机号绑定或经审核的身份/店铺迁移。与交易审计子任务共享此结论。 |
| V04 / P2 | [reports.ts:78](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/reports.ts:78) 尽力直写 uid=admin_broadcast 的通知，异常或 SDK error 未验证；SQL 中未找到对应通知触发器。管理壳还会轮询待处理举报数。 | 需检查线上 report INSERT 后是否通知真实管理员 UID。不能宣称“管理员收不到举报”，因为管理壳有轮询替代；若仅虚拟 UID 写入，应服务器按授权管理员生成通知，并以新举报 ID 去重，不只依赖数量高水位。 |

## 入口与真实调用覆盖表

| 模块 | 当前入口/真实调用 | 当前结论 |
| --- | --- | --- |
| 首页 | `/`；HomePage → schedule-cache / fetchTodos / loadCampusHighlights / fetchTasks / fetchItems | 主框架与真假状态已有实现；校区和服务偏好只保存本机，已明确，不构成假云同步。 |
| 服务目录 | `/services`；SERVICE_CATALOG 三类服务、搜索、recent service；快递是 ExpressTrackSheet 官方平台动作 | 目录中的内部路由均可在 App 路由找到。服务 q 与分类筛选存在真实行为。 |
| 发布 | TabBar → PublishSheet → `/tasks?publish=1`、`/market?publish=1`、`/plaza?compose=1`、`/info?publish=help` | 四个入口有真实目标；广场镜像结果与弹层管理见 S08/S11。交易发布细节由交易子任务覆盖。 |
| 登录注册 | FirstRunHost → CampusGate/WorkPhoneGate；AuthSheets；CloudBase password/OTP | OTP 首次注册存在；学生手机号密码分类问题 S01，学号新建档当前安全关闭，门禁文案问题 S12。 |
| 账号/资料 | `/profile`、`/settings?section=account`；saveProfile/saveAvatar/saveCredentials/logout | 修改头像、昵称、密码与退出存在；注销 S06；协议全文 S07；未绑手机学号账号的密码设置/工作端身份需 V03。 |
| 广场帖子 | `/plaza` 默认 feed、hot；plaza_posts SELECT/INSERT/DELETE、浏览/点赞 RPC | 展示、发帖、搜索、排行和本人/管理员删除存在；排行/搜索失败 S09。 |
| 广场聊天 | `/plaza?tab=lobby`；plaza_messages 轮询、文本/图片 INSERT、处罚门禁 | 4 秒轮询；无腾讯 IM 依赖。大厅举报处理 S04。直播群旧文案可随 S12 一起清理。 |
| 私信 | `/chats`、`/chats/:id`；chat_thread_open/list/messages_page/send/mark_read/hide RPC | 数据链路完整；列表具备 UID owner 保护，但会话页 S02/S03；私信治理 S13。 |
| AI 聊天 | `/chat`；现有 AI 页面、请求链路 | 此次只核对入口可达，不据此证明模型服务线上可用或记忆隐私正确。 |
| 消息中心 | `/messages`；公告、报名、订单与我的发布聚合 | 未读错误有区分；任务/闲置详情路径 S05；广播 read 需另行确认通知同步。 |
| 通知 | `/notify`；notifications 本人过滤＋已读 RPC | 正确区分未登录、加载、失败和空态；计数/分页上限 S10；原生通知权限由原生审计子任务覆盖。 |
| 文件/图片 | avatar → images/avatars；chat/plaza → images/chats/{uid}/ 与 plaza/{uid}/；系统相册/相机/file input | 有上传和格式/2MB限制；公开对象权限 V01、服务端审核 V02、选择器原生交互 S11；实际拍照编码/大图压缩需真机核验。 |
| 举报/处罚 | reports → AdminReportsPage；user_sanctions + 广场 RLS SQL | 帖子举报有真实保存/处理；大厅目标 ID 断链 S04；私信治理 S13；实时管理员提醒 V04。 |
| 其它注册模块 | App 注册学习、英语、课表、运动、小队、待办、信息、钱包、餐饮、小店、五端工作台与管理员页面 | `/english/practice` 有兼容跳转；旧 `/games`、`/games/*`、`/story` 明确归档回首页，属于当前设计；错误路径 fallback 会掩盖 S05 这样的入口缺陷。详细业务由对应子任务覆盖。 |

建议修复顺序：S02 私有内容失效 → S01 登录分类 → S04 举报目标 → S03 私信分页 → S05 消息路由 → S06/S07 账号与隐私闭环；随后处理 S08–S13，并用测试账号、测试对象核验 V01–V04。所有线上结论均应记录“已部署/只读核验/真机通过”，不要只据仓库存在 SQL 文件称线上已修好。
