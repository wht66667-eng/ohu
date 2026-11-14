/**
 * 校园解析器回归：PU 二课 / 体测 / 学习通。
 *
 * 三个被测模块都是「纯函数、零 import」的 .ts，Node 24 直接按类型擦除加载。
 * 运行：`npm run test:parsers`（或 `node --test tools/campus-parsers.test.mjs`）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  classifyPu,
  parsePocketUniPayload,
  parsePuCreditJson,
  parsePuPageText,
  puClassesPresent,
  puCreditOf,
  puDisplayTotal,
  puIsEmpty,
  puSummaryFromJson,
  puSummaryToJson,
  splitPuTitle,
} from '../src/lib/pocketuni-parse.ts'
import {
  mergeTicePages,
  normalizeTiceYear,
  parseTiceCurrent,
  parseTiceHistory,
  parseTiceHistoryDetailLinks,
  parseTicePages,
  parseTicePaste,
  parseTiceText,
  resolveTiceCurrentYear,
} from '../src/lib/tice-parse.ts'
import { chaoxingFromJson, chaoxingToJson, parseChaoxingCourses } from '../src/lib/chaoxing-parse.ts'

const PU_PAGE_TEXT = `活动类 4.25 + 成果类 0.6 = 总成绩 4.85
【素质拓展B类】团员主题教育（0.85）
【素质拓展A类】志愿服务（1.2）
【劳动教育】公益劳动（1）
【素质拓展C类】日常性劳动（0.6）
【素质拓展B类】某已停用活动（0.5）
【素质拓展B类】零分活动（0）`

const PU_API = {
  index: { code: 0, data: { totalCredit: 4.85, activityCredit: 4.25, applyCredit: 0.6, pai: { rank: 0 } } },
  activity: {
    code: 0,
    data: {
      credit: 4.25,
      list: [
        { name: '【素质拓展B类】团员主题教育', credit: 0.85 },
        { name: '【素质拓展A类】志愿服务', credit: '1.2' },
        { name: '【素质拓展B类】(勿选）测试分类', credit: 0.5 },
      ],
    },
  },
  apply: { code: 0, data: { credit: 0.6, list: [{ name: '【劳动教育】公益劳动', credit: 0.6 }] } },
}

const TICE_HISTORY_HTML = `<html><body><table>
<tr><td colspan="16">学生历年体质测试汇总表</td></tr>
<tr align="center"><th>序号</th><th>学号</th><th>姓名</th><th>性别</th><th>学年</th><th>体测成绩</th><th>体测等级</th><th>详细</th></tr>
<tr><td>1</td><td>2023000000</td><td>测试同学</td><td>男</td><td>2324</td><td>44</td><td>不及格</td><td>具体信息</td></tr>
<tr><td>2</td><td>2023000000</td><td>测试同学</td><td>男</td><td>2425</td><td>0</td><td></td><td>具体信息</td></tr>
<tr><td>3</td><td>2023000000</td><td>测试同学</td><td>男</td><td>2526</td><td>70</td><td>及格</td><td>具体信息</td></tr>
</table></body></html>`

function ticeHistoryWithDetails(count) {
  const rows = Array.from({ length: count }, (_, index) => {
    const start = 2018 + index
    const year = `${String(start).slice(2)}${String(start + 1).slice(2)}`
    const url = `/SportWeb/health_info/listdetalhistroyScore.jsp?gradeNo=${index + 1}&amp;sex=X`
    return `<tr><td>${index + 1}</td><td>${year}</td><td>${60 + index}</td><td>及格</td><td><font onclick="window.open(&#39;${url}&#39;)">具体信息</font></td></tr>`
  }).join('\n')
  return `<table><tr><th>序号</th><th>学年</th><th>体测成绩</th><th>体测等级</th><th>详细</th></tr>${rows}</table>`
}

const TICE_CURRENT_HTML = `<html><body><table>
<tr><td colspan="8">体质测试成绩查询</td></tr>
<tr><th>项目名称</th><th>测试成绩</th><th>分数</th><th>结论</th><th>加分</th><th>减分</th><th>体测总成绩</th><th>体测总结论</th></tr>
<tr><td>身高测量</td><td>0.0</td><td>---</td><td>---</td><td rowspan="18">0</td><td rowspan="18">&nbsp;</td><td rowspan="18">0.0</td><td rowspan="18"></td></tr >
<tr><td>体重测量</td><td>0.0</td><td>0.0</td><td></td></tr>
<tr><td>肺活量</td><td>0.0</td><td>0.0</td><td></td></tr>
<tr><td>50米跑</td><td>8.5</td><td>60</td><td></td></tr>
<tr><td>立定跳远</td><td>2.1</td><td>70</td><td></td></tr>
<tr><td>1000米跑</td><td>4.2</td><td>50</td><td></td></tr>
<tr><td>坐体前屈</td><td>-100.0</td><td>0.0</td><td></td></tr>
<tr><td>引体向上</td><td>8</td><td>61</td><td></td></tr>
<tr><td>左眼视力</td><td>0.0</td><td>---</td><td>---</td></tr>
<tr><td>右眼视力</td><td>0.0</td><td>---</td><td>---</td></tr>
</table></body></html>`

test('PU 页面文字：汇总行 + 分类行，0 分与已停用被丢弃', () => {
  const summary = parsePuPageText(PU_PAGE_TEXT)
  assert.equal(summary.totalCredit, 4.85)
  assert.equal(summary.activityCredit, 4.25)
  assert.equal(summary.applyCredit, 0.6)
  assert.equal(puDisplayTotal(summary), 4.85)
  assert.deepEqual(summary.rows.map((row) => row.credit), [0.85, 1.2, 1, 0.6])
  assert.deepEqual(puClassesPresent(summary), ['a', 'b', 'c', 'labor'])
  assert.equal(summary.rows[0].category, '团员主题教育')
  assert.equal(summary.rows[3].puClass, 'c', 'C 类优先于「劳动」字样')
  assert.equal(summary.rows[1].bucket, 'unknown', '页面文字没有活动/成果归属')
})

test('PU 接口 JSON：活动/成果分桶，字符串学分也能读', () => {
  const summary = parsePuCreditJson(PU_API)
  assert.equal(summary.totalCredit, 4.85)
  assert.equal(summary.activityCredit, 4.25)
  assert.equal(summary.applyCredit, 0.6)
  assert.equal(summary.rows.length, 3)
  assert.equal(summary.rows.filter((row) => row.bucket === 'activity').length, 2)
  assert.equal(summary.rows.filter((row) => row.bucket === 'apply').length, 1)
  assert.equal(summary.rows.some((row) => row.name.includes('勿选')), false)
})

test('PU 去重：接口与页面文字的重复行只计一次', () => {
  const dupApi = {
    index: { code: 0, data: { totalCredit: 1, activityCredit: 1, applyCredit: 0 } },
    activity: {
      code: 0,
      data: {
        list: [
          { name: '【素质拓展B类】synthetic-dup', credit: 1 },
          { name: '【素质拓展B类】synthetic-dup', credit: 1 },
        ],
      },
    },
    apply: { code: 0, data: { list: [] } },
  }
  const api = parsePuCreditJson(dupApi)
  assert.equal(api.rows.length, 1, '同名同学分的重复接口行去重')
  assert.equal(puCreditOf(api, 'b'), 1)

  const text = parsePuPageText('【素质拓展B类】synthetic-dup（1）\n【素质拓展B类】synthetic-dup（1）')
  assert.equal(text.rows.length, 1, '完全相同的页面文字行去重')
})

test('PU 没读到 ≠ 0，且统一入口优先 JSON', () => {
  const empty = parsePuPageText('口袋校园 我的成绩 成绩明细')
  assert.equal(empty.totalCredit, null)
  assert.equal(empty.activityCredit, null)
  assert.equal(puIsEmpty(empty), true)
  assert.equal(puDisplayTotal(empty), null)

  const viaJson = parsePocketUniPayload(JSON.stringify(PU_API))
  assert.equal(viaJson.channel, 'json')
  assert.equal(viaJson.summary.totalCredit, 4.85)

  const viaText = parsePocketUniPayload(PU_PAGE_TEXT)
  assert.equal(viaText.channel, 'text')
  assert.equal(viaText.summary.totalCredit, 4.85)
})

test('PU 标题拆分与分类', () => {
  assert.deepEqual(splitPuTitle('【素质拓展B类】团员主题教育'), ['素质拓展B类', '团员主题教育'])
  assert.deepEqual(splitPuTitle('素质拓展B类·团员主题教育'), ['素质拓展B类', '团员主题教育'])
  assert.equal(classifyPu('【素质拓展C类】日常性劳动'), 'c')
  assert.equal(classifyPu('劳动教育'), 'labor')
  assert.equal(classifyPu('教师发展积分'), 'other')
})

test('PU JSON 往返：null 不变成 0', () => {
  const summary = parsePuPageText(PU_PAGE_TEXT)
  const restored = puSummaryFromJson(JSON.parse(JSON.stringify(puSummaryToJson(summary))))
  assert.ok(restored)
  assert.equal(restored.totalCredit, summary.totalCredit)
  assert.equal(restored.rows.length, summary.rows.length)

  const onlyRows = { ...puSummaryToJson(summary), totalCredit: null, activityCredit: null, applyCredit: null }
  const restoredRows = puSummaryFromJson(onlyRows)
  assert.ok(restoredRows)
  assert.equal(restoredRows.totalCredit, null)
  assert.equal(restoredRows.activityCredit, null)
  assert.equal(puDisplayTotal(restoredRows), 3.65, '缺少汇总时按有学分的明细兜底')
})

test('体测历年表：学号不误判学年，0 分有效、空等级保留为空', () => {
  const history = parseTiceHistory(TICE_HISTORY_HTML)
  assert.deepEqual(history.map((year) => year.year), ['2025-2026', '2024-2025', '2023-2024'])
  assert.equal(history[0].total, 70)
  assert.equal(history[0].grade, '及格')
  assert.equal(history[1].total, 0, '0 是有效分数')
  assert.equal(history[1].grade, '')
  assert.equal(history[2].total, 44)
  assert.equal(normalizeTiceYear('2023000000'), '')
  assert.equal(normalizeTiceYear('2526'), '2025-2026')
})

test('体测历年详情：实体引号可识别，全部学年不截断', () => {
  const html = ticeHistoryWithDetails(7)
  const history = parseTiceHistory(html)
  const links = parseTiceHistoryDetailLinks(html)
  assert.equal(history.length, 7)
  assert.equal(history[0].year, '2024-2025')
  assert.equal(history[6].year, '2018-2019')
  assert.equal(links.length, 7)
  assert.deepEqual(links[0], { year: '2018-2019', path: '/SportWeb/health_info/listdetalhistroyScore.jsp?gradeNo=1&sex=X' })
  assert.deepEqual(links[6], { year: '2024-2025', path: '/SportWeb/health_info/listdetalhistroyScore.jsp?gradeNo=7&sex=X' })
  const missing = html.replace(/<tr><td>1<\/td>[\s\S]*?<\/tr>/, '')
  const remaining = parseTiceHistoryDetailLinks(missing)
  assert.equal(remaining.length, 6)
  assert.equal(remaining[0].year, '2019-2020')
  assert.ok(remaining[0].path.includes('gradeNo=2'))
})

test('体测当前学年：缺少学校依据时不按设备日期伪造新学年', () => {
  const history = parseTiceHistory(TICE_HISTORY_HTML)
  const current = parseTiceCurrent(TICE_CURRENT_HTML)
  assert.equal(resolveTiceCurrentYear(history, current), '')
  assert.equal(resolveTiceCurrentYear([], current), '')
  assert.equal(mergeTicePages(history, current).current.year, '')
  assert.equal(resolveTiceCurrentYear([{ ...current, year: '2025-2026' }], current), '2025-2026')
  assert.equal(resolveTiceCurrentYear([{ ...current, year: '2025-2026' }, { ...current, year: '2024-2025' }], current), '')

  const summary = parseTicePages({
    historyHtml: TICE_HISTORY_HTML,
    currentHtml: TICE_CURRENT_HTML.replace('<body>', '<body><p>学年：2026-2027</p>'),
  })
  assert.equal(summary.history.length, 3)
  assert.equal(summary.current.year, '2026-2027')
  assert.equal(summary.current.items.length, 10)
  assert.equal(summary.current.total, 0, '新学年不借用上一学年的总分')
  assert.equal(normalizeTiceYear('2026'), '2026-2027')
  assert.equal(normalizeTiceYear('1000'), '')
})

test('体测本次页：rowspan 展开、</tr > 容忍、--- 记为未计分', () => {
  const current = parseTicePages({ currentHtml: TICE_CURRENT_HTML }).current
  assert.ok(current)
  assert.equal(current.items.length, 10)
  assert.equal(current.doneCount, 7)
  assert.equal(current.items[0].name, '身高测量')
  assert.equal(current.items[0].score, null, '--- 不是 0 分')
  assert.equal(current.items[3].score, 60)
  assert.equal(current.items[3].raw, '8.5')
})

test('体测两页合并：本次页 0.0 占位时用历年总分与等级兜底', () => {
  const summary = parseTicePages({ historyHtml: TICE_HISTORY_HTML, currentHtml: TICE_CURRENT_HTML, currentYear: '2025-2026' })
  assert.equal(summary.history.length, 3)
  assert.equal(summary.current.year, '2025-2026')
  assert.equal(summary.current.total, 70)
  assert.equal(summary.current.grade, '及格')
  assert.equal(summary.current.items.length, 10)
  assert.equal(summary.hasCurrentDetail, true)
})

test('体测两页合并：两边都没有总分时保持未公布', () => {
  const summary = mergeTicePages(
    [{ year: '2025-2026', total: null, grade: '', bonus: 0, items: [], doneCount: 0, totalCount: 0 }],
    null,
  )
  assert.equal(summary.current.total, null)
})

test('体测复制文字：制表符表格与空格表格都能读', () => {
  const pasted = [
    '学年\t体测成绩\t体测等级',
    '2025-2026\t70\t及格',
    '2024-2025\t0\t',
    '项目名称\t测试成绩\t分数\t结论',
    '身高测量\t0.0\t---\t---',
    '50米跑\t8.5\t60\t合格',
  ].join('\n')
  const summary = parseTiceText(pasted)
  assert.equal(summary.history.length, 2)
  assert.equal(summary.history[0].total, 70)
  assert.equal(summary.current.totalCount, 2)
  assert.equal(summary.current.items[1].score, 60)

  const spaced = parseTiceText('2025-2026 70 及格\n2024-2025 0')
  assert.equal(spaced.history.length, 2)
  assert.equal(spaced.history[1].total, 0)
})

test('体测统一入口：HTML 与文字自动分流', () => {
  const html = parseTicePaste(TICE_HISTORY_HTML)
  assert.equal(html.history.length, 3)
  const text = parseTicePaste('2025-2026\t70\t及格')
  assert.equal(text.history.length, 1)
})

test('学习通课程：空行分卡片、整行标题去重、界面噪声过滤', () => {
  const courses = parseChaoxingCourses('高等数学A(1)\n张老师 · 已学 32/64 课时\n\n大学英语(3)\n李老师 · 进行中')
  assert.equal(courses.length, 2)
  assert.equal(courses[0].title, '高等数学A(1)')
  assert.equal(courses[0].detail, '张老师 · 已学 32/64 课时')

  const deduped = parseChaoxingCourses('高等数学A(1)\n高等数学A(1)\n首页\n课程')
  assert.deepEqual(deduped.map((course) => course.title), ['高等数学A(1)'])

  const tabs = parseChaoxingCourses('线性代数\t王老师\t已学 8/32')
  assert.equal(tabs[0].title, '线性代数')
  assert.equal(tabs[0].detail, '王老师 · 已学 8/32')
})

test('学习通课程：JSON 往返与坏数据拒绝', () => {
  const courses = parseChaoxingCourses('高等数学A(1)\n张老师')
  const restored = chaoxingFromJson(chaoxingToJson({ courses, syncedAt: 123 }))
  assert.ok(restored)
  assert.equal(restored.courses[0].title, '高等数学A(1)')
  assert.equal(restored.syncedAt, 123)
  assert.equal(chaoxingFromJson({ courses: [{ title: '' }], syncedAt: 0 }), null)
  assert.equal(chaoxingFromJson({ courses: [{ title: 'x'.repeat(81), detail: '' }], syncedAt: 0 }), null)
})
