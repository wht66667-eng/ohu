#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
从用户提供的设计定稿里抠出可复用素材（透明底 PNG）。

设计图是「元素坐在海滩/海水上」的合成插画，背景同色系且有细节，
不能像纯白底立绘那样直接 flood。这里的做法：
  ① 精确裁剪框（坐标由 _grid/*.png 网格图目视标定）
  ② 多色域四边 flood 去背景
  ③ 只保留「质心居中」的最大连通域（丢掉四边残留的海面色块）
  ④ 闭运算收口 + 补内部小孔 + alpha 轻微羽化
  ⑤ 锚点扣减：去掉狐狸身上挂着的救生圈/玻璃球等异物

输出：public/sunny-fox/scene/
"""
import os
import sys
from collections import deque
from importlib import import_module

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
cut = import_module("fox-cutout")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(os.path.expanduser("~"), "Downloads")
OUT = os.path.join(ROOT, "public", "sunny-fox", "scene")

HOME = "校园服务首页·海洋狐狸风.png"
FOCUS = "专注计时与学习统计页·海洋狐狸风.png"
SVC = "服务列表页·海洋狐狸风.png"
TRIPLE = "海洋太阳狐狸App核心UI三屏.png"


def flood_bg(rgb, samples):
    """从四边 flood 出与边缘连通的背景。samples=[(rgb, tol), ...]"""
    arr = rgb.astype(np.int16)
    h, w, _ = arr.shape
    cand = np.zeros((h, w), dtype=bool)
    for center, t in samples:
        d = np.abs(arr - np.array(center, dtype=np.int16)).sum(axis=2)
        cand |= d <= t
    seen = np.zeros((h, w), dtype=bool)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if cand[y, x] and not seen[y, x]:
                seen[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if cand[y, x] and not seen[y, x]:
                seen[y, x] = True
                dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and cand[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                dq.append((ny, nx))
    return seen


def keep_central_largest(mask, cy_lo=0.05, cy_hi=0.95, cx_lo=0.05, cx_hi=0.95):
    """cut.components() 返回 [(size, [(y,x),...])]，已按面积降序。"""
    comps = cut.components(mask)
    if not comps:
        return mask
    h, w = mask.shape
    best = None
    for size, comp in comps:
        ys = np.fromiter((p[0] for p in comp), dtype=np.int32, count=size)
        xs = np.fromiter((p[1] for p in comp), dtype=np.int32, count=size)
        if cy_lo <= ys.mean() / h <= cy_hi and cx_lo <= xs.mean() / w <= cx_hi:
            best = comp
            break
    if best is None:
        best = comps[0][1]
    keep = np.zeros_like(mask)
    ys = np.fromiter((p[0] for p in best), dtype=np.int32, count=len(best))
    xs = np.fromiter((p[1] for p in best), dtype=np.int32, count=len(best))
    keep[ys, xs] = True
    return keep


def cut_element(img, samples, close_n=4, blur=0.5, central=True):
    rgb = np.array(img.convert("RGB"))
    bg = flood_bg(rgb, samples)
    fg = ~bg
    if close_n:
        fg = cut.close(fg, close_n)
    if central:
        fg = keep_central_largest(fg)
    fg = cut.fill_holes(fg)
    a = np.where(fg, 255.0, 0.0).astype(np.uint8)
    out = np.dstack([rgb, a]).astype(np.uint8)
    im = Image.fromarray(out, "RGBA")
    r, g, b, al = im.split()
    if blur:
        al = al.filter(ImageFilter.GaussianBlur(blur))
    return Image.merge("RGBA", (r, g, b, al))


def anchor_cut(img, anchors, tol=80):
    """把锚点所在「同色连通块」的 alpha 抹掉（去救生圈 / 玻璃球 / 速度线）。"""
    rgb = np.array(img.convert("RGB"))
    h, w, _ = rgb.shape
    a = np.array(img.split()[-1]).copy()
    for (ax, ay) in anchors:
        ax, ay = int(ax), int(ay)
        if not (0 <= ax < w and 0 <= ay < h) or a[ay, ax] < 60:
            continue
        center = rgb[ay, ax].astype(np.int16)
        similar = np.abs(rgb.astype(np.int16) - center).sum(axis=2) <= tol
        seen = np.zeros((h, w), dtype=bool)
        dq = deque([(ay, ax)])
        seen[ay, ax] = True
        while dq:
            y, x = dq.popleft()
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx] and similar[ny, nx] and a[ny, nx] > 60:
                    seen[ny, nx] = True
                    dq.append((ny, nx))
        a = np.where(seen, 0, a)
    arr = np.array(img)
    arr[:, :, 3] = a
    return Image.fromarray(arr, "RGBA")


def drop_small(img, min_area=140):
    """丢掉面积过小的碎屑连通域。"""
    a = np.array(img.split()[-1])
    m = a > 60
    keep = np.zeros_like(m)
    for size, comp in cut.components(m):
        if size < min_area:
            continue
        ys = np.fromiter((p[0] for p in comp), dtype=np.int32, count=size)
        xs = np.fromiter((p[1] for p in comp), dtype=np.int32, count=size)
        keep[ys, xs] = True
    arr = np.array(img)
    arr[:, :, 3] = np.where(keep, arr[:, :, 3], 0)
    return Image.fromarray(arr, "RGBA")


def save(img, name, size=None, pad=0.05):
    os.makedirs(OUT, exist_ok=True)
    if size:
        img = cut.to_square(img, size=size, pad=pad, baseline=False)
    p = os.path.join(OUT, name)
    img.save(p)
    print(f"  -> {name:26s} {img.size[0]}x{img.size[1]}  {os.path.getsize(p) // 1024}KB")


def src(fn, box):
    return Image.open(os.path.join(SRC, fn)).convert("RGB").crop(box)


# 海面/浪花色域（首页与三屏通用）
SEA_HOME = [((155, 232, 252), 95), ((200, 246, 254), 95), ((115, 208, 245), 90), ((255, 255, 255), 70)]
# 深海底色域（番茄钟页）—— 必须**收窄**：实测背景 (2,122,233)，
# 而水母 (101,213,254) 只差 ~150 的曼哈顿距离，tol 放到 100 会把水母一起吃掉。
SEA_DEEP = [((2, 122, 233), 70), ((16, 136, 236), 60)]
# 服务页（浅蓝天空 + 白）与三屏（浅蓝）
SEA_LIGHT = [((200, 240, 252), 90), ((150, 224, 250), 90), ((255, 255, 255), 65), ((215, 246, 254), 90)]


def cut_by_hue(img, keep_pred, close_n=3, blur=0.5, min_area=60, pad_px=3):
    """按「颜色谓词」直接选前景，不依赖四边 flood。

    关键：色相直选会丢掉元素内部与背景同色的像素（水母成空壳、小鱼只剩条纹）。
    所以流程必须是「色相选区 → 闭运算连成片 → 取最大连通域 → **fill_holes 填实**」
    —— 外轮廓一旦闭合，内部同色区就会被补回来。
    """
    rgb = np.array(img.convert("RGB"))
    fg = keep_pred(rgb.astype(np.int16))
    if close_n:
        fg = cut.close(fg, close_n)
    # 先取最大连通域（丢掉背景里的零星同色噪点）
    keep = np.zeros_like(fg)
    best = None
    for size, comp in cut.components(fg):
        if size < min_area:
            continue
        best = comp
        break
    if best is None:
        a = np.zeros(fg.shape, dtype=np.uint8)
    else:
        ys = np.fromiter((p[0] for p in best), dtype=np.int32, count=len(best))
        xs = np.fromiter((p[1] for p in best), dtype=np.int32, count=len(best))
        keep[ys, xs] = True
        keep = cut.fill_holes(keep)  # 填实内部
        if pad_px:
            keep = cut.dilate(keep, pad_px)  # 补回被闭运算削掉的边缘
        a = np.where(keep, 255.0, 0.0).astype(np.uint8)
    out = np.dstack([rgb, a]).astype(np.uint8)
    im = Image.fromarray(out, "RGBA")
    r, g, b, al = im.split()
    if blur:
        al = al.filter(ImageFilter.GaussianBlur(blur))
    return Image.merge("RGBA", (r, g, b, al))


def main():
    print("== 狐狸姿态 ==")

    # ① 首页挥手狐狸：裁掉救生圈（下半身），只留上半身 + 挥手
    el = cut_element(src(HOME, (445, 250, 1005, 700)), SEA_HOME, close_n=4)
    el = anchor_cut(el, [(510, 430), (560, 400)], tol=95)   # 蓝领巾附近的救生圈
    el = anchor_cut(el, [(470, 520), (600, 640), (480, 620)], tol=90)
    el = drop_small(el, 200)
    save(el, "fox-hero-wave.png", 768, 0.03)

    # ② 番茄钟探头狐狸（趴玻璃球上）：色域收窄后前面那团玻璃球/气泡会残留，
    #    用右侧锚点把「玻璃球高光带」和「白气泡」扣掉，只留狐狸 + 尾巴 + 黄色速度线
    el = cut_element(src(FOCUS, (495, 395, 925, 935)), SEA_DEEP, close_n=5)
    # 玻璃球边缘（左下大片半透明白蓝）
    el = anchor_cut(el, [(520, 780), (555, 850), (600, 900), (505, 730)], tol=110)
    el = anchor_cut(el, [(690, 430), (730, 470)], tol=95)  # 右上小气泡
    el = drop_small(el, 260)
    save(el, "fox-focus-peek.png", 768, 0.03)

    # ③ 服务页指路狐狸（向左上指）
    el = cut_element(src(SVC, (600, 70, 1060, 400)), SEA_LIGHT, close_n=4)
    el = drop_small(el, 150)
    save(el, "fox-svc-point.png", 512, 0.04)

    # ④ 小指路狐狸（服务页卡片内，从三屏里取更干净的）
    el = cut_element(src(SVC, (865, 470, 1010, 615)), SEA_LIGHT, close_n=3)
    el = drop_small(el, 80)
    save(el, "fox-mini-point.png", 256, 0.06)

    print("== 场景装饰 ==")

    # 帆船（首页右下 1020-1120 / 485-600）
    el = cut_element(src(HOME, (1010, 480, 1130, 615)), SEA_HOME, close_n=3)
    el = drop_small(el, 60)
    save(el, "deco-boat.png", 256, 0.05)

    # 灯塔 + 礁石（首页右上）：红白塔身 + 深灰礁石，用「非天空非海面」反向选
    el = cut_by_hue(
        src(HOME, (1005, 295, 1100, 470)),
        lambda a: ~(
            (a[:, :, 2] > 218) & (a[:, :, 1] > 222)  # 亮天空
            | ((a[:, :, 2] > 228) & (a[:, :, 0] < 95))  # 海面蓝
        ),
        close_n=4,
        min_area=250,
        pad_px=2,
    )
    save(el, "deco-lighthouse.png", 320, 0.04)

    # 大水母（番茄钟 190-295 / 475-565）：元素是亮青 (101,213,254)，背景是深蓝 (2,122,233)
    el = cut_by_hue(
        src(FOCUS, (185, 468, 300, 572)),
        lambda a: (a[:, :, 2] > 240) & (a[:, :, 1] > 175),  # 亮青/白
        close_n=3,
        min_area=200,
    )
    save(el, "deco-jelly.png", 256, 0.06)

    # 小水母（番茄钟 990-1070 / 845-905）
    el = cut_by_hue(
        src(FOCUS, (985, 838, 1075, 912)),
        lambda a: (a[:, :, 2] > 240) & (a[:, :, 1] > 175),
        close_n=3,
        min_area=120,
    )
    save(el, "deco-jelly-sm.png", 200, 0.06)

    # 小鱼（番茄钟右下，实测 x 1000-1105 / y 985-1065）：黄蓝条纹
    el = cut_by_hue(
        src(FOCUS, (995, 978, 1112, 1072)),
        lambda a: ((a[:, :, 0] > 195) & (a[:, :, 1] > 155) & (a[:, :, 2] < 175))  # 黄条纹
        | ((a[:, :, 2] > 225) & (a[:, :, 1] > 190) & (a[:, :, 0] < 160)),  # 亮青身
        close_n=5,
        min_area=200,
        pad_px=2,
    )
    save(el, "deco-fish.png", 256, 0.06)

    # 海星（番茄钟左下，黄色，y>1100 实测）
    el = cut_by_hue(
        src(FOCUS, (30, 1130, 200, 1290)),
        lambda a: (a[:, :, 0] > 190) & (a[:, :, 1] > 150) & (a[:, :, 2] < 160),
        close_n=5,
        min_area=250,
        pad_px=2,
    )
    save(el, "deco-star.png", 256, 0.06)

    # 珊瑚丛（番茄钟左下，实测 x 0-150 / y 1050-1200）
    el = cut_by_hue(
        src(FOCUS, (0, 1030, 165, 1210)),
        lambda a: (a[:, :, 0] > 175) & (a[:, :, 1] < 175) & (a[:, :, 2] < 155),
        close_n=5,
        min_area=300,
        pad_px=3,
    )
    save(el, "deco-coral.png", 320, 0.05)

    # 水草（番茄钟右下，青绿色）
    el = cut_by_hue(
        src(FOCUS, (1015, 1230, 1152, 1400)),
        lambda a: (a[:, :, 1] > 175) & (a[:, :, 0] < 170) & (a[:, :, 2] < 190),
        close_n=4,
        min_area=200,
        pad_px=2,
    )
    save(el, "deco-weed.png", 320, 0.05)

    print("\n[done] ->", OUT)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    main()
