import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = ts.transpileModule(readFileSync(new URL('../src/lib/campus-map-location.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
function fixture({ fallback = false, secure = true } = {}) {
  let ok, fail, options, timer, started = 0
  const cleared = [], progresses = []
  const geo = fallback ? {
    getCurrentPosition(onOk, onFail, value) { started++; ok = onOk; fail = onFail; options = value },
  } : {
    watchPosition(onOk, onFail, value) { started++; ok = onOk; fail = onFail; options = value; return 91 },
    clearWatch(id) { cleared.push(id) },
  }
  const module = { exports: {} }
  vm.runInNewContext(source, {
    module, exports: module.exports, navigator: { geolocation: geo }, isSecureContext: secure, Date,
    setTimeout(callback, ms) { assert.equal(ms, 15000); timer = callback; return 7 },
    clearTimeout(id) { assert.equal(id, 7); timer = undefined },
  })
  return {
    get: module.exports.getCurrentMapLocation, cleared, progresses,
    fix(accuracy, extra = {}) { ok({ coords: { longitude: 119.2, latitude: 34.6, accuracy, ...extra }, timestamp: Date.now() }) },
    stale() { ok({ coords: { longitude: 119.2, latitude: 34.6, accuracy: 8 }, timestamp: Date.now() - 120000 }) },
    error(code) { fail({ code }) }, expire() { assert.ok(timer, 'acquisition should still be pending'); timer() },
    get options() { return options }, get started() { return started }, get pendingTimer() { return !!timer },
  }
}

test('high accuracy watch refines a broad initial fix and releases GPS after a precise fix', async () => {
  const f = fixture(), progress = []
  const pending = f.get({ onProgress: value => progress.push(value) })
  f.fix(3500)
  assert.equal(progress.length, 0, 'a city-wide fix must not move the map as if it is a usable location')
  f.fix(280)
  f.fix(23)
  const result = await pending
  assert.equal(result.accuracy, 23)
  assert.equal(result.approximate, false)
  assert.equal(typeof result.timestamp, 'number')
  assert.deepEqual(progress.map(p => p.accuracy), [280, 23])
  assert.deepEqual(f.cleared, [91])
  assert.equal(f.pendingTimer, false)
  assert.equal(f.options.maximumAge, 0)
  assert.equal(f.options.enableHighAccuracy, true)
  assert.equal(f.options.timeout, 15000)
  f.fix(4)
  assert.equal(progress.length, 2, 'late native callbacks must not update a completed request')
})

test('bounded acquisition returns a usable approximate position with its real accuracy', async () => {
  const f = fixture(), pending = f.get()
  f.fix(240)
  f.fix(450)
  f.expire()
  const result = await pending
  assert.equal(result.accuracy, 240)
  assert.equal(result.approximate, true)
  assert.deepEqual(f.cleared, [91])
})

test('deadline rejects broad, stale, unknown-accuracy and absent fixes without pretending success', async () => {
  for (const [kind, expected] of [['broad', /大范围|精确位置/], ['stale', /过期/], ['invalid', /无效/], ['silent', /超时/]]) {
    const f = fixture(), pending = f.get()
    if (kind === 'broad') f.fix(5000)
    if (kind === 'stale') f.stale()
    if (kind === 'invalid') f.fix(NaN)
    f.expire()
    await assert.rejects(pending, expected)
    assert.deepEqual(f.cleared, [91])
  }
})

test('cancel clears watch and deadline and ignores late positions', async () => {
  const f = fixture(), controller = new AbortController(), progress = []
  const pending = f.get({ signal: controller.signal, onProgress: value => progress.push(value) })
  controller.abort()
  await assert.rejects(pending, error => error.name === 'AbortError')
  assert.deepEqual(f.cleared, [91])
  assert.equal(f.pendingTimer, false)
  f.fix(5)
  assert.equal(progress.length, 0)
  const stopped = fixture(), already = new AbortController(); already.abort()
  await assert.rejects(stopped.get({ signal: already.signal }), error => error.name === 'AbortError')
  assert.equal(stopped.started, 0)
})

test('legacy one-shot browsers stay compatible and invalid or insecure location is actionable', async () => {
  const good = fixture({ fallback: true }), pending = good.get()
  good.fix(31)
  assert.equal((await pending).lng, 119.2)
  assert.equal(good.pendingTimer, false)
  for (const [code, expected] of [[1, /权限/], [2, /定位服务/], [3, /超时/]]) {
    const f = fixture({ fallback: true }), request = f.get()
    f.error(code)
    await assert.rejects(request, expected)
  }
  const invalid = fixture({ fallback: true }), request = invalid.get()
  invalid.fix(2, { longitude: NaN })
  await assert.rejects(request, /无效/)
  const insecure = fixture({ secure: false })
  await assert.rejects(insecure.get(), /HTTPS|安全连接/)
  assert.equal(insecure.started, 0)
})

test('progress rendering failures cannot leak an active GPS watch', async () => {
  const f = fixture(), pending = f.get({ onProgress() { throw new Error('unmounted view') } })
  f.fix(15)
  assert.equal((await pending).accuracy, 15)
  assert.deepEqual(f.cleared, [91])
})
