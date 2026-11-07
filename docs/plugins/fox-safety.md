# fox 安全知识 · 哦狐插件 1.0.0

这是从用户提供的 `新建文件夹 (8)` 中迁移的离线学习工具，已加入哦狐学生端源码的静态插件注册表。不是把 APK 放入 APK 执行，也不运行原项目的 Python、EXE、JavaScript 页面适配脚本。

## 使用

1. 在“服务 → 哦狐插件”找到 **fox 安全知识**，创作者 **wft**，标为非官方学习工具。
2. 点击启用，再点“打开离线题库”，进入 `/plugins/fox-safety`。
3. 输入题目或选项关键词，按来源筛选，展开记录查看选项和参考答案；每页 20 条。
4. 需要另一套用户资料时，在“导入自己的 JSON 题库”选择交付目录中的 `fox-safety-extra-bank.json`。最多 1 MB、2000 条；导入替换本账号原来的导入库。
5. 导入保存在本机、按账号隔离。停用插件会关闭工具并清理当前输入，不会删除导入库；移除导入数据需要再次确认。星级沿用商城的本机个人评分。

APK 的内置题库读取随包资源，不需要服务器。网页版第一次打开需加载网页和题库资源；本轮没有宣称浏览器首次断网即可打开或已经完成真机离线测试。

## 数据来源与处理

| 来源 | 数量 | 接入方式 | 许可与说明 |
|---|---:|---|---|
| Scwizard/jiangsu-safety-competition 的 SQLite 数据 | 1000 条来源记录 | 随包 JSON，固定版本 `4b797158c1886d5c457eaf33a4afd1a4a0218fbd` | 上游 Apache-2.0，保留 Scwizard / 南晓署名与完整许可 |
| 用户 APK 内来自 `answer.js` 的数据 | 1000 条来源记录 | 转为交付目录中的可选本机 JSON，**不进入哦狐源码资源或插件 ZIP** | 原文件未附明确许可证；保持用户资料的本机导入用途，公开打包分发前需取得授权 |

两源可能存在重复题目，页面只统计来源记录。SQLite 中的答案原本是平台选项 ID；转换器依据该题选项 ID 映射至显示字母，不把 ID 当字母。当前 1000 条映射全部成功。导入库只有题目和答案文本，没有原选项时会明确提示，不能拿另一来源的选项顺序推断其答案。

- 上游仓库：<https://github.com/Scwizard/jiangsu-safety-competition/tree/4b797158c1886d5c457eaf33a4afd1a4a0218fbd>
- 随包许可证：`public/plugin-licenses/fox-safety-Apache-2.0.txt`。
- 用户提供 APK 的 SHA-256：`3e6460bfd63f2368bb9b6e0494d9208601e6afe17a882ea26e9eddd486eb11bc`。本轮只读其 ZIP 资源，没有安装、执行 APK 或重新声称已校验签名／模拟器。
- 可重建转换器：`python tools/import-fox-safety.py --source <用户原目录>`。只读 SQLite 与 APK 资源，不执行源项目脚本，不修改源题库。

## 接入文件

- 清单与注册：`src/plugins/plugin-manifest.ts`、`src/plugins/registry.ts`。
- 商城控件：`src/plugins/builtin/FoxSafety.tsx`。
- 检索、导入和存储：`src/plugins/fox-safety.ts`。
- 随包数据与延迟读取：`src/plugins/data/fox-safety-bank.json`、`src/plugins/fox-safety-bank-loader.ts`。
- 工具页：`src/pages/plugins/FoxSafetyPage.tsx`、`fox-safety.module.css`。
- 挂载路由：`src/App.tsx` 的 `/plugins/fox-safety`。

## 数据与权限

新增权限 `local-bank:read` / `local-bank:write` 只针对本插件的导入数据。存储键为 `ohu.plugin.fox-safety.bank.v1:<账号或guest>`；不读取哦狐个人题库，不上传导入资料，不索取学校账号。

JSON 文件先完成整批校验，再一次性写入；格式错误／超限不会替换旧库。只保留 title 与 answer 字段，不执行文件内容，不使用 HTML 注入。异步读取结束后再次检查账号会话与工具是否仍挂载，防止切换账号或停用后写入。跨标签页的本插件数据变化会刷新当前视图。

## 服务器与发布状态

原项目预填 `https://jouxyfwglzx.cn`，但用户提供的交接信息说明后端尚未部署成功。此插件无需该服务器，不增加学校平台调用、登录、自动填答、交卷、脚本注入或远程代码执行。没有把服务器状态改写为已上线，也没有要求提交 SSH 私钥或密码。

最初完成本地接入后，已按用户追加的“上更新”要求于2026-11-01发布学生端OTA **1.2.147／147**，最低原生build146。学生清单与旧发现入口、公网完整ZIP的大小和SHA-256已核验，详见 `docs/release/ota-1.2.147-verification.json`；尚未完成真机切包验收。未部署原项目服务器、推送仓库或打新APK；管理端保持1.2.146。插件源码ZIP用于审核与迁移，不是供现有APK动态安装的二进制插件。
