import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import * as parser from '../src/lib/tice-parse.ts'
const { parseTiceDetailText, parseTiceCurrent } = parser
const ts = createRequire(import.meta.url)('typescript')

const text = `学生历年体质测试成绩
序号\t项目名称\t测试成绩\t分数\t结论
1\t身高(cm)\t182.0\t---\t---
2\t体重(kg)\t66.2\t0\t
3\t肺活量\t4592\t12\t良好
4\t50米跑(秒)\t6.3\t20\t优秀
5\t立定跳远(cm)\t210.0\t6\t及格
6\t千米跑(分)\t3.46\t15\t及格
7\t坐体前屈(cm)\t0.0\t1\t不及格
8\t引体向上/仰卧起坐\t6\t1\t不及格
总计\t\t\t70\t及格`

test('体测历年具体信息：逐项解析并取总分', () => {
  const year = parseTiceDetailText(text, '2025-2026')
  assert.ok(year)
  assert.equal(year.total, 70)
  assert.equal(year.grade, '及格')
  assert.equal(year.items.length, 8)
  assert.equal(year.items[2].name, '肺活量')
  assert.equal(year.items[2].raw, '4592')
  assert.equal(year.items[2].score, 12)
  assert.equal(year.items[1].name, '体重(kg)')
})

const detailPath = '/SportWeb/health_info/listdetalhistroyScore.jsp'
function detailHtml(value = 80, year = '') {
  return `<p>${year ? `学年：${year}` : ''}</p><table>
    <tr><th>序号</th><th>项目名称</th><th>测试成绩</th><th>分数</th><th>结论</th></tr>
    <tr><td>1</td><td>肺活量</td><td>${3000 + value}</td><td>20</td><td>良好</td></tr>
    <tr><td>2</td><td>50米跑</td><td>8.1</td><td>18</td><td>良好</td></tr>
    <tr><td>3</td><td>立定跳远</td><td>215</td><td>7</td><td>及格</td></tr>
    <tr><td colspan="3">总计</td><td>${value}</td><td>良好</td></tr>
  </table>`
}
function historyHtml(years) {
  return `<table><tr><th>学年</th><th>体测成绩</th><th>体测等级</th><th>详细</th></tr>${years.map((year, i) =>
    `<tr><td>${year}</td><td>${70 + i}</td><td>及格</td><td><font onclick="eval(vpn_rewrite_js(function(){window.open(&#39;${detailPath}?gradeNo=${i + 3}&#39;)}))">具体信息</font></td></tr>`
  ).join('')}</table>`
}

function syncHarness({ years, current = detailHtml(91, '2026-2027'), fallback = false, failed = [], onFetch = () => {} }) {
  let url = '', submitted = 0, restored = false, roleDefault = false, loginAction = ''
  const calls = [], saved = [], reports = []
  const controller = new AbortController()
  const pages = new Map([
    ['/student/Historyhealth.jsp', historyHtml(years)],
    ['/student/queryHealthInfo.jsp', current],
    ...years.map((_, i) => [`${detailPath}?gradeNo=${i + 3}`, detailHtml(70 + i)]),
  ])
  const pathOf = (url) => new URL(url).pathname.replace(/^\/http-8080\/[^/]+/, '') + new URL(url).search
  const page = vm.createContext({ window: {}, AbortController, setTimeout, clearTimeout, fetch: async (url) => {
    const path = pathOf(url)
    calls.push(path)
    onFetch(path, controller)
    if (failed.includes(path)) throw new Error('synthetic failure')
    return { ok: true, text: async () => fallback && !restored ? '<p>pending session</p>' : pages.get(path) ?? '' }
  } })
  const bridge = {
    open: async () => {}, close: async () => {},
    hasVpnSession: async () => ({ hasSession: true }),
    currentUrl: async () => ({ url }),
    load: async (input) => { url = input.url; if (url.includes('/common/left1.jsp')) restored = true },
  }
  const evalText = async (script) => {
    if (script.includes('__ticePage_')) return vm.runInContext(script, page)
    if (script.includes('document.readyState')) return 'complete|10'
    if (script.includes('displayRole')) { roleDefault = script.includes("'911'"); return 'student' }
    if (script.includes('document.createElement')) { submitted++; loginAction = (script.match(/form\.action = "([^"]+)"/) || [])[1] || ''; return 'submitted' }
    if (script.includes('window.frames')) return '学生查询'
    if (script === 'document.documentElement.outerHTML') return pages.get(pathOf(url)) ?? ''
    return ''
  }
  const mocks = {
    './campus-bridge': { CAMPUS_BRIDGE_AVAILABLE: true, CampusBridge: bridge, evalText },
    './qbank': { captureQbankSession: () => ({ uid: 'synthetic', revision: 1 }) },
    './physical-test-results': { importTiceSummary: (summary) => { saved.push(summary); return [] } },
    './tice-parse': parser,
  }
  const module = { exports: {} }
  const code = ts.transpileModule(readFileSync(new URL('../src/lib/one-click.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS },
  }).outputText
  vm.runInNewContext(code, {
    module, exports: module.exports, require: (name) => mocks[name] ?? {}, Date, Set, Map, AbortController,
    setTimeout: (fn, ms) => ms < 3000 ? (queueMicrotask(fn), 0) : setTimeout(fn, ms), clearTimeout,
  })
  return {
    calls, saved, reports, page, controller,
    submitted: () => submitted,
    roleDefault: () => roleDefault,
    loginAction: () => loginAction,
    run: () => module.exports.runTiceSync({ studentId: 'synthetic', vpnPassword: 'fixture', ticePassword: 'fixture', signal: controller.signal, report: (_, message) => reports.push(message) }),
  }
}

test('历年明细HTML读取独立总计行，不把总计保存成项目', () => {
  const detail = parseTiceCurrent(detailHtml(0), '2026-2027')
  assert.equal(detail.total, 0)
  assert.equal(detail.grade, '良好')
  assert.equal(detail.items.length, 3)
  assert.equal(detail.totalCount, 3)
})

test('体测完整读取：七年乱序且缺年，仍按同一表行对应明细并新增最新学年', async () => {
  const years = ['2024-2025', '2019-2020', '2025-2026', '2021-2022', '2023-2024', '2018-2019', '2022-2023']
  const h = syncHarness({ years })
  const result = await h.run()
  assert.equal(h.submitted(), 1)
  assert.equal(h.roleDefault(), true)
  assert.ok(h.loginAction().endsWith('/student/studentFrame.jsp'))
  assert.equal(h.calls.length, 9)
  assert.equal(result.count, 8)
  assert.equal(result.message, undefined)
  assert.equal(h.saved.length, 1)
  const summary = h.saved[0]
  assert.equal(summary.current.year, '2026-2027')
  assert.equal(summary.current.total, 91)
  assert.equal(summary.history.length, 7)
  for (const [i, year] of years.entries()) assert.equal(summary.history.find((row) => row.year === year).total, 70 + i)
  assert.equal(h.reports.filter((message) => /明细（\d+\/7）/.test(message)).length, 7)
  assert.deepEqual(Object.keys(h.page.window), [])
})

test('体测补会话后仍抓取全部详情，当前明细缺年不伪造2026-2027', async () => {
  const h = syncHarness({ years: ['2025-2026', '2023-2024'], current: detailHtml(95), fallback: true })
  const result = await h.run()
  assert.equal(h.calls.filter((path) => path.includes('listdetalhistroyScore')).length, 2)
  assert.equal(h.saved[0].current.year, '')
  assert.equal(h.saved[0].current.items.length, 3)
  assert.match(result.message, /学年待确认/)
})

test('体测单年详情失败不中断其他学年；明确提示部分成功', async () => {
  const h = syncHarness({ years: ['2025-2026', '2024-2025', '2023-2024'], failed: [`${detailPath}?gradeNo=4`] })
  const result = await h.run()
  assert.equal(h.calls.filter((path) => path.includes('listdetalhistroyScore')).length, 3)
  assert.equal(h.saved[0].history.filter((year) => year.items.length).length, 2)
  assert.match(result.message, /1 个学年的明细未读取/)
})

test('体测汇总请求失败仍读取当前数据；缺失最新页时保留历年', async () => {
  for (const failed of ['/student/Historyhealth.jsp', '/student/queryHealthInfo.jsp']) {
    const h = syncHarness({ years: ['2025-2026'], failed: [failed] })
    const result = await h.run()
    assert.equal(h.saved.length, 1)
    assert.match(result.message, failed.includes('History') ? /历年汇总未读取/ : /当前最新明细未读取/)
  }
})

test('体测取消后不再取下一年或保存，页面请求状态被清理', async () => {
  const h = syncHarness({ years: ['2025-2026', '2024-2025'], onFetch: (path, controller) => {
    if (path.includes('listdetalhistroyScore')) controller.abort(new Error('已取消'))
  } })
  await assert.rejects(h.run(), /已取消/)
  assert.equal(h.saved.length, 0)
  assert.equal(h.calls.filter((path) => path.includes('listdetalhistroyScore')).length, 1)
  assert.deepEqual(Object.keys(h.page.window), [])
})
