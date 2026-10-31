#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把设计图切成带坐标网格的局部图，便于精确定位要抠的元素。"""
import os
from PIL import Image, ImageDraw

SRC = os.path.join(os.path.expanduser("~"), "Downloads")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "_grid")
os.makedirs(OUT, exist_ok=True)

JOBS = [
    ("校园服务首页·海洋狐狸风.png", (420, 220, 1152, 780), "home-fox.png"),
    ("专注计时与学习统计页·海洋狐狸风.png", (250, 330, 1050, 900), "focus-fox.png"),
    ("服务列表页·海洋狐狸风.png", (520, 40, 1120, 400), "svc-fox.png"),
]

for fn, box, out in JOBS:
    im = Image.open(os.path.join(SRC, fn)).convert("RGB")
    crop = im.crop(box).resize(
        ((box[2] - box[0]), (box[3] - box[1])), Image.LANCZOS
    )
    d = ImageDraw.Draw(crop)
    step = 50
    W, H = crop.size
    for x in range(0, W, step):
        d.line([(x, 0), (x, H)], fill=(255, 0, 0), width=1)
        d.text((x + 3, 3), str(box[0] + x), fill=(255, 0, 0))
    for y in range(0, H, step):
        d.line([(0, y), (W, y)], fill=(255, 0, 0), width=1)
        d.text((3, y + 3), str(box[1] + y), fill=(255, 0, 0))
    p = os.path.join(OUT, out)
    crop.save(p)
    print("saved", p, crop.size)
