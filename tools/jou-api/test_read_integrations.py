"""Offline contract tests. Synthetic pages only; never log in to a real account."""
import os
import unittest
from unittest.mock import patch
from chaoxing_read import safe_url, parse_courses, parse_homework, parse_deadline, ChaoxingReadError, query_chaoxing
from physical_read import parse_scores, PhysicalReadError


class ReadIntegrations(unittest.TestCase):
    def test_no_external_redirect_or_plaintext_chaoxing(self):
        for url in ("http://mooc1.chaoxing.com/", "https://chaoxing.com.evil.invalid/", "https://127.0.0.1/", "https://a:b@mooc1.chaoxing.com/", "https://mooc1.chaoxing.com:8443/"):
            with self.subTest(url=url), self.assertRaises(ChaoxingReadError): safe_url(url)
        self.assertEqual(safe_url("https://mooc1.chaoxing.com/task"), "https://mooc1.chaoxing.com/task")

    def test_unknown_courses_are_not_successful_empty(self):
        with self.assertRaises(ChaoxingReadError): parse_courses("<h1>请登录</h1>")
        self.assertEqual(parse_courses("暂无课程"), [])
        data = parse_courses('<a href="/visit/stucoursemiddle?courseid=1&clazzid=2&cpi=3"></a><span class="course-name" title="示例课程"></span><p class="line2 color3" title="示例教师"></p>')
        self.assertEqual(data[0]["key"], "1:2:3")
        self.assertEqual(data[0]["name"], "示例课程")

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
        with patch.dict(os.environ, {'CHAOXING_READ_ENABLED': '', 'PHYSICAL_READ_ENABLED': '', 'PHYSICAL_ALLOW_HTTP': ''}):
            client = app.app.test_client()
            caps = client.get('/api/integrations/capabilities').get_json()
            self.assertFalse(caps['physical']['enabled'])
            self.assertFalse(caps['chaoxing']['enabled'])
            self.assertEqual(client.post('/api/physical/query', json={}).status_code, 503)
            self.assertEqual(client.post('/api/learning/chaoxing/query', json={}).status_code, 503)
        with patch.dict(os.environ, {'PHYSICAL_READ_ENABLED': '1', 'PHYSICAL_ALLOW_HTTP': '1'}), patch('physical_read.query') as read:
            self.assertEqual(client.post('/api/physical/query', json={'consent': False}).status_code, 400)
            read.assert_not_called()


if __name__ == '__main__': unittest.main()
