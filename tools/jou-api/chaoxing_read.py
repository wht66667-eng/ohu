"""User-requested, read-only Chaoxing import. Cookies and passwords never reach disk.

Protocol/parsing reference: DanMo661/xuexitong-cli (MIT), commit
74b843ad4a3439a6ee5ba33f6a3288d9be6ed990. See THIRD_PARTY_NOTICES.md.
"""
from __future__ import annotations

import base64
import html
import re
import time
from urllib.parse import unquote, urljoin, urlsplit

import requests
from bs4 import BeautifulSoup


class ChaoxingReadError(Exception):
    pass


def safe_url(url: str) -> str:
    if url.startswith("http://"):
        url = "https://" + url[len("http://"):]
    p = urlsplit(url)
    if (p.scheme != "https" or p.username or p.password or p.port not in (None, 443)
            or not (p.hostname or "").endswith(".chaoxing.com")):
        raise ChaoxingReadError(f"学习通页面地址不受支持，已停止读取（{p.scheme}://{p.hostname}:{p.port}）")
    return url


def parse_courses(page: str) -> list[dict]:
    # Adapted from the MIT reference; names/teachers follow each course link.
    courses, seen = [], set()
    page = html.unescape(page)
    matches = list(re.finditer(r"stucoursemiddle\?courseid=(\d+)&clazzid=(\d+)&cpi=(\d+)", page))
    for i, match in enumerate(matches):
        cid, clazz, cpi = match.groups()
        key = f"{cid}:{clazz}:{cpi}"
        if key in seen:
            continue
        seen.add(key)
        # 课程名/教师落在本卡片内：用下一门「不同」课程的链接界定范围，
        # 既避免固定窗口越过下一链接窃取邻课名称（静默误标），也避免长卡片超出窗口漏读。
        seg_end = next((m.start() for m in matches[i + 1:] if f"{m[1]}:{m[2]}:{m[3]}" != key), len(page))
        segment = page[match.end():seg_end]
        name = re.search(r'course-name[^>]*title="([^"]+)"', segment)
        teacher = re.search(r'<p class="line2 color3"[^>]*title="([^"]+)"', segment)
        if not name:
            raise ChaoxingReadError("学习通课程页面结构变化，未覆盖原记录")
        courses.append({"key": key, "name": name[1].strip()[:120],
                        "teacher": teacher[1].strip()[:80] if teacher else ""})
    if not courses and not re.search(r"暂无课程|没有课程|还没有课程", page):
        raise ChaoxingReadError("未识别到课程列表，可能需要在学习通完成验证")
    if len(courses) > 200:
        raise ChaoxingReadError("课程数量超出本次同步上限，请联系支持")
    return courses


def parse_homework(page: str) -> list[dict]:
    soup = BeautifulSoup(page, "html.parser")
    tasks = []
    for li in soup.select('li[onclick][data]'):
        if "goTask" not in li.get("onclick", ""):
            continue
        title = li.select_one("p.overHidden2")
        status = li.select_one("p.status")
        if not title or not status:
            raise ChaoxingReadError("作业页面结构变化，原作业记录已保留")
        url = safe_url(urljoin("https://mooc1.chaoxing.com/", unquote(li["data"])))
        tasks.append({"title": title.get_text(" ", strip=True)[:160],
                      "status": status.get_text(" ", strip=True)[:40], "url": url})
    if not tasks and not re.search(r"暂无作业|暂无内容|没有作业|暂无相关|还没有作业|作业已完成|0/0", page):
        raise ChaoxingReadError("没有识别出作业或明确空态，原记录已保留")
    if len(tasks) > 100:
        raise ChaoxingReadError("本课程作业过多，本次未覆盖原记录")
    return tasks


def parse_deadline(page: str) -> tuple[str | None, str]:
    text = BeautifulSoup(page, "html.parser").get_text(" ", strip=True)
    # Never invent a year from a month/day-only deadline.
    full = re.search(r"(?:截止时间|结束时间|作答时间)[：:]?\s*(?:.*?至\s*)?(\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2})(?!\d)", text[:12000])
    if full:
        from datetime import datetime
        try:
            value = datetime.strptime(full[1].replace("/", "-"), "%Y-%m-%d %H:%M")
            return value.strftime("%Y-%m-%dT%H:%M:00+08:00"), full[1]
        except ValueError:
            pass
    partial = re.search(r"作答时间[：:]\s*(\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2})\s*至\s*(\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2})", text)
    return None, partial[2] if partial else ""


class Reader:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/118.0.0.0 Safari/537.36"
        self.deadline = time.monotonic() + 90

    def request(self, method: str, url: str, **kwargs):
        for _ in range(5):
            if time.monotonic() >= self.deadline:
                raise ChaoxingReadError("本次读取时间已到，请分课程同步剩余内容")
            url = safe_url(url)
            response = self.session.request(method, url, timeout=(5, 10), allow_redirects=False, stream=True, **kwargs)
            with response:
                if response.is_redirect:
                    url = urljoin(url, response.headers.get("Location", ""))
                    method, kwargs = "GET", {}
                    continue
                response.raise_for_status()
                chunks, size = [], 0
                for chunk in response.iter_content(65536):
                    size += len(chunk)
                    if size > 2_000_000 or time.monotonic() >= self.deadline:
                        raise ChaoxingReadError("页面过大或读取超时，原记录已保留")
                    chunks.append(chunk)
                response._content = b"".join(chunks)
                if not response.encoding or response.encoding.lower() == "iso-8859-1":
                    response.encoding = response.apparent_encoding or "utf-8"
                if "antispider" in url or "验证码" in response.text and "9010" in response.text:
                    raise ChaoxingReadError("学习通要求安全验证，请先在官方应用处理")
                return response
        raise ChaoxingReadError("学习通重定向次数过多，请稍后重试")

    def login(self, username: str, password: str):
        from Crypto.Cipher import AES
        from Crypto.Util.Padding import pad
        def encrypt(value):
            key = b"u2oh6Vu^HWe4_AES"
            return base64.b64encode(AES.new(key, AES.MODE_CBC, key).encrypt(pad(value.encode("utf-8"), 16))).decode()
        # 2026-11-14 修复：fid=-1（通用个人账号）对学校绑定账号（学号）无效；
        # 江海大超星 fid=12（mlogin 重定向实测确认）。学校绑定账号常为「手机号+独立密码」。
        # 先 fid=12（学校账号：学号或手机号），失败再回退 fid=-1（个人手机号账号）。
        for fid in ("12", "-1"):
            body = self.request("POST", "https://passport2.chaoxing.com/fanyalogin", data={
                "fid": fid, "uname": encrypt(username), "password": encrypt(password),
            "refer": "https%3A%2F%2Fi.chaoxing.com", "t": "true", "forbidotherlogin": "0",
            "validate": "", "doubleFactorLogin": "0", "independentId": "0",
        }).json()
            if body.get("status") is True:
                return
        raise ChaoxingReadError("学习通登录未通过，请核对账号或先在官方应用完成验证")

    def sync(self, course_key: str = "", course_keys: list[str] | None = None) -> dict:
        base = self.request("GET", "https://i.chaoxing.com/base").text
        fid = re.search(r'["\']?fid["\']?\s*[:=]\s*["\']?(\d+)', base)
        if not fid:
            raise ChaoxingReadError("未识别学习通学校身份，请在官方应用确认账号")
        courses = parse_courses(self.request("GET", "https://mooc2-ans.chaoxing.com/mooc2-ans/visit/courselistdata", params={
            "courseType": 1, "courseFid": fid[1], "courseTeacherid": 0, "courseOrderBy": 0,
        }).text)
        if course_keys:
            wanted = set(course_keys)
            selected = [c for c in courses if c["key"] in wanted]
        else:
            selected = [c for c in courses if c["key"] == course_key] if course_key else courses
        if course_key and not selected:
            raise ChaoxingReadError("该课程不在当前账号中，请重新读取课程列表")
        homework, covered, errors = [], [], []
        for course in selected[:30]:
            if time.monotonic() + 2 >= self.deadline:
                break
            try:
                cid, clazz, cpi = course["key"].split(":")
                page = self.request("GET", "https://mooc1.chaoxing.com/visit/stucoursemiddle", params={"courseid": cid, "clazzid": clazz, "cpi": cpi}).text
                soup = BeautifulSoup(page, "html.parser")
                link = soup.select_one('a[data*="/work/getAllWork"]')
                if not link or not link.get("data"):
                    raise ChaoxingReadError("课程未提供作业入口，保留已有作业")
                work_url = safe_url(urljoin("https://mooc1.chaoxing.com", html.unescape(link["data"])))
                work = self.request("GET", work_url).text
                items = parse_homework(work)
                # Details are optional. A missing deadline is explicitly unknown.
                for index, task in enumerate(items):
                    due, due_text = None, ""
                    if index < 10 and time.monotonic() + 2 < self.deadline and re.search(r"未交|未完成|待完成", task["status"]):
                        try:
                            due, due_text = parse_deadline(self.request("GET", task["url"]).text)
                        except (requests.RequestException, ChaoxingReadError):
                            pass
                    # Signed task URLs/cookies never leave this short-lived server session.
                    identity = urlsplit(task["url"])
                    from urllib.parse import parse_qs
                    params = parse_qs(identity.query)
                    task_id = next((params[k][0] for k in ("workId", "workid", "id") if k in params and re.fullmatch(r"\d+", params[k][0])), str(index + 1))
                    homework.append({"key": f"{course['key']}:{task_id}", "courseKey": course["key"],
                                     "title": task["title"], "status": task["status"], "dueAt": due, "deadlineText": due_text})
                covered.append(course["key"])
                time.sleep(.25)
            except (requests.RequestException, ChaoxingReadError):
                errors.append(course["key"])
        return {"courses": courses, "homework": homework, "coveredCourseKeys": covered,
                "failedCourseKeys": errors, "remainingCourseKeys": [c["key"] for c in selected if c["key"] not in covered],
                "queriedAt": int(time.time() * 1000)}


def query_chaoxing(username: str, password: str, course_key: str = "", course_keys: list[str] | None = None) -> dict:
    reader = Reader()
    try:
        reader.login(username, password)
        return reader.sync(course_key, course_keys)
    finally:
        reader.session.cookies.clear()
        reader.session.close()
