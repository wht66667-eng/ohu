"""补充测量：玻璃卡边界 + 全图金色分布 + 关键行剖面。"""
from PIL import Image
import numpy as np
from scipy import ndimage

p = r'C:\Users\upwar\.workbuddy\clipboard-images\clipboard-2026-09-29T12-43-52-200Z-6b1c9c88.jpg'
im = np.asarray(Image.open(p)).astype(int)
h, w, _ = im.shape
r, g, b = im[..., 0], im[..., 1], im[..., 2]

# 全图金色（含暗金）连通域
gold = (r > 170) & (g > 120) & (g < 225) & (b < 150) & (r > b + 60)
lab, n = ndimage.label(gold)
out = []
for i in range(1, n + 1):
    ys, xs = np.nonzero(lab == i)
    if len(xs) < 40:
        continue
    out.append((len(xs), xs.min(), xs.max(), ys.min(), ys.max()))
out.sort(reverse=True)
print('== all gold comps:', len(out))
for n_, x0, x1, y0, y1 in out[:25]:
    print(f'   n={n_:<6} x {x0}-{x1}  y {y0}-{y1}  w={x1-x0+1} h={y1-y0+1}')

# 顶部两个玻璃卡：亮度比水背景高的带
lum = im.mean(axis=2)
bandmask = (lum > 150) & (b > 200)
rows = bandmask[:, 40:1040].mean(axis=1)
print('== band rows (frac>0.5):')
cur = None
for y in range(60, 700):
    if rows[y] > 0.5 and cur is None:
        cur = y
    elif rows[y] <= 0.5 and cur is not None:
        print(f'   y {cur}-{y}')
        cur = None
if cur is not None:
    print(f'   y {cur}-700')

# 卡内竖向分界（左卡|右卡）：在 y=200 行找暗缝
y = 210
row = lum[y, 60:1020]
segs = []
inside = False
for i, v in enumerate(row):
    if v > 140 and not inside:
        inside = True; s = i + 60
    elif v <= 140 and inside:
        inside = False; segs.append((s, i + 60))
if inside:
    segs.append((s, 1020))
print('y=210 card x-segs:', segs)

# 环：亮青边缘，估圆心
ringm = (b > 225) & (g > 205) & (r > 140) & (r < 220)
ys, xs = np.nonzero(ringm[600:1460, :])
ys = ys + 600
cx = float(xs.mean()); cy = float(ys.mean())
print(f'ring centroid ({cx:.0f},{cy:.0f}) n={len(xs)}')
# 用左右/上下极值
print('ring x range', xs.min(), xs.max(), 'y range', ys.min(), ys.max())

# 预设三按钮：在预设卡行带内找按钮边缘（y=1500 亮度 >170 的连续段，按 >30px 宽度过滤）
for y in (1470, 1500, 1530):
    row = lum[y]
    segs = []
    inside = False
    for x in range(20, 1060):
        if row[x] > 172 and not inside:
            inside = True; s = x
        elif row[x] <= 172 and inside:
            inside = False
            if x - s > 28:
                segs.append((s, x))
    if inside:
        segs.append((s, 1060))
    print(f'y={y} btn segs:', segs)

# 开始按钮上下缘：中心列 x=540 的亮度
col = lum[:, 540]
segs = []
inside = False
for y in range(1550, 1900):
    if col[y] > 190 and not inside:
        inside = True; s = y
    elif col[y] <= 190 and inside:
        inside = False; segs.append((s, y))
if inside:
    segs.append((s, 1900))
print('start btn y-segs @x=540:', segs)
