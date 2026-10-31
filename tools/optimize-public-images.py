# -*- coding: utf-8 -*-
"""压缩 public/ 下的位图，降低 OTA 包体。

背景
----
tools/ota-recompress-staging.py 只处理 ≥ MIN_BYTES(200KB) 的 PNG，
而 pixel-fox 的 23 张 512×512 姿态图每张约 160KB —— 全部卡在阈值下方，
从上线起从未被压过，一度占了 OTA zip 的 45%。

因此改在**源文件**上压一次：512×512 分辨率保持不变，只做自适应调色板量化。
像素风插画的本色数远低于 256，肉眼无损；透明通道由 PIL 的 RGBA 量化保留。

被本脚本改过的文件会进入 git 差异，属于「有意提交」，回滚用 git checkout。

用法
----
    python tools/optimize-public-images.py            # 压缩（跳过已达标文件）
    python tools/optimize-public-images.py --report   # 只看不写
"""
from __future__ import annotations

import argparse
import io
import os
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent

# 目标：目录 → (调色板色数, 最大边长上限)
# 边长上限按「实际渲染尺寸」定，留足 2~3 倍余量：
#   pixel-fox    最大渲染 220px(HomePage welcomeFox) → 保持 512
#   run-cycle    精灵表 2×2，单帧实际渲染 ≤64px      → 768(单帧 384)
#   favicon      浏览器标签页图标 ← Chrome 上限      → 192
#
# 【刻意不动 public/launcher-icon-previews】
# 那 13 张是 13 个安卓桌面图标的**同源预览**，tools/launcher-mood.test.mjs 有一条
# 守卫断言它与 android/app/src/main/res/mipmap-xxxhdpi/ 下的原生图标逐字节相同 ——
# 这是「设置里看到的就是桌面上显示的」这条产品保证。单独压预览会让两者不再相等；
# 要压必须连同原生图标一起压并**重打 APK**，而 OTA 期间两者会短暂不一致。
# 收益也只有 0.25MB，不值得，故留原样。
TARGETS: list[tuple[str, int, int | None]] = [
    ('public/pixel-fox', 256, 512),
    ('public/favicon.png', 256, 192),
]

# 精灵文件名 → 单独放宽到 768（单帧实际更小，但四帧拼一张不能压太狠）
SPRITE_NAMES = {'run-cycle-v1.png'}


def shrink(im: Image.Image, colors: int, maxdim: int | None) -> Image.Image:
    im = im.convert('RGBA')
    w, h = im.size
    if maxdim and max(w, h) > maxdim:
        ratio = maxdim / max(w, h)
        im = im.resize((max(1, int(w * ratio)), max(1, int(h * ratio))), Image.Resampling.LANCZOS)
    return im.quantize(colors=colors, method=Image.Quantize.FASTOCTREE)


def encoded(q: Image.Image) -> bytes:
    b = io.BytesIO()
    q.save(b, format='PNG', optimize=True)
    return b.getvalue()


def process(p: Path, colors: int, maxdim: int | None, write: bool) -> tuple[int, int, str]:
    old = p.stat().st_size
    im = Image.open(p)
    if im.mode == 'P':
        return old, old, 'skip(palette)'
    base_colors, base_dim = colors, maxdim
    if p.name in SPRITE_NAMES:
        base_dim = 768
    q = shrink(im, base_colors, base_dim)
    blob = encoded(q)
    if len(blob) < old:
        if write:
            p.write_bytes(blob)
        return old, len(blob), 'ok'
    return old, old, 'skip(no-gain)'


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--report', action='store_true', help='只统计不写盘')
    args = ap.parse_args()
    write = not args.report

    total_old = total_new = 0
    changed = 0
    for rel, colors, maxdim in TARGETS:
        target = ROOT / rel
        files: list[Path]
        if target.is_file():
            files = [target]
        elif target.is_dir():
            files = sorted(target.rglob('*.png'))
        else:
            print(f'[skip] {rel} 不存在')
            continue
        dir_old = dir_new = 0
        for p in files:
            try:
                old, new, note = process(p, colors, maxdim, write)
            except Exception as e:  # noqa: BLE001
                print(f'  ! {p.name}: {e}')
                continue
            dir_old += old
            dir_new += new
            if note == 'ok':
                changed += 1
        total_old += dir_old
        total_new += dir_new
        if dir_old:
            print(f'{rel:32s} {dir_old/1024:7.0f}KB → {dir_new/1024:7.0f}KB  (-{(dir_old-dir_new)/1024:.0f}KB, -{100*(dir_old-dir_new)/dir_old:.0f}%)')

    saved = total_old - total_new
    mode = '预计' if args.report else '实际'
    print(f'\n{mode}压缩 {changed} 个文件，节省 {saved/1024:.0f}KB（{saved/1048576:.2f}MB），降幅 {100*saved/max(total_old,1):.0f}%')
    if write and changed:
        print('回滚：git checkout -- public/pixel-fox public/launcher-icon-previews public/favicon.png')


if __name__ == '__main__':
    sys.exit(main())
