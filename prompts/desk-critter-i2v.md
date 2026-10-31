# 桌面方块萌宠 · 图生视频提示词（可灵 / 即梦 / Vidu）

本仓库 Cursor 会话里**没有**可用的「图生视频」API Key，所以线上动画先用抠图 PNG + CSS。  
若你有可灵 / 即梦等 Key，可用下面提示词批量出短视频，再转成 WebP/APNG 接到 `CatSprite`。

## 素材路径

- 静态抠图：`src/assets/img/desk-cats/{id}.png`
- 合图原图：`src/assets/img/desk-critter-sheet.jpg`

## 推荐参数

- 模式：Image-to-Video / 图生视频
- 时长：2–3 秒，循环友好
- 画幅：1:1
- 运动强度：低～中（保持蜡笔方块风，不要变成 3D 写实）

## 通用提示词（中英皆可）

```
Keep the exact character design from the reference image: quirky hand-drawn square animal, thick rough black crayon outline, flat crayon colors, googly eyes. Transparent or plain soft mint background. Gentle loopable idle motion: soft bounce and slight head wobble only. No morphing, no extra limbs, no text, no watermark, no realistic 3D.
```

### 喂食 eat
```
Same character, nibble once: body squash then stretch, tiny mouth open-close. Loopable. No new props unless a tiny leaf near mouth.
```

### 摸摸 pet
```
Same character, happy nuzzle: lean left-right, blush, eyes soften. Loopable. No hand in frame.
```

### 玩耍 play
```
Same character, playful hop twice then settle. Keep silhouette. Loopable.
```

## 接入约定（有视频后）

1. 导出 `desk-cats/{id}-idle.webp` / `{id}-eat.webp` …
2. 在 `src/data/desk-cats.ts` 的 `poses` 字段挂上路径
3. `CatSprite` 已通过 `deskCatPoseSrc` 自动优先用姿态图
