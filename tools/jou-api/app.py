# -*- coding: utf-8 -*-
"""
江苏海洋大学课表抓取 · POST 接口服务

接口契约（与 H5 课表页一致，勿随意变更）：
  POST /api/timetable/captcha  → {ok, sid, image}      # image 为 dataURL
  POST /api/timetable/query    → {ok, rows:[{week,day,sections,name,teacher,room}]}
                                 或 {ok:false, code, message}
  GET  /api/health             → {ok, mock, sessions, ...}   # 运维巡检 / 冷启动预热

错误码（前端课表页依赖）：
  1000 参数缺失 / 1001 验证码错误或会话过期（前端自动换图）/ 1002 密码错误
  1004 限流或服务繁忙 / 1005 登录失败 / 1006 上游超时或服务异常 / 1007 课表解析失败

面向全校同学的防护分层：
  1) 并发闸门：限制同时打到教务系统的请求数（默认 4），避免把教务系统压垮导致服务器 IP 被封
  2) 分层限流：按学号（防单账号爆破）+ 按来源 IP（防批量刷取；阈值刻意放宽以兼容校园网 NAT 出口）
  3) 会话治理：验证码会话 3 分钟 TTL + 全局总量上限 + 每 IP 未消费会话上限
  4) 日志脱敏：学号掩码，密码与验证码原文永不入日志

运行（生产）：gunicorn -w 1 -k gthread --threads 16 --timeout 60 -b 0.0.0.0:8090 app:app
  ⚠️ 必须单 worker：验证码会话保存在进程内存中，「取验证码 → 提交查询」两次请求必须命中同一进程，
     多 worker 会表现为"验证码错误/会话过期"(1001)。横向扩容前请先把会话迁到共享存储。

测试模式：环境变量 MOCK=1 启动后不访问真实教务系统，直接返回样例数据。
"""
from __future__ import annotations

import base64
import logging
import os
import pathlib
import threading
import time
import uuid
from collections import deque

from flask import Flask, Response, jsonify, request, send_from_directory

from jou_client import (  # noqa: F401  （异常类型按契约在此重导出，便于排查）
    CaptchaError,
    LoginFailedError,
    NetworkTimeoutError,
    ParseFailedError,
    ScheduleError,
    WrongPasswordError,
    MockSchedule,
    SESSION_TTL,
    active_sessions,
    create_captcha,
    query_schedule,
    query_academic,
    auto_query_academic,
)
from captcha_ocr import ocr_status

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("jou-schedule-api")

app = Flask(__name__)
VERSION = "2.3.2-grades-all-terms"
MOCK = os.environ.get("MOCK", "").strip() == "1"


# ============================================================
# 可调参数（全部支持环境变量覆盖，便于线上不动代码调整）
# ============================================================

RATE_LIMIT_PER_MIN = int(os.environ.get("RATE_LIMIT_PER_MIN", "6"))        # 同学号查询
IP_CAPTCHA_PER_MIN = int(os.environ.get("IP_CAPTCHA_PER_MIN", "120"))      # 同 IP 取验证码
IP_QUERY_PER_MIN = int(os.environ.get("IP_QUERY_PER_MIN", "60"))           # 同 IP 提交查询
GLOBAL_QUERY_PER_MIN = int(os.environ.get("GLOBAL_QUERY_PER_MIN", "120"))  # 全站查询
MAX_SESSIONS_PER_IP = int(os.environ.get("MAX_SESSIONS_PER_IP", "40"))     # 同 IP 未消费会话
MAX_UPSTREAM_CONCURRENCY = int(os.environ.get("MAX_UPSTREAM_CONCURRENCY", "4"))
UPSTREAM_ACQUIRE_TIMEOUT = float(os.environ.get("UPSTREAM_ACQUIRE_TIMEOUT", "10"))


# ============================================================
# 通用工具：请求标识、来源 IP、日志脱敏
# ============================================================

def _rid() -> str:
    """短请求 id，用于把一次请求的多条日志串起来"""
    return uuid.uuid4().hex[:8]


def _client_ip() -> str:
    """取真实来源 IP：网关回源时会带 X-Forwarded-For，取第一段"""
    fwd = request.headers.get("X-Forwarded-For", "")
    if fwd:
        first = fwd.split(",")[0].strip()
        if first:
            return first[:64]
    return (request.headers.get("X-Real-IP") or request.remote_addr or "unknown")[:64]


def _mask_id(student_id: str) -> str:
    """学号脱敏：前 4 位 + *** + 后 2 位，日志中永不出现完整学号"""
    s = (student_id or "").strip()
    if len(s) <= 6:
        return "***" if s else "-"
    return f"{s[:4]}***{s[-2:]}"


def _mask_ip(ip: str) -> str:
    """IP 脱敏：IPv4 只保留前两段"""
    parts = (ip or "").split(".")
    if len(parts) == 4:
        return f"{parts[0]}.{parts[1]}.*.*"
    return ip or "-"


# ============================================================
# 滑动窗口限流（进程内、线程安全）
# ============================================================

class _SlidingWindow:
    """60s 滑动窗口计数器：hit() 返回 (是否超限, 建议等待秒数)"""

    def __init__(self, limit: int, window: float = 60.0) -> None:
        self.limit = int(limit)
        self.window = float(window)
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str) -> tuple[bool, int]:
        if self.limit <= 0:            # <=0 视为关闭该维度限流
            return False, 0
        now = time.time()
        with self._lock:
            q = self._hits.get(key)
            if q is None:
                q = self._hits[key] = deque()
            while q and now - q[0] >= self.window:
                q.popleft()
            if len(q) >= self.limit:
                retry = max(1, int(self.window - (now - q[0])) + 1)
                self._sweep(now)
                return True, retry
            q.append(now)
            self._sweep(now)
            return False, 0

    def _sweep(self, now: float) -> None:
        """长期运行防止 key 无限累积（仅在表较大时清理）"""
        if len(self._hits) <= 512:
            return
        dead = [k for k, q in self._hits.items() if not q or now - q[-1] >= self.window]
        for k in dead:
            self._hits.pop(k, None)


_win_username = _SlidingWindow(RATE_LIMIT_PER_MIN)
_win_ip_captcha = _SlidingWindow(IP_CAPTCHA_PER_MIN)
_win_ip_query = _SlidingWindow(IP_QUERY_PER_MIN)
_win_global_query = _SlidingWindow(GLOBAL_QUERY_PER_MIN)


# ============================================================
# 上游并发闸门：限制同时访问教务系统的请求数
# ============================================================

_UPSTREAM_SEM = threading.BoundedSemaphore(max(1, MAX_UPSTREAM_CONCURRENCY))
_inflight_lock = threading.Lock()
_inflight = 0


def _enter_upstream(rid: str, ip: str, what: str) -> bool:
    """占住一个上游并发槽位；超时未拿到返回 False（由调用方回 1004）"""
    global _inflight
    if _UPSTREAM_SEM.acquire(timeout=UPSTREAM_ACQUIRE_TIMEOUT):
        with _inflight_lock:
            _inflight += 1
        return True
    logger.warning("rid=%s %s 并发闸门已满(在途=%s) ip=%s", rid, what, _inflight, _mask_ip(ip))
    return False


def _leave_upstream() -> None:
    global _inflight
    with _inflight_lock:
        _inflight = max(0, _inflight - 1)
    _UPSTREAM_SEM.release()


# ============================================================
# 验证码会话归属（用于限制单 IP 未消费会话数，防止批量刷验证码）
# ============================================================

_sid_owner: dict[str, tuple[str, float]] = {}
_sid_lock = threading.Lock()


def _prune_owners(now: float) -> None:
    for k in [k for k, (_, t0) in _sid_owner.items() if now - t0 > SESSION_TTL]:
        _sid_owner.pop(k, None)


def _outstanding_sessions(ip: str, now: float) -> int:
    with _sid_lock:
        _prune_owners(now)
        return sum(1 for owner, _ in _sid_owner.values() if owner == ip)


def _track_session(sid: str, ip: str) -> None:
    with _sid_lock:
        _sid_owner[sid] = (ip, time.time())


def _release_session(sid: str) -> None:
    with _sid_lock:
        _sid_owner.pop(sid or "", None)


# ============================================================
# 跨域（CORS）
# ------------------------------------------------------------
# 线上请求经 CloudBase HTTP 网关转发，网关会按「Web 安全域名」白名单自行完成
# OPTIONS 预检（直接回 204）并回写 Access-Control-Allow-Origin（回显来源）。
# 应用层绝不能再写 CORS 头：实测两边都写会得到
# `access-control-allow-origin: <origin>,<origin>` 双值头，浏览器直接判定 CORS 失败。
# 新增站点域名时去「环境 → 安全配置 → Web 安全域名」里加，而不是改代码。
# ============================================================

@app.before_request
def _preflight():
    """非网关直连场景（本机调试）下的 OPTIONS 预检兜底，不进入业务逻辑"""
    if request.method == "OPTIONS":
        return ("", 204)


@app.after_request
def add_security_headers(resp: Response):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    return resp


# ============================================================
# 统一响应
# ============================================================

def _ok(body: dict):
    return jsonify({**body, "ok": True})


def _err(e: ScheduleError, rid: str = "-", tag: str = "-"):
    logger.warning("rid=%s 课表获取失败 id=%s reason=%s code=%s", rid, tag, e.reason, e.code)
    return jsonify({"ok": False, "code": e.code, "error": e.reason,
                    "message": str(e)}), e.http


def _err_simple(code: str, http: int, message: str, retry_after: int | None = None):
    resp = jsonify({"ok": False, "code": code, "message": message})
    if retry_after:
        resp.headers["Retry-After"] = str(int(retry_after))
    return resp, http


# ============================================================
# 测试用 mock 验证码（简单 SVG 数字图）
# ============================================================

def _mock_captcha_svg() -> str:
    code = "".join(str(time.time_ns() % 10) for _ in range(4))
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="44">'
           f'<rect width="120" height="44" fill="#eef4fb"/>'
           f'<text x="60" y="30" font-size="24" font-family="monospace" '
           f'fill="#345" text-anchor="middle" letter-spacing="6">{code}</text></svg>')
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()


# ============================================================
# 课表页对接接口
# ============================================================

@app.route("/api/timetable/captcha", methods=["GET", "POST"])
def timetable_captcha():
    """创建一次性登录会话，返回验证码图片（dataURL）与会话 id"""
    rid, ip = _rid(), _client_ip()

    limited, retry = _win_ip_captcha.hit(ip)
    if limited:
        logger.warning("rid=%s captcha 被 IP 限流 ip=%s", rid, _mask_ip(ip))
        return _err_simple("1004", 429, "请求过于频繁，请稍后再试", retry)

    if MOCK:
        return _ok({"sid": "mock-session", "image": _mock_captcha_svg()})

    outstanding = _outstanding_sessions(ip, time.time())
    if outstanding >= MAX_SESSIONS_PER_IP:
        logger.warning("rid=%s captcha 未消费会话过多(%d) ip=%s", rid, outstanding, _mask_ip(ip))
        return _err_simple("1004", 429, "请先使用已获取的验证码，或稍后再试", 60)

    if not _enter_upstream(rid, ip, "captcha"):
        return _err_simple("1004", 429, "当前查询人数较多，请稍后重试", 5)
    t0 = time.time()
    try:
        sid, image = create_captcha()
        _track_session(sid, ip)
        logger.info("rid=%s 验证码已下发 sid=%s ip=%s 耗时=%.2fs",
                    rid, sid[:8], _mask_ip(ip), time.time() - t0)
        return _ok({"sid": sid, "image": image})
    except ScheduleError as e:
        return _err(e, rid)
    except Exception:
        logger.exception("rid=%s 验证码接口未预期异常", rid)
        return _err_simple("1006", 500, "服务暂时不可用，请稍后重试")
    finally:
        _leave_upstream()


@app.route("/api/timetable/query", methods=["POST"])
def timetable_query():
    """学号 + 密码 + 验证码 登录教务系统并抓取课表（可选同时抓成绩/考试）"""
    rid, ip = _rid(), _client_ip()
    body = request.get_json(silent=True) or {}
    username = str(body.get("username", "")).strip()
    password = str(body.get("password", ""))
    captcha = str(body.get("captcha", "")).strip()
    sid = str(body.get("sid", "")).strip()
    tag = _mask_id(username)
    # fetch: ["schedule"] | ["grades","exams"] | ["schedule","grades","exams"]
    raw_fetch = body.get("fetch")
    if isinstance(raw_fetch, str):
        fetch = [x.strip() for x in raw_fetch.split(",") if x.strip()]
    elif isinstance(raw_fetch, list):
        fetch = [str(x).strip() for x in raw_fetch if str(x).strip()]
    else:
        fetch = ["schedule"]
    allowed = {"schedule", "grades", "exams"}
    fetch = [x for x in fetch if x in allowed] or ["schedule"]

    if not username or not password:
        return _err_simple("1000", 400, "请填写学号与密码")
    if not captcha:
        return _err_simple("1001", 400, "请填写验证码")

    # 限流顺序：全局 → IP → 学号（任一超限即拒绝，并告诉前端还要等多久）
    checks = (
        (_win_global_query, "global", "当前使用人数较多，请稍后重试"),
        (_win_ip_query, ip, "请求过于频繁，请稍后再试"),
    )
    for win, key, msg in checks:
        limited, retry = win.hit(key)
        if limited:
            logger.warning("rid=%s query 被限流(%s) id=%s ip=%s", rid, win.limit, tag, _mask_ip(ip))
            return _err_simple("1004", 429, msg, retry)

    limited, retry = _win_username.hit(username.lower())
    if limited:
        logger.warning("rid=%s query 被学号限流 id=%s ip=%s", rid, tag, _mask_ip(ip))
        return _err_simple("1004", 429, "该学号请求过于频繁，教务侧正在冷却，请稍后再试", retry)

    if MOCK:
        time.sleep(0.4)  # 模拟真实耗时
        _release_session(sid)
        data = {"student_id": username}
        if "schedule" in fetch:
            data["rows"] = MockSchedule.rows()
        if "grades" in fetch:
            data["grades"] = MockSchedule.grades()
        if "exams" in fetch:
            data["exams"] = MockSchedule.exams()
        return _ok(data)

    if not _enter_upstream(rid, ip, "query"):
        return _err_simple("1004", 429, "当前查询人数较多，请稍后重试", 5)
    t0 = time.time()
    try:
        data = query_academic(sid, username, password, captcha, fetch=fetch)
        logger.info(
            "rid=%s 学业查询成功 id=%s fetch=%s rows=%s grades=%s exams=%s 耗时=%.2fs",
            rid, tag, ",".join(fetch),
            len(data.get("rows") or []),
            len(data.get("grades") or []),
            len(data.get("exams") or []),
            time.time() - t0,
        )
        return _ok(data)
    except ScheduleError as e:
        logger.info("rid=%s 学业查询结束 id=%s code=%s 耗时=%.2fs", rid, tag, e.code, time.time() - t0)
        return _err(e, rid, tag)
    except Exception:
        logger.exception("rid=%s 学业查询未预期异常 id=%s", rid, tag)
        return _err_simple("1006", 500, "服务暂时不可用，请稍后重试")
    finally:
        # 会话无论成功失败都已消费（pop_session 取走即销毁）
        _release_session(sid)
        password = ""   # noqa: F841  显式清引用，避免明文密码驻留更久
        _leave_upstream()


@app.route("/api/timetable/auto", methods=["POST"])
def timetable_auto():
    """
    学号 + 密码自动同步（服务端 OCR 验证码）。
    成功返回与 /query 相同结构；OCR 未装或多次失败时返回 1010/1001，前端应回退手输。
    """
    rid, ip = _rid(), _client_ip()
    body = request.get_json(silent=True) or {}
    username = str(body.get("username", "")).strip()
    password = str(body.get("password", ""))
    tag = _mask_id(username)
    raw_fetch = body.get("fetch")
    if isinstance(raw_fetch, str):
        fetch = [x.strip() for x in raw_fetch.split(",") if x.strip()]
    elif isinstance(raw_fetch, list):
        fetch = [str(x).strip() for x in raw_fetch if str(x).strip()]
    else:
        fetch = ["schedule", "grades", "exams"]
    allowed = {"schedule", "grades", "exams"}
    fetch = [x for x in fetch if x in allowed] or ["schedule", "grades", "exams"]
    max_tries = int(body.get("max_tries") or 5)
    max_tries = max(1, min(8, max_tries))

    if not username or not password:
        return _err_simple("1000", 400, "请填写学号与密码")

    checks = (
        (_win_global_query, "global", "当前使用人数较多，请稍后重试"),
        (_win_ip_query, ip, "请求过于频繁，请稍后再试"),
    )
    for win, key, msg in checks:
        limited, retry = win.hit(key)
        if limited:
            return _err_simple("1004", 429, msg, retry)

    limited, retry = _win_username.hit(username.lower())
    if limited:
        return _err_simple("1004", 429, "该学号请求过于频繁，请稍后再试", retry)

    if MOCK:
        time.sleep(0.5)
        data = {"student_id": username, "auto": True, "ocr": False}
        if "schedule" in fetch:
            data["rows"] = MockSchedule.rows()
        if "grades" in fetch:
            data["grades"] = MockSchedule.grades()
        if "exams" in fetch:
            data["exams"] = MockSchedule.exams()
        return _ok(data)

    if not _enter_upstream(rid, ip, "auto"):
        return _err_simple("1004", 429, "当前查询人数较多，请稍后重试", 5)
    t0 = time.time()
    try:
        data = auto_query_academic(username, password, fetch=fetch, max_tries=max_tries)
        data["auto"] = True
        data["ocr"] = True
        logger.info(
            "rid=%s auto 成功 id=%s fetch=%s rows=%s grades=%s exams=%s 耗时=%.2fs",
            rid, tag, ",".join(fetch),
            len(data.get("rows") or []),
            len(data.get("grades") or []),
            len(data.get("exams") or []),
            time.time() - t0,
        )
        return _ok(data)
    except ScheduleError as e:
        logger.info("rid=%s auto 结束 id=%s code=%s 耗时=%.2fs", rid, tag, e.code, time.time() - t0)
        return _err(e, rid, tag)
    except Exception:
        logger.exception("rid=%s auto 未预期异常 id=%s", rid, tag)
        return _err_simple("1006", 500, "服务暂时不可用，请稍后重试")
    finally:
        password = ""  # noqa: F841
        _leave_upstream()


# ============================================================
# 旧版简易接口（保留兼容）
# ============================================================

@app.route("/api/schedule", methods=["POST"])
def api_schedule():
    body = request.get_json(silent=True) or {}
    student_id = str(body.get("student_id", "")).strip()
    password = str(body.get("password", ""))
    if not student_id or not password:
        return _err_simple("1000", 400, "请提供 student_id 和 password")
    if MOCK:
        return _ok({"student_id": student_id, "rows": MockSchedule.rows()})
    # 有 OCR 时走自动；否则提示用新接口
    from captcha_ocr import ocr_available
    if ocr_available():
        if not _enter_upstream(_rid(), _client_ip(), "schedule-legacy"):
            return _err_simple("1004", 429, "当前查询人数较多，请稍后重试", 5)
        try:
            data = auto_query_academic(student_id, password, fetch=["schedule"], max_tries=5)
            return _ok(data)
        except ScheduleError as e:
            return _err(e)
        finally:
            _leave_upstream()
    return _err_simple(
        "1010",
        501,
        "请使用 /api/timetable/auto（需 OCR）或 /api/timetable/captcha + /query",
    )


@app.route("/api/health", methods=["GET"])
def api_health():
    """运维巡检 / 冷启动预热：不消耗任何限流额度"""
    with _inflight_lock:
        inflight = _inflight
    return jsonify({
        "ok": True,
        "mock": MOCK,
        "version": VERSION,
        "sessions": 0 if MOCK else active_sessions(),
        "upstream_concurrency": MAX_UPSTREAM_CONCURRENCY,
        "upstream_inflight": inflight,
        "ocr": ocr_status(),
    })


# ============================================================
# 独立运行：托管自带查询页面（容器内无该目录时给友好提示）
# ============================================================

_STATIC = pathlib.Path(__file__).resolve().parent.parent / "web"


@app.route("/")
def index_page():
    if not (_STATIC / "index.html").is_file():
        return jsonify({"ok": True, "service": "jou-api", "version": VERSION,
                        "hint": "使用 /api/timetable/captcha 与 /api/timetable/query"})
    return send_from_directory(_STATIC, "index.html")


@app.route("/<path:filename>")
def static_files(filename: str):
    if not _STATIC.is_dir():
        return jsonify({"ok": False, "code": "1008", "message": "not found"}), 404
    return send_from_directory(_STATIC, filename)


# ============================================================
# 启动自检
# ============================================================

def _log_startup_config() -> None:
    logger.info(
        "jou-api 启动 version=%s mock=%s 上游并发=%d 同学号限流=%d/min 同IP查询=%d/min 全局查询=%d/min "
        "CORS=由网关按安全域名白名单处理(应用层不写)",
        VERSION, MOCK, MAX_UPSTREAM_CONCURRENCY, RATE_LIMIT_PER_MIN,
        IP_QUERY_PER_MIN, GLOBAL_QUERY_PER_MIN,
    )
    if not MOCK and not os.environ.get("PORT"):
        logger.warning("未检测到 PORT 环境变量，将使用默认端口 8090；云托管会自动注入 PORT")


_log_startup_config()


if __name__ == "__main__":
    # 本地调试入口（生产用 Dockerfile 里的 gunicorn 单 worker 多线程）
    # threaded=True 让本地行为更接近生产，便于验证多线程下的限流与会话逻辑
    port = int(os.environ.get("PORT", "8090"))
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
