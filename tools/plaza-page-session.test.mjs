/** Actual PlazaPage hooks with synthetic uploads, searches and posts; never contact a service. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
const compile = (path) => ts.transpileModule(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText
const pageSource = compile('src/pages/plaza/PlazaPage.tsx')
const flush = () => new Promise(setImmediate)
const deferred = () => {
  let resolve, reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const uploadResult = (name) => ({ error: null, urls: [`https://fixture.invalid/${name}.png`] })
const post = (id, body) => ({ id, body, tag: '吐槽', creator_uid: 'synthetic-peer', creator_name: '合成同学', media_urls: [], created_at: '2026-10-09T00:00:00Z', likes: 0, views: 0 })
const emptyRows = () => ({ rows: [], error: null })
const walk = (value) => Array.isArray(value) ? value.flatMap(walk) : value && typeof value === 'object' ? [value, ...walk(value.props?.children)] : []
const text = (value) => Array.isArray(value) ? value.map(text).join('') : typeof value === 'string' || typeof value === 'number' ? String(value) : value?.props ? text(value.props.children) : ''

function load(code, dependencies = {}) {
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: (name) => { if (Object.hasOwn(dependencies, name)) return dependencies[name]; throw new Error(`Unexpected dependency: ${name}`) },
  })
  return module.exports
}

function fixture(options = {}) {
  const asyncOwner = load(compile('src/lib/async-owner.ts'))
  const im = load(compile('src/lib/im-session.ts'), { './async-owner': asyncOwner })
  const keyboard = load(compile('src/lib/keyboard-viewport.ts'))
  let auth = { isSigned: true, user: { uid: 'synthetic-A', isAnonymous: false }, profile: { username: '合成同学' }, ensureSignedIn: async () => true }
  im.selectImSession(auth.user.uid)
  let searchParams = new URLSearchParams('tab=feed'), tree, cursor = 0, dirty = false, active = true, effects = []
  const slots = [], intervals = new Map(), notices = []
  let sequence = 0
  const calls = { upload: [], create: [], search: [], mirrorText: [], mirrorImage: [], feed: 0, hot: 0, staleWrites: 0 }
  const refreshTasks = new Set()
  let upload = options.upload || (async () => uploadResult('current'))
  let search = options.search || (async () => emptyRows())
  let create = options.create || (async () => ({ error: null, id: 77 }))
  let mirrorText = options.mirrorText || (async () => ({ error: null }))
  let mirrorImage = options.mirrorImage || (async () => ({ error: null }))
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  const hooks = {
    useState(initial) {
      const i = cursor++
      slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [slots[i].value, (value) => {
        if (!active) calls.staleWrites++
        const next = typeof value === 'function' ? value(slots[i].value) : value
        if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true }
      }]
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial } },
    useSyncExternalStore(subscribe, getSnapshot) {
      const i = cursor++
      slots[i] ??= { cleanup: subscribe(() => { dirty = true }) }
      return getSnapshot()
    },
    useCallback(fn, deps) {
      const i = cursor++
      if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: fn }
      return slots[i].value
    },
    useMemo(fn, deps) {
      const i = cursor++
      if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: fn() }
      return slots[i].value
    },
    useEffect(fn, deps) {
      const i = cursor++
      if (!slots[i] || !same(slots[i].deps, deps)) effects.push({ i, fn, deps })
    },
  }
  const noop = () => {}
  const setSearchParams = (next) => { searchParams = next; dirty = true }
  const toast = Object.assign((message) => notices.push({ kind: 'info', message }), {
    err: (message) => notices.push({ kind: 'error', message }),
    warn: (message) => notices.push({ kind: 'warning', message }),
    ok: (message) => notices.push({ kind: 'success', message }),
  })
  const window = new EventTarget(), document = new EventTarget()
  Object.assign(window, {
    setInterval: (fn) => { const id = ++sequence; intervals.set(id, fn); return id },
    clearInterval: (id) => intervals.delete(id), setTimeout: noop, clearTimeout: noop,
  })
  document.visibilityState = 'visible'
  function jsx(type, props, key) {
    const node = { type, props: props || {}, key }
    if (props?.ref) props.ref.current = { style: {}, scrollHeight: 40, scrollIntoView: noop, focus: noop, setSelectionRange: noop, selectionStart: 0, selectionEnd: 0 }
    return node
  }
  const plaza = {
    PLAZA_MSG_LIMIT: 80, PLAZA_POLL_MS: 4000, PLAZA_TAGS: ['吐槽', '交友', '帮忙'],
    fetchPlazaPosts: async () => { calls.feed++; return emptyRows() }, fetchPlazaMessages: async () => emptyRows(),
    fetchHotPosts: async () => { calls.hot++; return emptyRows() }, fetchTopLikedPosts: async () => emptyRows(),
    fetchLikedPostIds: async () => new Set(), incrPostView: async () => {}, fmtPlazaTime: () => '',
    deletePlazaPost: async () => ({ error: null }), togglePostLike: async () => ({ error: null, liked: true, likes: 1 }),
    searchPlazaPosts: async (keyword) => { calls.search.push(keyword); return search(keyword) },
    createPlazaPost: async (body, tag, uid, name, avatar, images) => {
      calls.create.push({ body, tag, uid, name, avatar, images: [...images] })
      return create(body, images)
    },
    sendPlazaMessage: async (body, uid) => { calls.mirrorText.push({ body, uid }); return mirrorText(body) },
    sendPlazaImage: async (url, uid) => { calls.mirrorImage.push({ url, uid }); return mirrorImage(url) },
  }
  const dependencies = {
    '../../components/HomeServiceIcon': { HomeServiceIcon: 'service-icon' },
    '../../components/fox/FoxSheetPose': { FoxSheetPose: 'fox-art' },
    '../../components/AnnouncementBanner': { AnnouncementBanner: 'announcement-banner' },
    '../../components/focus/FocusInteractions': { FocusThemeToggle: 'theme-toggle' },
    '../../lib/native': { onAppRefresh(task) { refreshTasks.add(task); return () => refreshTasks.delete(task) } },
    '../../lib/keyboard-viewport': keyboard,
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-router-dom': { useNavigate: () => noop, useSearchParams: () => [searchParams, setSearchParams] },
    '../../lib/auth': { useAuth: () => auth }, '../../lib/async-owner': asyncOwner, '../../lib/im-session': im,
    '../../context/ToastContext': { useToast: () => toast }, '../../data/images': { resolveAvatar: () => 'https://fixture.invalid/avatar.png' },
    '../../lib/plaza': plaza,
    '../../lib/market': { uploadImages: async (files, dir) => { calls.upload.push({ files, dir }); return upload(files, dir) } },
    '../../lib/chat-image': { uploadPlazaImage: async () => ({ error: null, url: 'https://fixture.invalid/lobby.png' }) },
    '../../lib/dm-entry': { openDmThread: async () => ({ error: null, path: '/synthetic' }) },
    /* 同学院交流群：大厅顶部的入口卡片（桩里查不到群，保持非群会话的既有断言） */
    '../../lib/college-group': { collegeName: () => '', fetchMyCollegeGroup: async () => null },
    '../../lib/sanctions': { fetchPlazaGate: async () => ({ hall: false, mute: false, account: false, reason: '' }) },
    '../../components/Icons': { IconImage: noop, IconSend: noop, IconSmile: noop },
    '../../components/MessageEntry': { MessageEntry: 'message-entry' },
    '../../components/ImageSourceSheet': { ImageSourceSheet: 'image-source' },
    '../../components/ui/DialogLayer': { DialogLayer: 'dialog-layer' },
    '../../components/StickerPanel': { StickerPanel: 'sticker-panel' },
    '../../components/ImageUploadField': { ImagePickButton: 'image-pick' },
    '../../components/ui/Skeleton': { PostCardSkeleton: noop, RowSkeleton: noop },
    './PlazaPage.module.css': { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) },
  }
  const module = { exports: {} }
  vm.runInNewContext(pageSource, {
    module, exports: module.exports, window, document, URLSearchParams, console,
    requestAnimationFrame: (fn) => { fn(); return 1 },
    require: (name) => { if (Object.hasOwn(dependencies, name)) return dependencies[name]; throw new Error(`Unexpected dependency: ${name}`) },
  })
  function render() {
    cursor = 0; dirty = false; effects = []
    tree = module.exports.PlazaPage()
    for (const pending of effects) {
      slots[pending.i]?.cleanup?.()
      slots[pending.i] = { deps: pending.deps, cleanup: pending.fn() }
    }
  }
  return {
    calls, notices,
    async refresh() { await Promise.all([...refreshTasks].map(task => task())); await this.render() },
    async render() { render(); await flush(); for (let i = 0; dirty && i < 20; i++) { render(); await flush() } assert.equal(dirty, false, 'render effects must settle'); return tree },
    find(predicate) { return walk(tree).find(predicate) }, all(predicate) { return walk(tree).filter(predicate) },
    setAuth(uid) { im.selectImSession(uid); auth = { ...auth, isSigned: !!uid, user: uid ? { uid, isAnonymous: false } : null }; dirty = true },
    upload(fn) { upload = fn }, search(fn) { search = fn }, create(fn) { create = fn },
    mirrorText(fn) { mirrorText = fn }, mirrorImage(fn) { mirrorImage = fn },
    setParams(value) { searchParams = new URLSearchParams(value); dirty = true },
    dispose() { for (const slot of slots) slot?.cleanup?.(); active = false },
  }
}

const dialog = (f) => f.find((node) => node.type === 'dialog-layer')
const publish = (f) => f.find((node) => node.type === 'button' && node.props.className === 'publish')
const bodyInput = (f) => f.find((node) => node.type === 'textarea' && node.props['aria-label'] === '动态内容')
/* 发布弹层的配图是原生 <input type="file">（透明铺满「+ 配图」按钮），不是 ImagePickButton。
   大厅那个 ImagePickButton 在桩里被替换成 'image-pick' 字符串，内部 input 不会渲染，
   所以渲染树里唯一的 input[type=file] 就是发布弹层的这一个。 */
const picker = (f) => f.find((node) => node.type === 'input' && node.props.type === 'file')
async function pickImage(f, name) {
  /* onChange 里会写 e.target.value = ''，target 必须是可写对象 */
  picker(f).props.onChange({ target: { files: [{ name }] } })
  await f.render()
}
const images = (f) => f.all((node) => node.type === 'img' && /^配图 /.test(node.props.alt || '')).map((node) => node.props.src)
const searchInput = (f) => f.find((node) => node.type === 'input' && node.props.placeholder?.startsWith('搜索广场'))
const cards = (f) => f.all((node) => node.type === 'p' && node.props.className === 'cardBody').map(text)
async function openCompose(f, body = '合成草稿') {
  f.find((node) => node.type === 'button' && text(node) === '＋ 发布动态').props.onClick()
  await f.render()
  bodyInput(f).props.onChange({ target: { value: body } })
  await f.render()
}
async function searchFor(f, keyword) {
  searchInput(f).props.onChange({ target: { value: keyword } })
  await f.render()
  searchInput(f).props.onKeyDown({ key: 'Enter' })
  await f.render()
}

test('pull refresh reloads only the visible plaza tab and unsubscribes on chat or unmount', async () => {
  const f = fixture()
  const tab = (label) => f.find(node => node.type === 'button' && text(node).endsWith(label))
  try {
    await f.render()
    const feed = f.calls.feed
    await f.refresh()
    assert.equal(f.calls.feed, feed + 1)
    assert.equal(f.calls.hot, 0)
    tab('热门榜').props.onClick(); await f.render()
    const hot = f.calls.hot
    await f.refresh()
    assert.equal(f.calls.hot, hot + 1)
    assert.equal(f.calls.feed, feed + 1)
    tab('公共聊天').props.onClick(); await f.render()
    await f.refresh()
    assert.equal(f.calls.hot, hot + 1)
    assert.equal(f.calls.feed, feed + 1)
  } finally { f.dispose() }
  const before = { feed:f.calls.feed, hot:f.calls.hot }
  await f.refresh()
  assert.equal(f.calls.feed, before.feed)
  assert.equal(f.calls.hot, before.hot)
})

test('URL navigation and compose links keep the active tab aligned with shell layout', async () => {
  const f=fixture()
  const selected = label => f.find(node => node.type === 'button' && text(node).endsWith(label)).props['aria-pressed']
  try {
    await f.render()
    f.setParams('tab=lobby'); await f.render()
    assert.equal(selected('公共聊天'), true)
    assert.match(f.find(node => node.props.className?.includes('page')).props.className, /chatPage/)
    f.setParams('tab=hot'); await f.render()
    assert.equal(selected('热门榜'), true)
    assert.doesNotMatch(f.find(node => node.props.className?.includes('page')).props.className, /chatPage/)
    f.setParams('tab=lobby&compose=1'); await f.render()
    assert.equal(selected('校园动态'), true)
    assert.ok(dialog(f))
    assert.doesNotMatch(f.find(node => node.props.className?.includes('page')).props.className, /chatPage/)
  } finally { f.dispose() }
})

test('pending image upload disables publish and its handler rejects even a stale click', async () => {
  const pending = deferred(), f = fixture({ upload: () => pending.promise })
  try {
    await f.render(); await openCompose(f)
    const staleClick = publish(f).props.onClick
    await pickImage(f, 'synthetic.png')
    assert.equal(f.calls.upload.length, 1)
    assert.equal(publish(f).props.disabled, true)
    assert.match(text(publish(f)), /等待图片上传/)
    staleClick(); publish(f).props.onClick(); await f.render()
    assert.equal(f.calls.create.length, 0)
    pending.resolve(uploadResult('completed')); await f.render()
    assert.equal(publish(f).props.disabled, false)
    assert.deepEqual(images(f), ['https://fixture.invalid/completed.png'])
  } finally { f.dispose() }
})

test('closing and reopening the composer ignores the previous upload without clearing a new busy state', async () => {
  const old = deferred(), fresh = deferred(), f = fixture({ upload: () => old.promise })
  try {
    await f.render(); await openCompose(f)
    await pickImage(f, 'old.png')
    dialog(f).props.onClose(); await f.render(); assert.equal(dialog(f), undefined)
    await openCompose(f, '新草稿')
    f.upload(() => fresh.promise); await pickImage(f, 'new.png')
    old.resolve(uploadResult('discarded')); await f.render()
    assert.deepEqual(images(f), []); assert.equal(publish(f).props.disabled, true)
    assert.equal(bodyInput(f).props.value, '新草稿')
    fresh.resolve(uploadResult('fresh')); await f.render()
    assert.deepEqual(images(f), ['https://fixture.invalid/fresh.png'])
    assert.equal(publish(f).props.disabled, false)
  } finally { f.dispose() }
})

test('A to B and A to B to A discard late uploads and protect the current account upload lock', async () => {
  for (const returnToA of [false, true]) {
    const old = deferred(), fresh = deferred(), f = fixture({ upload: () => old.promise })
    try {
      await f.render(); await openCompose(f, '旧账号草稿')
      await pickImage(f, 'old-account.png')
      f.setAuth('synthetic-B'); await f.render()
      if (returnToA) { f.setAuth('synthetic-A'); await f.render() }
      if (!dialog(f)) await openCompose(f, '当前账号草稿')
      else { bodyInput(f).props.onChange({ target: { value: '当前账号草稿' } }); await f.render() }
      f.upload(() => fresh.promise); await pickImage(f, 'current-account.png')
      old.resolve(uploadResult('old-account')); await f.render()
      assert.deepEqual(images(f), []); assert.equal(publish(f).props.disabled, true)
      assert.equal(bodyInput(f).props.value, '当前账号草稿')
      fresh.resolve(uploadResult('current-account')); await f.render()
      assert.deepEqual(images(f), ['https://fixture.invalid/current-account.png'])
      assert.equal(publish(f).props.disabled, false)
      assert.equal(f.calls.staleWrites, 0)
    } finally { f.dispose() }
  }
})

test('A to B to A without an intermediate render still invalidates the old upload', async () => {
  const old = deferred(), fresh = deferred(), f = fixture({ upload: () => old.promise })
  try {
    await f.render(); await openCompose(f, '前一个身份版本的草稿')
    await pickImage(f, 'old-session.png')
    f.setAuth('synthetic-B'); f.setAuth('synthetic-A'); await f.render()
    assert.equal(bodyInput(f).props.value, '')
    bodyInput(f).props.onChange({ target: { value: '当前身份版本的草稿' } }); await f.render()
    f.upload(() => fresh.promise); await pickImage(f, 'current-session.png')
    old.resolve(uploadResult('old-session')); await f.render()
    assert.deepEqual(images(f), [])
    assert.equal(publish(f).props.disabled, true)
    assert.equal(bodyInput(f).props.value, '当前身份版本的草稿')
    fresh.resolve(uploadResult('current-session')); await f.render()
    assert.deepEqual(images(f), ['https://fixture.invalid/current-session.png'])
    assert.equal(publish(f).props.disabled, false)
  } finally { f.dispose() }
})

test('editing the keyword then pressing Enter starts the new search while the old one is pending', async () => {
  const old = deferred(), fresh = deferred(), f = fixture({ search: (keyword) => keyword === '旧词' ? old.promise : fresh.promise })
  try {
    await f.render(); await searchFor(f, '旧词'); await searchFor(f, '新词')
    assert.deepEqual(f.calls.search, ['旧词', '新词'])
    fresh.resolve({ rows: [post(2, '新词结果')], error: null }); await f.render()
    assert.deepEqual(cards(f), ['新词结果'])
    old.resolve({ rows: [post(1, '旧词结果')], error: null }); await f.render()
    assert.deepEqual(cards(f), ['新词结果'])
    assert.equal(searchInput(f).props.value, '新词')
    assert.equal(f.find((node) => node.props['aria-label'] === '正在搜索'), undefined)
  } finally { f.dispose() }
})

test('a late old search cannot clear the latest spinner and clearing the query invalidates its response', async () => {
  const old = deferred(), fresh = deferred(), f = fixture({ search: (keyword) => keyword === '旧词' ? old.promise : fresh.promise })
  try {
    await f.render(); await searchFor(f, '旧词'); await searchFor(f, '新词')
    old.resolve({ rows: [post(1, '旧词结果')], error: null }); await f.render()
    assert(f.find((node) => node.props['aria-label'] === '正在搜索'))
    assert.deepEqual(cards(f), [])
    f.find((node) => node.props['aria-label'] === '清除搜索').props.onClick(); await f.render()
    fresh.resolve({ rows: [post(2, '新词结果')], error: null }); await f.render()
    assert.equal(searchInput(f).props.value, '')
    assert.deepEqual(cards(f), [])
    assert.equal(f.find((node) => node.props['aria-label'] === '正在搜索'), undefined)
  } finally { f.dispose() }
})

test('a successful post with a failed lobby mirror reports partial success rather than full success', async () => {
  for (const failedMirror of ['text', 'image']) {
    const f = fixture({
      mirrorText: async () => ({ error: failedMirror === 'text' ? 'synthetic mirror failure' : null }),
      mirrorImage: async () => ({ error: failedMirror === 'image' ? 'synthetic mirror failure' : null }),
    })
    try {
      await f.render(); await openCompose(f)
      await pickImage(f, 'synthetic.png')
      publish(f).props.onClick(); await f.render()
      assert.equal(f.calls.create.length, 1); assert.equal(f.calls.create[0].images.length, 1)
      assert.equal(f.calls.mirrorText.length, 1); assert.equal(f.calls.mirrorImage.length, 1)
      assert(f.notices.some((notice) => notice.kind === 'warning' && /动态已发布.*未全部完成/.test(notice.message)))
      assert(!f.notices.some((notice) => notice.message === '已发动态，并同步到大厅'))
      assert.equal(dialog(f), undefined)
    } finally { f.dispose() }
  }
})

test('a thrown lobby mirror after the post was saved still reports that the post was published', async () => {
  for (const failedMirror of ['text', 'image']) {
    const f = fixture({
      mirrorText: async () => { if (failedMirror === 'text') throw new Error('synthetic text mirror failure'); return { error: null } },
      mirrorImage: async () => { if (failedMirror === 'image') throw new Error('synthetic image mirror failure'); return { error: null } },
    })
    try {
      await f.render(); await openCompose(f)
      await pickImage(f, 'synthetic.png')
      publish(f).props.onClick(); await f.render()
      assert.equal(f.calls.create.length, 1)
      assert(f.notices.some((notice) => notice.kind === 'warning' && /动态已发布.*未全部完成/.test(notice.message)))
      assert(!f.notices.some((notice) => notice.message === '已发动态，并同步到大厅'))
    } finally { f.dispose() }
  }
})

test('a thrown upload releases busy state and preserves the draft so a retry can succeed', async () => {
  const pending = deferred(), f = fixture({ upload: () => pending.promise })
  try {
    await f.render(); await openCompose(f, '上传失败后保留的草稿')
    await pickImage(f, 'synthetic.png')
    assert.equal(publish(f).props.disabled, true)
    pending.reject(new Error('synthetic upload failure')); await f.render()
    assert.equal(bodyInput(f).props.value, '上传失败后保留的草稿')
    assert.equal(publish(f).props.disabled, false)
    assert.deepEqual(images(f), [])
    assert(f.notices.some((notice) => notice.kind === 'error' && notice.message === 'synthetic upload failure'))
    f.upload(async () => uploadResult('retry')); await pickImage(f, 'retry.png')
    assert.equal(f.calls.upload.length, 2)
    assert.deepEqual(images(f), ['https://fixture.invalid/retry.png'])
    assert.equal(bodyInput(f).props.value, '上传失败后保留的草稿')
  } finally { f.dispose() }
})
