"""小狐狸抠图工具（纯 numpy/PIL 确定性算法，不依赖 AI 模型）。

产出：
  public/sunny-fox/fox-only/   —— 12 张纯狐狸表情（透明底，背景色交给 CSS）
  public/sunny-fox/mascot/     —— 全身立绘（透明底）

设计依据（实测）：
  * 锚点图（1ae3902b）：整张 **纯白底**，狐狸 + 太阳 + 海浪都是主体。
    立绘只需白底透明化即可，不需要 AI 抠图。
  * 变脸合集（843e93ae）：1920×1920，4 列 × 3 行卡片，白色网格缝。
    每格背景是复杂渐变（蓝/紫/红/橙），背景色 = 情绪信息，App 内交给 CSS 还原。
    因此只抠「狐狸本体」：狐狸色域 = 橙黄 + 白奶油 + 深棕 + 黑色眼镜。

用法（务必 unset 代理，走直连）：
  unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
  python tools/fox-cutout.py anchor
  python tools/fox-cutout.py faces
  python tools/fox-cutout.py all
"""
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLIP = r"C:\Users\upwar\.workbuddy\clipboard-images"
OUT_FOX = os.path.join(ROOT, "public", "sunny-fox", "fox-only")
OUT_MASCOT = os.path.join(ROOT, "public", "sunny-fox", "mascot")

ANCHOR_IMG = "clipboard-2026-09-29T10-29-25-325Z-1ae3902b.jpg"
FACES_IMG = "clipboard-2026-09-29T10-29-25-330Z-843e93ae.jpg"

# 变脸合集网格（由白缝探测得到，实测值）
COLS = [(32, 472), (504, 944), (977, 1417), (1445, 1892)]
ROWS = [(54, 607), (647, 1226), (1267, 1849)]


def load(name):
    return Image.open(os.path.join(CLIP, name)).convert("RGB")


# ---------------------------------------------------------------- 基础形态学

def _neighbors(m):
    g = m.copy()
    g[1:, :] |= m[:-1, :]
    g[:-1, :] |= m[1:, :]
    g[:, 1:] |= m[:, :-1]
    g[:, :-1] |= m[:, 1:]
    return g


def dilate(m, n=1):
    for _ in range(n):
        m = _neighbors(m)
    return m


def erode(m, n=1):
    for _ in range(n):
        m = ~_neighbors(~m)
    return m


def close(m, n=2):
    """闭运算：填掉细小断裂，让尾巴/嘴部与躯干重新连成一体。"""
    return erode(dilate(m, n), n)


def components(mask):
    """4 邻接连通域，返回 [(size, [(y,x), ...])]，按面积降序。"""
    h, w = mask.shape
    seen = np.zeros((h, w), dtype=bool)
    out = []
    ys, xs = np.where(mask)
    for y0, x0 in zip(ys, xs):
        if seen[y0, x0]:
            continue
        comp = []
        dq = deque([(y0, x0)])
        seen[y0, x0] = True
        while dq:
            y, x = dq.popleft()
            comp.append((y, x))
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    dq.append((ny, nx))
        out.append((len(comp), comp))
    out.sort(key=lambda t: -t[0])
    return out


def fill_holes(mask):
    """把 mask 内部被包围的小孔补上（不碰外部背景）。"""
    h, w = mask.shape
    bg = ~mask
    outside = np.zeros((h, w), dtype=bool)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if bg[y, x] and not outside[y, x]:
                outside[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if bg[y, x] and not outside[y, x]:
                outside[y, x] = True
                dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and bg[ny, nx] and not outside[ny, nx]:
                outside[ny, nx] = True
                dq.append((ny, nx))
    return mask | (bg & ~outside)


# ---------------------------------------------------------------- 色域工具

def hsv(arr):
    """arr: (H,W,3) uint8 -> h(0-360) s(0-1) v(0-1) float32。"""
    x = arr.astype(np.float32) / 255.0
    r, g, b = x[:, :, 0], x[:, :, 1], x[:, :, 2]
    mx = x.max(axis=2)
    mn = x.min(axis=2)
    d = mx - mn
    v = mx
    s = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0)
    hh = np.zeros_like(mx)
    m = d > 1e-6
    rr = m & (mx == r)
    gg = m & (mx == g) & ~rr
    bb = m & (mx == b) & ~rr & ~gg
    hh[rr] = ((g - b) / np.maximum(d, 1e-6))[rr] % 6
    hh[gg] = ((b - r) / np.maximum(d, 1e-6))[gg] + 2
    hh[bb] = ((r - g) / np.maximum(d, 1e-6))[bb] + 4
    return (hh * 60) % 360, s, v


_session = None


def session():
    """懒加载 rembg 会话。模型缺失时抛错并提示手动下载。"""
    global _session
    if _session is None:
        from rembg import new_session
        _session = new_session("isnet-general-use")
    return _session


def ai_mask(img, th=60):
    """用 rembg（isnet-general-use）得到前景 mask。

    阈值取 60（而非 110）：isnet 对狐狸身上的浅灰阴影会给中等 alpha，
    阈值太高会把阴影判成背景，在胸口/脸下留下灰斑。
    """
    from rembg import remove
    out = remove(img, session=session())
    return np.array(out)[:, :, 3] > th


def fox_color_mask(rgb, loose=False):
    """狐狸本体色域：橙黄 / 白奶油 / 深棕脚 / 黑眼镜。

    背景（蓝 190-260、紫 260-300、红 330-20）一律排除；
    橙色背景（20-45）靠后续「四边 flood-fill + 最大连通域」兜掉。
    """
    h, s, v = hsv(rgb)
    orange = (h >= 12) & (h <= 52) & (s >= 0.28) & (v >= 0.35)   # 橙/黄毛
    cream = (v >= 0.80) & (s <= 0.26) if not loose else (v >= 0.78) & (s <= 0.32)
    dark = (v <= 0.42) & (s <= 0.55)                              # 深棕手脚
    black = (v <= 0.30)                                           # 眼镜框
    return orange | cream | dark | black


# ---------------------------------------------------------------- 白底抠图（锚点图）

def cut_white_bg(img, sat_max=18, mn_min=246):
    """纯白底 -> 透明。返回 RGBA。

    实测锚点图背景为纯 254 白、饱和度 0；狐狸身上的浅色区（胸口/耳内/沙地）
    色相饱和度差异明显。但**胸口奶油白与背景同为高亮低饱和**，直接 flood
    会顺着边界渗进狐狸体内（表现为大片半透明灰斑）。

    加固手段：把「任何有色彩的像素 + 其 3px 扩散带」设为围栏，
    flood 不可穿越围栏，因此渗漏被物理阻断。
    """
    arr = np.array(img.convert("RGB")).astype(np.float32)
    mx = arr.max(axis=2)
    mn = arr.min(axis=2)
    sat = mx - mn

    white = (mn >= mn_min) & (sat <= sat_max)
    fence = sat > sat_max          # 有色彩 = 围栏
    fence = dilate(fence, 4)       # 围栏加厚，堵住 1-3px 的渗漏缝
    passable = white & ~fence

    h, w = white.shape
    bg = np.zeros((h, w), dtype=bool)
    dq = deque()
    for x in range(w):
        for y in (1, h - 2):
            if passable[y, x] and not bg[y, x]:
                bg[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (1, w - 2):
            if passable[y, x] and not bg[y, x]:
                bg[y, x] = True
                dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and passable[ny, nx] and not bg[ny, nx]:
                bg[ny, nx] = True
                dq.append((ny, nx))

    # 注意：绝不能做「bg 向外扩张」。狐狸身上的胸口/耳内/救生圈条纹
    # 与背景同为高亮低饱和白，一旦允许扩张就会把它们吞成灰斑。
    a = np.where(bg, 0.0, 255.0).astype(np.float32)
    out = np.dstack([arr, a]).astype(np.uint8)
    img2 = Image.fromarray(out, "RGBA")
    r, g, b, al = img2.split()
    al = al.filter(ImageFilter.GaussianBlur(0.7))
    return Image.merge("RGBA", (r, g, b, al))


# ---------------------------------------------------------------- 色域抠图（变脸图）

def _touches_border(comp, h, w, margin=2):
    ys = np.fromiter((p[0] for p in comp), dtype=np.int32, count=len(comp))
    xs = np.fromiter((p[1] for p in comp), dtype=np.int32, count=len(comp))
    return ys.min() <= margin or xs.min() <= margin or ys.max() >= h - margin - 1 or xs.max() >= w - margin - 1


def cut_face(tile):
    """从变脸卡片里抠出狐狸，输出 RGBA。

    12 格实测分两类，必须走两条路：

    A 类（rembg 完美分离）：streak_1/3/7/14、away_2、away_20
       主连通域 100% 且**不接触卡片外边框**。走 rembg。
    B 类（rembg 把狐狸和背景糊成一整块）：away_5/8/12/15/25/30
       狐狸坐在沙滩/海水上，身体与背景装饰连成一片，主块触边。
       这类背景是红/紫/橙红渐晕，与狐狸的橙黄毛色可分离，改用色域法。

    判别规则：rembg 主连通域若触边 -> 判为 B 类，切换色域法。
    """
    h, w = tile.size[1], tile.size[0]
    rgb = np.array(tile.convert("RGB"))
    m = ai_mask(tile)

    solid = close(m, 6)
    comps = components(solid)
    if not comps:
        return Image.fromarray(np.dstack([rgb, np.zeros((h, w), np.uint8)]), "RGBA")

    use_ai = not _touches_border(comps[0][1], h, w)
    if use_ai:
        n, best = comps[0]
        mask = np.zeros((h, w), dtype=bool)
        ys = np.fromiter((p[0] for p in best), dtype=np.int32, count=n)
        xs = np.fromiter((p[1] for p in best), dtype=np.int32, count=n)
        mask[ys, xs] = True
        mask = mask & m
        hull = fill_holes(close(mask, 12))
        mask = mask | (hull & m)
        recovered = hull & fox_color_mask(rgb, loose=True) & ~mask
        if recovered.any():
            mask = mask | recovered
    else:
        mask = _cut_by_color(rgb)

    # 扣 UI 锚点带（放在所有形态学之后）
    mask[: int(h * 0.035), :] = False
    mask[int(h * 0.90):, :] = False
    mask[: int(h * 0.20), : int(w * 0.30)] = False
    mask[: int(h * 0.20), int(w * 0.70):] = False

    mask = fill_holes(mask)
    mask = erode(mask, 1)

    a = np.where(mask, 255, 0).astype(np.float32)
    im = Image.fromarray(np.dstack([rgb.astype(np.float32), a]).astype(np.uint8), "RGBA")
    r, g, b, al = im.split()
    al = al.filter(ImageFilter.GaussianBlur(0.7))
    al = al.point(lambda p: 0 if p < 90 else (255 if p > 200 else p))
    return Image.merge("RGBA", (r, g, b, al))


def _cut_by_color(rgb):
    """色域法：狐狸橙黄/奶白/深棕/黑框 vs 红紫蓝背景。

    配合「四边 flood 掉外部背景」+「只保留质心落在画面中带的连通域」。
    """
    h, w, _ = rgb.shape
    fg = fox_color_mask(rgb)

    # 四边 flood 掉连通外部的非狐狸色
    bg = ~fg
    reached = np.zeros((h, w), dtype=bool)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if bg[y, x] and not reached[y, x]:
                reached[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if bg[y, x] and not reached[y, x]:
                reached[y, x] = True
                dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and bg[ny, nx] and not reached[ny, nx]:
                reached[ny, nx] = True
                dq.append((ny, nx))
    fg = fg & ~reached

    solid = close(fg, 5)
    comps = components(solid)
    if not comps:
        return np.zeros((h, w), dtype=bool)

    biggest = comps[0][0]
    mask = np.zeros((h, w), dtype=bool)
    for n, comp in comps:
        if n < biggest * 0.25:
            break
        ys = np.fromiter((p[0] for p in comp), dtype=np.int32, count=n)
        xs = np.fromiter((p[1] for p in comp), dtype=np.int32, count=n)
        cy, cx = ys.mean() / h, xs.mean() / w
        # 狐狸质心始终在中带
        if 0.25 <= cy <= 0.90 and 0.20 <= cx <= 0.85:
            mask[ys, xs] = True

    if not mask.any():
        n, comp = comps[0]
        ys = np.fromiter((p[0] for p in comp), dtype=np.int32, count=n)
        xs = np.fromiter((p[1] for p in comp), dtype=np.int32, count=n)
        mask[ys, xs] = True
    return mask


# ---------------------------------------------------------------- 后处理

def keep_largest_blob(img, bridge=6):
    arr = np.array(img.convert("RGBA"))
    mask = arr[:, :, 3] > 60
    solid = close(mask, bridge)
    comps = components(solid)
    if not comps:
        return img
    m = np.zeros(mask.shape, dtype=bool)
    _, best = comps[0]
    ys = np.fromiter((p[0] for p in best), dtype=np.int32, count=len(best))
    xs = np.fromiter((p[1] for p in best), dtype=np.int32, count=len(best))
    m[ys, xs] = True
    arr[:, :, 3] = np.where(m, arr[:, :, 3], 0)
    return Image.fromarray(arr, "RGBA")


def kill_halo(img, strength=0.45):
    """消白边：亮且低饱和的贴边像素削 alpha。"""
    arr = np.array(img.convert("RGBA")).astype(np.float32)
    rgb = arr[:, :, :3]
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    halo = (mx > 200) & ((mx - mn) < 60)
    arr[:, :, 3] = np.where(halo, arr[:, :, 3] * strength, arr[:, :, 3])
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def crop_alpha_box(img, th=12):
    a = np.array(img)[:, :, 3]
    ys, xs = np.where(a > th)
    if len(xs) == 0:
        return img
    return img.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def trim_bottom_bar(img, top=0.80, min_w=0.72, min_rows=25):
    """切掉底部与狐狸粘连的台词条胶囊。

    为什么不能用「宽度突增」判据：实测（away_5, h=580）宽度从 y=462 的
    340 平滑爬到 y=482 的 429，没有台阶——因为狐狸的沙色底座与台词条的
    浅沙色是连续渐变的。

    改用「结构判据」：台词条是一条**横贯整卡、纵向连续**的实心带。
    自底向上扫描，找最上方那条「宽度 >= min_w 且连续 >= min_rows 行」的
    带状区，把它的顶边以上全部保留、以下清空。
    """
    a = np.array(img.convert("RGBA"))[:, :, 3] > 100
    h, w = a.shape
    widths = a.sum(axis=1)
    band = widths >= w * min_w
    y = int(h * top)
    if not band[y:].any():
        return img
    # 找 band 区段中「顶部最早出现」的位置，并要求其下方连续
    cut = h
    run = 0
    for yy in range(int(h * top), h):
        if band[yy]:
            run += 1
            if run >= min_rows and cut == h:
                cut = yy - run + 1
        else:
            run = 0
    if cut >= h:
        return img
    out = np.array(img.convert("RGBA"))
    out[cut:, :, 3] = 0
    return Image.fromarray(out, "RGBA")


def norm_face(img, size=512, target_h=0.88, pad=0.06):
    """把表情图归一到统一尺寸并**按高度对齐**。

    12 格原图里狐狸的取景范围不一致（有的只有头，有的连肩）。
    统一按「前景高度占画布 target_h」缩放，再用质心水平居中、
    底边贴住安全线，这样在 App 里切换表情时画面不会跳动。
    """
    img = crop_alpha_box(img)
    w, h = img.size
    if w == 0 or h == 0:
        return Image.new("RGBA", (size, size), (0, 0, 0, 0))

    inner = size * (1 - pad * 2)
    s = inner * target_h / h
    nw, nh = max(1, int(round(w * s))), max(1, int(round(h * s)))
    small = tighten_alpha(img.resize((nw, nh), Image.LANCZOS))

    a = np.array(small)[:, :, 3]
    ys, xs = np.where(a > 100)
    cx = int(xs.mean()) if len(xs) else nw // 2

    canvas = np.zeros((size, size, 4), dtype=np.uint8)
    x = int(round(size / 2 - cx))
    y = int(round(size - pad * size - nh))
    x = max(-nw + 1, min(size - 1, x))
    y = max(-nh + 1, min(size - 1, y))

    sx0, sx1 = max(0, -x), min(nw, size - x)
    sy0, sy1 = max(0, -y), min(nh, size - y)
    dx0, dy0 = x + sx0, y + sy0
    if sx1 > sx0 and sy1 > sy0:
        canvas[dy0:dy0 + (sy1 - sy0), dx0:dx0 + (sx1 - sx0)] = \
            np.array(small)[sy0:sy1, sx0:sx1]
    return Image.fromarray(canvas, "RGBA")


def tighten_alpha(img, lo=40, hi=210):
    """压掉 LANCZOS 缩放产生的中间 alpha，避免合成时与黑底混出灰边。

    只在「缩放之后」调用；对原始二值轮廓无影响。
    """
    arr = np.array(img.convert("RGBA")).astype(np.float32)
    a = arr[:, :, 3]
    t = np.clip((a - lo) / max(1.0, hi - lo), 0, 1)
    arr[:, :, 3] = t * 255.0
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def to_square(img, size=512, pad=0.10, baseline=False):
    """缩放进正方形并留安全边距，保证圆裁后耳朵完整。

    关键：**不用 PIL 的 mask-paste**。paste 的蒙版合成公式
    dst*(1-a) + src*a 会让半透明像素与透明画布的 (0,0,0,0) 混合，
    把浅色区压暗成灰斑。这里改为直接用 numpy 搬运 RGBA 四通道。
    """
    w, h = img.size
    inner = int(size * (1 - pad * 2))
    s = min(inner / w, inner / h)
    nw, nh = max(1, int(round(w * s))), max(1, int(round(h * s)))
    small = img.resize((nw, nh), Image.LANCZOS)
    small = tighten_alpha(small)          # 硬化半透明，杜绝灰边

    canvas = np.zeros((size, size, 4), dtype=np.uint8)
    x = (size - nw) // 2
    y = size - nh - int(size * pad) if baseline else (size - nh) // 2
    canvas[y:y + nh, x:x + nw] = np.array(small)
    return Image.fromarray(canvas, "RGBA")


# ---------------------------------------------------------------- 任务

def do_anchor():
    os.makedirs(OUT_MASCOT, exist_ok=True)
    img = load(ANCHOR_IMG)
    W, H = img.size
    print("anchor source", img.size)

    # 左 2/3 只取立绘（右边是 App 图标），纯白底透明化
    body = img.crop((0, 0, int(W * 0.615), H))
    q = cut_white_bg(body)
    q = keep_largest_blob(q, bridge=5)
    q = kill_halo(q, 0.5)
    q = crop_alpha_box(q)
    q = to_square(q, 768, 0.05, baseline=True)
    p = os.path.join(OUT_MASCOT, "sunny-fox-fullbody-v2.png")
    q.save(p)
    print("  fullbody ->", q.size, os.path.getsize(p) // 1024, "KB")

    # 右下角 App 图标（保留满幅方底）
    icon = img.crop((int(W * 0.615), int(H * 0.53), W, int(H * 0.98)))
    ip = os.path.join(OUT_MASCOT, "sunny-fox-appicon-v2.png")
    icon.save(ip)
    print("  appicon  ->", icon.size, os.path.getsize(ip) // 1024, "KB")


def do_faces():
    os.makedirs(OUT_FOX, exist_ok=True)
    img = load(FACES_IMG)
    print("faces source", img.size)

    order = [
        ["streak_1", "streak_3", "streak_7", "streak_14"],
        ["away_2", "away_5", "away_8", "away_12"],
        ["away_15", "away_20", "away_25", "away_30"],
    ]
    total = 0
    for r, row in enumerate(order):
        y0, y1 = ROWS[r]
        for c, key in enumerate(row):
            x0, x1 = COLS[c]
            tile = img.crop((x0, y0, x1 + 1, y1 + 1))
            face = cut_face(tile)
            face = trim_bottom_bar(face)
            face = kill_halo(face, 0.4)
            face = norm_face(face, 512)
            p = os.path.join(OUT_FOX, f"icon-{key}-fox.png")
            face.save(p)
            kb = os.path.getsize(p) // 1024
            total += kb
            print(" ", key, "->", face.size, kb, "KB")
    print("faces total", total, "KB")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    if mode in ("anchor", "all"):
        do_anchor()
    if mode in ("faces", "all"):
        do_faces()
