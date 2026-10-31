// Scoped map migrations, passed as literal arguments (no shell SQL interpolation).
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
const root=process.cwd(), mode=process.argv[2]
if (!['audit','apply','verify'].includes(mode)) throw Error('Use audit, apply or verify')
const envId=readFileSync('src/lib/cb.ts','utf8').match(/CB_ENV_ID\s*=\s*'([^']+)'/)[1]
const located=spawnSync('where.exe',['tcb.cmd'],{encoding:'utf8',windowsHide:true})
const cli=join(dirname(located.stdout.trim().split(/\r?\n/)[0]),'node_modules/@cloudbase/cli/bin/tcb')
if (!existsSync(cli)) throw Error('CloudBase CLI is required')
const folder='docs/audit'; mkdirSync(folder,{recursive:true})
function execute(sql) {
  const r=spawnSync(process.execPath,[cli,'db','execute','-e',envId,'-r','ap-shanghai','--json','--sql',sql],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:12*1024*1024})
  const out=String(r.stdout||''); let parsed
  try { parsed=JSON.parse(out.slice(out.indexOf('{'))) } catch {}
  if(r.status!==0||!parsed?.data||parsed.success===false||parsed.error) throw Error(`Cloud operation failed (exit ${r.status}); ${String(parsed?.error?.message||parsed?.message||'raw output withheld').slice(0,300)}`)
  return parsed.data
}
function rows(data) { return (data.Rows||[]).map(raw=>Object.fromEntries(data.Columns.map((col,i)=>[col,(typeof raw==='string'?JSON.parse(raw):raw)[i]]))) }
const queries={
  tables:"SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'campus_%' ORDER BY c.relname",
  columns:"SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name LIKE 'campus_%' ORDER BY table_name,ordinal_position",
  policies:"SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'campus_%' ORDER BY tablename,policyname",
  functions:"SELECT p.proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'campus_%' OR p.proname='is_admin_user')",
}
const report={at:new Date().toISOString(),environment:envId,mode}
for(const [name,sql] of Object.entries(queries)){report[name]=rows(execute(sql));console.log(`${name}: ${report[name].length}`)}
const stamp=new Date().toISOString().replace(/[:.]/g,'-')
writeFileSync(`${folder}/campus-cloud-${mode}-${stamp}.json`,JSON.stringify(report,null,2))
if(mode==='verify') {
  const sql="BEGIN; SET LOCAL ROLE anon; SELECT id,name FROM public.campus_schools WHERE enabled; SELECT id,name FROM public.campus_pois WHERE enabled; EXPLAIN SELECT id,post_id,body,status,created_at FROM public.campus_post_comments WHERE status='published'; RESET ROLE; SET LOCAL ROLE authenticated; EXPLAIN INSERT INTO public.campus_poi_submissions(campus_id,user_uid,name,category,lng,lat,image_urls) VALUES (0,auth.uid()::text,'__plan_only__','打卡',119.2,34.5,ARRAY[]::text[]); EXPLAIN UPDATE public.campus_poi_submissions SET status='approved' WHERE false; ROLLBACK;"
  report.roleCheck=execute(sql)
  report.scope='Public map reads and EXPLAIN only (without ANALYZE); no user rows inserted or updated.'
  writeFileSync(`${folder}/campus-cloud-verified-${stamp}.json`,JSON.stringify(report,null,2))
  console.log('Anonymous public reads and authenticated query planning passed; no test records written.')
}
if(mode==='apply') {
  // Existing installations keep their school metadata and verified POIs; only create missing base/city schema.
  const sources=[]
  if(!report.tables.some(t=>t.relname==='campus_schools')) sources.push('campus-map-132.sql')
  if(!report.tables.some(t=>t.relname==='campus_poi_submissions')) sources.push('campus-map-city-134.sql')
  sources.push('campus-map-photos.sql')
  report.applied=[]
  for(const source of sources){const sql=readFileSync(`docs/sql/${source}`,'utf8');const result=execute(sql);report.applied.push({source,sha256:createHash('sha256').update(sql).digest('hex'),requestId:result.RequestId});console.log(`Applied ${source}`)}
  writeFileSync(`${folder}/campus-cloud-applied-${stamp}.json`,JSON.stringify(report,null,2))
}
