# 课表功能拆解 · 新旧两版对照与取舍

来源两个压缩包，里面其实是**同一件事的两套完全不同的实现**：

| 来源 | 内容 | 结论 |
| --- | --- | --- |
| `课表查询.zip` | `jou-api/app.py` + `jou_client.py` + `web/index.html` | **新版**：Python/Flask 常驻服务 + 自带单页 |
| `campus-life-h5 (2).zip` | `cloudfunctions/getTimetable/index.js`（82KB）+ `extensions/jou-timetable-sync` | **旧版**：Node 云函数单文件（该包是部署态快照，无前端源码） |

本次做的事：**两套都拆成模块**，然后给出对照与取舍。

---

## 0. 一句话结论

**服务端主干建议留旧版（模块化后），新版降级为「独立调试单页」。** 旧版能跑在现有 CloudBase 环境上、零依赖、覆盖三种正方形态 + WebVPN 中转 + Cookie 导入旁路、错误码更细还支持免密续拉；新版强在解析严谨（BeautifulSoup 处理 rowspan/colspan）和自带联调 MOCK，这两点建议移植进旧版，其余不必重复维护。

---

## 1. 产出物

```
tools/timetable-decompose/
├── README.md            ← 本文件（对照与取舍）
├── 差异归因.md           ← 为什么两版「提取出来的课表」不一样（实测调查，含真机留档证据）
├── old-cf/              ← 旧版拆解结果（21 个文件，2187 行，逻辑未改）
└── new-py/              ← 新版拆解结果（14 个文件，1059 行，逻辑未改）
```

> 拆解完成后又做了一轮「为什么两版结果不一样」的调查，结论写在 [`差异归因.md`](./差异归因.md)：
> 两版读的是**两个不同的页面**（旧版首页 `Table6` / 新版个人课表 `Table1`），且真机留档实测
> 首页课表 HTML **根本没有教师字段**。另发现新版 `expand_weeks` 对顿号离散周次会丢周（相对旧版是回归）。

拆解原则：**只搬不改**。所有业务判断、正则、注释、错误码、日志文案逐行搬运，只新增 `require` / `import` 与 `module.exports`。已用「顶层符号覆盖度」脚本核对：

- 旧版：原文件 **71 个顶层符号 → 71 个全部覆盖，0 遗漏、0 新增业务符号**
- 新版：原文件 **32 个符号（含私有 `_xxx`）→ 全部覆盖**

---

## 2. 旧版拆解：1848 行 / 82KB → 16 个模块 + 入口

原文件其实**已经有很好的分节注释**（14 个 `// ====` 小节），拆解基本是「按已有小节落文件」，所以迁移风险很低。

| 模块 | 行数 | 职责 | 来源（原行号） |
| --- | ---: | --- | --- |
| `index.js` | 269 | 入口：4 条路由 + 入参校验 + 本地自测 | 1622-1848 |
| `lib/config.js` | 44 | `JW_*` 环境变量 → `CONF` / `UA` | 58-77 |
| `lib/webvpn.js` | 145 | 网瑞达 WebVPN 包裹/还原/未登录墙判定 | 79-201 |
| `lib/cookies.js` | 70 | Cookie 文本 ↔ Map（两处纯函数合并） | 244-273 + 1261-1281 |
| `lib/http.js` | 99 | **唯一发请求出口**：手动 Cookie + 重定向 + 超时 | 275-358 |
| `lib/sessions.js` | 53 | `sid → cookie jar` 内存短会话（TTL 20min） | 205-242 |
| `lib/term.js` | 29 | 学期推算 | 360-378 |
| `lib/weeks.js` | 86 | `zcd` 周次解析 + 课表扁平化 | 380-455 |
| `lib/hints.js` | 33 | 登录入口 URL 提示（教务/WebVPN） | 1564-1581 |
| `lib/json-util.js` | 31 | 教务 JSON 里定位课表数组 | 821-838 |
| `lib/login.js` | 469 | 三种正方形态登录（zfnet/jwglxt/legacy）+ 自动取表 | 457-900 |
| `lib/parsers/index.js` | 61 | 解析统一出口（4 种形态按优先级串联） | 1166-1202 |
| `lib/parsers/grid.js` | 168 | 旧版「列=星期」网格解析 | 902-1043 |
| `lib/parsers/course-list.js` | 65 | 「课程列表型」表格解析 | 1047-1095 |
| `lib/parsers/jou-dayrow.js` | 83 | JOU 首页「行=星期」课表解析 | 1097-1164 |
| `lib/crawl.js` | 72 | 课表页 BFS 逐级跟随 | 1204-1257 |
| `lib/import.js` | 166 | Cookie 会话导入旁路 + `/sync` 免密续拉 | 1259-1417 |
| `lib/query.js` | 53 | 账号+密码+验证码 主流程 | 1419-1452 |
| `lib/captcha.js` | 94 | 验证码获取 | 1493-1562 |
| `lib/captcha-image.js` | 49 | 验证码图片裁剪（纯字节） | 1464-1491 |
| `lib/gateway.js` | 48 | 网关响应 + 入参解析 | 1583-1620 |

> 行数比原来多（1848 → 2187）是因为每个文件都补了模块头注释（说明职责、来源行号、依赖）。

**依赖方向（无循环）**

```
config ─┬─> webvpn ──> http ──┐
        │            cookies ─┴─> login ──┐
term ───┤                                ├─> parsers ─> crawl ─> import ─┐
weeks ──┤            json-util ──────────┘                              ├─> query
hints ──┘            sessions ───────────────────────────────────────────┘
                     captcha-image ─> captcha ─> captcha-image
                     gateway ─> index
```

**为消除循环依赖做的 3 处分拆**（都已在文件头注明）：

1. `findFirstArray` 从 login 节挪到 `lib/json-util.js` —— 它同时被 login 与 parsers 使用。
2. `cropCaptcha` / `captchaDataUrl` 从验证码节挪到 `lib/captcha-image.js` —— 否则 `login ↔ captcha` 成环。
3. `zfLoginHint` / `vpnSiteHint` / `vpnLoginHint` 从验证码节挪到 `lib/hints.js` —— 纯 URL 拼接，与抓取链路无关。

---

## 3. 新版拆解：885 行 → 11 个模块 + 路由层

| 模块 | 行数 | 职责 | 来源（原行号） |
| --- | ---: | --- | --- |
| `app.py` | 188 | 路由层：5 条路由 + 限流 + CORS + 托管 `web/` | 原 app.py 全文 |
| `jou/__init__.py` | 50 | 包出口（对外 API 不变） | — |
| `jou/config.py` | 7 | `BASE_URL` / 超时 / 主页特征串 | 35-37 |
| `jou/errors.py` | 45 | `ScheduleError` 及 5 个子类 | 40-75 |
| `jou/rsa.py` | 38 | 正方前端 RSA（PKCS#1 v1.5） | 78-110 |
| `jou/textutil.py` | 39 | 文本清洗 + 节次换算 | 152-185 |
| `jou/weeks.py` | 24 | 周次文本 → 周数组 | 134-149 |
| `jou/models.py` | 37 | `CourseEntry` + 展平成前端 rows | 113-125 + 422-433 |
| `jou/parser.py` | 273 | HTML 课表解析（网格 + 两种表头布局） | 128-419 |
| `jou/session.py` | 183 | `ZfsoftSession`：取码→登录→抓表 | 436-595 |
| `jou/store.py` | 58 | 一次性会话仓库（TTL 300s） | 598-635 |
| `jou/service.py` | 57 | `create_captcha` / `query_schedule` | 638-676 |
| `jou/mock.py` | 32 | MOCK 样例课表 | 679-704 |
| `jou_client.py` | 28 | **兼容垫片**：旧 `from jou_client import ...` 仍可用 | — |

重命名（去下划线私有前缀，文件头已注明）：`_clean_text→clean_text`、`_section_of→section_of`、`_expand_weeks→expand_weeks`、`_parse_course_cell→parse_course_cell`、`_grid_from_table→grid_from_table`、`_skip_cell→skip_cell`。
另补了一个 `store.peek_session()`，等价替换原 `create_captcha` 里裸读 `_SESSIONS[sid]` 的写法（语义相同）。

---

## 4. 对照表

| 维度 | 旧版（Node 云函数） | 新版（Python Flask） |
| --- | --- | --- |
| 语言 / 运行时 | Node.js 18+（CloudBase 云函数原生） | Python 3 + Flask（CloudBase 不原生跑，需 CloudRun/自备机器） |
| 依赖 | **零第三方依赖**（只用 `node:crypto` + 全局 `fetch`） | `flask` + `requests` + `beautifulsoup4` |
| 部署形态 | 目录直传云函数，按需拉起 | 常驻进程 `python app.py`（默认 8090） |
| 教务形态覆盖 | **3 种**：zfnet(ASP.NET) / jwglxt(新版) / legacy(旧版) | **1 种**：zfnet（直抓 `zfxk.jou.edu.cn`） |
| WebVPN 中转 | **有**（网瑞达反向代理包裹/还原/未登录墙识别） | 无 |
| 手工 Cookie 导入旁路 | **有**（`/import` + 页面网址可选） | 无 |
| 免密续拉 | **有**（`/sync`，会话 TTL 20min，`authed` 标记） | 无（会话一次性 pop） |
| 会话模型 | 内存 Map，TTL 20min，可复用 | 内存 dict + `Lock`，TTL 300s，用后即焚 |
| HTML 解析 | 自研正则（4 种解析器 + JOU 专属 + rowspan 近似） | BeautifulSoup，**rowspan/colspan 精确展开** |
| 已验证回归 | 实捕验证码裁剪用例（JPEG 夹带 HTML）+ WebVPN 编解码逐字符回归 | MOCK 模式端到端 |
| 错误码 | `1001/1002/1003/1004` + **`2001-2004`**（2003 无会话 / **2004 WebVPN 会话失效**专项） | `1000/1001/1002/1004/1005/1006/1007` + HTTP 状态对应 |
| 限流 | 无 | 同账号 **6 次/分钟** |
| 自带前端 | 无（纯 API，接进 `campus-life-h5`） | **有**：`web/index.html` 单文件 H5 |
| 密码安全 | 不落库不打日志，`cred.password` 用完即弃 | `_password` 用后即清；但会落 `_schedule_debug.html` 快照 ⚠️ |
| 单机可扩展性 | 云函数多实例（⚠️ 见 §6-3） | ⚠️ 内存会话 + 线程锁，**多 worker 会失败**（见 §6-6） |

**前端契约差异（迁移时必改）**：两版错误码体系不通用。上轮已集成的 `xm-main` 课表页是按新版 Flask 的 `1001/1002/…` 写的，切回旧版要改 `src/pages/schedule/ScheduleHome.tsx` 的错误码分支，并补 `2001-2004`（尤其 **2004 = WebVPN 会话失效**，旧版会明确提示，新版根本没有这个态）。

---

## 5. 取舍建议

**留旧版做服务端主干**，理由按重要性排序：

1. **运行位置**：`xm-main` 是 CloudBase 项目（env `jou-d4gq7a3cqf51e6caa`）。Node 云函数直传即可，Python Flask 得额外上 CloudRun 或自备机器——纯多一份运维成本，换不来对应收益。
2. **形态覆盖**：3 形态 + WebVPN + Cookie 导入旁路，是应对「教务改版/校外访问被拦」的真实冗余。新版只有一条路，教务一动就全断。
3. **对用户的兜底体验**：`2004 WebVPN 会话失效` vs `1002 密码错` 必须分得清；旧版还带 `/sync` 免密续拉。这两点新版都缺。
4. **零依赖**：云函数冷启动与打包体积都更友好。

**从新版移植两处优点到旧版**（这几项改动小、收益大）：

| 移植项 | 具体做法 |
| --- | --- |
| rowspan/colspan 精确网格 | 把 `jou/parser.py` 的 `grid_from_table` 思路搬到 `lib/parsers/grid.js`：先用严格网格展开，再退回现有正则，替代目前 `walkLegacyGrid` 里的 `stateRem/stateSec` 近似法 |
| MOCK 联调模式 | 给旧版加 `JW_MOCK=1`：`/captcha` 返回 SVG、`/query` 直接回样例课表。前端联调不必反复惊动真实教务（新版还带了限流，旧版没有，可一并抄 6 次/分钟） |

**新版保留的用法**：`web/index.html` 是个能独立打开的单页，适合发给同学/在无 CloudBase 环境下排查「教务能不能连通、验证码能不能出」。建议保留为**独立调试工具**，不要作为线上主干。

**不建议的做法**：两套并行长期维护。它们的解析器/登录逻辑是同源演化，一旦教务改版要改两遍——这正是本次拆解要消除的问题。

---

## 6. 拆解中暴露的问题（**代码未改**，仅如实记录）

1. **旧版 `/import` 的 jwglxt 快路径在 auto 模式下不可达**
   `lib/import.js` 里 `if (CONF.mode === 'jwglxt' || (CONF.mode === 'auto' && auth === 'unknown'))`：走到这行时 `auth` 只可能是 `'ok'`（`'unknown'` 在前面已被重分类，其余值都已提前 `return`），所以第二个条件恒假。表现为 `JW_MODE=auto` + jwglxt 时，导入路径会多绕一次 `crawlSchedule` 而不是直连 JSON 接口——能出结果，但慢且更脆。

2. **旧版重定向上限 6 跳可能不够**
   `lib/http.js` 的 `for (let hop = 0; hop < 6; hop++)`：WebVPN + 教务多重 302 时可能触发「重定向次数过多」。

3. **旧版内存会话与云函数多实例天然冲突**
   `lib/sessions.js` 把 jar 放进程内存，云函数并发扩容到多实例时 sid 可能落到别的实例，`/sync` 直接 2003。低并发演示够用，要稳就落库（如 CloudBase 集合，带 TTL）。

4. **新版会把课表页 HTML 落盘** ⚠️
   `jou/service.py` 写 `_schedule_debug.html`，内容含学号与完整课表。公网部署前应改为环境变量控制或直接删掉。

5. **新版会话 TTL 300s + 一次性 pop，对慢用户不友好**
   用户看验证码多花两分钟就收到「会话已过期，请刷新验证码」，而他刚输入的密码会白填一次。

6. **新版不支持多 worker**
   会话在进程内存 + `threading.Lock`，一旦 `gunicorn -w 2` 以上，`/captcha` 与 `/query` 可能落到不同 worker → 恒报验证码错。上线只能单进程，等于放弃并发。

7. **两版都用「抛普通对象」传错误**（旧版 `throw { kind:'net', msg }`），没有 Error 栈。排查线上问题时拿不到调用链，建议后续换成自定义 Error 子类。

---

## 7. 怎么跑

**旧版（模块化）**

```bash
cd tools/timetable-decompose/old-cf
node index.js                       # 本地自测：路由连通 + 实捕验证码裁剪回归 + WebVPN 编解码回归
```

带配置跑（会尝试真实网络）：

```powershell
$env:JW_BASE_URL="https://zfxk.jou.edu.cn"
$env:JW_MODE="zfnet"
$env:JW_WEBVPN_URL="http://webvpn.jou.edu.cn:58888"
node index.js
```

**新版（模块化）**

```bash
cd tools/timetable-decompose/new-py
pip install -r requirements.txt
MOCK=1 python app.py                # mock 模式，不碰真实教务
python app.py                       # 真实模式（需网络可教务）
```

已验证结果：

- `old-cf`：`node index.js` 4 条路由均按预期返回；WebVPN 编解码 6 项回归**全部通过**（含本校固定样例逐字符比对）；实捕验证码裁剪行为与原版一致。
- `new-py`：`import jou` 正常，兼容垫片 `jou_client` 生效；MOCK 模式下 `/api/health`、`/api/timetable/captcha`、`/api/timetable/query`（66 条 rows）均正确。
