# 江苏海洋大学课表 API（Flask + 云托管）

独立 Python 服务：用户提交 **学号 + 教务密码 + 验证码**，服务端登录正方教务系统（`zfxk.jou.edu.cn`）
抓取个人课表并返回前端可直接渲染的结构。H5 站点与它解耦，通过公网 HTTPS 调用。

## 线上地址（当前部署）

| 用途 | 地址 |
| --- | --- |
| 后端基地址（H5 里 `VITE_TIMETABLE_API` 的值） | `https://jou-d4gq7a3cqf51e6caa-1394316826.ap-shanghai.app.tcloudbase.com` |
| 取验证码 | `POST {base}/api/timetable/captcha` |
| 提交查询 | `POST {base}/api/timetable/query`（可选 `fetch: ["schedule","grades","exams"]`） |
| 健康检查 / 预热 | `GET {base}/api/health` |

部署形态：CloudBase 云托管（CloudRun）容器型服务 `jou-api`，经 HTTP 网关默认域的路由
`/api/timetable`、`/api/health` 转发（`upstreamResourceType=CBR`、开启路径透传、不鉴权），
因此 Flask 收到的仍是完整路径 `/api/timetable/xxx`，路由代码与本地一致。

## 接口契约

| 方法 | 路径 | 入参 | 返回 |
| --- | --- | --- | --- |
| GET/POST | `/api/timetable/captcha` | – | `{ok, sid, image}`，`image` 为 PNG 的 `data:` URL |
| POST | `/api/timetable/query` | `{username, password, captcha, sid, fetch?}` | `{ok, rows?, grades?, exams?}` 或错误；`fetch` 默认 `["schedule"]`，学业中心传 `["schedule","grades","exams"]` |
| POST | `/api/timetable/auto` | `{username, password, fetch?}` | 服务端 OCR 验证码后返回课表/成绩/考试；未装 OCR 时 `1010` |
| GET | `/api/health` | – | `{ok, mock, version, sessions, upstream_inflight, ocr}` |

错误码（前端课表页依赖，勿改语义）：

| code | HTTP | 含义 | 前端行为 |
| --- | --- | --- | --- |
| `1000` | 400 | 学号/密码未填 | 提示补全 |
| `1001` | 400/401 | 验证码错、会话过期 | **自动换图并清空验证码输入** |
| `1002` | 401 | 教务密码错 | 提示密码错误 |
| `1004` | 429 | 限流 / 服务繁忙（带 `Retry-After`） | 提示稍后再试，冷却期间禁用提交 |
| `1005` | 401 | 登录失败（学号不存在/被限制等） | 展示 message |
| `1006` | 504/500 | 上游超时 / 服务异常 | 提示重试 |
| `1007` | 502 | 课表页解析失败 | 提示教务页面结构变化 |
| `1010` | 501 | 服务端未启用验证码自动识别（未装 ddddocr） | **退回手输验证码流程**，不算故障 |

## 验证码自动识别（`/api/timetable/auto`）

`/auto` 免去用户手输验证码：服务端自己取图 → OCR 识别 → 直接登录教务。
入口在 `captcha_ocr.py`，依赖 `ddddocr`（已写入 `requirements.txt`，**装与不装都能跑**）。

| 状态 | `/api/health` 的 `ocr` 字段 | `/auto` 行为 |
| --- | --- | --- |
| 已装 ddddocr | `{"ready":true,"engine":"ddddocr","error":null}` | 走 OCR；识别失败仍可能回 1001/1005 |
| 未装 ddddocr | `{"ready":false,"engine":null,"error":"No module named 'ddddocr'"}` | 立即回 `1010 / ocr-unavailable`（501），前端自动降级为手输 |

识别准确率实测（2026-10-14，抓 8 张线上真实验证码，放大 5 倍逐张人工核对）：**8/8 全部吻合**。

取舍与回退：ddddocr 会带入 onnxruntime + opencv，镜像体积可 >800MB，云端「创建版本」耗时明显变长
（首次部署约 10 分钟）。若镜像构建频繁失败或需要瘦身，把 `requirements.txt` 里 `ddddocr==1.6.1`
那行注释掉重新部署即可退回手输 —— 前端对 `1010` 有完整降级，**不会白屏也不会卡住**。

## 运行方式

### 生产（Docker，云托管）

```bash
docker build -t jou-api xm-main/tools/jou-api
docker run --rm -p 8090:8090 -e MOCK=0 jou-api
```

镜像内启动命令（见 `Dockerfile`）：

```bash
gunicorn -w 1 -k gthread --threads 16 --timeout 60 --graceful-timeout 30 -b 0.0.0.0:8090 app:app
```

> ⚠️ **必须单 worker**。验证码会话保存在进程内存中，「取验证码 → 提交查询」是两次独立请求，
> 必须命中同一进程；`-w 2` 及以上会出现会话不命中，用户侧表现为"验证码错误/会话过期"(1001)。
> 并发不靠 worker 数，而靠应用内的信号量闸门 `MAX_UPSTREAM_CONCURRENCY`（默认 4），
> 因此线程数给足（16）即可。**要横向扩容，必须先把会话迁到共享存储（Redis/PG），另开任务。**

### 本地调试

```bash
cd xm-main/tools/jou-api
pip install -r requirements.txt
python app.py                 # 默认 0.0.0.0:8090，连真实教务
MOCK=1 python app.py          # 不连真实教务，返回 7 条样例课表
PORT=9090 python app.py       # 换端口
```

PowerShell：`$env:MOCK="1"; python app.py`

### 云托管部署参数（改配置时对齐这些值）

```
serverName      : jou-api
serverType      : container          # 容器型，源码构建（构建上下文 = 本目录）
Port            : 8090
MinNum / MaxNum : 1 / 1              # 单实例：内存会话必须命中同一实例，勿改大
Cpu / Mem       : 0.5 / 1
OpenAccessTypes : ["PUBLIC"]
InitialDelaySeconds : 60             # Python 冷启动留足时间
```

三种改法：① 控制台「云托管 → jou-api → 服务设置」；② `tcb` CLI 的 cloudrun 子命令（`tcb cloudrun -h`）；
③ 通过 IDE 的 CloudBase MCP 工具（本次部署采用）。

### CLI 部署命令（含两个必踩的坑）

```bash
cd tools/jou-api
# 坑 1：本机 HTTP(S)_PROXY + NODE_USE_ENV_PROXY 会让 tcb 连不上 COS，必须清掉
# 坑 2：CLI 3.7.3 的 `--force` **不覆盖**「Enable gray deployment?」这个交互提问，
#        后台无 stdin 运行会永久挂住（实测挂过 2h15m 且无任何输出）。
#        用 printf 喂一个回车即默认选 No（成功后自动切流量）。
printf '\n' | env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  -u ALL_PROXY -u all_proxy -u NODE_USE_ENV_PROXY NO_PROXY='*' no_proxy='*' \
  tcb cloudrun deploy --source . --service-name jou-api --port 8090 --force --wait
```

部署中会逐项打印 `CreateVersion / RunPipeline / GrayRelease / ReleaseVersion` 状态。
想确认是否真的上线，别只看 CLI：`tcb cloudrun detail --service-name jou-api` 里的
`OnlineVersionInfos` 应出现新版本号（如 `jou-api-008`），或直接
`curl .../api/health` 看 `ocr.ready` 是否变 true。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `MOCK` | 空 | `1` = 不访问真实教务，返回样例数据（生产不要设） |
| `PORT` | `8090` | 监听端口（云托管自动注入） |
| `MAX_UPSTREAM_CONCURRENCY` | `4` | 同时访问教务系统的请求数上限（核心防封 IP 手段） |
| `UPSTREAM_ACQUIRE_TIMEOUT` | `10` | 争取并发槽位的等待秒数，超时回 1004 |
| `RATE_LIMIT_PER_MIN` | `6` | 同一学号每分钟查询次数 |
| `IP_CAPTCHA_PER_MIN` | `120` | 同一 IP 每分钟取验证码次数（放宽以兼容校园网 NAT 出口） |
| `IP_QUERY_PER_MIN` | `60` | 同一 IP 每分钟查询次数 |
| `GLOBAL_QUERY_PER_MIN` | `120` | 全站每分钟查询次数 |
| `MAX_SESSIONS_PER_IP` | `40` | 同一 IP 未消费的验证码会话上限 |
| `MAX_CAPTCHA_SESSIONS` | `800` | 进程内验证码会话总量上限（超出淘汰最旧） |
| `UPSTREAM_CONNECT_TIMEOUT` / `UPSTREAM_READ_TIMEOUT` | `5` / `20` | 访问教务系统的连接/读取超时（秒） |
| `SAVE_DEBUG_HTML` | 空 | `1` = 把最近一次课表页快照写到 `_schedule_debug.html`（默认关闭） |

来源 IP 默认只采用连接对端，忽略客户端伪造的 `X-Forwarded-For`／`X-Real-IP`。
仅在已核实网关会追加真实来源、且应用只能经该网关访问后，配置
`TRUSTED_PROXY_HOPS`（1–5）和 `TRUSTED_PROXY_CIDRS`（逗号分隔的真实代理网段）。
两者缺一或对端不在网段内时，仍采用连接对端；从链的右端按可信跳数取值。
不要把 `0.0.0.0/0` 当作可信代理。未配置时，共享网关出口会共享 IP 限额；
需要根据实际网关拓扑验证后调整，不能为避免限流而重新信任任意转发头。

### 安全回归（2026-11-02）

`2.4.1-security150` 将三个教务查询入口统一到相同的限流与输入边界：
JSON 对象、字符串凭据、8KB 请求体、OCR 最多8次；旧 `/api/schedule` 同样受保护。
所有 `/api/` 响应（含错误）带 `Cache-Control: no-store`，请求解析错误不会回显原文；
上游异常日志不再附带可能包含个人信息的原始异常堆栈。RSA填充改用系统密码学随机数。

开源工具：Schemathesis4.33.0、Hypothesis6.170.14（接口生成测试）、Bandit1.9.4、
pip-audit2.10.1；Gitleaks8.30.1用于独立源码／Git扫描。工具仅安装在本机隔离环境，
不添加到生产依赖。测试以 `test_security_attacks.py` 为入口，全部学校请求均替换为合成结果：

```powershell
& '.\.codex\qa\security150\venv\Scripts\python.exe' -X utf8 -m pytest tools/jou-api/test_security_attacks.py tools/jou-api/test_read_integrations.py -q
```

命令从项目根目录执行。测试会新增仅在测试进程内存在的Schema路由；生产Docker不复制测试文件。
依赖审计结果不等同于确认漏洞可在本项目被远程利用；具体结果见项目安全报告。

## 安全与隐私

- 教务密码仅在本次请求内存中用于生成 RSA 密文，**不写日志、不落盘、不入缓存**，请求结束即清引用
- 日志只记录：短请求 id、**掩码学号**（`2025***01`）、掩码 IP、错误码、reason、耗时；
  密码与验证码原文永不入日志，验证码会话 id 只打印前 8 位
- 验证码会话：5 分钟 TTL（300 秒）、总上限 800、单 IP 未消费上限 40，均带锁清理
- 限流分层：全站 → 来源 IP → 学号；被限流返回 1004 并带 `Retry-After`
- 并发闸门：即使被恶意并发冲击，最多 `MAX_UPSTREAM_CONCURRENCY` 个请求打到教务系统
- CORS 由 CloudBase 网关按「Web 安全域名」白名单统一处理（应用层不写 CORS 头，
  否则会与网关头重复成双值，浏览器直接判定失败）；新域名去
  「环境 → 安全配置 → Web 安全域名」里加即可
- 不上传、不聚合任何课表数据；服务端只做"代登录 + 解析"，返回后即丢弃

## 上线自检

```bash
BASE=https://jou-d4gq7a3cqf51e6caa-1394316826.ap-shanghai.app.tcloudbase.com

curl -s $BASE/api/health                      # 看 mock / ocr.ready / version
curl -s -X POST $BASE/api/timetable/captcha   # 应返回 sid + data:image/png;base64,...
curl -s -X POST $BASE/api/timetable/auto \
  -H 'Content-Type: application/json' \
  -d '{"username":"0000000000","password":"x"}'   # 假凭据：1010=未装 OCR；1001/1005=已越过 OCR 打到教务
```

`captcha` 能返回真实 PNG，说明容器出网可达教务系统；
`/auto` 用假凭据返回 `1001/1005`（而不是 `1010`）说明 OCR 已生效、请求已打到教务侧。
随后在 H5 / App 课表页点「自动同步（免验证码）」或手输验证码做一次真实登录即可。

## 与 H5 站点对接

外部只读适配：`GET /api/integrations/capabilities`、`POST /api/learning/chaoxing/query`（默认关闭，
学习通需 `CHAOXING_READ_ENABLED=1` 且容器装有 pycryptodome 才启用）。体测已改为**设备侧同步**
（capabilities 返回 `physical.enabled=false`、`note="device-sync-only"`），服务端不再提供
`/api/physical/captcha`、`/api/physical/query`；个人成绩由用户在设备本机手动录入/粘贴留档。
这些适配未进行真实账号验收；网关需配置对应路由，不能仅上传 H5。
详见 `docs/architecture/EXTERNAL-SERVICE-INTEGRATIONS.md`（项目根目录）。
离线测试：在本目录运行 `python -m unittest -v test_read_integrations`；不访问真实账号。

- `xm-main/.env.production`：`VITE_TIMETABLE_API` = 上面的「后端基地址」（**不要再写 127.0.0.1**）
- `xm-main/.env.development`：默认同样指向线上地址（本地 `npm run dev` 无需先起 Flask）
- 需要调本地后端时临时覆盖：`VITE_TIMETABLE_API=http://127.0.0.1:8090 npm run dev`
- 浏览器直连线上后端时，来源必须是网关安全域名白名单成员；本机 dev 端口（43123）已在列，
  若换端口记得同步加到「环境 → 安全域名」


### 2026-11-04 演示页面隔离

生产默认不提供本地查询演示页与通配静态文件。只有人工联调时设置 `ENABLE_QUERY_DEMO=1` 才启用；真实教务、学习通 API 与健康检查不受影响。旧 `/api/schedule` 兼容入口已移除，当前前端只调用 `/api/timetable/captcha`、`/api/timetable/query`、`/api/timetable/auto`；体测为设备侧同步，无服务端查询路由。（注：此前文档曾告诫无旧客户端调用证据时不删 `/api/schedule`，移除与旧 APK 的兼容性需单独核验。）
