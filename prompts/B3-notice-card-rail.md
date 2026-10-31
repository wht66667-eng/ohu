# B3 — 公告跑马灯升级卡片流

**接收方**：Cursor / v0 / bolt / Trae  
**目标文件**：
- `src/pages/HomePage.module.css`（`.notice` / `.marquee` / `.badge` 重写）
- `src/pages/HomePage.tsx`（`<div className={styles.notice}>` 结构调整）
- 新增 `src/components/BulletinCard.tsx`（可选，独立卡片组件）

**前置**：无

## 现状

```tsx
// HomePage.tsx 第 164 行附近
<div className={styles.notice}>
  <span className={styles.badge}>校园公告</span>
  <IconSpeaker />
  <div className={styles.marquee}>
    <span>{marquee}</span>
  </div>
</div>
```

目前是：左边「校园公告」绿色小标签 + 小喇叭图标 + 右边无限横向滚动的纯文字。

## 改造目标

横向滚动卡片流：每条公告是一张独立卡片（~280px 宽），scroll-snap 平滑吸附，3 条以上自动溢出滚动；hover 暂停滚动。

## 设计规范

### 单卡片结构

```
┌─────────────────────────────────────────┐
│ [icon]  [公告标题]              [小箭头] │
│         [发布时间 · 作者]               │
└─────────────────────────────────────────┘
   ↑ 圆角 16px，白底，左侧彩色图标块
```

- 卡片宽：280px（含 16px margin）
- 高度：64px
- 圆角：16px
- 背景：`var(--card)` + `--shadow-sm`
- 左侧图标块：40×40 圆角 12px，背景 = 公告类型对应色
- 右侧标题：13.5px，`--text` 色，超长 1 行省略
- 副标题：11.5px，`--text-3` 色
- 右侧箭头：12px，`--text-3` 色

### 公告类型 → 图标块配色

| 类型 | 图标 | 背景色 | 文字色 |
|---|---|---|---|
| `system`（系统通知） | ⚙️ / 🔔 | `var(--green-soft)` | `var(--green-text)` |
| `promo`（运营活动） | 🎁 / 🎉 | `#fff3e2` | `#9A5B14` |
| `event`（校园活动） | 📅 / 🎪 | `#fde7ec` | `#A6384C` |
| `default` | 📢 | `var(--mint)` | `var(--text-2)` |

### 滚动行为

```css
.notice {
  margin: 8px 16px 14px;
  position: relative;
  overflow: hidden;
}

.badge {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 2;
  background: var(--green);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  border-radius: 8px;
  padding: 3px 8px;
  box-shadow: 0 2px 6px rgba(103, 194, 58, 0.3);
}

.rail {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scroll-behavior: smooth;
  padding: 6px 16px 12px;
  -webkit-overflow-scrolling: touch;
}

.rail::-webkit-scrollbar {
  display: none;
}

.railCard {
  flex: 0 0 280px;
  scroll-snap-align: start;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--card);
  border-radius: 16px;
  box-shadow: var(--shadow-sm);
  text-decoration: none;
  color: inherit;
  border: 1px solid var(--line);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.railCard:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow);
}

.railIcon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
}

.railBody {
  flex: 1;
  min-width: 0;
}

.railTitle {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.railMeta {
  font-size: 11.5px;
  color: var(--text-3);
  margin-top: 2px;
}

.railArrow {
  flex-shrink: 0;
  color: var(--text-3);
  font-size: 14px;
}

/* 左侧渐隐遮罩，提示内容可滚动 */
.notice::before,
.notice::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 24px;
  pointer-events: none;
  z-index: 1;
}
.notice::before {
  left: 0;
  background: linear-gradient(90deg, var(--card), transparent);
}
.notice::after {
  right: 0;
  background: linear-gradient(270deg, var(--card), transparent);
}
```

## 数据流改造

`HomePage.tsx` 第 121 行：

```tsx
- const marquee = [PROMO_NOTICE, ...news.rows.slice(0, 2).map((n) => n.title)].join(' · ')
+ const promoNotice: News = {
+   id: -1,
+   title: PROMO_NOTICE,
+   type: 'promo',
+   created_at: new Date().toISOString(),
+ }
+ const railItems: News[] = [promoNotice, ...news.rows.slice(0, 4)]
```

渲染部分（第 164 行附近）：

```tsx
<div className={styles.notice}>
  <span className={styles.badge}>校园公告</span>
  <div className={styles.rail}>
    {railItems.map((n) => (
      <Link
        key={n.id}
        to={`/info?id=${n.id}`}
        className={styles.railCard}
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className={styles.railIcon}
          style={{
            background: TYPE_BG[n.type] ?? 'var(--mint)',
            color: TYPE_FG[n.type] ?? 'var(--text-2)',
          }}
        >
          {TYPE_EMOJI[n.type] ?? '📢'}
        </span>
        <span className={styles.railBody}>
          <span className={styles.railTitle}>{n.title}</span>
          <span className={styles.railMeta}>
            {fmtTime(n.created_at)} · {TYPE_LABEL[n.type] ?? '公告'}
          </span>
        </span>
        <span className={styles.railArrow}>›</span>
      </Link>
    ))}
  </div>
</div>
```

`TYPE_BG` / `TYPE_FG` / `TYPE_EMOJI` / `TYPE_LABEL` 在文件顶部定义常量：

```tsx
const TYPE_BG: Record<string, string> = {
  system: 'var(--green-soft)',
  promo: '#fff3e2',
  event: '#fde7ec',
}
const TYPE_FG: Record<string, string> = {
  system: 'var(--green-text)',
  promo: '#9A5B14',
  event: '#A6384C',
}
const TYPE_EMOJI: Record<string, string> = {
  system: '🔔',
  promo: '🎁',
  event: '🎪',
}
const TYPE_LABEL: Record<string, string> = {
  system: '系统通知',
  promo: '运营活动',
  event: '校园活动',
}
```

## 验收清单

- [ ] 公告数量 = 0 时整块不渲染（不显示空跑马灯）
- [ ] 公告数量 1 张时不滚动，居中显示
- [ ] 公告数量 ≥ 2 张时横向滚动，scroll-snap 平滑吸附
- [ ] 左右两侧渐隐遮罩提示可滚动
- [ ] 鼠标 hover 在桌面上有抬起反馈
- [ ] 移动端触摸拖拽不被误识别为点击
- [ ] 现有数据源 `fetchNews()` 返回的 `type` 字段若没有则 fallback 到 `default`
- [ ] 暗色模式下卡片底色 `--card` 自动跟随（不需要额外 CSS）

## 可选增强

- 加 5 秒自动滚动到下一张（用 `setInterval` + `scrollTo`）
- 加一个「全部公告」按钮跳转到 `/info`
- 滚动到末尾时回弹到开头（参考 HeroCarousel 的 clone trick）