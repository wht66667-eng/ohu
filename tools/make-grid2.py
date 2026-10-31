#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""放大查看设计图各局部，精确定位装饰元素坐标。"""
import os
from PIL import Image, ImageDraw

SRC = os.path.join(os.path.expanduser("~"), "Downloads")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "_grid")
os.makedirs(OUT, exist_ok=True)

JOBS = [
    ("校园服务首页·海洋狐狸风.png", (900, 200, 1152, 660), "z-home-right.png", 2),
    ("专注计时与学习统计页·海洋狐狸风.png", (0, 300, 1152, 1152), "z-focus-all.png", 1),
]

for fn, box, out, scale in JOBS:
    im = Image.open(os.path.join(SRC, fn)).convert("RGB")
    crop = im.crop(box)
    if scale != 1:
        crop = crop.resize((crop.size[0] * scale, crop.size[1] * scale), Image.LANCZOS)
    d = ImageDraw.Draw(crop)
    step = 50 * scale
    W, H = crop.size
    for i, x in enumerate(range(0, W, step)):
        d.line([(x, 0), (x, H)], fill=(255, 0, 0), width=1)
        d.text((x + 3, 3), str(box[0] + i * 50), fill=(255, 0, 0))
    for i, y in enumerate(range(0, H, step)):
        d.line([(0, y), (W, y)], fill=(255, 0, 0), width=1)
        d.text((3, y + 3), str(box[1] + i * 50), fill=(255, 0, 0))
    p = os.path.join(OUT, out)
    crop.save(p)
    print("saved", p, crop.size)
