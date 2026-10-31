# B4 — 课程色块叠加类型图标

**接收方**：Cursor / v0 / bolt / Trae  
**目标文件**：
- `src/pages/schedule/ScheduleHome.tsx`（课程色块渲染处）
- `src/pages/schedule/ScheduleHome.module.css`（图标定位）
- 新增 `src/components/ScheduleTypeIcon.tsx`（关键词匹配 + 图标选择）

**前置**：A3 图标集已生成（或先用 emoji 占位）

## 现状

```tsx
// ScheduleHome.tsx 课程色块渲染处（搜索 <div className={styles.cell}> 附近）
<div
  className={styles.cell}
  style={{ background: cell.bg }}
  onClick={() => openDetail(row)}
>
  <b className={styles.cellTitle}>{row.name}</b>
  <span className={styles.cellMeta}>
    @ {row.location || row.teacher || '—'}
  </span>
</div>
```

色块只是色块，缺少类型锚点。

## 改造目标

每个课程色块右上角加一个 20×20 的类型图标，根据课程名关键词自动匹配。

## 1. 新建 ScheduleTypeIcon 组件

```tsx
// src/components/ScheduleTypeIcon.tsx
import { Icons } from './Icons'

const KEYWORDS: Array<{ kind: 'lecture' | 'experiment' | 'computer' | 'language' | 'pe' | 'music' | 'art'; match: RegExp }> = [
  { kind: 'experiment', match: /实验|化学|物理|生物|lab/i },
  { kind: 'computer', match: /上机|编程|程序|数据结构|算法|计算机|软件/i },
  { kind: 'language', match: /英语|口语|日语|韩语|俄语|法语|德语|翻译/i },
  { kind: 'pe', match: /体育|篮球|足球|排球|网球|健美|体操|武术/i },
  { kind: 'music', match: /音乐|合唱|钢琴|声乐|器乐/i },
  { kind: 'art', match: /美术|绘画|设计|摄影|书法|雕塑/i },
  { kind: 'lecture', match: /.*/ }, // 默认兜底
]

export function ScheduleTypeIcon({ name, className }: { name: string; className?: string }) {
  const hit = KEYWORDS.find((k) => k.match.test(name))
  const kind = hit?.kind ?? 'lecture'

  return (
    <span className={className} aria-hidden="true">
      <Icons.ScheduleTypeIcon kind={kind} size={20} />
    </span>
  )
}
```

## 2. Icons 扩展

在 `src/components/Icons.tsx` 中新增 `ScheduleTypeIcon`（先支持 emoji 兜底，A3 图标到位后切换）：

```tsx
const SCHEDULE_TYPE_EMOJI: Record<string, string> = {
  lecture: '📖',
  experiment: '🧪',
  computer: '💻',
  language: '💬',
  pe: '🏀',
  music: '🎵',
  art: '🎨',
}

export function ScheduleTypeIcon({ kind, size = 20 }: { kind: string; size?: number }) {
  // A3 图标到位后切换为：return <img src={...} width={size} ... />
  return <span style={{ fontSize: size, lineHeight: 1 }}>{SCHEDULE_TYPE_EMOJI[kind] ?? '📖'}</span>
}
```

A3 图标到位后的切换版本：

```tsx
const SCHEDULE_TYPE_ICON_SRC: Record<string, string> = {
  lecture: new URL('../assets/schedule-icon.lecture.png', import.meta.url).href,
  experiment: new URL('../assets/schedule-icon.experiment.png', import.meta.url).href,
  // ...
}

export function ScheduleTypeIcon({ kind, size = 20 }: { kind: string; size?: number }) {
  return <img src={SCHEDULE_TYPE_ICON_SRC[kind]} width={size} height={size} alt="" />
}
```

## 3. 课程色块渲染

```tsx
<div
  className={styles.cell}
  style={{ background: cell.bg }}
  onClick={() => openDetail(row)}
>
  <ScheduleTypeIcon name={row.name} className={styles.cellIcon} />
  <b className={styles.cellTitle}>{row.name}</b>
  <span className={styles.cellMeta}>
    @ {row.location || row.teacher || '—'}
  </span>
</div>
```

## 4. CSS 调整

```css
.cell {
  position: relative;        /* 已有 */
  padding: 6px 8px;          /* 已有微调，留出图标空间 */
}

.cellIcon {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.7;
  pointer-events: none;      /* 不挡点击 */
}

.cellTitle {
  padding-right: 22px;       /* 给图标让位 */
  /* 原有的 font-size / ellipsis 等保持 */
}
```

## 验收清单

- [ ] 8 个 type 在课表里都能正确匹配并显示对应图标
- [ ] 图标在色块右上角，不遮挡课程名主体
- [ ] `pointer-events: none` 避免图标挡点击（点击仍触发课程详情）
- [ ] 关键词匹配按数组顺序优先级（实验 → 上机 → 英语 → 体育 → 音乐 → 美术 → 默认 lecture）
- [ ] 不匹配的课程名 fallback 到 📖 图标（不会空白）
- [ ] A3 图标到位后切换为 PNG 图片，**图标尺寸 / 位置不变**
- [ ] 课表整体配色（PALETTE 8 色）不变

## 关键词匹配优先级表

```
实验 / 化学 / 物理 / 生物 / lab    → 🧪
上机 / 编程 / 程序 / 数据结构 / 算法 → 💻
英语 / 口语 / 日语 / 韩语          → 💬
体育 / 篮球 / 足球 / 排球          → 🏀
音乐 / 合唱 / 钢琴                 → 🎵
美术 / 绘画 / 设计 / 摄影          → 🎨
其他 / 未匹配                      → 📖
```

如果两套关键词冲突（如「计算机应用实验」），前面的优先级更高。

## 性能注意

- 关键词匹配用正则，全数组 ≤ 8 个，性能不是问题
- 如果担心每节课都匹配一遍，可以用 useMemo 缓存：`const iconKind = useMemo(() => matchKind(row.name), [row.name])`