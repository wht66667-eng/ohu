# 生成港城四季内容包（不进 APK / OTA）。
# 人物行走图、草、土、树裁自 Shade 的 Puny Characters（CC0，OpenGameArt）。
# 水、墙、田、码头、传送门、小海阿狐和动物为校园原创像素。
import json
import zipfile
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "harbor-world-pack"
SRC = PACK / "_src" / "puny-characters.zip"
TILE = 32

LEGEND = {
    ".": 0,
    ",": 1,
    "~": 2,
    "#": 3,
    "=": 4,
    "T": 5,
    "*": 6,
    "F": 7,
    "S": 8,
    "D": 9,
    "W": 10,
    "X": 10,
    "Y": 10,
}


def crop32(im: Image.Image) -> Image.Image:
    return im.crop((0, 0, TILE, TILE)).convert("RGBA")


def up(im: Image.Image) -> Image.Image:
    return im.convert("RGBA").resize((TILE, TILE), Image.NEAREST)


def blank() -> Image.Image:
    return Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0))


def paint_original() -> dict[str, Image.Image]:
    water = blank()
    d = ImageDraw.Draw(water)
    d.rectangle((0, 0, 31, 31), fill=(42, 116, 158, 255))
    d.rectangle((0, 8, 31, 10), fill=(168, 214, 230, 255))
    d.rectangle((4, 20, 24, 22), fill=(120, 186, 210, 255))

    wall = blank()
    d = ImageDraw.Draw(wall)
    d.rectangle((0, 0, 31, 31), fill=(92, 62, 48, 255))
    for y in (0, 16):
        d.rectangle((0, y, 31, y + 6), fill=(122, 84, 62, 255))
    d.rectangle((14, 8, 16, 14), fill=(70, 46, 36, 255))

    soil = blank()
    d = ImageDraw.Draw(soil)
    d.rectangle((0, 0, 31, 31), fill=(128, 84, 48, 255))
    for x in (4, 14, 24):
        d.rectangle((x, 6, x + 6, 8), fill=(90, 56, 32, 255))
        d.rectangle((x, 20, x + 6, 22), fill=(90, 56, 32, 255))

    flower = blank()
    d = ImageDraw.Draw(flower)
    d.rectangle((0, 0, 31, 31), fill=(63, 143, 74, 255))
    d.rectangle((14, 16, 17, 26), fill=(40, 110, 52, 255))
    d.ellipse((8, 6, 23, 18), fill=(224, 122, 61, 255))

    tall = blank()
    d = ImageDraw.Draw(tall)
    d.rectangle((0, 0, 31, 31), fill=(28, 102, 54, 255))
    d.rectangle((6, 4, 9, 28), fill=(70, 160, 84, 255))
    d.rectangle((16, 8, 19, 28), fill=(180, 196, 70, 255))
    d.rectangle((24, 12, 27, 28), fill=(48, 130, 64, 255))

    sand = blank()
    d = ImageDraw.Draw(sand)
    d.rectangle((0, 0, 31, 31), fill=(226, 206, 150, 255))
    d.point((6, 8), fill=(186, 160, 100, 255))
    d.point((20, 18), fill=(186, 160, 100, 255))
    d.point((12, 24), fill=(240, 230, 190, 255))

    dock = blank()
    d = ImageDraw.Draw(dock)
    d.rectangle((0, 0, 31, 31), fill=(120, 82, 48, 255))
    for x in (2, 12, 22):
        d.rectangle((x, 0, x + 6, 31), fill=(156, 110, 64, 255))

    gate = blank()
    d = ImageDraw.Draw(gate)
    d.rectangle((0, 0, 31, 31), fill=(210, 186, 120, 255))
    d.rectangle((4, 8, 27, 28), fill=(48, 72, 58, 255))
    d.arc((4, 2, 27, 20), 200, 340, fill=(224, 168, 64, 255), width=3)

    path = blank()
    d = ImageDraw.Draw(path)
    d.rectangle((0, 0, 31, 31), fill=(214, 186, 122, 255))
    d.ellipse((6, 10, 14, 16), fill=(176, 148, 90, 255))
    d.ellipse((18, 18, 26, 24), fill=(176, 148, 90, 255))

    fox = blank()
    d = ImageDraw.Draw(fox)
    d.polygon([(6, 10), (10, 2), (14, 10)], fill=(224, 122, 61, 255))
    d.polygon([(18, 10), (22, 2), (26, 10)], fill=(224, 122, 61, 255))
    d.ellipse((6, 10, 26, 28), fill=(224, 122, 61, 255))
    d.ellipse((11, 16, 21, 24), fill=(255, 244, 230, 255))
    d.point((12, 16), fill=(40, 28, 20, 255))
    d.point((20, 16), fill=(40, 28, 20, 255))

    cat = blank()
    d = ImageDraw.Draw(cat)
    d.polygon([(8, 14), (12, 6), (16, 14)], fill=(90, 86, 82, 255))
    d.polygon([(16, 14), (20, 6), (24, 14)], fill=(90, 86, 82, 255))
    d.ellipse((7, 14, 25, 28), fill=(120, 114, 108, 255))
    d.point((12, 18), fill=(40, 28, 20, 255))
    d.point((20, 18), fill=(40, 28, 20, 255))

    gull = blank()
    d = ImageDraw.Draw(gull)
    d.polygon([(2, 18), (16, 12), (30, 18), (16, 16)], fill=(236, 236, 232, 255))
    d.ellipse((14, 14, 20, 20), fill=(230, 230, 226, 255))
    d.point((18, 16), fill=(40, 40, 40, 255))

    spirit = blank()
    d = ImageDraw.Draw(spirit)
    d.ellipse((6, 8, 26, 26), fill=(126, 200, 227, 180))
    d.ellipse((12, 12, 16, 16), fill=(30, 60, 80, 255))
    d.ellipse((18, 12, 22, 16), fill=(30, 60, 80, 255))

    return {
        "water": water,
        "wall": wall,
        "soil": soil,
        "flower": flower,
        "tall": tall,
        "sand": sand,
        "dock": dock,
        "gate": gate,
        "path": path,
        "fox": fox,
        "cat": cat,
        "gull": gull,
        "spirit": spirit,
    }


def load_puny() -> dict[str, Image.Image]:
    z = zipfile.ZipFile(SRC)
    def png(name: str) -> Image.Image:
        return Image.open(BytesIO(z.read(name)))

    return {
        "grass": up(png("Puny-Characters/Environment/Grass1.png")),
        "dirt": up(png("Puny-Characters/Environment/Dirt.png")),
        "tree": up(png("Puny-Characters/Environment/Tree.png")),
        "student": crop32(png("Puny-Characters/Soldier-Blue.png")),
        "guard": crop32(png("Puny-Characters/Soldier-Yellow.png")),
        "stall": crop32(png("Puny-Characters/Archer-Green.png")),
        "docker": crop32(png("Puny-Characters/Warrior-Blue.png")),
        "senior": crop32(png("Puny-Characters/Mage-Cyan.png")),
    }


def parse(rows: list[str], name: str) -> list[list[int]]:
    width = max(len(r) for r in rows)
    fixed = []
    for r in rows:
        if len(r) < width:
            if not r.endswith("#"):
                raise SystemExit(f"{name} short row {r}")
            r = r[:-1] + ("." * (width - len(r))) + "#"
        fixed.append(r)
    rows[:] = fixed
    if any(len(r) != width for r in rows):
        raise SystemExit(f"{name} row width mismatch {[len(r) for r in rows]}\n" + "\n".join(rows))
    grid = []
    for r in rows:
        grid.append([LEGEND[c] for c in r])
    return grid


def find(rows: list[str], ch: str) -> tuple[int, int]:
    for y, r in enumerate(rows):
        x = r.find(ch)
        if x >= 0:
            return x, y
    raise SystemExit(f"missing {ch}")


MAPS = [
    {
        "id": "nest",
        "name": "窝边田",
        "spawn": (3, 5),
        "rows": [
            "##################",
            "#====T......FF..#",
            "#====.....T.....#",
            "#====..*.,,.....#",
            "#.......,,..FF..#",
            "#T.....,,......W#",
            "#......,,..T....#",
            "#FF....,,.......#",
            "#......,,..*....#",
            "#T............T.#",
            "#..............X#",
            "##################",
        ],
        "warps": {
            "W": {"to": "campus", "tx": 1, "ty": 6, "label": "去教学区"},
            "X": {"to": "beach", "tx": 1, "ty": 6, "label": "沿海路去连岛"},
        },
        "npcs": [
            {"id": "ning", "name": "苗圃阿宁", "sprite": 14, "at": (2, 3), "lines": ["田在窝旁边。精神够的时候再浇，校徽币仍算在服务器上。", "小海阿狐认你这一只，别的动物只是路上遇见。"]},
        ],
        "spirits": [
            {"id": "hopper", "name": "田埂蚂蚱", "sprite": 17, "at": (8, 7), "place": "窝边田", "credit": "校园原创", "line": "麦叶底下跳出一只。"},
        ],
        "animals": [
            {"id": "foxnote", "name": "路过的狸花", "sprite": 16, "at": (12, 9), "lines": ["它不是你的狐，只在田埂晒太阳。"]},
        ],
    },
    {
        "id": "campus",
        "name": "教学区",
        "spawn": (2, 6),
        "rows": [
            "##################",
            "#T..FF....FF..T.#",
            "#......##........#",
            "#..*...##...FF..W#",
            "#......##........#",
            "#,,,,,,,,,,,,,,,,#",
            "Y,,,,,,,,,,,,,,,,X",
            "#,,,,,,,,,,,,,,,,#",
            "#T....##....FF..#",
            "#......##.......#",
            "#FF....##...*...#",
            "#......##.......#",
            "#T............T.#",
            "##################",
        ],
        "warps": {
            "Y": {"to": "nest", "tx": 16, "ty": 5, "label": "回窝边田"},
            "W": {"to": "hill", "tx": 8, "ty": 9, "label": "上花果山路"},
            "X": {"to": "port", "tx": 1, "ty": 6, "label": "去港口"},
        },
        "npcs": [
            {"id": "zhou", "name": "门卫老周", "sprite": 13, "at": (4, 5), "lines": ["教学楼廊的风一年到头。纸鸢只在这条廊上出现。", "传送门标了黄边，踩上去才换区。"]},
        ],
        "spirits": [
            {"id": "kite", "name": "廊下纸鸢", "sprite": 17, "at": (11, 8), "place": "教学区", "credit": "校园原创", "line": "风从走廊灌过来。"},
        ],
        "animals": [
            {"id": "cat", "name": "校猫花饼", "sprite": 16, "at": (5, 10), "lines": ["花饼是教学区的猫，不跟你回家，也不能编进队伍。"]},
        ],
    },
    {
        "id": "hill",
        "name": "花果山路",
        "spawn": (9, 10),
        "rows": [
            "##################",
            "#T..F.....F...T.#",
            "#T....*......T..#",
            "#...FF..........#",
            "#......T..FF....#",
            "#..*......T.....#",
            "#....FF.........#",
            "#T............T.#",
            "#......T........#",
            "#FF..........FF.#",
            "#,,,,,,,W,,,,,,,#",
            "##################",
        ],
        "warps": {
            "W": {"to": "campus", "tx": 15, "ty": 3, "label": "回教学区"},
        },
        "npcs": [
            {"id": "tea", "name": "山路茶摊", "sprite": 14, "at": (6, 5), "lines": ["这条路连着花果山。柿藤只长在这里，换区就见不到。"]},
        ],
        "spirits": [
            {"id": "vine", "name": "山路柿藤", "sprite": 17, "at": (12, 4), "place": "花果山路", "credit": "校园原创", "line": "藤蔓缠着落叶。"},
        ],
        "animals": [],
    },
    {
        "id": "port",
        "name": "港口",
        "spawn": (2, 6),
        "rows": [
            "##################",
            "#S~~~~......~~S.#",
            "#S~~~~..D...~~S.#",
            "#SSSS......FF.SW#",
            "#......DDDD.....#",
            "#.....,,,,,,....#",
            "Y,,,,DDDDDDD..FF#",
            "#.....,,,,,,....#",
            "#SS..DDDD..~~SS.#",
            "#~~~~......~~~~.#",
            "#~~~~..FF..~~~~.#",
            "#S............S.#",
            "##################",
        ],
        "warps": {
            "Y": {"to": "campus", "tx": 16, "ty": 6, "label": "回教学区"},
            "W": {"to": "beach", "tx": 9, "ty": 2, "label": "去连岛滩"},
        },
        "npcs": [
            {"id": "dock", "name": "码头师傅", "sprite": 15, "at": (8, 5), "lines": ["栈桥下面有灯。水母跟着灯走，只在港口算一只。"]},
        ],
        "spirits": [
            {"id": "jelly", "name": "港灯水母", "sprite": 17, "at": (5, 10), "place": "港口", "credit": "校园原创", "line": "灯照着水面。"},
        ],
        "animals": [
            {"id": "gull", "name": "码头海鸥", "sprite": 18, "at": (3, 4), "lines": ["海鸥停在桩上，不收进图鉴。"]},
        ],
    },
    {
        "id": "beach",
        "name": "连岛滩",
        "spawn": (9, 2),
        "rows": [
            "##################",
            "#SSSSSSSWSSSSSSS#",
            "#SS..FFF.....SS.#",
            "#~~~~......~~~~~#",
            "#~~~~..*...~~~~~#",
            "#SS........FFSS.#",
            "YSS..........SS.#",
            "#SS..FFF.....SS.#",
            "#~~~~.........~~#",
            "#~~~~.........~~#",
            "#SSSSSSSSSSSSSSS#",
            "##################",
        ],
        "warps": {
            "W": {"to": "port", "tx": 16, "ty": 3, "label": "回港口"},
            "Y": {"to": "nest", "tx": 16, "ty": 10, "label": "沿海路回窝"},
        },
        "npcs": [
            {"id": "senior", "name": "观潮学姐", "sprite": 19, "at": (11, 5), "lines": ["退潮之后贝灯会亮一下。图鉴按地点收，这一只只属于连岛。"]},
        ],
        "spirits": [
            {"id": "shell", "name": "潮汐贝灯", "sprite": 17, "at": (8, 7), "place": "连岛滩", "credit": "校园原创", "line": "退潮后留下一圈泡沫。"},
        ],
        "animals": [
            {"id": "gull2", "name": "滩上的鸥", "sprite": 18, "at": (4, 2), "lines": ["它跟着浪，不跟课表。"]},
        ],
    },
]


def main() -> None:
    raise SystemExit("人物和地图像素由 tools/paint-harbor-pixels.py 绘制。本脚本会用旧图盖掉图块并重写 world.json，已停用。")
    puny = load_puny()
    own = paint_original()
    order = [
        puny["grass"],
        own["path"],
        own["water"],
        own["wall"],
        own["soil"],
        puny["tree"],
        own["flower"],
        own["tall"],
        own["sand"],
        own["dock"],
        own["gate"],
        puny["student"],
        own["fox"],
        puny["guard"],
        puny["stall"],
        puny["docker"],
        own["cat"],
        own["spirit"],
        own["gull"],
        puny["senior"],
    ]
    atlas = Image.new("RGBA", (TILE * len(order), TILE), (0, 0, 0, 0))
    for i, im in enumerate(order):
        atlas.paste(im, (i * TILE, 0), im)
    PACK.mkdir(parents=True, exist_ok=True)
    atlas.save(PACK / "atlas.png")

    maps = []
    for m in MAPS:
        rows: list[str] = m["rows"]
        ground = parse(rows, m["id"])
        warps = []
        for ch, spec in m["warps"].items():
            x, y = find(rows, ch)
            warps.append({"x": x, "y": y, "to": spec["to"], "tx": spec["tx"], "ty": spec["ty"], "label": spec["label"]})
        def placed(items, key):
            out = []
            for it in items:
                x, y = it["at"]
                row = {k: v for k, v in it.items() if k != "at"}
                row["x"] = x
                row["y"] = y
                if ground[y][x] in (2, 3, 5):
                    raise SystemExit(f"{key} {it.get('id')} stands on blocked tile")
                out.append(row)
            return out
        maps.append({
            "id": m["id"],
            "name": m["name"],
            "cols": len(rows[0]),
            "rows": len(rows),
            "spawn": list(m["spawn"]),
            "ground": ground,
            "warps": warps,
            "npcs": placed(m["npcs"], "npc"),
            "spirits": placed(m["spirits"], "spirit"),
            "animals": placed(m["animals"], "animal"),
        })
        if ground[m["spawn"][1]][m["spawn"][0]] in (2, 3, 5):
            raise SystemExit(f"spawn blocked {m['id']}")

    world = {
        "v": 1,
        "tile": TILE,
        "atlas": "atlas.png",
        "colsInAtlas": len(order),
        "credits": [
            "人物、草、土块原图、树：Shade，Puny Characters，CC0",
            "路、水、墙、田、花、高草、沙、码头、传送门、狐、猫、鸥、生态光：阳光校园原创像素",
        ],
        "blocked": [2, 3, 5],
        "encounterTile": 7,
        "playerSprite": 11,
        "foxSprite": 12,
        "maps": maps,
    }
    (PACK / "world.json").write_text(json.dumps(world, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (PACK / "CREDITS.txt").write_text(
        "港城四季内容包，需单独下载，不随 APK 安装。\n"
        "Puny Characters by Shade — CC0 1.0 — https://opengameart.org/content/puny-characters\n"
        "采用其中的人物朝向帧，以及草地、土、树各一格，已放大到 32 像素。\n"
        "Kenney Roguelike/RPG Pack（CC0）在本机未能下到完整压缩包，因此地形其余格子没有裁自那套包。\n"
        "未使用星露谷或宝可梦的图片、地图和名字。\n",
        encoding="utf-8",
    )
    files = ["world.json", "rules.json", "regions.json", "atlas.png", "CREDITS.txt", "life/fox-life.json", "life/memory_triggers.json", "life/home.json", "life/visits.json", "life/tales.json", "life/year.json", "life/wonder.json", "life/scroll.json", "life/ending.json", "life/recurrence.json", "life/easter_eggs.json", "characters/fox/profile.json", "characters/fox/personalities.json", "characters/fox/habits.json", "characters/fox/expressions.json", "characters/fox/dialogue.json", "characters/fox/memories.json", "characters/fox/interactions.json", "characters/npcs/aning.json", "characters/npcs/dock_master.json", "characters/npcs/librarian.json", "characters/player.json", "characters/together.json", "actors.json", "actors.png"]
    size = sum((PACK / f).stat().st_size for f in files if (PACK / f).exists())
    manifest = {
        "id": "harbor-world",
        "name": "港城四季",
        "version": "1.5.0",
        "build": 15,
        "approxSizeMb": round(max(size, 1) / (1024 * 1024), 2),
        "channel": "opt-in",
        "notes": [
            "同一张图里种田、钓鱼、采集，并按天气、时间和季节遇到原创生态",
            "小海阿狐是唯一伙伴：帮忙浇水、嗅探、提高稀有出现。校徽币仍由服务器记账",
            "宿舍区、商业街、图书馆、体育场、夜市要好感、工具或狐的等级才进得去",
        ],
        "files": files,
    }
    (PACK / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print("atlas", atlas.size, "bytes", size)


if __name__ == "__main__":
    main()
