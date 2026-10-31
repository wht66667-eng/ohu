/** Production credential storage and identity store against synthetic accounts only. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import { createRequire } from 'node:module'
const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
function fixture() {
  const values = new Map(), flags = { writeFail: false, randomFail: false }
  const localStorage = { getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key), setItem: (key, value) => {
    if (flags.writeFail) throw Error('synthetic quota failure')
    values.set(key, value)
  } }
  const load = (file, deps) => {
    const module = { exports: {} }
    const code = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    vm.runInNewContext(code, { module, exports: module.exports, localStorage, atob, btoa, TextEncoder, TextDecoder,
      crypto: { getRandomValues: value => { if (flags.randomFail) throw Error('synthetic crypto unavailable'); return webcrypto.getRandomValues(value) } },
      require: name => { if (Object.hasOwn(deps, name)) return deps[name]; throw Error(`Unexpected ${name}`) },
    })
    return module.exports
  }
  const qbank = load('src/lib/qbank.ts', { './cb': {} })
  const secret = load('src/lib/credential-storage.ts', {})
  const store = load('src/lib/campus-credential-store.ts', { './qbank': qbank })
  const schedule = load('src/lib/schedule-credentials.ts', { './credential-storage': secret, './campus-credential-store': store })
  const campus = load('src/lib/campus-account.ts', { './credential-storage': secret, './campus-credential-store': store, './schedule-credentials': schedule })
  return { values, flags, qbank, schedule, campus, switchUid: uid => qbank.setQbankUid(uid) }
}
const plain = value => JSON.parse(JSON.stringify(value))
const account = suffix => ({ stuid: `synthetic-${suffix}`, jwPassword: `school-${suffix}`, vpnPassword: `vpn-${suffix}`, remember: true })
const empty = { stuid: '', jwPassword: '', vpnPassword: '', remember: false }

test('unowned v1/v2 credentials are retained byte-for-byte and never claimed by a guest or first login', () => {
  const f = fixture()
  for (const [key, value] of Object.entries({ 'schedule.lastStuid': 'unowned-id', 'schedule.rememberPwd': '1',
    'schedule.pwdBlob.v1': 'unowned-v1', 'schedule.pwdBlob.v2': 'unowned-v2',
    'campus.vpnPwdBlob.v1': 'vpn-v1', 'campus.vpnPwdBlob.v2': 'vpn-v2', 'campus.rememberAll.v1': '1' })) f.values.set(key, value)
  const original = [...f.values]
  for (const uid of ['', 'A', 'B', 'A', '']) {
    f.switchUid(uid)
    assert.deepEqual(plain(f.campus.loadCampusAccount()), empty)
    assert.equal(f.schedule.hasUnboundCampusCredentials(), true)
    assert.equal(f.schedule.loadSavedPassword(), '')
    assert.equal(f.schedule.isRememberPasswordEnabled(), false)
  }
  assert.deepEqual([...f.values], original)
})

test('school and VPN credentials follow the real App owner through A to B to A and logout', () => {
  const f = fixture()
  f.switchUid('A'); assert.equal(f.campus.saveCampusAccount(account('A')), true)
  f.switchUid('B'); assert.deepEqual(plain(f.campus.loadCampusAccount()), empty)
  assert.equal(f.campus.saveCampusAccount(account('B')), true)
  f.switchUid(''); assert.deepEqual(plain(f.campus.loadCampusAccount()), empty)
  f.switchUid('A'); assert.deepEqual(plain(f.campus.loadCampusAccount()), account('A'))
  f.switchUid('B'); assert.deepEqual(plain(f.campus.loadCampusAccount()), account('B'))
  assert.equal([...f.values.values()].some(value => value.includes('school-A') || value.includes('vpn-A')), false)
})

test('guest writes and clear cannot save secrets or erase a signed owner', () => {
  const f = fixture()
  f.switchUid('A'); f.campus.saveCampusAccount(account('A'))
  f.switchUid(''); const original = [...f.values]
  assert.equal(f.campus.saveCampusAccount(account('guest')), false)
  assert.equal(f.schedule.saveTimetableCredentials({ stuid: 'guest', password: 'guest', rememberStuid: true, rememberPassword: true }), false)
  assert.equal(f.schedule.clearSavedPassword(), false)
  assert.deepEqual([...f.values], original)
  f.switchUid('A'); assert.deepEqual(plain(f.campus.loadCampusAccount()), account('A'))
})

test('captured stale sessions cannot read, save or clear after B or a same-UID replacement session', () => {
  const f = fixture()
  f.switchUid('A'); f.campus.saveCampusAccount(account('A'))
  const old = f.qbank.captureQbankSession()
  f.switchUid('B'); f.campus.saveCampusAccount(account('B')); f.switchUid('A')
  const original = [...f.values]
  assert.equal(f.campus.saveCampusAccount(account('late'), old), false)
  assert.equal(f.schedule.saveTimetableCredentials({ stuid: 'late', password: 'late', rememberStuid: true, rememberPassword: true }, old), false)
  assert.equal(f.schedule.clearSavedPassword(old), false)
  assert.equal(f.schedule.loadSavedStuid(old), '')
  assert.equal(f.schedule.loadSavedPassword(old), '')
  assert.deepEqual([...f.values], original)
})

test('unchecking remember clears both school and VPN secrets only for the selected owner', () => {
  const f = fixture()
  f.switchUid('A'); f.campus.saveCampusAccount(account('A'))
  f.switchUid('B'); f.campus.saveCampusAccount(account('B'))
  f.switchUid('A'); assert.equal(f.campus.saveCampusAccount({ ...account('A'), remember: false }), true)
  assert.deepEqual(plain(f.campus.loadCampusAccount()), { ...empty, stuid: 'synthetic-A' })
  f.switchUid('B'); assert.deepEqual(plain(f.campus.loadCampusAccount()), account('B'))
})

test('schedule-only remember choices are independent from the VPN preference', () => {
  const f = fixture(); f.switchUid('A'); f.campus.saveCampusAccount(account('A'))
  assert.equal(f.schedule.saveTimetableCredentials({ stuid: 'new-id', password: 'new-pwd', rememberStuid: false, rememberPassword: false }), true)
  assert.equal(f.schedule.loadSavedStuid(), '')
  assert.equal(f.schedule.loadSavedPassword(), '')
  assert.equal(f.campus.loadCampusAccount().vpnPassword, 'vpn-A')
  assert.equal(f.schedule.saveTimetableCredentials({ stuid: 'new-id', password: 'new-pwd', rememberStuid: true, rememberPassword: true }), true)
  assert.equal(f.schedule.loadSavedPassword(), 'new-pwd')
  assert.equal(f.schedule.clearSavedPassword(), true)
  assert.equal(f.schedule.loadSavedStuid(), 'new-id')
  assert.equal(f.schedule.loadSavedPassword(), '')
})

test('storage quota failures leave the previous whole account record unchanged and report failure', () => {
  const f = fixture(); f.switchUid('A'); f.campus.saveCampusAccount(account('A'))
  const original = [...f.values]; f.flags.writeFail = true
  assert.equal(f.campus.saveCampusAccount({ ...account('next'), remember: false }), false)
  assert.equal(f.schedule.saveTimetableCredentials({ stuid: 'next', password: 'next', rememberStuid: true, rememberPassword: true }), false)
  assert.equal(f.schedule.clearSavedPassword(), false)
  assert.deepEqual([...f.values], original)
  assert.deepEqual(plain(f.campus.loadCampusAccount()), account('A'))
})

test('a failed secret seal does not change flags, overwrite credentials or claim they were remembered', () => {
  const f = fixture(); f.switchUid('A'); f.campus.saveCampusAccount(account('A'))
  const original = [...f.values]; f.flags.randomFail = true
  assert.equal(f.campus.saveCampusAccount(account('next')), false)
  assert.equal(f.schedule.saveTimetableCredentials({ stuid: 'next', password: 'next', rememberStuid: true, rememberPassword: true }), false)
  assert.deepEqual([...f.values], original)
})
