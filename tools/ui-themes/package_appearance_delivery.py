"""Build two independently verified, design-only OHU appearance archives."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import tempfile
from xml.etree import ElementTree
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[2]
APPEARANCE_ZIP = "OHU-appearance-design-v1.zip"
FONT_ZIP = "OHU-appearance-fonts-OFL-v1.zip"
REGISTRY = "src/lib/ui-variant.ts"
MANIFEST = "manifest.sha256.json"
HANDDRAWN = (
    "public/brand/handdrawn/fox-avatar.png",
    "public/brand/handdrawn/fox-greeting.png",
    "public/brand/handdrawn/fox-reading-scene.png",
)
INK = "public/brand/ink/ink-fox.svg"
INK_FONT = "public/brand/ink/ohu-ink-title.woff2"
INK_LICENSE = "public/brand/ink/OFL.txt"
SKINS = {
    "classic": ("经典版", "原有校园绿与哦狐插画", "src/index.css", "system", (
        "public/brand/ohu-original/ohu-wordmark-transparent.png",
        "public/brand/ohu-original/fox-avatar.webp",
        "public/brand/ohu-original/fox-grades-transparent.png",
    )),
    "companion": ("微绿版", "白底与绿色操作入口", "src/skins.css", "system", ()),
    "pure": ("简单版", "中性灰度、突出功能", "src/skins.css", "system", ()),
    "handdrawn": ("手绘版", "暖纸、笔刷标题与手账插画", "src/skins.css", "huiting + xiaolai", HANDDRAWN),
    "ink": ("水墨版", "黑白纸面、纵向目录与墨滴阿狐", "src/skins.css", "OHU-InkTitle + system", (INK, INK_FONT, INK_LICENSE)),
}
FONTS = (
    ("huiting", "fonts/BaoCanMouHuiTing-Regular.woff2", "font-assets/fonts/BaoCanMouHuiTing-Regular.woff2",
     "font-assets/licenses/BaoCanMou-HuiTing-OFL.txt", "c62c92ca3d64095190ce84606774233d6c0c7aa96617431fd5fcaf27ddfe1a7a"),
    ("xiaolai", "fonts/Xiaolai-Regular.ttf", "font-assets/fonts/Xiaolai-Regular.ttf",
     "font-assets/licenses/Xiaolai-OFL.txt", "e2f68daf0e72777a8cf58bc83de1b98634b251e537ddbfca24b0ae50d1802da2"),
    ("wenkai", "fonts/LXGWWenKaiLite-Regular.ttf", "font-assets/fonts/LXGWWenKaiLite-Regular.ttf",
     "font-assets/licenses/LXGW-WenKai-Lite-OFL.txt", "f799a538a3355877e597a0ae04050e897932c9ae7689eb9227c2953c5dd549ea"),
    ("kuaile", "fonts/ZCOOL-KuaiLe.woff2", "font-assets/moment-editor/fonts/zcoolkuaile/font.woff2",
     "public/moment-editor/fonts/zcoolkuaile/OFL.txt", "20bf6a55b1e20f3d85e9adb1ea05548829a551663da493df34316249f97fb0ad"),
)
APPEARANCE_README = """# 哦狐外观设计交接包

styles/ 提供五款皮肤的配置说明与项目源路径。assets/ 包含手绘版三张插画和水墨版墨滴阿狐。水墨版的网页标题子集与完整 OFL 许可也位于 assets/ink/，正文保留系统字体。
经典版插画列出项目内路径。微绿版和简单版主要使用现有图标和配色令牌。
配置描述的是内置皮肤。首页与服务共用现有功能路由，设计资料不包含运行代码、用户布局或账号数据。

在本机解压后，可以将 PNG/SVG 放入设计文件，按 styles/ 对照项目源码。
这份 ZIP 用于设计交接，不能在 App 中当作 .ohfox 主题安装。旧主题安装包与安装器未收录。
阿狐插画仅供哦狐项目交接使用。本交付不改变原有品牌素材授权。

需要字体时，可另取 OHU-appearance-fonts-OFL-v1.zip。字体由 App 按需加载，系统字体可作为后备。
manifest.sha256.json 逐项记录包内其余文件的 SHA-256 与字节数。
"""
FONT_README = """# 哦狐可选外观字体

四款字体来自项目的按需字体库，均随附完整 SIL Open Font License 1.1。
字体清单列出对应的授权文件。上游来源见 FONT-SOURCES.md，原始文件指纹见 fonts.json。
站酷快乐体的上游与版权署名见 licenses/ZCOOL-KuaiLe-OFL.txt。

在设计电脑上可以安装 TTF。WOFF2 用于网页或 App 按需加载，可参考相应上游的桌面字库。
保持原字库与许可文件配套；不要把完整字体包复制到默认 App 安装包或热更新包。
manifest.sha256.json 逐项记录包内其余文件的 SHA-256 与字节数。
"""
FONT_SOURCES = """# 字体上游来源

- 包参谋慧庭 v3.0 · https://github.com/baocanmou/baocanmou-huiting
- 小赖字体 v3.126 · https://github.com/lxgw/kose-font
- 霞鹜文楷 Lite v1.530 · https://github.com/lxgw/LxgwWenKai-Lite
- 站酷快乐体 · https://github.com/googlefonts/zcool-kuaile

前三款版本以项目的原始字体来源记录为据。完整版权署名和授权条款位于 licenses/。
"""
SAFE_SUFFIXES = {".json", ".md", ".png", ".svg", ".ttf", ".txt", ".woff2"}
SVG_NS = "{http://www.w3.org/2000/svg}"
SVG_TAGS = {"svg", "title", "desc", "defs", "g", "path", "circle", "ellipse", "rect", "line",
            "polygon", "polyline", "linearGradient", "radialGradient", "stop", "mask", "clipPath"}
PALETTE_TOKENS = {"bg", "bg-light", "surface", "card", "text", "text-2", "green", "green-deep",
                  "fox", "orange", "line", "warm-line", "radius", "radius-lg"}


def project_file(relative: str) -> Path:
    target = (ROOT / relative).resolve(strict=True)
    if not target.is_relative_to(ROOT) or not target.is_file():
        raise ValueError(f"源文件超出项目边界或不可读取：{relative}")
    return target


def json_bytes(data: object) -> bytes:
    return (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def check_static_svg(data: bytes) -> None:
    source = data.decode("utf-8")
    if re.search(r"<!DOCTYPE|<!ENTITY|<\?xml-stylesheet", source, flags=re.IGNORECASE):
        raise ValueError("插画 SVG 含外部声明")
    root = ElementTree.fromstring(source)
    if root.tag != SVG_NS + "svg":
        raise ValueError("插画文件缺少 SVG 根元素")
    for node in root.iter():
        if not node.tag.startswith(SVG_NS) or node.tag[len(SVG_NS):] not in SVG_TAGS:
            raise ValueError(f"插画 SVG 含非静态元素：{node.tag}")
        for name, value in node.attrib.items():
            attr = name.split("}")[-1].lower()
            if attr.startswith("on") or attr in {"href", "style", "src", "base"}:
                raise ValueError(f"插画 SVG 含不允许的属性：{name}")
            urls = re.findall(r"url\s*\(([^)]*)\)", value, re.IGNORECASE)
            if any(not re.fullmatch(r"#[\w.-]+", url.strip().strip("'\"")) for url in urls):
                raise ValueError("插画 SVG 含非本地引用")


def archive_asset(relative: str) -> str:
    return "assets/" + relative.removeprefix("public/brand/")


def skin_palette(css: str, skin_id: str) -> dict[str, str]:
    variant = "" if skin_id == "classic" else rf"\[data-ui-variant=['\"]?{skin_id}['\"]?\]"
    matches = re.findall(rf":root{variant}\s*\{{([^{{}}]*)\}}", css)
    return {key: value.strip() for block in matches
            for key, value in re.findall(r"--([\w-]+)\s*:\s*([^;}}]+)", block)
            if key in PALETTE_TOKENS}


def appearance_entries() -> dict[str, bytes]:
    registry = project_file(REGISTRY).read_text(encoding="utf-8")
    exported = re.search(r"export const SELECTABLE_UI_VARIANTS\s*=\s*\[([^\]]+)\]", registry)
    registered_ids = re.findall(r"['\"]([\w-]+)['\"]", exported.group(1)) if exported else []
    if len(registered_ids) != len(SKINS) or set(registered_ids) != SKINS.keys():
        raise ValueError(f"活跃皮肤清单与项目注册表不一致：{registered_ids}")

    files = {"README.md": APPEARANCE_README.encode("utf-8")}
    bundled = {*HANDDRAWN, INK, INK_FONT, INK_LICENSE}
    for skin_id in registered_ids:
        name, description, css_path, font, references = SKINS[skin_id]
        palette = skin_palette(project_file(css_path).read_text(encoding="utf-8"), skin_id)
        if not palette:
            raise ValueError(f"未找到皮肤配色令牌：{skin_id}（{css_path}）")
        assets = []
        for relative in references:
            path = project_file(relative)
            member = archive_asset(relative) if relative in bundled else None
            if member is not None:
                data = path.read_bytes()
                if path.suffix == ".svg":
                    check_static_svg(data)
                elif path.suffix == ".png" and not data.startswith(b"\x89PNG\r\n\x1a\n"):
                    raise ValueError(f"插画不是有效 PNG：{relative}")
                elif path.suffix == ".woff2" and not data.startswith(b"wOF2"):
                    raise ValueError(f"标题字体不是有效 WOFF2：{relative}")
                elif path.suffix == ".txt" and not valid_ofl_license(data):
                    raise ValueError(f"标题字体授权原文不完整：{relative}")
                files[member] = data
            assets.append({"projectPath": relative, "archivePath": member})
        files[f"styles/{skin_id}.json"] = json_bytes({
            "id": skin_id, "name": name, "description": description, "cssSource": css_path,
            "selector": ":root" if skin_id == "classic" else f':root[data-ui-variant="{skin_id}"]', "lightTokens": palette,
            "defaultFont": font, "assets": assets,
        })
    return files


def valid_ofl_license(data: bytes) -> bool:
    return b"SIL OPEN FONT LICENSE" in data.upper() and b"1.1" in data and b"TERMINATION" in data.upper()


def font_entries() -> dict[str, bytes]:
    files = {
        "README.md": FONT_README.encode("utf-8"),
        "FONT-SOURCES.md": FONT_SOURCES.encode("utf-8"),
    }
    entries = []
    for font_id, member, source, license_source, expected in FONTS:
        data = project_file(source).read_bytes()
        if digest(data) != expected:
            raise ValueError(f"字体与授权来源记录不符：{source}")
        license_name = "ZCOOL-KuaiLe-OFL.txt" if font_id == "kuaile" else Path(license_source).name
        license_member = f"licenses/{license_name}"
        license_data = project_file(license_source).read_bytes()
        if not valid_ofl_license(license_data):
            raise ValueError(f"字体授权原文不完整：{license_source}")
        files[member] = data
        files[license_member] = license_data
        entries.append({"id": font_id, "font": member, "license": license_member, "sha256": expected})
    files["fonts.json"] = json_bytes({"fonts": entries})
    return files


def check_member(name: str) -> None:
    path = PurePosixPath(name)
    if (not path.parts or path.is_absolute() or path.as_posix() != name
            or "\\" in name or ":" in name or ".." in path.parts or path.suffix not in SAFE_SUFFIXES):
        raise ValueError(f"ZIP 成员路径或类型不安全：{name}")


def build_verified_zip(target: Path, files: dict[str, bytes], bundle: str, version: str) -> dict:
    rows = [{"path": name, "bytes": len(data), "sha256": digest(data)} for name, data in sorted(files.items())]
    manifest = {"schemaVersion": 1, "bundle": bundle, "projectVersion": version, "entries": rows}
    entries = {**files, MANIFEST: json_bytes(manifest)}
    with ZipFile(target, "x") as archive:
        for name, data in sorted(entries.items()):
            check_member(name)
            item = ZipInfo(name)
            item.external_attr = 0o100644 << 16
            archive.writestr(item, data, compress_type=ZIP_DEFLATED, compresslevel=6)

    with ZipFile(target) as archive:
        names = archive.namelist()
        if len(names) != len(entries) or set(names) != entries.keys() or archive.testzip() is not None:
            raise ValueError(f"ZIP 成员或 CRC 核验失败：{target.name}")
        for name in names:
            check_member(name)
        if json.loads(archive.read(MANIFEST)) != manifest:
            raise ValueError(f"ZIP 清单读取核验失败：{target.name}")
        for row in rows:
            data = archive.read(row["path"])
            if len(data) != row["bytes"] or digest(data) != row["sha256"]:
                raise ValueError(f"ZIP 内容哈希不符：{row['path']}")
    with target.open("rb") as stream:
        zip_digest = hashlib.file_digest(stream, "sha256").hexdigest()
    return {"archive": target.name, "entries": len(entries), "bytes": target.stat().st_size, "sha256": zip_digest}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True, type=Path, help="项目目录以外的交付目录")
    parser.add_argument("--include-fonts", action="store_true", help="同时生成独立 OFL 字体包")
    args = parser.parse_args()

    output = args.output_dir.resolve()
    if output.is_relative_to(ROOT):
        parser.error("交付目录不能位于仓库内")
    output.mkdir(parents=True, exist_ok=True)
    targets = [APPEARANCE_ZIP, FONT_ZIP] if args.include_fonts else [APPEARANCE_ZIP]
    if any((output / name).exists() or (output / name).is_symlink() for name in targets):
        parser.error("交付目录已存在同名文件，请另选目录")

    version = json.loads(project_file("package.json").read_text(encoding="utf-8"))["version"]
    created = []
    with tempfile.TemporaryDirectory(prefix=".ohu-appearance-", dir=output) as temp:
        staging = Path(temp)
        report = [build_verified_zip(staging / APPEARANCE_ZIP, appearance_entries(), "appearance", version)]
        if args.include_fonts:
            report.append(build_verified_zip(staging / FONT_ZIP, font_entries(), "optional-fonts", version))
        try:
            for name in targets:
                destination = output / name
                with destination.open("xb") as stream, (staging / name).open("rb") as source:
                    created.append(destination)
                    shutil.copyfileobj(source, stream)
                with destination.open("rb") as stream:
                    copied_hash = hashlib.file_digest(stream, "sha256").hexdigest()
                expected_hash = next(item["sha256"] for item in report if item["archive"] == name)
                if copied_hash != expected_hash:
                    raise ValueError(f"交付文件复制校验失败：{destination}")
        except Exception:
            for path in created:
                path.unlink(missing_ok=True)
            raise
    print(json.dumps({"directory": str(output), "verified": report}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()