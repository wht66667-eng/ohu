import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(`${root}/package.json`)('typescript')
const compiled = ts.transpileModule(fs.readFileSync(`${root}/src/lib/qbank.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function setup(response, insertResponse = () => ({ error: null }), faults = {}) {
  const storage = new Map()
  const calls = []
  const module = { exports: {} }
  vm.runInNewContext(compiled, {
    module, exports: module.exports, console, Date, Math, Map, Set,
    localStorage: {
      getItem: key => { if (faults.readKey === key) throw new Error('read blocked'); return storage.get(key) || null },
      setItem: (key, value) => { if (faults.writeKey === '*' || faults.writeKey === key) throw new Error('quota'); storage.set(key, value) },
      removeItem: key => storage.delete(key),
    },
    require: name => {
      assert.equal(name, './cb')
      return { cbRdb: () => ({ from: table => ({
        select: () => ({ eq: (column, uid) => ({ limit: () => { calls.push({ table, column, uid }); return Promise.resolve(response(table, uid)) } }) }),
        insert: row => { calls.push({ table, row }); return Promise.resolve(insertResponse(table, row)) },
      }) }) }
    },
  })
  return { api: module.exports, storage, calls }
}
let resolve
const delayed = new Promise(r => { resolve = r })
const stale = setup(() => delayed)
stale.api.setQbankUid('test-owner-a')
const pending = stale.api.pullCloud()
stale.api.setQbankUid('test-owner-b')
stale.api.setQbankUid('test-owner-a')
resolve({ data: [], error: null })
assert.equal(await pending, false)
assert.equal(stale.storage.size, 0)
assert.equal(stale.calls.length, 3)
assert.ok(stale.calls.every(c => c.uid === 'test-owner-a'))

const denied = setup(table => ({ data: [], error: table === 'papers' ? { message: 'denied' } : null }))
denied.api.setQbankUid('test-owner')
assert.equal(await denied.api.pullCloud(), false)
assert.equal(denied.storage.size, 0)

const empty = setup(() => ({ data: [], error: null }))
empty.api.setQbankUid('test-owner')
empty.api.addPaperLocal('本机记录', [])
assert.equal(await empty.api.pullCloud(), true)
assert.equal(empty.api.listPapersLocal()[0].title, '本机记录')

const valid = setup(table => ({ error: null, data: table === 'papers' ? [{ id: 'test-paper', title: 'Test', config: { qids: ['test-q'] }, created_at: '2026-10-02T00:00:00Z' }] : table === 'paper_attempts' ? [{ id: 'test-attempt', paper_id: 'test-paper', score: 80, total_count: 5, correct_count: 4, answers: { 'test-q': 'A' }, created_at: '2026-10-02T00:00:00Z' }] : [] }))
valid.api.setQbankUid('test-owner')
assert.equal(await valid.api.pullCloud(), true)
const paper = valid.api.listPapersLocal()[0]
assert.equal(paper.attempts.length, 1)
assert.equal(paper.attempts[0].score, 80)
assert.equal(paper.attempts[0].answers['test-q'], 'A')
// Account and guest storage never mix; returning to an owner restores only that owner's records.
const isolated = setup(() => ({ data: [], error: null }))
let notified = 0
const unsubscribe = isolated.api.subscribeQbank(() => notified++)
isolated.api.setQbankUid('owner:a')
const ownerPaper = isolated.api.addPaperLocal('A private', [])
const oldSession = isolated.api.captureQbankSession()
isolated.api.setQbankUid('owner:b')
assert.equal(isolated.api.listPapersLocal().length, 0)
isolated.api.addPaperLocal('B private', [])
isolated.api.setQbankUid(null)
assert.equal(isolated.api.listPapersLocal().length, 0)
isolated.api.addPaperLocal('Guest only', [])
isolated.api.setQbankUid('owner:a')
assert.equal(isolated.api.listPapersLocal()[0].id, ownerPaper.id)
assert.equal(isolated.api.isQbankSessionCurrent(oldSession), false)
assert.ok(notified >= 7)
unsubscribe()
isolated.api.setQbankUid('owner:b')
assert.equal(isolated.api.listPapersLocal()[0].title, 'B private')
isolated.api.setQbankUid(null)
assert.equal(isolated.api.listPapersLocal()[0].title, 'Guest only')

const legacy = setup(() => ({ data: [], error: null }))
const legacyRaw = JSON.stringify({ questions: [], papers: [{ id: 'old-p', title: 'Old private', attempts: [], qids: [], createdAt: '2026-10-01' }] })
legacy.storage.set('qbank.v2', legacyRaw)
legacy.api.setQbankUid('owner:a')
assert.equal(legacy.api.listPapersLocal().length, 0)
assert.equal(legacy.api.getLegacyQbankSummary().papers, 1)
assert.equal(await legacy.api.pullCloud(), true)
assert.equal(legacy.api.listPapersLocal().length, 0, 'sync must not silently claim unowned old data')
assert.equal(legacy.api.restoreLegacyQbank().ok, true)
assert.equal(legacy.api.listPapersLocal()[0].id, 'old-p')
assert.equal(legacy.storage.get('qbank.v2'), legacyRaw, 'retain original backup')
legacy.api.setQbankUid('owner:b')
assert.equal(legacy.api.listPapersLocal().length, 0)
assert.equal(legacy.api.getLegacyQbankSummary(), null)
assert.equal(legacy.api.restoreLegacyQbank().ok, false)

const corrupt = setup(() => ({ data: [], error: null }))
corrupt.api.setQbankUid('owner:a')
corrupt.storage.set('qbank.v3:uid:owner%3Aa', '{bad json')
assert.equal(corrupt.api.listQuestionsLocal().length, 0)
corrupt.storage.set('qbank.v2', '{bad json')
assert.equal(corrupt.api.getLegacyQbankSummary(), null)

const offline = setup(() => { throw new Error('must not call cloud') })
offline.api.setQbankUid('local:offline-a')
offline.api.addPaperLocal('Offline A', [])
assert.equal(offline.api.cloudEnabled(), false)
assert.equal(await offline.api.pullCloud(), false)
offline.api.setQbankUid('local:offline-b')
assert.equal(offline.api.listPapersLocal().length, 0)
offline.api.setQbankUid('local:offline-a')
assert.equal(offline.api.listPapersLocal()[0].title, 'Offline A')

// A batch started by A cannot continue inserting A's content with B's uid.
let resolveWrite
const delayedWrite = new Promise(r => { resolveWrite = r })
const upload = setup(() => ({ data: [], error: null }), () => delayedWrite)
upload.api.setQbankUid('owner:a')
const question = { id: 'q-a', stem: 'Private A', options: [], tags: [], createdAt: '2026-10-02' }
const uploading = upload.api.pushQuestionsCloud([question, { ...question, id: 'q-a2' }])
upload.api.setQbankUid('owner:b')
resolveWrite({ error: null })
await uploading
assert.equal(upload.calls.length, 1)
assert.equal(upload.calls[0].row.uid, 'owner:a')

// Newly downloaded attempts must merge even when the paper creation time did not change.
const attempts = setup(table => ({ error: null, data: table === 'papers' ? [{ id: 'same-paper', title: 'Test', config: { qids: [] }, created_at: '2026-10-01' }] : table === 'paper_attempts' ? [{ id: 'cloud-attempt', paper_id: 'same-paper', score: 80, created_at: '2026-10-02' }] : [] }))
attempts.api.setQbankUid('owner:a')
attempts.storage.set('qbank.v3:uid:owner%3Aa', JSON.stringify({ questions: [], papers: [{ id: 'same-paper', title: 'Test', qids: [], attempts: [{ id: 'local-attempt', answers: {}, createdAt: '2026-10-01' }], createdAt: '2026-10-01' }] }))
assert.equal(await attempts.api.pullCloud(), true)
assert.equal(attempts.api.listPapersLocal()[0].attempts.length, 2)
const quota = setup(() => ({ data: [], error: null }), undefined, { writeKey: '*' })
quota.api.setQbankUid('owner:a')
assert.throws(() => quota.api.addPaperLocal('Not saved', []), /未能保存/)
assert.equal(quota.api.listPapersLocal().length, 0)
assert.equal(await quota.api.pullCloud(), false, 'sync must not report success if local persistence failed')

const existing = JSON.stringify({ questions: [], papers: [{ id: 'mine', title: 'Mine', qids: [], attempts: [], createdAt: '2026-10-02' }] })
const recoveryQuota = setup(() => ({ data: [], error: null }), undefined, { writeKey: 'qbank.v2:restored-to' })
recoveryQuota.api.setQbankUid('owner:a')
recoveryQuota.storage.set('qbank.v2', legacyRaw)
recoveryQuota.storage.set('qbank.v3:uid:owner%3Aa', existing)
assert.equal(recoveryQuota.api.restoreLegacyQbank().ok, false)
assert.equal(recoveryQuota.storage.get('qbank.v3:uid:owner%3Aa'), existing)
assert.equal(recoveryQuota.storage.get('qbank.v2'), legacyRaw)
assert.equal(recoveryQuota.storage.has('qbank.v2:restored-to'), false)

const unreadable = setup(() => ({ data: [], error: null }), undefined, { readKey: 'qbank.v3:uid:owner%3Aa' })
unreadable.api.setQbankUid('owner:a')
unreadable.storage.set('qbank.v2', legacyRaw)
unreadable.storage.set('qbank.v3:uid:owner%3Aa', existing)
assert.equal(unreadable.api.restoreLegacyQbank().ok, false)
assert.equal(unreadable.storage.get('qbank.v3:uid:owner%3Aa'), existing, 'failed reads must not erase a destination that was never written')
assert.throws(() => unreadable.api.addPaperLocal('Cannot read previous', []), /无法读取/)
assert.equal(unreadable.storage.get('qbank.v3:uid:owner%3Aa'), existing)
console.log('Question bank: isolation, explicit recovery, storage failure, session guards and attempt merging passed without a network or real account.')
