"""
单张透明 PNG → Codex 规格 8×9 stub 图集（1536×1872）
各行做更明显的「伪帧」差异，接近星露谷式可读动画（非 AI 真帧）。
输出：public/pets/atlases/{id}.png

用法:
  python tools/make-stub-atlas.py --all
  python tools/make-stub-atlas.py sheep
"""
from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "pets" / "atlases"
CRITTERS = ROOT / "src" / "assets" / "img" / "pet-critters"
CATS = ROOT / "src" / "assets" / "img" / "desk-cats"

COLS, ROWS = 8, 9
FW, FH = 192, 208
W, H = COLS * FW, ROWS * FH

ROW_MOTION = {
    0: "breath",
    1: "walk_r",
    2: "walk_l",
    3: "wave",
    4: "jump",
    5: "shake",
    6: "sleepy",
    7: "trot",
    8: "look",
}


def resolve_src(char_id: str, src: str | None) -> Path:
    if src:
        p = Path(src)
        return p if p.is_absolute() else ROOT / p
    for folder in (CRITTERS, CATS):
        cand = folder / f"{char_id}.png"
        if cand.exists():
            return cand
    raise SystemExit(f"source PNG not found for id={char_id}")


def all_ids() -> list[str]:
    return sorted({p.stem for p in list(CRITTERS.glob("*.png")) + list(CATS.glob("*.png"))})


def make_base(src: Image.Image) -> Image.Image:
    rgba = src.convert("RGBA")
    scale = min((FW - 20) / rgba.width, (FH - 24) / rgba.height)
    nw, nh = max(1, int(rgba.width * scale)), max(1, int(rgba.height * scale))
    return rgba.resize((nw, nh), Image.NEAREST)


def place(
    base: Image.Image,
    dx: float,
    dy: float,
    scale: float = 1.0,
    rot: float = 0.0,
    bright: float = 1.0,
) -> Image.Image:
    cell = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
    img = base
    if abs(scale - 1.0) > 1e-3:
        nw = max(1, int(img.width * scale))
        nh = max(1, int(img.height * scale))
        img = img.resize((nw, nh), Image.NEAREST)
    if abs(rot) > 0.05:
        img = img.rotate(rot, resample=Image.NEAREST, expand=True)
    if abs(bright - 1.0) > 0.02:
        rgb = ImageEnhance.Brightness(img.convert("RGB")).enhance(bright)
        a = img.split()[-1] if img.mode == "RGBA" else None
        img = rgb.convert("RGBA")
        if a is not None:
            img.putalpha(a.resize(img.size, Image.NEAREST) if a.size != img.size else a)
    x = int((FW - img.width) / 2 + dx)
    y = int(FH - img.height - 6 + dy)
    cell.alpha_composite(img, (max(-FW, x), max(-FH, y)))
    return cell


def frame_for(row: int, col: int, base: Image.Image) -> Image.Image:
    t = col / max(COLS - 1, 1)
    s = math.sin(t * math.pi * 2)
    c = math.cos(t * math.pi * 2)
    motion = ROW_MOTION.get(row, "breath")
    if motion == "breath":
        return place(base, s * 2, abs(s) * -5, 1.0 + abs(s) * 0.035, s * 2)
    if motion == "walk_r":
        bob = abs(math.sin(t * math.pi * 4)) * -7
        return place(base, -14 + col * 4, bob, 1.0, s * 7, 1.0 + abs(s) * 0.03)
    if motion == "walk_l":
        bob = abs(math.sin(t * math.pi * 4)) * -7
        return place(base, 14 - col * 4, bob, 1.0, -s * 7, 1.0 + abs(s) * 0.03)
    if motion == "wave":
        return place(base, s * 10, -3 + abs(c) * -2, 1.04, s * 12)
    if motion == "jump":
        arc = math.sin(t * math.pi)
        squash = 1.0 + arc * 0.1 if arc < 0.85 else 0.94
        return place(base, s * 3, -arc * 36, squash, s * 5, 1.0 + arc * 0.05)
    if motion == "shake":
        j = ((col % 2) * 2 - 1) * 7
        return place(base, j, s * 3, 0.97, j * 1.2, 0.95)
    if motion == "sleepy":
        return place(base, s * 1, 8 + abs(s) * 6, 0.88 - abs(s) * 0.03, s * 3, 0.9)
    if motion == "trot":
        bob = abs(math.sin(t * math.pi * 6)) * -10
        return place(base, s * 6, bob, 1.0, s * 8)
    if motion == "look":
        return place(base, s * 12, -6 + abs(c) * 2, 1.02, s * 5, 1.05)
    return place(base, 0, 0)


def build(char_id: str, src_path: Path) -> Path:
    base = make_base(Image.open(src_path))
    sheet = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for row in range(ROWS):
        for col in range(COLS):
            cell = frame_for(row, col, base)
            sheet.paste(cell, (col * FW, row * FH), cell)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{char_id}.png"
    sheet.save(out, optimize=True)
    print(f"wrote {out}")
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("id", nargs="?")
    ap.add_argument("--src", default=None)
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()
    if args.all:
        for cid in all_ids():
            build(cid, resolve_src(cid, None))
        return
    if not args.id:
        raise SystemExit("provide id or --all")
    build(args.id, resolve_src(args.id, args.src))


if __name__ == "__main__":
    main()
