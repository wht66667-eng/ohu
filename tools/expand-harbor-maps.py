"""Pad each harbor map to the southeast so the camera can sit farther back.

Existing coordinates stay put: fields, gates, and saved plots keep their tiles.
"""
import json
from pathlib import Path

PACK = Path(__file__).resolve().parents[1] / "harbor-world-pack"
TARGET_W = 40
TARGET_H = 28
WALL = 3


def biome(map_id: str, x: int, y: int, width: int, height: int) -> int:
    n = (x * 17 + y * 13) % 20
    if map_id == "beach":
        if y > height - 7:
            return 2
        if n == 0:
            return 5
        return 8
    if map_id == "port":
        if y > height - 5:
            return 2
        if x % 8 == 0:
            return 1
        if n == 1:
            return 9
        if n == 2:
            return 5
        return 0
    if map_id == "night":
        if n == 0:
            return 5
        if n in (1, 2):
            return 7
        return 0
    if n == 0:
        return 5
    if n in (1, 2):
        return 6
    if n == 3:
        return 7
    if (x + y) % 9 == 0:
        return 1
    return 0


def punch(ground: list[list[int]], x: int, y: int, tile: int) -> None:
    if 0 <= y < len(ground) and 0 <= x < len(ground[0]):
        if ground[y][x] == WALL:
            ground[y][x] = tile


def expand(world_map: dict) -> None:
    old_w = world_map["cols"]
    old_h = world_map["rows"]
    new_w = max(old_w, TARGET_W)
    new_h = max(old_h, TARGET_H)
    if new_w == old_w and new_h == old_h:
        return
    old = world_map["ground"]
    ground = [[WALL for _ in range(new_w)] for _ in range(new_h)]
    for y in range(old_h):
        for x in range(old_w):
            ground[y][x] = old[y][x]
    for y in range(1, new_h - 1):
        for x in range(1, new_w - 1):
            if x < old_w and y < old_h:
                continue
            ground[y][x] = biome(world_map["id"], x, y, new_w, new_h)
    mid_y = max(2, min(old_h - 3, old_h // 2))
    mid_x = max(2, min(old_w - 3, old_w // 2))
    for dy in range(-1, 2):
        punch(ground, old_w - 1, mid_y + dy, 1)
        punch(ground, old_w, mid_y + dy, 1)
    for dx in range(-1, 2):
        punch(ground, mid_x + dx, old_h - 1, 1)
        punch(ground, mid_x + dx, old_h, 1)
    world_map["ground"] = ground
    world_map["cols"] = new_w
    world_map["rows"] = new_h


def expand_file(path: Path) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    maps = data["maps"] if isinstance(data, dict) else data
    for world_map in maps:
        before = (world_map["cols"], world_map["rows"])
        expand(world_map)
        print(world_map["id"], before, "->", world_map["cols"], world_map["rows"])
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    expand_file(PACK / "world.json")
    regions = PACK / "regions.json"
    if regions.exists():
        expand_file(regions)
