# -*- coding: utf-8 -*-
"""
【模块】文本清洗与节次换算

原 jou_client.py 中的 `_clean_text`、`_PERIOD_LABEL_RE`、`_CN_NUM`、`_section_of`
（第 152-185 行）。会话层（菜单解析）与解析层（表格解析）都要用，故独立成模块。
下划线前缀去掉：`_clean_text → clean_text`、`_section_of → section_of`。
"""
from __future__ import annotations

import re

# 表头里的「第X节」标签（含中文数字），如「第1节」「第三节(1,2节)」
PERIOD_LABEL_RE = re.compile(r"^第\s*[0-9一二三四五六七八九十]+\s*节(\s*[（(]\s*[0-9\-,，~]+\s*节?\s*[)）])?$")
CN_NUM = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}


def clean_text(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def section_of(label: str) -> int:
    """「第三节」/「第3节」/「3」 -> 3"""
    t = clean_text(label)
    m = re.match(r"^第\s*([0-9一二三四五六七八九十]+)\s*节", t)
    if m:
        s = m.group(1)
        if s.isdigit():
            return int(s)
        if s == "十":
            return 10
        if "十" in s:
            parts = s.split("十")
            tens = CN_NUM.get(parts[0], 1) if parts[0] else 1
            ones = CN_NUM.get(parts[1], 0) if len(parts) > 1 and parts[1] else 0
            return tens * 10 + ones
        return CN_NUM.get(s, 0)
    m = re.match(r"^(\d+)", t)
    return int(m.group(1)) if m else 0
