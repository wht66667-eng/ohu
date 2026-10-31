# 文件自动出题（默认关闭）

这是独立的文件出题接口，使用本项目 CloudBase PostgreSQL 的 `app.rdb()`。免费学习、背词、公开题库、粘贴资料出题、词汇 JSON 导入和已有私人题库不通过这个接口计费。

数据库增量脚本位于 `docs/release/file-generation.sql`，已于 2026-10-03 执行并完成事务回滚验证。它只新增文件出题账户、任务、流水及服务端 RPC，不修改已有题库或商户钱包表。数据库准备完成不等于功能已开通。

价格、购买方式和原生支付尚未配置，默认 `enabled:false`、`priceCent:0`、`canPurchase:false`。0 表示价格未设置。接口不会模拟付款，不会从客户端的“支付成功”标志发放次数，也没有充值 HTTP 路由。

## 服务端配置

所有凭证只放云函数环境变量，禁止放入前端、版本库或发布记录。

| 环境变量 | 作用 |
| --- | --- |
| `FILE_EXAM_ENABLED` | 只有明确设置为 `true` 才允许新任务，默认关闭 |
| `FILE_EXAM_PRICE_CENT` | 服务端单次价格，整数分，必须大于 0 |
| `FILE_EXAM_QUESTIONS` | 每个任务完整题数，3 至 10，默认 5 |
| `CLOUDBASE_APIKEY` | 仅服务端使用，必须能以服务角色调用新 RPC |
| `TCB_ENV` / `ENV_ID` | 实际 CloudBase 环境；默认与本项目现有环境相同 |
| `LLM_BASE_URL` | HTTPS 模型接口基址，例如提供商的 `/v1` 基址 |
| `LLM_API_KEY` | 服务端模型凭证 |
| `LLM_MODEL` | 实际可用模型名称 |

价格、服务角色凭证或模型配置不完整时，公开配置仍显示关闭。模型请求直接由服务端调用提供商的 `/chat/completions`，不经过免费的 `/api/chat`。

函数依赖已锁定：`@cloudbase/node-sdk` 3.18.3、`mammoth` 1.8.0、`pdf-parse` 1.1.1。在函数目录安装依赖后，网关应将 `/api/exam-generator/*` 路由到此函数并保留完整路径。认证在函数内强制执行。

## 接口约定

- `GET /config`：公开返回启用状态、价格、完整题数、单次消耗、文件限制、实际安装格式和 `canPurchase:false`。
- `GET /status`：认证后读取当前账号剩余次数，并回收已过期任务。
- `POST /generate`：必须携带 CloudBase `Authorization: Bearer ...`。请求为 `{requestId,fileName,ext,base64,subject,type,dir}`；`requestId` 为 UUID，格式为 TXT、DOCX、PDF，题型为 mix/single/judge/trans，方向为 both/zh2en/en2zh。
- `GET /jobs/:requestId`：认证后恢复该账号同一次请求的状态或完整结果，无需再次上传文件。路径中的 UUID 是原始 `requestId`，不是服务端生成的 `jobId`。

成功生成返回 `{ok:true,jobId,status:'succeeded',questions}`。恢复接口另含 `requestId`、`fileName`、`subject`、`questionsPerJob`；任务进行中返回 `status:'running'`。每题使用 `qtype`，并含题干、选项、答案、解析、难度、标签和逐字匹配原文的 `sourceRef`。文件内容不保存到任务表。

失败统一为 `{ok:false,code,message}`。未登录 401，次数不足 402，任务不存在 404，进行中/输入冲突/任务已失败或过期 409，输入错误 400/413，服务或生成失败 503。网络或数据库确认不确定时保留同一个请求编号；已退回次数的明确失败可重新选择文件产生新编号。

同一账号同一请求编号只能预留一次次数。完全相同的成功重试直接读取原结果；不同输入不能复用编号。任务预留保留五分钟，完整成功才消耗一次，失败或超时原子退回一次，迟到的模型结果不能再次扣减。

文件限制为 2MB、最多 12000 个提取字符，不静默截断。DOCX 验证完整 ZIP 目录及实际解压大小。DOCX/PDF 在独立工作线程提取，最多 10 秒，堆内存受限；PDF 最多 50 页，逐页提取失败或超限即整体拒绝。模型调用最多 35 秒。题数不完整、题型/答案/选项不合法、重复题或引用未匹配原文均不作为成功结果。

## 次数发放与付款边界

新账户初始为 0 次，浏览器没有账户、流水、任务写权限，也不能执行次数 RPC。`file_generation_grant` 只授予服务角色；未来的可信支付回调必须先验证支付方签名和真实到账状态，再传入该笔唯一支付参考号、支付方实际到账金额、服务器保存的价格快照和次数。函数要求到账金额严格等于价格乘次数，并拒绝同一支付参考号的重复或跨账号发放。

当前未接入该支付回调，也未提供真实购买流程。现有商户订单 MOCK 支付和商户/骑手钱包不能为文件出题发放次数。开放购买前还需确定价格、接入真实支付、验证服务角色凭证及退款流程，并由项目维护者明确启用。

## 本地验证

在项目根目录运行 `node scripts/import-exam-data/test-file-generation-api.mjs`。测试使用原始合成文档和临时 RSA 密钥，不读取用户文件、生产凭证，不发送模型请求，不产生真实扣款。覆盖 16 项认证、预留/失败/超时、并发重试、跨账号隔离、结果恢复、题目校验及真实 TXT/DOCX/PDF 解析验证。数据库事务行为另由项目维护者在实际 PostgreSQL 中执行并回滚验证。
