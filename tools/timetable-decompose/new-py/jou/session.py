# -*- coding: utf-8 -*-
"""
【模块】教务系统会话（一次性，用后即焚）· 原 jou_client.py 第 436-595 行

类内方法即抓取流程的四个步骤：
  open_login_page()      ① 拿 __VIEWSTATE / __VIEWSTATEGENERATOR / RSA 公钥 / 验证码地址
  captcha_data_url()     ② 取验证码图（dataURL，与会话 Cookie 绑定）
  login()                ③ RSA 加密密码后提交登录（密码用后即清）
  fetch_schedule_html()  ④ 解析菜单 → 抓课表页 HTML
"""
from __future__ import annotations

import base64
import re
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from .config import BASE_URL, DEFAULT_TIMEOUT, MAIN_PAGE_HINT
from .errors import CaptchaError, LoginFailedError, NetworkTimeoutError, WrongPasswordError
from .rsa import zf_rsa_encrypt
from .textutil import clean_text


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
                text = clean_text(a.get_text())
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
