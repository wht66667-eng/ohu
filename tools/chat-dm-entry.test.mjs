/**
 * 自建私信（替换腾讯 IM 后的链路）测试：
 * 1) openDmThread：先开会话线再返回 /chats/{id}，并把服务端错误透出
 * 2) chatSendImage：只放行 https 且 ≤1024 的地址，走 p_kind='image'
 * 3) chatSendMessage：空串 / 超长在前端先拦，不打到服务端
 * 4) normMessage：图片消息补出 kind / media_url，正文回落到 '[图片]'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(join(root, 'package.json'))('typescript')
function load(relative, injected = {}, globals = {}) {
  const source = fs.readFileSync(join(root, relative), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(compiled, { module, exports: module.exports, URLSearchParams, window: { setTimeout, clearTimeout }, ...globals, require(name) { if (name in injected) return injected[name]; throw Error(`Unexpected dependency: ${name}`) } })
  return module.exports
}
const plain = value => JSON.parse(JSON.stringify(value))

const IMG = 'https://jou-d4gq7a3cqf51e6caa.ap-shanghai.app.tcloudbase.com/images/chats/A/1.png'

function fixture(handler = async () => ({ data: {} })) {
  const calls = []
  const chat = load('src/lib/chat.ts', {
    './cb': {
      cbAuth: () => ({ currentUser: { uid: 'A' } }),
      cbRdb: () => ({ rpc: async (name, params) => { calls.push({ name, params }); return handler(name, params) } }),
    },
  })
  const entry = load('src/lib/dm-entry.ts', { './chat': chat })
  return { chat, entry, calls }
}

test('openDmThread opens the thread first and then hands back /chats/{id}', async () => {
  const { entry, calls } = fixture(async () => ({ data: { created: true, thread: { id: 42, user_uid: 'A', peer_uid: 'B' } } }))
  const r = await entry.openDmThread({ peerUid: 'B', peerName: '小狐', topicType: 'secondhand', topicId: 7, topicTitle: '出一台显示器' })
  assert.equal(r.error, null)
  assert.equal(r.path, '/chats/42')
  const open = calls.find(c => c.name === 'chat_thread_open')
  assert.equal(open.params.p_topic_type, 'secondhand')
  assert.equal(open.params.p_topic_id, 7)
  assert.equal(open.params.p_peer_uid, 'B')
})

test('openDmThread defaults to a plain DM topic and refuses a missing peer', async () => {
  const { entry, calls } = fixture(async () => ({ data: { thread: { id: 9 } } }))
  const r = await entry.openDmThread({ peerUid: 'B' })
  assert.equal(r.path, '/chats/9')
  assert.equal(calls[0].params.p_topic_type, 'plaza_user')
  assert.equal(calls[0].params.p_topic_id, null)
  assert.equal(calls[0].params.p_topic_title, '私聊 · 同学')
  assert.match((await entry.openDmThread({ peerUid: '  ' })).error || '', /联系不上/)
})

test('server errors from opening a thread are surfaced instead of navigating nowhere', async () => {
  const { entry } = fixture(async () => ({ error: { message: '你已被限制' } }))
  const r = await entry.openDmThread({ peerUid: 'B' })
  assert.equal(r.path, '')
  assert.equal(r.error, '你已被限制')
})

test('chatSendImage only accepts https urls under 1024 chars and tags the row as an image', async () => {
  const { chat, calls } = fixture(async () => ({ data: { message: { id: 5, body: '[图片]', kind: 'image', media_url: IMG, sender_uid: 'A' }, thread: { id: 42 } } }))
  const r = await chat.chatSendImage(42, IMG)
  assert.equal(r.error, null)
  assert.deepEqual(plain(r.data.message.kind), 'image')
  assert.equal(r.data.message.media_url, IMG)
  const send = calls.find(c => c.name === 'chat_send')
  assert.equal(send.params.p_kind, 'image')
  assert.equal(send.params.p_media_url, IMG)
  assert.equal(send.params.p_body, '[图片]')
  assert.match((await chat.chatSendImage(42, 'http://a.com/x.png')).error || '', /地址无效/)
  assert.match((await chat.chatSendImage(42, `https://x.com/${'a'.repeat(1100)}`)).error || '', /地址无效/)
  assert.equal(calls.filter(c => c.name === 'chat_send').length, 1)
})

test('text sends stay text: empty and over-long bodies are rejected client-side', async () => {
  const { chat, calls } = fixture(async () => ({ data: { message: { id: 1, body: 'hi', sender_uid: 'A' }, thread: { id: 42 } } }))
  assert.match((await chat.chatSendMessage(42, '   ')).error || '', /不能为空/)
  assert.match((await chat.chatSendMessage(42, 'x'.repeat(2001))).error || '', /2000/)
  assert.equal(calls.length, 0)
  const ok = await chat.chatSendMessage(42, '  你好  ')
  assert.equal(ok.error, null)
  assert.equal(calls[0].params.p_body, '你好')
})

test('image rows fall back to [图片] when the server omits the body', async () => {
  const { chat } = fixture(async () => ({ data: { message: { id: 6, kind: 'image', media_url: IMG, sender_uid: 'B' }, thread: { id: 42 } } }))
  const r = await chat.chatSendImage(42, IMG)
  assert.equal(r.data.message.body, '[图片]')
  assert.equal(r.data.message.is_mine, false)
  assert.equal(r.data.message.media_url, IMG)
})
