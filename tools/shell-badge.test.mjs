import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(`${root}/package.json`)('typescript')
const source = ts.transpileModule(fs.readFileSync(`${root}/src/lib/shell-badge.ts`, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function setup(initial = {}, { readFails = false, writeFails = false } = {}) {
  const data = new Map(Object.entries(initial)), window = new EventTarget()
  const sessionStorage = {
    getItem(key) { if (readFails) throw new Error('storage blocked'); return data.get(key) ?? null },
    setItem(key, value) { if (writeFails) throw new Error('quota'); data.set(key, value) },
  }
  // im-session 桩：可切换的当前会话票据 + 订阅者（源码加载即订阅，切换会话会自动清空角标归属）
  let current = null
  const listeners = new Set()
  const imSession = {
    currentImSession: ticket => !!ticket && !!current && ticket.owner === current.owner && ticket.revision === current.revision,
    subscribeImSession: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const selectSession = uid => {
    current = uid ? { owner: uid, revision: (current?.revision ?? 0) + 1 } : null
    for (const listener of listeners) listener()
    return current
  }
  const load = () => {
    const module = { exports: {} }
    vm.runInNewContext(source, {
      module, exports: module.exports, sessionStorage, window, Event,
      require: name => { if (name === './im-session') return imSession; throw new Error(`Unexpected import: ${name}`) },
    })
    return module.exports
  }
  return { store: load(), data, reload: load, selectSession }
}

test('same-window subscribers see changed counts immediately, with no repeat for the same value', () => {
  const { store, data, selectSession } = setup(), ticket = selectSession('A'), owner = store.shellBadgeOwnerKey('A', 'admin')
  const snapshots = []
  const unsubscribe = store.subscribeShellBadge(() => snapshots.push(store.getShellBadgeCount(owner)))
  store.setShellBadgeOwner(owner, ticket)
  assert.deepEqual(snapshots, [], 'choosing an owner at zero does not announce a repeated zero')
  assert.equal(store.updateShellBadgeCount(owner, 3, ticket), true)
  assert.deepEqual(snapshots, [3])
  assert.equal(data.get('sc.shell.badge.n'), '3')
  assert.deepEqual(JSON.parse(data.get('sc.shell.badge.v1')), { owner, count: 3 })
  assert.equal(store.updateShellBadgeCount(owner, 3, ticket), false)
  assert.deepEqual(snapshots, [3])
  unsubscribe()
  store.updateShellBadgeCount(owner, 4, ticket)
  assert.deepEqual(snapshots, [3], 'unmounting removes the listener')
})

test('account and shell changes hide former counts and reject late responses and late cleanup', () => {
  const { store, selectSession } = setup(), a = store.shellBadgeOwnerKey('A', 'admin'), b = store.shellBadgeOwnerKey('B', 'admin')
  assert.equal(store.updateShellBadgeCount(a, 5), false, 'ownership without a matching session ticket is rejected')
  const ticketA = selectSession('A')
  store.setShellBadgeOwner(a, ticketA)
  store.updateShellBadgeCount(a, 5, ticketA)
  assert.equal(store.getShellBadgeCount(b), 0, 'new identity is safe before host effects run')
  assert.equal(store.getShellBadgeCount(store.shellBadgeOwnerKey('A', 'user')), 0)
  const ticketB = selectSession('B')
  assert.equal(store.getShellBadgeCount(a), 0, 'an account switch immediately hides the previous badge')
  store.setShellBadgeOwner(b, ticketB)
  assert.equal(store.getShellBadgeCount(), 0)
  assert.equal(store.updateShellBadgeCount(a, 12, ticketA), false)
  store.updateShellBadgeCount(b, 7, ticketB)
  store.clearShellBadgeOwner(a, ticketA)
  assert.equal(store.getShellBadgeCount(b), 7)
  store.clearShellBadgeOwner(b, ticketB)
  assert.equal(store.getShellBadgeCount(), 0)
  assert.equal(store.getShellBadgeCount(''), 0)
  assert.equal(store.updateShellBadgeCount(b, 99, ticketB), false, 'logout rejects an outstanding response')
})

test('malformed remote values cannot create negative, fractional or non-finite badges', () => {
  const { store, selectSession } = setup(), ticket = selectSession('A'), owner = store.shellBadgeOwnerKey('A', 'admin')
  store.setShellBadgeOwner(owner, ticket)
  for (const value of [-1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1.5', '-4', 'bad', null, {}, true]) {
    store.updateShellBadgeCount(owner, 5, ticket)
    store.updateShellBadgeCount(owner, value, ticket)
    assert.equal(store.getShellBadgeCount(owner), 0, `invalid value ${String(value)}`)
  }
  store.updateShellBadgeCount(owner, '12', ticket)
  assert.equal(store.getShellBadgeCount(owner), 12)
})

test('blocked storage does not prevent live updates, same-value suppression or clearing on logout', () => {
  const { store, selectSession } = setup({}, { readFails: true, writeFails: true }), ticket = selectSession('A'), owner = store.shellBadgeOwnerKey('A', 'admin')
  const phrases = []
  store.subscribeShellBadge(() => phrases.push(store.shellBadgeText('消息', store.getShellBadgeCount(owner))))
  store.setShellBadgeOwner(owner, ticket)
  store.updateShellBadgeCount(owner, 134, ticket)
  store.updateShellBadgeCount(owner, 134, ticket)
  store.clearShellBadgeOwner(owner, ticket)
  assert.deepEqual(phrases, ['消息，134 条未读', '消息，全部已读'])
  assert.equal(store.getShellBadgeCount(), 0)
})

test('reload restores only the matching persisted identity and safely rejects corrupt saved state', () => {
  const instance = setup(), ticket = instance.selectSession('A'), owner = instance.store.shellBadgeOwnerKey('A', 'admin')
  instance.store.setShellBadgeOwner(owner, ticket)
  instance.store.updateShellBadgeCount(owner, 6, ticket)
  const restored = instance.reload()
  assert.equal(restored.getShellBadgeCount(owner), 6)
  assert.equal(restored.getShellBadgeCount(restored.shellBadgeOwnerKey('B', 'admin')), 0)
  for (const state of ['{broken', 'null', JSON.stringify({ owner, count: Infinity }), JSON.stringify({ owner, count: -3 }), JSON.stringify({ owner: '', count: 8 })]) {
    assert.equal(setup({ 'sc.shell.badge.v1': state }).store.getShellBadgeCount(), 0)
  }
  assert.equal(setup({ 'sc.shell.badge.n': '7' }).store.getShellBadgeCount(), 0, 'legacy counts without an owner cannot leak to a different account')
})
