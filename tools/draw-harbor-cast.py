# -*- coding: utf-8 -*-
"""Original harbor cast, drawn to the existing 32x64 actor sheet."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "harbor-world-pack"
SHEET = ROOT / "actors.png"
PROPS = ROOT / "props" / "story.png"
FW, FH, COLS = 32, 64, 9
OUTLINE = (42, 36, 32, 255)
SKIN = (242, 198, 156, 255)
SKIN2 = (214, 158, 114, 255)
EYE = (42, 36, 32, 255)
SHOE = (54, 46, 40, 255)

def blank(w, h):
    return Image.new("RGBA", (w, h), (0, 0, 0, 0))

def px(im, x, y, c):
    if c and 0 <= x < im.width and 0 <= y < im.height:
        im.putpixel((int(x), int(y)), c)

def fill(im, x, y, w, h, c):
    for yy in range(int(y), int(y + h)):
        for xx in range(int(x), int(x + w)):
            px(im, xx, yy, c)

def human(hair, shirt, pants, hat=None, glasses=False, vest=None, dirt=False, board=False, frame=0, facing="down"):
    im = blank(16, 32)
    hair_y = 8
    if facing == "side":
        if hat:
            fill(im, 4, hair_y - 2, 8, 3, hat)
        fill(im, 5, hair_y, 7, 5, hair)
        fill(im, 4, hair_y + 1, 2, 3, hair)
        fill(im, 6, 12, 5, 5, SKIN)
        px(im, 7, 14, EYE)
        px(im, 8, 16, SKIN2)
        fill(im, 6, 17, 5, 6, shirt)
        fill(im, 5, 18, 2, 4, shirt)
        if vest:
            fill(im, 7, 18, 3, 5, vest)
        if board:
            fill(im, 11, 16, 3, 4, (236, 224, 196, 255))
            px(im, 12, 17, (120, 96, 64, 255))
        leg = 1 if frame else 0
        fill(im, 6, 23, 3, 5 + leg, pants)
        fill(im, 8, 24, 2, 4 - leg, pants)
        fill(im, 6, 28 + leg, 3, 2, SHOE)
        fill(im, 8, 27, 2, 2, SHOE)
        return im
    if facing == "up":
        fill(im, 4, hair_y, 8, 8, hair)
        if hat:
            fill(im, 3, hair_y - 2, 10, 3, hat)
            fill(im, 4, hair_y + 1, 8, 2, hat)
        fill(im, 4, 17, 8, 6, shirt)
        fill(im, 3, 18, 2, 4, shirt)
        fill(im, 11, 18, 2, 4, shirt)
        if vest:
            fill(im, 5, 18, 6, 5, vest)
        leg = frame
        fill(im, 5, 23, 3, 6, pants)
        fill(im, 9, 23, 3, 6, pants)
        px(im, 6, 26 + leg, SHOE)
        px(im, 10, 25 - leg, SHOE)
        fill(im, 5, 29, 3, 2, SHOE)
        fill(im, 9, 29, 3, 2, SHOE)
        return im
    # down
    if hat:
        fill(im, 3, 6, 10, 3, hat)
        fill(im, 4, 8, 8, 2, hat)
    fill(im, 4, 8 if not hat else 9, 8, 4, hair)
    fill(im, 5, 12, 6, 5, SKIN)
    px(im, 6, 14, EYE)
    px(im, 9, 14, EYE)
    px(im, 7, 16, SKIN2)
    if glasses:
        px(im, 5, 14, (186, 206, 206, 255))
        px(im, 6, 13, (90, 110, 112, 255))
        px(im, 9, 13, (90, 110, 112, 255))
        px(im, 10, 14, (186, 206, 206, 255))
        px(im, 7, 14, (90, 110, 112, 255))
        px(im, 8, 14, (90, 110, 112, 255))
    fill(im, 4, 17, 8, 6, shirt)
    fill(im, 3, 18, 2, 4, SKIN if dirt else shirt)
    fill(im, 11, 18, 2, 4, SKIN if dirt else shirt)
    if dirt:
        px(im, 3, 21, (122, 86, 52, 255))
        px(im, 12, 20, (122, 86, 52, 255))
    if vest:
        fill(im, 5, 18, 6, 5, vest)
    if board:
        fill(im, 11, 15, 4, 5, (236, 224, 196, 255))
        px(im, 12, 17, (92, 64, 42, 255))
        px(im, 13, 18, (92, 64, 42, 255))
    leg = frame
    fill(im, 4, 23, 3, 6, pants)
    fill(im, 9, 23, 3, 6, pants)
    fill(im, 4, 29, 3, 2, SHOE)
    fill(im, 9, 28 + (1 - leg), 3, 2, SHOE)
    if leg:
        fill(im, 4, 28, 3, 1, pants)
    return im

def bust(hair, shirt, hat=None, glasses=False, fox=False):
    im = blank(16, 16)
    if fox:
        fur = (214, 122, 58, 255)
        tip = (92, 56, 32, 255)
        fill(im, 3, 4, 10, 9, fur)
        fill(im, 2, 1, 3, 4, fur)
        fill(im, 11, 1, 3, 4, fur)
        px(im, 3, 1, tip)
        px(im, 12, 1, tip)
        px(im, 5, 8, (42, 36, 32, 255))
        px(im, 10, 8, (42, 36, 32, 255))
        px(im, 7, 10, (242, 214, 176, 255))
        fill(im, 12, 11, 3, 3, (126, 176, 168, 255))
        return im
    if hat:
        fill(im, 2, 1, 12, 3, hat)
    fill(im, 3, 3, 10, 5, hair)
    fill(im, 4, 7, 8, 6, SKIN)
    px(im, 6, 9, EYE)
    px(im, 10, 9, EYE)
    if glasses:
        px(im, 5, 9, (186, 210, 208, 255))
        px(im, 6, 8, (72, 96, 102, 255))
        px(im, 10, 8, (72, 96, 102, 255))
        px(im, 11, 9, (186, 210, 208, 255))
        px(im, 8, 9, (72, 96, 102, 255))
    fill(im, 4, 13, 8, 3, shirt)
    return im

def fox(frame=0, facing="down", pose="walk"):
    im = blank(16, 32)
    fur = (214, 122, 58, 255)
    dark = (92, 56, 32, 255)
    belly = (242, 214, 176, 255)
    tip = (126, 176, 168, 255)
    if pose == "sleep":
        fill(im, 2, 18, 10, 6, fur)
        fill(im, 1, 16, 3, 3, fur)
        px(im, 2, 15, dark)
        px(im, 4, 20, EYE)
        fill(im, 11, 20, 4, 3, tip)
        fill(im, 3, 23, 8, 2, belly)
        return im
    if pose == "rain":
        im = fox(frame, facing, "walk")
        px(im, 8, 4, (120, 168, 214, 255))
        px(im, 6, 6, (120, 168, 214, 255))
        px(im, 11, 3, (186, 214, 232, 255))
        return im
    if pose == "snow":
        im = fox(frame, facing, "walk")
        px(im, 3, 6, (236, 240, 244, 255))
        px(im, 12, 4, (236, 240, 244, 255))
        px(im, 8, 2, (236, 240, 244, 255))
        return im
    if facing == "up":
        fill(im, 5, 10, 6, 4, dark)
        fill(im, 4, 8, 2, 3, fur)
        fill(im, 10, 8, 2, 3, fur)
        fill(im, 5, 14, 6, 8, fur)
        fill(im, 12, 16, 3, 5, fur)
        px(im, 14, 20, tip)
        bob = frame
        fill(im, 5, 22, 2, 4, fur)
        fill(im, 9, 22 + bob, 2, 4, fur)
        return im
    if facing == "side":
        fill(im, 6, 8, 2, 4, fur)
        px(im, 6, 7, dark)
        fill(im, 5, 12, 6, 4, fur)
        px(im, 6, 13, (120, 64, 28, 255))
        fill(im, 4, 16, 6, 7, fur)
        fill(im, 5, 18, 3, 3, belly)
        fill(im, 2, 14, 3, 2, fur)
        fill(im, 1, 13, 2, 2, tip)
        bob = frame
        fill(im, 5, 23, 2, 5, fur)
        fill(im, 8, 23 + bob, 2, 4, fur)
        return im
    fill(im, 4, 7, 2, 4, fur)
    fill(im, 10, 7, 2, 4, fur)
    px(im, 4, 6, dark)
    px(im, 11, 6, dark)
    fill(im, 5, 11, 6, 5, fur)
    px(im, 6, 13, (120, 64, 28, 255))
    px(im, 9, 13, (120, 64, 28, 255))
    px(im, 7, 15, belly)
    fill(im, 5, 16, 6, 7, fur)
    fill(im, 6, 18, 4, 3, belly)
    fill(im, 11, 14, 3, 5, fur)
    px(im, 13, 18, tip)
    bob = frame
    fill(im, 5, 23, 2, 5, fur)
    fill(im, 9, 23 + bob, 2, 4, fur)
    return im

def into(sheet, row, frames):
    for col, im in enumerate(frames):
        box = (col * FW, row * FH, (col + 1) * FW, (row + 1) * FH)
        sheet.paste(Image.new("RGBA", (FW, FH), (0, 0, 0, 0)), box)
        big = im.resize((FW, FH), Image.Resampling.NEAREST)
        sheet.paste(big, (col * FW, row * FH), big)

def pack_human(**spec):
    frames = []
    for facing, mirror in (("down", False), ("side", False), ("side", True), ("up", False)):
        for frame in (0, 1):
            im = human(frame=frame, facing="side" if facing == "side" else facing, **{k: v for k, v in spec.items() if k != "bust"})
            if mirror:
                im = im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            frames.append(im)
    head = bust(**spec["bust"])
    head_big_src = head.resize((16, 16), Image.Resampling.NEAREST)
    bust_frame = blank(16, 32)
    bust_frame.paste(head_big_src, (0, 0))
    frames.append(bust_frame)
    return frames

def pack_fox(pose="walk"):
    frames = []
    for facing, mirror in (("down", False), ("side", False), ("side", True), ("up", False)):
        for frame in (0, 1):
            face = "down" if pose == "sleep" else ("side" if facing == "side" else facing)
            im = fox(frame, face, pose)
            if mirror and pose == "walk":
                im = im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            frames.append(im)
    head = bust(None, None, fox=True)
    bust_frame = blank(16, 32)
    bust_frame.paste(head, (0, 0))
    frames.append(bust_frame)
    return frames

def prop_icon(kind):
    im = blank(16, 16)
    g = (74, 132, 64, 255)
    soil = (122, 86, 52, 255)
    paper = (236, 226, 204, 255)
    ink = (62, 58, 72, 255)
    if kind == "seabreeze":
        fill(im, 7, 10, 2, 5, soil)
        fill(im, 4, 4, 2, 6, g)
        fill(im, 7, 3, 2, 7, (122, 176, 112, 255))
        fill(im, 10, 5, 2, 5, (92, 156, 148, 255))
        px(im, 8, 2, (186, 214, 160, 255))
    elif kind == "notebook":
        fill(im, 3, 2, 10, 12, paper)
        fill(im, 3, 2, 2, 12, (168, 96, 72, 255))
        fill(im, 7, 5, 4, 1, ink)
        fill(im, 7, 8, 4, 1, ink)
        fill(im, 7, 11, 3, 1, ink)
    elif kind == "photo":
        fill(im, 2, 3, 12, 10, paper)
        fill(im, 4, 5, 8, 5, (168, 196, 176, 255))
        fill(im, 7, 6, 2, 2, (214, 122, 58, 255))
    elif kind == "lantern":
        fill(im, 7, 1, 2, 2, ink)
        fill(im, 4, 3, 8, 8, (232, 96, 72, 255))
        fill(im, 6, 5, 4, 4, (255, 214, 140, 255))
        fill(im, 7, 11, 2, 3, ink)
    elif kind == "snowlamp":
        fill(im, 7, 1, 2, 2, ink)
        fill(im, 4, 3, 8, 8, (220, 228, 236, 255))
        fill(im, 6, 5, 4, 4, (255, 236, 186, 255))
        px(im, 3, 2, (236, 240, 244, 255))
        px(im, 12, 2, (236, 240, 244, 255))
    elif kind == "boat":
        fill(im, 3, 8, 10, 3, (92, 64, 42, 255))
        fill(im, 2, 7, 12, 2, (72, 52, 36, 255))
        fill(im, 8, 3, 2, 5, (62, 58, 56, 255))
        px(im, 9, 2, (42, 42, 42, 255))
    elif kind == "chart":
        fill(im, 2, 2, 12, 12, (214, 196, 156, 255))
        fill(im, 4, 8, 8, 3, (92, 148, 168, 255))
        px(im, 10, 5, (168, 64, 48, 255))
        px(im, 6, 6, (92, 148, 168, 255))
    elif kind == "shell":
        fill(im, 4, 6, 8, 6, (236, 214, 186, 255))
        fill(im, 6, 4, 4, 3, (246, 232, 210, 255))
        px(im, 7, 8, (196, 154, 120, 255))
        px(im, 9, 9, (196, 154, 120, 255))
    elif kind == "kelp":
        fill(im, 7, 2, 2, 12, (42, 110, 72, 255))
        fill(im, 5, 4, 2, 6, (56, 132, 86, 255))
        fill(im, 9, 6, 2, 6, (36, 96, 68, 255))
    elif kind == "tidestone":
        fill(im, 4, 5, 8, 7, (92, 156, 176, 255))
        fill(im, 6, 4, 4, 2, (142, 196, 206, 255))
        px(im, 7, 8, (230, 246, 246, 255))
    elif kind == "persimmon":
        fill(im, 4, 5, 8, 8, (214, 96, 42, 255))
        fill(im, 7, 3, 2, 2, (72, 110, 48, 255))
        px(im, 6, 7, (232, 140, 72, 255))
    elif kind == "fence":
        fill(im, 2, 4, 2, 10, (148, 112, 64, 255))
        fill(im, 12, 4, 2, 10, (148, 112, 64, 255))
        fill(im, 2, 6, 12, 2, (168, 128, 72, 255))
        fill(im, 2, 10, 12, 2, (148, 112, 64, 255))
    elif kind == "well":
        fill(im, 3, 6, 10, 7, (120, 116, 108, 255))
        fill(im, 5, 8, 6, 4, (64, 110, 140, 255))
        fill(im, 4, 4, 8, 2, (92, 72, 48, 255))
        fill(im, 7, 2, 2, 3, (92, 72, 48, 255))
    elif kind == "rubbing":
        fill(im, 3, 2, 10, 12, paper)
        fill(im, 5, 5, 6, 6, (92, 88, 80, 255))
        px(im, 7, 8, paper)
        px(im, 6, 11, (62, 58, 72, 255))
    return im

def main():
    sheet = Image.open(SHEET).convert("RGBA")
    people = {
        0: dict(hair=(48, 40, 36, 255), shirt=(64, 104, 150, 255), pants=(48, 58, 78, 255), bust=dict(hair=(48, 40, 36, 255), shirt=(64, 104, 150, 255))),
        2: dict(hair=(62, 48, 36, 255), shirt=(138, 186, 122, 255), pants=(72, 96, 68, 255), dirt=True, bust=dict(hair=(62, 48, 36, 255), shirt=(138, 186, 122, 255))),
        7: dict(hair=(176, 176, 176, 255), shirt=(86, 112, 132, 255), pants=(62, 68, 78, 255), hat=(92, 78, 58, 255), vest=(196, 168, 112, 255), bust=dict(hair=(176, 176, 176, 255), shirt=(196, 168, 112, 255), hat=(92, 78, 58, 255))),
        11: dict(hair=(42, 36, 32, 255), shirt=(214, 206, 190, 255), pants=(62, 58, 68, 255), glasses=True, vest=(72, 68, 82, 255), bust=dict(hair=(42, 36, 32, 255), shirt=(72, 68, 82, 255), glasses=True)),
    }
    need_h = 16 * FH
    if sheet.height < need_h:
        grown = Image.new("RGBA", (sheet.width, need_h), (0, 0, 0, 0))
        grown.paste(sheet, (0, 0))
        sheet = grown
    for row, spec in people.items():
        into(sheet, row, pack_human(**spec))
    into(sheet, 1, pack_fox("walk"))
    into(sheet, 12, pack_human(
        hair=(92, 62, 48, 255), shirt=(186, 154, 118, 255), pants=(92, 78, 64, 255), board=True,
        bust=dict(hair=(92, 62, 48, 255), shirt=(186, 154, 118, 255)),
    ))
    into(sheet, 13, pack_fox("sleep"))
    into(sheet, 14, pack_fox("rain"))
    into(sheet, 15, pack_fox("snow"))
    sheet.save(SHEET)

    kinds = ["seabreeze", "notebook", "photo", "lantern", "snowlamp", "boat", "chart", "shell", "kelp", "tidestone", "persimmon", "fence", "well", "rubbing"]
    strip = Image.new("RGBA", (16 * len(kinds), 16), (0, 0, 0, 0))
    for i, kind in enumerate(kinds):
        icon = prop_icon(kind)
        strip.paste(icon, (i * 16, 0), icon)
    PROPS.parent.mkdir(parents=True, exist_ok=True)
    strip.save(PROPS)
    print("sheet", sheet.size, "props", strip.size)

if __name__ == "__main__":
    main()
