# 港城地面：16 像素一格，四季风味各自一排。人物和狐不在这张图里。
# 不用商店里的农场整包；码头、滩、海风色是港城自己的格子。
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "harbor-world-pack"
OUT = PACK / "ground16.png"

# columns
# 0 grass  1 path  2 waterA  3 cliff  4 soil  5 tree  6 flower  7 tall
# 8 sand   9 dock  10 gate   11 waterB 12 grassB 13 grassC 14 reed 15 buoy

SEASONS = {
    "spring": {
        "g": (92, 168, 72), "gl": (150, 204, 92), "gd": (54, 122, 58),
        "flower": (232, 120, 150), "leaf": (64, 150, 70), "leafl": (140, 198, 90),
        "snow": None,
    },
    "summer": {
        "g": (62, 140, 58), "gl": (110, 176, 64), "gd": (36, 96, 42),
        "flower": (236, 196, 70), "leaf": (36, 112, 48), "leafl": (90, 160, 60),
        "snow": None,
    },
    "autumn": {
        "g": (128, 140, 62), "gl": (176, 150, 64), "gd": (86, 96, 40),
        "flower": (214, 112, 52), "leaf": (168, 96, 42), "leafl": (214, 150, 58),
        "snow": None,
    },
    "winter": {
        "g": (150, 166, 150), "gl": (214, 226, 220), "gd": (100, 116, 108),
        "flower": (186, 206, 214), "leaf": (70, 96, 84), "leafl": (180, 198, 190),
        "snow": (244, 248, 250),
    },
}


def blank():
    return [[None] * 16 for _ in range(16)]


def pix(g, x, y, c):
    if c and 0 <= x < 16 and 0 <= y < 16:
        g[y][x] = c + (255,)


def fill(g, x, y, w, h, c):
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            pix(g, xx, yy, c)


def to_im(g):
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = im.load()
    for y in range(16):
        for x in range(16):
            if g[y][x]:
                px[x, y] = g[y][x]
    return im


def grass(pal, kind):
    g = blank()
    fill(g, 0, 0, 16, 16, pal["g"])
    specks = [(2, 3), (7, 2), (12, 5), (4, 9), (10, 11), (14, 13), (6, 14), (11, 8)]
    if kind == 1:
        specks = [(3, 5), (8, 3), (13, 8), (5, 12), (1, 10), (9, 14)]
    if kind == 2:
        specks = [(1, 2), (6, 6), (14, 4), (8, 10), (3, 13), (12, 12)]
    for i, (x, y) in enumerate(specks):
        pix(g, x, y, pal["gl"] if i % 2 == 0 else pal["gd"])
    if pal["snow"]:
        pix(g, 4, 4, pal["snow"])
        pix(g, 5, 4, pal["snow"])
        pix(g, 11, 9, pal["snow"])
    if kind == 1:
        pix(g, 8, 7, pal["flower"])
        pix(g, 9, 7, pal["flower"])
        pix(g, 8, 8, pal["gd"])
    if kind == 2:
        pix(g, 5, 10, (140, 132, 118))
        pix(g, 6, 10, (168, 160, 146))
        pix(g, 5, 11, (110, 104, 94))
    return g


def path(pal):
    g = blank()
    fill(g, 0, 0, 16, 16, (186, 142, 86))
    for x, y in ((3, 4), (9, 6), (6, 11), (12, 12)):
        pix(g, x, y, (140, 100, 60))
        pix(g, x + 1, y, (214, 176, 120))
    if pal["snow"]:
        pix(g, 2, 2, pal["snow"])
        pix(g, 10, 3, pal["snow"])
    return g


def water(shift):
    g = blank()
    fill(g, 0, 0, 16, 16, (42, 126, 168))
    y = 3 + shift
    for x in range(16):
        pix(g, x, y, (168, 220, 228))
        pix(g, x, 12 if y < 10 else 6, (28, 92, 132))
    pix(g, 4 + shift, y, (42, 126, 168))
    return g


def cliff():
    g = blank()
    fill(g, 0, 0, 16, 16, (108, 100, 92))
    fill(g, 1, 1, 6, 6, (150, 140, 128))
    fill(g, 9, 1, 6, 6, (132, 122, 112))
    fill(g, 0, 9, 4, 6, (140, 130, 118))
    fill(g, 5, 9, 6, 6, (124, 114, 104))
    fill(g, 12, 9, 4, 6, (156, 146, 134))
    for x in range(16):
        pix(g, x, 8, (78, 70, 64))
        pix(g, x, 0, (78, 70, 64))
    return g


def soil(wet=False):
    g = blank()
    fill(g, 0, 0, 16, 16, (124, 78, 42) if not wet else (90, 58, 36))
    for y in (4, 9, 14):
        for x in range(16):
            pix(g, x, y, (72, 44, 26))
    return g


def tree(pal):
    g = blank()
    fill(g, 0, 12, 16, 4, pal["g"])
    for y in range(11, 15):
        pix(g, 7, y, (112, 72, 42))
        pix(g, 8, y, (78, 50, 30))
    for y in range(1, 11):
        for x in range(2, 14):
            if (x - 7.5) ** 2 / 28 + (y - 5) ** 2 / 16 <= 1:
                pix(g, x, y, pal["leafl"] if x < 6 and y < 5 else pal["leaf"])
    if pal["snow"]:
        pix(g, 5, 2, pal["snow"])
        pix(g, 6, 2, pal["snow"])
        pix(g, 7, 3, pal["snow"])
    return g


def flower(pal):
    g = grass(pal, 0)
    pix(g, 8, 6, pal["flower"])
    pix(g, 7, 7, pal["flower"])
    pix(g, 9, 7, pal["flower"])
    pix(g, 8, 8, (236, 200, 80))
    pix(g, 8, 9, pal["gd"])
    pix(g, 8, 10, pal["gd"])
    return g


def tall(pal):
    g = grass(pal, 0)
    for x in (3, 7, 11):
        for y in range(3, 14):
            pix(g, x, y, pal["gl"] if y % 2 == 0 else pal["gd"])
    return g


def sand(pal):
    g = blank()
    fill(g, 0, 0, 16, 16, (226, 204, 146))
    for x, y in ((2, 3), (8, 6), (13, 4), (5, 11), (11, 13)):
        pix(g, x, y, (196, 168, 108))
    if pal["snow"]:
        pix(g, 4, 8, pal["snow"])
    return g


def dock():
    g = blank()
    fill(g, 0, 0, 16, 16, (150, 102, 58))
    for x in range(16):
        if x % 4 == 3:
            for y in range(16):
                pix(g, x, y, (96, 62, 36))
        else:
            pix(g, x, 4, (186, 132, 74))
            pix(g, x, 12, (112, 74, 44))
    return g


def gate(pal):
    g = path(pal)
    for y in range(1, 14):
        pix(g, 1, y, (120, 74, 40))
        pix(g, 14, y, (96, 60, 34))
    for x in range(1, 15):
        pix(g, x, 2, (168, 116, 62))
    pix(g, 7, 8, (232, 186, 72))
    pix(g, 8, 8, (232, 186, 72))
    return g


def reed(pal):
    g = grass(pal, 0)
    pix(g, 4, 4, pal["leafl"])
    pix(g, 4, 5, pal["leaf"])
    pix(g, 4, 6, pal["gd"])
    pix(g, 11, 7, pal["leafl"])
    pix(g, 11, 8, pal["leaf"])
    return g


def buoy():
    g = water(1)
    pix(g, 7, 7, (214, 96, 64))
    pix(g, 8, 7, (214, 96, 64))
    pix(g, 7, 8, (244, 244, 238))
    pix(g, 8, 8, (244, 244, 238))
    return g


def main():
    sheet = Image.new("RGBA", (16 * 16, 4 * 16), (0, 0, 0, 0))
    order = ("spring", "summer", "autumn", "winter")
    for row, name in enumerate(order):
        pal = SEASONS[name]
        tiles = [
            grass(pal, 0),
            path(pal),
            water(0),
            cliff(),
            soil(False),
            tree(pal),
            flower(pal),
            tall(pal),
            sand(pal),
            dock(),
            gate(pal),
            water(4),
            grass(pal, 1),
            grass(pal, 2),
            reed(pal),
            buoy(),
        ]
        for col, tile in enumerate(tiles):
            sheet.paste(to_im(tile), (col * 16, row * 16))
    sheet.save(OUT)
    print(OUT, sheet.size)


if __name__ == "__main__":
    main()
