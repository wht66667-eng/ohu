import {spawnSync} from 'node:child_process'
import {readFileSync,writeFileSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {createHash} from 'node:crypto'
const env=readFileSync('src/lib/cb.ts','utf8').match(/CB_ENV_ID\s*=\s*'([^']+)'/)[1]
const loc=spawnSync('where.exe',['tcb.cmd'],{encoding:'utf8',windowsHide:true})
const cli=join(dirname(loc.stdout.trim().split(/\r?\n/)[0]),'node_modules/@cloudbase/cli/bin/tcb')
const sql=readFileSync('docs/sql/phone-privacy-verify-149.sql','utf8')
const r=spawnSync(process.execPath,[cli,'db','execute','-e',env,'-r','ap-shanghai','--json','--sql',sql],{encoding:'utf8',windowsHide:true,timeout:45000,maxBuffer:4*1024*1024})
if(r.status!==0){
  const raw=String(r.stdout||'')+String(r.stderr||'')
  const checks=[...raw.matchAll(/(?:Unauthorized cross-user rows in [a-z_]+|Probe identity not applied|permission denied for [a-z_ ]+|Authentication table exposed|Incident evidence exposed|Ordinary user can search authentication data)/g)].map(m=>m[0])
  console.error(JSON.stringify({exit:r.status,checks,output_withheld:true}));process.exit(1)
}
const report={verified_at:new Date().toISOString(),environment:env,pass:true,sql_sha256:createHash('sha256').update(sql).digest('hex'),scope:'Live SET LOCAL ROLE authenticated with a synthetic non-user UID, and anon; no personal rows exported; entire probe rolled back. This is database-role verification, not a real client JWT end-to-end test.',checks:['13 private tables returned zero cross-user rows','auth.users read denied','incident evidence read denied','legacy escalation RPC denied','ordinary user account search denied','anonymous admin predicates false and auth.users read denied']}
writeFileSync('docs/audit/phone-privacy-live-role-verification-2026-11-02.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))
