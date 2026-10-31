# -*- coding: utf-8 -*-
"""
【模块】课表 HTML 解析（原 jou_client.py 第 128-419 行，最大的一块）

三种输入形态：
  ① 格子内自带「周X第a,b节{第m-n周}」时间行（江海大真实格式）—— 优先
  ② 老式「周次 / 节次 / 教室」斜杠布局 —— 回退
  ③ 表头布局 A（表头含多个「星期X」→ 行是节次）/ 布局 B（表头含多个「第X节」→ 列是节次）
  并正确展开 rowspan / colspan（`grid_from_table`）。

下划线前缀去掉：`_parse_course_cell → parse_course_cell`、`_grid_from_table → grid_from_table`、
`_skip_cell → skip_cell`。
"""
from __future__ import annotations

import re

from bs4 import BeautifulSoup

from .errors import ParseFailedError
from .models import CourseEntry
from .textutil import CN_NUM, PERIOD_LABEL_RE, clean_text, section_of
from .weeks import expand_weeks

_WEEKS_SECTION_RE = re.compile(
    r"(?P<weeks>[0-9,，\-周单双()（）]+?周[^/]*)/\s*(?P<sec_start>\d+)\s*-\s*(?P<sec_end>\d+)\s*节"
)
_COURSE_CODE_RE = re.compile(r"^([0-9A-Z]{6,}[A-Za-z0-9]*)")

_SECTION_RANGE_RE = re.compile(r"第?\s*(\d+)\s*[-~—]\s*(\d+)\s*节|第?\s*(\d+)\s*节")
_WEEKS_ONLY_RE = re.compile(r"\d+\s*-\s*\d+\s*周|\d+\s*周")
_ROOM_HINT_RE = re.compile(r"\d{2,}|楼|馆|场|室|房|厅|中心|基地|广场")
# 教务格子内自带的时间行：如「周一第1,2节{第2-11周}」「周三第7节{第9-9周|单周}」
_DAY_MAP = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7}
_TIME_LINE_RE = re.compile(
    r"^周([一二三四五六日天])第([0-9,,，\-~]+)节\{第?([0-9\-]+)周(?:\|([单双])周)?\}$"
)

__all__ = ["parse_course_cell", "grid_from_table", "skip_cell", "parse_schedule_html"]


def parse_course_cell(cell_text: str, day: int, section: int) -> list:
    entries: list[CourseEntry] = []
    for chunk in re.split(r"-{5,}", cell_text):
        lines = [clean_text(x) for x in chunk.splitlines() if clean_text(x)]
        if not lines:
            continue

        # ---- 优先：格子内自带「周X第a,b节{第m-n周}」时间行（江海大真实格式） ----
        time_idxs = [i for i, ln in enumerate(lines) if _TIME_LINE_RE.match(ln)]
        if time_idxs:
            for k, ti in enumerate(time_idxs):
                m = _TIME_LINE_RE.match(lines[ti])
                d = _DAY_MAP.get(m.group(1), day)
                secs = [int(x) for x in re.split(r"[,,，~\-]+", m.group(2)) if x.strip()]
                parity = m.group(4)
                weeks_text = m.group(3) + "周" + ("(单)" if parity == "单" else "(双)" if parity == "双" else "")
                end = time_idxs[k + 1] if k + 1 < len(time_idxs) else len(lines)
                after = lines[ti + 1:end]
                teacher = after[0] if after else ""
                room = after[1] if len(after) > 1 else ""
                name_line = lines[ti - 1] if ti >= 1 and not _TIME_LINE_RE.match(lines[ti - 1]) else ""
                if name_line:
                    mm = _COURSE_CODE_RE.fullmatch(name_line)
                    if mm:
                        name_line = ""
                    else:
                        mc = _COURSE_CODE_RE.match(name_line)
                        if mc:
                            name_line = name_line[len(mc.group(1)):].strip().rstrip("△□")
                name_line = name_line.rstrip("△□")
                if not name_line:
                    continue
                entries.append(CourseEntry(
                    name=name_line, teacher=teacher, room=room,
                    weeks_text=weeks_text, weeks=expand_weeks(weeks_text),
                    day=d,
                    start_section=secs[0] if secs else section,
                    end_section=secs[-1] if secs else section,
                    raw=clean_text(cell_text)[:120],
                ))
            if entries:
                continue

        # ---- 回退：老式「周次 / 节次 / 教室」斜杠布局 ----
        line_start = 1
        name_line = lines[0]
        if _COURSE_CODE_RE.fullmatch(name_line):
            # 课程编号独占一行，课名在下一行
            if len(lines) > 1:
                name_line = lines[1]
                line_start = 2
            else:
                name_line = ""
        else:
            m = _COURSE_CODE_RE.match(name_line)
            if m:
                name_line = name_line[len(m.group(1)):].strip().rstrip("△□")
        name_line = name_line.rstrip("△□")
        weeks_text, sec_start, sec_end, room, teacher = "", 0, 0, "", ""
        for line in lines[line_start:]:
            ms = _WEEKS_SECTION_RE.search(line)
            if ms:
                # 形如「1-16周(单) / 1-2节 / B0301」的一行
                weeks_text = ms.group("weeks").strip(" /,，")
                sec_start, sec_end = int(ms.group("sec_start")), int(ms.group("sec_end"))
                for seg in line[ms.end():].split("/"):
                    seg = seg.strip(" /,，")
                    if not seg:
                        continue
                    ms2 = _SECTION_RANGE_RE.fullmatch(seg)
                    if ms2:
                        continue
                    if _ROOM_HINT_RE.search(seg) and not room:
                        room = seg
                continue
            ms2 = _SECTION_RANGE_RE.fullmatch(line)
            if ms2 and "周" not in line:
                if not sec_start:
                    sec_start = int(ms2.group(1) or ms2.group(3))
                    sec_end = int(ms2.group(2) or ms2.group(3))
                continue
            if _WEEKS_ONLY_RE.search(line) and not weeks_text:
                weeks_text = line.strip(" /,，")
                continue
            if _ROOM_HINT_RE.search(line) and not room:
                room = line.strip(" /,，")
                continue
            if (not teacher and not _ROOM_HINT_RE.search(line)
                    and re.fullmatch(r"[\u4e00-\u9fa5·,，、/\s]{2,24}", line)):
                teacher = clean_text(line)
        if not name_line:
            continue
        entries.append(CourseEntry(
            name=name_line, teacher=teacher, room=room,
            weeks_text=weeks_text, weeks=expand_weeks(weeks_text),
            day=day, start_section=sec_start or section, end_section=sec_end or section,
            raw=clean_text(cell_text)[:120],
        ))
    return entries


def grid_from_table(table) -> list:
    """把 <table> 归一化为文本网格，正确展开 rowspan / colspan"""
    grid: list[list[str]] = []
    occupied: dict[tuple[int, int], str] = {}
    for r, tr in enumerate(table.find_all("tr")):
        row_vals: list[str] = []
        c = 0
        for cell in tr.find_all(["td", "th"]):
            while (r, c) in occupied:
                row_vals.append(occupied.pop((r, c)))
                c += 1
            text = cell.get_text("\n", strip=True)
            try:
                colspan = max(1, int(cell.get("colspan") or 1))
            except (TypeError, ValueError):
                colspan = 1
            try:
                rowspan = max(1, int(cell.get("rowspan") or 1))
            except (TypeError, ValueError):
                rowspan = 1
            start_c = c
            # colspan 的额外列必须以占位文本填入本行，保证列号与数据行对齐
            for _ in range(colspan):
                row_vals.append(text)
                c += 1
            # rowspan 的下方行用 occupied 占位（覆盖该格的全部列）
            for dr in range(1, rowspan):
                for dc in range(colspan):
                    occupied[(r + dr, start_c + dc)] = text
        while (r, c) in occupied:
            row_vals.append(occupied.pop((r, c)))
            c += 1
        grid.append(row_vals)
    return grid


def skip_cell(text: str) -> bool:
    """表头/行头类单元格不当作课程"""
    t = clean_text(text)
    if not t:
        return True
    if re.fullmatch(r"星期[一二三四五六日天]", t):
        return True
    if PERIOD_LABEL_RE.fullmatch(t):
        return True
    if t in ("节次", "星期", "上午", "下午", "晚上", "时间", "星期/节次"):
        return True
    return False


def parse_schedule_html(html: str) -> list:
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", id="Table1")
    if table is None:
        for t in soup.find_all("table"):
            if "星期" in t.get_text():
                table = t
                break
    if table is None:
        raise ParseFailedError("未找到课表表格，页面结构可能已变化")

    grid = grid_from_table(table)
    day_map = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7}
    day_re = re.compile(r"^星期([一二三四五六日天])$")
    entries: list[CourseEntry] = []
    seen: set = set()

    def add_from_cell(cell_text: str, day: int, section: int) -> None:
        if skip_cell(cell_text):
            return
        for e in parse_course_cell(cell_text, day, section):
            key = (e.name, e.day, e.start_section, e.room, e.raw, tuple(e.weeks))
            if key not in seen:
                seen.add(key)
                entries.append(e)

    # 布局 A：表头一行含多个「星期X」→ 行是节次
    header_row, day_cols = -1, {}
    for r, row in enumerate(grid):
        cols = {}
        for c, txt in enumerate(row):
            m = day_re.match(clean_text(txt))
            if m:
                cols[day_map[m.group(1)]] = c
        if len(cols) >= 5:
            header_row, day_cols = r, cols
            break

    if header_row >= 0:
        for r in range(header_row + 1, len(grid)):
            row = grid[r]
            # 行首可能是「上午/下午/晚上」时段格，「第X节」在其后一列
            sec = 0
            for c0 in range(min(len(row), 3)):
                t0 = clean_text(row[c0])
                if PERIOD_LABEL_RE.fullmatch(t0):
                    sec = section_of(t0)
                    break
            for day, col in day_cols.items():
                if col < len(row):
                    add_from_cell(row[col], day, sec)
    else:
        # 布局 B：表头一行含多个「第X节」→ 列是节次，行是星期
        header_row, period_cols = -1, {}
        for r, row in enumerate(grid):
            cols = {}
            for c, txt in enumerate(row):
                t = clean_text(txt)
                if PERIOD_LABEL_RE.fullmatch(t):
                    cols[c] = section_of(t)
            if len(cols) >= 3:
                header_row, period_cols = r, cols
                break
        if header_row < 0:
            raise ParseFailedError("课表表头未识别，页面结构可能已变化")
        for r in range(header_row + 1, len(grid)):
            row = grid[r]
            if not row:
                continue
            m = day_re.match(clean_text(row[0])) or re.search(r"星期([一二三四五六日天])", clean_text(row[0]))
            if not m:
                continue
            day = day_map[m.group(1)]
            for c, sec in period_cols.items():
                if c < len(row):
                    add_from_cell(row[c], day, sec)

    if not entries:
        raise ParseFailedError("课表为空或解析失败")
    entries.sort(key=lambda c: (c.day, c.start_section))
    return entries
