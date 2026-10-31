// Isolated PostgreSQL-compatible test database. Never connects to CloudBase.
import { PGlite } from '../.map-qa-runtime/node_modules/@electric-sql/pglite/dist/index.js'
import { readFileSync } from 'node:fs'
export async function createMapQaDb() {
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns text language sql stable as $$ select nullif(current_setting('qa.uid', true),'') $$;
    create function public.is_admin_user() returns boolean language sql stable as $$ select auth.uid()='qa-admin' $$;
    grant usage on schema public,auth to anon,authenticated;`)
  for (const f of ['campus-map-132.sql', 'campus-map-city-134.sql', 'campus-map-photos.sql']) await db.exec(readFileSync(new URL('../docs/sql/' + f, import.meta.url), 'utf8'))
  const campus = (await db.query("select id from campus_campuses where school_id='lyg'")).rows[0].id
  const as = (uid, sql, values = []) => db.transaction(async tx => {
    await tx.query("select set_config('qa.uid',$1,true)", [uid])
    await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`)
    return tx.query(sql, values)
  })
  return { db, campus, as }
}

// Restricted adapter for the real client's query interface, usable by local UI and tests.
export async function runMapQaQuery(qa, uid, q) {
  if (!['', 'qa-student-a', 'qa-student-b', 'qa-admin'].includes(uid)) throw new Error('Unknown test identity')
  const ident = v => { if (!/^[a-z_][a-z_0-9]*$/.test(v)) throw new Error('Invalid SQL identifier'); return `"${v}"` }
  if (!/^campus_/.test(q.table)) throw new Error('Test adapter only permits campus tables')
  const values = [], param = v => { values.push(v); return '$' + values.length }
  const columns = q.columns && q.columns !== '*' ? q.columns.split(',').map(ident).join(',') : '*'
  let sql
  if (q.op === 'insert') { const fields = Object.keys(q.data); sql = `insert into ${ident(q.table)} (${fields.map(ident)}) values (${fields.map(k => param(q.data[k]))})` }
  else if (q.op === 'update') sql = `update ${ident(q.table)} set ${Object.entries(q.data).map(([k,v]) => `${ident(k)}=${param(v)}`).join(',')}`
  else if (q.op === 'delete') sql = `delete from ${ident(q.table)}`
  else sql = `select ${columns} from ${ident(q.table)}`
  if (q.filters?.length) sql += ' where ' + q.filters.map(([k,v]) => `${ident(k)}=${param(v)}`).join(' and ')
  if (q.op === 'select' && q.order) sql += ` order by ${ident(q.order)} ${q.asc === false ? 'desc' : 'asc'}`
  if (q.op === 'select' && q.limit) sql += ' limit ' + param(q.limit)
  try { const r = await qa.as(uid, sql, values); return { data: r.rows, error: null } }
  catch (e) { return { data: null, error: { message: e.message } } }
}
