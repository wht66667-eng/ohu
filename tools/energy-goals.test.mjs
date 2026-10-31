/**
 * 匿名社区（目标墙）测试（纯逻辑层，假掉 cbRdb 的 rpc）：
 * 1) feed 归一化：jsonb 可能是数组 / JSON 字符串 / 单元素包装，都要解出来
 * 2) 匿名优先：reveal=false 时绝不返回昵称头像，只给代号
 * 3) 发布前校验长度，实名才上传昵称头像
 * 4) 鼓励 / 实名开关 / 撤下的返回值收敛
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

/** @param handler (name, params) => { data, error } */
function goals(handler = async () => ({ data: [], error: null })) {
  const calls = []
  const mod = load(
    'src/lib/energy-goals.ts',
    {
      './cb': {
        cbRdb: () => ({
          rpc: async (name, params) => {
            calls.push([name, params])
            return handler(name, params)
          },
        }),
      },
      // 负荷档位收口另有测试覆盖，这里给等价实现
      './todo-energy': {
        DEFAULT_LOAD: 2,
        normLoad: (v) => {
          const n = Math.round(Number(v))
          if (!Number.isFinite(n)) return 2
          return Math.min(5, Math.max(1, n))
        },
      },
    },
    { localStorage: storage(), Date, Math, Number, JSON },
  )
  return { ...mod, calls }
}

const RAW = [
  {
    id: 1,
    text: '这学期把高数跟上来',
    load: 4,
    cheers: 3,
    cheered: false,
    mine: false,
    reveal: false,
    name: '小狐狸',
    avatar: 'https://cdn.example.com/a.png',
    code: '3f2a',
    at: '2026-03-10T09:00:00Z',
  },
  {
    id: 2,
    text: '每天读 20 页书',
    load: 2,
    cheers: 0,
    cheered: true,
    mine: true,
    reveal: true,
    name: '我',
    avatar: '',
    code: 'ab',
    at: '2026-03-10T10:00:00Z',
  },
]

test('the feed accepts arrays, JSON strings and single-object wrappers', async () => {
  // 数组本体 / JSON 字符串 / 单元素再包一层数组，三种都要解出同样的两行
  for (const shape of [RAW, JSON.stringify(RAW), [RAW]]) {
    const { fetchEnergyGoals } = goals(async () => ({ data: shape, error: null }))
    const res = await fetchEnergyGoals()
    assert.equal(res.error, null)
    assert.equal(res.rows.length, 2)
    assert.equal(res.rows[0].id, 1)
  }
})

test('anonymous goals never expose a name or avatar', async () => {
  const { fetchEnergyGoals, authorLabel } = goals(async () => ({ data: RAW, error: null }))
  const [anon, named] = (await fetchEnergyGoals()).rows
  assert.equal(anon.reveal, false)
  assert.equal(anon.name, null)
  assert.equal(anon.avatar, null)
  assert.equal(authorLabel(anon), '匿名 · 3F2A')
  assert.equal(named.reveal, true)
  assert.equal(authorLabel(named), '我')
  // 空头像不能变成 <img src="">
  assert.equal(named.avatar, null)
})

test('rpc failures surface as an error instead of an empty wall', async () => {
  const { fetchEnergyGoals } = goals(async () => ({ data: null, error: { message: 'boom' } }))
  const res = await fetchEnergyGoals()
  assert.equal(res.error, 'boom')
  assert.equal(res.rows.length, 0)
})

test('publishing validates length and only uploads identity when revealed', async () => {
  const { createEnergyGoal, calls } = goals(async () => ({ data: 7, error: null }))

  const tooShort = await createEnergyGoal({ text: 'a' })
  assert.equal(tooShort.error, '目标至少写 2 个字')
  const tooLong = await createEnergyGoal({ text: 'x'.repeat(61) })
  assert.match(tooLong.error, /最多 60 字/)
  assert.equal(calls.length, 0)

  const anon = await createEnergyGoal({ text: '练口语', reveal: false, name: '小狐狸', avatar: 'https://cdn/a.png' })
  assert.equal(anon.id, 7)
  assert.equal(calls.at(-1)[1].p_reveal, false)
  assert.equal(calls.at(-1)[1].p_name, null)
  assert.equal(calls.at(-1)[1].p_avatar, null)

  const named = await createEnergyGoal({ text: '练口语', reveal: true, name: '小狐狸', avatar: 'https://cdn/a.png' })
  assert.equal(named.error, null)
  assert.equal(calls.at(-1)[1].p_name, '小狐狸')
  assert.equal(calls.at(-1)[1].p_avatar, 'https://cdn/a.png')
  assert.equal(calls.at(-1)[1].p_load, 2)
})

test('cheer, reveal toggle and hide collapse the rpc result to booleans', async () => {
  const toggled = goals(async () => ({ data: true, error: null }))
  // 跨 realm 的 deepEqual 会失败，逐字段比
  const cheered = await toggled.cheerEnergyGoal(9)
  assert.equal(cheered.cheered, true)
  assert.equal(cheered.error, null)
  const revealed = await toggled.setEnergyGoalReveal(9, true, '我', '')
  assert.equal(revealed.ok, true)
  assert.equal(revealed.error, null)
  const hidden = await toggled.hideEnergyGoal(9)
  assert.equal(hidden.ok, true)
  assert.equal(hidden.error, null)
  assert.deepEqual(toggled.calls.map(([name]) => name), ['energy_goal_cheer', 'energy_goal_set_reveal', 'energy_goal_hide'])

  const off = goals(async () => ({ data: false, error: null }))
  assert.equal((await off.cheerEnergyGoal(3)).cheered, false)

  const broken = goals(async () => ({ data: null, error: { message: '请先登录' } }))
  const res = await broken.cheerEnergyGoal(3)
  assert.equal(res.cheered, false)
  assert.equal(res.error, '请先登录')
})
