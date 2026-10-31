# -*- coding: utf-8 -*-
"""
江苏海洋大学教务系统（正方 zfxk.jou.edu.cn）课表抓取核心模块

真实登录流程（正方 4.x）：
  1. GET / 拿到登录页：__VIEWSTATE / __VIEWSTATEGENERATOR / RSA 公钥(e,n) / 验证码图
  2. 验证码图片：GET /CheckCode.aspx（与 Cookie 会话绑定）
  3. 提交登录：学号 yhm|txtUserName、RSA(PKCS#1 v1.5) 加密密码 mm|TextBox2、
     验证码 txtSecretCode、身份 RadioButtonList1=学生、Button1=登录
  4. 成功后进入 xs_main.aspx，抓取 /xskbcx.aspx?xh=学号&gnmkdm=N121603
  5. BeautifulSoup 解析课表表格 → 清洗 → 前端可直接消费的 rows 结构

安全约束：
  - 密码仅在本次请求内存中使用，不写日志、不落盘、不缓存，用完即清
  - 登录会话一次性：验证码/查询配对使用，用后即焚
"""
from __future__ import annotations

import re
import os
import base64
from urllib.parse import urljoin
import random
import logging
import threading
import time
import uuid
from dataclasses import dataclass, field, asdict

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

BASE_URL = "https://zfxk.jou.edu.cn"
DEFAULT_TIMEOUT = 12
MAIN_PAGE_HINT = "xs_main.aspx"


# ---------------- 异常定义（code 对应前端课表页的约定错误码） ----------------

class ScheduleError(Exception):
    code = ""      # 前端约定：1001/1003=验证码错(自动刷新) 1002=密码错 其他=展示 message
    reason = "internal-error"
    http = 500


class CaptchaError(ScheduleError):
    code = "1001"
    reason = "captcha-error"
    http = 401


class WrongPasswordError(ScheduleError):
    code = "1002"
    reason = "wrong-password"
    http = 401


class LoginFailedError(ScheduleError):
    code = "1005"
    reason = "login-failed"
    http = 401


class NetworkTimeoutError(ScheduleError):
    code = "1006"
    reason = "upstream-timeout"
    http = 504


class ParseFailedError(ScheduleError):
    code = "1007"
    reason = "parse-failed"
    http = 502


# ---------------- 正方前端 RSA（PKCS#1 v1.5，与页面 RSA.js 精确一致） ----------------

def zf_rsa_encrypt(password: str, e_hex: str, n_hex: str) -> str:
    """
    移植自教务系统页面 RSA.js（TYF 版）：
      digitSize = 2*biHighIndex(n)+2（字节），chunkSize = digitSize-11
      明文按字符倒序放入块首，之后 0x00、随机非零填充、0x02、0x00
      整块按小端 16 位数字组装 → raw RSA → 大写十六进制
    """
    n_int, e_int = int(n_hex, 16), int(e_hex, 16)
    high = (n_int.bit_length() - 1) // 16          # biHighIndex
    digit_size = 2 * high + 2
    chunk_size = digit_size - 11

    # 页面用 charCodeAt；教务密码通常为 ASCII。含非 ASCII 时退化为 UTF-8 字节序列
    if any(ord(c) > 255 for c in password):
        a = list(password.encode("utf-8"))
    else:
        a = [ord(c) for c in password]

    msg_length = min(chunk_size, len(a))
    b = [0] * digit_size
    for x in range(msg_length):                    # 明文倒序
        b[x] = a[msg_length - 1 - x]
    b[msg_length] = 0                              # 0x00 分隔
    padded_size = max(8, digit_size - 3 - msg_length)
    for x in range(padded_size):                   # 随机非零填充
        b[msg_length + 1 + x] = random.randint(1, 254)
    b[digit_size - 2] = 2                          # PKCS#1 类型标记
    b[digit_size - 1] = 0

    m = int.from_bytes(bytes(b), "little")
    return format(pow(m, e_int, n_int), "X")


# ---------------- 课表数据结构与解析 ----------------

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


_WEEKS_SECTION_RE = re.compile(
    r"(?P<weeks>[0-9,，\-周单双()（）]+?周[^/]*)/\s*(?P<sec_start>\d+)\s*-\s*(?P<sec_end>\d+)\s*节"
)
_COURSE_CODE_RE = re.compile(r"^([0-9A-Z]{6,}[A-Za-z0-9]*)")


def _expand_weeks(weeks_text: str) -> list:
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


def _clean_text(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


_SECTION_RANGE_RE = re.compile(r"第?\s*(\d+)\s*[-~—]\s*(\d+)\s*节|第?\s*(\d+)\s*节")
_WEEKS_ONLY_RE = re.compile(r"\d+\s*-\s*\d+\s*周|\d+\s*周")
_ROOM_HINT_RE = re.compile(r"\d{2,}|楼|馆|场|室|房|厅|中心|基地|广场")
_PERIOD_LABEL_RE = re.compile(r"^第\s*[0-9一二三四五六七八九十]+\s*节(\s*[（(]\s*[0-9\-,，~]+\s*节?\s*[)）])?$")
_CN_NUM = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}
# 教务格子内自带的时间行：如「周一第1,2节{第2-11周}」「周三第7节{第9-9周|单周}」
_DAY_MAP = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7}
_TIME_LINE_RE = re.compile(
    r"^周([一二三四五六日天])第([0-9,,，\-~]+)节\{第?([0-9\-]+)周(?:\|([单双])周)?\}$"
)


def _section_of(label: str) -> int:
    """「第三节」/「第3节」/「3」 -> 3"""
    t = _clean_text(label)
    m = re.match(r"^第\s*([0-9一二三四五六七八九十]+)\s*节", t)
    if m:
        s = m.group(1)
        if s.isdigit():
            return int(s)
        if s == "十":
            return 10
        if "十" in s:
            parts = s.split("十")
            tens = _CN_NUM.get(parts[0], 1) if parts[0] else 1
            ones = _CN_NUM.get(parts[1], 0) if len(parts) > 1 and parts[1] else 0
            return tens * 10 + ones
        return _CN_NUM.get(s, 0)
    m = re.match(r"^(\d+)", t)
    return int(m.group(1)) if m else 0


def _parse_course_cell(cell_text: str, day: int, section: int) -> list[CourseEntry]:
    entries: list[CourseEntry] = []
    for chunk in re.split(r"-{5,}", cell_text):
        lines = [_clean_text(x) for x in chunk.splitlines() if _clean_text(x)]
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
                    weeks_text=weeks_text, weeks=_expand_weeks(weeks_text),
                    day=d,
                    start_section=secs[0] if secs else section,
                    end_section=secs[-1] if secs else section,
                    raw=_clean_text(cell_text)[:120],
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
                teacher = _clean_text(line)
        if not name_line:
            continue
        entries.append(CourseEntry(
            name=name_line, teacher=teacher, room=room,
            weeks_text=weeks_text, weeks=_expand_weeks(weeks_text),
            day=day, start_section=sec_start or section, end_section=sec_end or section,
            raw=_clean_text(cell_text)[:120],
        ))
    return entries


def _grid_from_table(table) -> list[list[str]]:
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


def _skip_cell(text: str) -> bool:
    """表头/行头类单元格不当作课程"""
    t = _clean_text(text)
    if not t:
        return True
    if re.fullmatch(r"星期[一二三四五六日天]", t):
        return True
    if _PERIOD_LABEL_RE.fullmatch(t):
        return True
    if t in ("节次", "星期", "上午", "下午", "晚上", "时间", "星期/节次"):
        return True
    return False


def parse_schedule_html(html: str) -> list[CourseEntry]:
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", id="Table1")
    if table is None:
        for t in soup.find_all("table"):
            if "星期" in t.get_text():
                table = t
                break
    if table is None:
        raise ParseFailedError("未找到课表表格，页面结构可能已变化")

    grid = _grid_from_table(table)
    day_map = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7}
    day_re = re.compile(r"^星期([一二三四五六日天])$")
    entries: list[CourseEntry] = []
    seen: set = set()

    def add_from_cell(cell_text: str, day: int, section: int) -> None:
        if _skip_cell(cell_text):
            return
        for e in _parse_course_cell(cell_text, day, section):
            key = (e.name, e.day, e.start_section, e.room, e.raw, tuple(e.weeks))
            if key not in seen:
                seen.add(key)
                entries.append(e)

    # 布局 A：表头一行含多个「星期X」→ 行是节次
    header_row, day_cols = -1, {}
    for r, row in enumerate(grid):
        cols = {}
        for c, txt in enumerate(row):
            m = day_re.match(_clean_text(txt))
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
                t0 = _clean_text(row[c0])
                if _PERIOD_LABEL_RE.fullmatch(t0):
                    sec = _section_of(t0)
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
                t = _clean_text(txt)
                if _PERIOD_LABEL_RE.fullmatch(t):
                    cols[c] = _section_of(t)
            if len(cols) >= 3:
                header_row, period_cols = r, cols
                break
        if header_row < 0:
            raise ParseFailedError("课表表头未识别，页面结构可能已变化")
        for r in range(header_row + 1, len(grid)):
            row = grid[r]
            if not row:
                continue
            m = day_re.match(_clean_text(row[0])) or re.search(r"星期([一二三四五六日天])", _clean_text(row[0]))
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


def entries_to_rows(entries: list[CourseEntry]) -> list[dict]:
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


# ---------------- 教务系统会话（一次性，用后即焚） ----------------

class ZfsoftSession:
    """承载「取验证码 → 提交登录 → 抓课表」的一次性会话"""

    def __init__(self, timeout: int = DEFAULT_TIMEOUT):
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                           "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"),
        })
        self.viewstate = ""
        self.viewstate_generator = ""
        self.key_e = ""
        self.key_n = ""
        self.captcha_path = "/CheckCode.aspx"
        self.logged_in = False
        self._password = ""   # 登录瞬间使用，随即清空

    # -- 步骤 1：打开登录页 --
    def open_login_page(self) -> None:
        try:
            resp = self.session.get(BASE_URL, timeout=self.timeout)
            resp.raise_for_status()
        except requests.exceptions.Timeout as e:
            raise NetworkTimeoutError("教务系统连接超时，请稍后重试") from e
        except requests.exceptions.RequestException as e:
            raise NetworkTimeoutError("教务系统暂不可达") from e
        soup = BeautifulSoup(resp.text, "html.parser")
        vs = soup.find("input", {"name": "__VIEWSTATE"})
        if vs is None:
            raise LoginFailedError("教务系统登录页异常，可能正在维护")
        self.viewstate = vs.get("value", "")
        vg = soup.find("input", {"name": "__VIEWSTATEGENERATOR"})
        self.viewstate_generator = vg.get("value", "") if vg else ""
        ke = soup.find("input", {"name": "txtKeyExponent"})
        kn = soup.find("input", {"name": "txtKeyModulus"})
        self.key_e = ke.get("value", "") if ke else ""
        self.key_n = kn.get("value", "") if kn else ""
        if not (self.key_e and self.key_n):
            raise LoginFailedError("未获取到登录公钥")
        # 验证码图片地址（登录页下发，带 SafeKey 参数，缺它会返回 HTML 错误页）
        img = soup.find("img", id="icode") or soup.find("img", src=re.compile("CheckCode", re.I))
        if img is not None and img.get("src"):
            src = img["src"]
            self.captcha_path = src if src.startswith("/") else "/" + src

    # -- 步骤 2：验证码图片（data URL，与会话 Cookie 绑定） --
    def captcha_data_url(self) -> str:
        try:
            resp = self.session.get(BASE_URL + self.captcha_path,
                                    timeout=self.timeout, headers={"Referer": BASE_URL})
            resp.raise_for_status()
        except requests.exceptions.RequestException as e:
            raise NetworkTimeoutError("获取验证码失败，请稍后重试") from e
        ctype = resp.headers.get("Content-Type", "image/png").split(";")[0].strip()
        if "image" not in ctype or not resp.content:
            raise NetworkTimeoutError("验证码服务异常，请刷新重试")
        b64 = base64.b64encode(resp.content).decode()
        return f"data:{ctype};base64,{b64}"

    # -- 步骤 3：登录（密码用后即清） --
    def login(self, username: str, password: str, captcha: str) -> None:
        self._password = password
        try:
            enc_pwd = zf_rsa_encrypt(self._password, self.key_e, self.key_n)
            payload = {
                "__VIEWSTATE": self.viewstate,
                "__VIEWSTATEGENERATOR": self.viewstate_generator,
                "txtUserName": username, "yhm": username,          # 兼容页面重复 name 属性
                "TextBox2": enc_pwd, "mm": enc_pwd,
                "txtSecretCode": captcha,
                "RadioButtonList1": "学生",
                "Button1": "登录",
            }
            resp = self.session.post(f"{BASE_URL}/", data=payload, timeout=self.timeout,
                                     headers={"Referer": f"{BASE_URL}/"},
                                     allow_redirects=True)
            resp.raise_for_status()
        except requests.exceptions.Timeout as e:
            raise NetworkTimeoutError("登录请求超时，请稍后重试") from e
        except requests.exceptions.RequestException as e:
            raise NetworkTimeoutError("登录请求失败，教务系统暂不可达") from e
        finally:
            self._password = ""        # 密码即刻清除

        text = resp.text
        if MAIN_PAGE_HINT in text or MAIN_PAGE_HINT in resp.url or "xskbcx" in resp.url:
            self.logged_in = True
            return
        alerts = re.findall(r'alert\("([^"]*)"\)|alert\(\'([^\']*)\'\)', text)
        msg = next((a or b for a, b in alerts if a or b), "")
        # zfsoft 对验证码不符/会话失效的提示常为「服务器超时...请刷新后重试」
        if "验证码" in msg or "请刷新后重试" in msg or ("超时" in msg and "刷新" in msg):
            raise CaptchaError(msg or "验证码不正确，请刷新后重新输入")
        if re.search(r"密码|口令", msg):
            raise WrongPasswordError(msg or "教务系统密码错误")
        if re.search(r"用户名|学号|不存在|锁定|停用", msg):
            raise LoginFailedError(msg or "学号不存在或已被限制登录")
        raise LoginFailedError(msg or "登录未成功，请检查学号、密码和验证码")

    # -- 步骤 4：抓课表 --
    def _resolve_menu_url(self, username: str) -> str:
        """进入教务主页面，从「信息查询 → 学生个人课表」菜单解析真实链接"""
        try:
            resp = self.session.get(f"{BASE_URL}/xs_main.aspx?xh={username}",
                                    timeout=self.timeout, headers={"Referer": f"{BASE_URL}/default2.aspx"})
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, "html.parser")
            candidates = []   # (优先级, href)
            for a in soup.find_all("a", href=True):
                text = _clean_text(a.get_text())
                if not text:
                    continue
                if text == "学生个人课表":
                    candidates.append((0, a["href"]))
                elif "个人课表" in text:
                    candidates.append((1, a["href"]))
                elif text == "课表" or "学生课表" in text:
                    candidates.append((2, a["href"]))
            if candidates:
                candidates.sort(key=lambda x: x[0])
                href = candidates[0][1]
                if href and not href.lower().startswith(("javascript", "#")):
                    return urljoin(BASE_URL + "/", href)
        except requests.exceptions.RequestException:
            pass
        # 菜单解析失败时回退到默认个人课表地址
        return f"{BASE_URL}/xskbcx.aspx?xh={username}&gnmkdm=N121603"

    def fetch_schedule_html(self, username: str) -> str:
        url = self._resolve_menu_url(username)
        try:
            resp = self.session.get(url, timeout=self.timeout,
                                    headers={"Referer": f"{BASE_URL}/xs_main.aspx"})
            resp.raise_for_status()
        except requests.exceptions.Timeout as e:
            raise NetworkTimeoutError("获取课表超时，请稍后重试") from e
        except requests.exceptions.RequestException as e:
            raise NetworkTimeoutError("获取课表失败，教务系统暂不可达") from e
        if "default2.aspx" in resp.url and MAIN_PAGE_HINT not in resp.url:
            raise LoginFailedError("登录会话失效，请重新登录")
        html = resp.text
        # 若该页面不是课表页（比如需要再带学号参数访问），尝试补一次 xh 参数
        if "Table1" not in html and "xh=" not in url and "gnmkdm" in url:
            sep = "&" if "?" in url else "?"
            try:
                resp2 = self.session.get(f"{url}{sep}xh={username}", timeout=self.timeout,
                                         headers={"Referer": f"{BASE_URL}/xs_main.aspx"})
                resp2.raise_for_status()
                if "Table1" in resp2.text:
                    html = resp2.text
            except requests.exceptions.RequestException:
                pass
        return html

    def close(self) -> None:
        self.session.close()
        self._password = ""


# ---------------- 一次性会话仓库（验证码 → 查询 配对） ----------------

_SESSIONS: dict[str, tuple[ZfsoftSession, float]] = {}
_LOCK = threading.Lock()
SESSION_TTL = 300  # 秒


def _cleanup_locked(now: float) -> None:
    expired = [k for k, (_, t0) in _SESSIONS.items() if now - t0 > SESSION_TTL]
    for k in expired:
        try:
            _SESSIONS[k][0].close()
        except Exception:
            pass
        _SESSIONS.pop(k, None)


def new_session() -> str:
    sess = ZfsoftSession()
    sess.open_login_page()
    sid = uuid.uuid4().hex
    with _LOCK:
        _cleanup_locked(time.time())
        _SESSIONS[sid] = (sess, time.time())
    return sid


def pop_session(sid: str) -> ZfsoftSession:
    """取出并销毁会话（一次性）"""
    with _LOCK:
        item = _SESSIONS.pop(sid or "", None)
    if item is None:
        raise CaptchaError("会话已过期，请刷新验证码后重试")
    sess, t0 = item
    if time.time() - t0 > SESSION_TTL:
        sess.close()
        raise CaptchaError("会话已过期，请刷新验证码后重试")
    return sess


# ---------------- 对外主函数 ----------------

def create_captcha() -> tuple[str, str]:
    """创建登录会话并返回 (sid, 验证码 dataURL)"""
    sid = new_session()
    with _LOCK:
        sess, _ = _SESSIONS[sid]
    return sid, sess.captcha_data_url()


def query_schedule(sid: str, username: str, password: str, captcha: str) -> dict:
    """用一次性会话完成登录 + 抓课表。返回 rows 结构，密码用后即清。"""
    sess = pop_session(sid)
    try:
        sess.login(username.strip(), password, captcha.strip())
        html = sess.fetch_schedule_html(username.strip())
        # 留存最近一次课表页快照（仅本地、不含密码），便于精确排查解析问题
        try:
            with open(os.path.join(os.path.dirname(__file__), "_schedule_debug.html"),
                      "w", encoding="utf-8") as f:
                f.write(html)
        except OSError:
            pass
        try:
            entries = parse_schedule_html(html)
        except ParseFailedError:
            raise
        except Exception:
            raise ParseFailedError("课表解析失败，页面结构可能已变化")
        per_day = {}
        for e in entries:
            per_day[e.day] = per_day.get(e.day, 0) + 1
        logging.getLogger("jou").info(
            "课表解析成功: %d 门, 各天分布 %s, 示例: %s",
            len(entries), dict(sorted(per_day.items())),
            (entries[0].raw[:60] if entries else ""))
        return {"student_id": username.strip(), "rows": entries_to_rows(entries)}
    finally:
        sess.close()


# ---------------- 测试样例（MOCK 模式专用，不涉及任何真实账号） ----------------

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
                        weeks=_expand_weeks(wk), day=d,
                        start_section=s1, end_section=s2,
                        raw=f"{n} {wk} {r} {t}")
            for (n, t, r, wk, d, s1, s2) in MockSchedule._SAMPLE
        ]
        return entries_to_rows(entries)
