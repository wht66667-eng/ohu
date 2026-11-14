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
import secrets
import logging
import threading
import time
import uuid
from dataclasses import dataclass, field, asdict

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

BASE_URL = "https://zfxk.jou.edu.cn"
MAIN_PAGE_HINT = "xs_main.aspx"

# 上游超时拆分为 (连接超时, 读取超时)：教务系统登录页/课表页偶发慢响应，
# 读取给足 20s，避免首次访问或服务冷启动时被误判为超时（前端 1006）
CONNECT_TIMEOUT = float(os.environ.get("UPSTREAM_CONNECT_TIMEOUT", "5"))
READ_TIMEOUT = float(os.environ.get("UPSTREAM_READ_TIMEOUT", "20"))
DEFAULT_TIMEOUT: tuple[float, float] = (CONNECT_TIMEOUT, READ_TIMEOUT)

# 进程内一次性会话总量上限：超出后按创建时间淘汰最旧的，防止被批量刷取导致内存膨胀
MAX_CAPTCHA_SESSIONS = int(os.environ.get("MAX_CAPTCHA_SESSIONS", "800"))

# 是否把最近一次课表页快照落盘（仅排查解析问题时开启；默认关闭，避免容器写入含个人信息的页面）
SAVE_DEBUG_HTML = os.environ.get("SAVE_DEBUG_HTML", "").strip() == "1"


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
        b[msg_length + 1 + x] = secrets.randbelow(254) + 1
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


def _html_text(resp: requests.Response) -> str:
    """正方页面多为 GBK/GB2312；部分响应不在 HTTP 头声明 charset，requests 会按
    ISO-8859-1 解码导致中文乱码，使课表表头、菜单关键字与 alert 提示全部解析失败。
    与 physical_read / chaoxing_read 一致：编码缺失或为 ISO-8859-1 时回退到探测编码。
    已声明 charset（gb2312/utf-8 等）的响应保持不变，不影响当前可用页面。"""
    enc = (resp.encoding or "").lower()
    if not enc or enc == "iso-8859-1":
        resp.encoding = resp.apparent_encoding or "utf-8"
    return resp.text


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

    def __init__(self, timeout: tuple[float, float] | float = DEFAULT_TIMEOUT):
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
        self._main_soup = None
        self._main_html = ""

    # -- 步骤 1：打开登录页 --
    def open_login_page(self) -> None:
        try:
            resp = self.session.get(BASE_URL, timeout=self.timeout)
            resp.raise_for_status()
        except requests.exceptions.Timeout as e:
            raise NetworkTimeoutError("教务系统连接超时，请稍后重试") from e
        except requests.exceptions.RequestException as e:
            raise NetworkTimeoutError("教务系统暂不可达") from e
        soup = BeautifulSoup(_html_text(resp), "html.parser")
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
    def captcha_bytes(self) -> tuple[bytes, str]:
        """返回 (图片字节, content-type)。OCR 与 dataURL 共用同一张图。"""
        try:
            resp = self.session.get(BASE_URL + self.captcha_path,
                                    timeout=self.timeout, headers={"Referer": BASE_URL})
            resp.raise_for_status()
        except requests.exceptions.RequestException as e:
            raise NetworkTimeoutError("获取验证码失败，请稍后重试") from e
        ctype = resp.headers.get("Content-Type", "image/png").split(";")[0].strip()
        if "image" not in ctype or not resp.content:
            raise NetworkTimeoutError("验证码服务异常，请刷新重试")
        return resp.content, ctype

    def captcha_data_url(self) -> str:
        raw, ctype = self.captcha_bytes()
        b64 = base64.b64encode(raw).decode()
        return f"data:{ctype};base64,{b64}"

    # -- 步骤 3：登录（密码用后即清） --
    def login(self, username: str, password: str, captcha: str) -> None:
        # 输入法全角符号（！等）归一成半角，与网页输入一致
        import unicodedata
        password = unicodedata.normalize("NFKC", password or "")
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

        text = _html_text(resp)
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

    def _load_main(self, username: str):
        """缓存 xs_main，供菜单解析复用"""
        if getattr(self, "_main_soup", None) is not None:
            return self._main_soup
        try:
            resp = self.session.get(
                f"{BASE_URL}/xs_main.aspx?xh={username}",
                timeout=self.timeout,
                headers={"Referer": f"{BASE_URL}/default2.aspx"},
            )
            resp.raise_for_status()
            html = _html_text(resp)
            self._main_soup = BeautifulSoup(html, "html.parser")
            self._main_html = html
            return self._main_soup
        except requests.exceptions.RequestException as e:
            raise NetworkTimeoutError("打开教务主页失败") from e

    # -- 步骤 4：抓课表 --
    def _resolve_menu_url(self, username: str) -> str:
        """进入教务主页面，从「信息查询 → 学生个人课表」菜单解析真实链接"""
        from academic_parse import find_menu_href
        try:
            soup = self._load_main(username)
            return find_menu_href(
                soup,
                ["学生个人课表", "个人课表", "学生课表", "课表"],
                f"{BASE_URL}/xskbcx.aspx?xh={username}&gnmkdm=N121603",
            )
        except Exception:
            return f"{BASE_URL}/xskbcx.aspx?xh={username}&gnmkdm=N121603"

    def _resolve_grades_url(self, username: str) -> str:
        from academic_parse import find_menu_href
        try:
            soup = self._load_main(username)
            # 只要历年/成绩查询，不要「本学期成绩」
            return find_menu_href(
                soup,
                ["历年成绩", "成绩查询", "学生成绩查询", "成绩"],
                f"{BASE_URL}/xscjcx.aspx?xh={username}&gnmkdm=N121605",
            )
        except Exception:
            return f"{BASE_URL}/xscjcx.aspx?xh={username}&gnmkdm=N121605"

    def _resolve_exams_url(self, username: str) -> str:
        from academic_parse import find_menu_href
        try:
            soup = self._load_main(username)
            return find_menu_href(
                soup,
                ["学生考试查询", "考试查询", "考试安排", "我的考试", "考试"],
                f"{BASE_URL}/xskscx.aspx?xh={username}&gnmkdm=N121604",
            )
        except Exception:
            return f"{BASE_URL}/xskscx.aspx?xh={username}&gnmkdm=N121604"

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
        html = _html_text(resp)
        # 若该页面不是课表页（比如需要再带学号参数访问），尝试补一次 xh 参数
        if "Table1" not in html and "xh=" not in url and "gnmkdm" in url:
            sep = "&" if "?" in url else "?"
            try:
                resp2 = self.session.get(f"{url}{sep}xh={username}", timeout=self.timeout,
                                         headers={"Referer": f"{BASE_URL}/xs_main.aspx"})
                resp2.raise_for_status()
                resp2_html = _html_text(resp2)
                if "Table1" in resp2_html:
                    html = resp2_html
            except requests.exceptions.RequestException:
                pass
        return html

    @staticmethod
    def _attr_str(val) -> str:
        """BeautifulSoup 属性偶发 list/None，统一成可入表单的 str。"""
        if val is None:
            return ""
        if isinstance(val, (list, tuple)):
            return str(val[0]) if val else ""
        return str(val)

    @classmethod
    def _form_hidden(cls, soup: BeautifulSoup) -> dict[str, str]:
        """收集 ASP.NET 隐藏域（VIEWSTATE / EVENTVALIDATION 等）+ 下拉当前值"""
        out: dict[str, str] = {}
        for inp in soup.find_all("input"):
            itype = (cls._attr_str(inp.get("type")) or "text").lower()
            if itype not in ("hidden", "text"):
                continue
            # 文本框仅收学号等短字段，避免把验证码框空值冲掉；隐藏域全收
            name = cls._attr_str(inp.get("name"))
            if not name:
                continue
            if itype == "text" and name.lower() not in (
                "txtxh", "xh", "txt_xh", "textbox1",
            ):
                continue
            out[name] = cls._attr_str(inp.get("value"))
        for sel in soup.find_all("select"):
            name = cls._attr_str(sel.get("name"))
            if not name:
                continue
            opted = sel.find("option", selected=True) or sel.find("option")
            out[name] = cls._attr_str(opted.get("value") if opted else "")
        return out

    @classmethod
    def _grade_buttons(cls, soup: BeautifulSoup) -> list[tuple[str, str]]:
        """从成绩页收集可点的查询按钮（优先页面真实 value，再回退常见名）。"""
        found: list[tuple[str, str]] = []
        seen: set[str] = set()
        for inp in soup.find_all("input"):
            itype = (cls._attr_str(inp.get("type")) or "").lower()
            if itype not in ("submit", "button"):
                continue
            name = cls._attr_str(inp.get("name"))
            val = cls._attr_str(inp.get("value"))
            if not name or name in seen:
                continue
            if val and not any(k in val for k in ("成绩", "查询", "学年", "学期", "统计")):
                continue
            seen.add(name)
            found.append((name, val or "查询"))
        # 页面无按钮文案时仍尝试正方默认
        for name, val in (
            ("btn_zcj", "历年成绩"),
            ("btn_xn", "按学年查询"),
            ("btn_xq", "按学期查询"),
            ("Button1", "查询"),
            ("btn_cx", "查询"),
            ("btnCj", "成绩"),
        ):
            if name not in seen:
                found.append((name, val))
                seen.add(name)
        # 历年成绩优先
        def _rank(item: tuple[str, str]) -> int:
            n, v = item
            if "历年" in v or n == "btn_zcj":
                return 0
            if "学年" in v:
                return 1
            if "学期" in v:
                return 2
            return 3

        found.sort(key=_rank)
        return found

    @staticmethod
    def _post_form_gbk(session: requests.Session, url: str, fields: dict[str, str], timeout) -> requests.Response:
        """
        正方成绩页按钮值（历年成绩等）需按 GBK 百分号编码提交；
        不用 requests 默认 UTF-8，避免按钮失效、表格为空。
        """
        from urllib.parse import quote

        parts: list[str] = []
        for k, v in fields.items():
            ks = quote(str(k), safe="", encoding="gbk", errors="replace")
            vs = quote(str(v), safe="", encoding="gbk", errors="replace")
            parts.append(f"{ks}={vs}")
        body = "&".join(parts).encode("ascii", errors="replace")
        return session.post(
            url,
            data=body,
            timeout=timeout,
            headers={
                "Referer": url,
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": BASE_URL,
            },
        )

    def fetch_grades(self, username: str) -> list[dict]:
        """历年成绩（全部学期）：优先 xscjcx + POST「历年成绩」，学年学期下拉置空。"""
        from academic_parse import extract_asp_alert, parse_grades_html

        # 先回主页，部分正方实例要求从菜单链进入成绩页
        try:
            self._load_main(username)
        except ScheduleError:
            pass
        except Exception:
            logger.warning("grades: 刷新主页失败，继续尝试直链")

        resolved = self._resolve_grades_url(username)
        # 菜单若误落到本学期页（_dq），仍把历年页放最前
        all_years = [
            f"{BASE_URL}/xscjcx.aspx?xh={username}&gnmkdm=N121605",
            f"{BASE_URL}/xscjcx.aspx?xh={username}",
        ]
        current_only = [
            f"{BASE_URL}/xscjcx_dq.aspx?xh={username}&gnmkdm=N121605",
            f"{BASE_URL}/xscjcx_dq.aspx?xh={username}",
        ]
        candidates: list[str] = []
        if resolved and "xscjcx_dq" not in resolved.lower():
            candidates.append(resolved)
        candidates.extend(all_years)
        if resolved and "xscjcx_dq" in resolved.lower():
            candidates.append(resolved)
        # _dq 仅作最后兜底（通常只有本学期）
        candidates.extend(current_only)

        seen: set[str] = set()
        last_alert = ""
        net_err: Exception | None = None
        best_grades: list[dict] = []

        for url in candidates:
            if not url or url in seen:
                continue
            seen.add(url)
            is_dq = "xscjcx_dq" in url.lower()
            try:
                resp = self.session.get(
                    url, timeout=self.timeout, headers={"Referer": f"{BASE_URL}/xs_main.aspx"}
                )
                resp.raise_for_status()
            except requests.exceptions.RequestException as e:
                net_err = e
                logger.info("grades GET 失败 url=%s err=%s", url.split("?")[0], type(e).__name__)
                continue

            post_url = resp.url or url
            html = _html_text(resp) or ""
            if "default2.aspx" in (resp.url or "") and MAIN_PAGE_HINT not in (resp.url or ""):
                raise LoginFailedError("登录会话失效，请重新登录")
            alert = extract_asp_alert(html)
            if alert:
                last_alert = alert
                if any(k in alert for k in ("登录", "重新", "权限", "过期", "超时")):
                    raise LoginFailedError(alert)

            try:
                soup = BeautifulSoup(html, "html.parser")
                payload = self._form_hidden(soup)
            except Exception:
                logger.warning("grades: 表单解析异常")
                continue

            # 有表单则优先 POST「历年成绩」，不要被 GET 上本学期残表提前 return
            if "__VIEWSTATE" in payload:
                payload.setdefault("ddlXN", "")
                payload.setdefault("ddlXQ", "")
                payload.setdefault("ddl_kcxz", "")
                payload.setdefault("hidLanguage", "")
                payload.setdefault("__EVENTTARGET", "")
                payload.setdefault("__EVENTARGUMENT", "")
                # 历年查询必须清空学年/学期，否则只会出当前选中学期
                payload["ddlXN"] = ""
                payload["ddlXQ"] = ""

                for btn_name, btn_val in self._grade_buttons(soup):
                    # 本学期页上的「学期查询」跳过；只在 _dq 兜底时才用
                    if is_dq and ("历年" in btn_val or btn_name == "btn_zcj"):
                        continue
                    if not is_dq and btn_name not in (
                        "btn_zcj", "btn_xn", "btn_xq", "Button1", "btn_cx", "btnCj",
                    ) and "历年" not in btn_val and "学年" not in btn_val and "查询" not in btn_val:
                        continue
                    data = dict(payload)
                    # 点「历年成绩 / 按学年」时强制空学年学期 = 全部学期
                    if "历年" in btn_val or btn_name in ("btn_zcj", "btn_xn"):
                        data["ddlXN"] = ""
                        data["ddlXQ"] = ""
                    data[btn_name] = btn_val
                    try:
                        r2 = self._post_form_gbk(self.session, post_url, data, self.timeout)
                        r2.raise_for_status()
                    except requests.exceptions.RequestException as e:
                        logger.info(
                            "grades POST 失败 btn=%s err=%s", btn_name, type(e).__name__
                        )
                        continue
                    except Exception:
                        logger.warning("grades POST 编码/提交异常")
                        continue
                    alert2 = extract_asp_alert(_html_text(r2) or "")
                    if alert2:
                        last_alert = alert2
                    try:
                        grades = parse_grades_html(_html_text(r2) or "")
                    except Exception:
                        logger.warning("grades: POST 页解析异常")
                        continue
                    if grades:
                        # 历年按钮结果直接采用；否则留下最长的一份
                        if "历年" in btn_val or btn_name == "btn_zcj" or not is_dq:
                            if len(grades) >= len(best_grades):
                                best_grades = grades
                            if "历年" in btn_val or btn_name == "btn_zcj":
                                return grades
                        elif len(grades) > len(best_grades):
                            best_grades = grades

            # GET 已带表：仅当非本学期页，或还没有任何结果时作候选
            try:
                grades_get = parse_grades_html(html)
            except Exception:
                logger.warning("grades: GET 页解析异常")
                grades_get = []
            if grades_get:
                if not is_dq:
                    if len(grades_get) >= len(best_grades):
                        best_grades = grades_get
                    # 历年页 GET 已有多学期表时可直接用
                    years = {g.get("year") for g in grades_get if g.get("year")}
                    if len(years) > 1 or len(grades_get) >= 8:
                        return grades_get
                elif len(grades_get) > len(best_grades):
                    best_grades = grades_get

        if best_grades:
            return best_grades
        if last_alert:
            if any(k in last_alert for k in ("登录", "重新", "权限", "过期", "超时")):
                raise LoginFailedError(last_alert)
            raise ParseFailedError(f"成绩页提示：{last_alert}")
        if net_err is not None and len(seen) <= 1:
            raise NetworkTimeoutError("获取成绩页失败") from net_err
        return []

    def fetch_exams(self, username: str) -> list[dict]:
        from academic_parse import parse_exams_html
        url = self._resolve_exams_url(username)
        # 若菜单误落到等级考试页，强制回退到期末考试安排
        if "djkscx" in url.lower() or "xsdjk" in url.lower():
            url = f"{BASE_URL}/xskscx.aspx?xh={username}&gnmkdm=N121604"
        try:
            resp = self.session.get(
                url, timeout=self.timeout, headers={"Referer": f"{BASE_URL}/xs_main.aspx"}
            )
            resp.raise_for_status()
        except requests.exceptions.RequestException as e:
            raise NetworkTimeoutError("获取考试安排失败") from e
        exams = parse_exams_html(_html_text(resp))
        if exams:
            return exams
        # 考试安排页默认空表，必须提交查询 postback 才有数据（与成绩页同型）。
        # 旧版只试 3 个固定按钮名，页面实际按钮名不同时永远查不到 —— 改为
        # 通用扫描：页面上所有 submit/button 全试，并分别尝试 清空学年学期 与
        # 保留默认两种下拉口径（成绩页同款策略，生产已验证有效）。
        soup = BeautifulSoup(_html_text(resp), "html.parser")
        payload = self._form_hidden(soup)
        if "__VIEWSTATE" not in payload:
            return []
        attempts = 0
        for btn_name, btn_val in self._query_buttons(soup):
            for variant in ("asis", "clear_term"):
                if attempts >= 8:
                    break
                attempts += 1
                data = dict(payload)
                if variant == "clear_term":
                    data["ddlXN"] = ""
                    data["ddlXQ"] = ""
                data[btn_name] = btn_val
                try:
                    r2 = self._post_form_gbk(self.session, url, data, self.timeout)
                    r2.raise_for_status()
                    exams = parse_exams_html(_html_text(r2))
                    if exams:
                        return exams
                except requests.exceptions.RequestException:
                    continue
                except Exception:
                    logger.warning("exams: POST 编码/提交异常 btn=%s", btn_name)
                    continue
        return []

    @classmethod
    def _query_buttons(cls, soup: BeautifulSoup) -> list[tuple[str, str]]:
        """考试页查询按钮通用扫描：页面真实 submit 优先，回退正方常见名。"""
        found: list[tuple[str, str]] = []
        seen: set[str] = set()
        for inp in soup.find_all("input"):
            itype = (cls._attr_str(inp.get("type")) or "").lower()
            if itype not in ("submit", "button"):
                continue
            name = cls._attr_str(inp.get("name"))
            val = cls._attr_str(inp.get("value"))
            if not name or name in seen:
                continue
            if val and not any(k in val for k in ("考试", "查询", "学期", "确定", "搜索")):
                continue
            seen.add(name)
            found.append((name, val or "查询"))
        for name, val in (
            ("btn_kscx", "考试查询"),
            ("btn_xq", "学期查询"),
            ("Button1", "查询"),
            ("btn_cx", "查询"),
        ):
            if name not in seen:
                found.append((name, val))
                seen.add(name)
        return found

    def close(self) -> None:
        self.session.close()
        self._password = ""
        self._main_soup = None


# ---------------- 一次性会话仓库（验证码 → 查询 配对） ----------------

_SESSIONS: dict[str, tuple[ZfsoftSession, float]] = {}
_LOCK = threading.Lock()
SESSION_TTL = 300  # 秒


def _close_quietly(item) -> None:
    if not item:
        return
    try:
        item[0].close()
    except Exception:
        pass


def _cleanup_locked(now: float) -> None:
    """清理过期会话；会话数超上限时按创建时间淘汰最旧的（dict 保持插入顺序）"""
    expired = [k for k, (_, t0) in _SESSIONS.items() if now - t0 > SESSION_TTL]
    for k in expired:
        _close_quietly(_SESSIONS.pop(k, None))
    overflow = len(_SESSIONS) - MAX_CAPTCHA_SESSIONS
    if overflow > 0:
        for k in list(_SESSIONS.keys())[:overflow]:
            _close_quietly(_SESSIONS.pop(k, None))
        logger.warning("验证码会话超过上限 %d，已淘汰 %d 个最旧会话", MAX_CAPTCHA_SESSIONS, overflow)


def active_sessions() -> int:
    """当前存活的验证码会话数（供 /api/health 巡检）"""
    with _LOCK:
        _cleanup_locked(time.time())
        return len(_SESSIONS)


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


def create_captcha_with_bytes() -> tuple[str, str, bytes]:
    """创建登录会话并返回 (sid, dataURL, 原始图片字节) —— 供 OCR 自动登录"""
    sid = new_session()
    with _LOCK:
        sess, _ = _SESSIONS[sid]
    raw, ctype = sess.captcha_bytes()
    b64 = base64.b64encode(raw).decode()
    return sid, f"data:{ctype};base64,{b64}", raw


def query_schedule(sid: str, username: str, password: str, captcha: str) -> dict:
    """兼容旧契约：只返回课表 rows。"""
    return query_academic(sid, username, password, captcha, fetch=["schedule"])


def auto_query_academic(
    username: str,
    password: str,
    fetch: list[str] | None = None,
    max_tries: int = 5,
) -> dict:
    """
    学号 + 密码自动登录：服务端 OCR 验证码，失败自动换图重试。
    成功返回与 query_academic 相同结构；OCR 不可用时抛 LoginFailedError(code 可通过子类区分)。
    """
    from captcha_ocr import ocr_available, solve_captcha_image

    if not ocr_available():
        err = LoginFailedError("服务端未启用验证码自动识别，请手输验证码")
        err.code = "1010"
        err.reason = "ocr-unavailable"
        err.http = 501
        raise err

    uid = username.strip()
    last: Exception | None = None
    tries = max(1, min(8, int(max_tries)))
    for i in range(tries):
        sid = ""
        try:
            sid, _image, raw = create_captcha_with_bytes()
            try:
                code = solve_captcha_image(raw)
            except ValueError as e:
                # 识别失败：丢掉会话再试
                try:
                    pop_session(sid)
                except Exception:
                    pass
                last = CaptchaError(f"验证码识别失败({e})")
                logger.info("auto OCR 识别失败 try=%d/%d id=%s", i + 1, tries, uid[:4] + "***")
                continue
            logger.info("auto OCR try=%d/%d captcha_len=%d", i + 1, tries, len(code))
            return query_academic(sid, uid, password, code, fetch=fetch)
        except CaptchaError as e:
            last = e
            logger.info("auto 验证码错/会话过期 try=%d/%d", i + 1, tries)
            continue
        except WrongPasswordError:
            raise
        except ScheduleError:
            raise
        except Exception as e:
            last = e
            logger.warning("auto 未预期异常 try=%d", i + 1)
            continue
    if isinstance(last, ScheduleError):
        raise last
    raise CaptchaError("自动识别验证码多次失败，请手输验证码后重试")


def query_academic(
    sid: str,
    username: str,
    password: str,
    captcha: str,
    fetch: list[str] | None = None,
) -> dict:
    """
    一次验证码登录，按需抓取课表 / 成绩 / 考试。
    fetch 默认 ["schedule"]；学业中心可传 ["schedule","grades","exams"]。
    """
    want = set(fetch or ["schedule"])
    sess = pop_session(sid)
    uid = username.strip()
    try:
        sess.login(uid, password, captcha.strip())
        out: dict = {"student_id": uid}
        if "schedule" in want:
            html = sess.fetch_schedule_html(uid)
            if SAVE_DEBUG_HTML:
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
            out["rows"] = entries_to_rows(entries)
        if "grades" in want:
            try:
                out["grades"] = sess.fetch_grades(uid)
            except ParseFailedError as e:
                out["grades"] = []
                out["grades_error"] = str(e) or "成绩页解析失败"
            except ScheduleError as e:
                out["grades"] = []
                out["grades_error"] = str(e) or "成绩获取失败"
            except Exception as e:
                logger.warning("grades 未预期异常 id=%s", uid[:4] + "***")
                out["grades"] = []
                detail = f"{type(e).__name__}: {e}".strip()[:100]
                out["grades_error"] = f"成绩获取异常（{detail}）" if detail else "成绩获取异常"
        if "exams" in want:
            try:
                out["exams"] = sess.fetch_exams(uid)
            except Exception:
                out["exams"] = []
                out["exams_error"] = "考试安排获取异常"
        return out
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

    @staticmethod
    def grades() -> list[dict]:
        return [
            {"year": "2025-2026", "term": "1", "code": "B00001", "name": "大学英语(三)",
             "nature": "必修", "credit": "4.0", "score": "86", "gpa": "3.6"},
            {"year": "2025-2026", "term": "1", "code": "B00002", "name": "高等数学A(1)",
             "nature": "必修", "credit": "5.0", "score": "78", "gpa": "2.8"},
            {"year": "2025-2026", "term": "2", "code": "B00003", "name": "海洋概论",
             "nature": "必修", "credit": "2.0", "score": "92", "gpa": "4.0"},
        ]

    @staticmethod
    def exams() -> list[dict]:
        return [
            {"year": "2026-2027", "term": "1", "code": "C1001", "name": "流体力学",
             "datetime": "2027-01-08 09:00-11:00", "room": "C文思409",
             "form": "闭卷", "seat": "12", "campus": "苍梧校区", "teacher": "王老师"},
            {"year": "2026-2027", "term": "1", "code": "C1002", "name": "大学物理Ⅲ(2)",
             "datetime": "2027-01-10 14:00-16:00", "room": "B0306",
             "form": "闭卷", "seat": "05", "campus": "苍梧校区", "teacher": "钱老师"},
        ]
