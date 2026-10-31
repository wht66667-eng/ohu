/** Execute the production TypeScript against fake HTTP responses and a controlled clock. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(join(root, 'package.json'))('typescript')
const production = fs.readFileSync(join(root, 'src/lib/timetable.ts'), 'utf8')
  .replace('import.meta.env.VITE_TIMETABLE_API', "'https://academic.invalid'")
const compiled = ts.transpileModule(production, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText
const credentials = { username: 'fixture', password: 'fixture', captcha: 'fixture' }
const course = { week: 1, day: 2, sections: [1, 2], name: '测试课程', teacher: '', room: '' }
const grade = { year: '2026', term: '1', code: '', name: '测试课程', nature: '', credit: '1', score: '90', gpa: '' }
const exam = { year: '2026', term: '1', code: '', name: '测试课程', datetime: '', room: '', form: '', seat: '', campus: '', teacher: '' }
const flush = () => new Promise((resolve) => setImmediate(resolve))

function response(data, { status = 200, retryAfter = '', text } = {}) {
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get: (name) => name.toLowerCase() === 'retry-after' ? retryAfter : null },
    text: text || (async () => JSON.stringify(data)),
  }
}

function fixture(fakeFetch) {
  let clock = 0, serial = 0
  const jobs = new Map(), requests = []
  const module = { exports: {} }
  vm.runInNewContext(compiled, {
    module, exports: module.exports, AbortController,
    fetch: (url, options) => { requests.push({ url, options }); return fakeFetch(url, options) },
    setTimeout: (callback, ms) => { const id = ++serial; jobs.set(id, { callback, at: clock + ms }); return id },
    clearTimeout: (id) => jobs.delete(id),
    require: () => { throw new Error('The HTTP client must have no runtime dependencies') },
  })
  return {
    api: module.exports, requests, jobs,
    advance(ms) {
      clock += ms
      for (const [id, job] of [...jobs]) if (job.at <= clock) { jobs.delete(id); job.callback() }
    },
  }
}

function rejectedCode(code, pattern) {
  return (error) => {
    assert.equal(error.code, code)
    if (pattern) assert.match(error.message, pattern)
    assert.notEqual(error.name, 'TypeError')
    return true
  }
}

test('the deadline includes a response body that never finishes, for every endpoint', async () => {
  for (const [invoke, deadline] of [
    [(api) => api.fetchCaptcha(), 25_000],
    [(api) => api.queryAcademic('fixture', credentials), 60_000],
    [(api) => api.autoQueryAcademic(credentials), 90_000],
  ]) {
    let bodyStarted = false
    const f = fixture(async () => response(null, { text: () => { bodyStarted = true; return new Promise(() => {}) } }))
    const pending = invoke(f.api)
    const rejected = assert.rejects(pending, rejectedCode('1006', /超时/))
    await flush()
    assert.equal(bodyStarted, true)
    assert.equal(f.jobs.size, 1, 'headers must not clear the body deadline')
    assert.equal(f.requests[0].options.signal.aborted, false)
    f.advance(deadline - 1)
    assert.equal(f.requests[0].options.signal.aborted, false)
    f.advance(1)
    await rejected
    assert.equal(f.requests[0].options.signal.aborted, true)
    assert.equal(f.jobs.size, 0)
  }
})

test('waiting for response headers is bounded and aborts the request', async () => {
  const f = fixture(() => new Promise(() => {}))
  const rejected = assert.rejects(f.api.queryAcademic('fixture', credentials), rejectedCode('1006', /超时/))
  f.advance(60_000)
  await rejected
  assert.equal(f.requests[0].options.signal.aborted, true)
  assert.equal(f.jobs.size, 0)
})

test('network and body read failures use the same actionable network error', async () => {
  for (const fakeFetch of [
    async () => { throw new TypeError('synthetic connection failure') },
    async () => response(null, { text: async () => { throw new TypeError('synthetic body failure') } }),
  ]) {
    const f = fixture(fakeFetch)
    await assert.rejects(f.api.queryAcademic('fixture', credentials), rejectedCode('1006', /检查网络/))
    assert.equal(f.jobs.size, 0)
  }
})

test('invalid JSON and invalid envelopes do not become empty successful syncs', async () => {
  const malformed = fixture(async () => response(null, { text: async () => '<html>gateway</html>' }))
  await assert.rejects(malformed.api.queryAcademic('fixture', credentials), rejectedCode('1006'))
  for (const data of [null, [], 'ok', 1, {}, { ok: 'true', rows: [] }]) {
    for (const invoke of [
      (api) => api.queryAcademic('fixture', credentials),
      (api) => api.autoQueryAcademic(credentials, ['schedule']),
    ]) {
      const f = fixture(async () => response(data))
      await assert.rejects(invoke(f.api), rejectedCode('1006', /格式异常/))
      assert.equal(f.jobs.size, 0)
    }
  }
})

test('HTTP 429 and server failures cannot succeed even with an ok:true JSON body', async () => {
  for (const [status, code] of [[429, '1004'], [500, '1006'], [503, '1006']]) {
    for (const text of [undefined, async () => '<html>gateway</html>']) {
      const f = fixture(async () => response({ ok: true, rows: [] }, { status, retryAfter: '12', text }))
      await assert.rejects(f.api.queryAcademic('fixture', credentials), (error) => {
        rejectedCode(code)(error)
        assert.equal(error.retryAfter, 12)
        assert.equal(error.httpStatus, status)
        return true
      })
      assert.equal(f.jobs.size, 0)
    }
  }
  const f = fixture(async () => response({ ok: true, sid: 'fixture', image: 'data:image/png;base64,fixture' }, { status: 500 }))
  await assert.rejects(f.api.fetchCaptcha(), rejectedCode('1006'))
})

test('real HTTP business errors preserve captcha, password, rate limit and OCR semantics', async () => {
  for (const [status, code, invoke, pattern] of [
    [401, '1001', (api) => api.queryAcademic('fixture', credentials), /重新输入/],
    [401, '1002', (api) => api.queryAcademic('fixture', credentials), /fixture message/],
    [429, '1004', (api) => api.queryAcademic('fixture', credentials), /fixture message/],
    [501, '1010', (api) => api.autoQueryAcademic(credentials), /手输验证码/],
    [401, '1001', (api) => api.autoQueryAcademic(credentials), /手输验证码/],
  ]) {
    const f = fixture(async () => response({ ok: false, code, message: 'fixture message' }, { status, retryAfter: '9' }))
    await assert.rejects(invoke(f.api), (error) => {
      rejectedCode(code, pattern)(error)
      assert.equal(error.retryAfter, 9)
      return true
    })
  }
  const limitedCaptcha = fixture(async () => response({ ok: false, code: '1004', message: 'fixture message' }, { status: 429, retryAfter: '4' }))
  await assert.rejects(limitedCaptcha.api.fetchCaptcha(), (error) => error.code === '1004' && error.retryAfter === 4)
  const legacyEnvelope = fixture(async () => response({ ok: false, code: '1002', message: 'fixture message' }))
  await assert.rejects(legacyEnvelope.api.queryAcademic('fixture', credentials), rejectedCode('1002', /fixture message/))
})

test('old auto routes fall back to manual captcha for empty, HTML and JSON 404/405 responses', async () => {
  for (const status of [404, 405]) {
    for (const text of [async () => '', async () => '<html>not found</html>', async () => JSON.stringify({ ok: false, code: '1008', message: 'not found' })]) {
      const f = fixture(async () => response(null, { status, text }))
      await assert.rejects(f.api.autoQueryAcademic(credentials), rejectedCode('1010', /手输验证码/))
    }
  }
})

test('requested arrays and their rows are checked before returning a successful result', async () => {
  const badRows = [undefined, null, {}, '[]', [null], [{}], [{ ...course, week: '1' }], [{ ...course, day: 8 }], [{ ...course, sections: [] }], [{ ...course, sections: ['1'] }], [{ ...course, name: '' }]]
  for (const rows of badRows) {
    for (const invoke of [
      (api) => api.queryTimetable('fixture', credentials),
      (api) => api.autoQueryAcademic(credentials, ['schedule']),
    ]) {
      const f = fixture(async () => response({ ok: true, rows }))
      await assert.rejects(invoke(f.api), rejectedCode('1006', /格式异常/))
    }
  }
  for (const data of [
    { ok: true, rows: [] },
    { ok: true, rows: [], grades: null, exams: [] },
    { ok: true, rows: [], grades: [], exams: {} },
    { ok: true, rows: [], grades: [null], exams: [] },
    { ok: true, rows: [], grades: [], exams: [null] },
    { ok: true, rows: [], grades: [{ ...grade, score: 90 }], exams: [] },
    { ok: true, rows: [], grades: [], exams: [{ ...exam, datetime: null }] },
    { ok: true, rows: [], grades: [], exams: [], grades_error: 1 },
  ]) {
    const f = fixture(async () => response(data))
    await assert.rejects(f.api.autoQueryAcademic(credentials), rejectedCode('1006', /格式异常/))
  }
})

test('valid empty requested arrays remain successful and unrequested arrays can be omitted', async () => {
  const f = fixture(async () => response({ ok: true, rows: [] }))
  const result = await f.api.queryAcademic('fixture', credentials)
  assert.equal(result.rows.length, 0)
  assert.equal(result.grades.length, 0)
  assert.equal(result.exams.length, 0)
  assert.equal(f.jobs.size, 0)
  f.advance(100_000)
  assert.equal(f.requests[0].options.signal.aborted, false, 'settled responses must cancel their deadline')

  const gradesOnly = fixture(async () => response({ ok: true, grades: [] }))
  assert.equal((await gradesOnly.api.queryAcademic('fixture', credentials, ['grades'])).rows.length, 0)
  const auto = fixture(async () => response({ ok: true, rows: [], grades: [], exams: [] }))
  assert.equal((await auto.api.autoQueryAcademic(credentials)).auto, true)
  assert.equal((await f.api.queryAcademic('fixture', credentials, [])).rows.length, 0)
  assert.equal((await auto.api.autoQueryAcademic(credentials, [])).auto, true)
  const missingDefault = fixture(async () => response({ ok: true }))
  await assert.rejects(missingDefault.api.queryAcademic('fixture', credentials, []), rejectedCode('1006'))
})

test('valid populated arrays and partial grade/exam failures preserve their API contract', async () => {
  const populated = fixture(async () => response({ ok: true, rows: [course], grades: [grade], exams: [exam] }))
  const all = await populated.api.autoQueryAcademic(credentials)
  assert.equal(all.rows.length, 1)
  assert.equal(all.grades.length, 1)
  assert.equal(all.exams.length, 1)
  for (const invoke of [
    (api) => api.queryAcademic('fixture', credentials, ['schedule', 'grades', 'exams']),
    (api) => api.autoQueryAcademic(credentials),
  ]) {
    const partial = fixture(async () => response({ ok: true, rows: [course], grades: [], exams: [], grades_error: 'fixture grades failed', exams_error: 'fixture exams failed' }))
    const result = await invoke(partial.api)
    assert.equal(result.rows.length, 1)
    assert.equal(result.grades_error, 'fixture grades failed')
    assert.equal(result.exams_error, 'fixture exams failed')
  }
  const omittedPartial = fixture(async () => response({ ok: true, rows: [], grades_error: 'fixture grades failed', exams_error: 'fixture exams failed' }))
  const result = await omittedPartial.api.autoQueryAcademic(credentials)
  assert.equal(result.grades.length, 0)
  assert.equal(result.exams.length, 0)
})

test('captcha fields must be nonempty strings rather than truthy malformed values', async () => {
  for (const data of [null, { ok: true, sid: 1, image: 'fixture' }, { ok: true, sid: 'fixture', image: {} }]) {
    const f = fixture(async () => response(data))
    await assert.rejects(f.api.fetchCaptcha(), rejectedCode('1006'))
  }
  const f = fixture(async () => response({ ok: true, sid: 'fixture', image: 'data:image/png;base64,fixture' }))
  assert.equal((await f.api.fetchCaptcha()).sid, 'fixture')
})
