# -*- coding: utf-8 -*-
"""Replace sun IP with fox in collage, cut out panels, export assets."""
from __future__ import annotations

from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps
from rembg import remove
from rembg.session_factory import new_session

ROOT = Path(r"C:\Users\upwar\Desktop\xm-main\design\collage-fox-replace")
DESK = Path(r"C:\Users\upwar\Desktop")
COLLAGE = DESK / "a_clean_cute_pastel_3d_illustration_collage_on.png"
FOX_AV = Path(r"C:\Users\upwar\.cursor\projects\C-Users-upwar\assets\fox-avatar-school.png")
FOX_EB = Path(r"C:\Users\upwar\.cursor\projects\C-Users-upwar\assets\fox-earbud-with-buds.png")
FOX_EB2 = Path(r"C:\Users\upwar\.cursor\projects\C-Users-upwar\assets\fox-earbud-clean.png")
FOX_LP = Path(r"C:\Users\upwar\.cursor\projects\C-Users-upwar\assets\fox-laptop-study.png")
PUB = Path(r"C:\Users\upwar\Desktop\xm-main\public\sunny-fox\collage")

OUT = ROOT / "cutouts"
OUT.mkdir(parents=True, exist_ok=True)
PUB.mkdir(parents=True, exist_ok=True)

SESSION = new_session("isnet-general-use")


def soft_cut(im: Image.Image) -> Image.Image:
    cut = remove(im.convert("RGBA"), session=SESSION).convert("RGBA")
    arr = np.array(cut)
    r, g, b, a = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]
    sheet = (r > 248) & (g > 248) & (b > 248)
    a2 = a.copy()
    a2[sheet] = 0
    alpha = Image.fromarray(a2, mode="L").filter(ImageFilter.GaussianBlur(0.5))
    out = arr.copy()
    out[:, :, 3] = np.array(alpha)
    return Image.fromarray(out, "RGBA")


def trim_alpha(im: Image.Image, pad: int = 4) -> Image.Image:
    im = im.convert("RGBA")
    bbox = im.getbbox()
    if not bbox:
        return im
    l, t, r, b = bbox
    l, t = max(0, l - pad), max(0, t - pad)
    r, b = min(im.width, r + pad), min(im.height, b + pad)
    return im.crop((l, t, r, b))


def circle_mask(size: int) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.ellipse((1, 1, size - 2, size - 2), fill=255)
    return m.filter(ImageFilter.GaussianBlur(0.8))


def cover_into_circle(src: Image.Image, diameter: int, zoom: float = 1.15) -> Image.Image:
    """Fit subject into circular RGBA canvas."""
    cut = soft_cut(src)
    cut = trim_alpha(cut, 2)
    # prefer subject-only if rembg worked; else use full
    w, h = cut.size
    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(cut, ((side - w) // 2, (side - h) // 2), cut)
    # zoom toward face
    nw = int(side / zoom)
    left = (side - nw) // 2
    top = max(0, (side - nw) // 2 - side // 20)
    cropped = canvas.crop((left, top, left + nw, top + nw)).resize(
        (diameter, diameter), Image.Resampling.LANCZOS
    )
    mask = circle_mask(diameter)
    out = Image.new("RGBA", (diameter, diameter), (0, 0, 0, 0))
    out.paste(cropped, (0, 0), mask)
    return out


def paste_soft(base: Image.Image, overlay: Image.Image, xy: tuple[int, int], feather: int = 2):
    x, y = xy
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    layer.paste(overlay, (x, y), overlay)
    if feather:
        a = layer.split()[-1].filter(ImageFilter.GaussianBlur(feather * 0.3))
        layer.putalpha(a)
    return Image.alpha_composite(base.convert("RGBA"), layer)


def main():
    base = Image.open(COLLAGE).convert("RGBA")
    W, H = base.size
    print("collage", W, H)

    # --- 1) Replace sun avatar circle ---
    # Detected bbox ~ (387,91)-(606,261); expand slightly for green ring
    ax0, ay0, ax1, ay1 = 378, 72, 618, 278
    diam = min(ax1 - ax0, ay1 - ay0)
    cx = (ax0 + ax1) // 2
    cy = (ay0 + ay1) // 2
    fox_av = cover_into_circle(Image.open(FOX_AV), diam, zoom=1.08)
    # soft mint fill behind fox to match neighbor
    disk = Image.new("RGBA", (diam, diam), (0, 0, 0, 0))
    d = ImageDraw.Draw(disk)
    d.ellipse((0, 0, diam - 1, diam - 1), fill=(210, 235, 215, 255))
    # green ring
    ring = Image.new("RGBA", (diam, diam), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    rd.ellipse((0, 0, diam - 1, diam - 1), outline=(70, 140, 85, 255), width=max(3, diam // 40))
    av_comp = Image.alpha_composite(disk, fox_av)
    av_comp = Image.alpha_composite(av_comp, ring)
    px, py = cx - diam // 2, cy - diam // 2
    # erase old sun with circular mask then paste
    erase = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ed = ImageDraw.Draw(erase)
    ed.ellipse((px, py, px + diam, py + diam), fill=(232, 242, 232, 255))
    base = Image.alpha_composite(base, erase)
    base = paste_soft(base, av_comp, (px, py))
    av_comp.save(OUT / "01-fox-avatar-circle.png")
    print("avatar replaced", px, py, diam)

    # --- 2) Replace earbud sun with fox ---
    # Earbud case ~ (300,850)-(560,1024)
    ex0, ey0, ex1, ey1 = 305, 855, 555, 1020
    ew, eh = ex1 - ex0, ey1 - ey0
    eb_src = FOX_EB if FOX_EB.exists() else FOX_EB2
    eb_cut = soft_cut(Image.open(eb_src))
    eb_cut = trim_alpha(eb_cut, 2)
    # fit into box keeping aspect
    scale = min(ew / eb_cut.width, eh / eb_cut.height) * 1.05
    nw, nh = max(1, int(eb_cut.width * scale)), max(1, int(eb_cut.height * scale))
    eb_r = eb_cut.resize((nw, nh), Image.Resampling.LANCZOS)
    # soft cover old region with nearby bg sample
    patch = base.crop((ex0 - 30, ey0 - 20, ex0, ey0 + 40)).resize((ew, eh), Image.Resampling.BILINEAR)
    patch = patch.filter(ImageFilter.GaussianBlur(8))
    # feathered patch
    pm = Image.new("L", (ew, eh), 0)
    ImageDraw.Draw(pm).rounded_rectangle((0, 0, ew - 1, eh - 1), radius=28, fill=255)
    pm = pm.filter(ImageFilter.GaussianBlur(4))
    region = Image.new("RGBA", base.size, (0, 0, 0, 0))
    region.paste(patch.convert("RGBA"), (ex0, ey0), pm)
    base = Image.alpha_composite(base, region)
    ebx = ex0 + (ew - nw) // 2
    eby = ey0 + (eh - nh) // 2
    base = paste_soft(base, eb_r, (ebx, eby), feather=1)
    eb_r.save(OUT / "02-fox-earbud-case.png")
    print("earbud replaced", ebx, eby, nw, nh)

    # --- 3) Save replaced collage ---
    final_rgb = base.convert("RGB")
    final_path = DESK / "狐狸拼贴_阳光已替换.png"
    final_rgb.save(final_path, quality=95)
    final_rgb.save(ROOT / "collage-fox-replaced.png", quality=95)
    print("saved", final_path)

    # --- 4) Cut out major panels from replaced collage ---
    panels = {
        "avatar-boy": (40, 40, 320, 300),
        "avatar-fox": (px - 8, py - 8, px + diam + 8, py + diam + 8),
        "splash-loading": (700, 20, 1520, 380),
        "mood-grid": (40, 300, 700, 780),
        "fox-standing": (720, 360, 980, 700),
        "app-icon-square": (980, 380, 1200, 620),
        "sleep-books": (1180, 300, 1520, 620),
        "meal-pavilion": (40, 760, 360, 1020),
        "earbud-fox": (ex0 - 10, ey0 - 20, ex1 + 10, min(H, ey1 + 4)),
        "scooter": (540, 760, 900, 1020),
        "laptop": (900, 720, 1280, 1020),
        "sports-bento": (1240, 680, 1520, 1020),
    }
    for name, box in panels.items():
        x0, y0, x1, y1 = [int(v) for v in box]
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(W, x1), min(H, y1)
        cell = base.crop((x0, y0, x1, y1))
        cell.convert("RGB").save(OUT / f"panel-{name}-src.png")
        try:
            cut = soft_cut(cell)
            cut = trim_alpha(cut, 3)
            cut.save(OUT / f"panel-{name}.png")
            print("cut", name, cut.size)
        except Exception as e:
            print("cut fail", name, e)

    # --- 5) Also export generated standalone assets (cut) ---
    extras = {
        "gen-fox-avatar": FOX_AV,
        "gen-fox-earbud": eb_src,
        "gen-fox-laptop": FOX_LP,
    }
    for key, path in extras.items():
        if not path.exists():
            continue
        cut = trim_alpha(soft_cut(Image.open(path)), 4)
        cut.save(OUT / f"{key}.png")
        cut.save(PUB / f"{key}.png")
        print("extra", key, cut.size)

    # copy key cutouts to public
    for f in OUT.glob("panel-*.png"):
        if "-src" not in f.name:
            f.replace  # noqa
            dest = PUB / f.name
            Image.open(f).save(dest)
    Image.open(OUT / "01-fox-avatar-circle.png").save(PUB / "fox-avatar-circle.png")
    Image.open(OUT / "02-fox-earbud-case.png").save(PUB / "fox-earbud-case.png")
    final_rgb.save(PUB / "collage-fox-replaced.png", quality=92)
    print("done ->", OUT)
    print("public ->", PUB)


if __name__ == "__main__":
    main()
