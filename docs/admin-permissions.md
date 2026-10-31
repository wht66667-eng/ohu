# 管理权限说明

> 阳光校园 · 权限矩阵（与代码 / SQL 同步，2026-09-26）

## 角色层级

| 角色 | 判定 | 说明 |
| --- | --- | --- |
| 普通用户 | 已登录且非管理员 | 发帖、下单、课表同步等 |
| 普通管理员 | `profiles.is_admin = true` | 内容与业务审核 |
| 站长（最高管理员） | `profiles.is_super_admin = true` | 含普通管理员全部能力 + 成员治理 / 合伙人终审 |
| Bootstrap 站长 | 档案用户名 **`2023120448`**；工作端手机 **`15329826989`** | 首次登录自动写入 `admin_accounts.role=super_admin` |

服务端以 `is_admin_user()` / `is_super_admin_user()` 为准；前端开关只做入口隐藏，**不能当作安全边界**。

## 能力矩阵

| 能力 | 普通用户 | 管理员 | 站长 |
| --- | :---: | :---: | :---: |
| 角色审核台（档口/骑手/小店） | | ✅ | ✅ |
| 内容管理（下架/删评/删违规） | | ✅ | ✅ |
| 财务与费率 / 提现审核 | | ✅ | ✅ |
| 查看合伙人申请列表 | | ✅ | ✅ |
| **通过/驳回合伙人** | | | ✅ |
| **成员治理：添加管理员** | | | ✅ |
| **成员治理：移除管理员** | | | ✅ |
| 封禁 / 解封用户（RPC 已备） | | | ✅ |
| 移除站长自己 | | | ❌（禁止） |

入口：

- 设置 → **管理员** 分区（`isAdmin`）
- 设置 → **成员治理**（`isSuperAdmin`，路由 `/admin/members`）

## 数据表与 RPC

| 对象 | 用途 |
| --- | --- |
| `admin_accounts` | 管理员名册（`role`: `admin` / `super_admin`，`perms` 预留细粒度） |
| `profiles.is_admin` / `is_super_admin` | 前端与 RLS 快捷开关 |
| `admin_add_member` | 站长添加普通管理员（同步两表） |
| `admin_remove_member` | 站长移除普通管理员 |
| `admin_search_users` | 按手机号/学号/昵称搜索 |
| `admin_ban_user` / `admin_unban_user` | 封禁（连带下架内容）/ 解封 |

当前前端**未按 `perms` 细粒度控权**，只用布尔 `isAdmin` / `isSuperAdmin`。若以后要「只审内容、不管财务」，再启用 `perms`。

## 虚拟账号自测建议

1. **站长**：用学号 `2023120448` 登录 → 设置应出现「成员治理」。
2. **普通管理员**：站长在成员治理搜索另一已注册账号 →「设为管理员」→ 该号登录后可见管理员分区，但无成员治理增删。
3. **考证一键提醒**：学业中心 → 考证 → 选日期 →「一键提醒」；或点「虚拟试响」验证震动+语音+弹窗（不写真实教务）。
4. **安全**：非站长直接调 `admin_add_member` 应被服务端拒绝。

## 相关文件

- `src/lib/admin.ts` — 客户端封装
- `src/pages/AdminMembersPage.tsx` — 成员治理 UI
- `docs/release/super-admin-2023120448.sql` — Bootstrap SQL
- `tools/deploy-super-admin.mjs` — 部署脚本
