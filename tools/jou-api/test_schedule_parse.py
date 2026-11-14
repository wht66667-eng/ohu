"""正方课表解析与响应解码的离线行为测试。

合成 HTML 对齐江海大真实格子格式「课程名 / 周X第a,b节{第m-n周} / 教师 / 教室」，
课程名/教师均为通用占位（取自 jou_client.MockSchedule 风格），不含真实学号、姓名或凭据。
绝不登录真实账号。运行：python -m unittest -v test_schedule_parse
"""
import unittest

import requests

import jou_client
from jou_client import _expand_weeks, entries_to_rows, parse_schedule_html

SCHEDULE_HTML = (
    '<table id="Table1">'
    '<tr><td>节次</td><td>星期一</td><td>星期二</td><td>星期三</td><td>星期四</td><td>星期五</td></tr>'
    '<tr><td>第1节</td><td>海洋概论<br>周一第1,2节{第2-11周}<br>张老师<br>C文思302</td>'
    '<td></td><td></td><td></td><td></td></tr>'
    '</table>'
)


def _gbk_response_without_charset(html: str) -> requests.Response:
    """模拟部分 ASP.NET 服务：正文 GBK，但 HTTP 头不声明 charset。"""
    resp = requests.Response()
    resp._content = html.encode("gbk")
    resp.status_code = 200
    resp.headers["Content-Type"] = "text/html"
    resp.encoding = requests.utils.get_encoding_from_headers(resp.headers)
    return resp


class ScheduleParse(unittest.TestCase):
    def test_parses_jhd_time_line_format(self):
        entries = parse_schedule_html(SCHEDULE_HTML)
        self.assertEqual(len(entries), 1)
        e = entries[0]
        self.assertEqual(e.name, "海洋概论")
        self.assertEqual(e.day, 1)
        self.assertEqual((e.start_section, e.end_section), (1, 2))
        self.assertEqual(e.teacher, "张老师")
        self.assertEqual(e.room, "C文思302")
        self.assertEqual(e.weeks, list(range(2, 12)))

    def test_entries_to_rows_expands_each_week(self):
        rows = entries_to_rows(parse_schedule_html(SCHEDULE_HTML))
        self.assertEqual(len(rows), 10)
        self.assertEqual(rows[0], {"week": 2, "day": 1, "sections": [1, 2],
                                   "name": "海洋概论", "teacher": "张老师", "room": "C文思302"})
        self.assertEqual(rows[-1]["week"], 11)

    def test_expand_weeks_parity(self):
        self.assertEqual(_expand_weeks("1-16周(单)"), [1, 3, 5, 7, 9, 11, 13, 15])
        self.assertEqual(_expand_weeks("2-4周,6-16周(双)"), [2, 4, 6, 8, 10, 12, 14, 16])
        self.assertEqual(_expand_weeks("9-9周"), [9])

    def test_html_text_repairs_gbk_without_http_charset(self):
        resp = _gbk_response_without_charset(SCHEDULE_HTML)
        self.assertEqual(resp.encoding.lower(), "iso-8859-1")
        # 修复前：requests 按 ISO-8859-1 解码 GBK 正文，中文丢失。
        self.assertNotIn("星期一", resp.text)
        text = jou_client._html_text(resp)
        self.assertIn("星期一", text)
        self.assertIn("海洋概论", text)

    def test_html_text_keeps_declared_charset(self):
        resp = requests.Response()
        resp._content = "星期一".encode("utf-8")
        resp.status_code = 200
        resp.headers["Content-Type"] = "text/html; charset=utf-8"
        resp.encoding = requests.utils.get_encoding_from_headers(resp.headers)
        self.assertEqual(jou_client._html_text(resp), "星期一")
        self.assertEqual(resp.encoding.lower(), "utf-8")

    def test_gbk_schedule_decodes_before_parse(self):
        resp = _gbk_response_without_charset(SCHEDULE_HTML)
        # 端到端：未声明 charset 的 GBK 课表页经解码后仍能解析，而不是乱码导致表头未识别。
        entries = parse_schedule_html(jou_client._html_text(resp))
        self.assertEqual(entries[0].name, "海洋概论")
        self.assertEqual(entries[0].day, 1)


if __name__ == "__main__":
    unittest.main()