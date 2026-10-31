/** Catalog-only audit: never reads personal posts, creates users or executes business RPCs. */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
const root = process.cwd()
const envId = readFileSync(join(root, 'src/lib/cb.ts'), 'utf8').match(/CB_ENV_ID\s*=\s*'([^']+)'/)?.[1]
const located = spawnSync('where.exe', ['tcb.cmd'], { encoding: 'utf8', windowsHide: true })
const cli = join(dirname(String(located.stdout || '').trim().split(/\r?\n/)[0] || ''), 'node_modules/@cloudbase/cli/bin/tcb')
if (!envId || !existsSync(cli)) throw new Error('Existing project environment and installed CLI are required')
const tables = "('moments','moments_likes','moments_comments')"
const queries = {
  friend_columns: "SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('friends','friend_requests') ORDER BY table_name,ordinal_position",
  friend_policies: "SELECT tablename,policyname,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename IN ('friends','friend_requests') ORDER BY tablename,policyname",
  permissions: `SELECT c.relname AS name,r.rolname AS role,has_table_privilege(r.oid,c.oid,'SELECT') AS can_select,has_table_privilege(r.oid,c.oid,'INSERT') AS can_insert,has_table_privilege(r.oid,c.oid,'DELETE') AS can_delete FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN pg_roles r WHERE n.nspname='public' AND c.relname IN ${tables} AND r.rolname IN ('anon','authenticated') ORDER BY c.relname,r.rolname`,
  columns: `SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name IN ${tables} ORDER BY table_name,ordinal_position`,
  policies: `SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename IN ${tables} ORDER BY tablename,policyname`,
  constraints: `SELECT c.relname AS table_name,con.conname,con.contype,pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ${tables} ORDER BY c.relname,con.conname`,
  rls: `SELECT c.relname AS name,c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ${tables}`,
}
const report = { captured_at: new Date().toISOString(), environment: envId, scope: 'Catalog SELECT only; no personal posts, user authentication, inserts or business RPCs.' }
for (const [name, sql] of Object.entries(queries)) {
  const result = spawnSync(process.execPath, [cli, 'db', 'execute', '-e', envId, '-r', 'ap-shanghai', '--json', '--sql', sql], { encoding: 'utf8', windowsHide: true, timeout: 45000, maxBuffer: 8 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`Metadata query ${name} failed; raw output withheld`)
  const data = JSON.parse(result.stdout.slice(result.stdout.indexOf('{'))).data
  if (!Array.isArray(data?.Rows) || !Array.isArray(data?.Columns)) throw new Error(`Invalid metadata ${name}`)
  report[name] = data.Rows.map(raw => { const row = typeof raw === 'string' ? JSON.parse(raw) : raw; return Object.fromEntries(data.Columns.map((column, i) => [column, row[i]])) })
  console.log(`${name}: ${report[name].length}`)
}
writeFileSync(join(root, 'docs/audit/moments-schema-readonly-2026-10-21.json'), JSON.stringify(report, null, 2) + '\n')
