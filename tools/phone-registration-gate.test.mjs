import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

/**
 * 学生端开屏门禁（单账号框 + 密码框）行为测试。
 *
 * 登录页现在只有一个账号框（手机号 / 邮箱自适应）+ 一个密码框，
 * 验证码只在「注册」和「忘记密码」两个视图出现——所以测试重点变成：
 *   ① 登录视图走 loginWithPassword，全程不发短信也不发邮件
 *   ② 注册 / 重置视图按账号形态自动分流到短信或邮件
 *   ③ 「记住账号」只写账号字符串，且能取消
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(`${root}/package.json`)('typescript')
const source = ts.transpileModule(fs.readFileSync(`${root}/src/components/PhoneRegistrationGate.tsx`, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate) }

/** 极简 localStorage 桩，供「记住账号」读写 */
function makeStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
    _dump: () => Object.fromEntries(map),
  }
}

function fixture(opts = {}) {
  /* 邮箱开关默认按「已打开」跑，覆盖邮箱通路；另有单独用例测关闭时的拦截 */
  const emailLogin = opts.emailLogin !== false
  const flags = {
    EMAIL_LOGIN: emailLogin,
    ACCOUNT_PLACEHOLDER: emailLogin ? '手机号或邮箱' : '手机号',
    ACCOUNT_LABEL: emailLogin ? '账号（手机号 / 邮箱）' : '账号（手机号）',
    EMAIL_DISABLED_HINT: '暂未开放邮箱登录，请先用手机号',
    ACCOUNT_INVALID_HINT: emailLogin ? '请输入正确的手机号或邮箱' : '请输入正确的手机号',
  }
  const hooks = [], cleanups = []
  let cursor = 0
  const calls = { sendPhone: 0, submitPhone: 0, sendEmail: 0, submitEmail: 0, loginPwd: 0, unlock: 0 }
  let sendPhoneCode = async () => { calls.sendPhone++; return null }
  let submitPhoneCode = async () => { calls.submitPhone++; return null }
  let sendEmailCode = async () => { calls.sendEmail++; return null }
  let submitEmailCode = async () => { calls.submitEmail++; return null }
  let loginWithPassword = async () => { calls.loginPwd++; return null }
  const node = (type, props) => ({ type, props })
  /** 密码框桩：保留 props，测试里可直接触发 onChange 写入密码 */
  const PasswordInput = function PasswordInput() {}
  const storage = makeStorage()
  const react = {
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial; return [hooks[i], (next) => { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next }] },
    useRef(initial) { const i = cursor++; return hooks[i] ||= { current: initial } },
    useEffect(effect) { const i = cursor++; if (!(i in hooks)) { hooks[i] = true; cleanups.push(effect()) } },
  }
  const mocks = {
    react, 'react/jsx-runtime': { jsx: node, jsxs: node },
    'motion/react': { motion: { div: 'div' }, useReducedMotion: () => true },
    './PasswordInput': { PasswordInput },
    './fox/FoxRequestIndicator': { FoxRequestIndicator: 'request-indicator' },
    '../lib/auth': {
      useAuth: () => ({
        sendPhoneCode: async (p) => sendPhoneCode(p),
        submitPhoneCode: async (c) => submitPhoneCode(c),
        sendEmailCode: async (m) => sendEmailCode(m),
        submitEmailCode: async (c) => submitEmailCode(c),
        loginWithPassword: async (a, p) => loginWithPassword(a, p),
      }),
    },
    '../lib/motion-pref': { enterMotion: () => ({}) },
    '../lib/feature-flags': flags,
    './CampusGate.module.css': { default: new Proxy({}, { get: (_, name) => String(name) }) },
  }
  const module = { exports: {} }
  vm.runInNewContext(source, {
    module, exports: module.exports, localStorage: storage,
    require: (id) => { assert.ok(id in mocks, `unexpected dependency ${id}`); return mocks[id] },
  })
  const render = () => { cursor = 0; return module.exports.PhoneRegistrationGate({ onUnlocked: () => calls.unlock++ }) }
  const all = (tree) => [tree, ...[].concat(tree?.props?.children || []).flat(Infinity).filter(Boolean).flatMap((child) => typeof child === 'object' ? all(child) : [child])]
  const text = (tree) => all(tree).filter((value) => typeof value === 'string').join(' ')
  const button = (label) => all(render()).find((item) => item?.type === 'button' && text(item).includes(label))
  const input = (placeholder) => all(render()).find((item) => item?.type === 'input' && item.props.placeholder === placeholder)
  const form = () => all(render()).find((item) => item?.type === 'form')
  const pwdField = () => all(render()).find((item) => item?.type === PasswordInput)
  const checkbox = () => all(render()).find((item) => item?.type === 'input' && item.props.type === 'checkbox')
  const alert = () => all(render()).find((item) => item?.type === 'p' && item.props.role === 'alert')
  return {
    calls, render, text, button, input, form, all, PasswordInput, pwdField, checkbox, alert, storage, flags,
    setSendPhone: (fn) => { sendPhoneCode = fn },
    setSubmitPhone: (fn) => { submitPhoneCode = fn },
    setSendEmail: (fn) => { sendEmailCode = fn },
    setSubmitEmail: (fn) => { submitEmailCode = fn },
    setLoginPwd: (fn) => { loginWithPassword = fn },
    dispose: () => cleanups.forEach((cleanup) => cleanup?.()),
  }
}
const submit = (form) => form.props.onSubmit({ preventDefault() {} })
const ACCOUNT = '手机号或邮箱'

test('默认是账号 + 密码登录视图：有密码框与记住账号，没有验证码框', () => {
  const f = fixture()
  const rendered = f.render()
  assert.ok(f.input(ACCOUNT), '应有统一账号框')
  assert.ok(f.pwdField(), '登录视图应有密码框')
  assert.ok(f.checkbox(), '应有记住账号复选框')
  assert.equal(f.button('获取验证码'), undefined, '登录视图不该出现验证码入口')
  assert.match(f.text(rendered), /没有账号/)
})

test('登录只走 loginWithPassword，全程不发短信也不发邮件', async () => {
  const f = fixture()
  let seen = 0, seenAccount = ''
  f.setLoginPwd(async (acc) => { seen++; seenAccount = acc; return null })
  f.input(ACCOUNT).props.onChange({ target: { value: 'me@campus.edu.cn' } })
  f.pwdField().props.onChange({ target: { value: 'secret123' } })
  await submit(f.form())
  await flush()
  assert.equal(seen, 1, '必须真的打到 loginWithPassword')
  assert.equal(seenAccount, 'me@campus.edu.cn', '邮箱账号也要走同一个密码登录接口')
  assert.equal(f.calls.sendPhone, 0)
  assert.equal(f.calls.sendEmail, 0)
  assert.equal(f.calls.unlock, 1)
})

test('账号或密码为空时不提交，错误内联展示', async () => {
  const f = fixture()
  f.pwdField().props.onChange({ target: { value: 'secret123' } })
  await submit(f.form())
  await flush()
  assert.equal(f.calls.loginPwd, 0)
  assert.ok(f.alert(), '应内联展示错误（role=alert）')
})

test('登录失败不放行，错误直出', async () => {
  const f = fixture()
  f.setLoginPwd(async () => '账号或密码错误')
  f.input(ACCOUNT).props.onChange({ target: { value: '13900139000' } })
  f.pwdField().props.onChange({ target: { value: 'bad' } })
  await submit(f.form())
  await flush()
  assert.equal(f.calls.unlock, 0)
  assert.match(f.text(f.alert()), /账号或密码错误/)
})

test('点「去注册」切到验证码视图：没有密码框，账号框仍共用', () => {
  const f = fixture()
  f.button('去注册').props.onClick()
  const rendered = f.render()
  assert.ok(f.input(ACCOUNT), '注册视图复用同一个账号框')
  assert.ok(f.button('获取验证码'))
  assert.equal(f.pwdField(), undefined, '注册视图不该出现密码框')
  assert.match(f.text(rendered), /已有账号/)
})

test('注册时填手机号走短信通道，不发邮件', async () => {
  const f = fixture()
  f.button('去注册').props.onClick()
  f.input(ACCOUNT).props.onChange({ target: { value: '13900139000' } })
  f.button('获取验证码').props.onClick()
  await flush()
  assert.equal(f.calls.sendPhone, 1)
  assert.equal(f.calls.sendEmail, 0)
  assert.ok(f.input('短信里的验证码'), '应出现短信验证码框')
})

test('注册时填邮箱走邮件通道，不发短信', async () => {
  const f = fixture()
  f.button('去注册').props.onClick()
  f.input(ACCOUNT).props.onChange({ target: { value: 'me@campus.edu.cn' } })
  f.button('获取验证码').props.onClick()
  await flush()
  assert.equal(f.calls.sendEmail, 1)
  assert.equal(f.calls.sendPhone, 0)
  assert.ok(f.input('邮箱里的验证码'), '应出现邮箱验证码框')
})

test('账号既不是手机号也不是邮箱时不发码，错误内联展示', async () => {
  const f = fixture()
  f.button('去注册').props.onClick()
  f.input(ACCOUNT).props.onChange({ target: { value: 'not-an-account' } })
  f.button('获取验证码').props.onClick()
  await flush()
  assert.equal(f.calls.sendPhone, 0)
  assert.equal(f.calls.sendEmail, 0)
  assert.match(f.text(f.alert()), /手机号或邮箱/)
})

test('验证码提交成功即放行（手机号）', async () => {
  const f = fixture()
  f.button('去注册').props.onClick()
  f.input(ACCOUNT).props.onChange({ target: { value: '13900139000' } })
  f.button('获取验证码').props.onClick()
  await flush()
  f.input('短信里的验证码').props.onChange({ target: { value: '123456' } })
  await submit(f.form())
  await flush()
  assert.equal(f.calls.submitPhone, 1)
  assert.equal(f.calls.submitEmail, 0)
  assert.equal(f.calls.unlock, 1)
})

test('服务端未开通邮箱验证码时，错误直出并给出换手机号的出口', async () => {
  const f = fixture()
  let seen = 0
  f.setSendEmail(async () => { seen++; return 'provider email not found（invalid_env）' })
  f.button('去注册').props.onClick()
  f.input(ACCOUNT).props.onChange({ target: { value: 'me@campus.edu.cn' } })
  f.button('获取验证码').props.onClick()
  await flush()
  assert.equal(seen, 1, '拒绝原因必须来自真实调用')
  assert.match(f.text(f.alert()), /email not found/)
  assert.ok(f.button('换用手机号注册'), '未开通时要给出出口，别让用户在死路上重发')
})

test('「记住账号」登录成功后写入本地，取消勾选则清除', async () => {
  const f = fixture()
  f.input(ACCOUNT).props.onChange({ target: { value: '13900139000' } })
  f.pwdField().props.onChange({ target: { value: 'secret123' } })
  /* 默认未勾选（本地无记录）→ 登录成功后不写 */
  await submit(f.form())
  await flush()
  assert.equal(f.storage.getItem('ohhu-remember-account'), null, '未勾选时不应记住账号')

  /* 勾选后再登录 → 写入账号字符串，且不写密码 */
  f.checkbox().props.onChange({ target: { checked: true } })
  await submit(f.form())
  await flush()
  assert.equal(f.storage.getItem('ohhu-remember-account'), '13900139000')
  assert.equal(
    Object.values(f.storage._dump()).some((v) => v === 'secret123'),
    false,
    '密码绝不能落到本地存储',
  )

  /* 取消勾选 → 立刻清除 */
  f.checkbox().props.onChange({ target: { checked: false } })
  assert.equal(f.storage.getItem('ohhu-remember-account'), null)
})

/* ---------- 邮箱开关（EMAIL_LOGIN）两侧都要测 ---------- */

test('开关关闭时账号框只提示手机号，不再提邮箱', () => {
  const f = fixture({ emailLogin: false })
  assert.ok(f.input('手机号'), '开关关着时占位文案只写手机号')
  assert.equal(f.input('手机号或邮箱'), undefined, '不该再引导用户填邮箱')
  assert.doesNotMatch(f.text(f.render()), /手机号或邮箱/)
  assert.match(f.text(f.render()), /用手机号加密码登录/)
})

test('开关关闭时填邮箱点「获取验证码」：一条都不发，直出提示并给出口', async () => {
  const f = fixture({ emailLogin: false })
  f.button('去注册').props.onClick()
  f.input('手机号').props.onChange({ target: { value: 'me@campus.edu.cn' } })
  f.button('获取验证码').props.onClick()
  await flush()
  assert.equal(f.calls.sendEmail, 0, '开关关着绝不能碰邮件通道')
  assert.equal(f.calls.sendPhone, 0)
  assert.match(f.text(f.alert()), /暂未开放邮箱登录/)
  assert.ok(f.button('换用手机号注册'), '要给出换手机号的出口')
})

test('开关关闭时填邮箱登录：连登录请求都不发', async () => {
  const f = fixture({ emailLogin: false })
  let seen = 0
  f.setLoginPwd(async () => { seen++; return null })
  f.input('手机号').props.onChange({ target: { value: 'me@campus.edu.cn' } })
  f.pwdField().props.onChange({ target: { value: 'secret123' } })
  await submit(f.form())
  await flush()
  assert.equal(seen, 0, '邮箱登录被开关挡住，不该打到后端')
  assert.match(f.text(f.alert()), /暂未开放邮箱登录/)
  assert.equal(f.calls.unlock, 0)
})

test('开关关闭不影响手机号主路径：注册发短信、登录走密码', async () => {
  const f = fixture({ emailLogin: false })
  f.button('去注册').props.onClick()
  f.input('手机号').props.onChange({ target: { value: '13900139000' } })
  f.button('获取验证码').props.onClick()
  await flush()
  assert.equal(f.calls.sendPhone, 1)
  assert.equal(f.calls.sendEmail, 0)
  assert.ok(f.input('短信里的验证码'))

  f.button('去登录').props.onClick()
  let seen = 0
  f.setLoginPwd(async () => { seen++; return null })
  f.pwdField().props.onChange({ target: { value: 'secret123' } })
  await submit(f.form())
  await flush()
  assert.equal(seen, 1, '手机号 + 密码登录必须照常可用')
  assert.equal(f.calls.unlock, 1)
})
