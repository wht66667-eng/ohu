# -*- coding: utf-8 -*-
"""
【模块】对外主函数 · 原 jou_client.py 第 638-676 行

  create_captcha() -> (sid, dataURL)      创建会话并取验证码
  query_schedule(sid, username, password, captcha) -> {"student_id", "rows"}
                                          一次性会话完成登录 + 抓课表，密码用后即清
"""
from __future__ import annotations

import logging
import os

from .errors import ParseFailedError
from .models import entries_to_rows
from .parser import parse_schedule_html
from .store import new_session, peek_session, pop_session

logger = logging.getLogger(__name__)


def create_captcha() -> tuple[str, str]:
    """创建登录会话并返回 (sid, 验证码 dataURL)"""
    sid = new_session()
    sess = peek_session(sid)
    return sid, sess.captcha_data_url()


def query_schedule(sid: str, username: str, password: str, captcha: str) -> dict:
    """用一次性会话完成登录 + 抓课表。返回 rows 结构，密码用后即清。"""
    sess = pop_session(sid)
    try:
        sess.login(username.strip(), password, captcha.strip())
        html = sess.fetch_schedule_html(username.strip())
        # 留存最近一次课表页快照（仅本地、不含密码），便于精确排查解析问题
        try:
            with open(os.path.join(os.path.dirname(__file__), "..", "_schedule_debug.html"),
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
        per_day = {}
        for e in entries:
            per_day[e.day] = per_day.get(e.day, 0) + 1
        logging.getLogger("jou").info(
            "课表解析成功: %d 门, 各天分布 %s, 示例: %s",
            len(entries), dict(sorted(per_day.items())),
            (entries[0].raw[:60] if entries else ""))
        return {"student_id": username.strip(), "rows": entries_to_rows(entries)}
    finally:
        sess.close()
