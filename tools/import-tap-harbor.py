"""Slice the purchased Tiny Adventure packs and the local tileset into the harbor pack.

Keeps the official fox sheet. Does not copy sword, bow, shield, goblin, or skeleton frames.
"""
import io
import zipfile
from pathlib import Path

from PIL import Image

ROOT = Path(r"C:\Users\upwar\Desktop\xm-main\harbor-world-pack")
TILESET = Path(r"C:\Users\upwar\Downloads\tileset.png")
ANIM = Path(r"C:\Users\upwar\Downloads\TAPp_anim_v2.zip")
PADS = Path(r"C:\Users\upwar\Downloads\Controllers and Keyboard.zip")

# Existing ground16 columns. Seasonal rows are recolors of the same cells.
COLS = {
    0: (0, 0),
    12: (2, 0),
    13: (0, 7),
    14: (8, 2),
    1: (16, 3),
    2: (27, 8),
    11: (30, 8),
    3: (17, 2),
    4: (20, 0),
    5: (0, 2),
    6: (6, 2),
    7: (3, 3),
    8: (1, 10),
    9: (21, 0),
    10: (16, 4),
    15: (22, 0),
}

# actors.json rows. Fox row stays in actors.png and is left blank here.
PEOPLE = [
    (0, "Char1", 0),
    (2, "Char2", 0),
    (3, "Char3", 18),
    (4, "Char4", 0),
    (5, "Char5", -16),
    (6, "Char6", 0),
    (7, "Char1", 28),
    (8, "Char4", -24),
    (9, "Char5", 12),
    (10, "Char3", -10),
    (11, "Char2", 22),
]


def cell(src: Image.Image, col: int, row: int) -> Image.Image:
    return src.crop((col * 16, row * 16, col * 16 + 16, row * 16 + 16))


def tint(tile: Image.Image, season: int) -> Image.Image:
    if season == 0:
        return tile.copy()
    out = tile.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if season == 1:
                g = min(255, g + 14)
                b = max(0, b - 8)
            elif season == 2:
                r = min(255, int(r * 1.12) + 18)
                g = int(g * 0.78)
                b = int(b * 0.62)
            else:
                gray = (r + g + b) // 3
                r = min(255, (r + gray + 36) // 2)
                g = min(255, (g + gray + 46) // 2)
                b = min(255, (b + gray + 62) // 2)
            px[x, y] = (r, g, b, a)
    return out


def shift_hue(tile: Image.Image, amount: int) -> Image.Image:
    if amount == 0:
        return tile
    out = tile.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if amount > 0:
                r = min(255, r + amount)
                b = max(0, b - amount // 2)
            else:
                b = min(255, b - amount)
                r = max(0, r + amount // 2)
            px[x, y] = (r, g, b, a)
    return out


def build_ground(src: Image.Image) -> None:
    sheet = Image.new("RGBA", (16 * 16, 16 * 4), (0, 0, 0, 0))
    for season in range(4):
        for col, (c, r) in COLS.items():
            sheet.paste(tint(cell(src, r, c), season), (col * 16, season * 16))
    sheet.save(ROOT / "ground16.png")


def build_tree(src: Image.Image) -> None:
    # Round canopy plus trunk on the left side of the sheet.
    crop = src.crop((0, 8 * 16, 4 * 16, 11 * 16))
    box = crop.getbbox()
    if box:
        crop = crop.crop(box)
    crop = crop.resize((max(1, crop.width // 2), max(1, crop.height // 2)), Image.NEAREST)
    crop.save(ROOT / "tree16.png")


def frame_of(sheet: Image.Image, row: int, col: int) -> Image.Image:
    return sheet.crop((col * 16, row * 16, col * 16 + 16, row * 16 + 16))


def build_folk() -> None:
    z = zipfile.ZipFile(ANIM)
    cache: dict[str, Image.Image] = {}
    for name in ("Char1", "Char2", "Char3", "Char4", "Char5", "Char6"):
        folder = "char4" if name == "Char4" else name
        raw = z.read(f"TAPp_anim_v2/Animations ver2/{folder}/{name}_walk_16px.png")
        cache[name] = Image.open(io.BytesIO(raw)).convert("RGBA")
    # down, left, right, up match the walk sheet rows.
    dirs = (0, 1, 2, 3)
    folk = Image.new("RGBA", (17 * 16, 12 * 16), (0, 0, 0, 0))
    for row, name, hue in PEOPLE:
        walk = cache[name]
        for d, src_row in enumerate(dirs):
            for frame in range(4):
                folk.paste(shift_hue(frame_of(walk, src_row, frame), hue), ((d * 4 + frame) * 16, row * 16))
        folk.paste(shift_hue(frame_of(walk, 0, 0), hue), (16 * 16, row * 16))
    folk.save(ROOT / "folk.png")


def build_pad() -> None:
    z = zipfile.ZipFile(PADS)
    sticks = Image.open(io.BytesIO(z.read("Controllers and Keyboard/sticks.png"))).convert("RGBA")
    ui = ROOT / "ui"
    ui.mkdir(exist_ok=True)
    sticks.crop((0, 0, 16, 16)).save(ui / "btn.png")
    for i, name in enumerate(("w", "n", "e", "s")):
        sticks.crop((i * 16, 11 * 16, i * 16 + 16, 12 * 16)).save(ui / f"arrow-{name}.png")


def main() -> None:
    src = Image.open(TILESET).convert("RGBA")
    build_ground(src)
    build_tree(src)
    build_folk()
    build_pad()
    print("imported ground16, tree16, folk, ui")


if __name__ == "__main__":
    main()
