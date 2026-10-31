import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createMapQaDb, runMapQaQuery } from './map-qa-db.mjs'

function moduleApi(file, dependencies = {}, globals = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(readFileSync(new URL('../src/lib/' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, console, ...globals, require: name => { if (!(name in dependencies)) throw Error(name); return dependencies[name] } })
  return module.exports
}

test('navigation keeps WGS84 destination, modes and safe parameter encoding', () => {
  const api = moduleApi('campus-map-navigation.ts', {}, { URL })
  for (const mode of ['walk','ride','car']) {
    const url = new URL(api.amapNavigationUrl({lng:119.21,lat:34.59,name:'测试,地点&mode=bus'},mode))
    assert.equal(url.origin,'https://uri.amap.com')
    assert.equal(url.searchParams.get('coordinate'),'wgs84')
    assert.equal(url.searchParams.get('mode'),mode)
    assert.equal(url.searchParams.get('callnative'),'1')
    assert.equal(url.searchParams.get('to'),'119.21,34.59,测试 地点&mode=bus')
    assert.equal(url.searchParams.has('from'),false)
  }
  assert.equal(new URL(api.amapNavigationUrl({lng:119,lat:34,name:'目的地'},'walk',false)).searchParams.get('callnative'),'0')
  assert.throws(()=>api.amapNavigationUrl({lng:NaN,lat:34,name:'无效'},'walk'))
  assert.throws(()=>api.amapNavigationUrl({lng:119,lat:94,name:'无效'},'walk'))
  assert.throws(()=>api.amapNavigationUrl({lng:119,lat:34,name:'无效'},'bad'))
})

test('public comments remain readable without disclosing account IDs', async t => {
  const qa = await createMapQaDb(); t.after(() => qa.db.close())
  const post = (await qa.db.query("insert into campus_posts(school_id,author_uid,body,status) values('lyg','qa-student-a','虚拟公开动态','published') returning id")).rows[0].id
  await qa.as('qa-student-a',"insert into campus_post_comments(post_id,user_uid,body) values($1,'qa-student-a','虚拟评论')",[post])
  const visible = await qa.as('',"select id,post_id,body,status,created_at from campus_post_comments where post_id=$1",[post])
  assert.equal(visible.rows[0].body,'虚拟评论')
  await assert.rejects(qa.as('',"select user_uid from campus_post_comments"))
})

test('same-name approval fails instead of dropping submitted photos silently', async t => {
  const qa = await createMapQaDb(); t.after(() => qa.db.close())
  const name=(await qa.db.query('select name from campus_pois limit 1')).rows[0].name
  const id=(await qa.as('qa-student-a',"insert into campus_poi_submissions(campus_id,user_uid,name,category,lng,lat) values($1,'qa-student-a',$2,'打卡',119.2,34.5) returning id",[qa.campus,name])).rows[0].id
  await assert.rejects(qa.as('qa-admin',"update campus_poi_submissions set status='approved' where id=$1",[id]),/同名地点/)
  assert.equal((await qa.as('qa-student-a','select status from campus_poi_submissions where id=$1',[id])).rows[0].status,'pending')
})
test('test students and administrator exercise real migrations, client queries and moderation', async t => {
  const qa = await createMapQaDb()
  t.after(() => qa.db.close())
  let uid = 'qa-student-a', revision = 1
  const login = user => { uid = user; revision++ }
  const cb = { cbRdb: () => ({ from: table => {
    const owner = uid, q = { table, op: 'select', filters: [] }
    const chain = { select(columns='*') { q.columns=columns; return chain }, insert(data) { q.op='insert'; q.data=data; return chain }, update(data) { q.op='update'; q.data=data; return chain }, eq(k,v) { q.filters.push([k,v]); return chain }, order(k,opts) { q.order=k; q.asc=opts?.ascending; return chain }, limit(n) { q.limit=n; return chain }, then(ok,bad) { return runMapQaQuery(qa,owner,q).then(ok,bad) } }
    return chain
  } }) }
  const api = moduleApi('campus-map.ts', { './cb': cb, './social-actor': { currentActor: () => uid ? {uid,name:'测试账号',avatar:''} : null }, './im-session': { captureImSession: () => ({uid,revision}), currentImSession: ticket => ticket?.uid===uid && ticket?.revision===revision } })
  const draft = { campusId: Number(qa.campus), name:'虚拟验收·日落打卡点', category:'打卡', lng:119.21, lat:34.59, note:'虚拟测试数据，不是真实推荐地点', images:['https://example.invalid/qa-place.jpg'] }
  await t.test('student submission is pending and not public', async () => {
    assert.equal((await api.submitCampusPoi(draft)).error,null)
    assert.equal((await api.fetchCampusPois(qa.campus)).rows.some(p=>p.name===draft.name),false)
    assert.equal((await api.fetchPendingCampusPoiSubmissions()).rows.length,1)
    assert.equal((await api.fetchPendingCampusPoiSubmissions()).rows[0].image_urls[0],draft.images[0])
  })
  const id = (await api.fetchPendingCampusPoiSubmissions()).rows[0].id
  await t.test('other student cannot read private submission or approve it', async () => {
    login('qa-student-b')
    assert.equal((await api.fetchPendingCampusPoiSubmissions()).rows.length,0)
    await api.setCampusPoiSubmissionStatus(id,'approved')
    assert.equal((await qa.db.query('select status from campus_poi_submissions where id=$1',[id])).rows[0].status,'pending')
  })
  await t.test('administrator approves once and shared map retains the point', async () => {
    login('qa-admin'); assert.equal((await api.setCampusPoiSubmissionStatus(id,'approved')).error,null)
    await api.setCampusPoiSubmissionStatus(id,'approved')
    login('qa-student-b'); assert.equal((await api.fetchCampusPois(qa.campus)).rows.filter(p=>p.name===draft.name).length,1)
    const published=(await api.fetchCampusPois(qa.campus)).rows.find(p=>p.name===draft.name)
    assert.equal(published.image_urls[0],draft.images[0]); assert.equal(published.note,draft.note)
  })
  await t.test('rejected points remain absent from shared map', async () => {
    login('qa-student-a'); await api.submitCampusPoi({...draft,name:'虚拟验收·驳回点'})
    const pending=(await api.fetchPendingCampusPoiSubmissions()).rows[0]
    login('qa-admin'); assert.equal((await api.setCampusPoiSubmissionStatus(pending.id,'rejected')).error,null)
    assert.equal((await api.fetchCampusPois(qa.campus)).rows.some(p=>p.name==='虚拟验收·驳回点'),false)
  })
  await t.test('private check-ins are isolated; public check-ins need approval', async () => {
    const poi=(await api.fetchCampusPois(qa.campus)).rows.find(p=>p.name===draft.name)
    login('qa-student-a'); assert.equal((await api.createCampusPoiCheckin(poi.id,'虚拟私密记录',false)).error,null)
    assert.equal((await api.createCampusPoiCheckin(poi.id,'虚拟公开记录',true)).error,null)
    assert.equal((await qa.as('qa-student-b','select * from campus_poi_checkins')).rows.length,0)
    login('qa-admin'); const pending=(await api.fetchPendingCampusPoiCheckins()).rows[0]
    assert.equal((await api.setCampusPoiCheckinStatus(pending.id,'published')).error,null)
    const visible=(await qa.as('qa-student-b','select * from campus_poi_checkins')).rows
    assert.equal(visible.length,1); assert.equal(visible[0].note,'虚拟公开记录')
  })
  await t.test('guest, forged owner and direct approval attempts are rejected', async () => {
    login(''); assert.ok((await api.submitCampusPoi(draft)).error)
    await assert.rejects(qa.as('qa-student-a',"insert into campus_poi_submissions(campus_id,user_uid,name,category,lng,lat,status) values ($1,'qa-student-b','冒名','打卡',119,34,'pending')",[qa.campus]))
    await assert.rejects(qa.as('qa-student-a',"insert into campus_poi_submissions(campus_id,user_uid,name,category,lng,lat,status) values ($1,'qa-student-a','跳过审核','打卡',119,34,'approved')",[qa.campus]))
    login('qa-student-a'); assert.ok((await api.submitCampusPoi({...draft,lng:116})).error)
    assert.ok((await api.submitCampusPoi({...draft,images:Array(4).fill(draft.images[0])})).error)
    assert.ok((await api.submitCampusPoi({...draft,images:['data:image/png;base64,abcd']})).error)
    await assert.rejects(qa.as('qa-student-a',"insert into campus_poi_submissions(campus_id,user_uid,name,category,lng,lat,image_urls) values ($1,'qa-student-a','无效图片','打卡',119,34,ARRAY['javascript:alert(1)'])",[qa.campus]))
  })
  await t.test('migration rerun is idempotent and keeps approved points', async () => {
    await qa.db.exec(readFileSync(new URL('../docs/sql/campus-map-city-134.sql',import.meta.url),'utf8'))
    await qa.db.exec(readFileSync(new URL('../docs/sql/campus-map-photos.sql',import.meta.url),'utf8'))
    assert.equal((await qa.db.query('select * from campus_pois where name=$1',[draft.name])).rows.length,1)
  })
})
test('phone location requests a fresh accurate position and handles denied, timeout, invalid values', async () => {
  let options
  const success=moduleApi('campus-map-location.ts',{}, {navigator:{geolocation:{getCurrentPosition(ok,fail,opts){options=opts;ok({coords:{longitude:119.2,latitude:34.6,accuracy:12}})}}}})
  const result=await success.getCurrentMapLocation(); assert.equal(result.lng,119.2); assert.equal(options.enableHighAccuracy,true); assert.equal(options.maximumAge,0); assert.equal(options.timeout,15000)
  for(const [code,pattern] of [[1,/权限/],[2,/定位服务/],[3,/超时/]]) {
    const failure=moduleApi('campus-map-location.ts',{}, {navigator:{geolocation:{getCurrentPosition(ok,fail){fail({code})}}}})
    await assert.rejects(failure.getCurrentMapLocation(),pattern)
  }
  const invalid=moduleApi('campus-map-location.ts',{}, {navigator:{geolocation:{getCurrentPosition(ok){ok({coords:{longitude:NaN,latitude:34,accuracy:1}})}}}})
  await assert.rejects(invalid.getCurrentMapLocation(),/无效/)
})
test('local points survive reload and cloud-range setup, without leaking between test accounts', () => {
  const store=new Map(), storage={getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value)}
  const api=moduleApi('campus-map-local.ts',{}, {localStorage:storage})
  const pin={id:-1,campus_id:0,name:'虚拟本地点',category:'打卡',lng:119.2,lat:34.6,enabled:true,verification_status:'local'}
  api.saveLocalPin('qa-student-a','lyg',pin)
  const reloaded=moduleApi('campus-map-local.ts',{}, {localStorage:storage})
  assert.equal(reloaded.readLocalPins('qa-student-a','lyg',101).length,1)
  assert.equal(reloaded.readLocalPins('qa-student-b','lyg',101).length,0)
  assert.equal(reloaded.readLocalPins('','lyg',null).length,0)
  assert.throws(()=>reloaded.saveLocalPin('','lyg',pin))
  const approved={...pin,id:100,verification_status:'verified'}
  const newPin={...pin,id:-2,name:'新本地点'}
  assert.equal(reloaded.mergeCampusPois([approved],[pin,newPin]).length,2)
  assert.equal(reloaded.mergeCampusPois([approved],[pin,newPin])[0].verification_status,'verified')
})

test('native Amap routes preserve destination and request WGS84 conversion on both platforms', () => {
  const api = moduleApi('campus-map-navigation.ts', {}, { URL })
  for (const os of ['android', 'ios']) for (const [mode, expected] of [['walk','2'],['ride','3'],['car','0']]) {
    const url = new URL(api.amapAppNavigationUrl({lng:119.21,lat:34.59,name:'测试地点&dev=0'},mode,os))
    assert.equal(url.protocol,os === 'ios' ? 'iosamap:' : 'amapuri:')
    assert.equal(url.searchParams.get('dev'),'1')
    assert.equal(url.searchParams.get('t'),expected)
    assert.equal(url.searchParams.get('dlat'),'34.59')
    assert.equal(url.searchParams.get('dlon'),'119.21')
    assert.equal(url.searchParams.get('dname'),'测试地点&dev=0')
    assert.equal(url.searchParams.has('slat'),false)
  }
  assert.throws(()=>api.amapAppNavigationUrl({lng:NaN,lat:34,name:'无效'},'walk','ios'))
})
