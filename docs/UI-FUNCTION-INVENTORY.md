# 阳光校园 · 全项目功能与 UI 清单

> 源码根：`src/` ｜ React 19 + Vite + TypeScript + Capacitor 7 + 腾讯云 CloudBase
> 版本基线：1.2.30 ｜ 主题：双主题（浅色默认 + `data-theme='dark'`），持久化 `localStorage['app.theme']`
> 本清单为「UI 人性化 / 高级交互」改造的落地底稿。

---

## 1. 模块总览

| 业务域 | 主要页面文件 |
|---|---|
| 首页 | `HomePage.tsx` |
| 服务聚合 | `ServicesPage.tsx` |
| 学业 | `study/StudyHubPage.tsx`、`study/StudyFocusPage.tsx`（番茄钟）、`study/ZhongcePage.tsx` |
| 课表 | `schedule/ScheduleHome.tsx` |
| 待办 | `TodoPage.tsx` |
| 二手集市 | `MarketPage.tsx`、`ItemDetailPage.tsx` |
| 任务跑腿 | `TasksPage.tsx`、`TaskDetailPage.tsx` |
| 餐饮（食堂档口） | `FoodPage.tsx` |
| 购物（小店街） | `ShopStreetPage.tsx`、`ShopDetailPage.tsx` |
| 消息 / IM | `MessagesPage.tsx`、`ChatPage.tsx`、`ChatListPage.tsx`、`ChatRoomPage.tsx`、`im/ImDmPage.tsx` |
| 信息广场 | `InfoPage.tsx`、`plaza/PlazaPage.tsx` |
| 钱包 | `WalletPage.tsx` |
| 个人 / 设置 | `ProfilePage.tsx`、`SettingsPage.tsx`、`ContactPage.tsx`、`NotifyPage.tsx` |
| 公益 | `CatCharityPage.tsx` |
| 单词 | `words/WordsPage.tsx`、`WordDuelPage.tsx`、`WordEndlessPage.tsx` |
| 管理端 | `AdminRolesPage / AdminFinancePage / AdminMembersPage / AdminContentPage / AdminNewsPage / AdminReportsPage / AdminPartnersPage` |
| 骑手端 | `RiderWorkbenchPage.tsx` |
| 商家端（小店） | `ShopWorkbenchPage.tsx` |
| 档口端（食堂） | `StallWorkbenchPage.tsx` |
| ❌ 已移除（归档） | `pages/games/**`、`pages/petdex/**`、`games/story/**`（见第 8 节） |

---

## 2. 页面清单（`src/pages/**`）

### 学生端

| 路径 | 路由 | 职责 |
|---|---|---|
| `HomePage.tsx` | `/` | 首页：待办进度环、任务/闲置卡片、天气、上课提醒、公告、快捷入口 |
| `ServicesPage.tsx` | `/services` | 全服务目录，支持 `?q=` 搜索过滤 |
| `TasksPage.tsx` | `/tasks` | 跑腿/互助/结伴任务列表，`?publish=1` 唤起发布 |
| `TaskDetailPage.tsx` | `/task/:id` | 任务详情与接单 |
| `MarketPage.tsx` | `/market` | 二手闲置列表，`?publish=1` 唤起发布 |
| `ItemDetailPage.tsx` | `/item/:id` | 闲置物品详情 |
| `FoodPage.tsx` | `/food` | 食堂档口、菜品浏览与下单 |
| `ShopStreetPage.tsx` | `/shops` | 合伙人小店街列表 |
| `ShopDetailPage.tsx` | `/shop/:id` | 小店详情、购物车、结算 |
| `InfoPage.tsx` | `/info` | 信息站：生活求助、组队出行、失物 |
| `plaza/PlazaPage.tsx` | `/plaza` | 校园广场实时聊天 |
| `MessagesPage.tsx` | `/messages` | 我的消息 |
| `NotifyPage.tsx` | `/notify` | 通知中心 |
| `TodoPage.tsx` | `/todo` | 待办清单：今日/未完成/已完成分段、拖拽排序 |
| `schedule/ScheduleHome.tsx` | `/schedule` | 课表：教务绑定、周次切换、上课提醒 |
| `study/StudyHubPage.tsx` | `/study` | 学业中心：成绩/考试缓存 |
| `study/StudyFocusPage.tsx` | `/study/focus` | **番茄钟**（原生免打扰/屏幕固定 + 每日专注可视化） |
| `study/ZhongcePage.tsx` | `/zhongce` | 综测计算器 |
| `WalletPage.tsx` | `/wallet` | 钱包余额、流水、提现 |
| `CatCharityPage.tsx` | `/games/pet/charity` | 喵粮公益（路由待迁移） |
| `ProfilePage.tsx` | `/profile` | 个人主页 |
| `SettingsPage.tsx` | `/settings` | 设置：主题、角色申请、发布键位置、热更自检 |
| `ContactPage.tsx` | `/contact` | 意见反馈 |
| `ChatPage.tsx` | `/chat` | AI 助手对话 |
| `ChatListPage.tsx` | `/chats` | 会话列表 |
| `ChatRoomPage.tsx` | `/chats/:id` | 会话房间 |
| `im/ImDmPage.tsx` | `/im/dm/:peerId` | IM 单聊 |
| `words/WordsPage.tsx` | `/words` | 单词计划 |
| `words/WordDuelPage.tsx` | `/words/duel` | 单词对战 |
| `words/WordEndlessPage.tsx` | `/words/endless` | 单词无尽模式 |

### 工作台 / 管理端

| 路径 | 路由 | 职责 |
|---|---|---|
| `StallWorkbenchPage.tsx` | `/work/stall` | 档口工作台：菜品管理、接单、营业时间 |
| `RiderWorkbenchPage.tsx` | `/work/rider` | 骑手工作台：抢单池、配送、统计 |
| `ShopWorkbenchPage.tsx` | `/work/shop` | 小店店主工作台：货架、订单、进销存 |
| `AdminRolesPage.tsx` | `/admin/roles` | 角色申请与成员治理 |
| `AdminFinancePage.tsx` | `/admin/finance` | 财务台：提现审核、费率、对账 |
| `AdminMembersPage.tsx` | `/admin/members` | 站长增删管理员 |
| `AdminContentPage.tsx` | `/admin/content` | 内容审核 |
| `AdminNewsPage.tsx` | `/admin/news` | 公告发布与推送 |
| `AdminReportsPage.tsx` | `/admin/reports` | 举报处理 |
| `AdminPartnersPage.tsx` | `/admin/partners` | 合伙人入驻审核 |
| `PartnerApplyPage.tsx` | `/partner` | 合伙人入驻申请 |

---

## 3. 组件清单（`src/components/**`）

### 通用基础

| 路径 | 职责 |
|---|---|
| `lib/toast.tsx` + `context/ToastContext.tsx` | Toast，`toast.ok/err/warn` 分色，`aria-live` 播报 |
| `ConfirmSheet.tsx` | 二次确认弹层（支持「带原因」模式） |
| `PageHeader.tsx` | 页面顶栏（返回 + 标题 + 右侧插槽），另导出 `SearchField` |
| `TabBar.tsx` | 底部导航；学生端 5 tab（首页/服务/+/广场/我的）；发布键 center/fab 两种位置 |
| `PublishSheet.tsx` | 发布入口聚合弹层（从「+」原位流体展开） |
| `TaskSheet.tsx` | 发布任务弹层 |
| `GoodsPublishSheet.tsx` | 发布闲置弹层 |
| `CashierSheet.tsx` | 收银台弹层（食堂单与小店单共用） |
| `ImagePicker.tsx` | 单图上传控件 |
| `ui/motion-ui.tsx` | **高级交互底座**（详见第 5 节） |
| `ui/FocusChart.tsx` | **番茄钟每日专注可视化图表** |

### 外壳 / 全局宿主

| 路径 | 职责 |
|---|---|
| `PhoneShell.tsx` | 手机画布外壳、TabBar 挂载、下拉刷新容器 |
| `BootGate.tsx` | 启动屏放行门 |
| `StatusBar.tsx` | 顶部状态栏 |
| `FirstRunHost.tsx` | 首次运行引导 |
| `AwayLoginHost.tsx` | 离开后返回时的登录弹窗 |
| `RemindHost.tsx` | 学生端课表/待办提醒 |
| `ShellNotifyHost.tsx` | 工作端/管理端业务提醒条 |
| `ShellRouteGuard.tsx` | 多壳路由守卫 |
| `OtaUpdateHost.tsx` | OTA 热更新提示与安装 |
| `CampusGate.tsx` / `CampusAccountCard.tsx` | 校区选择门与校园账号绑定 |
| `CampusScene3D.tsx` | 首页柔光漂浮球体氛围视觉 |

### 业务弹层 / 卡片

`DishSheet` `GoodsSheet` `ProductSheet` `MoveSheet` `HoursSheet` `ShopHoursSheet`
`CanteenReviewSheet` `StoreReviewsSheet` `InfoPublishSheet` `WithdrawSheet`
`RoleApplySheet` `OrderCard` `ShopOrderCard` `WalletPanel`
`FinanceRates` `FinanceStores` `FinanceWithdrawals` `ShopProfilePane`
`HeroCarousel` `StreakBar` `TiltCard` `Thumbs` `Icons` `ScheduleTypeIcon`
`PasswordInput` `Illustrations/TodoEmpty`

---

## 4. 服务与数据层

| 域 | 代表文件 |
|---|---|
| 鉴权 / 账号 | `lib/auth.tsx`、`auth-ui.tsx`、`account.ts`、`campus-account.ts` |
| 校园数据 / 教务 | `campus.ts`、`campus-db.ts`、`academic-cache.ts`、`grade-book.ts`、`exam-utils.ts` |
| 市场（闲置+任务） | `market.ts`、`deal.ts`、`favorites.ts`、`engagement.ts` |
| 订单 / 支付 | `pay.ts`、`native-pay.ts`、`canteen.ts`、`shops.ts` |
| 消息 IM | `im.ts`（按需加载）、`im-core.ts`、`chat.ts`、`ai-chat.ts` |
| 通知提醒 | `notify.ts`、`notify-setup.ts`、`alarm-notify.ts`、`class-remind.ts`、`cert-remind.ts`、`bulletin.ts` |
| 课表 | `timetable.ts`、`schedule-cache.ts`、`schedule-calendar.ts`、`schedule-credentials.ts` |
| 成绩 / 学业 | `academic-cache.ts`、`grade-book.ts`、`zhongce-store.ts` |
| **番茄钟** | `services/focus.ts`（会话 + 免打扰）、`lib/focus-stats.ts`（每日分钟数统计）、`lib/focus-prefs.ts`、`lib/focus-lock.ts` |
| 钱包 / 财务 | `wallet.ts`、`reports.ts`、`sanctions.ts`、`admin.ts`、`moderation.ts` |
| 天气 | `weather.ts`（Open-Meteo + CMA） |
| 热更新 OTA | `live-update.ts`、`app-update.ts` |
| 骑手 / 商户 | `rider.ts`、`shops.ts`、`shop.ts`、`canteen.ts`、`hours.ts`、`work-access.ts` |
| 平台 / 原生 | `platform.ts`、`native.ts`、`back.ts`、`app-shell.ts`、`boot.ts`、`geo.ts` |
| 待办 / 广场 / 公益 | `todo.ts`、`todo-order.ts`、`plaza.ts`、`cat-charity.ts` |
| 动效偏好 | `lib/motion-pref.ts`（尊重 `prefers-reduced-motion`） |

---

## 5. 交互现状

**动效库**：仅装 `motion`（v13，`motion/react`），无 framer-motion。

`motion-ui.tsx` 导出的交互底座：

| 导出 | 作用 | 对应高级交互 |
|---|---|---|
| `SubmitButton` | 按钮原位 loading → ✓ → 结果，`layout` 平滑变宽 | ② 流体胶囊形变 |
| `MenuCloseIcon` / `PlayPauseIcon` | 汉堡↔关闭、播放↔暂停路径变形 | 图标变形 |
| `SegmentedTabs` | 分段标签，指示条 `layoutId` 滑动 | 标签指示条 |
| `ExpandingSearch` | 搜索图标↔输入框同位置展开，随滚动收窄 | 搜索框展开 |
| `StepperButton` | 「加入」按钮↔数量步进器互相变形 | 按钮变步进器 |
| `Collapsible` | 列表内展开详情，其余顺势下移 | ⑦ 列表展开详情 |
| `RevealPanel` | 从按钮位置扩散铺满全屏，内容 stagger 入场 | 菜单铺满全屏 |
| `ViewToggle` | 列表↔网格视图切换，`layoutId` 指示 | 列表切换网格 |
| `useScrollCollapse` | 顶栏随滚动收起 | 顶栏随滚动 |

**新增（本轮 8 项）**

| 导出 | 对应高级交互 |
|---|---|
| `TiltPanel` | ① 3D 倾斜光影面板 |
| `FluidSheet` | ② 流体胶囊形变（抽屉/面板） |
| `SharedExpand` | ③ 共享元素无缝展开 |
| `RollingNumber` / `SnapChart` | ④ 磁吸游标与滚动码表 |
| `DampedSheet` | ⑤ 阻尼弹性抽屉 |
| `GlowBorder` | ⑥ 动态弥散光晕边框 |
| `SpringStagger` | ⑦ 物理弹簧交错流 |
| `Pressable` | ⑧ 按压微缩与回弹 |

**自定义 hooks**：`usePollingRows`（8s 轮询 + 下拉刷新）、`usePullRefresh`、`useToast`、`useAuth`、`useBackInterceptor`、`useAppShell`、`useFavIds`、`useScrollCollapse`。

---

## 6. 视觉规范（`src/index.css`）

**主色实际叫 `--green`，不是 `--brand`；文字层级是 `--text` / `--text-2` / `--text-3`。**

| 变量 | 浅色 | 深色 |
|---|---|---|
| `--green` / `--green-hot` / `--green-deep` | `#67c23a` / `#5cb82e` / `#3d9a32` | 同 |
| `--text` / `--text-2` / `--text-3` | `#2c3a2c` / `#5f705f` / `#6f806f` | `#e4ece4` / `#b6c2b6` / `#9aa89a` |
| `--line` | `#d7e8f5` | `#2a3a28` |
| `--card` | `#ffffff` | `#1a2419` |
| `--blue` / `--ocean` | `#2b7fff` | `#7eb4ff` |
| `--orange` / `--price` | `#ff8c22` / `#ff7a14` | `#ff9a40` |
| `--mint` / `--mint-2` / `--leaf` | `#f3fbe8` / `#e6f6cf` / `#c8ec8a` | 同 |
| `--purple` / `--pink` / `--yellow` | `#9b8cff` / `#ff8aa0` / `#ffd44a` | 同 |

尺寸：圆角 `--radius: 18px`、`--radius-lg: 22px`；画布 `--phone-w: 375px`；`--tab-h: 64px`。
阴影：`--shadow: 0 10px 28px rgba(43,127,255,.12)`、`--shadow-sm: 0 5px 14px rgba(43,127,255,.1)`。
缓动：`--ease-spring: cubic-bezier(.2,.9,.3,1)`、`--ease-out-soft: cubic-bezier(.16,1,.3,1)`。
字号：无 rem 体系，全为 px（浏览器基准 16px）。

---

## 7. 待补的 UI 缺口

1. **骨架屏缺失** — 全项目 0 处 skeleton，列表首屏空白等待。
2. **空状态不成体系** — 只有 `Illustrations/TodoEmpty.tsx` 一个插画组件。
3. **图表可视化刚起步** — 目前只有 `ui/FocusChart.tsx`；财务对账、骑手统计、单词 SRS 曲线仍是纯数字。
4. **错误态/重试缺失** — `usePollingRows` 返回 `error`，多数页面未渲染重试 UI。
5. **无障碍标签覆盖低** — `aria-label` 仅少数文件有，纯图标按钮普遍缺 label。
6. **下拉刷新仅覆盖轮询页** — 首页、详情页、工作台自管数据的页面下拉无响应。
7. **主题切换入口不明确** — 缺少显式三段式选择器（浅色/深色/跟随系统）。
8. **CSS Module 存在硬编码色值** — 部分绕过主题变量，深色模式下会露馅。

---

## 8. 已移除的模块（归档到桌面「新建文件夹」）

| 原路径 | 内容 |
|---|---|
| `src/pages/games/` | `PetGameLayout`、`LygGameHub`、`CampusValleyPage`、`HarborStory`、`HarborWorld`、`LygMiniPlay` + 4 个 css/ts |
| `src/pages/petdex/` | 16 个文件：`PetdexHome/Mine/Dex/Detail/Care/Campus/Explore/Battle/Bag/Library/Adventure`、`AdventureGate`、`BattleStage`、`PackSprite`、`SpriteThumb`、`usePetdexProfile` |
| `src/games/story/` | 港城物语 11 个逻辑模块（world/battle-engine/people/calendar/gather/shop/fx/foxes/save/items + HarborStory 页面） |
| `src/services/games/` | `harbor-world-pack.ts`、`lyg-game-pack.ts` |
| `src/services/petdex/` | 21 个文件（adventure-pack、focus、focus-prefs、party、battle-engine…） |
| `src/data/petdex/` | `species.ts`、`types.ts`、`campus-config.ts`、`campus-map.ts`、`battle-skills.ts`、`species-stats.ts` |
| `src/components/desk-cat/` | 桌宠猫 |
| `src/lib/pet*.ts`、`sprite-pet-bridge.ts`、`desk-cat.ts` | 宠物 lib |
| `public/pets/` | 19MB 宠物图片资源 |

**番茄钟解耦**：`StudyFocusPage` 不再依赖宠物档案与经验果。专注完成记入 `lib/focus-stats.ts`；中断仅提示，不再扣宠物经验。
