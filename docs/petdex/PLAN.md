# Campus Petdex｜校园宠物养成系统 — 项目计划

> 状态：P0 预览壳已进学生端（`/pet`）  
> 旧版养成页保留：`/pet/legacy`  
> 官方 IP：Official Campus Fox（小海阿狐）  
> 原则：服务端 RPC 权威；前端只展示与触发；不整站复制 Petdex

---

## 1. 产品定位

**校园生活游戏化宠物系统**：图鉴 + 领养 + 养成 + 校园场景 + 探索 + 成长 + 对战。  
不是纯桌宠，不是孤立电子宠物。

默认宠 / 吉祥物 / 新手助手：**官方橙色小狐狸**。

---

## 2. 数据边界（强制）

| 模型 | 含义 | 存放 |
| --- | --- | --- |
| `PetDefinition` | 物种静态定义 | `src/data/petdex/species.ts` |
| `CampusPetConfig` | 校园运营/场景/掉落系数 | `src/data/petdex/campus-config.ts` |
| `UserPet` | 用户拥有的实例 | 现 `pet_profiles` → 未来 `user_pets` |
| `PetEvent` | 行为日志 | 现 `pet_actions` |
| `PetItem` / `PetAchievement` | 道具与成就 | 现有表 + `data/pet.ts` |

禁止：UI 直接改等级经验；业务逻辑堆在页面组件。

---

## 3. 信息架构（学生端）

```
/pet                 首页（出战宠 + 今日任务 + 入口）
/pet/mine            我的宠物
/pet/dex             图鉴（全部 / 收藏 / 稀有度 / 搜索）
/pet/dex/:id         详情（属性 / 技能 / 成长 / 性格）
/pet/care            养成（喂食 / 互动 / 学习 / 运动 / 休息）
/pet/campus          校园场景（馆 / 食堂 / 操场 / 宿舍 / 湖 / 楼）
/pet/explore         探索（发现 / 道具 / 事件 / 成就）
/pet/battle          对战（出战 / 好友 / 排名）预览
/pet/focus           番茄专注（经验管道预览）
/pet/legacy          旧版完整养成页（过渡）
/pet/charity         喵粮公益（保留）
```

仅 **user** 壳开放（`shell-guard` 已含 `/pet`）。

---

## 4. 与全站融合（防冲突）

### 4.1 事件总线

所有业务成功 → `PetBridge.emit({ source, action, dedupeKey })` → RPC。  
页面禁止直接 `UPDATE` 宠物数值。

### 4.2 已有 / 待接线

| 来源 | 状态 | 动作 |
| --- | --- | --- |
| AI 聊天 `talk` | 已接 | 保留日 1 次 |
| 二手/任务/互助/食堂 | 白名单有、**页面未调** | P0.1 接线 `pingPet` |
| 待办完成 | 只给 DeskCat 能量 | 并轨，禁双计 |
| 登录连击 engagement | 改图标 | 与宠物签到同 day |
| 课表/学习/番茄/步数 | 未接 | P1 新 RPC 池 |
| 钱包/工作端 | 不绑战力 | 硬规则 |

### 4.3 经验分池

- A 互动养成（原有）  
- B 校园 UGC `pet_reward`  
- C 步数/番茄 → **经验果**（道具）  
- D 对战赛季  

---

## 5. 分期交付

| 阶段 | 目标 | 验收 |
| --- | --- | --- |
| **P0** | 计划文档 + 学生端新壳预览 + 官方狐狸定义 + Bridge 骨架 | `/pet` 可逛通；旧页可回 |
| **P0.1** | UGC `pingPet` 接线；Todo/DeskCat 并轨 | 发二手等有宠物流水 |
| **P1** | `user_pets` 草案；图鉴解锁状态服务端化 | 多宠只读 |
| **P2** | 步数 + 番茄 → 经验果 RPC | 日 cap 生效 |
| **P3** | 进化链 + 狐狸三形态 | 消耗果子可进化 |
| **P4** | 校园六场景事件 | 场景掉落 |
| **P5** | 出战 / 好友战 / 双榜 | 异步结算 |
| **P6** | 性格状态机 / 赛季 | 自动行为差异 |
| **P7** | 桌宠表现统一出战宠 | DeskCat = 皮肤层 |

---

## 6. 工程目录

```
docs/petdex/PLAN.md
src/data/petdex/          # Definition / Config（无副作用）
src/services/petdex/      # Bridge / Adapter / Care / Xp（预留）
src/pages/petdex/         # 学生端 UI
src/pages/PetPage.tsx     # legacy
```

开源借鉴（仅思路）：petdex 包结构、virtual-pet 养成、pixel-pet XP、desktop-cat 性格权重。  
**禁止**打包无授权第三方 fan art 进生产默认包。

---

## 7. 预览壳说明（当前）

- 用现有 `fetchMyPet` / `petAction` 驱动「我的 / 养成」。  
- 图鉴 / 校园 / 探索 / 对战 / 专注：产品结构真实展示，部分为 **preview** 标记（未上服务端）。  
- 官方狐狸为默认物种定义；现有方块萌宠映射为图鉴条目（owned/locked 演示）。

---

## 8. 下一步（立即）

1. 业务页接线 `PetBridge` / `pingPetBehavior`  
2. 番茄页从预览改为可结算会话（本地 session + RPC）  
3. 多宠表迁移脚本评审  

## 9. 学生端怎么看效果

1. 打开 App / H5，进入 **宠物**（首页轮播或「我的」入口 → `/pet`）  
2. 顶栏滑动：**首页 / 我的 / 图鉴 / 养成 / 校园 / 探索 / 对战 / 专注**  
3. 右上角 **旧版养成** → `/pet/legacy` 可回完整旧页  
4. 计划全文：`docs/petdex/PLAN.md`  

## 10. Petdex 社区包导入

- 目录：`public/pets/imported/{slug}/`（`pet.json` + `spritesheet.webp` + `SOURCE.json`）  
- 索引：`public/pets/imported/index.json`  
- 署名：`ATTRIBUTION.md`  
- 命令：`npm run import:petdex`  
- UI：图鉴筛选「社区」；详情展示作者与精灵表  
- **禁止**把社区包当成官方狐狸；**禁止**改写原始 `pet.json`  


