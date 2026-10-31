# 第二章分区：宿舍、商业街、图书馆、体育场、夜市。不进安装包。
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "harbor-world-pack"
LEGEND = {'.': 0, ',': 1, '~': 2, '#': 3, '=': 4, 'T': 5, '*': 6, 'F': 7, 'S': 8, 'D': 9, 'W': 10}

def parse(rows: list[str]) -> tuple[list[str], list[list[int]]]:
    width = max(len(r) for r in rows)
    fixed = []
    for r in rows:
        if len(r) < width:
            if not r.endswith('#'):
                raise SystemExit('short ' + r)
            r = r[:-1] + ('.' * (width - len(r))) + '#'
        fixed.append(r)
    return fixed, [[LEGEND[c] for c in r] for r in fixed]

def find(rows: list[str], ch: str) -> tuple[int, int]:
    for y, r in enumerate(rows):
        x = r.find(ch)
        if x >= 0:
            return x, y
    raise SystemExit('missing ' + ch)

RAW = [
    {
        "id": "dorm",
        "name": "宿舍区",
        "spawn": [3, 5],
        "rows": [
            "################",
            "#T..FF......T..#",
            "#......####....#",
            "#..*...#..#..F.#",
            "#......####....#",
            "#,,,,..........#",
            "#,,,W.....FF...#",
            "#T..........T..#",
            "################",
        ],
        "back": {"to": "campus", "tx": 2, "ty": 6, "label": "回教学区"},
        "npc": {"id": "warden", "name": "宿管阿姨", "sprite": 14, "at": [4, 5], "lines": ["门禁以后走廊会静下来。", "喜欢收一束野花，别的不往屋里带。"]},
        "spirit": {"id": "lampmoth", "name": "廊灯蛾", "sprite": 17, "at": [11, 2], "place": "宿舍区", "line": "灯管底下停着一只。"},
    },
    {
        "id": "street",
        "name": "商业街",
        "spawn": [3, 4],
        "rows": [
            "################",
            "#T.,,,,,,....T.#",
            "#..,,,,,,..FF..#",
            "#*.,,,,,,......#",
            "#..,,,W........#",
            "#....FF.....T..#",
            "#T.............#",
            "################",
        ],
        "back": {"to": "campus", "tx": 4, "ty": 6, "label": "回教学区"},
        "npc": {"id": "clerk", "name": "街口老板", "sprite": 15, "at": [8, 2], "lines": ["种子和工具，山路茶摊也卖。这条街只把人引过去。", "谷票仍是这一季的账。"]},
        "spirit": {"id": "signfox", "name": "招牌狐影", "sprite": 17, "at": [2, 5], "place": "商业街", "line": "它不是小海阿狐，只是灯箱上的影子。"},
    },
    {
        "id": "library",
        "name": "图书馆",
        "spawn": [2, 4],
        "rows": [
            "################",
            "#..####..####..#",
            "#..#..#..#..#..#",
            "#..#..#..#..#.F#",
            "#,,,,W.,,,,,,,,#",
            "#..............#",
            "#T....*......T.#",
            "################",
        ],
        "back": {"to": "campus", "tx": 6, "ty": 6, "label": "回教学区"},
        "npc": {"id": "lib", "name": "阅览老师", "sprite": 19, "at": [9, 4], "lines": ["自习的位子靠窗。碎贝和野花她都肯收。", "狐可以在门口等，不进书库。"]},
        "spirit": {"id": "pagewing", "name": "书页蛾", "sprite": 17, "at": [12, 5], "place": "图书馆", "line": "书角掀起一下。"},
    },
    {
        "id": "field",
        "name": "体育场",
        "spawn": [4, 3],
        "rows": [
            "################",
            "#T............T#",
            "#..FF..........#",
            "#....,,,W......#",
            "#..FF..........#",
            "#*.............#",
            "#T............T#",
            "################",
        ],
        "back": {"to": "campus", "tx": 8, "ty": 6, "label": "回教学区"},
        "npc": {"id": "coach", "name": "体育委员", "sprite": 13, "at": [10, 3], "lines": ["傍晚场子才热闹。连续把田浇过几天，他才肯记你的名字。"]},
        "spirit": {"id": "trackbird", "name": "跑道鸟", "sprite": 17, "at": [3, 4], "place": "体育场", "line": "沿着白线跑，不落到窝边田。"},
    },
    {
        "id": "night",
        "name": "夜市",
        "spawn": [3, 3],
        "rows": [
            "################",
            "#T.,,,,,,....T.#",
            "#..,,,,,,,..F..#",
            "#*.,,,W,,,,,,,.#",
            "#....FF........#",
            "#T..........T..#",
            "################",
        ],
        "back": {"to": "street", "tx": 3, "ty": 3, "label": "回商业街"},
        "npc": {"id": "nightstall", "name": "夜市摊主", "sprite": 15, "at": [8, 2], "lines": ["没有夜市灯就不摆摊。灯在茶摊，用谷票买。", "夜里的蟹只认这条巷。"]},
        "spirit": {"id": "lanterncrab", "name": "灯笼蟹", "sprite": 17, "at": [11, 3], "place": "夜市", "line": "灯笼底下横着走。"},
    },
]

maps = []
for m in RAW:
    rows, ground = parse(m["rows"])
    x, y = find(rows, "W")
    npc = m["npc"]
    spirit = m["spirit"]
    for label, at in (("npc", npc["at"]), ("spirit", spirit["at"])):
        if ground[at[1]][at[0]] in (2, 3, 5):
            raise SystemExit(f"{m['id']} {label} blocked")
    if ground[m["spawn"][1]][m["spawn"][0]] in (2, 3, 5):
        raise SystemExit(m["id"] + " spawn blocked")
    maps.append({
        "id": m["id"],
        "name": m["name"],
        "cols": len(rows[0]),
        "rows": len(rows),
        "spawn": m["spawn"],
        "ground": ground,
        "warps": [{"x": x, "y": y, "to": m["back"]["to"], "tx": m["back"]["tx"], "ty": m["back"]["ty"], "label": m["back"]["label"]}],
        "npcs": [{"id": npc["id"], "name": npc["name"], "sprite": npc["sprite"], "x": npc["at"][0], "y": npc["at"][1], "lines": npc["lines"]}],
        "spirits": [{"id": spirit["id"], "name": spirit["name"], "sprite": spirit["sprite"], "x": spirit["at"][0], "y": spirit["at"][1], "place": spirit["place"], "credit": "校园原创", "line": spirit["line"]}],
        "animals": [],
    })

(PACK / "regions.json").write_text(json.dumps({"v": 1, "maps": maps}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print("regions", len(maps))
