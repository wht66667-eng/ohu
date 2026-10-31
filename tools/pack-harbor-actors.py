"""Pack generated walk strips into harbor-world-pack/actors.png. Does not rewrite world.json."""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(r"C:\Users\upwar\.cursor\projects\C-Users-upwar\assets")
OUT = ROOT / "harbor-world-pack" / "actors.png"
ORDER = [
    "harbor-you.png",
    "harbor-fox.png",
    "harbor-ning.png",
    "harbor-tea.png",
    "harbor-warden.png",
    "harbor-zhou.png",
    "harbor-coach.png",
    "harbor-dock.png",
    "harbor-clerk.png",
    "harbor-night.png",
    "harbor-senior.png",
    "harbor-lib.png",
]
TILE = 32
COLS = 9


def fg_mask(im: Image.Image):
    w, h = im.size
    pix = im.load()
    bg = pix[2, 2]
    br, bgc, bb = bg[0], bg[1], bg[2]

    def far(x: int, y: int) -> bool:
        r, g, b, a = pix[x, y]
        if a < 16:
            return False
        return abs(r - br) + abs(g - bgc) + abs(b - bb) > 70

    cols = [0] * w
    for y in range(h):
        for x in range(w):
            if far(x, y):
                cols[x] += 1
    return cols, far


def spans(cols: list[int]) -> list[tuple[int, int]]:
    runs = []
    start = None
    for i, n in enumerate(cols):
        if n > 3 and start is None:
            start = i
        elif n <= 3 and start is not None:
            if i - start > 8:
                runs.append((start, i - 1))
            start = None
    if start is not None and len(cols) - start > 8:
        runs.append((start, len(cols) - 1))
    if not runs:
        return []
    widths = [b - a + 1 for a, b in runs]
    mid = sorted(widths)[len(widths) // 2]
    out = []
    for a, b in runs:
        width = b - a + 1
        pieces = max(1, round(width / max(mid, 1)))
        if pieces == 1 or width < mid * 1.45:
            out.append((a, b))
            continue
        step = width / pieces
        for k in range(pieces):
            left = a + int(round(k * step))
            right = a + int(round((k + 1) * step)) - 1
            if right > left:
                out.append((left, right))
    return out


def boxes_for(im: Image.Image):
    w, h = im.size
    cols, far = fg_mask(im)
    row_boxes = []
    for left, right in spans(cols):
        top = h
        bot = 0
        hits = 0
        for y in range(h):
            for x in range(left, right + 1):
                if far(x, y):
                    hits += 1
                    top = min(top, y)
                    bot = max(bot, y)
        if hits > 40 and bot > top:
            row_boxes.append((left, top, right, bot, hits))
    if len(row_boxes) > COLS:
        body = row_boxes[:-1]
        while len(body) > COLS - 1:
            body.pop(-1)
        row_boxes = body + [row_boxes[-1]]
    return row_boxes


def fit(im: Image.Image, box, portrait: bool, mirror: bool = False) -> Image.Image:
    crop = im.crop((box[0], box[1], box[2] + 1, box[3] + 1))
    pix = crop.load()
    src = im.load()
    br, bgc, bb = src[2, 2][0], src[2, 2][1], src[2, 2][2]
    w, h = crop.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = pix[x, y]
            if a < 16 or abs(r - br) + abs(g - bgc) + abs(b - bb) <= 70:
                pix[x, y] = (0, 0, 0, 0)
    target = 30 if not portrait else 32
    scale = target / max(w, h)
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    small = crop.resize((nw, nh), Image.Resampling.BOX)
    if mirror:
        small = small.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    cell = Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0))
    ox = (TILE - nw) // 2
    oy = (TILE - nh) // 2 if portrait else TILE - nh - 1
    cell.paste(small, (ox, oy), small)
    return cell


def main() -> None:
    sheet = Image.new("RGBA", (TILE * COLS, TILE * len(ORDER)), (0, 0, 0, 0))
    for row, name in enumerate(ORDER):
        im = Image.open(SRC / name).convert("RGBA")
        boxes = boxes_for(im)
        jobs = [(box, False) for box in boxes]
        if name == "harbor-senior.png" and len(boxes) >= 8:
            b = boxes
            jobs = [
                (b[0], False),
                (b[1], False),
                (b[2], False),
                (b[3], False),
                (b[2], True),
                (b[3], True),
                (b[-3], False),
                (b[-2], False),
                (b[-1], False),
            ]
        print(name, im.size, "parts", len(boxes), [b[2] - b[0] for b in boxes])
        for col, (box, mirror) in enumerate(jobs[:COLS]):
            cell = fit(im, box, col == COLS - 1, mirror)
            sheet.paste(cell, (col * TILE, row * TILE), cell)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT)
    print("wrote", OUT, sheet.size)


if __name__ == "__main__":
    main()
