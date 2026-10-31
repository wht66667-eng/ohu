"""Fit each harbor map to a 20 by 20 room and slide doors onto the rim.

Existing fields, spawns, and saved plots stay on their original tiles.
"""
import json
from pathlib import Path

PACK = Path(__file__).resolve().parents[1] / "harbor-world-pack"
SIZE = 20
EDGE = SIZE - 2
WALL = 3
PATH = 1


def crop(world_map: dict) -> None:
    ground = world_map["ground"]
    trimmed = [row[:SIZE] for row in ground[:SIZE]]
    while len(trimmed) < SIZE:
        trimmed.append([WALL] * SIZE)
    for row in trimmed:
        while len(row) < SIZE:
            row.append(WALL)
    for i in range(SIZE):
        trimmed[0][i] = WALL
        trimmed[SIZE - 1][i] = WALL
        trimmed[i][0] = WALL
        trimmed[i][SIZE - 1] = WALL
    world_map["ground"] = trimmed
    world_map["cols"] = SIZE
    world_map["rows"] = SIZE


def rim(x: int, y: int) -> tuple[int, int]:
    x = max(1, min(EDGE, x))
    y = max(1, min(EDGE, y))
    choices = [(1, y), (EDGE, y), (x, 1), (x, EDGE)]
    return min(choices, key=lambda spot: abs(spot[0] - x) + abs(spot[1] - y))


def open_path(ground: list[list[int]], x0: int, y0: int, x1: int, y1: int) -> None:
    x, y = x0, y0
    while (x, y) != (x1, y1):
        if x != x1:
            x += 1 if x1 > x else -1
        elif y != y1:
            y += 1 if y1 > y else -1
        if ground[y][x] == WALL:
            ground[y][x] = PATH
    ground[y1][x1] = 10


def fit(data: dict) -> dict[tuple[str, int, int], tuple[int, int]]:
    moved: dict[tuple[str, int, int], tuple[int, int]] = {}
    for world_map in data["maps"]:
        crop(world_map)
        for warp in world_map.get("warps") or []:
            nxt = rim(warp["x"], warp["y"])
            if (nxt[0], nxt[1]) != (warp["x"], warp["y"]):
                moved[(world_map["id"], warp["x"], warp["y"])] = nxt
                open_path(world_map["ground"], warp["x"], warp["y"], nxt[0], nxt[1])
                warp["x"], warp["y"] = nxt
            else:
                world_map["ground"][warp["y"]][warp["x"]] = 10
    return moved


def retarget(data: dict, moved: dict[tuple[str, int, int], tuple[int, int]]) -> None:
    for world_map in data["maps"]:
        for warp in world_map.get("warps") or []:
            spot = moved.get((warp["to"], warp["tx"], warp["ty"]))
            if spot:
                warp["tx"], warp["ty"] = spot


def main() -> None:
    files = [PACK / "world.json", PACK / "regions.json"]
    loaded = [(path, json.loads(path.read_text(encoding="utf-8"))) for path in files]
    moved: dict[tuple[str, int, int], tuple[int, int]] = {}
    for _, data in loaded:
        moved.update(fit(data))
    for _, data in loaded:
        retarget(data, moved)
    for path, data in loaded:
        path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        for world_map in data["maps"]:
            print(world_map["id"], world_map["cols"], world_map["rows"], [(w["x"], w["y"], w["to"], w["tx"], w["ty"]) for w in world_map["warps"]])


if __name__ == "__main__":
    main()
