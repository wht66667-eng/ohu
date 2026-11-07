"""Read a user's JOU fitness pages through the school's own HTML forms.

Origin/page paths were identified in the public jianghaidai v0.8.1 APK. No
jianghaidai code or private API is used. Enable only after network/form validation.
"""
from __future__ import annotations
import base64
import os
import re
import secrets
import threading
import time
from urllib.parse import urljoin, urlsplit
import requests
from bs4 import BeautifulSoup

ORIGIN = "http://tice.jou.edu.cn:8080"
LOCK = threading.Lock()
SESSIONS = {}

class PhysicalReadError(Exception):
    pass

def configured():
    return os.environ.get("PHYSICAL_READ_ENABLED") == "1" and os.environ.get("PHYSICAL_ALLOW_HTTP") == "1"

def request(session, method, url, **kwargs):
    for _ in range(4):
        p = urlsplit(url)
        if p.scheme != "http" or p.netloc != "tice.jou.edu.cn:8080" or p.username or p.password:
            raise PhysicalReadError("体测页面跳转到未支持的地址，已停止读取")
        with session.request(method, url, timeout=(4, 8), allow_redirects=False, stream=True, **kwargs) as r:
            if r.is_redirect:
                url, method, kwargs = urljoin(url, r.headers.get("Location", "")), "GET", {}
                continue
            r.raise_for_status()
            chunks, size = [], 0
            for chunk in r.iter_content(65536):
                size += len(chunk)
                if size > 2_000_000: raise PhysicalReadError("体测页面过大，未写入成绩")
                chunks.append(chunk)
            r._content = b"".join(chunks)
            if not r.encoding or r.encoding.lower() == "iso-8859-1":
                r.encoding = r.apparent_encoding or "utf-8"
            return r
    raise PhysicalReadError("体测系统重定向异常")

def prepare():
    session = requests.Session()
    # School traffic must not inherit an unrelated overseas environment proxy.
    # This does not modify system routing/TUN or bypass a school's access control.
    session.trust_env = False
    try:
        r = request(session, "GET", ORIGIN + "/student/studentFrame.jsp")
        soup = BeautifulSoup(r.text, "html.parser")
        form = next((f for f in soup.select("form") if f.select_one('input[type="password"]')), None)
        if not form or form.get("method", "get").lower() != "post":
            raise PhysicalReadError("未识别到受支持的体测登录表单，需校内网络或适配更新")
        password = form.select_one('input[type="password"][name]')
        fields = form.select('input[name]')
        user = next((i for i in fields if re.search(r"user|student|account|loginname|xh|学号", i["name"], re.I) and i.get("type", "text").lower() in ("text", "tel", "number")), None)
        code = next((i for i in fields if re.search(r"captcha|verify|checkcode|yzm", i["name"], re.I) and i.get("type", "text").lower() == "text"), None)
        if not user or not password:
            raise PhysicalReadError("体测登录字段尚不支持，未尝试提交账号")
        image = None
        if code:
            img = next((i for i in soup.select('img[src]') if re.search(r"captcha|verify|checkcode|yzm", i["src"], re.I)), None)
            if not img:
                raise PhysicalReadError("体测验证码暂时无法识别，请使用官方查询")
            response = request(session, "GET", urljoin(r.url, img["src"]))
            kind = response.headers.get("Content-Type", "").split(";")[0]
            if kind not in ("image/png", "image/jpeg", "image/gif") or len(response.content) > 200000:
                raise PhysicalReadError("体测验证码格式暂不支持")
            image = f"data:{kind};base64," + base64.b64encode(response.content).decode()
        action = urljoin(r.url, form.get("action") or r.url)
        if urlsplit(action).netloc != "tice.jou.edu.cn:8080":
            raise PhysicalReadError("体测登录地址不受支持")
        data = {i["name"]: i.get("value", "") for i in fields if i.get("type", "text").lower() == "hidden"}
        for select in form.select('select[name]'):
            option = next((o for o in select.select('option') if '学生' in o.get_text()), None)
            option = option if option is not None else select.select_one('option[selected]')
            if option is not None: data[select['name']] = option.get('value', option.get_text(strip=True))
        submit = form.select_one('input[type="submit"][name]')
        if submit: data[submit["name"]] = submit.get("value", "")
        with LOCK:
            now = time.monotonic()
            for key, value in list(SESSIONS.items()):
                if now - value[0] > 180:
                    SESSIONS.pop(key)[1].close()
            if len(SESSIONS) >= 128:
                raise PhysicalReadError("体测查询人数较多，请稍后再试")
            token = secrets.token_urlsafe(32)
            SESSIONS[token] = (now, session, action, data, user["name"], password["name"], code["name"] if code else None)
        def expire():
            with LOCK: old = SESSIONS.pop(token, None)
            if old: old[1].close()
        timer = threading.Timer(180, expire)
        timer.daemon = True
        timer.start()
        return {"sid": token, "image": image, "httpUpstream": True}
    except Exception:
        session.close()
        raise

def parse_scores(page):
    soup = BeautifulSoup(page, "html.parser")
    body = soup.get_text(" ", strip=True)
    if not re.search(r"体质|体测|健康测试|体能", body):
        raise PhysicalReadError("返回页面不是体测成绩页，未写入数据")
    records = []
    for table in soup.select("table"):
        lines = [[c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"], recursive=False)] for tr in table.select("tr")]
        for index, cells in enumerate(lines):
            year_col = next((i for i, c in enumerate(cells) if re.fullmatch(r"测试年度|测试年份|年度|年份|学年", c)), None)
            total_col = next((i for i, c in enumerate(cells) if re.fullmatch(r"总分|总成绩|综合得分|综合成绩|测试总分", c)), None)
            date_col = next((i for i, c in enumerate(cells) if c in ("测试日期", "体测日期")), None)
            if year_col is None or total_col is None: continue
            for row in lines[index + 1:]:
                if len(row) <= max(year_col, total_col): continue
                year = row[year_col].replace("学年", "").replace("年度", "").replace("年", "").strip()
                score = row[total_col]
                if not re.fullmatch(r"\d{4}(?:-\d{4})?", year) or not re.fullmatch(r"\d{1,3}(?:\.\d+)?", score): continue
                date = row[date_col].replace("/", "-") if date_col is not None and date_col < len(row) else ""
                if date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date): date = ""
                events = [{"name": name[:24], "result": row[i][:48]} for i, name in enumerate(cells)
                          if i < len(row) and re.search(r"肺活量|50米|800米|1000米|立定跳远|引体向上|仰卧起坐|体前屈|BMI|体重指数", name) and row[i]][:12]
                if 0 <= float(score) <= 120:
                    records.append({"academicYear": year, "testedAt": date, "totalScore": float(score), "events": events})
            break
    if not records:
        if re.search(r"暂无.*成绩|没有.*成绩|未查询到.*成绩", body): return []
        raise PhysicalReadError("体测成绩表结构尚未适配，原记录已保留")
    return list({(r["academicYear"], r["testedAt"]): r for r in records}.values())

def query(sid, username, password, captcha):
    with LOCK:
        state = SESSIONS.pop(sid, None)
    if not state: raise PhysicalReadError("体测验证码会话已失效，请重新准备")
    created, session, action, data, user_field, password_field, code_field = state
    try:
        if time.monotonic() - created > 180: raise PhysicalReadError("体测验证码已过期")
        data[user_field], data[password_field] = username, password
        if code_field:
            if not captcha: raise PhysicalReadError("请输入体测系统验证码")
            data[code_field] = captcha
        login = request(session, "POST", action, data=data)
        if BeautifulSoup(login.text, "html.parser").select_one('input[type="password"]'):
            raise PhysicalReadError("体测登录未通过，请核对体测账号密码和验证码")
        pages = [request(session, "GET", ORIGIN + path).text for path in ("/student/queryHealthInfo.jsp", "/student/Historyhealth.jsp")]
        records = []
        for page in pages:
            records.extend(parse_scores(page))
        return {"records": list({(r["academicYear"], r["testedAt"]): r for r in records}.values()), "source": "jou-tice"}
    finally:
        data.clear()
        session.cookies.clear()
        session.close()
