import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const compile = file => ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText
function load(code, dependencies = {}, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, ...globals, require: key => { if (key in dependencies) return dependencies[key]; throw Error(`Unexpected dependency: ${key}`) } })
  return module.exports
}
const password = load(compile('src/lib/password-setup.ts'))
const session = load(compile('src/lib/auth-session.ts'))
const providerCode = compile('src/lib/auth.tsx')

function fixture({ allowProfileWrites = false } = {}) {
  let uid = 'A', revision = 0, cursor = 0
  const calls = { userWrites: 0, profileWrites: 0, profilePayloads: [], verified: [], reads: 0 }
  let verify = async args => { calls.verified.push(args); return {} }
  const user = { uid: 'A', nickname: '中文昵称', phone: '13900000000', hasPassword: false, isAnonymous: false }
  const hooks = ['signed', user, { username: '中文昵称', building: '已保存楼栋', college: 'wenfa', realName: '测试同学', studentId: '0000000000', grade: '大二', major: '测试专业' }]
  const auth = {
    getSession: async () => { calls.reads++; return { data: { session: { user: { id: uid, phone: '13900000000', user_metadata: { username: 'legacy_login', nickname: '中文昵称' } } } } } },
    signOut: async () => {},
    signInWithOtp: async () => ({ data: { verifyOtp: async () => ({}) } }),
    reauthenticate: async () => ({ data: { updateUser: args => verify(args) } }),
    updateUser: async () => { calls.userWrites++; throw Error('Password setup must not change username/nickname') },
  }
  const query = { select() { return this }, eq() { return this }, limit: async () => ({ data: [{ username: '中文昵称', building: '已保存楼栋', college: 'wenfa', real_name: '测试同学', student_id: '0000000000', grade: '大二', major: '测试专业' }] }), upsert: async row => { calls.profileWrites++; calls.profilePayloads.push(row); if (allowProfileWrites) return {}; throw Error('Password setup must not change profile') } }
  const node = (type, props) => ({ type, props })
  const react = {
    createContext: () => ({ Provider: 'provider' }), useContext: () => null,
    useState(initial) { const slot = cursor++; if (!(slot in hooks)) hooks[slot] = typeof initial === 'function' ? initial() : initial; return [hooks[slot], next => { hooks[slot] = typeof next === 'function' ? next(hooks[slot]) : next }] },
    useRef(initial) { const slot = cursor++; return hooks[slot] ||= { current: initial } },
    useCallback: fn => fn, useEffect: () => {},
  }
  const api = load(providerCode, { react, 'react/jsx-runtime': { jsx: node, jsxs: node },
    './cb': { cbAuth: () => auth, cbRdb: () => ({ from: () => query }) }, './auth-session': session,
    './qbank': { captureQbankSession: () => ({ uid, revision }), isQbankSessionCurrent: captured => captured.uid === uid && captured.revision === revision, setQbankUid: next => { if ((next || '') !== uid) { uid = next || ''; revision++ } } },
    './password-setup': password, './im-session': { selectImSession: () => {} }, './boot': { markBootReady: () => {} }, './app-icon': { resetLauncherMoodForAccountChange: async () => {} }, './toast': { toast: { err() {}, warn() {} } },
    /* 学号本机身份改造引入的依赖：本测试走云端（admin 壳）路径，全部给只读桩 */
    './app-shell': { getAppShell: () => 'admin' },
    './local-identity': { LOCAL_IDENTITY_EVENT: 'ohu.local-identity.v1', loadLocalIdentity: () => null, clearLocalIdentity: () => {} },
    './local-profile': { readLocalProfile: () => null, saveLocalProfile: () => false },
    './cloud-identity': { clearCloudIdentity: () => {}, cloudIdentityStudentId: () => '', cloudIdentityUid: () => '', ensureCloudIdentity: async () => false },
  }, { window: { dispatchEvent() {} }, Event: class {}, CustomEvent: class {}, setTimeout })
  const render = () => { cursor = 0; return api.AuthProvider({ children: null }).props.value }
  return { render, calls, setVerify: fn => { verify = fn }, switch: next => { uid = next; revision++ } }
}

test('a successful OTP registration goes straight into the app without opening credential/profile forms', async () => {
  const f = fixture()
  assert.equal(await f.render().sendPhoneCode('13900000000'), null)
  assert.equal(await f.render().submitPhoneCode('000000'), null)
  assert.equal(f.render().credOpen, false)
  assert.equal(f.render().profileOpen, false)
  assert.equal(f.render().user.nickname, '中文昵称')
})

test('password setup sends only password and code, never SDK username or academic profile writes', async () => {
  const f = fixture()
  assert.equal(await f.render().sendCredCode(), null)
  assert.equal(await f.render().saveCredentials({ password: 'synthetic-password', code: '000000' }), null)
  assert.equal(f.calls.userWrites, 0)
  assert.equal(f.calls.profileWrites, 0)
  assert.equal(f.calls.verified.length, 1)
  assert.equal(f.calls.verified[0].nonce, '000000')
  assert.equal(Object.keys(f.calls.verified[0]).sort().join(','), 'nonce,password')
  assert.equal(f.render().profile.building, '已保存楼栋')
  assert.equal(f.render().user.hasPassword, true)
})

test('invalid or unrequested password operations do not invoke the verification callback', async () => {
  const f = fixture()
  assert.match(await f.render().saveCredentials({ password: 'synthetic-password', code: '000000' }), /先获取/)
  await f.render().sendCredCode()
  assert.match(await f.render().saveCredentials({ password: '123', code: '000000' }), /至少/)
  assert.match(await f.render().saveCredentials({ password: 'synthetic-password', code: 'bad-code' }), /6 位/)
  assert.equal(f.calls.verified.length, 0)
})

test('changing a nickname keeps every previously saved optional profile field', async () => {
  const f = fixture({ allowProfileWrites: true })
  await f.render().sendPhoneCode('13900000000')
  await f.render().submitPhoneCode('000000')
  assert.equal(await f.render().rename('新昵称'), null)
  const row = f.calls.profilePayloads[0]
  for (const [key, expected] of Object.entries({ username: '新昵称', building: '已保存楼栋', real_name: '测试同学', student_id: '0000000000', grade: '大二', major: '测试专业', college: 'wenfa' })) assert.equal(row[key], expected, key)
  assert.equal(f.render().profile.studentId, '0000000000')
})

test('switching accounts invalidates the held password verification', async () => {
  const f = fixture()
  await f.render().sendCredCode()
  f.switch('B')
  assert.match(await f.render().saveCredentials({ password: 'synthetic-password', code: '000000' }), /账号已切换/)
  assert.equal(f.calls.verified.length, 0)
})

test('a late password response does not refresh or mutate the replacement account', async () => {
  const f = fixture()
  let finish
  f.setVerify(() => new Promise(resolve => { finish = resolve }))
  await f.render().sendCredCode()
  const pending = f.render().saveCredentials({ password: 'synthetic-password', code: '000000' })
  f.switch('B'); finish({})
  assert.match(await pending, /账号已切换/)
  assert.equal(f.calls.reads, 0)
})

test('SDK internals and username regex are replaced with actionable short messages', () => {
  const message = password.passwordSetupMessage('invalid EditUserBasicInfoRequest.Username: does not match regex ^[a-z]')
  assert.doesNotMatch(message, /Request|regex|\^/)
  assert.match(message, /昵称无需修改/)
  assert.match(password.passwordSetupMessage('验证码错误'), /重新获取/)
})

test('optional profile details start collapsed and expose six dropdowns without requiring personal fields', () => {
  const node = (type, props) => ({ type, props })
  const mod = load(compile('src/components/OptionalProfileFields.tsx'), { react: { useState: value => [value, () => {}] }, 'react/jsx-runtime': { jsx: node, jsxs: node }, '../lib/college-group': { GRADES: ['大一', '大二'], COLLEGE_OPTIONS: [{ key: 'wenfa', name: '文法学院' }] }, './optional-profile-fields.module.css': { default: {} } })
  const tree = mod.OptionalProfileFields({ value: { building: '', realName: '', studentId: '', grade: '', major: '', college: '' }, onChange() {} })
  assert.equal(tree.type, 'details')
  assert.notEqual(tree.props.open, true)
  const all = value => {
    if (!value || typeof value !== 'object') return []
    if (typeof value.type === 'function') return all(value.type(value.props))
    return [value, ...[value.props?.children].flat(Infinity).flatMap(all)]
  }
  const nodes = all(tree)
  assert.equal(nodes.filter(value => value.type === 'select').length, 6)
  assert.equal(nodes.filter(value => value.type === 'input').length, 0)
  assert.ok(nodes.filter(value => value.type === 'select').every(value => !value.props.required))
})
