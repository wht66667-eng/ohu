# -*- coding: utf-8 -*-
"""
【模块】异常定义

原 jou_client.py 第 40-75 行。code 对应前端课表页的约定错误码：
  1001/1003 = 验证码错（前端自动刷新验证码）  1002 = 密码错  其他 = 直接展示 message
http 字段决定接口返回的状态码，路由层 `_err()` 直接取用。
"""
from __future__ import annotations


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
