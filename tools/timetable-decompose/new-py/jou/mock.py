# -*- coding: utf-8 -*-
"""【模块】MOCK 模式样例课表（不涉及任何真实账号）· 原 jou_client.py 第 679-704 行"""
from __future__ import annotations

from .models import CourseEntry, entries_to_rows
from .weeks import expand_weeks


class MockSchedule:
    """联调测试用：跳过真实教务系统，返回固定样例课表（rows 格式）"""

    _SAMPLE = [
        # (名称, 老师, 教室, 周次文本, 星期, 起始节, 结束节)
        ("习近平新时代中国特色社会主义思想概论", "张老师", "C文通325", "1-10周", 1, 3, 4),
        ("海洋生态学基础", "李老师", "C文思302", "1-8周", 1, 5, 6),
        ("流体力学", "王老师", "C文思409", "1-12周", 2, 1, 2),
        ("卫星海洋学", "赵老师", "C文思409", "1-12周(单)", 2, 3, 4),
        ("海洋地理信息系统", "陈老师", "C文渊204", "2-4周,6-16周(双)", 3, 5, 6),
        ("大学物理Ⅲ(2)", "钱老师", "B0306", "4-15周(单)", 4, 3, 4),
        ("体育(四)", "孙老师", "东操场", "1-16周", 5, 7, 8),
    ]

    @staticmethod
    def rows() -> list[dict]:
        entries = [
            CourseEntry(name=n, teacher=t, room=r, weeks_text=wk,
                        weeks=expand_weeks(wk), day=d,
                        start_section=s1, end_section=s2,
                        raw=f"{n} {wk} {r} {t}")
            for (n, t, r, wk, d, s1, s2) in MockSchedule._SAMPLE
        ]
        return entries_to_rows(entries)
