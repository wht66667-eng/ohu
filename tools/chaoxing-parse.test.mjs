import test from 'node:test'
import assert from 'node:assert/strict'
import { filterCurrentSemester, parseChaoxingCourseHtml, parseChaoxingCourseListHtml, parseChaoxingSsoPage } from '../src/lib/chaoxing-parse.ts'

const HTML = `
<div class="course">
  <a href="/visit/stucoursemiddle?courseid=123&clazzid=456&cpi=789">
    <span class="course-name" title="高等数学">高等数学</span>
    <p class="line2 color3" title="张三">张三</p>
  </a>
  <a href="/visit/stucoursemiddle?courseid=123&amp;clazzid=456&amp;cpi=789">重复</a>
  <a href="/visit/stucoursemiddle?courseid=222&clazzid=333&cpi=444">
    <span class="course-name" title="大学物理">大学物理</span>
    <p class="line2 color3" title="李四">李四</p>
  </a>
</div>`

test('学习通课程 HTML：按 courseid:clazzid:cpi 去重解析', () => {
  const courses = parseChaoxingCourseHtml(HTML)
  assert.equal(courses.length, 2)
  assert.equal(courses[0].title, '高等数学')
  assert.equal(courses[0].detail, '张三')
  assert.equal(courses[1].title, '大学物理')
  assert.equal(courses[1].detail, '李四')
})

test('学习通课程 HTML：无课程链接返回空', () => {
  assert.deepEqual(parseChaoxingCourseHtml('<div>暂无课程</div>'), [])
})

test('学习通 SSO 落页：过滤姓名块并解析课程/教师', () => {
  const text = '王昊天\n\n医药数理统计方法\n罗志丹\n\n防火防爆技术\n姜琴\n\n更多'
  const courses = parseChaoxingSsoPage(text)
  assert.equal(courses.length, 2)
  assert.equal(courses[0].title, '医药数理统计方法')
  assert.equal(courses[0].detail, '罗志丹')
  assert.equal(courses[1].title, '防火防爆技术')
})
test('学习通我的课程 HTML：按 cid:classid 去重并标注状态', () => {
  const html = `<li class="w_couritem" cid="1" classid="2" cname="物理海洋学"><span class="course-name over2">物理海洋学</span><p class="line2 color3">吕海滨</p></li>
    <li class="w_couritem" cid="1" classid="2"><span class="course-name">物理海洋学</span><p class="line2 color3">吕海滨</p></li>
    <li class="w_couritem" cid="3" classid="4"><span class="course-name">中国近现代史纲要</span><p class="line2 color3">尤加国</p><div class="not-open-tip">本课程已结课</div></li>`
  const courses = parseChaoxingCourseListHtml(html)
  assert.equal(courses.length, 2)
  assert.equal(courses[0].title, '物理海洋学')
  assert.equal(courses[0].detail, '吕海滨 · 进行中')
  assert.equal(courses[0].classId, '2')
  assert.equal(courses[1].detail, '尤加国 · 已结束')
})
test('学习通课程：只保留当前学年', () => {
  const now = new Date('2026-11-07T00:00:00+08:00')
  const courses = [
    { title: '物理海洋学', detail: '吕海滨 · 进行中', state: 'active' },
    { title: '形势与政策（2023-2024-1学期）', detail: '周琦 · 进行中', state: 'active' },
    { title: '形势与政策（2026-2027-1学期）', detail: '周琦 · 进行中', state: 'active' },
    { title: '中国近现代史纲要23-24-1', detail: '尤加国 · 已结束', state: 'ended' },
    { title: '马克思主义基本原理-2025-2026-1', detail: '赵霞 · 进行中', state: 'active' },
    { title: '大学计算机(2023)', detail: '王霞 · 进行中', state: 'active' },
    { title: '形势与政策（2026-2027-2学期）', detail: '周琦 · 进行中', state: 'active' },
  ]
  const kept = filterCurrentSemester(courses, now)
  assert.deepEqual(kept.map((course) => course.title), ['物理海洋学', '形势与政策（2026-2027-1学期）'])
})