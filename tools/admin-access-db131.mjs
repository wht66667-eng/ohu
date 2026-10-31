/** Fixed catalog backup and reviewed transaction for atomic account moderation. No live user tests. */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
const root = process.cwd()
const envId = readFileSync(join(root, 'src/lib/cb.ts'), 'utf8').match(/CB_ENV_ID\s*=\s*'([^']+)'/)?.[1]
const located = spawnSync('where.exe', ['tcb.cmd'], { encoding: 'utf8', windowsHide: true })
const cli = join(dirname(String(located.stdout || '').trim().split(/\r?\n/)[0] || ''), 'node_modules/@cloudbase/cli/bin/tcb')
if (!envId || !existsSync(cli)) throw Error('Existing project CLI and environment required')
function execute(sql) {
  const result = spawnSync(process.execPath, [cli, 'db', 'execute', '-e', envId, '-r', 'ap-shanghai', '--json', '--sql', sql], { encoding: 'utf8', windowsHide: true, timeout: 45000, maxBuffer: 4 * 1024 * 1024 })
  if (result.status !== 0) throw Error('Account moderation database operation failed; raw output withheld')
  const parsed = JSON.parse(String(result.stdout).slice(String(result.stdout).indexOf('{')))
  if (parsed.success === false || parsed.error || !parsed.data) throw Error('Database returned an error; raw output withheld')
  return parsed.data
}
const mode = process.argv[2]
const catalog = `SELECT p.proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('admin_ban_user','admin_unban_user','admin_search_users','admin_resolve_uid','is_super_admin_user','admin_set_account_access') ORDER BY p.proname`
if (mode === '--backup' || mode === '--verify') {
  const functions = execute(catalog)
  const columns = execute("SELECT table_name,column_name,data_type,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('profiles','user_sanctions') ORDER BY table_name,ordinal_position")
  const privileges = execute("SELECT p.proname,r.rolname,has_function_privilege(r.oid,p.oid,'EXECUTE') AS can_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN pg_roles r WHERE n.nspname='public' AND p.proname IN ('admin_set_account_access','admin_ban_user','admin_unban_user') AND r.rolname IN ('anon','authenticated') ORDER BY p.proname,r.rolname")
  const file = `.codex/qa/admin131-${mode === '--backup' ? 'before' : 'after'}.json`
  let verified
  if (mode === '--verify') {
    const source = readFileSync('docs/sql/admin-account-access-131.sql', 'utf8')
    const expectedBody = source.match(/AS \$function\$([\s\S]*?)\$function\$/)?.[1]
    const installed = functions.Rows.map(row => typeof row === 'string' ? JSON.parse(row) : row).filter(row => row[0] === 'admin_set_account_access')
    const grants = privileges.Rows.map(row => typeof row === 'string' ? JSON.parse(row) : row).filter(row => row[0] === 'admin_set_account_access')
    verified = installed.length === 1 && installed[0][1].match(/AS \$function\$([\s\S]*?)\$function\$/)?.[1] === expectedBody
      && /SECURITY DEFINER/.test(installed[0][1])
      && grants.some(row => row[1] === 'authenticated' && String(row[2]) === 'true')
      && grants.some(row => row[1] === 'anon' && String(row[2]) === 'false')
    if (!verified) throw Error('Installed account access function/grants do not match the reviewed source')
  }
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), environment: envId, verified, scope: 'Catalog only, no user rows or business RPC execution', functions, columns, privileges }, null, 2) + '\n')
  console.log(`Saved ${file}`)
} else if (mode === '--apply') {
  if (!existsSync('.codex/qa/admin131-before.json')) throw Error('Catalog backup required')
  const backup = JSON.parse(readFileSync('.codex/qa/admin131-before.json', 'utf8'))
  if (backup.environment !== envId) throw Error('Catalog backup must belong to the current environment')
  const file = 'docs/sql/admin-account-access-131.sql'
  const sql = readFileSync(file, 'utf8')
  const hash = createHash('sha256').update(sql).digest('hex')
  const proof = JSON.parse(readFileSync('.codex/qa/admin131-sql-test.json', 'utf8'))
  if (process.argv[3] !== '--reviewed-sha256' || process.argv[4] !== hash || !proof.passed || proof.sha256 !== hash || proof.results.length < 12 || proof.results.some(item => !item.passed)) throw Error('The exact reviewed SQL must pass isolated transaction checks before applying')
  const result = execute(sql)
  writeFileSync('.codex/qa/admin131-applied.json', JSON.stringify({ at: new Date().toISOString(), source: file, sha256: hash, scope: 'Function definition/grants only; no existing business row rewrites', result }, null, 2) + '\n')
  console.log('Reviewed account access function installed')
} else if (mode === '--role-check') {
  const result = execute("BEGIN; SET LOCAL ROLE authenticated; EXPLAIN (FORMAT JSON) SELECT public.admin_set_account_access('__admin131_no_real_account__',false,'__admin131_no_real_uid__','planning-only') WHERE false; ROLLBACK;")
  writeFileSync('.codex/qa/admin131-role-check.json', JSON.stringify({ at: new Date().toISOString(), scope: 'EXPLAIN without ANALYZE and WHERE false; function never executed, no business rows read or changed', result }, null, 2) + '\n')
  console.log('Authenticated function planning passed without execution')
} else throw Error('Use --backup, --verify, --role-check or --apply --reviewed-sha256 HASH')
