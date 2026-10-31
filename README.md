# 哦狐（OHU）

面向高校学生的校园应用，提供课表与学业查询、待办和提醒、专注学习、校园服务、校园广场及「碰个空」活动组队；项目同时包含独立管理端。

当前源码版本：**1.2.145**。本仓库保存客户端与服务端代码、构建脚本和产品文档。部分能力依赖 CloudBase、校园教务服务或外部网关，源码存在不代表对应生产服务已经部署。

## 技术栈

- React、TypeScript、Vite
- Capacitor 7（Android；iOS 项目由 GitHub macOS 构建任务生成）
- CloudBase Auth、PostgreSQL、云函数与对象存储
- Python Flask 教务代理（`tools/jou-api/`）

## 本地开发

需要 Node.js 24 和 npm。Android 原生构建还需要 Android Studio 与 Android SDK。

```sh
npm ci
npm run dev
```

常用构建命令：

```sh
npm run build       # Web 类型检查与构建
npm run build:h5    # Web 静态站点
npm run build:app   # 学生端 App 前端资源
npm run release:user
npm run release:admin
```

不要把本地 `.env`、CloudBase 凭据、签名密钥或用户数据提交到仓库。需要服务凭据的功能应在本地受忽略保护的环境文件或经审核的部署密钥中配置。

## iPhone 构建

仓库中的 **Build unsigned iOS IPA** GitHub Actions 工作流会在 GitHub macOS runner 上构建学生端，并上传经过版本、Bundle ID、构建号、文件完整性和未签名状态核验的 IPA artifact。该 IPA 未签名，不能直接安装；需使用用户自行选择的签名工具完成签名。发布到哦狐官网前，还要按当前版本生成并核验下载清单。

## 项目方案

持续实施记录与架构、功能计划见 [`docs/product/哦狐_实际项目设计与实施方案.md`](docs/product/哦狐_实际项目设计与实施方案.md)。
