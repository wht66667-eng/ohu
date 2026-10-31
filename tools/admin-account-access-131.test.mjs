/** Execute the actual atomic moderation function and legacy RPCs in an isolated PostgreSQL engine. */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const { PGlite } = await import(pathToFileURL(resolve('.codex/qa/friends131-pg/node_modules/@electric-sql/pglite/dist/index.js')).href)
const migration = readFileSync('docs/sql/admin-account-access-131.sql', 'utf8')
const backup = JSON.parse(readFileSync('.codex/qa/admin131-before.json', 'utf8'))
const legacy = backup.functions.Rows.map(row => typeof row === 'string' ? JSON.parse(row) : row)
  .filter(row => ['is_super_admin_user', 'admin_resolve_uid', 'admin_ban_user', 'admin_unban_user'].includes(row[0])).map(row => row[1]).join(';\n')
const results = []
const seed = `
  CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.actor',true),'') $$;
  GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
  CREATE TABLE auth.users(id text PRIMARY KEY,phone_number text,username text UNIQUE);
  CREATE TABLE public.profiles(uid text PRIMARY KEY,is_admin boolean DEFAULT false,is_super_admin boolean DEFAULT false,banned_at timestamptz,banned_note text,updated_at timestamptz);
  CREATE TABLE public.user_sanctions(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,uid text,kind text,until_at timestamptz,reason text,actor_uid text,created_at timestamptz);
  CREATE TABLE public.secondhand_items(creator_uid text,status text,updated_at timestamptz);
  CREATE TABLE public.tasks(creator_uid text,status text,updated_at timestamptz);
  CREATE TABLE public.activities(creator_uid text,status text,updated_at timestamptz);
  CREATE TABLE public.lost_items(creator_uid text,status text,updated_at timestamptz);
  CREATE TABLE public.activity_signups(uid text);
  CREATE TABLE public.partner_apps(creator_uid text,status text,handled_at timestamptz);
  CREATE TABLE public.canteen_apply_apps(creator_uid text,status text);
  CREATE TABLE public.canteen_orders(buyer_uid text,status text,updated_at timestamptz);
  INSERT INTO auth.users VALUES ('super','13800000000','owner'),('student','13800000001','student-account'),('other','13800000002','other-account'),('manager','13800000003','manager-account');
  INSERT INTO public.profiles(uid,is_admin,is_super_admin) VALUES ('super',true,true),('student',false,false),('other',false,false),('manager',true,false);
  INSERT INTO public.secondhand_items VALUES ('student','on',now());
`
async function fixture(run) {
  const db = new PGlite()
  try { await db.exec(seed); await db.exec(legacy); await db.exec(migration); await run(db) }
  finally { await db.close() }
}
async function action(db, { actor = 'super', account = 'student-account', uid = 'student', banned = true, role = 'authenticated' } = {}) {
  await db.exec(`BEGIN; SET LOCAL ROLE ${role};`)
  try {
    await db.query("SELECT set_config('test.actor',$1,true)", [actor])
    const result = await db.query('SELECT public.admin_set_account_access($1,$2,$3,$4) AS value', [account, banned, uid, '隔离测试'])
    await db.exec('COMMIT'); return result.rows[0].value
  } catch (error) { await db.exec('ROLLBACK'); throw error }
}
async function row(db, uid = 'student') { return (await db.query('SELECT * FROM public.profiles WHERE uid=$1', [uid])).rows[0] }
async function sanctions(db) { return (await db.query("SELECT * FROM public.user_sanctions WHERE uid='student' ORDER BY id")).rows }
function check(name, run) { test(name, async () => { await fixture(run); results.push({ name, passed: true }) }) }

check('atomic account moderation commits the profile, content changes and restriction together', async db => {
  const result = await action(db)
  assert.equal(result.ok, true); assert.equal(result.uid, 'student'); assert.equal(result.banned, true)
  assert.ok((await row(db)).banned_at)
  assert.equal((await sanctions(db))[0].actor_uid, 'super')
  assert.equal((await db.query('SELECT status FROM public.secondhand_items')).rows[0].status, 'off')
})
check('atomic unban clears every account restriction and preserves unrelated moderation', async db => {
  await action(db)
  await db.exec("INSERT INTO public.user_sanctions(uid,kind) VALUES ('student','account'),('student','mute'),('student','hall_ban')")
  await action(db, { banned: false })
  assert.equal((await row(db)).banned_at, null)
  assert.deepEqual((await sanctions(db)).map(s => s.kind), ['mute', 'hall_ban'])
})
check('ordinary users cannot change account access', async db => {
  await assert.rejects(action(db, { actor: 'other' }), /站长/)
  assert.equal((await row(db)).banned_at, null)
})
check('a banned station owner is denied even with the super-admin flag', async db => {
  await db.exec("UPDATE public.profiles SET banned_at=now() WHERE uid='super'")
  await assert.rejects(action(db), /站长/)
  assert.equal((await row(db)).banned_at, null)
})
check('administrator targets remain protected', async db => {
  await assert.rejects(action(db, { account: 'manager-account', uid: 'manager' }), /管理员/)
  assert.equal((await row(db, 'manager')).banned_at, null)
})
check('a failed restriction insert rolls back profile and legacy content changes', async db => {
  await db.exec("CREATE FUNCTION public.test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated restriction insert failure'; END $$; CREATE TRIGGER test_fail BEFORE INSERT ON public.user_sanctions FOR EACH ROW EXECUTE FUNCTION public.test_fail()")
  await assert.rejects(action(db), /isolated restriction insert failure/)
  assert.equal((await row(db)).banned_at, null); assert.equal((await sanctions(db)).length, 0)
  assert.equal((await db.query('SELECT status FROM public.secondhand_items')).rows[0].status, 'on')
})
check('a failed restriction delete rolls back the unban flag', async db => {
  await action(db)
  await db.exec("CREATE FUNCTION public.test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated restriction delete failure'; END $$; CREATE TRIGGER test_fail BEFORE DELETE ON public.user_sanctions FOR EACH ROW EXECUTE FUNCTION public.test_fail()")
  await assert.rejects(action(db, { banned: false }), /isolated restriction delete failure/)
  assert.ok((await row(db)).banned_at); assert.equal((await sanctions(db)).length, 1)
})
check('repeating the same desired state is safe after a lost response', async db => {
  await action(db); await action(db); assert.equal((await sanctions(db)).length, 1)
  await action(db, { banned: false }); await action(db, { banned: false })
  assert.equal((await row(db)).banned_at, null); assert.equal((await sanctions(db)).length, 0)
})
check('a stale account-to-UID mapping is rejected before any write', async db => {
  await assert.rejects(action(db, { uid: 'other' }), /账号信息已变化/)
  assert.equal((await row(db)).banned_at, null); assert.equal((await sanctions(db)).length, 0)
})
check('a legacy resolver race cannot commit a different target', async db => {
  await db.exec("CREATE OR REPLACE FUNCTION public.admin_ban_user(account text,reason text DEFAULT '违规') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN UPDATE public.profiles SET banned_at=now() WHERE uid='other'; RETURN jsonb_build_object('uid','other'); END $$")
  await assert.rejects(action(db), /账号信息已变化/)
  assert.equal((await row(db, 'other')).banned_at, null); assert.equal((await sanctions(db)).length, 0)
})
check('anonymous role has no EXECUTE permission', async db => {
  assert.equal((await db.query("SELECT has_function_privilege('anon','public.admin_set_account_access(text,boolean,text,text)','EXECUTE') AS allowed")).rows[0].allowed, false)
  await assert.rejects(action(db, { role: 'anon', actor: '' }), /permission denied/)
})
check('reapplying the migration does not rewrite account or business rows', async db => {
  await action(db); const before = await sanctions(db)
  await db.exec(migration)
  assert.deepEqual(await sanctions(db), before); assert.ok((await row(db)).banned_at)
})
after(() => {
  writeFileSync('.codex/qa/admin131-sql-test.json', JSON.stringify({ checkedAt: new Date().toISOString(), scope: 'Isolated PostgreSQL only; actual migration and catalog-backed legacy functions; no real accounts or production business writes', sha256: createHash('sha256').update(migration).digest('hex'), passed: results.length === 12, results }, null, 2) + '\n')
})
