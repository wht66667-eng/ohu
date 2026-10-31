/**
 * 待办负荷系统测试（纯逻辑层）：
 * 1) 档位收敛：越界 / 非法值都落回 1-5，不会出现 NaN 弄脏进度条
 * 2) 今日负荷口径：已完成、明确排到未来的不计入；无到期 / 今天到期 / 已逾期的计入
 * 3) 上限持久化：本地优先，云端有值以云端为准，云端不可用不丢本地
 * 4) 看板：完成趋势按 done_at 归天，柱状图有最小可见高度
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(join(root, 'package.json'))('typescript')

function load(relative, injected = {}, globals = {}) {
  const source = fs.readFileSync(join(root, relative), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    URLSearchParams,
    ...globals,
    require(name) {
      if (name in injected) return injected[name]
      throw Error(`Unexpected dependency: ${name}`)
    },
  })
  return module.exports
}

function storage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value))
    },
    removeItem: (key) => {
      map.delete(key)
    },
  }
}

const SESSION = { uid: 'A', revision: 1 }
const qbank = {
  captureQbankSession: () => ({ ...SESSION }),
  isQbankSessionCurrent: () => true,
}

/** 固定「今天」为 2026-03-10 12:00 本地时间 */
const NOW = new Date(2026, 2, 10, 12, 0, 0).getTime()
const iso = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString()

function energy(options = {}) {
  const writes = []
  const store = storage()
  const mod = load(
    'src/lib/todo-energy.ts',
    {
      './qbank': qbank,
      './cb': {
        cbRdb: () => ({
          from() {
            const chain = {
              select() {
                return chain
              },
              eq() {
                return chain
              },
              limit() {
                return chain
              },
              async then(resolve) {
                return resolve(options.cloud ? options.cloud() : { data: [], error: null })
              },
              async update(body) {
                writes.push(['update', body])
                return { error: null }
              },
              async insert(body) {
                writes.push(['insert', body])
                return { error: null }
              },
            }
            return chain
          },
        }),
      },
    },
    { localStorage: store, Date, Math, Number },
  )
  return { ...mod, writes, store }
}

test('load values are clamped into 1-5 and never leak NaN', () => {
  const { normLoad, loadLabel, DEFAULT_LOAD } = energy()
  assert.equal(normLoad(0), 1)
  assert.equal(normLoad(-3), 1)
  assert.equal(normLoad(9), 5)
  assert.equal(normLoad(2.6), 3)
  assert.equal(normLoad(undefined), DEFAULT_LOAD)
  assert.equal(normLoad('abc'), DEFAULT_LOAD)
  assert.equal(loadLabel(5), '大工程')
  assert.equal(loadLabel(1), '随手')
})

test("today's load counts open, due-today, overdue and undated todos only", () => {
  const { computeLoad, DEFAULT_CAP } = energy()
  const rows = [
    { done: false, due_at: null, load: 3 }, // 无到期 → 计入
    { done: false, due_at: iso(2026, 3, 10, 9), load: 2 }, // 今天到期 → 计入
    { done: false, due_at: iso(2026, 3, 9, 9), load: 4 }, // 已逾期 → 计入
    { done: false, due_at: iso(2026, 3, 12, 9), load: 5 }, // 后天 → 不计入
    { done: true, due_at: iso(2026, 3, 10, 9), load: 5 }, // 已完成 → 不计入
    { done: false, due_at: 'not-a-date', load: 5 }, // 脏数据 → 计入
  ]
  const state = computeLoad(rows, DEFAULT_CAP, NOW)
  assert.equal(state.used, 3 + 2 + 4 + 5)
  assert.equal(state.count, 4)
  assert.equal(state.cap, DEFAULT_CAP)
  assert.equal(state.over, true)
  assert.equal(state.warn, true)
})

test('load states flip at the 80% warning line and the hard cap', () => {
  const { computeLoad, capClamp } = energy()
  // 单条上限是 5 点，想凑出更大的负荷得用多条
  const rows = (total) => Array.from({ length: total }, () => ({ done: false, due_at: null, load: 1 }))
  const ok = computeLoad(rows(2), 10, NOW)
  assert.equal(ok.used, 2)
  assert.equal(ok.over, false)
  assert.equal(ok.warn, false)
  const warn = computeLoad(rows(9), 10, NOW)
  assert.equal(warn.over, false)
  assert.equal(warn.warn, true)
  const over = computeLoad(rows(11), 10, NOW)
  assert.equal(over.over, true)
  // 上限本身也要夹在 [4, 30]，避免手滑设成 0 导致除零
  assert.equal(capClamp(0), 4)
  assert.equal(capClamp(999), 30)
  assert.equal(capClamp('8'), 8)
})

test('wouldExceed warns before a draft blows the daily cap', () => {
  const { wouldExceed } = energy()
  const rows = [{ done: false, due_at: null, load: 4 }, { done: false, due_at: null, load: 4 }]
  assert.equal(wouldExceed(rows, 2, 10, NOW), false)
  assert.equal(wouldExceed(rows, 3, 10, NOW), true)
})

test('cap persists locally and the cloud copy wins on pull', async () => {
  const { setLoadCap, getLoadCap, pullLoadCap, DEFAULT_CAP } = energy()
  assert.equal(getLoadCap(), DEFAULT_CAP)
  assert.equal(setLoadCap(14), 14)
  assert.equal(getLoadCap(), 14)

  const remote = energy({ cloud: async () => ({ data: [{ pref_value: { cap: 6 } }], error: null }) })
  assert.equal(await remote.pullLoadCap('A'), 6)
  assert.equal(remote.getLoadCap(), 6)

  const broken = energy({ cloud: async () => ({ data: null, error: { message: 'boom' } }) })
  broken.setLoadCap(18)
  assert.equal(await broken.pullLoadCap('A'), 18)
})

test('load hint text tracks the three states', () => {
  const { loadHint, computeLoad } = energy()
  const pts = (total) => Array.from({ length: total }, () => ({ done: false, due_at: null, load: 1 }))
  assert.match(loadHint(computeLoad([], 10, NOW)), /还没排事/)
  assert.match(loadHint(computeLoad(pts(2), 10, NOW)), /还剩 8 点/)
  assert.match(loadHint(computeLoad(pts(9), 10, NOW)), /快到上限/)
  assert.match(loadHint(computeLoad(pts(12), 10, NOW)), /超过上限/)
})

test('done trend buckets completions per local day and bars keep a minimum height', async () => {
  const insights = load('src/lib/todo-insights.ts', {
    './focus-stats': {
      lastDays: (n) => Array.from({ length: n }, (_, i) => ({
        key: `k${i}`,
        label: `${i}`,
        weekday: '一',
        minutes: i,
        sessions: 0,
        isToday: i === n - 1,
      })),
      todayMinutes: () => 25,
      streakDays: () => 3,
    },
  })
  const rows = [
    { done: true, done_at: iso(2026, 3, 10, 20) },
    { done: true, done_at: iso(2026, 3, 10, 21) },
    { done: true, done_at: iso(2026, 3, 2, 21) }, // 近 7 天窗口之外
    { done: false, done_at: null },
    { done: true, done_at: null },
  ]
  const trend = insights.doneTrend(rows, 7, NOW)
  assert.equal(trend.length, 7)
  assert.equal(trend[trend.length - 1].done, 2)
  assert.equal(trend[trend.length - 1].isToday, true)
  assert.equal(trend.reduce((s, d) => s + d.done, 0), 2)

  const board = insights.buildBoard(rows, 7, NOW)
  assert.equal(board.doneToday, 2)
  assert.equal(board.doneWeek, 2)
  assert.equal(board.streak, 3)
  assert.equal(insights.barPct(0, 10), 0)
  assert.ok(insights.barPct(1, 100) >= 8)
  assert.equal(insights.barPct(100, 100), 100)
})
