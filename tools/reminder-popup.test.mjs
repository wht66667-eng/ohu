import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
const values = new Map(), listeners = new Map()
const localStorage = { getItem: key => values.get(key) ?? null, setItem: (key,value) => values.set(key,value) }
const window = { addEventListener: (name,fn) => { if (!listeners.has(name)) listeners.set(name,new Set()); listeners.get(name).add(fn) }, removeEventListener: (name,fn) => listeners.get(name)?.delete(fn), dispatchEvent: event => { for (const fn of listeners.get(event.type) ?? []) fn(event) } }
const module = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/reminder-popup.ts',import.meta.url),'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText, { module, exports: module.exports, localStorage, window, Event: class { constructor(type) { this.type=type } } })
const api=module.exports
const plain = value => JSON.parse(JSON.stringify(value))
const card = (id,name=id) => ({id,kind:'todo',title:'提醒',name,detail:'',hint:'',route:'/todo',actionLabel:'查看'})
test('default and corrupt preferences use the agreed light banner', () => {
  values.clear(); assert.equal(api.getReminderPopupStyle(),'banner')
  values.set('reminder.popup.style','unsafe'); assert.equal(api.getReminderPopupStyle(),'banner')
})
test('explicit variants notify subscribers; unrelated storage does not', () => {
  values.clear(); let calls=0; const remove=api.subscribeReminderPopup(()=>calls++)
  api.setReminderPopupStyle('dialog'); assert.equal(api.getReminderPopupStyle(),'dialog'); assert.equal(calls,1)
  window.dispatchEvent({type:'storage',key:'unrelated'}); assert.equal(calls,1)
  window.dispatchEvent({type:'storage',key:'reminder.popup.style'}); assert.equal(calls,2)
  remove(); api.setReminderPopupStyle('banner'); assert.equal(calls,2)
  assert.throws(()=>api.setReminderPopupStyle('unknown'))
})
test('simultaneous cards keep FIFO and do not mutate callers', () => {
  const original=[card('a')], incoming=[card('b'),card('c')]
  const result=api.enqueueReminderCards(original,incoming)
  assert.deepEqual(plain(result.map(row=>row.id)),['a','b','c'])
  assert.equal(original.length,1); assert.equal(incoming.length,2)
})
test('dedup updates a waiting event without displacing the active event', () => {
  const result=api.enqueueReminderCards([card('a'),card('b')],[card('b','updated'),card('b','newest'),card('c')])
  assert.deepEqual(plain(result.map(row=>row.id)),['a','b','c'])
  assert.equal(result[1].name,'newest')
})
test('business notification click requires the current owner', () => {
  const event={actionId:'tap',notification:{extra:{type:'class',ownerUid:'A'}}}
  assert.equal(api.reminderActionRoute(event,''),null)
  assert.equal(api.reminderActionRoute(event,'B'),null)
  assert.equal(api.reminderActionRoute(event,'A'),'/schedule')
})
test('foreign routes and unknown actions cannot navigate from notification extras', () => {
  const notice={extra:{type:'exam',ownerUid:'A',route:'https://invalid.example'}}
  assert.equal(api.reminderActionRoute({actionId:'view-reminder',notification:notice},'A'),'/study?tab=exams')
  assert.equal(api.reminderActionRoute({actionId:'delete',notification:notice},'A'),null)
  assert.equal(api.reminderActionRoute({actionId:'tap',notification:{extra:{type:'unknown',ownerUid:'A',route:'/admin'}}},'A'),null)
})
test('self-test works before login only for the isolated test notification ID', () => {
  assert.equal(api.reminderActionRoute({actionId:'tap',notification:{id:70011,extra:{type:'self-test'}}},''),'/settings?section=reminders')
  assert.equal(api.reminderActionRoute({actionId:'tap',notification:{id:123,extra:{type:'self-test'}}},''),null)
})
