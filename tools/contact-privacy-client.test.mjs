import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import vm from 'node:vm'
const ts=createRequire(import.meta.url)('typescript')
function load(file,cb){
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2023}}).outputText
  const module={exports:{}}
  vm.runInNewContext(code,{module,exports:module.exports,require(name){
    if(name==='./cb')return cb
    if(['./upload-error','./image-compress','./market'].includes(name))return {}
    throw Error(`Unexpected dependency ${name}`)
  }})
  return module.exports
}
function fixture(responses){
  const calls=[]
  const module=load('src/lib/market.ts',{cbRdb:()=>({from(table){
    calls.push(table)
    const q={select(){return q},eq(){return q},order(){return q},limit(){return q},then(yes,no){return Promise.resolve(responses[table]||{data:[]}).then(yes,no)}}
    return q
  }})})
  return {module,calls}
}
test('private owner result is kept without requesting a public fallback',async()=>{
  const {module,calls}=fixture({tasks:{data:[{id:1,creator_uid:'me',contact:'explicit contact'}]}})
  const r=await module.queryRows('tasks',{id:1},1)
  assert.equal(r.rows[0].contact,'explicit contact');assert.deepEqual(calls,['tasks'])
})
test('cross-user details use only the public view and preserve the in-app messaging UID',async()=>{
  const {module,calls}=fixture({tasks:{data:[]},v_tasks_public:{data:[{id:1,title:'Task',creator_uid:'peer'}]}})
  const r=await module.queryRows('tasks',{id:1},1)
  assert.equal(r.rows[0].creator_uid,'peer');assert.equal(r.rows[0].contact,undefined)
  assert.deepEqual(calls,['tasks','v_tasks_public'])
})
test('failed private queries and non-detail filters do not widen access',async()=>{
  for(const filters of [{creator_uid:'other'},{id:1,creator_uid:'other'},{id:'1'},{id:-1}]){
    const {module,calls}=fixture({tasks:{data:[]}})
    assert.equal((await module.queryRows('tasks',filters,1)).rows.length,0)
    assert.deepEqual(calls,['tasks'])
  }
  const {module,calls}=fixture({tasks:{error:{message:'permission denied'}}})
  assert.equal((await module.queryRows('tasks',{id:1},1)).error,'permission denied')
  assert.deepEqual(calls,['tasks'])
})
test('organizer roster uses the server sanitized RPC and fails closed',async()=>{
  const calls=[]
  const module=load('src/lib/bulletin.ts',{cbRdb:()=>({async rpc(name,args){calls.push({name,args});return {data:[{id:1,contact:''}]}}})})
  const r=await module.fetchActivitySignups(1)
  assert.equal(r.rows[0].contact,'');assert.equal(calls[0].name,'activity_signup_roster_149')
  const denied=load('src/lib/bulletin.ts',{cbRdb:()=>({async rpc(){return {error:{message:'denied'}}}})})
  assert.equal((await denied.fetchActivitySignups(1)).rows.length,0)
})
test('activity signup paths never fill contact from the authentication phone',()=>{
  for(const path of ['src/pages/InfoPage.tsx','src/pages/MorningTeamsPage.tsx']){
    assert.doesNotMatch(readFileSync(path,'utf8'),/contact\s*:\s*[^\n]*user\.phone|useState\(auth\.user\?\.phone/)
  }
})
