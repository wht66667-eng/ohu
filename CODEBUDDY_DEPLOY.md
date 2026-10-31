# CodeBuddy · 腾讯云 CloudBase 部署手册

> 给 **CodeBuddy** 直接执行用。本仓库前端是 Vite SPA，线上走 **CloudBase 静态托管**；课表后端是云托管 `jou-api`（本轮前端功能变更默认 **只发静态托管**）。

---

## 0. 先确认：改动已落在本地

项目根目录：`C:\Users\upwar\Desktop\xm-main`（当前 **不是 git 仓库**，以磁盘文件为准）。

本轮功能相关文件（均已写入本地，LastWriteTime ≥ 2026-09-14 21:30）：

| 模块 | 路径 |
| --- | --- |
| 宠物页 v2 + PetStage / 背包 | `src/pages/PetPage.tsx`、`src/pages/me.module.css` |
| 盲盒 / 道具浮层 / 舞台 | `src/components/pet/GachaBox.tsx`（既有）、`ItemUseSheet.tsx`、`PetStage.tsx`、`PixelCat.tsx`、`pet.module.css` |
| 首页搜索 / 公告 / snooze / 进度环 | `src/pages/HomePage.tsx` |
| 服务 / 集市 / 信息站 query | `src/pages/ServicesPage.tsx`、`MarketPage.tsx`、`InfoPage.tsx`、`campus.module.css` |
| 搜索组件 | `src/components/PageHeader.tsx` |
| 待办手势 / 去重 | `src/pages/TodoPage.tsx`、`todo.module.css` |
| 聊两句任务 | `src/pages/ChatPage.tsx` |

完整清单也可对照：`docs/release/LOCAL_CHANGES_2026-09-14.md`。

**部署前自检（CodeBuddy 必须先跑）：**

```bash
cd C:\Users\upwar\Desktop\xm-main
npx tsc --noEmit
```

退出码应为 `0`。

---

## 1. 环境常量（勿改错）

| 项 | 值 |
| --- | --- |
| envId | `jou-d4gq7a3cqf51e6caa`（见 `src/lib/cb.ts` → `CB_ENV_ID`） |
| 区域 | `ap-shanghai` |
| 静态托管域 | `https://jou-d4gq7a3cqf51e6caa-1394316826.tcloudbaseapp.com/` |
| API 网关域 | `https://jou-d4gq7a3cqf51e6caa-1394316826.ap-shanghai.app.tcloudbase.com` |
| 前端构建产物 | `dist/`（域根绝对路径 `/assets/...`） |
| 生产环境变量 | `.env.production`（`VITE_TIMETABLE_API` 已指向网关域） |

上传脚本会从 `src/lib/cb.ts` **自动读 envId**，不要手写另一个环境。

---

## 2. 本轮推荐动作：只发前端静态托管

本轮改动全在 H5 前端，**不需要**重发 `jou-api` 云托管。

### 2.1 登录（二选一）

**交互登录（本机有浏览器）：**

```bash
npx --yes @cloudbase/cli login
```

**CI / 无头（推荐 CodeBuddy 自动化）：**

```bash
# 由用户或密钥管理注入，不要把 key 写进仓库
set CLOUDBASE_API_KEY=<你的_CloudBase_API_Key>
```

### 2.2 构建

优先用项目约定的 H5 构建（清理产物更稳）：

```bash
cd C:\Users\upwar\Desktop\xm-main
npm install
npm run build:h5
```

若 `build:h5` 不可用，回落：

```bash
npm run build
```

确认存在：`dist/index.html`、`dist/assets/`（非空），且 `index.html` 里资源是 `"/assets/..."` 绝对路径。

### 2.3 上传托管

```bash
npm run deploy:hosting
```

等价于 `node tools/deploy-hosting.mjs`（内部调用 `tcb hosting deploy ./dist --env-id <CB_ENV_ID> --yes`）。

成功日志应出现站点 URL，例如：

`https://jou-d4gq7a3cqf51e6caa-1394316826.tcloudbaseapp.com`

### 2.4 发布后冒烟（必做）

在浏览器或用 curl 检查（均应 200，且子路由返回 SPA `index.html`）：

- `/`
- `/pet`（盲盒 / 邀请 / 碎片 / 背包浮层）
- `/todo`
- `/services?q=二手`
- `/info?id=<任意已有公告 id>`
- `/chat`

环境级配置若从未配过，再核对一次（一般不用每次改）：

1. 静态托管 **ErrorDocument / 404 → index.html**（SPA 回退）
2. 「环境 - 安全配置 - Web 安全域名」白名单包含托管域

---

## 3. 可选：课表后端 jou-api（本轮跳过）

仅当改了 `tools/jou-api/` 时才部署：

- 服务名：`jou-api`
- 源码：`tools/jou-api/`
- 细节：`tools/jou-api/README.md`
- CloudBase MCP / CLI：`manageCloudRun(deploy, serverName=jou-api, targetPath=tools/jou-api)` 或等价 CLI

前端无需因本轮功能重发后端。

---

## 4. CodeBuddy 执行清单（复制即用）

```text
目标：把 xm-main 当前本地前端发布到腾讯云 CloudBase 静态托管。
路径：C:\Users\upwar\Desktop\xm-main
步骤：
1) cd 到项目根；运行 npx tsc --noEmit，失败则停止并修复。
2) npm install（如依赖已齐可跳过）。
3) npm run build:h5（失败则 npm run build）。
4) 确认 dist/index.html 与 dist/assets 存在。
5) 若无 tcb 登录态：使用环境变量 CLOUDBASE_API_KEY，或执行 tcb login。
6) npm run deploy:hosting。
7) 打开托管域 /pet、/、/services?q=测试 做冒烟。
禁止：
- 不要改 src/lib/cb.ts 的 CB_ENV_ID
- 不要把密钥写入仓库文件
- 本轮不要部署 jou-api，除非用户明确要求
```

---

## 5. 密钥注入（不要写进仓库）

| 方式 | 做法 |
| --- | --- |
| 本机交互 | `npx --yes @cloudbase/cli login` |
| CI / CodeBuddy | 环境变量 `CLOUDBASE_API_KEY`（控制台「API 密钥」创建） |
| Windows PowerShell | `$env:CLOUDBASE_API_KEY="xxxx"` 后再跑 `npm run deploy:hosting` |

**禁止**把 API Key 写进 `.env`、`CODEBUDDY_DEPLOY.md`、git 提交或聊天记录落盘文件。

---

## 6. 失败回滚

静态托管是整包覆盖 `dist/`，没有「一键上一版本」按钮时：

1. 用 git 检出上一提交：`git checkout <prev> -- .`（或 `git switch -c hotfix <prev>`）
2. 重新 `npm run build:h5 && npm run deploy:hosting`
3. 若无 git：保留本地旧 `dist/` 备份目录，直接  
   `npx --yes @cloudbase/cli hosting deploy ./dist.bak --env-id jou-d4gq7a3cqf51e6caa --yes`

建议每次部署前：

```bash
# PowerShell
if (Test-Path dist) { Copy-Item -Recurse -Force dist "dist.bak-$(Get-Date -Format yyyyMMdd-HHmm)" }
```

---

## 7. 部署后冒烟

```bash
node tools/smoke-hosting.mjs
# 或自定义域名：
# SMOKE_BASE=https://jou-d4gq7a3cqf51e6caa-1394316826.tcloudbaseapp.com node tools/smoke-hosting.mjs
```

应全部 `OK`。也可手工打开：`/pet`、`/`、`/services?q=二手`、`/todo`。

---

## 8. 数据库（角色库 + 偏好）

```bash
npm run deploy:db
```

会执行：

- `docs/release/client_prefs.sql`（形象/待办偏好跨设备）
- `docs/release/character_assets.sql`（24 条角色种子 + 公开读）

校验：`character_assets` 应有 24 行。

---

## 9. 相关脚本与文档

| 文件 | 作用 |
| --- | --- |
| `tools/deploy-hosting.mjs` | 校验 `dist/` 并上传静态托管 |
| `tools/smoke-hosting.mjs` | 部署后冒烟 |
| `tools/build-multiplatform.mjs` | `build:h5` 产出 |
| `docs/release/client_prefs.sql` | 待办排序云端表 |
| `README.md` / `SETUP.md` | 环境与部署总览 |

---

## 10. 给用户的一句话验收

打开：  
https://jou-d4gq7a3cqf51e6caa-1394316826.tcloudbaseapp.com/pet  

应能看到盲盒次数、邀请码、碎片兑换；首页搜索可跳转；公告可带 id 打开。
