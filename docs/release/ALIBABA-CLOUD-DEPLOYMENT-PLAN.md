# 哦狐阿里云部署与后端迁移路线

更新时间：2026-10-31

## 本次边界

当前阶段只将静态官网部署到阿里云 ECS，并绑定 `jouxyfwglzx.cn`。学生端与管理端依赖的账号、业务数据和服务保持在现有环境，避免把“官网迁移”误当成整套产品迁移。

| 部分 | 当前安排 | 后续迁移门槛 |
|---|---|---|
| 官网静态文件 | Windows Server 2022 上由现有 Caddy 服务托管项目 `dist/`；OHU 域名使用独立站点块 | 域名需完成阿里云 ICP 备案／接入；备案通过后核验公网 HTTP／HTTPS |
| CloudBase Auth | 暂留 CloudBase | 设计账号迁移、密码／第三方身份衔接、会话兼容和回滚演练 |
| CloudBase PostgreSQL | 暂留 CloudBase | 只读核验 schema、RLS、RPC、迁移历史；完成脱敏备份、兼容迁移和恢复演练 |
| pgstore / 用户图片 | 暂留 CloudBase | 完成资源清单、权限／URL策略、校验和、增量同步及旧链接兼容 |
| CloudBase 云函数与网关 | 暂留原环境 | 按实际调用量和身份边界逐个盘点；配置服务端密钥、限流、审计、健康检查与回滚 |
| `jou-api` 教务服务 | 暂留现有服务 | 先验证学校许可、登录会话安全、验证码粘性、限流和公网流量；单独压测并安排迁移窗口 |
| AI 代理与模型密钥 | 暂留服务端，不迁移密钥 | 先撤销历史上公开过的密钥并轮换；验证密钥管理、用户授权、预算和限流后才部署 |
| APK / IPA / OTA 下载包 | 保留当前正式资源托管地址 | 需要稳定 HTTPS、版本清单校验、签名／哈希验证、断点下载与回滚；不得与官网迁移捆绑盲改 |

## 官网发布流程

1. 核对 ECS 公网 IP、操作系统、资源额度和地域限制。
2. 确认 `jouxyfwglzx.cn` 的管理权；根域与 `www` 的 A 记录指向 ECS，并核对 DNS 解析。
3. 核对 TCP 80／443。Windows ECS 若已有网站服务，先检查现有路由并备份，避免替换无关服务。
4. 本地 `npm run build:web`，检查 `dist/index.html` 与 `/download/` 页面。
5. 上传 `dist/` 到独立版本目录，校验归档哈希后解压；用 Caddy 托管官网。
6. 从公网核验首页、下载说明、PWA 安装说明、静态资源和下载链接；记录版本与校验值。
7. 保留 CloudBase 官网和服务器配置备份作为回滚来源。不要因新官网可打开就更改 App API、下载桶或热更新地址。

## 域名与 HTTPS 检查

- `jouxyfwglzx.cn` 必须由用户持有并能修改 DNS；本项目不会购买域名。
- 必须确认 A 记录实际指向 ECS 公网地址，不能只凭域名控制台保存成功判断生效。
- 中国大陆 ECS 网站正式提供服务前，核查ICP备案及接入要求。若不具备条件，先选合规地域／临时测试地址，不宣称域名正式上线。
- Caddy 证书依赖域名解析正确且公网 80/443 可达；证书签发前 HTTPS 不视为完成。
- ECS 免费试用按额度和期限管理，不代表永久免费；不新增未经同意的收费服务。

## 后端迁移的安全顺序

1. 只读盘点当前线上 API、数据库结构、认证、存储、函数与网关，确认生产版本和调用关系。
2. 选择单个低风险服务做隔离环境试迁；先做数据备份与恢复演练。
3. 为目标阿里云服务确定身份校验、最小权限、密钥轮换、日志脱敏、限流和告警。
4. 做兼容双读或影子验证，比较关键响应，不写双份用户数据，除非有明确一致性设计。
5. 小范围切流并监控；出现错误立即恢复原 CloudBase 路由。
6. 验收数据完整性、账号归属、隐私、费用和恢复能力后，再安排下一服务。

任何数据库生产写入、DNS切换、App API 指向变更、存储迁移和用户账号迁移都应作为独立步骤，先核实可回滚方案；不能由一次静态网站上线推导出这些步骤已完成。

## 2026-10-31 Windows ECS 实施记录

- 已从 ECS 元数据确认公网 IP 为 `112.124.48.246`；Windows Server 2022 的 Ed25519 主机指纹 `SHA256:L7hpSd086nB8VUXI1cUU53wg5GticBABECBYqqw2jmo` 与用户提供的 Workbench 输出一致。
- 服务器原有 `MuMuLicenseProxy` Windows 服务和 Caddy IP 反向代理保持运行。OHU 静态站点以附加域名块部署到 `C:\OHUWebsite\releases\ohu-website-1.2.146-20261031\dist`；原 Caddyfile 备份于 `C:\OHUWebsite\backups\Caddyfile.pre-ohu-20261031.bak`。Caddy 版本 2.11.7，候选配置先通过 `caddy validate`，随后热重载；未重启或覆盖 MuMuLicense 服务。
- 当前归档：`artifacts/ohu-website-1.2.146-20261031.tar.gz`，SHA-256 `A47962F2BB4C7A04209C711A65C9A5BCE728E46DD29EEBC3AA631F2D4FDCE0E5`。远端校验一致。官网 `canonical` 与分享图 URL 已更新为 `https://jouxyfwglzx.cn/download/`。
- 服务器本机通过 Caddy 访问 `https://www.jouxyfwglzx.cn/download/` 返回 200，网站文件已就位；`www` 证书签发成功。公网访问 `http://jouxyfwglzx.cn/` 返回阿里云 `Non-compliance ICP Filing` 页面；根域 ACME HTTP 挑战收到 403，公网 HTTPS 尚不能验收。
- 下一步：在阿里云 ICP 备案系统为该网站办理备案；若域名已有其他接入商备案，则按系统要求为阿里云增加接入。审核通过后复核根域和 `www` 的 HTTP／HTTPS、Caddy 自动证书与下载文件；在公网验收前不宣称域名已正式上线。

## 2026-11-01 官网 V4 更新

- 根据用户授权，仅将本轮构建的 `dist/download/` 官网资源覆盖到从上一版复制的新版本目录 `C:\OHUWebsite\releases\ohu-website-v4-20261101\dist`；其余既有站点文件沿用旧版本。原版本目录保留。
- 本地上传包 `artifacts/ohu-web-v4-20261101.tar.gz` 的 SHA-256 为 `5CAEEDA2D1A45D57E44CAEA23941EFAB05B853DEBE3FD0B59A05F16A7B687040`；远端校验一致后解压。Caddy 原配置备份为 `C:\OHUWebsite\backups\Caddyfile.pre-v4-20261101.bak`；新配置通过 `caddy validate` 后热重载。原 MuMuLicenseProxy 服务仍运行。
- 服务器本机访问 `https://www.jouxyfwglzx.cn/download/` 返回 200，HTML 含碰个空演示；CSS、JS、透明度页、迭代页和苍梧地图数据均返回 200。
- 公网 `http://jouxyfwglzx.cn/download/` 返回阿里云 `Non-compliance ICP Filing` 403；公网 `https://www.jouxyfwglzx.cn/download/` 连接重置。新版已在服务器上，但域名公网可用性尚未完成。需完成阿里云备案或接入审核后再核验。
- 随后发布 V4b：为碰个空演示增加按需加载的真实学生端体验。归档 `artifacts/ohu-web-v4b-20261101.tar.gz` SHA-256 `5EC0EF6752EB89B37CF8615AC4407901314A6D7C482FB3077B80391A0CC84D54`；校验后切换至 `C:\OHUWebsite\releases\ohu-website-v4b-20261101\dist`，切换前配置备份为 `C:\OHUWebsite\backups\Caddyfile.pre-v4b-20261101.bak`。服务器本机官网、更新后的 CSS／JS 和 `/meet?view=student` 均返回 200，首页包含真实体验入口；该结果不能证明公网或登录功能已通过。复查时根域 HTTP 返回 308，www HTTP 仍返回 403，根域与 www 的 HTTPS 均连接重置，公网状态仍不稳定。
- V4c 补充项目故事及官网无障碍改进：归档 `artifacts/ohu-web-v4c-20261101.tar.gz` SHA-256 `A28427C4F05C8F2A7F161CF1F37D6618B8CA453A19C075BA83497DE107E8FDD2`；验证后切换至 `C:\OHUWebsite\releases\ohu-website-v4c-20261101\dist`，配置备份为 `C:\OHUWebsite\backups\Caddyfile.pre-v4c-20261101.bak`。服务器本机首页、关于页、CSS、JS 和学生端路由均返回 200；公网 www HTTP 返回 403，HTTPS 连接重置。
