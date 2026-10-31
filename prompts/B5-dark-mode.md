# B5 — 全局暗色模式

**接收方**：Cursor / v0 / bolt / Trae  
**目标文件**：
- `src/index.css`（新增 `:root[data-theme="dark"]` token 覆盖集）
- 新增 `src/lib/theme.ts`（localStorage + 系统偏好检测）
- `src/main.tsx`（启动时应用 theme）
- `src/pages/SettingsPage.tsx`（新增暗色开关）
- 关键页面验证：`HomePage` / `TodoPage` / `ScheduleHome` / `MessagesPage`

## 总体策略

不重写组件，只重写 design tokens。组件已经全部走 `var(--xxx)`，所以理论上只需要：

1. 在 `:root[data-theme="dark"]` 下覆盖所有 token 值
2. 提供 `data-theme` 属性的切换入口
3. 默认值根据 `prefers-color-scheme` 决定

## 1. tokens 覆盖（`src/index.css`）

```css
:root[data-theme="dark"] {
  /* 背景层 */
  --green:        #67c23a;     /* 品牌色微调饱和度，避免过亮 */
  --green-hot:    #5cb82e;
  --green-deep:   #3d9a32;
  --green-text:   #88d673;     /* 暗色下文字需提亮 */
  --green-ink:    #b4e9a0;
  --green-soft:   #2a3a25;     /* 反转：暗色背景上作为色块用 */
  --mint:         #1e2a1c;     /* 极浅薄荷 → 暗绿底 */
  --mint-2:       #243324;
  --leaf:         #3d5a30;

  /* 警示 / 强调 */
  --yellow:       #ffd44a;
  --yellow-2:     #ffc107;
  --sun:          #b8902a;     /* 略降饱和 */
  --orange:       #ff9a40;     /* 略提亮 */
  --price:        #ff8a3a;
  --pink:         #ff9bb0;
  --blue:         #7eb4ff;     /* 略提亮 */
  --purple:       #b0a4ff;

  /* 文字 */
  --text:         #e4ece4;     /* 主文字：浅米色 */
  --text-2:       #a8b4a8;     /* 次要 */
  --text-3:       #748474;     /* 辅助 */

  /* 容器 / 边框 */
  --line:         #2a3a28;
  --card:         #1a2419;     /* 卡片底：深绿灰 */
  --shadow:       0 8px 22px rgba(0, 0, 0, 0.4);
  --shadow-sm:    0 4px 12px rgba(0, 0, 0, 0.28);

  /* 渐变背景（用于 HomePage 顶部） */
  --bg-grad-from: #1a2419;
  --bg-grad-mid:  #1a2419;
  --bg-grad-to:   #0f180f;

  /* 表格 / 课表 周视图列底色 */
  --col-today:    rgba(103, 194, 58, 0.12);
  --col-weekend:  rgba(255, 255, 255, 0.04);
}
```

## 2. 主题管理（`src/lib/theme.ts`）

```ts
const KEY = 'app.theme'

export type Theme = 'light' | 'dark' | 'system'

export function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {}
  return 'system'
}

export function applyTheme(theme: Theme) {
  const resolved = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme
  document.documentElement.setAttribute('data-theme', resolved)
  try { localStorage.setItem(KEY, theme) } catch {}
}

export function watchSystemTheme(cb: (dark: boolean) => void) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => cb(mq.matches)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
```

## 3. 启动时应用（`src/main.tsx`）

```tsx
import { applyTheme, getStoredTheme } from './lib/theme'

applyTheme(getStoredTheme())
// ... 原有 ReactDOM.createRoot(...)
```

## 4. 设置页开关（`src/pages/SettingsPage.tsx`）

在设置页合适位置加一个分组：

```tsx
<section className={s.section}>
  <h3 className={s.sectionTitle}>外观</h3>
  <div className={s.themeRow}>
    {(['light', 'dark', 'system'] as const).map((opt) => (
      <button
        key={opt}
        type="button"
        className={theme === opt ? `${s.themeBtn} ${s.themeOn}` : s.themeBtn}
        onClick={() => {
          setTheme(opt)
          applyTheme(opt)
        }}
      >
        {opt === 'light' ? '☀️ 浅色' : opt === 'dark' ? '🌙 深色' : '🖥 跟随系统'}
      </button>
    ))}
  </div>
</section>
```

组件顶部 state：

```tsx
const [theme, setTheme] = useState<Theme>(getStoredTheme())
```

## 5. 关键页面微调

### HomePage.module.css

`.page` 当前的径向渐变背景要换：

```css
.page {
  background:
    radial-gradient(circle at 90% 8%, rgba(255, 220, 80, 0.18), transparent 24%),
    linear-gradient(180deg, var(--bg-grad-from, #eaf8d4) 0%, var(--bg-grad-mid, #f3fbe8) 28%, var(--bg-grad-to, #f7fbf2) 100%);
}
```

### TodoPage.module.css

`.list .item`、`.emptyCard`、`.fab` 都已用 token，**无需改动**（自动跟随 B5 + B1）。

### ScheduleHome.module.css

课表周视图的「今日列底色」：

```css
.todayCol {
  background: var(--col-today, var(--green-soft));
}

.weekendCol {
  background: var(--col-weekend, transparent);
}
```

## 6. 测试清单

- [ ] 浅色模式下页面与改造前完全一致（像素对比）
- [ ] 切到深色模式后所有 token 颜色翻转，文字可读性 ≥ 4.5:1
- [ ] 课表 PALETTE 8 色在深色背景上仍清晰（PALETTE bg 都是浅色，fg 都是深色 —— 反转后 fg 需提亮，见下条）
- [ ] **课表 PALETTE 调整**（仅在 ScheduleHome.module.css 加局部覆盖）：
  ```css
  :root[data-theme="dark"] .cell {
    /* 课程色块的 fg 文字在深色背景下要变白 */
    color: rgba(255, 255, 255, 0.92);
  }
  ```
- [ ] 待办临期提醒弹窗在深色模式下：`background: var(--card)` 自动变深，remindSheet 圆角阴影对比度够
- [ ] 公告跑马灯卡片底色：`var(--card)` 自动跟随
- [ ] 启动屏插画（A4）：如有 `splash.main.dark.png` 版本则切换；否则浅色版在深色下也接受
- [ ] localStorage 'app.theme' 持久化、刷新后保持
- [ ] 跟随系统：OS 切换暗色 → 网页立即响应（`watchSystemTheme` 监听）

## 7. 性能注意

- token 切换只是 CSS 变量值变化，不触发组件 re-render
- 唯一需要 React 监听的是设置页的开关按钮状态（自己管自己即可）
- `matchMedia` 监听要在 App unmount 时清理（`watchSystemTheme` 已返回 cleanup）

## 8. 与其他改造的依赖

- 依赖 B1（FAB 暗色背景已包含）
- 依赖 B2（空态 SVG 颜色用 token，已兼容）
- 依赖 B3（公告卡片底色用 `--card`，已兼容）
- 依赖 B4（图标用 emoji 或 PNG，颜色不依赖 token）

执行顺序建议：B2 → B4 → B1 → B3 → B5