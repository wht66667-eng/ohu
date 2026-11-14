import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(join(root, 'package.json'))('typescript')
const source = ts.transpileModule(fs.readFileSync(join(root, 'src/lib/auto-sync.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const deferred = () => { let resolve, reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail }); return { promise, resolve, reject } }
const schoolData = { rows: [{ name: '本人课程' }], grades: [{ name: '本人分数' }], exams: [{ name: '本人考试' }] }

function fixture() {
  let uid = 'student-a'
  let revision = 1
  let savedStuid = null
  let storageAvailable = true
  let academicAvailable = true
  let query = async () => schoolData
  let captcha = async () => ({ sid: 'private-session', image: 'private-captcha' })
  const calls = { schedule: [], grades: [], exams: [], queries: 0, captchas: 0 }
  const capture = () => ({ uid, revision })
  const current = (session) => uid === session.uid && revision === session.revision
  const mocks = {
    './qbank': { captureQbankSession: capture, isQbankSessionCurrent: current },
    './academic-cache': { saveGradesCache: (...args) => { calls.grades.push(args); return academicAvailable && current(args[2]) }, saveExamsCache: (...args) => { calls.exams.push(args); return academicAvailable && current(args[2]) } },
    './campus-account': { loadCampusAccount: () => ({ stuid: '20260001', jwPassword: 'school-password' }) },
    './class-remind': { setClassRemindEnabled: () => {}, rescheduleClassReminders: async () => {} },
    './exam-utils': { rescheduleExamReminders: async () => {} },
    './notify-setup': { isNotifyConsentGranted: () => false },
    './schedule-cache': {
      loadScheduleCache: () => ({ rows: [], meta: savedStuid ? { stuid: savedStuid, ownerUid: uid } : null }),
      saveScheduleCache: (...args) => { calls.schedule.push(args); return storageAvailable && current(args[2]) },
    },
    './timetable': {
      autoQueryAcademic: async (...args) => { calls.queries++; return query(...args) },
      queryAcademic: async (...args) => { calls.queries++; return query(...args) },
      fetchCaptcha: async () => { calls.captchas++; return captcha() },
    },
  }
  const module = { exports: {} }
  vm.runInNewContext(source, { module, exports: module.exports, require: (name) => mocks[name] || {} })
  return {
    api: module.exports, calls,
    switchUid: (next) => { if (uid !== next) { uid = next; revision++ } },
    setQuery: (read) => { query = read },
    setCaptcha: (read) => { captcha = read },
    blockStorage: () => { storageAvailable = false },
    blockAcademicStorage: () => { academicAvailable = false },
    confirmBinding: (stuid) => { savedStuid = stuid },
  }
}

test('late automatic academic responses cannot persist courses, grades or exams for a new App identity', async () => {
  const f = fixture(), response = deferred()
  f.setQuery(() => response.promise)
  const pending = f.api.runAutoSync({ stuid: '20260001', password: 'school-password' })
  f.switchUid('student-b')
  response.resolve(schoolData)
  const result = await pending
  assert.equal(result.ok, false)
  assert.match(result.message, /较早的同步结果已忽略|账号或同步请求已更新/)
  for (const writes of [f.calls.schedule, f.calls.grades, f.calls.exams]) assert.equal(writes.length, 0)
})

test('guest automatic and captcha submissions never contact the school or save personal data', async () => {
  const f = fixture(); f.switchUid('')
  for (const result of [await f.api.runAutoSync(), await f.api.runAutoSync({ stuid: 'synthetic', password: 'synthetic' }),
    await f.api.runCaptchaSync({ stuid: 'synthetic', password: 'synthetic', sid: 'synthetic', captcha: '1234' })]) {
    assert.equal(result.ok, false)
    assert.match(result.message, /学号登录/)
  }
  assert.equal(f.calls.queries, 0); assert.equal(f.calls.captchas, 0)
  for (const writes of [f.calls.schedule, f.calls.grades, f.calls.exams]) assert.equal(writes.length, 0)
})

test('a captcha response from before A -> B -> A is also discarded', async () => {
  const f = fixture(), response = deferred()
  f.setQuery(() => response.promise)
  const pending = f.api.runCaptchaSync({ stuid: '20260001', password: 'school-password', sid: 'school-session', captcha: '1234' })
  f.switchUid('student-b')
  f.switchUid('student-a')
  response.resolve(schoolData)
  const result = await pending
  assert.equal(result.ok, false)
  for (const writes of [f.calls.schedule, f.calls.grades, f.calls.exams]) assert.equal(writes.length, 0)
})

test('a current response writes its captured owner and reports genuine synchronization', async () => {
  const f = fixture()
  const result = await f.api.runAutoSync({ stuid: '20260001', password: 'school-password' })
  assert.equal(result.ok, true)
  assert.equal(f.calls.schedule.length, 1)
  assert.equal(f.calls.schedule[0][2].uid, 'student-a')
  assert.equal(f.calls.grades.length, 1)
  assert.equal(f.calls.exams.length, 1)
})

test('a successful empty timetable replaces the old course snapshot instead of preserving stale reminders', async () => {
  const f = fixture()
  f.setQuery(async () => ({ ...schoolData, rows: [] }))
  const result = await f.api.runAutoSync({ stuid: '20260001', password: 'school-password' })
  assert.equal(result.ok, true)
  assert.equal(f.calls.schedule.length, 1)
  assert.deepEqual(f.calls.schedule[0][0], [])
  assert.match(result.message, /课表 0 条/)
  assert.match(result.message, /清除旧课程与提醒/)
})

test('failed atomic course persistence does not report synchronization success', async () => {
  const f = fixture()
  f.blockStorage()
  const result = await f.api.runAutoSync({ stuid: '20260001', password: 'school-password' })
  assert.equal(result.ok, false)
  assert.equal(result.needCaptcha, false)
  assert.match(result.message, /保存失败/)
  assert.equal(f.calls.grades.length, 0)
  assert.equal(f.calls.exams.length, 0)
})

test('a grade/exam write failure after a course save stays an explicit partial-save failure', async () => {
  const f = fixture()
  f.blockAcademicStorage()
  const result = await f.api.runAutoSync({ stuid: '20260001', password: 'school-password' })
  assert.equal(result.ok, false)
  assert.equal(result.needCaptcha, false)
  assert.match(result.message, /只有部分内容已保存/)
  assert.equal(f.calls.schedule.length, 1)
  assert.equal(f.calls.grades.length, 1)
  assert.equal(f.calls.exams.length, 0)
})

test('quiet sync cannot turn a global saved student number into a new App account’s ownership', async () => {
  const f = fixture()
  const result = await f.api.runAutoSync()
  assert.equal(result.ok, false)
  assert.match(result.message, /当前 App 账号/)
  assert.equal(f.calls.queries, 0)
  f.confirmBinding('20260001')
  assert.equal((await f.api.runAutoSync()).ok, true)
})

test('a stale failed query does not request a captcha or expose the old school session', async () => {
  const f = fixture(), response = deferred()
  f.setQuery(() => response.promise)
  const pending = f.api.runAutoSync({ stuid: '20260001', password: 'school-password' })
  f.switchUid('student-b')
  response.reject({ code: '1001', message: 'old user captcha error' })
  const result = await pending
  assert.equal(result.needCaptcha, false)
  assert.equal(f.calls.captchas, 0)
  assert.equal(result.captchaSid, undefined)
})

test('identity switching during a replacement captcha request discards that private session', async () => {
  const f = fixture(), response = deferred(), started = deferred()
  f.setQuery(async () => { throw { code: '1001', message: 'captcha expired' } })
  f.setCaptcha(() => { started.resolve(); return response.promise })
  const pending = f.api.runAutoSync({ stuid: '20260001', password: 'school-password' })
  await started.promise
  assert.equal(f.calls.captchas, 1)
  f.switchUid('student-b')
  response.resolve({ sid: 'student-a-session', image: 'student-a-image' })
  const result = await pending
  assert.equal(result.needCaptcha, false)
  assert.equal(result.captchaSid, undefined)
})

test('a replacement captcha failure after identity switching does not reopen the previous user’s flow', async () => {
  for (const mode of ['auto', 'captcha']) {
    const f = fixture(), response = deferred(), started = deferred()
    f.setQuery(async () => { throw { code: '1001', message: 'captcha expired' } })
    f.setCaptcha(() => { started.resolve(); return response.promise })
    const pending = mode === 'auto'
      ? f.api.runAutoSync({ stuid: '20260001', password: 'school-password' })
      : f.api.runCaptchaSync({ stuid: '20260001', password: 'school-password', sid: 'school-session', captcha: '1234' })
    await started.promise
    f.switchUid('student-b')
    response.reject(new Error('old replacement error'))
    const result = await pending
    assert.equal(result.needCaptcha, false)
    assert.match(result.message, /较早的同步结果已忽略|账号或同步请求已更新/)
  }
})

test('a 1006 upstream failure retries the academic query once and succeeds on the second attempt', async () => {
  const f = fixture()
  let attempts = 0
  f.setQuery(async () => {
    attempts += 1
    if (attempts === 1) throw { code: '1006', message: '上游超时' }
    return schoolData
  })
  const result = await f.api.runAutoSync({ stuid: '20260001', password: 'school-password' })
  assert.equal(attempts, 2)
  assert.equal(result.ok, true)
  assert.equal(f.calls.schedule.length, 1)
})

test('a persistent 1006 fails after exactly one retry and falls back to the captcha flow', async () => {
  const f = fixture()
  let attempts = 0
  f.setQuery(async () => { attempts += 1; throw { code: '1006', message: '上游超时' } })
  const result = await f.api.runAutoSync({ stuid: '20260001', password: 'school-password' })
  assert.equal(attempts, 2, '1006 must retry at most once')
  assert.equal(result.ok, false)
  assert.equal(result.needCaptcha, true)
  assert.equal(f.calls.captchas, 1)
})

test('a 1006 retry is skipped once the session is no longer current', async () => {
  const f = fixture(), response = deferred()
  f.setQuery(() => response.promise)
  const pending = f.api.runAutoSync({ stuid: '20260001', password: 'school-password' })
  await Promise.resolve()
  f.switchUid('student-b')
  response.reject({ code: '1006', message: 'old upstream timeout' })
  const result = await pending
  assert.equal(f.calls.queries, 1, 'stale 1006 must not trigger a second school request')
  assert.equal(result.ok, false)
  assert.equal(result.needCaptcha, false)
  assert.equal(f.calls.captchas, 0)
  assert.match(result.message, /账号或同步请求已更新/)
})

test('non-1006 academic failures never retry the query', async () => {
  for (const code of ['1001', '1002', '1004', '1010']) {
    const f = fixture()
    let attempts = 0
    f.setQuery(async () => { attempts += 1; throw { code, message: 'fixture failure' } })
    const result = await f.api.runAutoSync({ stuid: '20260001', password: 'school-password' })
    assert.equal(attempts, 1, `code ${code} must not retry`)
    assert.equal(result.ok, false)
  }
})
