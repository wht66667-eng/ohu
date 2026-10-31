# A1 — 首页 Hero 宣传图（3 张）

**用途**：替换 `src/data/images.ts` 中的 `hero.home / hero.food / hero.pet` 背景图  
**接收方**：Midjourney v6 / 即梦 / GPT-4o image  
**尺寸**：1242 × 720（每张，3:1.74）  
**位置**：首页 `HeroCarousel.tsx`，自动循环播放 + 拖拽

## 通用风格基线

```
A soft watercolor illustration in a warm campus morning palette
(lemon green #67c23a, mint #e9f8d6, peach #ff8c22, cream #f3fbe8).
Style: flat-yet-layered with delicate paper-texture and gentle
grain. Rounded shapes, friendly proportions. No text, no UI
elements, no logos. Mood: cozy, youthful, optimistic. Avoid
realistic photos; keep shapes simple and friendly.
Negative prompt: photo, 3D render, dark, neon, text, watermark,
realistic face, hand, complex background.
```

## Slide 1 — `hero.home`（互助 / 服务总览）

```
[common baseline above]

Composition: a cute phone (rounded square) lying on its back
in the lower-right, with a paper-airplane swooping diagonally
from top-left. Around the phone, 4–5 floating soft-2.5D icons
appear in a gentle arc: a heart, a clock, a paper box, a paw,
a chat bubble — each with a subtle drop shadow. Background is
a soft green campus silhouette (low rooftops, trees, a clock
tower in the distance) under a lemon-yellow sunrise gradient
from top-right corner. Add 2–3 floating leaf confetti.
```

## Slide 2 — `hero.food`（食堂 / 餐饮）

```
[common baseline above]

Composition: a steaming rice bowl centered slightly-left, with
two side dishes (a small stir-fry bowl and a soup bowl) on its
right. Chopsticks resting across the rice bowl. Behind them,
a small storefront awning with subtle Chinese-roof eaves (no
characters). A few steam ribbons curl upward into warm lemon-
yellow light from the top. Foreground has 2–3 scattered grains
of rice and a small green leaf for garnish. Background: soft
gradient mint→cream, no busy patterns.
```

## Slide 3 — `hero.pet`（阳光萌宠）

```
[common baseline above]

Composition: a chubby orange tabby cat (round face, half-closed
eyes, peaceful smile) napping on a stack of 3 books in the
center. A friendly small dog (white-and-brown) peeks from
behind the books on the right. A ball of yarn sits on the
left. Background: a soft window with warm golden light
streaming in, a couple of small paw-print confetti floating.
Bottom edge has a thin grass texture (no text). Palette
leans toward warm orange + cream + mint accent.
```

## 输出建议

- 各生成 4 张备选，从中选 1
- 中标后导出 PNG + 1×、2×、3× 三档（DPR 适配）
- 文件名建议：`hero.home.v2.png` / `hero.food.v2.png` / `hero.pet.v2.png`
- 替换 `xm-main/src/data/images.ts` 中 `hero` 对象的引用即可，**代码无需改动**