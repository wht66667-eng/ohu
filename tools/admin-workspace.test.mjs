import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
const compile = (path) => ts.transpileModule(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText
const jsx = (type, props, key) => ({ type, props: props || {}, key })
const walk = (value) => Array.isArray(value) ? value.flatMap(walk) : value && typeof value === 'object' ? [value, ...walk(value.props?.children)] : []
const text = (value) => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : typeof value === 'string' || typeof value === 'number' ? String(value) : ''
const privatePage = jsx('private-page', { children: 'private business content' })
const flush = () => new Promise(setImmediate)

/** Execute the real workspace component with synthetic accounts; no SDK or remote data. */
function workspace(options = {}) {
  let auth = { phase: 'signed', isSigned: true, user: { uid: 'account-A', nickname: '运营同学' }, profile: { username: '运营同学', isAdmin: true }, ...options }
  const calls = { login: [], logout: 0, reload: 0 }
  auth.openLogin = (reason) => calls.login.push(reason)
  auth.logout = async () => { calls.logout++; await options.logout?.() }
  const location = { pathname: '/admin/content' }
  const events = new Map()
  let cursor = 0
  let tree
  const slots = []
  const hooks = {
    Component: class {},
    useState(initial) {
      const index = cursor++
      slots[index] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [slots[index].value, (next) => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next }]
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial } },
    useEffect(effect, deps) {
      const index = cursor++
      if (slots[index] && deps && deps.every((value, offset) => Object.is(value, slots[index].deps[offset]))) return
      slots[index]?.cleanup?.()
      slots[index] = { deps, cleanup: effect() }
    },
  }
  const navigationModule = { exports: {} }
  vm.runInNewContext(compile('src/lib/admin-navigation.ts'), { module: navigationModule, exports: navigationModule.exports })
  const imports = {
    react: hooks,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-router-dom': { Link: 'link', useLocation: () => location },
    '../context/ToastContext': { ToastProvider: 'toast-provider' },
    '../lib/auth': { useAuth: () => auth },
    '../lib/auth-ui': { AuthSheets: 'auth-sheets' },
    '../lib/admin-navigation': navigationModule.exports,
    '../lib/toast': { Toaster: 'toaster' },
    './ui/StateViews': { DeniedState: 'denied-state', ErrorState: 'error-state', LoadingState: 'loading-state' },
    './AdminWorkspace.module.css': { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) },
  }
  const module = { exports: {} }
  vm.runInNewContext(compile('src/components/AdminWorkspace.tsx'), {
    module, exports: module.exports, Error, document: { title: '哦狐' },
    window: { location: { reload() { calls.reload++ } }, addEventListener(name, callback) { events.set(name, callback) }, removeEventListener(name) { events.delete(name) } },
    require(name) { if (Object.hasOwn(imports, name)) return imports[name]; throw new Error(`Unexpected dependency: ${name}`) },
  })
  const render = () => { cursor = 0; tree = module.exports.AdminWorkspace({ children: privatePage }); return tree }
  render()
  return { calls, render, events, location,
    setAuth(next) { auth = { ...auth, ...next } },
    text: () => text(tree), nodes: () => walk(tree),
    button(label) { return walk(tree).find((node) => node.type === 'button' && text(node) === label) },
    hasPrivatePage: () => walk(tree).some((node) => node.type === 'private-page'),
  }
}

test('private management pages do not mount during recovery, guest, unknown or denied permissions', () => {
  const cases = [
    { phase: 'booting', isSigned: false, profile: null },
    { phase: 'guest', isSigned: false, user: null, profile: null },
    { profile: null },
    { profile: { isAdmin: false, isSuperAdmin: false } },
  ]
  for (const account of cases) assert.equal(workspace(account).hasPrivatePage(), false)
  const guest = workspace(cases[1])
  guest.button('登录管理后台 →').props.onClick()
  assert.equal(guest.calls.login.length, 1)
})

test('both administrator levels retain the complete management navigation', () => {
  for (const profile of [{ isAdmin: true }, { isAdmin: false, isSuperAdmin: true }]) {
    const admin = workspace({ profile })
    assert.equal(admin.hasPrivatePage(), true)
    assert.deepEqual(admin.nodes().filter((node) => node.type === 'link' && node.props.to !== '/admin').map((node) => node.props.to), [
      '/admin/content', '/admin/news', '/admin/reports', '/admin/members', '/admin/messages', '/admin/settings',
    ])
  }
})

test('logout ignores repeated activation while pending and exposes a real failure', async () => {
  let reject
  const pending = new Promise((_, fail) => { reject = fail })
  const admin = workspace({ logout: () => pending })
  admin.button('退出').props.onClick()
  admin.button('退出').props.onClick()
  assert.equal(admin.calls.logout, 1)
  admin.render()
  assert.equal(admin.button('退出中').props.disabled, true)
  reject(new Error('网络不可用'))
  await flush()
  admin.render()
  assert.match(admin.text(), /网络不可用/)
  assert.ok(admin.button('重试退出'))
})

test('late logout failures do not appear for a different signed account', async () => {
  let reject
  const pending = new Promise((_, fail) => { reject = fail })
  const admin = workspace({ logout: () => pending })
  admin.button('退出').props.onClick()
  admin.setAuth({ user: { uid: 'account-B' } })
  admin.render()
  reject(new Error('account-A failure'))
  await flush()
  admin.render()
  assert.doesNotMatch(admin.text(), /account-A failure/)
})

test('narrow browser menu closes with Escape and does not persist across routes', () => {
  const admin = workspace()
  admin.button('导航').props.onClick()
  admin.render()
  assert.equal(admin.button('收起').props['aria-expanded'], true)
  admin.events.get('keydown')({ key: 'Escape', preventDefault() {} })
  admin.render()
  assert.equal(admin.button('导航').props['aria-expanded'], false)
  admin.button('导航').props.onClick()
  admin.render()
  admin.location.pathname = '/admin/news'
  admin.render()
  assert.equal(admin.button('导航').props['aria-expanded'], false)
})
