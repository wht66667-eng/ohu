# B1 — 待办悬浮按钮改玻璃拟态

**接收方**：Cursor / v0 / bolt / Trae  
**目标文件**：`src/pages/todo.module.css`、可选调整 `src/pages/TodoPage.tsx` 渲染顺序  
**前置**：无（与 A2 插画无关，可独立完成）

## 现状

```css
/* 当前在 todo.module.css 第 182 行附近 */
.fab {
  height: 46px;
  border: 0;
  border-radius: 14px;
  background: var(--green);
  color: #fff;
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
  font-family: inherit;
  box-shadow: 0 6px 16px rgba(103, 194, 58, 0.32);
}
.fab:active {
  transform: translateY(2px);
}
```

```tsx
// 当前在 TodoPage.tsx 第 229 行附近
<button type="button" className={s.fab} onClick={openNew}>
  + 新建待办
</button>
```

## 改造目标

把 `.fab` 从「整行铺底的长条按钮」改为「右下角圆形玻璃拟态悬浮按钮」。

### CSS 改造

```css
.fab {
  position: fixed;
  right: max(16px, env(safe-area-inset-right, 16px));
  bottom: calc(76px + var(--safe-bottom, 0px)); /* TabBar 上方 */
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(14px) saturate(180%);
  -webkit-backdrop-filter: blur(14px) saturate(180%);
  color: var(--green);
  font-size: 30px;
  font-weight: 300;
  line-height: 1;
  cursor: pointer;
  font-family: inherit;
  box-shadow:
    0 12px 28px rgba(86, 150, 60, 0.28),
    inset 0 1px 0 rgba(255, 255, 255, 0.85);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
  transition: transform 0.18s cubic-bezier(0.2, 0.9, 0.3, 1), box-shadow 0.18s ease;
}

/* 顶部高光：在玻璃面之上加一条非常淡的渐变，营造光线感 */
.fab::before {
  content: '';
  position: absolute;
  top: 4px;
  left: 10%;
  right: 10%;
  height: 28%;
  border-radius: 999px 999px 0 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.6), rgba(255, 255, 255, 0));
  pointer-events: none;
}

.fab:hover {
  transform: translateY(-2px);
  box-shadow:
    0 16px 32px rgba(86, 150, 60, 0.32),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.fab:active {
  transform: translateY(1px) scale(0.96);
  transition-duration: 0.08s;
}

/* 不支持 backdrop-filter 的浏览器降级 */
@supports not (backdrop-filter: blur(1px)) {
  .fab {
    background: rgba(255, 255, 255, 0.96);
    border-color: rgba(103, 194, 58, 0.3);
  }
}
```

### TSX 改造

```tsx
// 把原来的 "+ 新建待办" 文本按钮，换成圆形 + 号按钮
<button
  type="button"
  className={s.fab}
  onClick={openNew}
  aria-label="新建待办"
>
  +
</button>
```

## 设计要点

- **位置**：右下角，距离右屏 16px，距离底部 = TabBar 高度（64px）+ 安全区（`--safe-bottom`）+ 12px 间隔
- **大小**：56×56（Material 推荐最小 48，本设计偏大更醒目）
- **玻璃感**：`backdrop-filter: blur(14px) saturate(180%)` + 半透明白底
- **高光**：`::before` 伪元素模拟顶部柔光，圆角矩形渐变
- **阴影**：双层阴影 = 外部投影 + 内部高光（`inset 0 1px 0 rgba(255,255,255,.85)`）
- **降级**：用 `@supports not` 给老浏览器（IE/低版 Android Webview）降级到不透明白底
- **可访问性**：`aria-label="新建待办"` 给屏幕阅读器

## 验收清单

- [ ] iOS Safari 14+ / Chrome 80+ / 微信内置浏览器 / 安卓 Webview 均能正确显示玻璃效果
- [ ] 不支持 backdrop-filter 的环境下按钮仍可点、不变色
- [ ] 安全区（iPhone X+ 底部横条）下不会被遮挡
- [ ] 悬浮位置不与 TabBar 重叠（无论 TabBar 是否隐藏都要预留 76px）
- [ ] 按下时有缩放反馈（`scale(0.96)`）
- [ ] 暗色模式下背景改为 `rgba(40, 50, 40, 0.72)`、边框 `rgba(255, 255, 255, 0.12)`

## 与 B5 暗色模式的联动

如果同时接 B5，需要在 `:root[data-theme="dark"]` 下覆盖：

```css
:root[data-theme="dark"] .fab {
  background: rgba(40, 50, 40, 0.72);
  border-color: rgba(255, 255, 255, 0.12);
  color: var(--green-soft);
}
```