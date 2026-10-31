# -*- coding: utf-8 -*-
"""
江苏海洋大学课表抓取 · POST 接口服务

面向 campus-life-h5 课表页的接口契约：
  POST /api/timetable/captcha  → {ok, sid, image}          # image 为 dataURL
  POST /api/timetable/query    → {ok, rows:[{week,day,sections,name,teacher,room}]}
                                或 {ok:false, code, message}
                                code: 1001 验证码错(前端自动刷新) / 1002 密码错 / 其他 展示 message

同时保留上一版简易接口：
  POST /api/schedule {student_id, password}   （真实教务系统现在强制验证码，
                                               建议前端改用 /api/timetable/* 两个接口）

测试模式：环境变量 MOCK=1 启动后不访问真实教务系统，直接返回样例数据。

启动：
  python app.py            # 默认 0.0.0.0:5001
  MOCK=1 python app.py     # mock 模式
"""
from __future__ import annotations

import os
import base64
import time
import logging

from flask import Flask, request, jsonify, Response, send_from_directory

from jou_client import (
    ScheduleError, CaptchaError, WrongPasswordError, LoginFailedError,
    NetworkTimeoutError, ParseFailedError,
    create_captcha, query_schedule, MockSchedule,   # noqa: F401
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("jou-schedule-api")

app = Flask(__name__)
MOCK = os.environ.get("MOCK", "").strip() == "1"

# 同一账号每分钟请求上限，防止接口被当密码爆破跳板滥用
_RATE: dict[str, list[float]] = {}
RATE_LIMIT_PER_MIN = 6


def _rate_limited(key: str) -> bool:
    now = time.time()
    hits = [t for t in _RATE.get(key, []) if now - t < 60]
    if len(hits) >= RATE_LIMIT_PER_MIN:
        _RATE[key] = hits
        return True
    hits.append(now)
    _RATE[key] = hits
    return False


# ---------------- CORS（允许 H5 页面跨域调用） ----------------

@app.after_request
def add_cors(resp: Response):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


def _ok(body: dict):
    return jsonify({**body, "ok": True})


def _err(e: ScheduleError):
    logger.warning("课表获取失败 reason=%s code=%s", e.reason, e.code)
    return jsonify({"ok": False, "code": e.code, "error": e.reason,
                    "message": str(e)}), e.http


def _err_simple(code: str, http: int, message: str):
    return jsonify({"ok": False, "code": code, "message": message}), http


# ---------------- 测试用 mock 验证码（简单 SVG 数字图） ----------------

def _mock_captcha_svg() -> str:
    code = "".join(str(time.time_ns() % 10) for _ in range(4))
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="44">'
           f'<rect width="120" height="44" fill="#eef4fb"/>'
           f'<text x="60" y="30" font-size="24" font-family="monospace" '
           f'fill="#345" text-anchor="middle" letter-spacing="6">{code}</text></svg>')
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()


# ---------------- 课表页对接接口 ----------------

@app.route("/api/timetable/captcha", methods=["GET", "POST", "OPTIONS"])
def timetable_captcha():
    """创建一次性登录会话，返回验证码图片（dataURL）与会话 id"""
    if MOCK:
        return _ok({"sid": "mock-session", "image": _mock_captcha_svg()})
    try:
        sid, image = create_captcha()
        return _ok({"sid": sid, "image": image})
    except ScheduleError as e:
        return _err(e)
    except Exception as e:
        logger.exception("验证码接口未预期异常")
        return _err_simple("1006", 500, f"服务内部错误：{e}")


@app.route("/api/timetable/query", methods=["POST", "OPTIONS"])
def timetable_query():
    """学号 + 密码 + 验证码 登录教务系统并抓取课表"""
    body = request.get_json(silent=True) or {}
    username = str(body.get("username", "")).strip()
    password = str(body.get("password", ""))
    captcha = str(body.get("captcha", "")).strip()
    sid = str(body.get("sid", "")).strip()

    if not username or not password:
        return _err_simple("1000", 400, "请填写学号与密码")
    if not captcha:
        return _err_simple("1001", 400, "请填写验证码")
    if _rate_limited(username):
        return _err_simple("1004", 429, "请求过于频繁，教务侧正在冷却，请稍后再试")

    if MOCK:
        time.sleep(0.4)  # 模拟真实耗时
        return _ok({"student_id": username, "rows": MockSchedule.rows()})

    try:
        data = query_schedule(sid, username, password, captcha)
        return _ok(data)
    except ScheduleError as e:
        return _err(e)
    except Exception as e:
        logger.exception("课表查询未预期异常")
        return _err_simple("1006", 500, f"服务内部错误：{e}")


# ---------------- 旧版简易接口（保留兼容） ----------------

@app.route("/api/schedule", methods=["POST", "OPTIONS"])
def api_schedule():
    body = request.get_json(silent=True) or {}
    student_id = str(body.get("student_id", "")).strip()
    password = str(body.get("password", ""))
    if not student_id or not password:
        return _err_simple("1000", 400, "请提供 student_id 和 password")
    if MOCK:
        return _ok({"student_id": student_id, "rows": MockSchedule.rows()})
    # 真实教务系统强制验证码，一步式接口无法完成登录
    return _err_simple("1001", 400,
                       "真实教务系统需要验证码，请改用 /api/timetable/captcha + /api/timetable/query")


@app.route("/api/health", methods=["GET"])
def api_health():
    return jsonify({"ok": True, "mock": MOCK})


# ---------------- 独立运行：托管自带查询页面 ----------------

import pathlib

_STATIC = pathlib.Path(__file__).resolve().parent.parent / "web"


@app.route("/")
def index_page():
    return send_from_directory(_STATIC, "index.html")


@app.route("/<path:filename>")
def static_files(filename: str):
    return send_from_directory(_STATIC, filename)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8090"))
    app.run(host="0.0.0.0", port=port, debug=False)
