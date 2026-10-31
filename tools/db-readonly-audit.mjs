#!/usr/bin/env node
/** Metadata-only CloudBase audit. No .env/config-token reads and no business RPC calls. */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envId = readFileSync(join(ROOT, 'src/lib/cb.ts'), 'utf8').match(/CB_ENV_ID\s*=\s*'([^']+)'/)?.[1]
if (!envId) throw new Error('CB_ENV_ID is missing')
const located = spawnSync('where.exe', ['tcb.cmd'], { encoding: 'utf8', windowsHide: true })
const cliDir = dirname(String(located.stdout || '').trim().split(/\r?\n/)[0] || '')
const cli = join(cliDir, 'node_modules/@cloudbase/cli/bin/tcb')
if (!existsSync(cli)) throw new Error('An installed CloudBase CLI is required; no automatic download')

const KEY_TABLES = "('friends','friend_requests','chat_threads','chat_messages','notifications','news','news_broadcasts','news_broadcast_reads','profiles','admin_accounts','role_members','role_apps','withdraw_apps','reports','operation_governance_log','operation_stock_refund_authorization','shop_stores','shop_groups','shop_group_members','shop_goods','shop_products','shop_orders','shop_movements','canteen_stores','canteen_orders','wallets','wallet_ledger','pay_config','function_rate_limits')"
const queries = {
  tables: `SELECT c.relname AS name,c.relkind AS kind,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m') ORDER BY c.relname`,
  columns: `SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name IN ${KEY_TABLES} ORDER BY table_name,ordinal_position`,
  table_permissions: `SELECT c.relname AS name,r.rolname AS role,has_table_privilege(r.oid,c.oid,'SELECT') AS can_select,has_table_privilege(r.oid,c.oid,'INSERT') AS can_insert,has_table_privilege(r.oid,c.oid,'UPDATE') AS can_update,has_table_privilege(r.oid,c.oid,'DELETE') AS can_delete FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN pg_roles r WHERE n.nspname='public' AND c.relkind IN ('r','p','v') AND r.rolname IN ('anon','authenticated') ORDER BY c.relname,r.rolname`,
  policies: `SELECT tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename IN ${KEY_TABLES} ORDER BY tablename,policyname`,
  constraints: `SELECT c.relname AS table_name,con.conname,con.contype,pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ${KEY_TABLES} ORDER BY c.relname,con.conname`,
  indexes: `SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('friends','friend_requests','chat_threads','chat_messages','notifications') ORDER BY tablename,indexname`,
  functions: `SELECT p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_function_result(p.oid) AS result_type,p.prosecdef AS security_definer,p.proconfig AS config,has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,md5(regexp_replace(p.prosrc,'[[:space:]]+','','g')) AS body_md5 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.proname,arguments`,
  triggers: `SELECT c.relname AS table_name,t.tgname AS trigger_name,p.proname AS function_name,t.tgenabled AS enabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,
  views: `SELECT c.relname AS name,c.reloptions AS options,pg_get_viewdef(c.oid,true) AS definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='v' AND (c.relname LIKE 'v_shop%' OR c.relname LIKE 'v_canteen%' OR c.relname IN ('v_news_public','v_errand_orders_public','v_meals_items_public','v_tutor_orders_public')) ORDER BY c.relname`,
  guard_sources: `SELECT p.proname AS name,regexp_replace(p.prosrc,'''([^'']|'''')*''','''[literal]''','g') AS redacted_body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname ~ '^(admin_|is_admin|is_super_admin|chat_|notify_|role_|withdraw_|commission_|store_|news_broadcast|operation_)' OR p.proname IN ('bootstrap_named_super_admin','ensure_bootstrap_super_admin','guard_profiles_privileges','rate_limit_hit')) ORDER BY p.proname`,
}

function run(name, sql) {
  // Every fixed query above is a single catalog SELECT. No SQL file/input is accepted.
  if (!/^SELECT\b/i.test(sql) || sql.includes(';')) throw new Error(`Unsafe audit query: ${name}`)
  const r = spawnSync(process.execPath, [cli, 'db', 'execute', '-e', envId, '-r', 'ap-shanghai', '--json', '--sql', sql], {
    cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 45000, maxBuffer: 20 * 1024 * 1024,
  })
  const out = String(r.stdout || '')
  if (r.status !== 0) {
    const auth = /login|not logged|认证|未登录|expired|credential/i.test(out + String(r.stderr || ''))
    throw new Error(`Audit query ${name} failed (exit ${r.status}; authentication issue: ${auth}). Raw output withheld.`)
  }
  const start = out.indexOf('{')
  const data = JSON.parse(out.slice(start)).data
  if (!data || !Array.isArray(data.Rows) || !Array.isArray(data.Columns)) throw new Error(`Unexpected CLI result: ${name}`)
  return data.Rows.map(raw => {
    const row = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Object.fromEntries(data.Columns.map((col, i) => [col, row[i]]))
  })
}

const report = { captured_at: new Date().toISOString(), environment: envId, scope: 'Metadata only; no business rows or function execution; CLI owner connection, not an end-user authorization test.' }
for (const [name, sql] of Object.entries(queries)) {
  report[name] = run(name, sql)
  console.log(`${name}: ${report[name].length}`)
}
const folder = join(ROOT, 'docs/audit')
mkdirSync(folder, { recursive: true })
const output = join(folder, 'cloud-schema-readonly-2026-10-15.json')
writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(`Metadata report saved: ${output}`)
