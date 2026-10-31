# A4 — 启动屏 / 分享卡片插画

**用途**：  
1. 启动屏 `src/components/BootGate.tsx`（当前是占位）  
2. 分享卡片背景（`share-card.png` 已存在，可作为新版替换参考）

**接收方**：Midjourney v6 / 即梦 / GPT-4o image  
**尺寸**：750 × 1334（竖版 9:16），后续可裁切为 16:9 / 1:1 / 3:4

## 通用风格基线

```
Vertical poster 750×1334, hybrid style: watercolor wash
background + flat-2.5D character/object elements in the
foreground. Palette is locked:
  lemon-green  #67c23a
  mint         #e9f8d6
  cream        #f3fbe8
  yellow       #ffd44a
  peach        #ff8c22
  soft red     #f47c7c (used sparingly)
Mood: fresh, hopeful, campus-life. NO text, NO logo, NO
watermark. Negative prompt: photo, 3D render, dark, neon,
complex, busy, text, logo, watermark, realistic face.
```

## 启动屏主版本（`splash.main.png`）

```
[common baseline]

Top quarter (~0–333px):
  - A lemon-green sky gradient from the top, transitioning
    down to mint
  - 2–3 soft watercolor clouds (very light, almost white)
  - One paper-airplane swooping in from the top-left at a
    slight downward angle, with a subtle dashed flight path

Middle (~333–900px):
  - A cute stylized campus silhouette: a clock tower in the
    center, flanked by lower academic buildings, trees on
    both sides. Use a single soft-green watercolor mass with
    subtle internal highlights to suggest depth.
  - In front of the silhouette, place the brand mascot:
    a small leaf-shaped character (rounded triangular leaf
    body, ~120px tall) with a tiny smile face (two dot eyes,
    a small curved mouth), one stubby arm raised in a wave.
    Color the body in lemon-green with a yellow inner highlight.

Bottom (~900–1334px):
  - A wide horizontal ribbon in mint-green (#e9f8d6) spanning
    the full width, with subtle paper-texture grain
  - On the ribbon, place 3 small decorative icons spaced out:
    a heart, a paw, a chat bubble — each in deep green stroke
    with mint fill
  - Very bottom: a thin gradient fade to white, suggesting
    the splash fading into the app
```

## 分享卡片版（`share-card.poster.png`）

```
[common baseline, BUT composition is denser and more
product-oriented]

Top (~0–250px):
  - Same lemon-green sky + paper airplane, but more compact
  - A subtle confetti scatter (3 tiny circles + 2 tiny
    triangles in orange/yellow)

Middle (~250–1000px):
  - The mascot character from the splash, now ~30% larger
  - Mascot is holding a small heart in its raised hand
  - Behind the mascot, a soft circular halo in pale yellow

Bottom (~1000–1334px):
  - A 3-card horizontal stack (each ~600×180px) of mini
    product previews:
    Card 1: a small phone mockup with the "互助" heart icon
    Card 2: a small bowl icon (food)
    Card 3: a small paw icon (pets)
  - Cards have soft white background with rounded corners
    (radius 24px), slight drop shadow
  - Below the cards, leave ~80px of breathing room in cream
```

## 输出建议

- 各生成 4 张备选，挑 1
- 启动屏建议生成 2 个变体（一深一浅，方便暗色模式时切换）
- 文件名：
  - `splash.main.png`（默认启动屏）
  - `splash.main.dark.png`（暗色模式启动屏，可选）
  - `share-card.poster.png`（分享卡片背景）
- 替换路径：
  - 启动屏 → 改 `src/components/BootGate.tsx` 的 `<img src>`
  - 分享卡片 → 改 `share-card.png`（项目根目录已有）