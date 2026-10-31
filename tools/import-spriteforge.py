"""
把 SpriteForge / Sprute / 任意网格精灵表，规范成 Codex 8×9（1536×1872，格 192×208）。

常见输入：
  - 已是 8×9：直接缩放格子写入
  - 横向长条 / 少行多列：按行填充，不足行用 idle 行补齐
  - 单张 PNG：退回 make-stub-atlas 逻辑（请直接用 make-stub-atlas.py）

用法:
  python tools/import-spriteforge.py --id sheep --src path/to/sheet.png
  python tools/import-spriteforge.py --id snow --src sheet.png --cols 8 --rows 4
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "pets" / "atlases"

COLS_OUT, ROWS_OUT = 8, 9
FW, FH = 192, 208
W, H = COLS_OUT * FW, ROWS_OUT * FH


def fit_cell(im: Image.Image) -> Image.Image:
    rgba = im.convert("RGBA")
    # trim transparent margins a bit
    bbox = rgba.getbbox()
    if bbox:
        rgba = rgba.crop(bbox)
    scale = min((FW - 12) / max(rgba.width, 1), (FH - 16) / max(rgba.height, 1))
    nw, nh = max(1, int(rgba.width * scale)), max(1, int(rgba.height * scale))
    resized = rgba.resize((nw, nh), Image.NEAREST)
    cell = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
    cell.alpha_composite(resized, ((FW - nw) // 2, FH - nh - 6))
    return cell


def slice_grid(src: Image.Image, cols: int, rows: int) -> list[list[Image.Image]]:
    w, h = src.size
    cw, ch = w // cols, h // rows
    grid: list[list[Image.Image]] = []
    for r in range(rows):
        row: list[Image.Image] = []
        for c in range(cols):
            tile = src.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
            row.append(fit_cell(tile))
        # pad / trim to 8 cols
        while len(row) < COLS_OUT:
            row.append(row[-1].copy() if row else Image.new("RGBA", (FW, FH), (0, 0, 0, 0)))
        grid.append(row[:COLS_OUT])
    return grid


def guess_grid(src: Image.Image, cols: int | None, rows: int | None) -> tuple[int, int]:
    if cols and rows:
        return cols, rows
    w, h = src.size
    # prefer exact Codex
    if w % 8 == 0 and h % 9 == 0 and abs(w / h - 1536 / 1872) < 0.08:
        return 8, 9
    if cols and not rows:
        return cols, max(1, round(h / (w / cols)))
    if rows and not cols:
        return max(1, round(w / (h / rows))), rows
    # default: assume square-ish cells
    side = min(w, h)
    # try common: 4x4 stardew-ish, 8xN
    for c, r in ((8, 9), (8, 4), (4, 4), (6, 4), (8, 1)):
        if w >= c * 16 and h >= r * 16:
            return c, r
    return 8, max(1, h // max(w // 8, 1))


def build(char_id: str, src_path: Path, cols: int | None, rows: int | None) -> Path:
    src = Image.open(src_path).convert("RGBA")
    c, r = guess_grid(src, cols, rows)
    print(f"slice as {c}x{r} from {src.size}")
    grid = slice_grid(src, c, r)
    # pad rows to 9 using row0
    while len(grid) < ROWS_OUT:
        grid.append([cell.copy() for cell in grid[0]])
    grid = grid[:ROWS_OUT]

    sheet = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for ri, row in enumerate(grid):
        for ci, cell in enumerate(row):
            sheet.paste(cell, (ci * FW, ri * FH), cell)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{char_id}.png"
    sheet.save(out, optimize=True)
    print(f"wrote {out}")
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Import SpriteForge/Sprute sheet → Codex atlas")
    ap.add_argument("--id", required=True, help="character id, e.g. sheep")
    ap.add_argument("--src", required=True, help="source spritesheet path")
    ap.add_argument("--cols", type=int, default=None)
    ap.add_argument("--rows", type=int, default=None)
    args = ap.parse_args()
    src = Path(args.src)
    if not src.is_absolute():
        src = ROOT / src
    if not src.exists():
        raise SystemExit(f"missing {src}")
    build(args.id, src, args.cols, args.rows)


if __name__ == "__main__":
    main()
