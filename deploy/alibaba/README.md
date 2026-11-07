# OHU 官网部署到阿里云 ECS

本配置只托管项目 `dist/` 中的静态网页。Caddy 负责 HTTPS 和静态文件；不在 ECS 部署教务 API、CloudBase 函数、数据库、用户图片或 AI 服务。上述业务继续使用现有 CloudBase／服务端环境。

## 前置条件

- 可访问的阿里云 ECS 公网 IPv4，系统为受支持的 Linux 发行版。
- 已安装 Docker Engine 与 Docker Compose 插件。
- 域名 `jouxyfwglzx.cn` 已完成注册／实名认证且 DNS 可管理。
- 域名 A 记录指向 ECS 公网 IPv4；安全组开放 TCP 80、443。
- 若 ECS 位于中国大陆，需先确认域名 ICP 备案及接入要求。没有完成备案前不要把大陆 ECS 作为正式网站入口。
- 先核实 ECS 试用额度、到期时间和出网额度；试用额度有限，超额可能产生费用。

## 构建

在项目根目录运行：

```powershell
npm run build:web
```

确认 `dist/index.html` 与 `dist/download/index.html` 存在。构建完成后，将 `dist/` 和 `deploy/alibaba/` 复制到 ECS 同一工作目录。

## 首次启动

在 ECS 的 `deploy/alibaba` 目录复制 `.env.example` 为 `.env`，确认 `OHU_DOMAIN=jouxyfwglzx.cn`，再运行：

```sh
docker compose --env-file .env up -d
docker compose --env-file .env ps
docker compose --env-file .env logs --tail=100 web
```

Caddy 会在 DNS、生效公网路由及 80/443 可达后申请并续期 HTTPS 证书。检查 `https://jouxyfwglzx.cn/` 和 `https://jouxyfwglzx.cn/download/`，并核对官网的应用下载地址仍指向其当前正式资源托管位置。

## 更新与回滚

更新时先在本地构建，再备份 ECS 当前 `dist/`，上传新 `dist/` 并检查页面、HTTPS 和下载链接。若出错，恢复备份的 `dist/`；不要删除 Caddy 数据卷，以免丢失证书状态。当前 CloudBase 官网和下载托管保持原样，可作为回退入口。

## 安全与费用边界

- 本部署不包含用户数据、私钥、CloudBase 凭据或 API 密钥。
- 不开放数据库或教务服务端口；仅需要 80/443。
- ECS 试用不是永久免费承诺。部署前确认计费项、带宽和流量；不新增付费资源。
- 其他后端迁移阶段见 `docs/release/ALIBABA-CLOUD-DEPLOYMENT-PLAN.md`。
