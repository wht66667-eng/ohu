import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const env = readFileSync(join(root, 'src/lib/cb.ts'), 'utf8').match(/CB_ENV_ID\s*=\s*'([^']+)'/)[1]
const located = spawnSync('where.exe', ['tcb.cmd'], { encoding: 'utf8', windowsHide: true })
const cli = join(dirname(located.stdout.trim().split(/\r?\n/)[0]), 'node_modules/@cloudbase/cli/bin/tcb')
export function query(sql) {
  const r = spawnSync(process.execPath, [cli, 'db', 'execute', '-e', env, '-r', 'ap-shanghai', '--json', '--sql', sql], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 45000, maxBuffer: 20 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`Database command failed (${r.status}); raw output withheld`)
  const parsed = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
  const d = parsed.data
  if (!d || !Array.isArray(d.Rows) || !Array.isArray(d.Columns)) throw new Error('Unexpected database response; raw output withheld')
  return d.Rows.map(v => { const row = typeof v === 'string' ? JSON.parse(v) : v; return Object.fromEntries(d.Columns.map((c, i) => [c, row[i]])) })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const queries = {
    roles: `SELECT rolname,rolsuper,rolinherit,rolbypassrls FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','authenticator')`,
    relations: `SELECT n.nspname AS schema,c.relname AS name,c.relkind,c.relrowsecurity AS rls,c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth') AND c.relkind IN ('r','p','v') ORDER BY n.nspname,c.relname`,
    permissions: `SELECT n.nspname AS schema,c.relname AS name,r.rolname AS role,has_schema_privilege(r.oid,n.oid,'USAGE') AS schema_usage,has_table_privilege(r.oid,c.oid,'SELECT') AS can_select,has_table_privilege(r.oid,c.oid,'UPDATE') AS can_update FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN pg_roles r WHERE n.nspname IN ('auth','public') AND c.relkind IN ('r','p','v') AND r.rolname IN ('anon','authenticated') ORDER BY n.nspname,c.relname,r.rolname`,
    columns: `SELECT table_schema,table_name,column_name,data_type FROM information_schema.columns WHERE table_schema IN ('public','auth') AND (table_schema='auth' OR column_name ~* '(phone|mobile|contact|email|metadata|password|token|secret)' OR table_name IN ('profiles','admin_accounts','activity_signups','feedbacks','activities')) ORDER BY table_schema,table_name,ordinal_position`,
    policies: `SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname IN ('public','auth') ORDER BY schemaname,tablename,policyname`,
    functions: `SELECT n.nspname AS schema,p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_function_result(p.oid) AS result,p.prosecdef AS definer,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,regexp_replace(p.prosrc,'''([^'']|'''')*''','''[literal]''','g') AS body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.proname,p.oid`,
    views: `SELECT c.relname AS name,c.reloptions,pg_get_viewdef(c.oid,true) AS definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='v' ORDER BY c.relname`,
  }
  const report = { captured_at: new Date().toISOString(), environment: env, scope: 'Catalog metadata only; no user records or phone values queried.' }
  for (const [name, sql] of Object.entries(queries)) { report[name] = query(sql); console.log(`${name}: ${report[name].length}`) }
  const output=join(root, `docs/audit/phone-privacy-catalog-${report.captured_at.replace(/[:.]/g,'-')}.json`)
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {flag:'wx'})
  console.log(`Saved metadata audit: ${output}`)
}
