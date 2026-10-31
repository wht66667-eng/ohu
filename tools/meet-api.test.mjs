import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import { createRequire } from 'node:module'

const ts = createRequire(import.meta.url)('typescript')
const source = ts.transpileModule(fs.readFileSync(new URL('../src/lib/meet-api.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const room = () => ({ id:'id', code:'abcd'.repeat(8), title:'一起自习', organizerName:'甲', startsOn:'2099-01-01', days:1,
  durationMinutes:60, activity:'study', targetSize:2, campus:'江苏海洋大学', visibility:'private', vibe:'any', createdAt:'2098-12-01',
  closedAt:null, confirmedStart:null, confirmedEnd:null, mine:false, participantCount:2, participants:[{name:'甲',vibe:'any'},{name:'乙',vibe:'I'}],
  slotCounts:[{slot:'2099-01-01T10:00',count:2},{slot:'2099-01-01T10:30',count:2},{slot:'2099-01-01T11:00',count:1}] })

function fixture() {
  const values = new Map(), calls = []
  let owner = '', revision = 0, responder = async () => ({ data:room(), error:null })
  const localStorage = { getItem:key => values.get(key) ?? null, setItem:(key,value)=>values.set(key,value), removeItem:key=>values.delete(key) }
  const qbank = { captureQbankSession:()=>({uid:owner,revision}), isQbankSessionCurrent:s=>s.uid===owner && s.revision===revision }
  const mocks = { './cb':{cbRdb:()=>({rpc:async (name,params)=>{ calls.push({name,params}); return responder(name,params) }})}, './qbank':qbank }
  const module = { exports:{} }
  vm.runInNewContext(source,{ module, exports:module.exports, require:name=>mocks[name] || {}, localStorage, crypto:webcrypto, Uint8Array, Date })
  return { api:module.exports,calls,values,setOwner:uid=>{owner=uid;revision++},setResponder:fn=>{responder=fn} }
}

test('private invitation generates a local secret and saves a guest response only after server acceptance', async () => {
  const f=fixture(), code=room().code
  await f.api.respondMeet(code,{name:'同学',vibe:'I',slots:['2099-01-01T10:00','2099-01-01T10:30']})
  assert.equal(f.calls[0].name,'meet_respond')
  assert.match(f.calls[0].params.p_token,/^[a-f0-9]{64}$/)
  assert.equal(f.api.readMeetReply(code).name,'同学')
  assert.equal(f.api.readMeetReply(code).slots.length,2)
  f.setOwner('other-account')
  assert.equal(f.api.readMeetReply(code),null)
})

test('a failed response retains only its secret and cannot be displayed as submitted', async () => {
  const f=fixture(),code=room().code
  f.setResponder(async()=>({error:{message:'网络出错'}}))
  await assert.rejects(()=>f.api.respondMeet(code,{name:'同学',vibe:'any',slots:['2099-01-01T10:00']}),/网络出错/)
  assert.equal(f.api.readMeetReply(code),null)
  assert.equal(f.values.size,1)
})

test('the UI offers only consecutive time explicitly selected by every participant', () => {
  const f=fixture(), result=f.api.recommendedMeetSlots(room())
  assert.equal(result.length,1)
  assert.equal(result[0].start,'2099-01-01T10:00')
  assert.equal(result[0].end,'2099-01-01T11:00')
})

test('owner changes during a pending request discard the response', async () => {
  const f=fixture(); let finish
  f.setResponder(()=>new Promise(resolve=>{finish=resolve}))
  const pending=f.api.getMeet(room().code)
  f.setOwner('other-account')
  finish({data:room(),error:null})
  await assert.rejects(pending,/账号已切换/)
})

test('leaving a private activity removes local reply only after the server releases the place', async () => {
  const f=fixture(),code=room().code
  await f.api.respondMeet(code,{name:'同学',vibe:'any',slots:['2099-01-01T10:00']})
  f.setResponder(async()=>({error:{message:'暂时不能退出'}}))
  await assert.rejects(()=>f.api.leaveMeet(code),/暂时不能退出/)
  assert.ok(f.api.readMeetReply(code))
  f.setResponder(async()=>({data:room(),error:null}))
  await f.api.leaveMeet(code)
  assert.equal(f.api.readMeetReply(code),null)
})
