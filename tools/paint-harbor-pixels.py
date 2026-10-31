# 港城四季原创像素包。16 像素一格，最近邻放大到 32。
# 人物高两格，脚落在站立格里。只用港城自己的人和地，不裁游戏原图。
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "harbor-world-pack"
TILE = 16
SCALE = 2

INK = (42, 28, 32, 255)
SKIN = (242, 204, 166, 255)
SKIN_D = (206, 154, 116, 255)
EYE = (36, 24, 28, 255)
MOUTH = (176, 96, 92, 255)

GRASS = (86, 152, 62, 255)
GRASS_L = (124, 184, 78, 255)
GRASS_D = (54, 112, 48, 255)
BLADE = (168, 196, 72, 255)
PATH = (196, 156, 98, 255)
PATH_D = (156, 118, 70, 255)
PATH_L = (220, 188, 132, 255)
WATER = (48, 124, 168, 255)
WATER_D = (32, 92, 140, 255)
WATER_L = (168, 220, 228, 255)
SOIL = (132, 84, 46, 255)
SOIL_D = (86, 52, 28, 255)
SOIL_L = (164, 112, 64, 255)
LEAF = (46, 118, 54, 255)
LEAF_L = (92, 160, 72, 255)
LEAF_D = (28, 78, 40, 255)
TRUNK = (112, 72, 42, 255)
TRUNK_D = (74, 46, 28, 255)
SAND = (226, 204, 146, 255)
SAND_D = (196, 168, 108, 255)
SAND_L = (240, 226, 186, 255)
WOOD = (148, 96, 52, 255)
WOOD_D = (96, 62, 34, 255)
WOOD_L = (186, 132, 74, 255)
STONE = (132, 118, 104, 255)
STONE_L = (168, 154, 136, 255)
STONE_D = (90, 78, 68, 255)
MORTAR = (78, 68, 60, 255)
GOLD = (232, 186, 72, 255)
TEAL = (54, 148, 146, 255)
FOX = (214, 118, 58, 255)
FOX_D = (166, 78, 40, 255)
FOX_E = (42, 30, 28, 255)
FOX_EYE = (168, 92, 28, 255)
CREAM = (248, 232, 210, 255)
WHITE = (246, 246, 242, 255)
PINK = (214, 96, 112, 255)


def blank(w, h):
    return [[None] * w for _ in range(h)]


def fill(g, x, y, w, h, c):
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            if 0 <= xx < len(g[0]) and 0 <= yy < len(g):
                g[yy][xx] = c


def pix(g, x, y, c):
    if g and 0 <= x < len(g[0]) and 0 <= y < len(g):
        g[y][x] = c


def outline(g):
    h, w = len(g), len(g[0])
    out = [row[:] for row in g]
    for y in range(h):
        for x in range(w):
            if g[y][x] is None:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and out[ny][nx] is None:
                    out[ny][nx] = INK
    return out


def mirror(g):
    return [row[::-1] for row in g]


def to_image(g, scale=SCALE):
    h, w = len(g), len(g[0])
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = im.load()
    for y in range(h):
        for x in range(w):
            if g[y][x]:
                px[x, y] = g[y][x]
    if scale != 1:
        im = im.resize((w * scale, h * scale), Image.NEAREST)
    return im


def grass(seed):
    g = [[GRASS] * 16 for _ in range(16)]
    specks = {
        1: [(2, 2, GRASS_L), (4, 3, GRASS_D), (8, 2, BLADE), (11, 4, GRASS_L), (13, 3, GRASS_D), (3, 6, GRASS_D), (6, 7, BLADE), (9, 6, GRASS_L), (14, 8, BLADE), (2, 10, GRASS_L), (5, 11, GRASS_D), (8, 12, BLADE), (12, 11, GRASS_L), (7, 14, GRASS_D), (13, 13, GRASS_L)],
        2: [(3, 2, GRASS_D), (7, 3, GRASS_L), (12, 2, BLADE), (5, 5, BLADE), (9, 5, GRASS_D), (14, 6, GRASS_L), (2, 8, GRASS_L), (6, 9, GRASS_D), (10, 8, BLADE), (13, 10, GRASS_D), (4, 12, BLADE), (8, 13, GRASS_L), (12, 14, GRASS_D), (15, 12, GRASS_L)],
        3: [(2, 4, BLADE), (6, 2, GRASS_L), (10, 3, GRASS_D), (14, 2, GRASS_L), (4, 7, GRASS_L), (8, 6, BLADE), (13, 8, GRASS_D), (3, 11, GRASS_D), (7, 10, GRASS_L), (11, 12, BLADE), (14, 11, GRASS_L), (5, 14, BLADE), (9, 14, GRASS_D)],
        4: [(3, 3, BLADE), (8, 2, GRASS_D), (12, 4, BLADE), (5, 6, GRASS_L), (9, 7, GRASS_D), (13, 6, GRASS_L), (2, 9, GRASS_D), (6, 11, BLADE), (10, 10, GRASS_L), (14, 12, BLADE), (4, 13, GRASS_L), (8, 14, GRASS_D), (12, 13, GRASS_L)],
    }[seed]
    for x, y, c in specks:
        if x <= 0 or y <= 0 or x >= 15 or y >= 15:
            continue
        g[y][x] = c
        if c is BLADE and y + 1 < 15:
            g[y + 1][x] = GRASS_D
    return g


def path(seed):
    g = [[PATH] * 16 for _ in range(16)]
    pebbles = {
        1: [(3, 4), (10, 7), (6, 12), (13, 10)],
        2: [(5, 3), (12, 6), (2, 10), (9, 13)],
        3: [(8, 2), (4, 8), (13, 11), (7, 14)],
        4: [(2, 5), (11, 4), (6, 9), (14, 13)],
    }[seed]
    for x, y in pebbles:
        g[y][x] = PATH_D
        if x + 1 < 16:
            g[y][x + 1] = PATH_L
    return g


def water(seed):
    g = [[WATER] * 16 for _ in range(16)]
    band = 3 + (seed - 1) * 3
    for x in range(16):
        g[1][x] = WATER_D
        g[band][x] = WATER_L
        g[min(15, band + 1)][x] = WATER
        g[14][x] = WATER_D
    g[band][2] = WATER
    g[band][11] = WATER
    return g


def soil(seed):
    g = [[SOIL] * 16 for _ in range(16)]
    row = 2 + (seed % 2)
    for y in (row, row + 5, row + 10):
        if y >= 16:
            continue
        for x in range(16):
            g[y][x] = SOIL_D
        if seed % 2 == 0:
            g[y][3] = SOIL_L
            g[y][10] = SOIL_L
        else:
            g[y][6] = SOIL_L
            g[y][13] = SOIL_L
    return g


def sand(seed):
    g = [[SAND] * 16 for _ in range(16)]
    dots = {
        1: [(2, 3, SAND_D), (8, 6, SAND_L), (13, 4, SAND_D), (5, 11, SAND_D), (11, 13, SAND_L)],
        2: [(4, 2, SAND_L), (12, 7, SAND_D), (7, 10, SAND_L), (2, 13, SAND_D)],
        3: [(9, 3, SAND_D), (3, 8, SAND_L), (14, 11, SAND_D), (6, 14, SAND_L)],
        4: [(1, 6, SAND_D), (10, 5, SAND_L), (5, 12, SAND_D), (13, 14, SAND_L)],
    }[seed]
    for x, y, c in dots:
        g[y][x] = c
    return g


def tall(seed):
    g = grass(seed)
    for x in (2 + seed, 6, 10, 13):
        xx = x % 14
        if xx < 1:
            xx = 2
        for y in range(4, 14):
            g[y][xx] = BLADE if (y + seed) % 2 == 0 else GRASS_D
    return g


def wall():
    g = [[MORTAR] * 16 for _ in range(16)]

    def brick(x, y, w, h):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                if 0 <= xx < 16 and 0 <= yy < 16:
                    g[yy][xx] = STONE_L if xx == x or yy == y else STONE
        for xx in range(x, x + w):
            if 0 <= xx < 16 and y + h - 1 < 16:
                g[y + h - 1][xx] = STONE_D

    brick(1, 1, 6, 6)
    brick(9, 1, 6, 6)
    brick(0, 9, 3, 6)
    brick(5, 9, 6, 6)
    brick(12, 9, 4, 6)
    return g


def tree():
    g = [[GRASS] * 16 for _ in range(16)]
    cx, cy, rx, ry = 7.5, 6.2, 6.2, 5.2
    for y in range(16):
        for x in range(16):
            if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1:
                if x < cx - 1 and y < cy:
                    g[y][x] = LEAF_L
                elif x > cx + 2 or y > cy + 2:
                    g[y][x] = LEAF_D
                else:
                    g[y][x] = LEAF
    for y in range(10, 15):
        g[y][7] = TRUNK
        g[y][8] = TRUNK_D
    return g


def flower(seed):
    g = grass((seed % 4) + 1)
    colors = [PINK, GOLD, (232, 120, 72, 255), (186, 112, 196, 255)]
    petal = colors[seed - 1]
    cx, cy = 8, 7
    for dx, dy in ((0, -2), (-2, 0), (2, 0), (0, 2), (-1, -1), (1, -1), (-1, 1), (1, 1)):
        pix(g, cx + dx, cy + dy, petal)
    pix(g, cx, cy, GOLD)
    pix(g, cx, cy + 3, GRASS_D)
    pix(g, cx, cy + 4, GRASS_D)
    return g


def dock():
    g = [[WATER_D] * 16 for _ in range(16)]
    for x in range(16):
        plank = WOOD_L if (x // 4) % 2 == 0 else WOOD
        for y in range(16):
            g[y][x] = plank
        if x % 4 == 3:
            for y in range(16):
                g[y][x] = WOOD_D
        if x % 4 == 1:
            g[3][x] = WOOD_D
            g[12][x] = WOOD_D
    return g


def gate():
    g = path(1)
    for y in range(1, 15):
        g[y][1] = WOOD
        g[y][2] = WOOD_D
        g[y][13] = WOOD
        g[y][14] = WOOD_D
    for x in range(1, 15):
        g[1][x] = WOOD_L
        g[2][x] = WOOD
    for x in (6, 7, 8, 9):
        g[9][x] = GOLD
    return g


def critter_cat():
    g = blank(16, 16)
    fill(g, 5, 6, 6, 5, (120, 114, 108, 255))
    fill(g, 6, 9, 4, 3, (236, 228, 220, 255))
    pix(g, 4, 4, (90, 84, 80, 255))
    pix(g, 5, 3, (90, 84, 80, 255))
    pix(g, 10, 4, (90, 84, 80, 255))
    pix(g, 11, 3, (90, 84, 80, 255))
    pix(g, 6, 7, EYE)
    pix(g, 9, 7, EYE)
    pix(g, 3, 10, (120, 114, 108, 255))
    pix(g, 12, 8, (120, 114, 108, 255))
    pix(g, 13, 7, (120, 114, 108, 255))
    return outline(g)


def critter_gull():
    g = blank(16, 16)
    fill(g, 2, 7, 12, 2, WHITE)
    fill(g, 6, 6, 4, 4, WHITE)
    pix(g, 9, 7, GOLD)
    pix(g, 10, 7, GOLD)
    pix(g, 8, 6, EYE)
    pix(g, 4, 6, WHITE)
    pix(g, 11, 6, WHITE)
    pix(g, 7, 10, (186, 186, 180, 255))
    pix(g, 8, 10, (186, 186, 180, 255))
    return outline(g)


def critter_spirit():
    g = blank(16, 16)
    fill(g, 4, 4, 8, 8, (126, 206, 214, 255))
    fill(g, 6, 8, 4, 3, (186, 236, 230, 255))
    pix(g, 6, 6, EYE)
    pix(g, 9, 6, EYE)
    pix(g, 5, 3, (186, 236, 230, 255))
    pix(g, 10, 3, (186, 236, 230, 255))
    pix(g, 7, 12, TEAL)
    pix(g, 8, 12, TEAL)
    return outline(g)


def critter_fox():
    g = blank(16, 16)
    fill(g, 3, 7, 8, 5, FOX)
    fill(g, 4, 9, 4, 2, CREAM)
    pix(g, 4, 4, FOX)
    pix(g, 5, 3, FOX_E)
    pix(g, 9, 4, FOX)
    pix(g, 10, 3, FOX_E)
    pix(g, 5, 6, FOX_EYE)
    pix(g, 8, 6, FOX_EYE)
    pix(g, 6, 8, FOX_D)
    fill(g, 11, 8, 3, 2, FOX)
    pix(g, 14, 8, TEAL)
    pix(g, 14, 9, TEAL)
    pix(g, 4, 12, FOX_D)
    pix(g, 8, 12, FOX_D)
    return outline(g)


def hat_front(g, spec):
    hat = spec.get("hat")
    if hat == "straw":
        for x in range(2, 14):
            pix(g, x, 4, (214, 170, 72, 255))
        for x in range(5, 11):
            pix(g, x, 2, (196, 146, 58, 255))
            pix(g, x, 3, (232, 190, 92, 255))
    elif hat == "cap":
        fill(g, 3, 1, 10, 3, spec["cap"])
        fill(g, 3, 4, 10, 1, spec.get("cap_d", spec["cap"]))
    elif hat == "bun":
        fill(g, 9, 1, 3, 3, spec["hair"])
        pix(g, 10, 1, spec["hi"])
    elif hat == "clip":
        pix(g, 11, 5, TEAL)
        pix(g, 12, 6, TEAL)


def extras_front(g, spec):
    if spec.get("glasses"):
        pix(g, 5, 9, (70, 86, 98, 255))
        pix(g, 6, 8, (70, 86, 98, 255))
        pix(g, 10, 8, (70, 86, 98, 255))
        pix(g, 11, 9, (70, 86, 98, 255))
    if spec.get("mustache"):
        pix(g, 6, 11, spec["hair"])
        pix(g, 9, 11, spec["hair"])
    if spec.get("apron"):
        fill(g, 5, 16, 6, 6, spec["apron"])
        pix(g, 7, 17, spec.get("apron_d", WOOD_D))
        pix(g, 8, 17, spec.get("apron_d", WOOD_D))
    if spec.get("stripe"):
        for y in range(15, 20):
            pix(g, 7, y, WHITE)
            pix(g, 8, y, WHITE)
    if spec.get("pony"):
        for y in range(7, 16):
            pix(g, 13, y, spec["hair"])
            pix(g, 14, y, spec["hair"])


def front(spec, step):
    g = blank(16, 32)
    hair, hi = spec["hair"], spec["hi"]
    shirt, shade, lite = spec["shirt"], spec["shirt_d"], spec["shirt_hi"]
    pants, pants_d = spec["pants"], spec["pants_d"]
    shoe = spec["shoe"]
    fill(g, 4, 3, 8, 3, hair)
    fill(g, 3, 5, 10, 2, hair)
    pix(g, 6, 3, hi)
    pix(g, 7, 3, hi)
    fill(g, 4, 6, 8, 6, SKIN)
    fill(g, 4, 6, 8, 2, hair)
    pix(g, 3, 8, SKIN)
    pix(g, 12, 8, SKIN)
    pix(g, 6, 9, EYE)
    pix(g, 9, 9, EYE)
    pix(g, 6, 8, WHITE)
    pix(g, 9, 8, WHITE)
    pix(g, 7, 11, MOUTH)
    pix(g, 8, 11, MOUTH)
    fill(g, 6, 12, 4, 2, SKIN_D)
    fill(g, 4, 14, 8, 8, shirt)
    for y in range(14, 22):
        pix(g, 4, y, shade)
        pix(g, 11, y, shade)
    pix(g, 6, 14, lite)
    pix(g, 9, 14, lite)
    fill(g, 2, 15, 2, 6, shirt)
    fill(g, 12, 15, 2, 6, shade)
    hand_y = 19 if step == 0 else 18
    fill(g, 2, hand_y, 2, 2, SKIN)
    fill(g, 12, hand_y + 1, 2, 2, SKIN_D)
    fill(g, 4, 22, 3, 6, pants)
    fill(g, 9, 22, 3, 6, pants_d)
    if step == 0:
        fill(g, 4, 28, 3, 2, shoe)
        fill(g, 9, 28, 3, 2, shoe)
    else:
        fill(g, 4, 27, 3, 2, shoe)
        fill(g, 9, 29, 3, 2, shoe)
        fill(g, 9, 28, 3, 1, pants_d)
    hat_front(g, spec)
    extras_front(g, spec)
    return outline(g)


def side(spec, step, facing):
    g = blank(16, 32)
    hair, hi = spec["hair"], spec["hi"]
    shirt, shade = spec["shirt"], spec["shirt_d"]
    pants = spec["pants"]
    shoe = spec["shoe"]
    fill(g, 6, 3, 6, 4, hair)
    pix(g, 8, 3, hi)
    fill(g, 7, 6, 5, 6, SKIN)
    fill(g, 6, 6, 2, 5, hair)
    pix(g, 11, 9, SKIN_D)
    pix(g, 9, 8, EYE)
    pix(g, 8, 10, MOUTH)
    if spec.get("pony"):
        for y in range(6, 16):
            pix(g, 5, y, hair)
    if spec.get("hat") == "straw":
        for x in range(4, 13):
            pix(g, x, 4, (214, 170, 72, 255))
        fill(g, 6, 2, 5, 2, (232, 190, 92, 255))
    elif spec.get("hat") == "cap":
        fill(g, 6, 1, 6, 3, spec["cap"])
        fill(g, 6, 4, 7, 1, spec.get("cap_d", spec["cap"]))
    elif spec.get("hat") == "bun":
        fill(g, 4, 2, 3, 3, hair)
    elif spec.get("hat") == "clip":
        pix(g, 6, 6, TEAL)
    if spec.get("glasses"):
        pix(g, 9, 7, (70, 86, 98, 255))
        pix(g, 10, 8, (70, 86, 98, 255))
    fill(g, 8, 12, 3, 2, SKIN_D)
    fill(g, 6, 14, 6, 8, shirt)
    for y in range(14, 22):
        pix(g, 6, y, shade)
    if spec.get("apron"):
        fill(g, 8, 16, 3, 5, spec["apron"])
    if spec.get("stripe"):
        for y in range(15, 20):
            pix(g, 9, y, WHITE)
    fill(g, 11, 16, 2, 5, SKIN)
    fill(g, 5, 16, 2, 5, shade)
    fill(g, 7, 22, 3, 6, pants)
    if step == 0:
        fill(g, 7, 28, 3, 2, shoe)
    else:
        fill(g, 8, 27, 3, 2, shoe)
        fill(g, 6, 29, 3, 2, spec["pants_d"])
    if facing == "left":
        g = mirror(g)
    return outline(g)


def back(spec, step):
    g = blank(16, 32)
    hair = spec["hair"]
    shirt, shade = spec["shirt"], spec["shirt_d"]
    pants, pants_d = spec["pants"], spec["pants_d"]
    shoe = spec["shoe"]
    fill(g, 4, 3, 8, 9, hair)
    fill(g, 3, 5, 10, 6, hair)
    pix(g, 6, 4, spec["hi"])
    if spec.get("pony"):
        fill(g, 6, 10, 4, 6, hair)
    if spec.get("hat") == "straw":
        for x in range(2, 14):
            pix(g, x, 4, (214, 170, 72, 255))
        fill(g, 5, 2, 6, 2, (196, 146, 58, 255))
    elif spec.get("hat") == "cap":
        fill(g, 3, 1, 10, 4, spec["cap"])
    elif spec.get("hat") == "bun":
        fill(g, 6, 1, 4, 3, hair)
    fill(g, 6, 12, 4, 2, SKIN_D)
    fill(g, 4, 14, 8, 8, shade)
    for y in range(14, 22):
        pix(g, 7, y, shirt)
        pix(g, 8, y, shirt)
    fill(g, 2, 15, 2, 6, shade)
    fill(g, 12, 15, 2, 6, shade)
    fill(g, 4, 22, 3, 6, pants)
    fill(g, 9, 22, 3, 6, pants_d)
    if step == 0:
        fill(g, 4, 28, 3, 2, shoe)
        fill(g, 9, 28, 3, 2, shoe)
    else:
        fill(g, 4, 29, 3, 2, shoe)
        fill(g, 9, 27, 3, 2, shoe)
    return outline(g)


def bust(spec):
    g = blank(16, 16)
    hair = spec["hair"]
    fill(g, 2, 1, 12, 5, hair)
    pix(g, 5, 2, spec["hi"])
    pix(g, 6, 2, spec["hi"])
    fill(g, 3, 5, 10, 8, SKIN)
    fill(g, 3, 5, 10, 2, hair)
    pix(g, 2, 8, SKIN)
    pix(g, 13, 8, SKIN)
    pix(g, 5, 8, EYE)
    pix(g, 6, 8, EYE)
    pix(g, 9, 8, EYE)
    pix(g, 10, 8, EYE)
    pix(g, 5, 7, WHITE)
    pix(g, 9, 7, WHITE)
    pix(g, 7, 11, MOUTH)
    pix(g, 8, 11, MOUTH)
    fill(g, 5, 13, 6, 3, spec["shirt"])
    pix(g, 5, 13, spec["shirt_d"])
    pix(g, 10, 13, spec["shirt_d"])
    hat = spec.get("hat")
    if hat == "straw":
        for x in range(1, 15):
            pix(g, x, 4, (214, 170, 72, 255))
        fill(g, 4, 1, 8, 3, (232, 190, 92, 255))
    elif hat == "cap":
        fill(g, 2, 0, 12, 4, spec["cap"])
        fill(g, 1, 4, 14, 1, spec.get("cap_d", spec["cap"]))
    elif hat == "bun":
        fill(g, 10, 0, 4, 3, hair)
    elif hat == "clip":
        pix(g, 12, 5, TEAL)
        pix(g, 13, 6, TEAL)
    if spec.get("glasses"):
        for x in range(4, 7):
            pix(g, x, 7, (70, 86, 98, 255))
            pix(g, x + 5, 7, (70, 86, 98, 255))
        pix(g, 7, 7, (70, 86, 98, 255))
    if spec.get("pony"):
        pix(g, 1, 8, hair)
        pix(g, 1, 9, hair)
        pix(g, 14, 8, hair)
    if spec.get("mustache"):
        pix(g, 6, 11, hair)
        pix(g, 9, 11, hair)
    return outline(g)


def bust_fox():
    g = blank(16, 16)
    fill(g, 3, 4, 10, 9, FOX)
    fill(g, 5, 9, 6, 4, CREAM)
    pix(g, 3, 2, FOX)
    pix(g, 4, 1, FOX_E)
    pix(g, 5, 3, FOX)
    pix(g, 11, 2, FOX)
    pix(g, 12, 1, FOX_E)
    pix(g, 10, 3, FOX)
    pix(g, 6, 7, FOX_EYE)
    pix(g, 9, 7, FOX_EYE)
    pix(g, 6, 6, WHITE)
    pix(g, 9, 6, WHITE)
    pix(g, 7, 9, FOX_D)
    pix(g, 8, 9, FOX_D)
    return outline(g)


def fox_body(step, facing):
    g = blank(16, 32)
    if facing == "down":
        y = 17
        pix(g, 5, y, FOX_E)
        pix(g, 5, y + 1, FOX)
        pix(g, 6, y + 1, FOX)
        pix(g, 10, y, FOX_E)
        pix(g, 9, y + 1, FOX)
        pix(g, 10, y + 1, FOX)
        fill(g, 4, y + 2, 8, 7, FOX)
        fill(g, 5, y + 5, 6, 3, CREAM)
        pix(g, 6, y + 4, FOX_EYE)
        pix(g, 9, y + 4, FOX_EYE)
        pix(g, 6, y + 3, WHITE)
        pix(g, 9, y + 3, WHITE)
        pix(g, 7, y + 6, FOX_D)
        pix(g, 8, y + 6, FOX_D)
        pix(g, 12, y + 7, FOX)
        pix(g, 13, y + 8, TEAL)
        if step == 0:
            pix(g, 5, y + 9, FOX_D)
            pix(g, 9, y + 9, FOX_D)
        else:
            pix(g, 5, y + 8, FOX_D)
            pix(g, 9, y + 10, FOX_D)
    elif facing == "up":
        y = 17
        pix(g, 5, y, FOX_E)
        pix(g, 10, y, FOX_E)
        fill(g, 4, y + 1, 8, 8, FOX)
        fill(g, 5, y + 2, 6, 3, FOX_D)
        pix(g, 2, y + 6, FOX)
        pix(g, 1, y + 7, TEAL)
        if step == 0:
            pix(g, 5, y + 9, FOX_D)
            pix(g, 9, y + 9, FOX_D)
        else:
            pix(g, 6, y + 9, FOX_D)
            pix(g, 10, y + 8, FOX_D)
    else:
        y = 18
        pix(g, 9, y, FOX_E)
        pix(g, 8, y + 1, FOX)
        pix(g, 9, y + 1, FOX)
        fill(g, 5, y + 2, 7, 5, FOX)
        fill(g, 8, y + 4, 3, 2, CREAM)
        pix(g, 10, y + 3, FOX_EYE)
        pix(g, 11, y + 4, FOX_D)
        pix(g, 4, y + 4, FOX)
        pix(g, 3, y + 5, TEAL)
        if step == 0:
            pix(g, 6, y + 7, FOX_D)
            pix(g, 9, y + 7, FOX_D)
        else:
            pix(g, 6, y + 6, FOX_D)
            pix(g, 9, y + 8, FOX_D)
        if facing == "left":
            g = mirror(g)
    return outline(g)


PEOPLE = {
    "you": {
        "hair": (48, 32, 28, 255), "hi": (96, 68, 52, 255),
        "shirt": (36, 78, 122, 255), "shirt_d": (24, 52, 86, 255), "shirt_hi": (214, 176, 110, 255),
        "pants": (48, 50, 64, 255), "pants_d": (32, 34, 46, 255), "shoe": (236, 232, 224, 255),
    },
    "ning": {
        "hair": (36, 26, 22, 255), "hi": (82, 58, 44, 255),
        "shirt": (62, 122, 72, 255), "shirt_d": (36, 82, 48, 255), "shirt_hi": (186, 154, 92, 255),
        "pants": (92, 62, 40, 255), "pants_d": (64, 42, 28, 255), "shoe": (72, 48, 32, 255),
        "hat": "straw", "apron": (168, 122, 72, 255), "apron_d": (112, 74, 42, 255), "pony": True,
    },
    "tea": {
        "hair": (92, 86, 80, 255), "hi": (150, 144, 136, 255),
        "shirt": (186, 154, 112, 255), "shirt_d": (132, 98, 68, 255), "shirt_hi": (232, 214, 180, 255),
        "pants": (72, 58, 48, 255), "pants_d": (48, 40, 34, 255), "shoe": (64, 48, 36, 255),
        "apron": (214, 196, 160, 255), "apron_d": (160, 132, 96, 255),
    },
    "warden": {
        "hair": (42, 32, 36, 255), "hi": (96, 72, 78, 255),
        "shirt": (122, 78, 112, 255), "shirt_d": (82, 48, 74, 255), "shirt_hi": (214, 186, 168, 255),
        "pants": (64, 48, 62, 255), "pants_d": (42, 32, 42, 255), "shoe": (48, 36, 40, 255),
        "hat": "bun", "glasses": True,
    },
    "zhou": {
        "hair": (54, 48, 44, 255), "hi": (110, 100, 90, 255),
        "shirt": (78, 96, 78, 255), "shirt_d": (48, 64, 50, 255), "shirt_hi": (214, 186, 92, 255),
        "pants": (54, 62, 54, 255), "pants_d": (36, 42, 36, 255), "shoe": (42, 40, 38, 255),
        "hat": "cap", "cap": (54, 62, 54, 255), "cap_d": (36, 42, 36, 255), "mustache": True,
    },
    "coach": {
        "hair": (28, 26, 32, 255), "hi": (72, 68, 78, 255),
        "shirt": (176, 48, 52, 255), "shirt_d": (122, 32, 38, 255), "shirt_hi": (236, 214, 196, 255),
        "pants": (36, 38, 48, 255), "pants_d": (24, 26, 34, 255), "shoe": (232, 232, 228, 255),
        "stripe": True,
    },
    "dock": {
        "hair": (32, 28, 26, 255), "hi": (78, 64, 52, 255),
        "shirt": (42, 92, 118, 255), "shirt_d": (26, 60, 82, 255), "shirt_hi": (196, 154, 96, 255),
        "pants": (72, 54, 40, 255), "pants_d": (48, 36, 28, 255), "shoe": (58, 42, 32, 255),
        "hat": "cap", "cap": (28, 48, 72, 255), "cap_d": (18, 32, 52, 255),
    },
    "clerk": {
        "hair": (40, 28, 24, 255), "hi": (92, 62, 48, 255),
        "shirt": (214, 168, 92, 255), "shirt_d": (168, 114, 58, 255), "shirt_hi": (248, 228, 196, 255),
        "pants": (92, 64, 48, 255), "pants_d": (64, 44, 34, 255), "shoe": (72, 48, 36, 255),
        "apron": (232, 220, 196, 255), "apron_d": (176, 96, 72, 255),
    },
    "nightstall": {
        "hair": (28, 24, 32, 255), "hi": (72, 62, 78, 255),
        "shirt": (64, 42, 78, 255), "shirt_d": (40, 26, 52, 255), "shirt_hi": (196, 72, 64, 255),
        "pants": (36, 32, 42, 255), "pants_d": (24, 22, 30, 255), "shoe": (48, 40, 44, 255),
    },
    "senior": {
        "hair": (36, 28, 26, 255), "hi": (86, 64, 52, 255),
        "shirt": (72, 132, 156, 255), "shirt_d": (42, 92, 116, 255), "shirt_hi": (214, 196, 160, 255),
        "pants": (48, 62, 78, 255), "pants_d": (32, 44, 58, 255), "shoe": (232, 228, 220, 255),
        "hat": "clip", "pony": True,
    },
    "lib": {
        "hair": (64, 42, 32, 255), "hi": (128, 92, 68, 255),
        "shirt": (92, 108, 96, 255), "shirt_d": (58, 72, 64, 255), "shirt_hi": (214, 204, 176, 255),
        "pants": (58, 54, 62, 255), "pants_d": (38, 36, 44, 255), "shoe": (64, 52, 46, 255),
        "hat": "bun", "glasses": True,
    },
}


def person_frames(spec):
    frames = [
        front(spec, 0),
        front(spec, 1),
        side(spec, 0, "left"),
        side(spec, 1, "left"),
        side(spec, 0, "right"),
        side(spec, 1, "right"),
        back(spec, 0),
        back(spec, 1),
    ]
    images = [to_image(frame) for frame in frames]
    portrait = to_image(bust(spec))
    bust_frame = Image.new("RGBA", (32, 64), (0, 0, 0, 0))
    bust_frame.paste(portrait, (0, 0))
    images.append(bust_frame)
    return images


def fox_frames():
    views = [
        ("down", 0), ("down", 1),
        ("left", 0), ("left", 1),
        ("right", 0), ("right", 1),
        ("up", 0), ("up", 1),
    ]
    images = [to_image(fox_body(step, facing)) for facing, step in views]
    portrait = to_image(bust_fox())
    bust_frame = Image.new("RGBA", (32, 64), (0, 0, 0, 0))
    bust_frame.paste(portrait, (0, 0))
    images.append(bust_frame)
    return images


def build_atlas():
    variants = [
        ("grass", grass),
        ("path", path),
        ("water", water),
        ("wall", lambda _s: wall()),
        ("soil", soil),
        ("tree", lambda _s: tree()),
        ("flower", flower),
        ("tall", tall),
        ("sand", sand),
        ("dock", lambda _s: dock()),
        ("gate", lambda _s: gate()),
    ]
    # 后面几格是没走到行走图时的退路，以及猫、鸥、生态。
    singles = []
    you = front(PEOPLE["you"], 0)
    zhou = front(PEOPLE["zhou"], 0)
    ning = front(PEOPLE["ning"], 0)
    dock_p = front(PEOPLE["dock"], 0)
    senior = front(PEOPLE["senior"], 0)
    fox = fox_body(0, "down")
    for src in (you, zhou, ning, dock_p, fox, None, None, None, senior):
        singles.append(src)
    critters = {
        16: critter_cat(),
        17: critter_spirit(),
        18: critter_gull(),
    }
    sheet = Image.new("RGBA", (20 * 32, 4 * 32), (0, 0, 0, 0))
    for index, (name, maker) in enumerate(variants):
        for row in range(4):
            tile = to_image(maker(row + 1))
            sheet.paste(tile, (index * 32, row * 32))
    named = {
        11: you,
        12: fox,
        13: zhou,
        14: ning,
        15: dock_p,
        19: senior,
    }
    named.update(critters)
    for index, grid in named.items():
        tile = to_image(grid)
        # 退路图标收进一格：行走图才用两格高。
        fitted = tile.resize((32, 32), Image.NEAREST) if tile.size != (32, 32) else tile
        for row in range(4):
            sheet.paste(fitted, (index * 32, row * 32))
    sheet.save(PACK / "atlas.png")
    return sheet


def build_actors():
    order = ["you", "fox", "ning", "tea", "warden", "zhou", "coach", "dock", "clerk", "nightstall", "senior", "lib"]
    sheet = Image.new("RGBA", (9 * 32, 12 * 64), (0, 0, 0, 0))
    for row, name in enumerate(order):
        frames = fox_frames() if name == "fox" else person_frames(PEOPLE[name])
        for col, frame in enumerate(frames):
            sheet.paste(frame, (col * 32, row * 64))
    sheet.save(PACK / "actors.png")
    meta = {
        "tile": 32,
        "frameW": 32,
        "frameH": 64,
        "cols": 9,
        "bust": 8,
        "frames": ["down0", "down1", "left0", "left1", "right0", "right1", "up0", "up1", "bust"],
        "rows": {name: i for i, name in enumerate(order)},
    }
    (PACK / "actors.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return sheet


def build_preview(atlas, actors):
    world = json.loads((PACK / "world.json").read_text(encoding="utf-8"))
    nest = next(m for m in world["maps"] if m["id"] == "nest")
    cell = 32
    im = Image.new("RGBA", (nest["cols"] * cell, nest["rows"] * cell), (20, 28, 24, 255))
    for y, row in enumerate(nest["ground"]):
        for x, tid in enumerate(row):
            variant = ((x * 5 + y * 3) % 4) if tid in (0, 1, 2, 4, 7, 8) else 0
            tile = atlas.crop((tid * 32, variant * 32, tid * 32 + 32, variant * 32 + 32))
            im.paste(tile, (x * cell, y * cell), tile)
    you = actors.crop((0, 0, 32, 64))
    fox = actors.crop((0, 64, 32, 128))
    ning = actors.crop((0, 128, 32, 192))
    im.paste(ning, (2 * cell, 3 * cell - 32), ning)
    im.paste(you, (8 * cell, 6 * cell - 32), you)
    im.paste(fox, (9 * cell, 6 * cell - 32), fox)
    im.resize((im.width * 2, im.height * 2), Image.NEAREST).save(ROOT / "tools" / "_harbor-pixel-preview.png")


def main():
    atlas = build_atlas()
    actors = build_actors()
    build_preview(atlas, actors)
    print("atlas", atlas.size, "actors", actors.size)


if __name__ == "__main__":
    main()
