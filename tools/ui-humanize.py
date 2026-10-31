# -*- coding: utf-8 -*-
"""
UI 人性化批量处理（幂等，可重复执行）：
  1) expand  : 小图标按钮扩命中区到 44px（视觉尺寸不变，用 ::after 撑开）
  2) toasts  : toast('...') 按语义归类为 toast.ok / toast.err
用法：
  python tools/ui-humanize.py expand
  python tools/ui-humanize.py toasts
  python tools/ui-humanize.py all
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'src'

TAP_NAMES = re.compile(
    r'^\.(back|close|del|delBtn|closeBtn|picDel|clearBtn|stepBtn|minus|plus|iconBtn'
    r'|railArrow|removeBtn|dotsBtn|searchClear|closeIcon|more|share|fav|delIcon|stepperBtn)$'
)
BLOCK = re.compile(r'([^{}]+)\{([^{}]*)\}', re.S)
SIZE = re.compile(r'(width|height):\s*(\d+)px')

MARK = '/* tap44 */'


def expand_file(p: Path) -> int:
    text = p.read_text(encoding='utf-8')
    if MARK in text:
        return 0
    out = []
    changed = 0
    pos = 0
    for m in BLOCK.finditer(text):
        out.append(text[pos:m.start()])
        pos = m.end()
        body = m.group(2)
        out.append(m.group(0))
        sel = m.group(1).strip().split('\n')[-1].strip()
        if ',' in sel or ' ' in sel:
            continue
        if not TAP_NAMES.match(sel):
            continue
        name = sel
        # 已有 ::after / ::before 定义的跳过，避免覆盖原有内容
        if re.search(re.escape(name) + r'::(after|before)\s*\{', text):
            continue
        sizes = {k: int(v) for k, v in SIZE.findall(body)}
        if not sizes:
            continue
        small = min(sizes.values())
        if small >= 40:
            continue
        pad = (44 - small + 1) // 2
        add = []
        if 'position:' not in body:
            add.append(f'{name} {{ {MARK} position: relative; }}')
        add.append(f'{name}::after {{ content: ""; position: absolute; inset: -{pad}px; }}')
        out.append('\n' + '\n'.join(add) + '\n')
        changed += 1
    out.append(text[pos:])
    if changed:
        p.write_text(''.join(out), encoding='utf-8')
    return changed


OK_WORDS = ('已', '成功', '完成', '已保存', '已同步', '已发送', '已添加', '已收藏', '已复制', '已提交', '已通过')
ERR_WORDS = (
    '失败', '错误', '无法', '不能', '超时', '异常', '不足', '无效', '请先', '请填',
    '请选', '请输入', '请上传', '未登录', '已存在', '已被', '不可用', '已过期', '拒绝',
)
CALL = re.compile(r'\btoast\(\s*([\'"`])')


def classify_file(p: Path) -> int:
    text = p.read_text(encoding='utf-8')
    if 'toast.ok(' in text or 'toast.err(' in text:
        # 已处理过的文件仍继续扫描未分类调用
        pass
    out = []
    changed = 0
    i = 0
    while True:
        m = CALL.search(text, i)
        if not m:
            out.append(text[i:])
            break
        quote = m.group(1)
        # 找到字符串结尾
        end = text.find(quote, m.end())
        if end < 0:
            out.append(text[i:m.end()])
            i = m.end()
            continue
        # 只处理单行字符串字面量
        seg = text[m.end():end]
        if '\n' not in seg:
            kind = None
            if any(w in seg for w in ERR_WORDS):
                kind = 'err'
            elif any(seg.lstrip().startswith(w) or w in seg for w in OK_WORDS):
                kind = 'ok'
            if kind:
                out.append(text[i:m.start()])
                out.append(f'toast.{kind}(' + quote)
                i = m.end()
                changed += 1
                continue
        out.append(text[i:m.end()])
        i = m.end()
    if changed:
        p.write_text(''.join(out), encoding='utf-8')
    return changed


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'all'
    taps = toasts = 0
    files = 0
    for p in sorted(SRC.rglob('*')):
        if p.suffix == '.css' and cmd in ('expand', 'all'):
            n = expand_file(p)
            if n:
                files += 1
                taps += n
        if p.suffix in ('.tsx', '.ts') and cmd in ('toasts', 'all'):
            n = classify_file(p)
            if n:
                files += 1
                toasts += n
    print(f'[ui-humanize] files={files} tap_targets={taps} toasts={toasts}')


if __name__ == '__main__':
    main()
