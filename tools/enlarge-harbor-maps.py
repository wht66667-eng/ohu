# -*- coding: utf-8 -*-
"""Make each harbor map larger without turning trees and doors into blocks."""
import json
import random
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "harbor-world-pack"
S = 3
AREA = {0, 1, 2, 3, 4, 8, 9, 11, 15}
POINT = {5, 6, 7, 10}
BLOCK = {2, 3, 5}


def scale_ground(old):
    rows, cols = len(old), len(old[0])
    nr, nc = rows * S, cols * S
    new = [[3 for _ in range(nc)] for _ in range(nr)]
    for y in range(rows):
        for x in range(cols):
            tile = old[y][x]
            for dy in range(S):
                for dx in range(S):
                    ny, nx = y * S + dy, x * S + dx
                    if tile in POINT:
                        if dx == 0 and dy == 0:
                            new[ny][nx] = tile
                        else:
                            new[ny][nx] = 1 if tile == 10 else 0
                    else:
                        new[ny][nx] = tile
    for x in range(nc):
        new[0][x] = 3
        new[nr - 1][x] = 3
    for y in range(nr):
        new[y][0] = 3
        new[y][nc - 1] = 3
    return new


def scatter(grid, warps):
    rng = random.Random(28)
    rows, cols = len(grid), len(grid[0])
    doors = {(w["x"], w["y"]) for w in warps}

    def near_door(x, y):
        return any(max(abs(x - dx), abs(y - dy)) <= 2 for dx, dy in doors)

    for y in range(2, rows - 2):
        for x in range(2, cols - 2):
            if grid[y][x] != 0 or near_door(x, y):
                continue
            roll = rng.randrange(100)
            if roll < 4:
                grid[y][x] = 6
            elif roll < 7:
                grid[y][x] = 7


def walkable(tile):
    return tile not in BLOCK


def reaches(grid, spawn):
    rows, cols = len(grid), len(grid[0])
    sx, sy = spawn
    if not (0 <= sx < cols and 0 <= sy < rows) or not walkable(grid[sy][sx]):
        return set()
    seen = {(sx, sy)}
    q = deque([(sx, sy)])
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if (nx, ny) in seen or not (0 <= nx < cols and 0 <= ny < rows):
                continue
            if not walkable(grid[ny][nx]):
                continue
            seen.add((nx, ny))
            q.append((nx, ny))
    return seen


def nearest(grid, x, y, seen):
    rows, cols = len(grid), len(grid[0])
    best = None
    for sy in range(rows):
        for sx in range(cols):
            if (sx, sy) not in seen:
                continue
            dist = abs(sx - x) + abs(sy - y)
            if best is None or dist < best[0]:
                best = (dist, sx, sy)
    return best[1], best[2]


def scale_point(value):
    return int(value) * S


def main():
    world = json.loads((PACK / "world.json").read_text(encoding="utf-8"))
    regions = json.loads((PACK / "regions.json").read_text(encoding="utf-8"))
    if any(area["cols"] > 40 for area in world["maps"]):
        raise SystemExit("maps already enlarged; refusing to scale again")
    for area in world["maps"] + regions["maps"]:
        area["ground"] = scale_ground(area["ground"])
        area["cols"] = len(area["ground"][0])
        area["rows"] = len(area["ground"])
        area["spawn"] = [scale_point(area["spawn"][0]), scale_point(area["spawn"][1])]
        for warp in area.get("warps", []):
            for key in ("x", "y", "tx", "ty"):
                warp[key] = scale_point(warp[key])
        mark = area.get("landmark")
        if mark:
            for key in ("x", "y", "w", "h"):
                mark[key] = scale_point(mark[key])
        for group in ("npcs", "animals", "spirits"):
            for actor in area.get(group, []):
                actor["x"] = scale_point(actor["x"])
                actor["y"] = scale_point(actor["y"])
        scatter(area["ground"], area.get("warps", []))
        seen = reaches(area["ground"], area["spawn"])
        if not seen:
            raise SystemExit(f"{area['id']} spawn blocked")
        for group in ("npcs", "animals", "spirits"):
            for actor in area.get(group, []):
                if (actor["x"], actor["y"]) not in seen:
                    actor["x"], actor["y"] = nearest(area["ground"], actor["x"], actor["y"], seen)
        for warp in area.get("warps", []):
            if (warp["x"], warp["y"]) not in seen:
                raise SystemExit(f"{area['id']} lost door {warp['to']}")
            if (warp["tx"], warp["ty"]) not in seen and warp["to"] == area["id"]:
                pass
        print(area["id"], area["cols"], "x", area["rows"], "walk", sum(walkable(t) for row in area["ground"] for t in row))
    # Landings live on the destination map. Check them after every map exists.
    by_id = {area["id"]: area for area in world["maps"] + regions["maps"]}
    for area in by_id.values():
        for warp in area.get("warps", []):
            dest = by_id[warp["to"]]
            seen = reaches(dest["ground"], dest["spawn"])
            if (warp["tx"], warp["ty"]) not in seen:
                warp["tx"], warp["ty"] = nearest(dest["ground"], warp["tx"], warp["ty"], seen)
                print("moved landing", area["id"], "->", warp["to"], warp["tx"], warp["ty"])
    (PACK / "world.json").write_text(json.dumps(world, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (PACK / "regions.json").write_text(json.dumps(regions, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
