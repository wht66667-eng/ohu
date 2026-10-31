# -*- coding: utf-8 -*-
"""Pack cut-out sprites into sheets the campus games can load."""
import json
import re
from pathlib import Path

from PIL import Image

SRC = Path(r"C:\Users\upwar\Desktop\新建文件夹 (9)")
OUT = Path(r"C:\Users\upwar\Desktop\xm-main\public\game-sprites")
SHEETS = OUT / "sheets"
ITEMS = OUT / "items"

ALLOW_TOP = {
    "Animals-26",
    "Buildings-17",
    "Characters-102",
    "Portraits-44",
    "TileSheets21",
    "TerrainFeatures36",
}
SHEET_TOP = {"Animals-26", "Characters-102", "Portraits-44"}
ITEM_NAMES = {
    "crops",
    "tools",
    "weapons",
    "furniture",
    "bushes",
    "emotes",
    "fruitTrees",
    "debris",
    "critters",
}
TERRAIN_KEEP = ("tree", "grass", "mushroom", "palm")
LOCALE = re.compile(r"\.(zh-CN|ja-JP|es-ES|pt-BR|de-DE|ru-RU)$", re.I)
MAX_CELL = 96
COLS = 8


def slug(text: str) -> str:
    cleaned = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff]+", "-", text.strip().strip(".")).strip("-").lower()
    return cleaned or "sprite"


def sort_key(name: str):
    nums = [int(n) for n in re.findall(r"\d+", name)]
    return (nums, name.lower())


def locale_part(path: Path) -> bool:
    return any(LOCALE.search(part) for part in path.parts)


def pack_sheet(files: list[Path], dest: Path) -> int:
    frames = []
    for file in files:
        with Image.open(file) as im:
            frames.append(im.convert("RGBA"))
    if not frames:
        return 0
    cell = min(MAX_CELL, max(max(im.width, im.height) for im in frames))
    rows = (len(frames) + COLS - 1) // COLS
    canvas = Image.new("RGBA", (COLS * cell, rows * cell), (0, 0, 0, 0))
    for index, im in enumerate(frames):
        fitted = im
        if im.width > cell or im.height > cell:
            fitted = im.copy()
            fitted.thumbnail((cell, cell), Image.Resampling.NEAREST)
        x = (index % COLS) * cell + (cell - fitted.width) // 2
        y = (index // COLS) * cell + (cell - fitted.height) // 2
        canvas.paste(fitted, (x, y), fitted)
        if fitted is not im:
            fitted.close()
        im.close()
    dest.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dest, "PNG", optimize=True)
    return len(frames)


def copy_item(file: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(file) as im:
        im.convert("RGBA").save(dest, "PNG", optimize=True)


def main() -> None:
    if not SRC.is_dir():
        raise SystemExit(f"missing source {SRC}")
    if OUT.exists():
        for child in OUT.iterdir():
            if child.name == "catalog.json":
                continue
    SHEETS.mkdir(parents=True, exist_ok=True)
    ITEMS.mkdir(parents=True, exist_ok=True)

    pets = []
    groups: dict[str, dict] = {}
    seen: set[str] = set()

    def add_item(group_id: str, group_name: str, name: str, rel: str) -> None:
        groups.setdefault(group_id, {"id": group_id, "name": group_name, "items": []})
        groups[group_id]["items"].append({"name": name, "src": rel.replace("\\", "/")})

    def unique(base: str) -> str:
        ident = base
        n = 2
        while ident in seen:
            ident = f"{base}-{n}"
            n += 1
        seen.add(ident)
        return ident

    for top in sorted(p for p in SRC.iterdir() if p.is_dir() and p.name in ALLOW_TOP):
        for folder in [top, *top.rglob("*")]:
            if not folder.is_dir() or locale_part(folder.relative_to(SRC)):
                continue
            files = sorted(
                [p for p in folder.iterdir() if p.is_file() and p.suffix.lower() == ".png"],
                key=lambda p: sort_key(p.name),
            )
            if not files:
                continue
            rel_parent = folder.relative_to(top)
            leaf = folder.name.strip().strip(".") or top.name
            if top.name == "TerrainFeatures36" and not any(bit.lower() in leaf.lower() for bit in TERRAIN_KEEP):
                continue
            if top.name == "TileSheets21" and leaf not in ITEM_NAMES and top.name not in SHEET_TOP:
                if folder != top:
                    continue

            if top.name in SHEET_TOP or (top.name == "TileSheets21" and leaf == "critters"):
                kind = "animal" if top.name == "Animals-26" else "portrait" if top.name == "Portraits-44" else "critter" if leaf == "critters" else "character"
                ident = unique(f"{kind}-{slug(leaf)}")
                sheet_name = f"{ident}.png"
                count = pack_sheet(files, SHEETS / sheet_name)
                rel = f"game-sprites/sheets/{sheet_name}"
                title = leaf
                if kind == "portrait":
                    title = f"{leaf}头像"
                elif kind == "character":
                    title = f"{leaf}"
                if kind != "critter":
                    pets.append({
                        "id": f"cutout-{ident}",
                        "name": title,
                        "kind": kind,
                        "blurb": f"从抠图导入的{title}，{count} 帧。",
                        "sheet": rel,
                        "frames": count,
                    })
                add_item(kind if kind != "critter" else "critters", {
                    "animal": "动物",
                    "portrait": "头像",
                    "character": "人物",
                }.get(kind, "小动物"), title, rel)
                continue

            group_id = slug(leaf)
            group_name = {
                "crops": "作物",
                "tools": "工具",
                "weapons": "武器",
                "furniture": "家具",
                "bushes": "灌木",
                "emotes": "表情",
                "fruittrees": "果树",
                "debris": "杂物",
                "buildings-17": "建筑",
            }.get(group_id, leaf)
            if top.name == "Buildings-17":
                group_id = "buildings"
                group_name = "建筑"
            kept = 0
            for file in files:
                ident = unique(f"{group_id}-{slug(file.stem)}")
                dest = ITEMS / group_id / f"{ident}.png"
                copy_item(file, dest)
                add_item(group_id, group_name, file.stem.strip("."), f"game-sprites/items/{group_id}/{ident}.png")
                kept += 1
            print(f"items {top.name}/{leaf} {kept}")

    pets.sort(key=lambda row: (row["kind"], row["name"].lower()))
    catalog = {
        "pets": len(pets),
        "groups": list(groups.values()),
    }
    (OUT / "pets.json").write_text(json.dumps(pets, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False), encoding="utf-8")
    sprites = sum(len(group["items"]) for group in groups.values())
    print(f"DONE pets={len(pets)} shown={sprites}")


if __name__ == "__main__":
    main()
