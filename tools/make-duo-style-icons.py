# -*- coding: utf-8 -*-
"""Duo-style launcher icons: solid brand plate + fox filling the square."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(r"C:\Users\upwar\Desktop\xm-main")
FOX = ROOT / "design" / "cutouts-v2" / "fox-only"
SCENE = ROOT / "design" / "cutouts-v2" / "icons"
WEB = ROOT / "public" / "sunny-fox" / "icons"
RES = ROOT / "android" / "app" / "src" / "main" / "res"

DENSITIES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

# solid plate colors — Duo uses flat green; we use sunny-fox mood plates
PLATES = {
    "streak_1": ("#4DB7FF", "#FFE56A"),
    "streak_3": ("#3DA8FF", "#FFD24A"),
    "streak_7": ("#2F9BFF", "#FFC93A"),
    "streak_14": ("#1E8CFF", "#FFB82E"),
    "away_2": ("#7EC8FF", "#F0F7FF"),
    "away_5": ("#8BB4D9", "#E8F0F8"),
    "away_8": ("#7A9BB8", "#D9E4EF"),
    "away_12": ("#6B8499", "#C9D5E2"),
    "away_15": ("#5C6B8A", "#B8C4D6"),
    "away_20": ("#4A5A78", "#A8B4C8"),
    "away_25": ("#FF8A3D", "#FFD0A8"),
    "away_30": ("#FF4B4B", "#FFB347"),
}

MOODS = [
    ("streak_1", 1),
    ("streak_3", 3),
    ("streak_7", 7),
    ("streak_14", 14),
    ("away_2", 2),
    ("away_5", 5),
    ("away_8", 8),
    ("away_12", 12),
    ("away_15", 15),
    ("away_20", 20),
    ("away_25", 25),
    ("away_30", 30),
]


def plate(side: int, c0: str, c1: str) -> Image.Image:
    im = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    r0 = tuple(int(c0[i : i + 2], 16) for i in (1, 3, 5))
    r1 = tuple(int(c1[i : i + 2], 16) for i in (1, 3, 5))
    for y in range(side):
        t = y / max(1, side - 1)
        col = tuple(int(r0[i] * (1 - t) + r1[i] * t) for i in range(3)) + (255,)
        d.line([(0, y), (side, y)], fill=col)
    return im


def fit_fox(fox: Image.Image, side: int, fill: float = 0.96) -> Image.Image:
    fox = fox.convert("RGBA")
    bbox = fox.getbbox()
    if bbox:
        fox = fox.crop(bbox)
    w, h = fox.size
    target = int(side * fill)
    ratio = min(target / w, target / h)
    nw, nh = max(1, int(w * ratio)), max(1, int(h * ratio))
    fox = fox.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    # sit slightly low like Duo owl
    x = (side - nw) // 2
    y = side - nh - int(side * 0.02)
    canvas.paste(fox, (x, y), fox)
    return canvas


def load_fox(key: str, day: int) -> Image.Image:
    pad = f"{day:02d}"
    p = FOX / f"icon-{key}-d{pad}-fox.png"
    if p.exists():
        return Image.open(p)
    # fallback: scene crop
    s = SCENE / f"icon-{key}-d{pad}-1024.png"
    if s.exists():
        return Image.open(s)
    return Image.open(WEB / f"icon-{key}-d{pad}.png")


def main() -> None:
    WEB.mkdir(parents=True, exist_ok=True)
    for key, day in MOODS:
        c0, c1 = PLATES[key]
        fox = load_fox(key, day)
        for folder, px in DENSITIES.items():
            d = RES / folder
            d.mkdir(parents=True, exist_ok=True)
            base = plate(px, c0, c1)
            layered = fit_fox(fox, px, 0.97 if px >= 96 else 0.94)
            out = Image.alpha_composite(base, layered)
            out.save(d / f"ic_{key}.png")
            if key == "streak_1":
                out.save(d / "ic_launcher.png")
                out.save(d / "ic_launcher_round.png")
                out.save(d / "ic_mood_default.png")
        # web preview (full scene still used in-app; duo plate for launcher parity)
        big = Image.alpha_composite(plate(512, c0, c1), fit_fox(fox, 512, 0.97))
        big.save(WEB / f"icon-{key}-d{day:02d}-duo.png")
        print("duo", key)
    print("ALL DONE")


if __name__ == "__main__":
    main()
