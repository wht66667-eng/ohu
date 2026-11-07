# 启动提示 · 在哦狐上实现 PU 口袋校园

> 状态（2026-11-06）：**已完成**。实现与验证见 `docs/PU学习通体测-完善说明-2026-11-06.md`；
> 取数走「页面文字 / 接口 JSON 粘贴」，本机按账号缓存，入口 `/study/pu`。
> 下文保留原始任务说明，供后续接 WebView 时对照接口契约。

把下面这段整段贴给新会话即可。

---

## 任务

在哦狐（React + Capacitor，当前工作区 `1.2.150`）里，新增 **PU 口袋校园（第二课堂学分）** 功能。

先读这两个文件建立上下文：

```
docs/掌上海大功能移植任务书.md      ← 第二节是 PU 的完整接口契约
src/lib/chaoxing.ts                 ← 照着它的结构写
src/components/ChaoxingSyncPanel.tsx ← 照着它的 UI 结构写
src/lib/physical-test-sync.ts        ← 另一个同类参考
```

## 要新建的文件

```
src/lib/pocketuni.ts                数据层：接口调用 + 解析
src/components/PocketUniSyncPanel.tsx UI 层：同步按钮 + 结果展示
```

如果需要 WebView 承载登录，再加：

```
src/pages/study/PocketUniBridgePage.tsx
```

## 接口契约（已抓包实测，直接用）

```
GET https://apis.pocketuni.net/apis/credit/index?puType=0&year=0
    → data.totalCredit / activityCredit / applyCredit / pai.rank

GET https://apis.pocketuni.net/apis/credit/activity?puType=0&year=0
    → data.credit + data.list[{ name, credit, ids }]

GET https://apis.pocketuni.net/apis/credit/apply?puType=0&year=0
    → data.credit + data.list[…]

GET https://apis.pocketuni.net/apis/credit/activityList
    → data.pageInfo{count,total,page,limit} + data.list[…]
```

鉴权：`Authorization: Bearer <token>`

## 三个必须知道的坑

**① token 不在 localStorage**

`localStorage.oauth_token` 的值和实际请求头里的 Bearer **不是同一个**，直接拿来用会返回：

```json
{"code":401,"msg":"Please Login","data":{}}
```

正确做法：注入 `fetch` / `XMLHttpRequest` 钩子，截获页面自己发出的 `Authorization` 头，再复用它。

**② 两个成绩页，只有一个能读**

```
class.pocketuni.net/r#/score/detail   ← 纯文字，能正则解析（推荐）
class.pocketuni.net/r#/score/myscore  ← canvas 渲染，读不到文字
```

成绩明细页的文字形态：

```
活动类 4.25 + 成果类 0.60 = 总成绩 4.85
【素质拓展B类】品牌校园文化教育(0.80)
【劳动教育】公益劳动(1.00)
```

**③ 别按 class 抓 DOM**

页面是 Vue + Element UI + Tailwind，class 全是工具类（`flex`、`text-[14px]`、`w-[340px]`），
版本一变就失效。**按页面文字写正则**。

## 实现建议

1. 先做最小可运行版本：WebView 打开 `https://class.pocketuni.net/r`，登录后跳到 `#/score/detail`，正则取总成绩与分类明细。
2. 再做接口版：截获 token 后直接调 4 个 credit 接口，拿到 36 条活动明细。
3. 两种都保留：接口失败时回退到页面文字（互为兜底）。

## 约束

```
- 不要把密码、token、cookie 写进仓库
- 改代码用文件级编辑，不要用 PowerShell 内联字符串替换
- 改完跑 npm run build 或 pnpm build 自测，不要只看代码
- 校园密码不要反复试，遇 INVALID_ACCOUNT 立即停
- 学校拒绝腾讯云出口 IP，取数只能在设备侧，云端只存结果
```

## 验收

```
1. 构建通过
2. 真机/模拟器上能显示：总成绩、活动类、成果类、分类明细
3. 关闭 App 再打开，数据还在（本地持久化）
```
