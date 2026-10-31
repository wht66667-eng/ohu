# -*- coding: utf-8 -*-
"""Re-cut fox mood icons with a better rembg model and export full-bleed launcher assets."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from rembg import remove
from rembg.session_factory import new_session

ROOT = Path(r"C:\Users\upwar\Desktop\xm-main")
SRC_ICONS = Path(r"C:\Users\upwar\Downloads\狐狸App桌面图标变脸状态合集.png")
SRC_MASCOT = Path(r"C:\Users\upwar\Downloads\海洋太阳狐狸吉祥物锚点.png")
OUT = ROOT / "design" / "cutouts-v2"
WEB = ROOT / "public" / "sunny-fox"
RES = ROOT / "android" / "app" / "src" / "main" / "res"

# Prefer ISNet (better edges); fall back to local u2net.
MODEL = "isnet-general-use"
for candidate in ("isnet-general-use", "u2net"):
    try:
        SESSION = new_session(candidate)
        MODEL = candidate
        break
    except Exception as e:
        print("skip", candidate, e)
else:
    raise RuntimeError("no rembg session available")

print("model", MODEL)

MOODS = [
    {"day": 1, "key": "streak_1", "label": "Keep it going!", "phase": "active", "zh": "继续加油！"},
    {"day": 3, "key": "streak_3", "label": "You're doing great!", "phase": "active", "zh": "势头不错！"},
    {"day": 7, "key": "streak_7", "label": "Nice work!", "phase": "active", "zh": "干得漂亮！"},
    {"day": 14, "key": "streak_14", "label": "You're on fire!", "phase": "active", "zh": "燃起来了！"},
    {"day": 2, "key": "away_2", "label": "Don't forget!", "phase": "nudge", "zh": "别忘了回来呀"},
    {"day": 5, "key": "away_5", "label": "You can do it!", "phase": "nudge", "zh": "你可以的"},
    {"day": 8, "key": "away_8", "label": "Almost there...", "phase": "nudge", "zh": "就差一点…"},
    {"day": 12, "key": "away_12", "label": "Come back soon...", "phase": "nudge", "zh": "早点回来…"},
    {"day": 15, "key": "away_15", "label": "Don't give up!", "phase": "miss", "zh": "别放弃！"},
    {"day": 20, "key": "away_20", "label": "We miss you...", "phase": "miss", "zh": "想你了…"},
    {"day": 25, "key": "away_25", "label": "Hurry up!", "phase": "urgent", "zh": "快点回来！"},
    {"day": 30, "key": "away_30", "label": "Last chance!", "phase": "urgent", "zh": "最后机会！"},
]

DENSITIES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}


def cut(im: Image.Image) -> Image.Image:
    return remove(im, session=SESSION)


def trim_alpha(im: Image.Image, pad=4) -> Image.Image:
    if im.mode != "RGBA":
        im = im.convert("RGBA")
    bbox = im.getbbox()
    if not bbox:
        return im
    l, t, r, b = bbox
    l = max(0, l - pad)
    t = max(0, t - pad)
    r = min(im.width, r + pad)
    b = min(im.height, b + pad)
    return im.crop((l, t, r, b))


def cover_square(im: Image.Image, side=1024, scale=1.12) -> Image.Image:
    """Fill entire square; slight overscale so fox dominates (full-bleed)."""
    im = im.convert("RGBA")
    w, h = im.size
    # scale so min side covers target * scale
    ratio = max(side / w, side / h) * scale
    nw, nh = max(1, int(w * ratio)), max(1, int(h * ratio))
    resized = im.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - side) // 2
    top = (nh - side) // 2
    return resized.crop((left, top, left + side, top + side))


def round_mask(side: int, radius: float = 0.22) -> Image.Image:
    m = Image.new("L", (side, side), 0)
    d = ImageDraw.Draw(m)
    r = int(side * radius)
    d.rounded_rectangle((0, 0, side - 1, side - 1), radius=r, fill=255)
    return m


def save_web_and_mipmaps(key: str, day: int, full: Image.Image, fox_only: Image.Image):
    pad = f"{day:02d}"
    base = f"icon-{key}-d{pad}"
    icons_dir = OUT / "icons"
    icons_dir.mkdir(parents=True, exist_ok=True)
    (OUT / "fox-only").mkdir(parents=True, exist_ok=True)

    full_1024 = cover_square(full, 1024, scale=1.08)
    # soft round for preview
    prev = full_1024.copy()
    prev.putalpha(Image.composite(prev.split()[-1], round_mask(1024), round_mask(1024)))
    full_1024.save(icons_dir / f"{base}-1024.png")
    # also keep unrounded for adaptive / web
    full.save(icons_dir / f"{base}.png")
    fox_only.save(OUT / "fox-only" / f"{base}-fox.png")

    # web public
    web_icons = WEB / "icons"
    web_icons.mkdir(parents=True, exist_ok=True)
    full_1024.save(web_icons / f"{base}-1024.png")
    cover_square(full, 512, scale=1.08).save(web_icons / f"{base}.png", optimize=True)
    fox_web = WEB / "fox-only"
    fox_web.mkdir(parents=True, exist_ok=True)
    fox_only.resize((512, 512), Image.Resampling.LANCZOS).save(fox_web / f"{base}.png")

    # android mipmaps — full bleed square
    mip_name = "ic_mood_default" if key == "streak_1" and day == 1 else f"ic_{key}"
    # always write ic_<key>
    name = f"ic_{key}"
    for folder, px in DENSITIES.items():
        d = RES / folder
        d.mkdir(parents=True, exist_ok=True)
        cover_square(full, px, scale=1.1).save(d / f"{name}.png")

    return base


def main():
    for p in [OUT / "icons", OUT / "fox-only", OUT / "preview", OUT / "mascot"]:
        p.mkdir(parents=True, exist_ok=True)

    print("=== slice grid ===")
    grid = Image.open(SRC_ICONS).convert("RGBA")
    arr = np.array(grid)
    mask = ~((arr[:, :, 0] > 245) & (arr[:, :, 1] > 245) & (arr[:, :, 2] > 245))
    ys, xs = np.where(mask)
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    cols, rows = 4, 3
    cw = (x1 - x0 + 1) / cols
    ch = (y1 - y0 + 1) / rows

    manifest = []
    frames_for_anim = []

    for i, m in enumerate(MOODS):
        r, c = divmod(i, cols)
        inset = 4
        left = int(x0 + c * cw) + inset
        right = int(x0 + (c + 1) * cw) - inset
        top = int(y0 + r * ch) + inset
        bottom = int(y0 + (r + 1) * ch) - inset
        cell = grid.crop((left, top, right, bottom))

        # Full scene icon: keep background art, just trim outer white
        cell_rgba = cell.convert("RGBA")
        # remove near-white border only
        px = np.array(cell_rgba)
        white = (px[:, :, 0] > 250) & (px[:, :, 1] > 250) & (px[:, :, 2] > 250)
        # only clear border-connected white via simple edge wipe
        for edge in range(min(12, px.shape[0] // 20)):
            px[edge, :, 3] = np.where(white[edge, :], 0, px[edge, :, 3])
            px[-1 - edge, :, 3] = np.where(white[-1 - edge, :], 0, px[-1 - edge, :, 3])
            px[:, edge, 3] = np.where(white[:, edge], 0, px[:, edge, 3])
            px[:, -1 - edge, 3] = np.where(white[:, -1 - edge], 0, px[:, -1 - edge, 3])
        scene = trim_alpha(Image.fromarray(px, "RGBA"), 2)

        # Fox-only for popup animation (better model)
        fox = trim_alpha(cut(cell), 6)
        # If rembg ate too much, fall back to scene
        if fox.getbbox() is None or (fox.width * fox.height) < 8000:
            fox = scene.copy()

        base = save_web_and_mipmaps(m["key"], m["day"], scene, fox)
        manifest.append({**m, "file": f"{base}.png", "file_1024": f"{base}-1024.png", "fox": f"fox-only/{base}-fox.png"})
        frames_for_anim.append(cover_square(fox if m["phase"] != "active" else scene, 640, 1.05))
        print("ok", m["key"], scene.size, "fox", fox.size)

    (OUT / "icons" / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (WEB / "icons" / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    labels = {m["key"]: m["zh"] for m in MOODS}
    (WEB / "icons" / "labels-zh.json").write_text(
        json.dumps(labels, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # default launcher = streak_1 full bleed
    streak1 = Image.open(OUT / "icons" / "icon-streak_1-d01-1024.png")
    for folder, px in DENSITIES.items():
        d = RES / folder
        cover_square(streak1, px, 1.1).save(d / "ic_launcher.png")
        cover_square(streak1, px, 1.1).save(d / "ic_launcher_round.png")
        cover_square(streak1, px, 1.1).save(d / "ic_mood_default.png")

    # mascot refresh with better model
    print("=== mascot ===")
    mascot = Image.open(SRC_MASCOT).convert("RGBA")
    w, h = mascot.size
    body = mascot.crop((0, 0, int(w * 0.62), h))
    body_cut = trim_alpha(cut(body), 12)
    body_cut.save(OUT / "mascot" / "sunny-fox-fullbody.png")
    (WEB / "mascot").mkdir(parents=True, exist_ok=True)
    body_cut.save(WEB / "mascot" / "sunny-fox-fullbody.png")
    cover_square(streak1, 1024, 1.05).save(WEB / "mascot" / "sunny-fox-appicon-default.png")

    # sprite strip for CSS animation (away frames)
    away_keys = [m for m in MOODS if m["phase"] != "active"]
    cell_s = 256
    strip = Image.new("RGBA", (cell_s * len(away_keys), cell_s), (0, 0, 0, 0))
    for i, m in enumerate(away_keys):
        p = OUT / "fox-only" / f"icon-{m['key']}-d{m['day']:02d}-fox.png"
        fr = cover_square(Image.open(p), cell_s, 1.05)
        strip.paste(fr, (i * cell_s, 0), fr)
    strip.save(OUT / "preview" / "away-face-strip.png")
    strip.save(WEB / "fox-only" / "away-face-strip.png")
    print("strip", strip.size)

    print("ALL DONE", OUT)


if __name__ == "__main__":
    main()
