/**
 * 正方 HTML 解析回归：成绩 / 课表 / 考试。
 * 运行：`node --test tools/zf-parse.test.mjs`（Node 24 直接擦除 .ts 类型）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { parseExamPortalRows, parseWeeks, parseZfExams, parseZfGrades, parseZfTimetable } from '../src/lib/zf-html-parse.ts'

const GRADES_HTML = `<table id="Datagrid1">
<tr><td>学年</td><td>学期</td><td>课程代码</td><td>课程名称</td><td>课程性质</td><td>课程归属</td><td>学分</td><td>绩点</td><td>成绩</td></tr>
<tr><td>2023-2024</td><td>1</td><td>2106010521</td><td>大学计算机</td><td>必修课</td><td>学科基础</td><td>2.0</td><td>3.50</td><td>78</td></tr>
<tr><td>2023-2024</td><td>1</td><td>2106010521</td><td>大学计算机</td><td>必修课</td><td>学科基础</td><td>2.0</td><td>3.50</td><td>78</td></tr>
<tr><td>合计</td><td></td><td></td><td></td><td></td><td></td><td>2.0</td><td></td><td></td></tr>
</table>`

const TIMETABLE_HTML = `<table id="Table1">
<tr><td colspan="2">时间</td><td>星期一</td><td>星期二</td><td>星期三</td><td>星期四</td><td>星期五</td><td>星期六</td><td>星期日</td></tr>
<tr><td rowspan="2">上午</td><td>第1节</td><td>&nbsp;</td><td rowspan="2">流体力学<br>周二第1,2节{第1-2周}<br>查国震<br>C文思409</td><td rowspan="2">海洋生态学基础<br>周三第1,2节{第1-8周}<br>李玉<br>C文思302</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
<tr ><td>第2节</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
<tr><td>下午</td><td>第5节</td><td>形势与政策<br>周一第5,6节{第1-16周}<br>钱建华<br>C文通325</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
</table>`

const EXAMS_HTML = `<table id="Datagrid1">
<tr><td>课程名称</td><td>考试时间</td><td>考试地点</td><td>座位号</td><td>考试形式</td></tr>
<tr><td>大学计算机</td><td>2024-01-10 09:00</td><td>C文思409</td><td>12</td><td>闭卷</td></tr>
<tr><td>合计</td><td></td><td></td><td></td><td></td></tr>
</table>`

test('正方成绩：按学年列识别并去重', () => {
  const grades = parseZfGrades(GRADES_HTML)
  assert.equal(grades.length, 1)
  assert.equal(grades[0].name, '大学计算机')
  assert.equal(grades[0].credit, '2.0')
  assert.equal(grades[0].gpa, '3.50')
  assert.equal(grades[0].score, '78')
})

test('正方课表：rowspan 展开后列不错位，表头不产生幽灵课程', () => {
  const rows = parseZfTimetable(TIMETABLE_HTML)
  const names = [...new Set(rows.map((row) => row.name))]
  assert.deepEqual(names.sort(), ['形势与政策', '海洋生态学基础', '流体力学'].sort())
  const fluid = rows.filter((row) => row.name === '流体力学')
  assert.equal(fluid.length, 2, '第 1-2 周各一行')
  assert.deepEqual(fluid.map((row) => row.week), [1, 2])
  assert.deepEqual(fluid[0].sections, [1, 2])
  assert.equal(fluid[0].day, 2)
  assert.equal(fluid[0].teacher, '查国震')
  assert.equal(fluid[0].room, 'C文思409')
  assert.equal(rows.some((row) => row.name === '星期一'), false)
})

test('正方考试：跳过表头与合计行', () => {
  const exams = parseZfExams(EXAMS_HTML)
  assert.equal(exams.length, 1)
  assert.equal(exams[0].name, '大学计算机')
  assert.equal(exams[0].datetime, '2024-01-10 09:00')
  assert.equal(exams[0].seat, '12')
})

test('周次解析：范围 / 列表 / 单双周', () => {
  assert.deepEqual(parseWeeks('1-3'), [1, 2, 3])
  assert.deepEqual(parseWeeks('1,3,5'), [1, 3, 5])
  assert.deepEqual(parseWeeks('单周'), [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35, 37, 39])
  assert.equal(parseWeeks('双周')[0], 2)
  assert.deepEqual(parseWeeks('第2-4周'), [2, 3, 4])
})

test('exam portal: keep only dated exam rows', () => {
  const rows = [
    ['编号', '课程', '日期', '时间', '班级', '考场', '任课教师'],
    ['1', '海洋地理信息系统', '2026-11-26', '15:00-17:00', '海技1241', 'C文通126', '任静'],
    ['2', '海洋测绘', '2026-11-27', '10:00-12:00', '海技1241', 'C文通124', '孙佳龙'],
    ['首页 教务处 登录 导航', '', '', '', '', '', ''],
  ]
  const exams = parseExamPortalRows(rows)
  assert.equal(exams.length, 2)
  assert.equal(exams[0].name, '海洋地理信息系统')
  assert.equal(exams[0].datetime, '2026-11-26 15:00-17:00')
  assert.equal(exams[0].room, 'C文通126')
  assert.equal(exams[0].seat, '')
})