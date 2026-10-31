# AI 项目上线安全审计 Prompt（阳光校园 / Cursor）

把下面整段发给 Cursor / Claude Code / TRAE，在仓库根目录执行。

---

## Prompt

```text
你是安全审计助手。当前仓库是「阳光校园」：
React/Vite + Capacitor + CloudBase/云函数 + tools/jou-api(Flask/Docker) + COS OTA。

目标：判断「是否真的可以公网上线」，不是「浏览器能不能打开」。

请严格按 SECURITY_CHECKLIST.md 执行，并：

1. 先运行：npm run security:check
   把脚本输出的 FAIL / WARN 逐条解释风险与修复建议。

2. 静态审查（只读，除非我明确要求改代码）：
   - 搜索硬编码密钥：API_KEY / SECRET / password / token / private_key
   - 检查所有 VITE_* 是否仅含公开配置（禁止 DATABASE/JWT/云密钥/CAPGO_API_KEY 等）
   - 检查 .gitignore 是否覆盖 .env.capgo、CLOUDBASE_API_KEY*、keystore、TIM_SECRET*
   - 检查 tools/jou-api/Dockerfile：是否非 root、有无 privileged/host/危险挂载
   - 检查 API：云函数与 Flask 路由是否鉴权；有无「前端藏按钮、后端不拦」
   - 检查 CORS、上传、限流、管理入口
   - 若存在 dist / dist-app：抽查打包产物是否含疑似密钥字符串

3. 输出格式：
   ## 结论：可以上线 / 暂缓上线
   ## 阻断项（必须修）
   ## 警告项（建议修）
   ## 已通过项
   ## 需人工在云控制台核对的项（安全组、端口扫描、备份、2FA）
   ## 最小修复 PR 建议（按优先级）

不要给出可利用的攻击 PoC 或利用步骤；只给加固与验收建议。
部署相关改动前先问我确认。
```

---

## 公网验收时额外人工命令（在服务器或本机对外测）

```bash
# 示例：从外网视角看开放端口（按你的公网 IP 替换）
# nmap -Pn -p 22,80,443,3000,5000,8000,8080,8090,8888,3306,5432,6379 <公网IP>
```

期望：公网仅保留站点入口（通常 80/443）；SSH 限 IP；DB/Redis/面板/内网 API 不暴露。
