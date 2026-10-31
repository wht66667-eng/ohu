# -*- coding: utf-8 -*-
"""
【模块】一次性会话仓库（验证码 → 查询 配对）· 原 jou_client.py 第 598-635 行

语义：验证码与登录必须共用同一份 Cookie，故用 sid 把 ZfsoftSession 留在进程内存里；
      TTL 300s；`pop_session` 取出即销毁（一次性），过期会话自动 close 并抛 CaptchaError。
"""
from __future__ import annotations

import threading
import time
import uuid

from .errors import CaptchaError
from .session import ZfsoftSession

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


def peek_session(sid: str) -> ZfsoftSession:
    """只读取出会话（不销毁），供 create_captcha 在同一把锁里取验证码用"""
    with _LOCK:
        return _SESSIONS[sid][0]
