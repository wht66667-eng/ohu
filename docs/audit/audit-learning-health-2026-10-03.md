# 学习、教务、待办与运动功能只读审计

审计日期：2026-10-03。仓库：`C:/Users/upwar/Documents/Codex/xm-main/xm-main`。已阅读 `design-system/campus-ui.md` 与 `.codex/skills/ui-refactor-sunshine/SKILL.md`，以当前源码为准；未修改业务代码、未部署、未读生产凭证、未操作线上数据库。版本号散落且不统一，本报告不以旧版 1.2.82 的完成度作为当前结论。

这部分并非大量空页面：词包已接入原单词学习和 SRS，专注具备恢复、原生提醒、待办确认联动，运动具备 Android 原生计步和 UID 隔离，小队也有真实活动与报名接口。主要欠缺集中在个人数据隔离、可靠同步、题目/时间校验、提醒覆盖和付费开放闭环。未在该范围证实 P0；P1 表示会串个人数据、误导重要学习安排、造成数据同步失效或阻碍一项已规划产品上线；P2 表示体验、能力边界或次要错误恢复缺口。

## 当前完成度

| 功能 | 当前源码已有 | 完成度边界 |
|---|---|---|
| 单词与下载词包 | 清单校验、SHA-256、完整性校验、IndexedDB 保存、去重合并、原词 ID 保留、旧进度迁移；下载后进入原计划/SRS/速对/无尽 | 词包本机保存；自定义词、SRS、计划仍是设备共用数据，无云备份 |
| 遗忘曲线 | 简化 SM-2；忘记/犹豫 10 分钟后复习，记得后按 1 天、3 天及 ease 增长；到期自动刷新 | 并无每日已学累计，日目标只作为当前队列大小；“已掌握”实际为至少一次成功评分 |
| 私人题库与试卷 | AI 文本出题、导入、手动选题组卷、评分、最多 20 次答卷、本机按 UID 隔离、云端读写 | 写入/删除属于尽力而为；没有可靠重试、删除墓碑、完整分页，当前“同步已完成”只确认读取 |
| 付费文件出题 | TXT/DOCX/PDF 解析、服务端身份校验、配额预留/退回、同任务幂等、逐题原文引用验证、任务恢复、原题库入库、跨账号取消 | 购买永远关闭；没有真实支付发放回调。源码默认关闭；本轮不能确认线上 enabled 状态 |
| AI 助记 | 复用 `/api/chat`、按词与释义缓存、取消/超时、失败本地提示 | 失败时为模板提示；无明确降级来源标记 |
| 专注 | 绝对截止时间、暂停/续时、后台恢复、单次结算、按 UID 保存、系统勿扰/屏幕固定、原生专注及休息提醒、待办完成确认 | 统计、音乐、本地任务保存在设备；Android/iOS 真机行为尚待实测 |
| 课表/教务成绩/考试 | OCR 自动同步与手输验证码回退、当前 App 账号缓存归属、部分失败保留缓存、课程/成绩/考试展示与提醒 | 学期起点写死；空课程返回不更新持久缓存；手工成绩本与记住凭证仍未按 UID 隔离 |
| 待办 | 云端增改删/完成、筛选、排序、本机提醒镜像与原生闹钟、账号切换撤回 | 一次最多取 200 项，提醒只保留 40 项、仅排未来 7 天；没有覆盖范围提示 |
| 运动健康 | Android 系统计步、Web 运动传感器估计、手动输入、步数目标、周趋势、心率/睡眠/体重/饮水手动记录、UID 隔离 | HealthKit/Health Connect 没接；无 GPS 轨迹/实时配速；距离、热量、活动分钟按步数估算；无云备份 |
| 阳光跑小队 | 真正读取活动/报名，发布、加入、退出、取消、发起人名单、旧标签兼容、账号切换控制 | 尚无代码/假测试能证明生产数据库的容量并发约束和名单权限；未做真实账号端到端验证 |

## P1：优先补齐

### 1. 教务/VPN 记住凭证未按 App 账号隔离，而且只有可逆混淆

**实际场景：** A 在共用手机保存教务密码，退出后 B 登录并打开学习中心。表单仍从全设备固定 key 读取 A 的学号和密码；校园账号页也可以读取 VPN 密码。教务快照的 UID 隔离无法覆盖这一入口。

**证据：** [schedule-credentials.ts:8](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/schedule-credentials.ts:8) 的三项 key 均无 UID；[schedule-credentials.ts:26](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/schedule-credentials.ts:26) 和 `xorReveal` 使用源码固定混淆串；[StudyHubPage.tsx:93](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/study/StudyHubPage.tsx:93) 直接回填；[campus-account.ts:13](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/campus-account.ts:13) 的 VPN/记住开关也为设备 key。全仓库搜索未发现登出/账号切换清理这些凭证的处理。

**建议：** 凭证按 UID 归属；旧无归属数据需要用户确认，不能自动认领；原生敏感凭证使用平台安全存储；至少在登出及身份变化时清除页面中的密码，并避免访客读取。**确定程度：高，源码直接可证；未访问真实密码。**

### 2. 单词进度、自定义词、计划以及手工成绩/综测数据仍会串账号

**实际场景：** A 背过的词到明天才复习，B 切换账号后也沿用该到期时间、A 的自定义词与计划；B 打开“本机成绩本”或综测会看到 A 的输入。

**证据：** [srs.ts:16](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/services/words/srs.ts:16)、[plans.ts:7](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/services/words/plans.ts:7)、[banks.ts:54](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/data/words/banks.ts:54)、[grade-book.ts:17](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/grade-book.ts:17)、[zhongce-store.ts:4](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/zhongce-store.ts:4) 都用无身份 key；下载词库 [personal-exam-vocab.ts:68](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/personal-exam-vocab.ts:68) 也只访问设备 `words` 记录。单词积分已经按 UID 记账，题库、专注、运动和教务远端快照已隔离，故不是“所有本机数据都没隔离”。

**建议：** 至少隔离个人输入和学习状态；纯公共下载包可设备复用，个人下载选择与学习进度单独归属；迁移旧 key 时保留原数据并显式确认。**确定程度：高，源码与纯内存检查一致。**

### 3. 题库云同步缺少可靠写入确认、重试和删除同步，离线删除会复活

**实际场景：** 用户离线删题，页面显示删除成功；云端删除失败后，下次进入学习中心又把该题拉回来。离线新增题目只有这次“写一次”的机会，后续“同步已完成”也不能证明已上传。换设备可能拿不到完整题库。

**证据：** [qbank.ts:250](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/qbank.ts:250) 的 insert 不检查返回 `error`；[qbank.ts:322](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/qbank.ts:322) 删除吞错；[qbank.ts:448](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/qbank.ts:448) 合并只有 union，无墓碑；[EnglishHubPage.tsx:54](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/english/EnglishHubPage.tsx:54) 仅据 `pullCloud()` 成功显示同步完成。此外 [qbank.ts:424](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/qbank.ts:424) 只拉 500 题/200 卷/500 答卷且无分页，超过范围不会得到完整记录。

**本轮复现：** 假云端返回离线删除错误，原本本机 0 题；下一次 `pullCloud()` 返回 true，本机恢复到 1 题。全部使用 VM 和内存存储。

**建议：** 持久化待上传/待删除操作及重试队列，检查服务端错误；用带版本的删除墓碑或统一服务端权威同步；展示“本机已保存/待同步/已同步”区别；游标分页。**确定程度：高，已合成复现。**

### 4. 免费 AI 文本出题校验仍会把无效答案变成“正确答案”

**实际场景：** 模型判断题没给合法答案，系统直接把它定为“错”；模型给了同 key 的两个选项也能进库，后续答题与评分不可信。付费文件入口的严格校验已防住此类格式，缺陷在免费文本入口。

**证据：** [parse.ts:105](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/services/qbank/parse.ts:105) 以“不是 true 就 false”归一化；[parse.ts:121](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/services/qbank/parse.ts:121) 单选只要求至少两项，没有唯一 key/文本约束；[generate.ts:80](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/services/qbank/generate.ts:80) 解析到任意题目即返回成功，未要求所选题数/题型完整一致。

**本轮复现：** `judge + answer:'unknown'` 被接受为 false；重复 `{key:'A',text:'相同文本'}` 的两个选项被接受。**建议：** 共享付费入口中的合法题型、明确答案枚举、唯一选项、题数和引用校验；无效题返回具体问题，不自动猜答案。**确定程度：高，已合成复现。**

### 5. 考试时间会凭空补成 09:00，非法日期也会被归一后排闹钟

**实际场景：** 教务只返回日期，应用按 9 点生成“开考”和提前两小时提醒；返回格式异常的时间也可能在另一日期触发。校园规范要求不制造课程和考试安排。

**证据：** [exam-utils.ts:21](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/exam-utils.ts:21) 日期分支补 9 点；[exam-utils.ts:16](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/exam-utils.ts:16) 未校验日期组件；[exam-utils.ts:80](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/exam-utils.ts:80) 解析结果直接用于系统通知。

**本轮复现：** `2027-01-08` 返回本地 09:00；`2027-02-30 25:90` 返回 2027-03-03 02:30。**建议：** 区分“已确定时刻/只有日期/时间待定”，严格回查日期组件；只有日期可做明确标为“日期提醒”的通知，不做虚构开考闹钟。**确定程度：高，已合成复现。**

### 6. 教务成功返回空课表时只清页面，不清旧缓存和旧课程闹钟

**实际场景：** 退课、取消课程或新学期暂未排课后同步得到空数组，当次课表页是空的，回首页/重启却可能继续读旧课程，旧闹钟也还在。

**证据：** [ScheduleHome.tsx:440](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/schedule/ScheduleHome.tsx:440) `setRows([])` 后直接 return，不保存空快照/撤回课程提醒；[StudyHubPage.tsx:356](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/study/StudyHubPage.tsx:356) 空 rows 被当作无需保存；[auto-sync.ts:44](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/auto-sync.ts:44) 也仅 rows.length 才持久化；[schedule-cache.ts:55](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/schedule-cache.ts:55) 空快照又被判 missing。

**建议：** 区分“抓取失败/未返回该分类”和“成功确认课程为空”；成功空数组持久化为确认过的空快照并取消旧课表闹钟，失败才保留上次缓存。**确定程度：高，全部同步入口一致缺漏，未请求学校账号验证。**

### 7. “建议补星期几课”立即改真实课表与提醒，未要求学校安排确认

**实际场景：** 学校在调休日安排与内置建议不同，应用已经自动把周末切到建议星期的课，首页下一课和提醒也随之变化。

**证据：** [schedule-calendar.ts:95](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/schedule-calendar.ts:95) 内置规则明称“常见补课映射”；[schedule-calendar.ts:179](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/schedule-calendar.ts:179) 默认取这些规则；[schedule-calendar.ts:208](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/schedule-calendar.ts:208) 直接赋 `effectiveDay`，无用户确认状态；[ScheduleHome.tsx:1168](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/schedule/ScheduleHome.tsx:1168) 仅在设置中提示用户按学校通知改。

**建议：** 推荐映射作为待确认提示，学校公告或用户确认后才影响课程/闹钟；法定假期也需与校历冲突可见。**确定程度：高（默认生效行为），不判断特定日期的学校安排是否错误。**

### 8. 待办列表和提醒静默截断，先创建的重要事项会失去提醒

**实际场景：** 超过 40 个有到期的未完成待办时，近期到期但创建较早的待办不在提醒镜像。若超过 200 项，列表也不完整；用户看到“到期前会提醒”却没有被告知部分待办没有排程。

**证据：** [todo.ts:50](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/todo.ts:50) 全量取数 `.limit(200)`；[market.ts:93](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/market.ts:93) 无服务端排序，仅截断之后本机按创建时间排序；[todo-remind.ts:22](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/todo-remind.ts:22) MAX_ITEMS=40；[todo-remind.ts:63](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/todo-remind.ts:63) 未先按到期紧急程度排序便 slice。同文件:21/111 限未来 7 天；[RemindHost.tsx:79](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/components/RemindHost.tsx:79) 在回到前台时才刷新。 [TodoPage.tsx:427](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/TodoPage.tsx:427) 仍展示关闭 App 也会准点提醒。

**建议：** 列表分页；提醒优先按最近 due_at，展示真实覆盖范围及未排程数量；采用滚动续排机制，至少明确长期不打开应用后的覆盖期限。**确定程度：高（源码限制），数量场景未操作真实待办。**

### 9. 付费文件出题有核心实现，但真实购买/充值/退款流程尚未闭环

**实际场景：** 普通新账号初始 0 次，无法购买后开始文件出题。不能把接口和客户端完成理解为该付费产品可以正式售卖。

**证据：** [examGenerator/index.js:32](C:/Users/upwar/Documents/Codex/xm-main/xm-main/cloudfunctions/examGenerator/index.js:32) `canPurchase:false`；[examGenerator/README.md:47](C:/Users/upwar/Documents/Codex/xm-main/xm-main/cloudfunctions/examGenerator/README.md:47) 明确支付发放回调和真实购买均未接入；[PaidFileGenerator.tsx:156](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/english/PaidFileGenerator.tsx:156) 对关闭与无次数状态如实提示。

**建议：** 配置价格和真实支付订单/签名回调，核实到账金额后用受保护 RPC 幂等发次数，配退款/退回及运营查询；完成测试后由维护者明确启用。**确定程度：高（购买接口与源码），线上运行配置未知：本轮公开 GET /config 的 PowerShell 和 Node 读取均连接失败，未拿当前线上 enabled 值，也未对余额或数据库做访问。**

## P2：后续完善

### 10. 单词“日目标”只有队列大小，“已掌握”只有成功学过一次

**实际场景：** 设日目标 15 词，背完 15 词，页面又展示 15 词，没有今日完成/还差几词；点一次“记得”就提高掌握百分比。

**证据：** [srs.ts:74](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/services/words/srs.ts:74) dailyGoal 仅传给 slice；:75 learned 仅 `repetitions > 0`；[WordsPage.tsx:223](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/words/WordsPage.tsx:223) 展示“日目标/已掌握”。**本轮复现：** 四级 333 词、目标 15，15 次复习后仍返回 15 张，下次待学 318。**建议：** 按 UID+日期累计独立新词/复习数；真实进度展示，达标后可选择继续；“已学”与稳定掌握分开。**确定程度：高，已合成复现。**

### 11. 自定义单词导入/删除吞存储错误，速对储存失败还会卡住作答

**实际场景：** 设备存储满，批量导入宣称成功但没有保存；单个添加可能误报“该词已存在”。速对发生相同存储错误时，`answering` 锁已设 true，不能再答本题。

**证据：** [banks.ts:70](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/data/words/banks.ts:70) 捕获并忽略错误；:138 无条件返回 added；[WordsPage.tsx:185](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/words/WordsPage.tsx:185) 用长度不变判断重复；:212 宣称导入成功；[WordDuelPage.tsx:85](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/words/WordDuelPage.tsx:85) 先锁再无 catch 调 reviewCard。**本轮复现：** 合成配额失败，导入返回新增 1，实际保存 0。**建议：** 存储失败向 UI 返回错误，不清输入；速对捕获错误并解除锁或给重试。**确定程度：高，导入已复现、速对为直接控制流证据。**

### 12. 学期、个人备份和学习历史仍缺持续维护能力

**实际场景：** 到下个学期仍从 2026-08-31 算周次；换手机/卸载清数据丢单词进度、专注统计与运动记录；题库答卷最多留 20 次。

**证据：** [ScheduleHome.tsx:72](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/schedule/ScheduleHome.tsx:72)、[schedule-cache.ts:11](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/schedule-cache.ts:11) 学期固定，保存也使用该常量；[focus-store.ts:34](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/focus-store.ts:34) 本机仓库；[qbank.ts:229](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/qbank.ts:229) 答卷截到 20；单词与健康在上述本机 key 内。**建议：** 学期元数据由教务实际返回或用户可确认设置；做导出/导入或明确同意后的云备份；提供更长历史时不要静默丢弃。**确定程度：高；本机保存是有意产品边界，本项为能力补齐而非必然程序错误。**

### 13. 运动已经能计步，但尚未成为完整跑步/健康追踪产品

**实际场景：** 用户想记录跑步路线、实时配速、直接读 Apple 健康/Health Connect 或自动心率/睡眠，现在都不能完成；加入小队也不会自动开启计步。

**证据：** [SportsPage.tsx:398](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/SportsPage.tsx:398) 无轨迹/实时配速且相关量为估算；:436 未接健康平台；[health.ts:437](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/health.ts:437) 健康平台接口返回 null；[HealthPlugin.java:25](C:/Users/upwar/Documents/Codex/xm-main/xm-main/android/app/src/main/java/com/sunshinecampus/app/HealthPlugin.java:25) 为 TYPE_STEP_COUNTER；[MorningTeamsPage.tsx:238](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/MorningTeamsPage.tsx:238) 小队说明不自动记录运动。**建议：** 如有产品需求，补原生健康读取、GPS 会话及生命周期处理，并始终区分记录源和估算值。**确定程度：高。当前明确说明限制，不应称现有步数全是假数据或只手动。**

### 14. AI 助记降级提示和小游戏计时/答案选项需要收尾

**实际场景：** 模型不可用时显示统一模板，用户无从知道此次没生成有效助记；两词释义相同，速对可能出现重复“正确”选项；小游戏进入后台后计时受 interval 节流影响。

**证据：** [fox-ai.ts:57](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/lib/fox-ai.ts:57) AI 失败返回模板，WordsPage 只渲染文本；[srs.ts:124](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/services/words/srs.ts:124) 干扰项只排除 id，没排除正确释义/重复释义；[WordDuelPage.tsx:59](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/words/WordDuelPage.tsx:59)、[WordEndlessPage.tsx:94](C:/Users/upwar/Documents/Codex/xm-main/xm-main/src/pages/words/WordEndlessPage.tsx:94) 为每次 interval 减一，未用绝对截止时间。

**建议：** 显示离线提示来源与重试；唯一化答案文本，排除正确含义；参考已完成的 focus-timer 处理绝对截止时间，或明确后台暂停。**确定程度：高（代码）；真实 WebView 节流程度待真机验证。**

## 验证与证据边界

- 运行 `tools/health.test.mjs`、`tools/focus-store.test.mjs`、`tools/focus-timer.test.mjs`、`tools/morning-team.test.mjs`：37/37 通过。使用合成 UID、内存存储、假传感器和假查询；未联系生产数据库。
- 运行 `scripts/import-exam-data/test-file-generation-api.mjs`：16/16 通过。合成文档、临时 RSA、假余额/RPC/模型；原始 TXT/DOCX/PDF 解析通过，不发生真实扣费。
- 运行 `scripts/import-exam-data/test-paid-file-client.mjs`：所有检查通过。网络、凭证、存储为显式替身，临时目录由测试清理。
- 另用 TypeScript 转译至 VM、内存存储和假云端复现日目标、导入假成功、删题复活、免费 AI 脏答案/重复选项、考试猜时间/非法时间。这些复现没有写应用数据。
- 上述测试证明关键本地逻辑，不等同于当前生产 RLS、在线配额事务、支付回调、真实教务接口或 Android/iOS 真机已验收。阳光跑小队的满员并发约束及名单可见性仍应使用隔离测试账号/测试环境验证；本轮没有证据声称它们在线失效。
- 专注已有身份隔离、截止时间恢复、原子结算和专属通知槽；运动已有 UID 隔离、拒权/设备无传感器/重启计数回退/陈旧读取消/存储失败处理。这些已完成点不应再列为未实现。

