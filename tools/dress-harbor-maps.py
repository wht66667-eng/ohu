# -*- coding: utf-8 -*-
"""Give each harbor map a different ground mix. Doors, water, trees and soil stay put."""
import json
from pathlib import Path

PACK = Path(__file__).resolve().parents[1] / "harbor-world-pack"
BLOCK = {2, 3, 5}


def near_warp(warps, x, y):
    return any(max(abs(w["x"] - x), abs(w["y"] - y)) <= 1 for w in warps)


def dress(area):
    g = area["ground"]
    rows, cols = len(g), len(g[0])
    mid = area["id"]
    docks = 0
    for y in range(2, rows - 2):
        for x in range(2, cols - 2):
            if near_warp(area["warps"], x, y):
                continue
            tile = g[y][x]
            n = (x * 17 + y * 13 + len(mid) * 3) % 100
            if tile == 0:
                pick = None
                if mid == "nest" and n < 18:
                    pick = 6
                elif mid == "nest" and n < 26:
                    pick = 7
                elif mid == "hill" and n < 28:
                    pick = 7
                elif mid == "hill" and n < 38:
                    pick = 6
                elif mid == "campus" and n < 14:
                    pick = 6
                elif mid == "campus" and n < 20:
                    pick = 7
                elif mid == "beach" and n < 12:
                    pick = 6
                elif mid == "port" and n < 10:
                    pick = 8
                elif mid == "dorm" and n < 16:
                    pick = 6
                elif mid == "street" and n < 14:
                    pick = 15
                elif mid == "library" and n < 20:
                    pick = 15
                elif mid == "field" and n < 14:
                    pick = 6
                elif mid == "night" and n < 14:
                    pick = 6
                elif mid == "night" and n < 22:
                    pick = 15
                if pick is not None:
                    g[y][x] = pick
            if mid == "port" and docks < 8 and g[y][x] == 0:
                if any(g[y + dy][x + dx] == 2 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    g[y][x] = 9
                    docks += 1


def walkable(tile):
    return tile not in BLOCK


def reaches(area):
    g = area["ground"]
    rows, cols = len(g), len(g[0])
    sx, sy = area["spawn"]
    if not walkable(g[sy][sx]):
        return False, "spawn"
    seen = {(sx, sy)}
    stack = [(sx, sy)]
    while stack:
        x, y = stack.pop()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < cols and 0 <= ny < rows) or (nx, ny) in seen:
                continue
            if not walkable(g[ny][nx]):
                continue
            seen.add((nx, ny))
            stack.append((nx, ny))
    for group in ("npcs", "animals", "spirits"):
        for actor in area[group]:
            if (actor["x"], actor["y"]) not in seen:
                return False, actor["id"]
    for warp in area["warps"]:
        if (warp["x"], warp["y"]) not in seen or (warp["tx"], warp["ty"]) not in seen and False:
            pass
        if (warp["x"], warp["y"]) not in seen:
            return False, f"door {warp['to']}"
    return True, ""


def main():
    world = json.loads((PACK / "world.json").read_text(encoding="utf-8"))
    regions = json.loads((PACK / "regions.json").read_text(encoding="utf-8"))
    for area in world["maps"] + regions["maps"]:
        dress(area)
        ok, why = reaches(area)
        if not ok:
            raise SystemExit(f"{area['id']} lost {why}")
        flowers = sum(t == 6 for row in area["ground"] for t in row)
        tall = sum(t == 7 for row in area["ground"] for t in row)
        dock = sum(t == 9 for row in area["ground"] for t in row)
        wood = sum(t == 15 for row in area["ground"] for t in row)
        print(area["id"], "flower", flowers, "tall", tall, "dock", dock, "wood", wood)
    (PACK / "world.json").write_text(json.dumps(world, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (PACK / "regions.json").write_text(json.dumps(regions, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
