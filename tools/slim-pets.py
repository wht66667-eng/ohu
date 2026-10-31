# -*- coding: utf-8 -*-
"""压缩 public/pets 下的精灵图，给 OTA 热更包瘦身。

做法：RGBA 精灵图量化到 255 色调色板（视觉几乎无损），再做无损 optimize。
安全兜底：量化后重新解码与原图逐像素比对，误差超阈值就退回无损重压缩。

用法：
    python tools/slim-pets.py            # dry-run，只报告收益
    python tools/slim-pets.py --apply    # 真正写回（会先备份整个 public/pets）
"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
PETS = ROOT / 'public' / 'pets'
BACKUP = ROOT / '_backup-pets-20260929'

# 量化允许的误差：平均差 <= 3/255，且单点最大差 <= 96/255
MAX_AVG = 3.0
MAX_PEAK = 96

apply = '--apply' in sys.argv


def human(n: int) -> str:
    return f'{n / 1048576:.2f} MB' if n >= 1048576 else f'{n / 1024:.0f} KB'


def ext_stat() -> None:
    by_ext: dict[str, list[int]] = {}
    for f in PETS.rglob('*'):
        if f.is_file():
            by_ext.setdefault(f.suffix.lower(), []).append(f.stat().st_size)
    for ext, sizes in sorted(by_ext.items(), key=lambda kv: -sum(kv[1])):
        print(f'  {ext or "(no ext)":10s} {len(sizes):5d} 个  {human(sum(sizes))}')


def slim(path: Path) -> tuple[int, int, str]:
    """返回 (原大小, 新大小, 处理方式)。dry-run 时新大小为预估值。"""
    src = path.stat().st_size
    with Image.open(path) as im:
        im.load()
        mode = im.mode
        rgba = im.convert('RGBA')

    tmp = Path(tempfile.gettempdir()) / f'slim-{os.getpid()}-{path.name}'
    try:
        q = rgba.quantize(colors=255, method=Image.FASTOCTREE)
        q.save(tmp, optimize=True)
        qsize = tmp.stat().st_size

        # 误差校验：量化结果解码回来与原图比
        with Image.open(tmp) as back:
            back.load()
            diff = ImageChops.difference(rgba, back.convert('RGBA'))
        # 取 RGB 三通道，忽略 alpha（量化不改 alpha）
        r, g, b, _ = diff.split()
        peak = max(ch.getextrema()[1] for ch in (r, g, b))
        hist = [h * i for ch in (r, g, b) for i, h in enumerate(ch.histogram())]
        total = sum(sum(ch.histogram()) for ch in (r, g, b))
        avg = sum(hist) / max(1, total)

        if qsize < src and peak <= MAX_PEAK and avg <= MAX_AVG:
            if apply:
                shutil.copyfile(tmp, path)
            return src, qsize, f'量化 avg={avg:.2f} peak={peak}'

        # 兜底：无损重压缩
        rgba.save(tmp, optimize=True)
        osize = tmp.stat().st_size
        if apply and osize < src:
            shutil.copyfile(tmp, path)
        return src, min(osize, src), '无损'
    finally:
        if tmp.exists():
            tmp.unlink()


def slim_webp(path: Path) -> tuple[int, int, str]:
    """webp 用有损重编码，从 82 起逐级提高质量直到误差达标。"""
    src = path.stat().st_size
    with Image.open(path) as im:
        im.load()
        rgba = im.convert('RGBA')

    tmp = Path(tempfile.gettempdir()) / f'slim-{os.getpid()}-{path.name}.webp'
    best: tuple[int, int, str] | None = None
    try:
        for quality in (82, 88, 94):
            rgba.save(tmp, format='WEBP', quality=quality, method=6)
            size = tmp.stat().st_size
            with Image.open(tmp) as back:
                back.load()
                diff = ImageChops.difference(rgba, back.convert('RGBA'))
            r, g, b, _ = diff.split()
            peak = max(ch.getextrema()[1] for ch in (r, g, b))
            hist = [h * i for ch in (r, g, b) for i, h in enumerate(ch.histogram())]
            total = sum(sum(ch.histogram()) for ch in (r, g, b))
            avg = sum(hist) / max(1, total)
            if size < src and peak <= MAX_PEAK and avg <= MAX_AVG:
                if apply:
                    shutil.copyfile(tmp, path)
                return src, size, f'webp q{quality} avg={avg:.2f} peak={peak}'
            if best is None or size < best[1]:
                best = (src, size, f'webp q{quality} 超阈值 avg={avg:.2f} peak={peak}')
        # 这些 webp 本身就是有损压过的，再压会累积失真。
        # 误差超标就一律保持原图，不为省体积牺牲画质。
        return src, src, f'保持原图（{best[2] if best else "无"}）'
    finally:
        if tmp.exists():
            tmp.unlink()


def main() -> None:
    if not PETS.exists():
        raise SystemExit('找不到 public/pets')
    files = sorted(
        p for p in PETS.rglob('*') if p.is_file() and p.suffix.lower() in ('.png', '.webp')
    )
    print(f'public/pets 构成：')
    ext_stat()
    print(f'\n待处理 PNG：{len(files)} 个\n')

    if apply:
        if BACKUP.exists():
            print(f'备份已存在，跳过备份：{BACKUP}')
        else:
            print(f'备份原图 -> {BACKUP}')
            shutil.copytree(PETS, BACKUP)

    before = after = 0
    done = 0
    for f in files:
        src, new, how = slim_webp(f) if f.suffix.lower() == '.webp' else slim(f)
        before += src
        after += new
        done += 1
        if new < src * 0.9 or done % 200 == 0:
            rel = f.relative_to(ROOT)
            print(f'  {human(src):>9s} -> {human(new):>9s}  {how:24s} {rel}')

    print(f'\n合计 {human(before)} -> {human(after)}  省下 {human(before - after)} '
          f'({(before - after) / max(1, before) * 100:.0f}%)')
    print('模式：' + ('已写回' if apply else 'dry-run（加 --apply 才会改文件）'))


if __name__ == '__main__':
    main()
