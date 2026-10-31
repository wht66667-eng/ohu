# 阳光校园 UI 交互优化建议

> 评估范围：`xm-main` 全量源码（src/pages 38 页 + src/components 60+ 组件，截至 1.2.114）。
> 评估方式：逐文件阅读 + 反模式全仓扫描（原生弹窗 / 骨架屏 / 长按 / 键盘适配 / 安全区 / 手势等）。
> 落地节奏：P0 已随 **1.2.115 纯热更包**发布；P1/P2 按优先级分批排期。

---

## 一、先说结论：项目的 UI 底子比多数校园 App 扎实

这些是扫描中确认已经做对、不要重复建设的部分：

| 设施 | 位置 | 说明 |
|---|---|---|
| 统一状态组件 | `ui/StateViews.tsx` | loading/empty/error/success/denied 五态，`role="alert"/"status"` 已内置 |
| Toast 体系 | `lib/toast.tsx` | ok/err/warn 三变体、可配时长、`aria-live` 播报、113+ 处调用 |
| 弹层底座 | `ui/DialogLayer.tsx` | 基于原生 `<dialog>` + `showModal()`，顶层渲染、焦点归还、`app-overlay-back` 返回栈 |
| 下拉刷新 | `usePullRefresh.ts` | 跟手不移动内容、直写 DOM 不进 state、横纵手势让位、仅原生壳启用 |
| 动效降级 | `motion-pref` + `prefers-reduced-motion` | TabBar、Fox3D、focus 等全链路尊重系统减少动效 |
| 双壳分流 | `TabBar.tsx` | 学生端 / 管理端两套底栏，badge 变化有 `aria-live` 播报 |
| 返回键 | `lib/native.ts` | Android 硬件返回键 → `app-overlay-back` 事件栈，弹层按层级消费 |
| 无障碍 | `PhoneShell.tsx` | skip-link、`aria-current`、44px 触摸目标（CampusGate 等） |

**问题集中在"最后一公里"**：反馈即时性、手势完备度、加载感知、深色模式完整性。

---

## 二、P0 —— 已随 1.2.115 热更包落地

### 2.1 键盘弹出遮底栏（全项目零 `visualViewport` 使用）

- **证据**：`grep visualViewport src/` 为零；`ChatRoomPage.module.css` 的 `.composer` 是 flex column 子元素，Android WebView 弹出软键盘时若不走 `adjustResize`，底栏被整个遮住，用户看不到自己打的字。
- **方案**：新增 `lib/use-keyboard-inset.ts`——监听 `visualViewport`，键盘高度写进 CSS 变量 `--kb-inset`（阈值 150px，排除地址栏收缩误判）；聊天页 / 广场底栏用 `margin-bottom: var(--kb-inset, 0px)` 顶到键盘上方。两种 WebView 模式（resize / 覆盖）都兼容：正常 resize 时变量为 0，布局不变。

### 2.2 登录面板默认停在「账号密码」tab

- **证据**：`auth-ui.tsx` 原为 `useState<TabKey>(work ? 'code' : 'pwd')`——学生端打开登录先看到学号/密码表单，要用手机号验证码必须手动切 tab。「点了登录没反应」类反馈有它的功劳。
- **方案**：默认改为「手机号验证码」（首次自动注册建档，老用户也可用它找回入口）；验证码框加 `autocomplete="one-time-code"`（Android 短信自动填充）；四个 sheet 的错误区补 `role="alert"`。

### 2.3 首屏只有 spinner，无骨架屏

- **证据**：全项目 0 处 skeleton；广场三个 tab（动态/大厅/排行榜）、市场、首页校园动态首屏均为 `<span className={styles.spinner}>正在加载…`。
- **方案**：新增 `ui/Skeleton.tsx`（`RowSkeleton` / `PostCardSkeleton` / `GoodsGridSkeleton`），低饱和色块 + 缓慢流光，`prefers-reduced-motion` 时退化为静态块。已接入广场 3 tab、市场商品网格、首页校园动态。

### 2.4 图片预览不能翻页

- **证据**：`PlazaPage.tsx` 原 `preview` 为单张 url，多图帖子只能一张张点开再看；`ChatRoomPage.tsx` 的 lightbox 连可见关闭按钮都没有（只能点遮罩）。
- **方案**：preview 状态改为 `{ urls, index }`，多图时显示左右箭头 + `n / total` 计数，边界禁用；聊天页预览补 44px 关闭按钮。

### 2.5 底栏无「双击回顶部」

- **方案**：`TabBar.tsx` 的 Tab 记录上次点击时间，350ms 内再次点击**已激活**的 tab 时平滑滚动 `[data-app-page]` 容器到顶部（微信/微博同款）。

---

## 三、P1 —— 下一批建议（按收益排序）

### 3.1 侧滑返回手势

- **现状**：20+ 个二级路由（`/item/:id`、`/task/:id`、`/chats/:id`、`/study/*`、`/words/*`…）只有左上角返回按钮。Android 用户 80% 的返回期望来自边缘右滑。
- **方案**：在 `PhoneShell` 挂边缘手势（左缘 24px 起手，位移 > 72px 且横向占优则触发 `goBack`），拖动时给页面跟手位移 + 右侧露底。**已有基础设施可复用**：`app-overlay-back` 事件栈、`studyBackHistory`。
- **风险**：与首页横向轮播、商品横向列表冲突——起手判定必须限定在左缘 24px 内（`usePullRefresh` 的 8px 起手 slop 是同款思路）。

### 3.2 聊天消息长按菜单

- **现状**：全项目 0 处长按（`grep contextmenu|longPress` 为空）。复制、撤回、引用、举报全部没有入口。
- **方案**：消息气泡长按 500ms 弹出操作条（复制 / 撤回 / 多选），复用 `DialogLayer` 或轻量 popover；左滑快速引用可作二期。
- **注意**：长按与 `usePullRefresh` 的纵向手势不冲突（一个在列表内、一个在顶部），但要在气泡上 `preventDefault` 防止触发系统文本选择。

### 3.3 广场 / 列表分页

- **现状**：`fetchPlazaMessages(PLAZA_MSG_LIMIT)` 一次拉固定条数，无「加载更多」、无无限滚动。内容超过一屏后历史不可达。
- **方案**：游标分页（`before` 参数），列表滚到底部自动加载下一页 + 底部 loading 条；配合 `IntersectionObserver`。

### 3.4 「正在输入」与已读回执

- **现状**：`ChatRoomPage.tsx` 无 typing indicator、无已读状态。
- **方案**：输入时向对端写一个带 TTL 的轻量信号（`chat_typing` 表 + 3 秒过期，或复用现有实时通道）；已读回执用 `chat_reads` 表记录最后已读消息 id，对端消息下方显示「已读」。

### 3.5 表单错误字段级呈现

- **现状**：仅 `StudyHubPage.tsx` 有 `formErr` 字段级红字；发布闲置 / 发布任务 / 登录等表单错误是表单上方一段红字或 toast，不对应到具体字段。
- **方案**：定义 `FieldError` 模式（字段下方 13px 红字 + `aria-describedby` 关联 + `aria-invalid`），各发布表单统一接入。

### 3.6 空态补行动按钮

- **现状**：`EmptyState` 已支持 `action` prop，但多数调用点只传文案。首页互助区做了正面示范（`去任务大厅`）。
- **方案**：逐个页面补——广场空态 → 「发第一条动态」；任务空态 → 「发布任务」；市场空态 → 「发布闲置」；消息空态 → 「去广场逛逛」。

---

## 四、P2 —— 体验打磨（排期灵活）

| # | 项 | 现状证据 | 建议 |
|---|---|---|---|
| 1 | 深色模式不完整 | `data-theme='dark'` 仅 FoxButton / Fox3D / ui.module.css 零星处理，大部分 module.css 未跟进 | 要么补全（把颜色全部收敛到 CSS 变量后加一套 dark 值），要么在设置里隐藏开关——**半黑半白比全亮更伤** |
| 2 | 触觉反馈覆盖窄 | 仅 `alert-effects.ts` / `focus-audio.ts` 用 `navigator.vibrate` | 点赞、发送成功、发布成功、Pull 触发阈值各补一次轻震（10–15ms） |
| 3 | 页面切换无过渡 | `App.tsx` 的 `Routes` 直切，无 AnimatePresence | 二级页推入 180ms 淡入 + 8px 位移；**必须与 DialogLayer 的退出动画错开层级**，且 reduced-motion 时关闭 |
| 4 | 搜索体验单薄 | `PageHeader.tsx` 的 `SearchField` 有基本形态（清除按钮、enterKeyHint），但无防抖、无历史、无热门 | 300ms 防抖 + localStorage 历史（最近 10 条）+ 空查询态 |
| 5 | H5 无刷新手段 | `usePullRefresh` 仅 `IS_NATIVE` 启用 | H5 保留浏览器原生下拉即可，但在设置页说明；或给 H5 加个不打扰的「点击标题刷新」 |
| 6 | 头像/内容图 alt 缺失 | 大量 `<img alt="">`（装饰性正确，但帖子配图、商品图是内容图） | 内容图补描述性 alt，装饰图维持 `alt=""` + `aria-hidden` |
| 7 | 管理端公告已读回执 | `AdminNewsPage` 发公告无已读统计 | 读 `notify_reads` 类表做「x/y 已读」，管理端有价值 |

---

## 五、登录问题专项（服务端排查指引）

本次排查已确认**代码层无回归**：

- 线上 OTA bundle 与本地 1.2.114 产物逐字节一致（双 chunk `auth-BPKMkDK7.js` / `cb-DnxzAKer.js` 同名同内容，bundle sha256 与 manifest checksum 一致）；
- `auth.tsx` 自 1.2.38 起未再修改（`git log` 证明），`signOut-before-verify` 时序从 initial commit 就在，且 10-09 还有成功注册记录；
- 线上数据快照：profiles 15 人（最新 10-09 16:49）、plaza_posts 1 条、chat_messages 7 条（9-17 测试数据）、tasks 0、help_items 0——**10-09 之后零新注册**。

因此「手机号登录不进去」按概率指向服务端，请按序排查：

1. **CloudBase 短信余量**（最可能）：控制台 → 环境 → 短信服务，看剩余条数与本月消耗。升级标准版（10 月）后短信额度可能被重置或需单独购买，耗尽后 `signInWithOtp` 直接报错。
2. **短信签名 / 模板审核状态**：签名或模板被驳回后发送会失败但错误码不直观。
3. **拿设备红字原文**：登录页错误区已加 `role="alert"`（1.2.115），仍失败时请把红字原文发来——`errText` 透传 SDK message，不同错误码指向完全不同根因（配额 / 签名 / 频率限制 / 网络）。
4. **设备网络**：App 直连 CloudBase，不走电脑代理；换网络（4G/5G）排除 Wi-Fi 劫持。
5. **兜底登录路径**：账号密码 tab 仍可用（学号 + 教务密码，或手机号 + 已设 App 密码），极端情况下可作为临时通道。

---

## 六、附：反模式扫描命令（可复跑）

```bash
# 原生弹窗（会破坏套壳体验）
grep -rn "window\.alert\|window\.confirm" src/ --include=*.tsx
# 骨架屏覆盖
grep -rln "Skeleton" src/pages src/components
# 键盘适配覆盖
grep -rn "kb-inset" src/ --include=*.css --include=*.ts --include=*.tsx
# 长按 / 左滑
grep -rn "contextmenu\|swipe" src/ --include=*.tsx --include=*.css
# 减少动效降级
grep -rln "prefers-reduced-motion" src/
# 触摸目标
grep -rn "min-height: 44" src/ | wc -l
```
