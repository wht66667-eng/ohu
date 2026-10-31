# -*- coding: utf-8 -*-
"""
jou · 江苏海洋大学教务（正方 zfxk.jou.edu.cn）课表抓取包

拆解自 704 行单文件 `jou_client.py`，逻辑一行未改，只做「搬移 + 导出」。模块划分：

    config.py     BASE_URL / 超时 / 主页特征串
    errors.py     ScheduleError 及子类（code 对应前端约定错误码）
    rsa.py        正方前端 RSA（PKCS#1 v1.5，与页面 RSA.js 精确一致）
    textutil.py   文本清洗与节次换算
    weeks.py      周次文本 → 周数组
    models.py     CourseEntry 数据结构 + 展开为前端 rows
    parser.py     HTML 课表表格 → CourseEntry 列表（网格/rowspan/两种表头布局）
    session.py    ZfsoftSession：取验证码 → 登录 → 抓课表（一次性）
    store.py      一次性会话仓库（sid → session，TTL 300s）
    service.py    对外主函数 create_captcha / query_schedule
    mock.py       MOCK 模式样例课表

对外接口保持不变，`from jou import query_schedule` 与旧的 `from jou_client import query_schedule` 等价。
"""
from __future__ import annotations

from .config import BASE_URL, DEFAULT_TIMEOUT, MAIN_PAGE_HINT
from .errors import (
    ScheduleError,
    CaptchaError,
    WrongPasswordError,
    LoginFailedError,
    NetworkTimeoutError,
    ParseFailedError,
)
from .rsa import zf_rsa_encrypt
from .textutil import clean_text, section_of
from .weeks import expand_weeks
from .models import CourseEntry, entries_to_rows
from .parser import parse_schedule_html
from .session import ZfsoftSession
from .store import SESSION_TTL, new_session, pop_session
from .service import create_captcha, query_schedule
from .mock import MockSchedule

__all__ = [
    "BASE_URL", "DEFAULT_TIMEOUT", "MAIN_PAGE_HINT",
    "ScheduleError", "CaptchaError", "WrongPasswordError", "LoginFailedError",
    "NetworkTimeoutError", "ParseFailedError",
    "zf_rsa_encrypt", "clean_text", "section_of", "expand_weeks",
    "CourseEntry", "entries_to_rows", "parse_schedule_html",
    "ZfsoftSession", "SESSION_TTL", "new_session", "pop_session",
    "create_captcha", "query_schedule", "MockSchedule",
]
