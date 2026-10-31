# 任务 3：UI 优化提示词包

本目录按「图片素材 / 代码优化 / 一句话小需求」三类，整理了可直接复制给其他 AI 的提示词。  
全部基于现有 sunshine-campus 校园小程序的设计 tokens（绿/橙/粉 + 圆角/阴影）。

## 文件索引

| 文件 | 用途 | 接收方 |
|---|---|---|
| `A1-hero-banners.md` | 首页 Hero 三张宣传背景图 | Midjourney / 即梦 / GPT-4o |
| `A2-todo-empty-illustration.md` | 待办空态 4 张插画 | Midjourney / 即梦 / GPT-4o |
| `A3-schedule-icon-set.md` | 课表 8 个类型图标 | Midjourney / 即梦 / Recraft |
| `A4-splash-share-poster.md` | 启动屏 / 分享卡片插画 | Midjourney / 即梦 / GPT-4o |
| `B1-fab-glassmorphism.md` | 待办玻璃拟态 FAB | Cursor / v0 / bolt |
| `B2-todo-empty-component.md` | 待办空态 SVG 组件 | Cursor / v0 / bolt |
| `B3-notice-card-rail.md` | 公告跑马灯升级卡片流 | Cursor / v0 / bolt |
| `B4-schedule-icon-overlay.md` | 课程色块叠加图标 | Cursor / v0 / bolt |
| `B5-dark-mode.md` | 全局暗色模式 | Cursor / v0 / bolt |
| `C-quick-tasks.md` | 一句话小需求 7 条 | 任何前端 AI |

## 推荐执行顺序

1. **A 系列插画先行**（A1 → A2 → A4 → A3），拿到图后
2. **B 系列代码接入**（B2 空态组件 → B4 课程图标 → B1 玻璃 FAB → B3 公告卡片 → B5 暗色）

## 颜色 token 速查

```
--green       #67c23a   主品牌色（绿）
--green-soft  #e9f8d6   绿底浅底
--mint        #f3fbe8   极浅薄荷
--yellow      #ffd44a   警示/今日高亮
--orange      #ff8c22   强调/逾期
--pink        #ff8aa0   待办/互助
--purple      #9b8cff   店铺街
--text        #2c3a2c   主文字
--text-3      #97a697   次要文字
--card        #ffffff   卡片底
--shadow-sm   0 4px 12px rgba(86,150,60,0.08)
--shadow      0 8px 22px rgba(86,150,60,0.12)
--radius      18px
--radius-lg   22px
```