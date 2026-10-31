#!/usr/bin/env python3
"""UI 人性化 · 反馈分色

把无类型的 toast 调用按语义归类：
  - `toast(res.error)` 这类错误分支  -> toast.err(...)
  - 「已删除 / 已保存 / 已发布 …」   -> toast.ok(...)
  - 「失败 / 超时 / 无法 / 不能 …」   -> toast.err(...)
  - 「请先登录 / 请填写 …」           -> toast.warn(...)

用法：
  python tools/ui-toast-variants.py
  python tools/ui-toast-variants.py --apply
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

CALL_RE = re.compile(
    r"(?<![\w.])toast\(\s*"
    r"(?P<arg>'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.error)"
    r"\s*\)"
)

ERR_WORDS = ('失败', '错误', '异常', '超时', '无法', '不能', '不可用', '不足', '无效', '已被', '出错', '丢失')
WARN_WORDS = ('请先', '请填', '请选', '请输入', '请选择', '请上传', '请先登录', '注意', '确认后')


def classify(arg: str) -> str | None:
    if arg.endswith('.error'):
        return 'err'
    body = arg[1:-1]            # 去掉引号/反引号
    plain = re.sub(r'\$\{[^}]*\}', '', body)
    if any(w in plain for w in ('失败', '错误', '异常', '超时', '无法', '不能', '不可用', '不足', '无效', '出错')):
        return 'err'
    if plain.startswith('请') or any(w in plain for w in ('注意', '确认后')):
        return 'warn'
    if any(w in plain for w in ('已存在', '已被', '已过期', '已满', '已达', '已停')):
        return 'err'
    if plain.startswith('已') or plain.startswith('成功') or plain.startswith('完成'):
        return 'ok'
    return None


def process(path: Path) -> tuple[int, str] | None:
    src = path.read_text(encoding='utf-8')
    n = 0

    def repl(m: re.Match[str]) -> str:
        nonlocal n
        kind = classify(m.group('arg'))
        if not kind:
            return m.group(0)
        n += 1
        return f"toast.{kind}({m.group('arg')})"

    out = CALL_RE.sub(repl, src)
    return (n, out) if n else None


def main() -> int:
    apply = '--apply' in sys.argv
    files = 0
    total = 0
    for p in sorted(ROOT.glob('src/**/*.tsx')) + sorted(ROOT.glob('src/**/*.ts')):
        r = process(p)
        if not r:
            continue
        n, out = r
        files += 1
        total += n
        print(f"  {p.relative_to(ROOT).as_posix()}  {n}")
        if apply:
            p.write_text(out, encoding='utf-8')
    print(f"{'已写入' if apply else '待修改'} {files} 个文件 / {total} 处 toast")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
