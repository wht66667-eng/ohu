"""正方成绩/考试/菜单解析的离线行为测试。

全部使用合成 HTML（结构对齐正方 DataGrid 约定与 jou_client.MockSchedule 样例），
不含任何真实学号、姓名、成绩或会话凭据；绝不登录真实账号。
运行：python -m unittest -v test_academic_parse
"""
import unittest

from bs4 import BeautifulSoup

from academic_parse import (
    extract_asp_alert,
    find_menu_href,
    parse_exams_html,
    parse_grades_html,
)

# 合成成绩表：表头用正方常见列名，数据为通用课程名/占位教师，非真实个人信息。
GRADES_HTML = """
<table id="Datagrid1">
<tr><td>学年</td><td>学期</td><td>课程代码</td><td>课程名称</td><td>课程性质</td><td>学分</td><td>成绩</td><td>绩点</td></tr>
<tr><td>2025-2026</td><td>1</td><td>B00001</td><td>大学英语(三)</td><td>必修</td><td>4.0</td><td>86</td><td>3.6</td></tr>
<tr><td>2025-2026</td><td>2</td><td>B00003</td><td>海洋概论</td><td>必修</td><td>2.0</td><td>92</td><td>4.0</td></tr>
</table>
"""

EXAMS_HTML = """
<table id="DataGrid1">
<tr><th>学年</th><th>学期</th><th>课程代码</th><th>课程名称</th><th>考试时间</th><th>考场</th><th>考试形式</th><th>座位</th><th>校区</th></tr>
<tr><td>2026-2027</td><td>1</td><td>C1001</td><td>流体力学</td><td>2027-01-08 09:00-11:00</td><td>C文思409</td><td>闭卷</td><td>12</td><td>苍梧校区</td></tr>
</table>
"""


class AcademicParse(unittest.TestCase):
    def test_grades_maps_columns_by_header(self):
        rows = parse_grades_html(GRADES_HTML)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["name"], "大学英语(三)")
        self.assertEqual(rows[0]["score"], "86")
        self.assertEqual(rows[0]["credit"], "4.0")
        self.assertEqual(rows[0]["gpa"], "3.6")
        self.assertEqual(rows[0]["year"], "2025-2026")
        self.assertEqual(rows[1]["name"], "海洋概论")
        self.assertEqual(rows[1]["term"], "2")

    def test_grades_empty_or_unrelated_page_returns_empty(self):
        self.assertEqual(parse_grades_html("<h1>请登录</h1>"), [])
        self.assertEqual(parse_grades_html(""), [])
        self.assertEqual(parse_grades_html("<table><tr><td>通知</td></tr></table>"), [])

    def test_exams_maps_columns_by_header(self):
        rows = parse_exams_html(EXAMS_HTML)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["name"], "流体力学")
        self.assertEqual(rows[0]["datetime"], "2027-01-08 09:00-11:00")
        self.assertEqual(rows[0]["room"], "C文思409")
        self.assertEqual(rows[0]["seat"], "12")
        self.assertEqual(rows[0]["campus"], "苍梧校区")

    def test_exams_ignores_nested_layout_rows(self):
        # 正方 DataGrid 常在末行用 colspan 套一张说明小表；递归取 tr/td 会把
        # 说明行误当成考试记录。应与 parse_grades_html 一样只取直接子行/列。
        nested = EXAMS_HTML.replace(
            "</table>",
            '<tr><td colspan="9"><table><tr><td>说明</td><td>请携带</td><td>学生证</td></tr></table></td></tr></table>',
        )
        rows = parse_exams_html(nested)
        self.assertEqual(len(rows), 1, [r["name"] for r in rows])
        self.assertEqual(rows[0]["name"], "流体力学")

    def test_exams_empty_page_returns_empty(self):
        self.assertEqual(parse_exams_html("<h1>请登录</h1>"), [])
        self.assertEqual(parse_exams_html(""), [])

    def test_menu_exact_beats_partial_and_excludes_lookalikes(self):
        soup = BeautifulSoup(
            '<a href="/xsdjkscx.aspx">等级考试查询</a>'
            '<a href="/xscjcx.aspx">成绩查询</a>'
            '<a href="/xscjcx_all.aspx">历年成绩</a>'
            '<a href="/teacher.aspx">教师成绩录入</a>',
            "html.parser",
        )
        href = find_menu_href(soup, ["历年成绩", "成绩查询", "成绩"], "fallback")
        self.assertTrue(href.endswith("/xscjcx_all.aspx"), href)

    def test_menu_falls_back_when_only_lookalikes_exist(self):
        soup = BeautifulSoup(
            '<a href="/xsdjkscx.aspx">等级考试查询</a><a href="/t.aspx">教师成绩录入</a>',
            "html.parser",
        )
        self.assertEqual(find_menu_href(soup, ["成绩"], "fallback"), "fallback")

    def test_asp_alert_extraction(self):
        self.assertEqual(extract_asp_alert("<script>alert('登录已过期，请重新登录');</script>"), "登录已过期，请重新登录")
        self.assertEqual(extract_asp_alert('<script>alert("验证码不正确");</script>'), "验证码不正确")
        self.assertEqual(extract_asp_alert("<html>正常页面</html>"), "")
        self.assertEqual(extract_asp_alert(""), "")


if __name__ == "__main__":
    unittest.main()