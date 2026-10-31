# -*- coding: utf-8 -*-
"""Fox-only layers: rembg ISNet only (no aggressive color masks), full-bleed crop."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from rembg import remove
from rembg.session_factory import new_session

ROOT = Path(r"C:\Users\upwar\Desktop\xm-main")
SRC = Path(r"C:\Users\upwar\Downloads\狐狸App桌面图标变脸状态合集.png")
OUT = ROOT / "design" / "cutouts-v2"
WEB = ROOT / "public" / "sunny-fox"
SESSION = new_session("isnet-general-use")

MOODS = [
    {"day": 1, "key": "streak_1"},
    {"day": 3, "key": "streak_3"},
    {"day": 7, "key": "streak_7"},
    {"day": 14, "key": "streak_14"},
    {"day": 2, "key": "away_2"},
    {"day": 5, "key": "away_5"},
    {"day": 8, "key": "away_8"},
    {"day": 12, "key": "away_12"},
    {"day": 15, "key": "away_15"},
    {"day": 20, "key": "away_20"},
    {"day": 25, "key": "away_25"},
    {"day": 30, "key": "away_30"},
]


def trim_alpha(im: Image.Image, pad: int = 2) -> Image.Image:
    im = im.convert("RGBA")
    bbox = im.getbbox()
    if not bbox:
        return im
    l, t, r, b = bbox
    l, t = max(0, l - pad), max(0, t - pad)
    r, b = min(im.width, r + pad), min(im.height, b + pad)
    return im.crop((l, t, r, b))


def cover_square(im: Image.Image, side: int = 512, scale: float = 1.22) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    ratio = max(side / w, side / h) * scale
    nw, nh = max(1, int(w * ratio)), max(1, int(h * ratio))
    resized = im.resize((nw, nh), Image.Resampling.LANCZOS)
    left, top = (nw - side) // 2, (nh - side) // 2
    top = min(max(0, top - side // 16), nh - side)
    return resized.crop((left, top, left + side, top + side))


def soft_cut(cell: Image.Image) -> Image.Image:
    cut = remove(cell, session=SESSION).convert("RGBA")
    arr = np.array(cut)
    r, g, b, a = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]
    # Only strip obvious leftover sky / sheet white; keep dark mood art
    sky = (b > 160) & (b > r + 35) & (b > g + 15) & (r < 190) & (a > 0)
    sheet = (r > 248) & (g > 248) & (b > 248)
    a2 = a.copy()
    a2[sky | sheet] = 0
    # slight alpha feather
    alpha = Image.fromarray(a2, mode="L").filter(ImageFilter.GaussianBlur(0.6))
    out = arr.copy()
    out[:, :, 3] = np.array(alpha)
    return trim_alpha(Image.fromarray(out, "RGBA"), 3)


def main() -> None:
    grid = Image.open(SRC).convert("RGBA")
    arr = np.array(grid)
    content = ~((arr[:, :, 0] > 245) & (arr[:, :, 1] > 245) & (arr[:, :, 2] > 245))
    ys, xs = np.where(content)
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    cols = 4
    cw, ch = (x1 - x0 + 1) / cols, (y1 - y0 + 1) / 3

    (OUT / "fox-only").mkdir(parents=True, exist_ok=True)
    (OUT / "preview").mkdir(parents=True, exist_ok=True)
    (WEB / "fox-only").mkdir(parents=True, exist_ok=True)
    away_frames: list[Image.Image] = []

    for i, m in enumerate(MOODS):
        rr, cc = divmod(i, cols)
        inset = 4
        cell = grid.crop(
            (
                int(x0 + cc * cw) + inset,
                int(y0 + rr * ch) + inset,
                int(x0 + (cc + 1) * cw) - inset,
                int(y0 + (rr + 1) * ch) - inset,
            )
        )
        fox = soft_cut(cell)
        base = f"icon-{m['key']}-d{m['day']:02d}"
        fox.save(OUT / "fox-only" / f"{base}-fox.png")
        sq = cover_square(fox, 512, 1.22)
        canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
        canvas.paste(sq, (0, 0), sq)
        canvas.save(WEB / "fox-only" / f"{base}.png")
        if m["key"].startswith("away_"):
            away_frames.append(cover_square(fox, 256, 1.2))
        print("ok", m["key"], fox.size)

    cell_s = 256
    strip = Image.new("RGBA", (cell_s * len(away_frames), cell_s), (0, 0, 0, 0))
    for i, fr in enumerate(away_frames):
        strip.paste(fr, (i * cell_s, 0), fr)
    strip.save(OUT / "preview" / "away-face-strip.png")
    strip.save(WEB / "fox-only" / "away-face-strip.png")
    print("ALL DONE strip", strip.size)


if __name__ == "__main__":
    main()
