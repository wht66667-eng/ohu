// Explicit, narrowly scoped production security migration. No general SQL input.
import { spawnSync } from 'node:child_process'
import { readFileSync,writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname,join } from 'node:path'
import { query } from './phone-privacy-audit.mjs'
if (!process.argv.includes('--apply')) throw Error('Use --apply only after isolated PostgreSQL validation')
const phase=process.argv.includes('--contacts')?'contacts':'privileges'
const file=phase==='contacts'?'docs/sql/contact-privacy-149.sql':'docs/sql/phone-privacy-lockdown-149.sql'
const sql=readFileSync(file,'utf8')
if (!sql.includes('BEGIN;') || !sql.trim().endsWith('COMMIT;')) throw Error('Atomic migration required')
const env=readFileSync('src/lib/cb.ts','utf8').match(/CB_ENV_ID\s*=\s*'([^']+)'/)[1]
const located=spawnSync('where.exe',['tcb.cmd'],{encoding:'utf8',windowsHide:true})
const cli=join(dirname(located.stdout.trim().split(/\r?\n/)[0]),'node_modules/@cloudbase/cli/bin/tcb')
const r=spawnSync(process.execPath,[cli,'db','execute','-e',env,'-r','ap-shanghai','--json','--sql',sql],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:4*1024*1024})
if(r.status!==0) {
  // Never print SQL output: migration/query errors may echo data or identities.
  const raw=String(r.stdout||'')+String(r.stderr||'')
  const codes=[...raw.matchAll(/\b(?:42[0-9A-Z]{3}|22[0-9A-Z]{3}|55P03|57014)\b/g)].map(m=>m[0])
  console.error(JSON.stringify({exit:r.status,codes:[...new Set(codes)],output_withheld:true}));process.exit(1)
}
const checks=phase==='privileges'?query(`SELECT
 NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_bootstrap_named_super_admin') AS bootstrap_trigger_removed,
 NOT has_function_privilege('authenticated','public.ensure_bootstrap_super_admin()','EXECUTE') AS bootstrap_rpc_closed,
 NOT has_table_privilege('authenticated','auth.users','SELECT') AS auth_table_private,
 NOT has_schema_privilege('authenticated','ohu_security','USAGE') AS evidence_private,
 (SELECT count(*) FROM ohu_security.role_quarantine) AS quarantined_roles,
 (SELECT count(DISTINCT uid) FROM ohu_security.admin_identity_sources WHERE role='super_admin') AS bound_owners,
 (SELECT count(*) FROM public.profiles WHERE is_super_admin) AS active_super_flags`):query(`SELECT tablename,policyname,permissive,roles,cmd,qual FROM pg_policies WHERE schemaname='public' AND policyname LIKE '%privacy_149%' ORDER BY tablename,policyname`)
const report={applied_at:new Date().toISOString(),environment:env,phase,sql:file,sha256:createHash('sha256').update(sql).digest('hex'),checks,scope:'No user phone values exported; private evidence retained in database.'}
writeFileSync(`docs/audit/phone-privacy-${phase}-applied-2026-11-02.json`,JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))
