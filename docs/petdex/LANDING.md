# Campus Petdex / 阳光校园 App · 全量落地清单

> 目标：学生端 App 可运营上线；H5 同源；微信小程序另立项。  
> 仓库：https://github.com/xiao-jj-78/sunshine-campus

---

## 0. 现状一句话

| 层 | 状态 |
| --- | --- |
| 五端 APK 1.2.19 | ✅ CDN 齐套 |
| OTA 热更 | ✅ 1.2.23+ |
| 精灵冒险包（连云港刷怪/售卖） | ✅ CDN 独立，**手动下载** |
| 养成 RPC | ✅ `pet_*` 权威 |
| 图鉴解锁 / 编队 / 单词 SRS | ⚠️ 仍偏本地 |
| `pet_reward` 白名单 | ⚠️ 客户端已报，**服务端需开** |
| 好友实时对战 | ❌ → 先做邀请码异步挑战 |
| 微信小程序 | ❌ 另开工程 |

---

## 1. 服务端（你方运维 / 给我云函数权限）

### 1.1 `pet_reward` 白名单（必须）

在云函数 / RPC 白名单中加入（与 `src/data/pet.ts` 对齐）：

```
secondhand_publish, task_publish, feedback_post,
help_publish, help_done, teamup_publish, teamup_join,
canteen_review, campus_checkin, focus_complete, wild_win
```

建议日 cap：`wild_win` 经验 ≤ 40 / 日；其余保持现有 UGC cap（exp 60 / coins 40）。

### 1.2 建议新表（进度上云，P1）

```sql
-- 示意：图鉴解锁与编队
user pet_dex_progress (
  uid text primary key,
  unlocked jsonb default '[]',
  wins jsonb default '{}',
  fragments jsonb default '{}',
  party jsonb default '["official-campus-fox",null,null]',
  updated_at timestamptz default now()
);
```

配套 RPC：`pet_dex_get` / `pet_dex_save`（只允许本人 uid）。

### 1.3 单词云同步（P1）

```sql
create table pet_word_progress (
  uid text primary key,
  srs jsonb default '{}',
  plans jsonb default '[]',
  endless_best jsonb default '{}',
  updated_at timestamptz default now()
);
```

---

## 2. App 客户端落地步骤（本仓可做）

| 步骤 | 内容 | 状态 |
| --- | --- | --- |
| A1 | 五端壳 + FocusLock + OTA | ✅ |
| A2 | 校园遭遇真对决 + 编队 + 群袭 | ✅ |
| A3 | 单词朗读/计划/无尽 + 阿狐 API | ✅ |
| A4 | UGC → `pingPet`（集市/任务/反馈/食堂） | ✅ |
| A5 | 互助/组队 → `pingPet` | ✅ |
| A6 | 探索页展示今日行为/碎片真实进度 | ✅ |
| A7 | 本地进度导出导入（换机过渡） | ✅ |
| A8 | 邀请码异步挑战（好友战过渡） | ✅ |
| A11 | 反馈/食堂评价/互助组队 **发布 UI** | ✅ |
| A12 | 冒险包：连云港 POI 刷怪 + 多余精灵售卖（与 APK 分离） | ✅ |
| A13 | 港城游戏馆：连云港主题小游戏（与 APK 分离） | ✅ |
| A9 | 对接 `pet_dex_*` RPC（等服务端） | ⏳ |
| A10 | 微信小程序工程 | ⏳ 另仓 |

---

## 3. 验收清单（学生端真机）

1. 登录 → 领养小海阿狐  
2. 专注 25min 完整结束有奖励；中途退出扣经验  
3. 勿扰/屏幕固定设置页能跳转系统页（1.2.19 壳）  
4. 校园定位在海大围栏内打卡；场景刷怪 → 对决掉血/技能  
5. 单词朗读有声音；阿狐助记有文案  
6. 发二手/任务/反馈/食堂评价后宠物有成长流水（需白名单）  
7. 信息站 FAB 可发求助/组队；本人互助可「已解决」  
8. 食堂「我的订单」可对已完成单评价  
9. 设置/探索可导出进度备份  

---

## 4. 你需要接入给我的权限

1. **CloudBase 云函数 / 数据库**（改白名单 + 新表）— 最关键  
2. 已有 **tcb CLI 登录态**（本机若已登录可继续用）  
3. （可选）腾讯云 IM 控制台 — 真好友战  
4. （可选）微信小程序 AppID — 另立项  

---

## 5. 建议排期

| 周 | 目标 |
| --- | --- |
| W1 | 白名单 + 真机验收 A1–A8 |
| W2 | 图鉴/编队上云 + 单词云同步 |
| W3 | IM 好友战 + 对战赛季榜 |
| W4 | 小程序立项（若需要） |
