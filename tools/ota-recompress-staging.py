# -*- coding: utf-8 -*-
"""Recompress large PNGs in OTA staging to cut download size."""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

MIN_BYTES = 200_000


def shrink(p: Path) -> int:
    sz = p.stat().st_size
    im = Image.open(p).convert("RGBA")
    w, h = im.size
    if max(w, h) > 1400:
        ratio = 1400 / max(w, h)
        im = im.resize((max(1, int(w * ratio)), max(1, int(h * ratio))), Image.Resampling.LANCZOS)
    # RGBA → adaptive palette (Fast Octree)
    q = im.quantize(colors=192, method=Image.Quantize.FASTOCTREE)
    q.save(p, format="PNG", optimize=True)
    news = p.stat().st_size
    return max(0, sz - news) if news < sz else 0


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    saved = 0
    n = 0
    for p in root.rglob("*.png"):
        try:
            if p.stat().st_size < MIN_BYTES:
                continue
            delta = shrink(p)
            if delta > 0:
                saved += delta
                n += 1
        except Exception as e:
            print("skip", p.name, e)
    print(f"recompressed {n} files, saved ≈ {saved / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
