/** Fixed reviewed moments policy transaction and metadata/role checks. No business inserts. */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
const root = process.cwd(), envId = readFileSync(join(root, 'src/lib/cb.ts'), 'utf8').match(/CB_ENV_ID\s*=\s*'([^']+)'/)?.[1]
const located = spawnSync('where.exe', ['tcb.cmd'], { encoding: 'utf8', windowsHide: true })
const cli = join(dirname(String(located.stdout || '').trim().split(/\r?\n/)[0] || ''), 'node_modules/@cloudbase/cli/bin/tcb')
if (!envId || !existsSync(cli)) throw Error('Existing CLI and project environment required')
function execute(sql) {
  const result = spawnSync(process.execPath, [cli, 'db', 'execute', '-e', envId, '-r', 'ap-shanghai', '--json', '--sql', sql], { encoding: 'utf8', windowsHide: true, timeout: 45000, maxBuffer: 4 * 1024 * 1024 })
  const output = String(result.stdout || '')
  if (result.status !== 0) throw Error(`Fixed moments operation failed (exit ${result.status}); no raw output printed`)
  const json = JSON.parse(output.slice(output.indexOf('{')))
  if (json.success === false || json.error) throw Error('Fixed moments database operation returned an error')
  return json.data
}
const mode = process.argv[2]
if (mode === '--apply') {
  if (!existsSync(join(root, 'docs/audit/moments-schema-before-130.json'))) throw Error('Policy backup is required')
  const sql = readFileSync(join(root, 'docs/sql/moments-visibility-130.sql'), 'utf8')
  const data = execute(sql)
  const record = { applied_at: new Date().toISOString(), environment: envId, source: 'docs/sql/moments-visibility-130.sql', sha256: createHash('sha256').update(sql).digest('hex'), scope: 'Five reviewed policies in a transaction; no business-row writes or grant changes', result: data }
  writeFileSync(join(root, 'docs/audit/moments-policy-deployed-130.json'), JSON.stringify(record, null, 2) + '\n')
  console.log('Reviewed policy transaction applied; metadata report saved')
} else if (mode === '--role-check') {
  // Synthetic nonexistent identity and WHERE false: validates production RLS compilation without reading personal rows.
  const data = execute("BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{\"sub\":\"__moments130_no_real_account__\",\"role\":\"authenticated\"}',true); EXPLAIN (FORMAT JSON) SELECT id FROM public.moments WHERE false; EXPLAIN (FORMAT JSON) SELECT id FROM public.moments_likes WHERE false; EXPLAIN (FORMAT JSON) SELECT id FROM public.moments_comments WHERE false; ROLLBACK;")
  writeFileSync(join(root, 'docs/audit/moments-role-check-130.json'), JSON.stringify({ checked_at: new Date().toISOString(), scope: 'Production authenticated role query planning only; WHERE false, no business rows read; not an end-user token test', result: data }, null, 2) + '\n')
  console.log('Production authenticated RLS planning passed for all three tables; no rows read')
} else if (mode === '--policy-matrix') {
  const metadata = JSON.parse(readFileSync(join(root, 'docs/audit/moments-schema-readonly-2026-10-21.json'), 'utf8'))
  const live = metadata.policies.find(row => row.tablename === 'moments' && row.policyname === 'moments_select_visible')?.qual
  if (!live?.includes("r.status = 'accepted'")) throw Error('Refreshed production policy required')
  const cases = [
    ['owner-private','A','A','private','X','Y','pending',true],
    ['stranger-private','B','A','private','B','A','accepted',false],
    ['signed-public','B','A','public','X','Y','pending',true],
    ['forward-friend','B','A','friends_only','B','A','accepted',true],
    ['reverse-friend','B','A','friends_only','A','B','accepted',true],
    ['pending-request','B','A','friends_only','A','B','pending',false],
    ['rejected-request','B','A','friends_only','A','B','rejected',false],
    ['unrelated-edge','B','A','friends_only','X','Y','accepted',false],
    ['no-edge','B','A','friends_only','X','Y','accepted',false],
  ]
  const quote = value => `'${String(value).replaceAll("'", "''")}'`
  const sql = cases.map(([label,viewer,creator,visibility,edgeFrom,edgeTo,status,expected]) => {
    const expr = live.replaceAll('auth.uid()', 'moments.viewer')
      .replace(/FROM friends f/g, `FROM (VALUES (${quote(edgeFrom)},${quote(edgeTo)})) f(user_uid,friend_uid)`)
      .replace(/FROM friend_requests r/g, `FROM (VALUES (${quote(viewer)},${quote(creator)},${quote(status)})) r(from_uid,to_uid,status)`)
    return `SELECT ${quote(label)} AS scenario,(${expr}) AS actual,${expected} AS expected FROM (VALUES (${quote(viewer)},${quote(creator)},${quote(visibility)})) moments(viewer,creator_uid,visibility)`
  }).join(' UNION ALL ')
  const data = execute(sql)
  if (!Array.isArray(data?.Rows) || data.Rows.length !== cases.length) throw Error('Unexpected matrix result')
  const rows = data.Rows.map(raw => typeof raw === 'string' ? JSON.parse(raw) : raw)
  if (rows.some(row => String(row[1]) !== String(row[2]))) throw Error('Production policy expression matrix failed')
  writeFileSync(join(root, 'docs/audit/moments-policy-matrix-130.json'), JSON.stringify({ checked_at: new Date().toISOString(), scope: 'Exact live policy expression evaluated by production PostgreSQL against only inline synthetic VALUES. Does not insert any rows or use real user identities.', results: rows.map(row => ({scenario:row[0],actual:row[1],expected:row[2]})), request_id: data.RequestId }, null, 2) + '\n')
  console.log(`Production policy expression: ${rows.length} synthetic cases passed`)
} else throw Error('Use --apply, --role-check or --policy-matrix')
