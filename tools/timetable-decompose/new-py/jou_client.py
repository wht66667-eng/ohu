# -*- coding: utf-8 -*-
"""
兼容垫片：旧代码 `from jou_client import ...` 依然可用。

真正实现已拆到 `jou/` 包下（见 jou/__init__.py 的模块划分）。保留此文件是为了让
尚无时机改造的调用方（含旧 app.py、外部脚本）零改动迁移。
"""
from __future__ import annotations

from jou import (  # noqa: F401
    BASE_URL, DEFAULT_TIMEOUT, MAIN_PAGE_HINT,
    ScheduleError, CaptchaError, WrongPasswordError, LoginFailedError,
    NetworkTimeoutError, ParseFailedError,
    zf_rsa_encrypt, clean_text, section_of, expand_weeks,
    CourseEntry, entries_to_rows, parse_schedule_html,
    ZfsoftSession, SESSION_TTL, new_session, pop_session,
    create_captcha, query_schedule, MockSchedule,
)

__all__ = [
    "BASE_URL", "DEFAULT_TIMEOUT", "MAIN_PAGE_HINT",
    "ScheduleError", "CaptchaError", "WrongPasswordError", "LoginFailedError",
    "NetworkTimeoutError", "ParseFailedError",
    "zf_rsa_encrypt", "clean_text", "section_of", "expand_weeks",
    "CourseEntry", "entries_to_rows", "parse_schedule_html",
    "ZfsoftSession", "SESSION_TTL", "new_session", "pop_session",
    "create_captcha", "query_schedule", "MockSchedule",
]
