# -*- coding: utf-8 -*-
"""
正方教务 · 成绩 / 考试安排 HTML 解析（与课表登录会话配合）
"""
from __future__ import annotations

import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup

BASE_URL = "https://zfxk.jou.edu.cn"


def _clean_text(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _header_map(cells: list[str]) -> dict[str, int]:
    mapping: dict[str, int] = {}
    rules = [
        ("year", ("学年",)),
        ("term", ("学期",)),
        ("code", ("课程代码", "课程号", "课号")),
        ("name", ("课程名称", "课程名", "名称")),
        ("credit", ("学分",)),
        ("gpa", ("绩点", "学分绩点")),
        ("score", ("成绩", "总评", "综合成绩", "最终成绩")),
        ("nature", ("课程性质", "性质", "课程属性")),
        ("teacher", ("教师", "任课教师")),
        ("room", ("地点", "教室", "考场")),
        ("date", ("考试时间", "考试日期")),
        ("time", ("时间",)),
        ("seat", ("座位", "座号")),
        ("campus", ("校区",)),
        ("form", ("考核方式", "考试形式")),
    ]
    for i, raw in enumerate(cells):
        t = _clean_text(raw)
        if not t:
            continue
        for key, words in rules:
            if key in mapping:
                continue
            if any(w in t for w in words):
                if key == "time" and ("考试" in t or "日期" in t):
                    continue
                mapping[key] = i
    return mapping


def _cell(cols: list[str], idx: int | None) -> str:
    if idx is None or idx < 0 or idx >= len(cols):
        return ""
    return _clean_text(cols[idx])


def extract_asp_alert(html: str) -> str:
    """正方常用 alert('…') / alert(\"…\") 提示登录失效、无权限等。"""
    if not html:
        return ""
    m = re.search(r"alert\s*\(\s*['\"]([^'\"]{2,120})['\"]\s*\)", html, re.I)
    return _clean_text(m.group(1)) if m else ""


def parse_grades_html(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    table = (
        soup.find("table", id="Datagrid1")
        or soup.find("table", id="DataGrid1")
        or soup.find("table", id="datagrid1")
        or soup.find("table", id="DataGrid")
        or soup.find("table", attrs={"class": re.compile(r"datagrid", re.I)})
    )
    if table is None:
        best = None
        best_score = 0
        for t in soup.find_all("table"):
            head = t.get_text(" ", strip=True)[:120]
            score = 0
            if "课程" in head:
                score += 2
            if "成绩" in head or "总评" in head:
                score += 2
            if "学分" in head:
                score += 1
            if "绩点" in head:
                score += 1
            if score > best_score:
                best_score = score
                best = t
        if best_score >= 3:
            table = best
    if table is None:
        return []

    rows_out: list[dict] = []
    # 只取直接子 tr，避免嵌套表把列搅乱；若无直接子节点再回退
    body = table.find("tbody") or table
    trs = [tr for tr in body.find_all("tr", recursive=False)] or table.find_all("tr")
    if len(trs) < 2:
        return []
    header_cells = [_clean_text(c.get_text()) for c in trs[0].find_all(["td", "th"], recursive=False)]
    if len(header_cells) < 3:
        header_cells = [_clean_text(c.get_text()) for c in trs[0].find_all(["td", "th"])]
    hmap = _header_map(header_cells)
    if "name" not in hmap:
        hmap = {
            "year": 0,
            "term": 1,
            "code": 2,
            "name": 3,
            "nature": 4,
            "credit": 5,
            "score": 6,
            "gpa": 7 if len(header_cells) > 7 else 6,
        }

    for tr in trs[1:]:
        cols = [_clean_text(c.get_text()) for c in tr.find_all(["td", "th"], recursive=False)]
        if len(cols) < 3:
            cols = [_clean_text(c.get_text()) for c in tr.find_all(["td", "th"])]
        if len(cols) < 3:
            continue
        name = _cell(cols, hmap.get("name"))
        score = _cell(cols, hmap.get("score"))
        if not name or name in ("课程名称", "课程名"):
            continue
        if not score and not _cell(cols, hmap.get("credit")):
            continue
        rows_out.append({
            "year": _cell(cols, hmap.get("year")),
            "term": _cell(cols, hmap.get("term")),
            "code": _cell(cols, hmap.get("code")),
            "name": name,
            "nature": _cell(cols, hmap.get("nature")),
            "credit": _cell(cols, hmap.get("credit")),
            "score": score,
            "gpa": _cell(cols, hmap.get("gpa")),
        })
    return rows_out


def parse_exams_html(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    table = (
        soup.find("table", id="DataGrid1")
        or soup.find("table", id="Datagrid1")
        or soup.find("table", id="datagrid1")
    )
    if table is None:
        for t in soup.find_all("table"):
            head = t.get_text(" ", strip=True)[:100]
            if "考试" in head or ("课程" in head and ("地点" in head or "考场" in head)):
                table = t
                break
    if table is None:
        return []

    rows_out: list[dict] = []
    trs = table.find_all("tr")
    if len(trs) < 2:
        return []
    header_cells = [_clean_text(c.get_text()) for c in trs[0].find_all(["td", "th"])]
    hmap = _header_map(header_cells)
    if "name" not in hmap:
        hmap = {
            "year": 0,
            "term": 1,
            "code": 2,
            "name": 3,
            "date": 4,
            "room": 5,
            "form": 6,
            "seat": 7,
            "campus": 8,
        }

    for tr in trs[1:]:
        cols = [_clean_text(c.get_text()) for c in tr.find_all(["td", "th"])]
        if len(cols) < 3:
            continue
        name = _cell(cols, hmap.get("name"))
        if not name or name in ("课程名称", "课程名"):
            continue
        date = _cell(cols, hmap.get("date")) or _cell(cols, hmap.get("time"))
        rows_out.append({
            "year": _cell(cols, hmap.get("year")),
            "term": _cell(cols, hmap.get("term")),
            "code": _cell(cols, hmap.get("code")),
            "name": name,
            "datetime": date,
            "room": _cell(cols, hmap.get("room")),
            "form": _cell(cols, hmap.get("form")),
            "seat": _cell(cols, hmap.get("seat")),
            "campus": _cell(cols, hmap.get("campus")),
            "teacher": _cell(cols, hmap.get("teacher")),
        })
    return rows_out


# 菜单文案易误匹配的页面（等级考试 ≠ 期末考试安排；教师端成绩录入等）
_MENU_EXCLUDE = ("等级考试", "等级成绩", "成绩录入", "成绩录入查询", "教师", "教职工")


def find_menu_href(soup: BeautifulSoup, keywords: list[str], fallback: str) -> str:
    """按关键字找菜单链接。精确匹配优先于包含匹配；排除等级考试等易混项。"""
    exact: list[tuple[int, str]] = []
    partial: list[tuple[int, str]] = []
    for a in soup.find_all("a", href=True):
        text = _clean_text(a.get_text())
        href = a["href"]
        if not text or href.lower().startswith(("javascript", "#")):
            continue
        if any(bad in text for bad in _MENU_EXCLUDE):
            continue
        href_l = href.lower()
        if "xsdjkscx" in href_l or "djkscx" in href_l:
            continue
        for i, kw in enumerate(keywords):
            if text == kw:
                exact.append((i, href))
                break
            if kw in text:
                partial.append((i, href))
                break
    scored = exact or partial
    if scored:
        scored.sort(key=lambda x: x[0])
        return urljoin(BASE_URL + "/", scored[0][1])
    return fallback
