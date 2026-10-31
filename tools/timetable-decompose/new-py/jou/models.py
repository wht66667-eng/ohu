# -*- coding: utf-8 -*-
"""
【模块】课表数据结构与展平

原 jou_client.py 第 113-125 行（CourseEntry）与第 422-433 行（entries_to_rows）。
这是前后端之间的数据契约，单独成模块便于对照旧版 JS 的形如 {week,day,sections,...} 结构。
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class CourseEntry:
    name: str
    teacher: str = ""
    room: str = ""
    weeks_text: str = ""
    weeks: list = field(default_factory=list)
    day: int = 0
    start_section: int = 0
    end_section: int = 0
    raw: str = ""


def entries_to_rows(entries: list) -> list:
    """展开为前端课表组件消费的格式：每周一条 {week, day, sections, name, teacher, room}"""
    rows: list[dict] = []
    for e in entries:
        weeks = e.weeks or [1]
        sections = list(range(e.start_section, e.end_section + 1)) or [e.start_section or 1]
        for w in weeks:
            rows.append({
                "week": w, "day": e.day, "sections": sections,
                "name": e.name, "teacher": e.teacher, "room": e.room,
            })
    return rows
