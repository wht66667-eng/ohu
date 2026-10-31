#!/usr/bin/env python3
"""UI 人性化 · 触控热区达标

把小于 44px 的小图标按钮（返回 / 删除 / 关闭 / 步进 / 清空 …）用伪元素把**命中区**
扩到 44×44，视觉尺寸保持原样（伪元素透明且不参与布局）。

用法：
  python tools/ui-tap-targets.py           # dry-run，只打印会改哪些
  python tools/ui-tap-targets.py --apply   # 真正写入
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = 44

# 只处理这些名字的小图标按钮（避免误伤头像、徽标等非按钮小图）
NAMES = {
    'back', 'backBtn', 'backIcon', 'close', 'closeBtn', 'closeX', 'closeIcon',
    'del', 'delBtn', 'delIcon', 'delete', 'deleteBtn', 'remove', 'removeBtn',
    'picDel', 'clearBtn', 'stepBtn', 'stepMinus', 'stepPlus',
    'minus', 'plus', 'iconBtn', 'railArrow', 'moreBtn', 'favBtn',
    'starBtn', 'likeBtn', 'editBtn', 'addBtn', 'subBtn', 'qtyBtn',
}

BLOCK_RE = re.compile(r'(?P<sel>(?:\.[A-Za-z_][\w-]*)+)\s*\{(?P<body>[^{}]*)\}', re.M)


def num(body: str, prop: str) -> float | None:
    m = re.search(prop + r'\s*:\s*(-?[\d.]+)px', body)
    return float(m.group(1)) if m else None


def process(css: Path) -> tuple[str, str] | None:
    """返回 (说明, 新文本)"""
    text = css.read_text(encoding='utf-8')
    if not text.strip():
        return None
    inserts: list[tuple[int, str]] = []   # 块内插入（补 position）
    appends: list[str] = []               # 文件末尾追加（伪元素热区）
    for m in BLOCK_RE.finditer(text):
        sel = m.group('sel')
        if sel.count('.') != 1:
            continue
        name = sel[1:]
        if name not in NAMES:
            continue
        body = m.group('body')
        w = num(body, r'\bwidth\b')
        h = num(body, r'\bheight\b')
        vals = [v for v in (w, h) if v is not None]
        if not vals:
            continue
        size = min(vals)
        if size >= TARGET:
            continue
        # 伪元素已被占用则跳过，避免覆盖真实内容
        if re.search(r'\.' + re.escape(name) + r'::(after|before)\s*\{', text):
            continue
        pad = int((TARGET - size) / 2 + 0.999)
        appends.append(
            f"\n/* 人性化：命中区扩到 {TARGET}px（视觉尺寸不变） */\n"
            f".{name}::after {{\n"
            f"  content: '';\n"
            f"  position: absolute;\n"
            f"  inset: -{pad}px;\n"
            f"}}\n"
        )
        if 'position' not in body:
            inserts.append((m.start('body'), 'position: relative;\n  '))
    if not appends:
        return None
    for pos, frag in sorted(inserts, reverse=True):
        text = text[:pos] + frag + text[pos:]
    out = text.rstrip() + '\n' + ''.join(appends)
    return f"+{len(appends)} 个小按钮", out


def main() -> int:
    apply = '--apply' in sys.argv
    total = 0
    for css in sorted(ROOT.glob('src/**/*.module.css')):
        r = process(css)
        if not r:
            continue
        note, out = r
        total += 1
        print(f"  {css.relative_to(ROOT).as_posix()}  {note}")
        if apply:
            css.write_text(out, encoding='utf-8')
    print(f"{'已写入' if apply else '待修改'} {total} 个文件")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
