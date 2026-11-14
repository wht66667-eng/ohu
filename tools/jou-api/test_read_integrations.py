"""Offline contract tests. Synthetic pages only; never log in to a real account."""
import os
import unittest
from unittest.mock import patch
from chaoxing_read import safe_url, parse_courses, parse_homework, parse_deadline, ChaoxingReadError, query_chaoxing
from physical_read import parse_scores, PhysicalReadError


class ReadIntegrations(unittest.TestCase):
    def test_no_external_redirect_or_plaintext_chaoxing(self):
        # safe_url 把 http:// 升级为 https://（仍限定 *.chaoxing.com），实际请求绝不走明文；
        # 外部主机、内嵌凭据、非 443 端口与非学习通域名一律拒绝。
        self.assertEqual(safe_url("http://mooc1.chaoxing.com/"), "https://mooc1.chaoxing.com/")
        for url in ("https://chaoxing.com.evil.invalid/", "https://127.0.0.1/", "https://a:b@mooc1.chaoxing.com/", "https://mooc1.chaoxing.com:8443/", "http://evil.invalid/"):
            with self.subTest(url=url), self.assertRaises(ChaoxingReadError): safe_url(url)
        self.assertEqual(safe_url("https://mooc1.chaoxing.com/task"), "https://mooc1.chaoxing.com/task")

    def test_unknown_courses_are_not_successful_empty(self):
        with self.assertRaises(ChaoxingReadError): parse_courses("<h1>请登录</h1>")
        self.assertEqual(parse_courses("暂无课程"), [])
        data = parse_courses('<a href="/visit/stucoursemiddle?courseid=1&clazzid=2&cpi=3"></a><span class="course-name" title="示例课程"></span><p class="line2 color3" title="示例教师"></p>')
        self.assertEqual(data[0]["key"], "1:2:3")
        self.assertEqual(data[0]["name"], "示例课程")

    def test_course_name_window_does_not_steal_next_course(self):
        # 第一门课卡片缺名称时，固定 2500 窗口会越过下一链接窃取下一门课名（静默误标）。
        # 应按下一课程链接界定范围：缺名称则显式报错保留原记录，而不是误标成功。
        page = ('<a href="/visit/stucoursemiddle?courseid=1&clazzid=2&cpi=3"></a>'
                '<a href="/visit/stucoursemiddle?courseid=4&clazzid=5&cpi=6"></a>'
                '<span class="course-name" title="课程乙"></span>')
        with self.assertRaises(ChaoxingReadError):
            parse_courses(page)

    def test_long_course_card_and_duplicate_links_still_parse(self):
        # 卡片正文超过 2500 字时固定窗口会漏读名称；重复链接不应截断本卡片范围。
        page = ('<a href="/visit/stucoursemiddle?courseid=1&clazzid=2&cpi=3"></a>'
                + "x" * 3000
                + '<span class="course-name" title="课程甲"></span>'
                + '<a href="/visit/stucoursemiddle?courseid=1&clazzid=2&cpi=3"></a>'
                + '<a href="/visit/stucoursemiddle?courseid=4&clazzid=5&cpi=6"></a>'
                + '<span class="course-name" title="课程乙"></span>')
        courses = parse_courses(page)
        self.assertEqual([(c["key"], c["name"]) for c in courses], [("1:2:3", "课程甲"), ("4:5:6", "课程乙")])

    def test_homework_urls_are_checked_and_ambiguous_deadlines_stay_unknown(self):
        page = '<li onclick="goTask(this);" data="https://mooc1.chaoxing.com/task?workId=4"><p class="overHidden2 fl">示例作业</p><p class="status fl">未交</p></li>'
        self.assertEqual(parse_homework(page)[0]["title"], "示例作业")
        with self.assertRaises(ChaoxingReadError): parse_homework(page.replace('mooc1.chaoxing.com', 'evil.invalid'))
        with self.assertRaises(ChaoxingReadError): parse_homework('<p>系统正在维护</p>')
        self.assertEqual(parse_deadline('作答时间: 06-21 18:51 至 07-01 18:51'), (None, '07-01 18:51'))
        self.assertEqual(parse_deadline('截止时间：2026-12-11 18:00')[0], '2026-12-11T18:00:00+08:00')

    def test_session_is_destroyed_even_on_failed_login(self):
        with patch('chaoxing_read.Reader') as reader:
            instance = reader.return_value
            instance.login.side_effect = ChaoxingReadError('test failure')
            with self.assertRaises(ChaoxingReadError): query_chaoxing('synthetic', 'synthetic')
            instance.session.cookies.clear.assert_called_once()
            instance.session.close.assert_called_once()

    def test_fitness_keeps_year_without_inventing_test_date(self):
        rows = parse_scores('<h1>体质测试成绩</h1><table><tr><th>测试年度</th><th>总分</th><th>肺活量</th></tr><tr><td>2026</td><td>105</td><td>4000</td></tr></table>')
        self.assertEqual(rows[0]['testedAt'], '')
        self.assertEqual(rows[0]['totalScore'], 105)
        self.assertEqual(rows[0]['academicYear'], '2026')
        self.assertEqual(rows[0]['events'][0]['name'], '肺活量')

    def test_unknown_fitness_layout_is_not_empty_success(self):
        for page in ('<h1>请登录</h1>', '<h1>体质测试系统维护中</h1>'):
            with self.assertRaises(PhysicalReadError): parse_scores(page)
        self.assertEqual(parse_scores('体质测试 暂无成绩'), [])

    def test_server_features_are_disabled_by_default(self):
        import app
        with patch.dict(os.environ, {'CHAOXING_READ_ENABLED': ''}):
            client = app.app.test_client()
            caps = client.get('/api/integrations/capabilities').get_json()
            self.assertFalse(caps['physical']['enabled'])
            self.assertEqual(caps['physical']['note'], 'device-sync-only')
            self.assertFalse(caps['chaoxing']['enabled'])
            # 体测改为设备侧同步，服务端查询/验证码路由已移除（404），不再接受学校凭据。
            self.assertEqual(client.post('/api/physical/query', json={}).status_code, 404)
            self.assertEqual(client.post('/api/physical/captcha', json={}).status_code, 404)
            self.assertEqual(client.post('/api/learning/chaoxing/query', json={}).status_code, 503)


if __name__ == '__main__': unittest.main()
