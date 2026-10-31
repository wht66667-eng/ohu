#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""素材验收台：把抠好的透明底 PNG 排到棋盘格上，一眼看灰斑/残留。"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCENE = os.path.join(ROOT, "public", "sunny-fox", "scene")

names = sorted(os.listdir(SCENE)) if os.path.isdir(SCENE) else []
names = [n for n in names if n.endswith(".png")]
print("素材:", names)

CELL = 240
COLS = 4
ROWS = (len(names) + COLS - 1) // COLS
W, H = CELL * COLS, CELL * ROWS
canvas = Image.new("RGB", (W, H), (255, 255, 255))
d = ImageDraw.Draw(canvas)
# 棋盘格背景（灰白交替，透明处会显出来）
for y in range(0, H, 20):
    for x in range(0, W, 20):
        if (x // 20 + y // 20) % 2 == 0:
            d.rectangle([x, y, x + 19, y + 19], fill=(228, 228, 228))

for i, n in enumerate(names):
    im = Image.open(os.path.join(SCENE, n)).convert("RGBA")
    im.thumbnail((CELL - 28, CELL - 28), Image.LANCZOS)
    cx = (i % COLS) * CELL + CELL // 2
    cy = (i // COLS) * CELL + CELL // 2
    canvas.paste(im, (cx - im.size[0] // 2, cy - im.size[1] // 2 - 8), im)
    d.rectangle([(i % COLS) * CELL, (i // COLS) * CELL, (i % COLS) * CELL + CELL - 1, (i // COLS) * CELL + CELL - 1], outline=(200, 200, 200))
    d.text(((i % COLS) * CELL + 6, (i // COLS) * CELL + CELL - 18), n.replace(".png", ""), fill=(20, 20, 20))

out = os.path.join(ROOT, "_grid", "scene-check.png")
canvas.save(out)
print("验收台:", out, canvas.size)
