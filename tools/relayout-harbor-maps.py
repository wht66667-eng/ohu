# -*- coding: utf-8 -*-
"""Reshape the ten harbor maps. Walkable ground is a jagged blob, not a square yard."""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "harbor-world-pack"
WALK = {0, 1, 4, 6, 7, 8, 9, 10}
BLOCK = {2, 3, 5}

KIND = {
    "nest": "den",
    "campus": "hall",
    "hill": "stall",
    "port": "warehouse",
    "beach": "lookout",
    "dorm": "dorm",
    "street": "shop",
    "library": "library",
    "field": "stand",
    "night": "market",
}


def blank(cols, rows, tile=3):
    return [[tile for _ in range(cols)] for _ in range(rows)]


def inside(grid, x, y):
    return 0 <= x < len(grid[0]) and 0 <= y < len(grid)


def paint(grid, cells, tile, frozen=None):
    for x, y in cells:
        if not inside(grid, x, y):
            continue
        if x == 0 or y == 0 or x == len(grid[0]) - 1 or y == len(grid) - 1:
            continue
        grid[y][x] = tile
        if frozen is not None and tile in (2, 5, 3):
            frozen.add((x, y))


def disk(cx, cy, rx, ry):
    cells = []
    for y in range(int(cy - ry - 1), int(cy + ry + 2)):
        for x in range(int(cx - rx - 1), int(cx + rx + 2)):
            wobble = 0.16 * math.sin(x * 1.3 + y * 0.45) + 0.1 * math.cos(y * 1.7 - x * 0.2)
            nx = (x - cx) / max(rx, 0.1)
            ny = (y - cy) / max(ry, 0.1)
            if nx * nx + ny * ny <= (1 + wobble) ** 2:
                cells.append((x, y))
    return cells


def line(x0, y0, x1, y1):
    cells = []
    dx, dy = abs(x1 - x0), abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err = dx - dy
    x, y = x0, y0
    while True:
        cells.append((x, y))
        if x == x1 and y == y1:
            break
        e2 = 2 * err
        if e2 > -dy:
            err -= dy
            x += sx
        if e2 < dx:
            err += dx
            y += sy
    return cells


def thick(cells, r=0):
    out = []
    for x, y in cells:
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if abs(dx) + abs(dy) <= r + 1:
                    out.append((x + dx, y + dy))
    return out


def rect(x, y, w, h):
    return [(x + dx, y + dy) for dy in range(h) for dx in range(w)]


def carve_blob(grid, cx, cy, rx, ry):
    paint(grid, disk(cx, cy, rx, ry), 0)


def bite_corner(grid, corner):
    cols, rows = len(grid[0]), len(grid)
    if corner == "nw":
        paint(grid, disk(1, 1, 4.2, 3.2), 3)
    elif corner == "ne":
        paint(grid, disk(cols - 2, 1, 4.5, 3.4), 3)
    elif corner == "sw":
        paint(grid, disk(1, rows - 2, 4.4, 3.2), 3)
    else:
        paint(grid, disk(cols - 2, rows - 2, 5.2, 3.6), 3)


def seal_rim(grid):
    cols, rows = len(grid[0]), len(grid)
    for x in range(cols):
        grid[0][x] = 3
        grid[rows - 1][x] = 3
    for y in range(rows):
        grid[y][0] = 3
        grid[y][cols - 1] = 3


def door_cell(grid, edge, along):
    cols, rows = len(grid[0]), len(grid)
    if edge == "W":
        return 1, along
    if edge == "E":
        return cols - 2, along
    if edge == "N":
        return along, 1
    return along, rows - 2


def open_mouth(grid, x, y, frozen):
    cols, rows = len(grid[0]), len(grid)
    if x <= 1:
        step = (1, 0)
    elif x >= cols - 2:
        step = (-1, 0)
    elif y <= 1:
        step = (0, 1)
    else:
        step = (0, -1)
    for n in range(0, 4):
        nx, ny = x + step[0] * n, y + step[1] * n
        if not inside(grid, nx, ny):
            continue
        if n == 0:
            grid[ny][nx] = 10
        else:
            if (nx, ny) in frozen and grid[ny][nx] == 2:
                frozen.discard((nx, ny))
            grid[ny][nx] = 1
    ax, ay = x + step[0] * 2, y + step[1] * 2
    return ax, ay


def show(grid):
    chars = {0: ".", 1: "-", 2: "~", 3: "#", 4: "=", 5: "T", 6: "*", 7: "t", 8: "s", 9: "d", 10: "G", 15: "w"}
    return "\n".join("".join(chars.get(t, "?") for t in row) for row in grid)


def build_maps():
    frozen = {mid: set() for mid in KIND}
    grids = {}

    nest = blank(26, 18)
    carve_blob(nest, 12, 9, 11.2, 6.4)
    bite_corner(nest, "nw")
    bite_corner(nest, "se")
    paint(nest, rect(1, 1, 4, 3), 4)
    paint(nest, disk(16, 6, 3.2, 1.6), 4)
    paint(nest, disk(15, 9, 2.2, 1.4), 4)
    creek = thick(line(19, 3, 22, 8) + line(22, 8, 20, 13), 0)
    paint(nest, creek, 2, frozen[ "nest"])
    house = rect(5, 7, 3, 3)
    paint(nest, house, 3, frozen["nest"])
    fruit = [(4, 6), (8, 11), (6, 12), (14, 12)]
    paint(nest, fruit, 5, frozen["nest"])
    paint(nest, [(5, 6), (4, 7), (9, 11), (7, 12), (14, 11)], 6)
    paint(nest, [(10, 4), (11, 13), (3, 10)], 7)
    paint(nest, thick(line(3, 5, 4, 5) + line(4, 5, 4, 10) + line(4, 10, 12, 10) + line(12, 10, 12, 4) + line(12, 4, 17, 6), 0), 1)
    grids["nest"] = nest

    campus = blank(28, 20)
    carve_blob(campus, 13, 10, 12.4, 7.6)
    bite_corner(campus, "ne")
    bite_corner(campus, "sw")
    pond = disk(11, 12, 3.4, 2.2)
    paint(campus, pond, 2, frozen["campus"])
    hall = rect(15, 6, 4, 3)
    paint(campus, hall, 3, frozen["campus"])
    paint(campus, [(9, 14), (10, 14), (11, 15)], 4)
    paint(campus, [(6, 8), (18, 11), (20, 8), (8, 4)], 5, frozen["campus"])
    paint(campus, [(19, 10), (7, 7)], 6)
    paint(campus, [(4, 11), (21, 13)], 7)
    path = line(3, 8, 9, 8) + line(9, 8, 10, 10) + line(10, 10, 14, 10) + line(14, 10, 14, 7) + line(14, 7, 20, 7) + line(20, 7, 24, 8)
    path += line(8, 8, 8, 14) + line(16, 10, 16, 15) + line(12, 15, 20, 15)
    paint(campus, path, 1)
    grids["campus"] = campus

    hill = blank(16, 28)
    carve_blob(hill, 8, 14, 6.2, 12.2)
    bite_corner(hill, "nw")
    bite_corner(hill, "se")
    trickle = line(12, 4, 13, 12) + line(13, 12, 12, 20)
    paint(hill, trickle, 2, frozen["hill"])
    stall = rect(6, 10, 3, 2)
    paint(hill, stall, 3, frozen["hill"])
    grove = [(5, 8), (8, 8), (6, 16), (8, 17), (5, 18)]
    paint(hill, grove, 5, frozen["hill"])
    paint(hill, [(6, 8), (7, 8), (5, 17), (7, 17), (6, 18)], 6)
    paint(hill, [(4, 6), (10, 21)], 7)
    zig = line(3, 14, 5, 14) + line(5, 14, 5, 8) + line(5, 8, 9, 6) + line(9, 6, 9, 12) + line(9, 12, 6, 16) + line(6, 16, 8, 22) + line(8, 22, 11, 22)
    paint(hill, zig, 1)
    grids["hill"] = hill

    port = blank(26, 18)
    carve_blob(port, 11, 8, 11.5, 6.6)
    bite_corner(port, "nw")
    bay = disk(18, 13, 7.5, 4.8)
    paint(port, bay, 2, frozen["port"])
    pier = line(12, 9, 18, 11) + line(18, 11, 18, 13)
    paint(port, pier, 9)
    for x, y in pier:
        frozen["port"].discard((x, y))
    shed = rect(5, 4, 4, 2)
    paint(port, shed, 3, frozen["port"])
    paint(port, [(8, 6), (10, 5)], 5, frozen["port"])
    paint(port, [(4, 8), (7, 8)], 8)
    paint(port, line(3, 7, 10, 7) + line(10, 7, 12, 9), 1)
    grids["port"] = port

    beach = blank(30, 16)
    carve_blob(beach, 14, 8, 13.5, 6.2)
    bite_corner(beach, "sw")
    bite_corner(beach, "ne")
    for y in range(1, 15):
        for x in range(1, 29):
            coast = 10 + y * 1.15 + 1.4 * math.sin(y * 0.7)
            if x > coast:
                beach[y][x] = 2
                frozen["beach"].add((x, y))
            elif x > coast - 3.2 and beach[y][x] == 0:
                beach[y][x] = 8
    paint(beach, [(5, 5), (8, 7), (4, 10)], 5, frozen["beach"])
    paint(beach, [(6, 5), (8, 8), (5, 10)], 6)
    paint(beach, line(4, 7, 11, 6) + line(11, 6, 16, 8), 1)
    look = rect(11, 6, 3, 2)
    paint(beach, look, 3, frozen["beach"])
    grids["beach"] = beach

    dorm = blank(20, 16)
    carve_blob(dorm, 10, 8, 8.4, 6.1)
    bite_corner(dorm, "se")
    paint(dorm, rect(8, 5, 4, 3), 3, frozen["dorm"])
    paint(dorm, [(14, 8)], 2, frozen["dorm"])
    paint(dorm, [(4, 5), (5, 11), (14, 5)], 5, frozen["dorm"])
    paint(dorm, [(5, 5)], 6)
    paint(dorm, line(3, 8, 8, 8) + line(8, 8, 8, 9) + line(12, 8, 16, 10), 1)
    grids["dorm"] = dorm

    street = blank(26, 16)
    carve_blob(street, 12, 8, 11.2, 6.0)
    bite_corner(street, "nw")
    bite_corner(street, "se")
    paint(street, rect(10, 6, 4, 3), 3, frozen["street"])
    paint(street, [(5, 5), (17, 5), (18, 10)], 5, frozen["street"])
    paint(street, [(6, 5)], 6)
    paint(street, line(4, 8, 10, 9) + line(14, 8, 20, 8) + line(8, 4, 8, 8), 1)
    grids["street"] = street

    library = blank(18, 22)
    carve_blob(library, 9, 11, 7.2, 9.4)
    bite_corner(library, "sw")
    bite_corner(library, "ne")
    paint(library, rect(7, 7, 4, 4), 3, frozen["library"])
    paint(library, [(4, 6), (13, 6), (5, 14), (12, 15)], 5, frozen["library"])
    paint(library, line(4, 4, 7, 7) + line(7, 12, 9, 16) + line(11, 10, 14, 10), 1)
    grids["library"] = library

    field = blank(26, 18)
    carve_blob(field, 13, 9, 11.4, 7.0)
    bite_corner(field, "nw")
    bite_corner(field, "se")
    court = disk(12, 10, 4.2, 2.6)
    paint(field, court, 7)
    paint(field, rect(16, 4, 4, 2), 3, frozen["field"])
    paint(field, [(5, 5), (6, 13), (18, 12)], 5, frozen["field"])
    paint(field, line(5, 5, 8, 8) + line(8, 8, 12, 8) + line(16, 6, 16, 8) + line(16, 8, 20, 10), 1)
    grids["field"] = field

    night = blank(24, 16)
    carve_blob(night, 11, 8, 10.2, 5.8)
    bite_corner(night, "sw")
    canal = line(16, 3, 18, 8) + line(18, 8, 17, 12)
    paint(night, canal, 2, frozen["night"])
    paint(night, [(17, 6), (17, 7)], 9)
    paint(night, rect(7, 6, 5, 2), 3, frozen["night"])
    paint(night, [(4, 5), (5, 10), (13, 11)], 5, frozen["night"])
    paint(night, [(5, 5)], 6)
    paint(night, line(4, 8, 7, 8) + line(12, 7, 16, 7), 1)
    grids["night"] = night

    doors = {
        "nest": [("E", 6, "campus", "去教学区"), ("E", 12, "beach", "沿海路去连岛")],
        "campus": [
            ("W", 8, "nest", "回窝边田"),
            ("E", 7, "hill", "上花果山路"),
            ("E", 10, "port", "去港口"),
            ("S", 6, "dorm", "去宿舍区"),
            ("S", 10, "street", "去商业街"),
            ("S", 15, "library", "去图书馆"),
            ("S", 20, "field", "去体育场"),
        ],
        "hill": [("W", 14, "campus", "回教学区")],
        "port": [("W", 7, "campus", "回教学区"), ("N", 16, "beach", "去连岛滩")],
        "beach": [("N", 12, "port", "回港口"), ("W", 7, "nest", "沿海路回窝")],
        "dorm": [("W", 8, "campus", "回教学区")],
        "street": [("N", 8, "campus", "回教学区"), ("E", 8, "night", "去夜市")],
        "library": [("N", 6, "campus", "回教学区")],
        "field": [("N", 8, "campus", "回教学区")],
        "night": [("N", 8, "street", "回商业街")],
    }

    placed = {}
    landings = {}
    for mid, specs in doors.items():
        placed[mid] = []
        for edge, along, dest, label in specs:
            x, y = door_cell(grids[mid], edge, along)
            ax, ay = open_mouth(grids[mid], x, y, frozen[mid])
            placed[mid].append({"x": x, "y": y, "to": dest, "label": label, "ax": ax, "ay": ay})

    # Pair each door with the return door's inward tile.
    for mid, specs in placed.items():
        for door in specs:
            back = next(d for d in placed[door["to"]] if d["to"] == mid)
            door["tx"], door["ty"] = back["ax"], back["ay"]
            landings.setdefault(door["to"], []).append((door["tx"], door["ty"]))

    pins = {
        "nest": {"spawn": (3, 5), "ning": (2, 3), "foxnote": (12, 9), "hopper": (10, 8), "ning_field": (5, 3), "ning_dusk": (3, 5)},
        "campus": {"spawn": (3, 8), "zhou": (5, 7), "cat": (6, 12), "kite": (18, 13), "zhou_yard": (6, 5), "zhou_night": (3, 6), "ning_visit": (8, 6)},
        "hill": {"spawn": (4, 14), "tea": (5, 12), "vine": (10, 15), "tea_noon": (7, 5)},
        "port": {"spawn": (4, 7), "dock": (12, 9), "gull": (8, 7), "jelly": (10, 8), "dock_ship": (11, 8), "dock_rest": (9, 6)},
        "beach": {"spawn": (6, 6), "senior": (10, 6), "gull2": (5, 8), "shell": (9, 8)},
        "dorm": {"spawn": (3, 8), "warden": (6, 9), "lampmoth": (14, 6)},
        "street": {"spawn": (5, 8), "clerk": (8, 9), "signfox": (16, 6)},
        "library": {"spawn": (4, 5), "lib": (6, 12), "pagewing": (13, 10), "lib_morn": (8, 4)},
        "field": {"spawn": (6, 8), "coach": (14, 7), "trackbird": (8, 12)},
        "night": {"spawn": (5, 8), "nightstall": (6, 8), "lanterncrab": (14, 7)},
    }

    for mid, people in pins.items():
        grid = grids[mid]
        for key, (x, y) in people.items():
            if not inside(grid, x, y) or grid[y][x] in BLOCK or grid[y][x] == 10:
                grid[y][x] = 1 if key != "ning_field" else 4
            if key == "ning_field":
                grid[y][x] = 4

    must = {}
    for mid, people in pins.items():
        must[mid] = [xy for key, xy in people.items() if key == "spawn" or not key.endswith(("_field", "_dusk", "_yard", "_night", "_visit", "_noon", "_ship", "_rest", "_morn"))]
        for door in placed[mid]:
            must[mid].append((door["x"], door["y"]))
            must[mid].append((door["ax"], door["ay"]))

    boxes = {
        "nest": (5, 7, 3, 3),
        "campus": (15, 6, 4, 3),
        "hill": (6, 10, 3, 2),
        "port": (5, 4, 4, 2),
        "beach": (11, 6, 3, 2),
        "dorm": (8, 5, 4, 3),
        "street": (10, 6, 4, 3),
        "library": (7, 7, 4, 4),
        "field": (16, 4, 4, 2),
        "night": (7, 6, 5, 2),
    }

    problems = []
    for mid, grid in grids.items():
        x, y, w, h = boxes[mid]
        paint(grid, rect(x, y, w, h), 3, frozen[mid])
        seal_rim(grid)
        for door in placed[mid]:
            grid[door["y"]][door["x"]] = 10
            open_mouth(grid, door["x"], door["y"], frozen[mid])
        cols, rows = len(grid[0]), len(grid)
        if cols == rows:
            problems.append(f"{mid} is square")
        seen = bfs(grid, pins[mid]["spawn"])
        for x, y in must[mid]:
            if (x, y) not in seen:
                problems.append(f"{mid} blocked reach {x},{y} tile {grid[y][x]}")
        for door in placed[mid]:
            dest_grid = grids[door["to"]]
            if door["ty"] >= len(dest_grid) or door["tx"] >= len(dest_grid[0]) or dest_grid[door["ty"]][door["tx"]] not in WALK:
                problems.append(f"{mid}->{door['to']} landing {door['tx']},{door['ty']} not walkable")
            if any(d["x"] == door["tx"] and d["y"] == door["ty"] for d in placed[door["to"]]):
                problems.append(f"{mid}->{door['to']} lands on a door")
        walk = sum(1 for row in grid for t in row if t in WALK)
        water = sum(1 for row in grid for t in row if t == 2)
        soil = sum(1 for row in grid for t in row if t == 4)
        trees = sum(1 for row in grid for t in row if t == 5)
        if walk < 70:
            problems.append(f"{mid} walk {walk} too small")
        if mid in ("nest", "campus", "hill", "port", "beach", "night") and water < 4:
            problems.append(f"{mid} water {water}")
        if mid == "nest" and soil < 8:
            problems.append(f"nest soil {soil}")
        if mid in ("nest", "hill", "beach") and trees < 3:
            problems.append(f"{mid} fruit trees {trees}")
        fruit = 0
        for y, row in enumerate(grid):
            for x, tile in enumerate(row):
                if tile != 5:
                    continue
                if any(inside(grid, x + dx, y + dy) and grid[y + dy][x + dx] == 6 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    fruit += 1
        if mid in ("nest", "hill", "beach") and fruit < 2:
            problems.append(f"{mid} flowering fruit {fruit}")
        if problems and any(p.startswith(mid) or p.startswith(f"{mid}->") for p in problems):
            pass

    if problems:
        for mid, grid in grids.items():
            print("---", mid, len(grid[0]), "x", len(grid))
            print(show(grid))
        raise SystemExit("\n".join(problems))

    marks = {}
    for mid, (x, y, w, h) in boxes.items():
        marks[mid] = {"x": x, "y": y, "w": w, "h": h, "kind": KIND[mid]}
    return grids, placed, pins, marks


def bfs(grid, start):
    cols, rows = len(grid[0]), len(grid)
    sx, sy = start
    if grid[sy][sx] not in WALK:
        return set()
    seen = {(sx, sy)}
    q = [(sx, sy)]
    while q:
        x, y = q.pop()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if not inside(grid, nx, ny) or (nx, ny) in seen:
                continue
            if grid[ny][nx] not in WALK:
                continue
            seen.add((nx, ny))
            q.append((nx, ny))
    return seen


def main():
    grids, placed, pins, marks = build_maps()
    world = json.loads((PACK / "world.json").read_text(encoding="utf-8"))
    regions = json.loads((PACK / "regions.json").read_text(encoding="utf-8"))
    by_id = {m["id"]: m for m in world["maps"] + regions["maps"]}
    actor_key = {
        "ning": "ning",
        "foxnote": "foxnote",
        "hopper": "hopper",
        "zhou": "zhou",
        "cat": "cat",
        "kite": "kite",
        "tea": "tea",
        "vine": "vine",
        "dock": "dock",
        "gull": "gull",
        "jelly": "jelly",
        "senior": "senior",
        "gull2": "gull2",
        "shell": "shell",
        "warden": "warden",
        "lampmoth": "lampmoth",
        "clerk": "clerk",
        "signfox": "signfox",
        "lib": "lib",
        "pagewing": "pagewing",
        "coach": "coach",
        "trackbird": "trackbird",
        "nightstall": "nightstall",
        "lanterncrab": "lanterncrab",
    }
    for mid, grid in grids.items():
        area = by_id[mid]
        area["cols"] = len(grid[0])
        area["rows"] = len(grid)
        area["ground"] = grid
        area["spawn"] = list(pins[mid]["spawn"])
        area["warps"] = [
            {"x": d["x"], "y": d["y"], "to": d["to"], "tx": d["tx"], "ty": d["ty"], "label": d["label"]}
            for d in placed[mid]
        ]
        area["landmark"] = marks[mid]
        for group in ("npcs", "animals", "spirits"):
            for actor in area[group]:
                pin = pins[mid].get(actor["id"])
                if pin:
                    actor["x"], actor["y"] = pin
    (PACK / "world.json").write_text(json.dumps(world, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (PACK / "regions.json").write_text(json.dumps(regions, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for mid, grid in grids.items():
        walk = sum(t in WALK for row in grid for t in row)
        print(mid, len(grid[0]), "x", len(grid), "walk", walk, "mark", marks[mid]["kind"] if marks[mid] else None, "doors", [(d["to"], d["x"], d["y"], d["tx"], d["ty"]) for d in placed[mid]])


if __name__ == "__main__":
    main()
