/** Fixed 131 friendship migration. Default modes only read catalog metadata. */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'

const root = process.cwd(), mode = process.argv[2]
if (!['--backup','--audit','--apply','--role-check'].includes(mode)) throw Error('Use --backup, --audit, --role-check, or --apply --reviewed-sha256 HASH')
const source = 'docs/sql/friends-authorization-131.sql'
const sql = readFileSync(join(root, source), 'utf8')
const sha256 = createHash('sha256').update(sql).digest('hex')
if (mode === '--apply' && process.argv[3] !== '--reviewed-sha256') throw Error('Applying requires an explicit reviewed SQL hash')
if (mode === '--apply' && process.argv[4] !== sha256) throw Error('Reviewed SQL hash does not match the current migration')
const envId = readFileSync(join(root, 'src/lib/cb.ts'), 'utf8').match(/CB_ENV_ID\s*=\s*'([^']+)'/)?.[1]
const located = spawnSync('where.exe', ['tcb.cmd'], { encoding: 'utf8', windowsHide: true })
const cli = join(dirname(String(located.stdout || '').trim().split(/\r?\n/)[0] || ''), 'node_modules/@cloudbase/cli/bin/tcb')
if (!envId || !existsSync(cli)) throw Error('Existing project environment and installed CloudBase CLI required')
const auditDir = join(root, 'docs/audit'), backupPath = join(auditDir, 'friends-schema-before-131.json')
mkdirSync(auditDir, { recursive: true })
function execute(statement) {
  const result = spawnSync(process.execPath, [cli, 'db', 'execute', '-e', envId, '-r', 'ap-shanghai', '--json', '--sql', statement], {
    encoding: 'utf8', windowsHide: true, timeout: 45000, maxBuffer: 8 * 1024 * 1024,
  })
  if (result.status !== 0) throw Error(`Fixed friendship operation failed (exit ${result.status}); raw output withheld`)
  const output = String(result.stdout || ''), data = JSON.parse(output.slice(output.indexOf('{')))
  if (data.success === false || data.error || !data.data) throw Error('Fixed friendship operation returned an error; raw output withheld')
  return data.data
}
function rows(data) {
  if (!Array.isArray(data.Columns)) throw Error('Malformed catalog result')
  return (data.Rows || []).map(raw => {
    const row = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Object.fromEntries(data.Columns.map((column, i) => [column, row[i]]))
  })
}
const tables = "('friends','friend_requests')"
const functionNames = "('friend_request_guard_131','friend_edge_legacy_insert_131','friend_request_accept_edge_131')"
function audit() {
  const queries = {
    context: "SELECT current_user,session_user,version(),has_schema_privilege('authenticated','public','CREATE') AS client_schema_create,(SELECT rolbypassrls FROM pg_roles WHERE rolname='authenticated') AS client_bypass_rls",
    tables: `SELECT c.relname,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ${tables} ORDER BY c.relname`,
    privileges: `SELECT c.relname AS name,r.rolname AS role,has_table_privilege(r.oid,c.oid,'SELECT') AS can_select,has_table_privilege(r.oid,c.oid,'INSERT') AS can_insert,has_table_privilege(r.oid,c.oid,'UPDATE') AS can_update,has_table_privilege(r.oid,c.oid,'DELETE') AS can_delete,has_table_privilege(r.oid,c.oid,'TRIGGER') AS can_trigger,has_table_privilege(r.oid,c.oid,'TRUNCATE') AS can_truncate FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN pg_roles r WHERE n.nspname='public' AND c.relname IN ${tables} AND r.rolname IN ('anon','authenticated') ORDER BY c.relname,r.rolname`,
    policies: `SELECT tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND (tablename IN ${tables} OR (tablename='moments' AND policyname='moments_select_visible')) ORDER BY tablename,policyname`,
    columns: `SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name IN ${tables} ORDER BY table_name,ordinal_position`,
    constraints: `SELECT c.relname AS table_name,con.conname,con.contype,pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ${tables} ORDER BY c.relname,con.conname`,
    indexes: `SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ${tables} ORDER BY tablename,indexname`,
    triggers: `SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) AS definition,t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ${tables} AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,
    functions: `SELECT p.proname,pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proconfig,p.prosrc AS body_source,pg_get_functiondef(p.oid) AS definition,has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,has_function_privilege('authenticated',p.oid,'EXECUTE') AS client_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ${functionNames} ORDER BY p.proname`,
  }
  const report = { captured_at: new Date().toISOString(), environment: envId, source, source_sha256: sha256, scope: 'Catalog SELECT only; no personal business rows, end-user authentication, business writes or RPCs.', request_ids: [] }
  for (const [name, statement] of Object.entries(queries)) {
    const result = execute(statement)
    report[name] = rows(result); report.request_ids.push(result.RequestId)
    console.log(`${name}: ${report[name].length}`)
  }
  return report
}

if (mode === '--backup') {
  if (existsSync(backupPath)) throw Error('Original backup already exists; do not overwrite it. Use --audit for a fresh catalog snapshot.')
  const report = audit()
  if (report.triggers.some(row => ['friend_request_guard_131','friend_edge_legacy_insert_131','friend_request_accept_edge_131'].includes(row.tgname))) throw Error('131 is already applied; this is not a pre-migration backup')
  writeFileSync(backupPath, JSON.stringify(report, null, 2) + '\n')
  console.log(`Read-only backup saved. Migration SHA-256: ${sha256}`)
} else if (mode === '--apply') {
  if (!existsSync(backupPath)) throw Error('Run the read-only --backup mode before applying')
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'))
  if (backup.environment !== envId) throw Error('Backup belongs to a different environment')
  const proofPath = join(root,'.codex/qa/friends131-sql-test.json')
  if (!existsSync(proofPath)) throw Error('Isolated PostgreSQL regression evidence is required')
  const proof = JSON.parse(readFileSync(proofPath,'utf8'))
  if (!proof.passed || proof.migration_sha256 !== sha256 || proof.cases.length < 15 || proof.cases.some(row => !row.passed)) throw Error('SQL regression evidence must pass for the exact reviewed migration hash, including inherited-role boundaries')
  const result = execute(sql)
  writeFileSync(join(auditDir,'friends-policy-deployed-131.json'), JSON.stringify({ applied_at:new Date().toISOString(),environment:envId,source,sha256,scope:'Three trigger functions, three triggers, three write policies and trigger/truncate privilege revocation in one transaction. No historical business-row writes.',request_id:result.RequestId,affected_rows:result.AffectedRows },null,2)+'\n')
  console.log('Reviewed migration applied; run --audit and --role-check to verify production metadata')
} else if (mode === '--audit') {
  const report = audit()
  const policy = (table,name) => report.policies.find(row => row.tablename===table && row.policyname===name)
  const expected = ['friend_request_guard_131','friend_edge_legacy_insert_131','friend_request_accept_edge_131']
  const normalizeBody = value => String(value || '').replaceAll('\r\n','\n').trim()
  const expectedBodies = new Map([...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_0-9]+)\(\)[\s\S]*?AS \$function\$([\s\S]*?)\$function\$;/g)].map(match => [match[1],normalizeBody(match[2])]))
  report.verification = {
    has_all_enabled_triggers: expected.every(name=>report.triggers.some(row=>row.tgname===name && row.tgenabled==='O')),
    client_functions_not_executable: expected.every(name=>report.functions.some(row=>row.proname===name && String(row.client_execute)==='false' && String(row.anon_execute)==='false')),
    function_bodies_match_reviewed_sql: expected.every(name=>report.functions.some(row=>row.proname===name && normalizeBody(row.body_source)===expectedBodies.get(name))),
    friends_direct_insert_denied: policy('friends','friends_insert_own')?.with_check === 'false',
    requests_start_pending: /pending/.test(policy('friend_requests','friend_requests_insert_own')?.with_check||''),
    decisions_require_pending: /pending/.test(policy('friend_requests','friend_requests_update_own')?.qual||''),
    no_client_trigger_or_truncate: report.privileges.every(row=>String(row.can_trigger)==='false' && String(row.can_truncate)==='false'),
  }
  report.verified = Object.values(report.verification).every(Boolean)
  writeFileSync(join(auditDir,'friends-schema-readonly-131.json'),JSON.stringify(report,null,2)+'\n')
  if (!report.verified) throw Error('Production friendship metadata does not yet match the 131 migration; see the saved report')
  console.log('Production friendship triggers, policies and privileges verified; no business rows read')
} else {
  const result=execute("BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{\"sub\":\"__friends131_no_real_account__\",\"role\":\"authenticated\"}',true); EXPLAIN (FORMAT JSON) SELECT id FROM public.friends WHERE false; EXPLAIN (FORMAT JSON) SELECT id FROM public.friend_requests WHERE false; EXPLAIN (FORMAT JSON) UPDATE public.friend_requests SET status='accepted' WHERE false RETURNING id,status; ROLLBACK;")
  writeFileSync(join(auditDir,'friends-role-check-131.json'),JSON.stringify({checked_at:new Date().toISOString(),environment:envId,source_sha256:sha256,scope:'Production authenticated role planning only; EXPLAIN without ANALYZE and WHERE false. No business writes, real user identity or row reads.',request_id:result.RequestId,result},null,2)+'\n')
  console.log('Authenticated role query/update planning passed without executing a business mutation')
}
