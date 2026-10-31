# A2 — 待办空态插画（4 张）

**用途**：替换 `src/pages/TodoPage.tsx` 中所有 emoji 空态图标  
**接收方**：Midjourney v6 / 即梦 / GPT-4o image  
**尺寸**：1024 × 1024，PNG，圆角矩形蒙版（corner-radius 24px）  
**接入**：导出后丢给前端 AI 走 B2，封装成 `<TodoIllustration variant="idle|done|overdue|empty" />`

## 通用风格基线

```
Square 1:1 illustration, soft pastel mint background (#f3fbe8)
with subtle radial vignette toward edges. Center subject takes
~60% of canvas. Style: cute flat-2.5D, rounded shapes, no
outlines or only ultra-thin (1px) outlines. Limited palette:
lemon-green #67c23a, soft green #e9f8d6, warm orange #ff8c22,
cream #fff7e6, soft red #f47c7c. NO text, NO UI chrome, NO
watermark. Mood: friendly, calm, hopeful. The illustration
should feel like a small reward / mascot, not corporate.
Negative prompt: photo, 3D, dark, neon, complex, busy,
realistic face, hand, text.
```

## Variant `idle`（普通空态，「这里空空的」）

```
[common baseline]

Center: a large clipboard tilted slightly counter-clockwise
(~ -8°), with 3 empty checkboxes drawn on its top sheet, and
a small pencil resting on the right edge of the clipboard.
Above the clipboard, 3 tiny floating cards (rectangles with
subtle drop shadow) drift upward. Foreground: a tiny sleeping
cat curled at the bottom-left corner of the clipboard, with
two small "Z" letters floating up (use abstract sleeping
icons, not literal Z text — render as soft Z-like glyphs or
just two tiny curving lines). Mood: inviting, fresh start.
```

## Variant `done`（已完成空态，「还没有完成记录」）

```
[common baseline]

Center: a happy trophy / medal at top (gold-yellow #ffd44a
with cream highlights) with two small ribbons trailing.
Below the trophy, a clipboard with all 3 checkboxes checked
in green, plus a big checkmark sticker overlapping the
clipboard's bottom-right corner. Confetti (small triangles,
circles, rectangles in green/orange/yellow) scattered across
the top half of the canvas. No cat in this variant.
```

## Variant `overdue`（逾期提示）

```
[common baseline, BUT shift the background tint slightly
toward warm peach instead of pure mint, to signal urgency]

Center: a small alarm clock (rounded square body, two bells
on top, simple clock face with red hands pointing to ~10:10)
with motion lines around it suggesting ticking. Below the
clock, a clipboard with 2 of 3 checkboxes filled red instead
of green. A small soft-red tag/ribbon is attached to the
clipboard's top-right corner. Keep the mood encouraging,
not alarming — it should feel "you got this" rather than
"you're late".
```

## Variant `empty`（登录前空态，提示登录后使用）

```
[common baseline]

Center: a key floating above a softly glowing padlock (both
flat-2.5D). The padlock is mint-green with a darker green
shackle. Around the key+padlock, 4 tiny floating sparkles
(4-pointed stars) form a loose ring. Mood: welcoming,
"come on in".
```

## 输出建议

- 每张各生成 4 张备选，挑 1 张
- **统一圆角 24px**，圆形/方形都不要
- 背景半透明处理（避免白底直方块感），让 App 内的 `var(--card)` 透出来
- 文件名：`todo-empty.idle.png` / `todo-empty.done.png` / `todo-empty.overdue.png` / `todo-empty.signin.png`
- 拿到后丢给前端 AI 走 **B2**，封装成 React 组件