# -*- coding: utf-8 -*-
"""【模块】周次文本 → 周数组 · 原 jou_client.py 第 134-149 行（`_expand_weeks → expand_weeks`）"""
from __future__ import annotations

import re


def expand_weeks(weeks_text: str) -> list:
    """「1-16周(单)」「2-4周,6-16周(双)」→ [1,3,5,...]（去重升序）"""
    weeks: list[int] = []
    parity = "odd" if "单" in weeks_text else ("even" if "双" in weeks_text else None)
    for m in re.finditer(r"(\d+)\s*-\s*(\d+)|(\d+)周", weeks_text):
        if m.group(1):
            lo, hi = int(m.group(1)), int(m.group(2))
        else:
            lo = hi = int(m.group(3))
        for w in range(lo, hi + 1):
            if parity == "odd" and w % 2 == 0:
                continue
            if parity == "even" and w % 2 == 1:
                continue
            if w not in weeks:
                weeks.append(w)
    return sorted(weeks)
