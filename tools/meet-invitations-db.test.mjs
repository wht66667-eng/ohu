import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const { PGlite } = await import(pathToFileURL(resolve(process.env.OHU_PGLITE_PATH || '.codex/qa/friends131-pg/node_modules/@electric-sql/pglite/dist/index.js')).href)
const migration = readFileSync('docs/release/meet-invitations.sql', 'utf8')
const tokenA = 'ab'.repeat(32), tokenB = 'cd'.repeat(32), tokenC = 'ef'.repeat(32)
const seed = `CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.actor',true),'') $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('test.role',true) $$;
  CREATE FUNCTION public.current_is_anon() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('test.anon',true),''),'false')::boolean $$;
  GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;`

async function fixture(run) {
  const db = new PGlite()
  try {
    await db.exec(seed)
    await db.exec(migration)
    const day = (await db.query(`SELECT to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date+1,'YYYY-MM-DD') AS day`)).rows[0].day
    await run(db, day)
  } finally { await db.close() }
}
async function rpc(db, name, values = [], { actor = 'owner', role = 'authenticated', anonymous = false, canonicalAnonymous = anonymous } = {}) {
  await db.exec(`BEGIN; SET LOCAL ROLE ${role};`)
  try {
    await db.query(`SELECT set_config('test.actor',$1,true),set_config('test.role',$2,true),set_config('request.jwt.claims',$3,true),set_config('test.anon',$4,true)`, [actor, role, JSON.stringify({ is_anonymous: anonymous }), String(canonicalAnonymous)])
    const placeholders = values.map((_, index) => `$${index+1}`).join(',')
    const result = await db.query(`SELECT public.${name}(${placeholders}) AS value`, values.map(value => Array.isArray(value) ? JSON.stringify(value) : value))
    await db.exec('COMMIT')
    return result.rows[0]?.value
  } catch (error) { await db.exec('ROLLBACK'); throw error }
}
const create = (db, day, options={}) => rpc(db, 'meet_create', [options.title || '一起自习', day, 2, options.duration || 60, '发起人', options.activity || 'study', options.size || 2, options.campus || '江苏海洋大学', options.visibility || 'private', options.vibe || 'any', options.slots ?? null, options.slots ? tokenA : null], options.auth)
const reply = (db, meet, day, name, token, options={}) => rpc(db,'meet_respond',[meet.code,name,token,options.slots ?? [`${day}T14:00`,`${day}T14:30`],options.vibe || 'any'],options.auth || { role:'anon',actor:'' })

test('private activity creates a random public URL capability and stores atomic creator availability', async () => fixture(async (db,day) => {
  const meet = await create(db,day,{slots:[`${day}T14:00`,`${day}T14:30`]})
  assert.match(meet.code,/^[a-f0-9]{32}$/)
  assert.equal(meet.participantCount,1)
  assert.equal(meet.mine,true)
  const publicRead = await rpc(db,'meet_get',[meet.code],{actor:'',role:'anon'})
  assert.equal(publicRead.mine,false)
  assert.equal(publicRead.detailsVisible,false)
  assert.deepEqual(publicRead.participants,[])
  const memberRead = await rpc(db,'meet_get_member',[meet.code,tokenA])
  assert.equal(memberRead.detailsVisible,true)
  assert.deepEqual(memberRead.participants,[{name:'发起人',vibe:'any',personalityType:null}])
  const encoded=JSON.stringify(publicRead)
  assert.equal(encoded.includes(tokenA),false)
  assert.equal(encoded.includes('token_hash'),false)
  assert.equal(encoded.includes('owner_uid'),false)
}))

test('private guest can join without login and only its capability updates its reply', async () => fixture(async (db,day) => {
  const meet=await create(db,day)
  let result=await reply(db,meet,day,'同学甲',tokenA)
  assert.equal(result.participantCount,1)
  result=await reply(db,meet,day,'甲的新昵称',tokenA,{slots:[`${day}T15:00`,`${day}T15:30`]})
  assert.equal(result.participantCount,1)
  assert.deepEqual(result.participants,[{name:'甲的新昵称',vibe:'any',personalityType:null}])
  assert.equal(result.slotCounts[0].slot,`${day}T15:00`)
  result=await reply(db,meet,day,'同学乙',tokenB)
  assert.equal(result.participantCount,2)
  await assert.rejects(reply(db,meet,day,'超额同学',tokenC),/人数已满/)
}))

test('only the participant can leave and their released place can be used again', async () => fixture(async (db,day) => {
  const meet=await create(db,day,{slots:[`${day}T14:00`,`${day}T14:30`]})
  await reply(db,meet,day,'同学乙',tokenB)
  const wrong=await rpc(db,'meet_leave',[meet.code,tokenC],{role:'anon',actor:''})
  assert.equal(wrong.participantCount,2,'a different guest secret cannot remove a participant')
  await assert.rejects(rpc(db,'meet_leave',[meet.code,tokenA]),/发起人/)
  const left=await rpc(db,'meet_leave',[meet.code,tokenB],{role:'anon',actor:''})
  assert.equal(left.participantCount,1)
  assert.equal((await reply(db,meet,day,'同学丙',tokenC)).participantCount,2)
  assert.equal((await rpc(db,'meet_leave',[meet.code,tokenB],{role:'anon',actor:''})).participantCount,2,'repeating a leave does not affect a later participant')
}))

test('signed participant leave follows account ownership even on a new device', async () => fixture(async (db,day) => {
  const meet=await create(db,day,{visibility:'public',slots:[`${day}T14:00`,`${day}T14:30`]})
  await reply(db,meet,day,'同学',tokenB,{auth:{role:'authenticated',actor:'student'}})
  const foreign=await rpc(db,'meet_leave',[meet.code,tokenB],{role:'authenticated',actor:'other'})
  assert.equal(foreign.participantCount,2,'knowing another signed user token is insufficient')
  const left=await rpc(db,'meet_leave',[meet.code,tokenC],{role:'authenticated',actor:'student'})
  assert.equal(left.participantCount,1)
}))

test('my activities includes only rooms created or joined by the signed account', async () => fixture(async (db,day) => {
  const meet=await create(db,day,{visibility:'public',slots:[`${day}T14:00`,`${day}T14:30`]})
  await reply(db,meet,day,'同学',tokenB,{auth:{role:'authenticated',actor:'student'}})
  const ownerList=await rpc(db,'meet_list')
  const memberList=await rpc(db,'meet_list',[],{role:'authenticated',actor:'student'})
  assert.equal(ownerList.length,1,'creator is not duplicated by their own response')
  assert.deepEqual(memberList.map(item=>item.code),[meet.code])
  assert.equal(memberList[0].mine,false)
  assert.deepEqual(await rpc(db,'meet_list',[],{role:'authenticated',actor:'other'}),[])
  await rpc(db,'meet_leave',[meet.code,tokenB],{role:'authenticated',actor:'student'})
  assert.deepEqual(await rpc(db,'meet_list',[],{role:'authenticated',actor:'student'}),[])
}))

test('public activity discovery is same-school scoped and public joining requires signed identity', async () => fixture(async (db,day) => {
  const meet=await create(db,day,{visibility:'public'})
  await create(db,day,{visibility:'public',campus:'另一个学校'})
  await create(db,day,{visibility:'private'})
  await assert.rejects(rpc(db,'meet_discover',['江苏海洋大学','study',[]],{role:'anon',actor:''}),/permission denied/)
  const found=await rpc(db,'meet_discover',['江苏海洋大学','study',[]])
  assert.deepEqual(found.map(item=>item.code),[meet.code])
  await assert.rejects(reply(db,meet,day,'访客',tokenA),/请先登录/)
  await assert.rejects(reply(db,meet,day,'匿名认证',tokenA,{auth:{role:'authenticated',actor:'anon-uid',anonymous:true}}),/请先登录/)
  await assert.rejects(reply(db,meet,day,'匿名认证缺少JWT标记',tokenA,{auth:{role:'authenticated',actor:'anon-uid',anonymous:false,canonicalAnonymous:true}}),/请先登录/)
  await reply(db,meet,day,'正式学生',tokenA,{auth:{role:'authenticated',actor:'student'}})
  const changed=await reply(db,meet,day,'换设备昵称',tokenB,{auth:{role:'authenticated',actor:'student'}})
  assert.equal(changed.participantCount,1)
}))

test('discovery matches continuous common availability and excludes full, closed, other projects', async () => fixture(async (db,day) => {
  const meet=await create(db,day,{visibility:'public',size:3,slots:[`${day}T14:00`,`${day}T14:30`,`${day}T15:00`]})
  await create(db,day,{visibility:'public',activity:'meal'})
  const matching=await rpc(db,'meet_discover',['江苏海洋大学','study',[`${day}T14:30`,`${day}T15:00`]])
  assert.equal(matching.length,1)
  const disjoint=await rpc(db,'meet_discover',['江苏海洋大学','study',[`${day}T14:00`,`${day}T15:00`]])
  assert.equal(disjoint.length,0)
  await rpc(db,'meet_close',[meet.code])
  assert.equal((await rpc(db,'meet_discover',['江苏海洋大学','study',[]])).length,0)
}))

test('preferred companion type ranks matching participants first without excluding other eligible groups', async () => fixture(async (db,day) => {
  const slots=[`${day}T14:00`,`${day}T14:30`]
  const e=await create(db,day,{visibility:'public',size:3,vibe:'E',slots})
  const i=await create(db,day,{visibility:'public',size:3,vibe:'I',slots})
  const any=await create(db,day,{visibility:'public',size:3,vibe:'any',slots})
  const ranked=await rpc(db,'meet_discover',['江苏海洋大学','study',slots,'E'])
  assert.equal(ranked.length,3)
  assert.equal(ranked[0].code,e.code)
  assert.deepEqual(new Set(ranked.map(x=>x.code)),new Set([e.code,i.code,any.code]))
  const rankedI=await rpc(db,'meet_discover',['江苏海洋大学','study',slots,'I'])
  assert.equal(rankedI[0].code,i.code)
  await assert.rejects(rpc(db,'meet_discover',['江苏海洋大学','study',slots,'invalid']),/搭子类型/)
}))

test('confirmation requires owner, full target and every consecutive common slot', async () => fixture(async (db,day) => {
  const meet=await create(db,day,{slots:[`${day}T14:00`,`${day}T14:30`]})
  await assert.rejects(rpc(db,'meet_confirm',[meet.code,`${day}T14:00`]),/人数尚未到齐/)
  await reply(db,meet,day,'同学乙',tokenB,{slots:[`${day}T15:00`,`${day}T15:30`]})
  await assert.rejects(rpc(db,'meet_confirm',[meet.code,`${day}T14:00`],{actor:'other'}),/只有发起人/)
  await assert.rejects(rpc(db,'meet_confirm',[meet.code,`${day}T14:00`]),/所有参与者确认/)
  await reply(db,meet,day,'同学乙',tokenB)
  const confirmed=await rpc(db,'meet_confirm',[meet.code,`${day}T14:00`])
  assert.equal(confirmed.confirmedStart,`${day}T14:00`)
  assert.equal(confirmed.confirmedEnd,`${day}T15:00`)
  assert.equal((await rpc(db,'meet_confirm',[meet.code,`${day}T14:00`])).confirmedStart,confirmed.confirmedStart)
  await assert.rejects(reply(db,meet,day,'同学乙',tokenB),/已确定时间/)
}))

test('malformed slots and credentials fail before they create responses', async () => fixture(async (db,day) => {
  const meet=await create(db,day)
  for (const slots of [[],[`${day}T07:30`],[`${day}T22:00`],[`${day}T14:15`],['2026-99-99T14:00'],[42]]) {
    await assert.rejects(reply(db,meet,day,'同学',tokenA,{slots}),/时间/)
  }
  for (const slots of [[`${day}T14:00`],[`${day}T14:00`,`${day}T15:00`],[`${day}T21:30`]]) {
    await assert.rejects(reply(db,meet,day,'同学',tokenA,{slots}),/连续未来空闲时间/)
  }
  await assert.rejects(reply(db,meet,day,'同学','short'),/凭证/)
  await assert.rejects(reply(db,meet,day,'x'.repeat(25),tokenA),/昵称/)
  assert.equal((await rpc(db,'meet_get',[meet.code])).participantCount,0)
  await assert.rejects(create(db,day,{slots:[`${day}T07:30`]}),/时间/)
  assert.equal((await rpc(db,'meet_list')).length,1,'invalid atomic creator availability rolls creation back')
}))

test('tables and internal payload helper cannot be enumerated by API roles', async () => fixture(async db => {
  for (const role of ['anon','authenticated']) {
    await db.exec(`BEGIN; SET LOCAL ROLE ${role};`)
    try { await assert.rejects(db.query('SELECT * FROM public.meet_invitations'),/permission denied/) }
    finally { await db.exec('ROLLBACK') }
    assert.equal((await db.query(`SELECT has_function_privilege($1,'public.meet_payload(uuid)','EXECUTE') AS allowed`,[role])).rows[0].allowed,false)
  }
}))

test('create, ownership mutation, and discovery reject invalid or anonymous callers', async () => fixture(async (db,day) => {
  await assert.rejects(create(db,day,{auth:{role:'anon',actor:''}}),/permission denied/)
  await assert.rejects(create(db,day,{auth:{role:'authenticated',actor:'anon',anonymous:true}}),/请先登录/)
  await assert.rejects(rpc(db,'meet_discover',['','',[]]),/选择学校/)
  const meet=await create(db,day)
  await assert.rejects(rpc(db,'meet_close',[meet.code],{actor:'other'}),/只有发起人/)
  const closed=await rpc(db,'meet_close',[meet.code])
  assert.ok(closed.closedAt)
  await assert.rejects(reply(db,meet,day,'同学',tokenA),/已结束/)
}))

test('reapplying additive migration preserves rooms and replies', async () => fixture(async (db,day) => {
  const meet=await create(db,day,{slots:[`${day}T14:00`,`${day}T14:30`]})
  await db.exec(migration)
  const after=await rpc(db,'meet_get',[meet.code])
  assert.equal(after.participantCount,1)
  assert.equal(after.code,meet.code)
}))
