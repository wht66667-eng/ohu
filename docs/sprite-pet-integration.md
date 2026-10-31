# sprite-pet 接入评估（xm-main）

目标：把「单张抠图 + CSS 抖动」升级为「精灵图集 + 帧动画」，互动仍由现有 DeskCatBuddy / PetStage 控制。

依赖：`sprite-pet@0.5.1`（已安装）

## 为什么不用 PetRuntime 整包接管

`PetRuntime` 会占用指针拖拽与自动行为。我们已有：

- 桌面：`DeskCatBuddy` 拖拽 / 能量 / 冷却 / 菜单
- 阳光：`PetStage` + 互动坞

因此采用 **半接入**：

| sprite-pet 能力 | 用法 |
|---|---|
| `UnifiedPetSpec` + `CssSpriteRenderer` | 渲染图集帧 |
| `PetBehaviorMachine`（可选） | 仅作语义参考；实际行为由宿主 `DeskCatAnim` 驱动 |
| `loadCodexPet` / `adaptCodexPet` | 后期接入真正 Codex 8×9 图集 |
| `PetRuntime` / `SpritePetWidget` | **暂不接**（会抢拖拽） |

## 改动文件清单

### 已做 / 脚手架

| 文件 | 作用 |
|---|---|
| `package.json` | 增加 `sprite-pet` |
| `docs/sprite-pet-integration.md` | 本文档 |
| `src/data/character-assets.ts` | 增加可选 `atlasSrc` |
| `src/lib/sprite-pet-bridge.ts` | `DeskCatAnim` ↔ `PetBehavior` + 构建 `UnifiedPetSpec` |
| `src/components/desk-cat/AtlasSprite.tsx` | 图集渲染器（有 atlas 时用） |
| `src/components/desk-cat/CatSprite.tsx` | 有 `atlasSrc` → AtlasSprite，否则回退单图 |
| `tools/make-stub-atlas.py` | 单 PNG → Codex 尺寸 8×9 stub 图集（打样） |
| `src/assets/img/pet-atlases/{id}.png` | 打样图集（先做 1–2 只） |

### 后续阶段（未做）

| 阶段 | 内容 | 涉及文件 |
|---|---|---|
| A. 真帧美术 | SpriteForge / Sprute 生成 idle/walk/wave… | `pet-atlases/`、`character-assets.ts` |
| B. Codex 包 | `public/pets/{id}/pet.json` + `spritesheet.webp`，`loadCodexPet` | `public/pets/`、`sprite-pet-bridge.ts` |
| C. 阳光舞台 | PetStage 强制走 Atlas（有图集角色） | `PetStage.tsx` |
| D. 选择器分组 | 小猫 / 阳光 /「已有动画」标签 | `PetPage`、`DeskCatBuddy` |
| E. 「同步到桌面」 | 换阳光形象可选同步 desk | `pet-critter.ts`、`character-db.ts` |

## 行为映射（宿主 → sprite-pet）

| DeskCatAnim / 阳光 pose | PetBehavior | Codex 行（真图集时） |
|---|---|---|
| idle / blink | idle | idle |
| eat | active | running / waving |
| pet | hover | waving |
| play / happy | celebrate | jumping |
| hungry | sleep | waiting |
| drag | drag | running-left/right |
| land | surprised | jumping |

## 图集契约

- **打样 stub**：把单帧缩放到 192×208，铺满 8×9（1536×1872），仅验证管线。
- **正式**：替换为多帧真动画；尺寸保持 Codex 契约即可直接 `adaptCodexPet`。
- 图集目录：`public/pets/atlases/{id}.png`（`npm run gen:atlas` 全量生成）
- 角色默认全部挂 `atlasSrc`；无文件时浏览器 404 会空白——生成后需一并部署 public。

## 真帧工作流（SpriteForge / Sprute）

1. 用 [SpriteForge](https://github.com/marcelontime/spriteforge) 或 [Sprute](https://github.com/sprited-ai/sprute) 生成多帧精灵表  
2. 导入为本项目 Codex 图集：

```bash
npm run import:atlas -- --id sheep --src path/to/sheet.png
# 或指定网格
npm run import:atlas -- --id snow --src sheet.png --cols 8 --rows 4
```

3. 覆盖 `public/pets/atlases/{id}.png` 后刷新即可，无需改代码  

无 AI Key 时继续用 stub：`npm run gen:atlas`（已含各行可辨伪帧）。

## 互动文案分流

`src/data/character-fx.ts`：小猫保留鱼/呼噜；阳光萌宠按物种投喂物与语气（如羊🌿、狗🦴、鲨🍤）。
