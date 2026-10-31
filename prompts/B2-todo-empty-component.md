# B2 — 待办空态 SVG 组件

**接收方**：Cursor / v0 / bolt / Trae  
**目标文件**：
- 新增 `src/components/Illustrations/TodoEmpty.tsx`（SVG 组件）
- 新增 `src/components/Illustrations/TodoEmpty.module.css`（可选）
- 修改 `src/pages/TodoPage.tsx` 替换所有 `<span className={s.emptyEmoji}>📝</span>` 用法

**前置**：无（先用 emoji 占位也行，正式接 A2 插画后可再换）

## 组件契约

```ts
export type TodoEmptyVariant = 'idle' | 'done' | 'overdue' | 'signin'

export interface TodoEmptyProps {
  variant?: TodoEmptyVariant  // 默认 'idle'
  size?: number               // 默认 140（px）
  className?: string          // 透传给外层 <svg>
}
```

## 组件实现要点

### 1. 内嵌 SVG（不依赖外部资源）

用 React 手写 SVG，不引入 jpg/png，方便改色 + 体积 < 4KB。

```tsx
import styles from './TodoEmpty.module.css'

export type TodoEmptyVariant = 'idle' | 'done' | 'overdue' | 'signin'

export function TodoEmpty({ variant = 'idle', size = 140, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 140 140"
      className={className ?? styles.svg}
      role="img"
      aria-label={
        variant === 'idle' ? '待办为空' :
        variant === 'done' ? '暂无完成记录' :
        variant === 'overdue' ? '有逾期待办' :
        '请先登录'
      }
    >
      {/* variant === 'idle': 写字板 + 睡猫 */}
      {variant === 'idle' && <IdleScene />}
      {/* variant === 'done': 奖牌 + 全勾 */}
      {variant === 'done' && <DoneScene />}
      {/* variant === 'overdue': 红色闹钟 + 写字板 */}
      {variant === 'overdue' && <OverdueScene />}
      {/* variant === 'signin': 钥匙 + 锁 */}
      {variant === 'signin' && <SigninScene />}
    </svg>
  )
}
```

### 2. 四个场景的视觉描述（写给 AI 实现）

#### `idle`
- 中心偏上：一个倾斜 -8° 的写字板（圆角矩形，描边色 `var(--green)`，底色 `var(--card)`）
- 写字板内：3 个圆角方框勾选框（未选）
- 写字板右上角：一支短铅笔（斜放）
- 写字板底部左侧：一只蜷缩睡觉的简笔猫（眯眼、"Z" 抽象符号 = 两条细线）
- 写字板上方：3 张小卡片漂浮向上（带阴影）

#### `done`
- 顶部正中：一个金色奖牌（圆形 + 两侧飘带，黄色 `var(--yellow)` + 橙色高光）
- 中部：一个写字板（同 idle），但 3 个勾选框全部打勾（绿色填充 + 白色勾）
- 写字板右下角：一个圆形 ✓ 贴纸（绿色背景 + 白色对勾）
- 顶部散落：6 片五彩纸屑（绿/橙/黄三色，小三角 + 圆 + 矩形）

#### `overdue`
- 中心：一个红色闹钟（`#f47c7c`，方形钟身 + 顶部两个铃铛 + 简单表盘）
- 表盘指针：时针分针指向 ~10:10
- 闹钟下方：一个写字板（同 idle），但 2 个勾选框打红勾 + 1 个未选
- 写字板右上角：一个小红色丝带
- 整体色调：背景略偏暖橙（`#fff5ec`），营造紧迫但不焦虑

#### `signin`
- 中心偏上：一把金色钥匙（`var(--yellow)` + 橙色描边）
- 中心偏下：一把圆角方形锁（`var(--mint)` 填充 + `var(--green)` 描边，锁梁朝上）
- 周围：4 颗小四角星 sparkle（绿色 / 黄色 / 橙色散落）

### 3. CSS（最小化）

```css
.svg {
  display: block;
  margin: 0 auto;
}
```

## 接入 TodoPage

```tsx
// 替换 1：登录前空态
- <span className={s.emptyEmoji}>📝</span>
+ <TodoEmpty variant="signin" size={120} className={s.emptyEmoji} />

// 替换 2：今日 / 未完成 空态
- <span className={s.emptyEmoji}>🌿</span>
+ <TodoEmpty variant="idle" size={140} className={s.emptyEmoji} />

// 替换 3：已完成 空态
- <span className={s.emptyEmoji}>🎉</span>
+ <TodoEmpty variant="done" size={140} className={s.emptyEmoji} />
```

同时调整 `todo.module.css` 的 `.emptyEmoji`：

```css
.emptyEmoji {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 140px;
  height: 140px;
  margin-bottom: 4px;
}
```

## 验收清单

- [ ] 4 个 variant 都已实现，单文件 < 4KB gzipped
- [ ] 使用现有 design tokens（`--green` / `--yellow` / `--orange` / `--mint`）
- [ ] 不依赖任何外部资源（无 jpg/png/远程 URL）
- [ ] `role="img"` + `aria-label` 给屏幕阅读器
- [ ] `size` prop 正确缩放（默认 140）
- [ ] 接入 TodoPage 后所有 3 处 emoji 全部替换
- [ ] 暗色模式下颜色仍然清晰（颜色用 token 而非硬编码）

## 与 A2 的关系

如果将来用 A2 的高质量插画替换，可以把 `<TodoEmpty>` 整体改成：

```tsx
const idleImg = new URL('../../assets/todo-empty.idle.png', import.meta.url).href
return <img src={idleImg} ... />
```

而保留 4 个 variant 的 API 不变 —— 这是为什么组件契约里 `variant` 用语义化命名而不是 `kind1/kind2/...`。