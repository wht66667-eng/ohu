# A3 — 课表类型图标（8 枚）

**用途**：叠加到 `src/pages/schedule/ScheduleHome.tsx` 的课程色块右上角  
**接收方**：Midjourney v6 / Recraft / 即梦（图标模式）  
**尺寸**：单枚 512 × 512，最终展示 20 × 20 px  
**接入**：导出后丢给前端 AI 走 B4，关键词匹配课程名

## 通用风格基线

```
8 separate icons on transparent background. Single unified
visual language: 2.5px rounded stroke (corner-radius 4–6px),
two-tone style — primary stroke deep green #2f8f2a, soft
mint fill #e9f8d6 at ~40% opacity behind the stroke. Optional
accent color is #ff8c22 (orange) for emphasis dots/details.
No outlines on the strokes. Icons should read clearly at 20×20
on both light cards and dark cards. NO text, NO labels, NO
watermark. Consistent visual weight across all 8 — same
stroke width, same internal padding (~12% margin on all sides).
```

## 8 枚清单

| 序号 | 图标含义 | 关键词匹配 | 视觉描述 |
|---|---|---|---|
| 1 | lecture（讲授课）| 课程/高等数学/语文 | 打开的书 + 小声波线 |
| 2 | experiment（实验）| 实验/化学/物理/生物 | 锥形瓶 + 2–3 个小气泡 |
| 3 | computer（编程/上机）| 上机/编程/程序设计/数据结构 | 显示器 + 屏幕上一对尖括号 `</>` |
| 4 | language（语言）| 英语/口语/日语/翻译 | 对话气泡 + 内嵌 3 个小圆点 (ABC 抽象) |
| 5 | pe（体育）| 体育/篮球/足球/排球/健美 | 篮球（带弧线缝线） |
| 6 | music（音乐）| 音乐/合唱/钢琴 | 八分音符 + 一根细线尾巴 |
| 7 | art（美术/设计）| 美术/绘画/设计/摄影 | 调色板 + 短笔触刷 |
| 8 | misc（其他）| 其他/通识/选修/未匹配 | 问号 `?` 嵌在圆圈里 |

## 各图标详细提示词

### 1. lecture
```
A simple line icon: an open book (two pages forming a gentle
V-shape) with 3 small sound-wave arcs emerging from the right
page, suggesting a lecture being given. 2.5px rounded stroke,
two-tone mint fill behind the book outline. No text.
```

### 2. experiment
```
A line icon of a chemistry flask (Erlenmeyer, triangular body,
narrow neck). Inside the flask, 3 small circular bubbles rise
toward the neck. A tiny droplet sits on the flask's rim.
2.5px rounded stroke, mint fill at 40%.
```

### 3. computer
```
A line icon of a desktop monitor (rounded rectangle screen on
a small stand). On the screen, two angle brackets `</>` are
visible in deep green stroke. Subtle mint fill behind the
monitor body. No text.
```

### 4. language
```
A line icon of a chat/speech bubble (rounded square with a
small tail at the bottom-left). Inside the bubble, three small
filled circles arranged horizontally, suggesting talking or
language. 2.5px rounded stroke, mint fill.
```

### 5. pe
```
A line icon of a basketball: a circle with two horizontal
curves and two vertical curves, suggesting the seams. Single
2.5px stroke in deep green, no fill. Make it feel playful.
```

### 6. music
```
A line icon of an eighth note (filled oval head on the left
+ vertical stem on the right + a single curved flag at the
top-right of the stem). 2.5px rounded stroke on the stem and
flag, the note head is solid filled in deep green.
```

### 7. art
```
A line icon of an artist's palette (kidney-bean shape with a
thumb-hole on the left). On the palette, 3 small filled dots
in orange (#ff8c22) suggest paint blobs. A short angled brush
brush sticks out from the top-right of the palette.
```

### 8. misc
```
A line icon: a question mark glyph centered inside a soft
rounded square outline. Both stroke and the question mark
share deep green; the square's interior has a very subtle
mint fill. Friendly, not interrogative.
```

## 输出建议

- 一次请求生成 8 枚（用「8 icons in a single 4×2 grid」也可以，但推荐单独生成以便风格对齐）
- 全部 PNG 透明背景，**禁止白色背景**
- 文件名：`schedule-icon.lecture.png` / `schedule-icon.experiment.png` / … / `schedule-icon.misc.png`
- 拿到后丢给前端 AI 走 **B4**，按关键词挂到课程色块右上角