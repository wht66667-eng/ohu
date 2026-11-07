import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
const { PGlite } = await import(pathToFileURL(resolve('.codex/qa/friends131-pg/node_modules/@electric-sql/pglite/dist/index.js')).href)
const sql = readFileSync('docs/sql/phone-privacy-lockdown-149.sql', 'utf8')

test('real PostgreSQL privilege lockdown preserves owner and blocks nickname escalation', async t => {
  const db = new PGlite()
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE inherited_client INHERIT;
    GRANT authenticated TO inherited_client; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'') $$;
    GRANT USAGE ON SCHEMA auth,public TO anon,authenticated;
    CREATE TABLE auth.users(id text PRIMARY KEY,username text,phone_number text);
    CREATE TABLE public.profiles(uid text PRIMARY KEY,username text,is_admin boolean DEFAULT false,is_super_admin boolean DEFAULT false,banned_at timestamptz,banned_note text,created_at timestamptz DEFAULT now());
    CREATE TABLE public.admin_accounts(account text PRIMARY KEY,role text);
    INSERT INTO auth.users VALUES ('owner','owner-login','+8619900000000'),('forged','attacker-login',NULL),('student','student-login',NULL),('staff','staff-login',NULL);
    INSERT INTO public.profiles(uid,username,is_admin,is_super_admin) VALUES ('owner','owner display',true,true),('forged','legacy magic name',true,true),('student','student',false,false),('staff','staff',false,false);
    INSERT INTO public.admin_accounts VALUES ('19900000000','super_admin');
    GRANT SELECT ON auth.users TO anon,authenticated; GRANT ALL ON public.profiles,public.admin_accounts TO authenticated;
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_profile ON public.profiles TO authenticated USING(uid=auth.uid()) WITH CHECK(uid=auth.uid());
    CREATE FUNCTION public.is_admin_user() RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM public.profiles WHERE uid=auth.uid() AND is_admin) $$;
    CREATE FUNCTION public.is_super_admin_user() RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM public.profiles WHERE uid=auth.uid() AND is_super_admin) $$;
    CREATE FUNCTION public.guard_profiles_privileges() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF coalesce(current_setting('app.profiles_guard_bypass',true),'')<>'on' AND (NEW.is_admin OR NEW.is_super_admin) THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER profile_guard BEFORE INSERT OR UPDATE OF is_admin,is_super_admin ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_profiles_privileges();
    CREATE FUNCTION public.bootstrap_named_super_admin() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
      IF NEW.username='legacy magic name' THEN PERFORM set_config('app.profiles_guard_bypass','on',true); UPDATE public.profiles SET is_admin=true,is_super_admin=true WHERE uid=NEW.uid; END IF; RETURN NEW; END $$;
    CREATE TRIGGER trg_bootstrap_named_super_admin AFTER INSERT OR UPDATE OF username ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.bootstrap_named_super_admin();
    CREATE FUNCTION public.ensure_bootstrap_super_admin() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
  `)
  const as = async (uid, statement, role='authenticated') => {
    await db.exec(`SET ROLE ${role}`)
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid])
    try { return await db.query(statement) } finally { await db.exec('RESET ROLE; RESET request.jwt.claim.sub') }
  }
  try {
    await db.exec(sql)
    await t.test('owner survives, unregistered flags are quarantined without deleting accounts', async () => {
      assert.equal((await as('owner','SELECT public.is_super_admin_user() AS ok')).rows[0].ok,true)
      assert.equal((await as('forged','SELECT public.is_admin_user() AS ok')).rows[0].ok,false)
      assert.equal((await db.query('SELECT count(*) AS n FROM auth.users')).rows[0].n,4)
      assert.equal((await db.query('SELECT count(*) AS n FROM ohu_security.role_quarantine')).rows[0].n,1)
    })
    await t.test('changing nickname cannot gain administration including inherited roles', async () => {
      await as('student',"UPDATE public.profiles SET username='legacy magic name' WHERE uid='student'",'inherited_client')
      assert.equal((await as('student','SELECT public.is_super_admin_user() AS ok')).rows[0].ok,false)
      await assert.rejects(as('student','SELECT public.ensure_bootstrap_super_admin()'),{code:'42501'})
    })
    await t.test('auth table, identity registry, owner search and deleting own profile are denied', async () => {
      for (const command of ['SELECT * FROM auth.users','SELECT * FROM ohu_security.admin_identity_sources',"SELECT * FROM public.admin_search_users('199')","DELETE FROM public.profiles WHERE uid='student'"]) {
        await assert.rejects(as('student',command),{code:'42501'})
      }
      await assert.rejects(as('',"SELECT * FROM public.admin_search_users('199')",'anon'),{code:'42501'})
    })
    await t.test('owner query rejects empty or wildcard enumeration and is bounded', async () => {
      await assert.rejects(as('owner',"SELECT * FROM public.admin_search_users('')"),{code:'22023'})
      assert.equal((await as('owner',"SELECT * FROM public.admin_search_users('%%%')")).rows.length,0)
      assert.equal((await as('owner',"SELECT * FROM public.admin_search_users('199')")).rows.length,1)
    })
    await t.test('only verified owner can add staff and UID binding does not follow username changes', async () => {
      await assert.rejects(as('student',"INSERT INTO public.admin_accounts VALUES('student-login','super_admin')"),{code:'42501'})
      await as('owner',"INSERT INTO public.admin_accounts VALUES('staff-login','admin')")
      await db.exec("SELECT set_config('app.profiles_guard_bypass','on',false); UPDATE public.profiles SET is_admin=true WHERE uid='staff'; RESET app.profiles_guard_bypass;")
      assert.equal((await as('staff','SELECT public.is_admin_user() AS ok')).rows[0].ok,true)
      await db.exec("UPDATE auth.users SET username='staff-renamed' WHERE id='staff'; UPDATE auth.users SET username='staff-login' WHERE id='student'")
      assert.equal((await as('student','SELECT public.is_admin_user() AS ok')).rows[0].ok,false)
      await as('owner',"DELETE FROM public.admin_accounts WHERE account='staff-login'")
      assert.equal((await as('staff','SELECT public.is_admin_user() AS ok')).rows[0].ok,false)
    })
    await t.test('repeat migration is safe',async()=>{
      await db.exec(sql)
      assert.equal((await as('owner','SELECT public.is_super_admin_user() AS ok')).rows[0].ok,true)
    })
    await t.test('private contacts are denied across users while sanitized content and messaging remain usable',async()=>{
      await db.exec(`CREATE FUNCTION public.current_is_anon() RETURNS boolean LANGUAGE sql AS $$ SELECT auth.uid() IS NULL $$;
        CREATE TABLE public.activities(id bigint PRIMARY KEY,creator_uid text);
        CREATE TABLE public.activity_signups(id bigint PRIMARY KEY,activity_id bigint,uid text,name text,building text,contact text,created_at timestamptz DEFAULT now());
        INSERT INTO public.activities VALUES(1,'owner');
        INSERT INTO public.activity_signups(id,activity_id,uid,name,building,contact) VALUES(1,1,'student','Student','dorm','19900000000');
        CREATE TABLE public.canteen_orders(id bigint PRIMARY KEY,buyer_uid text,rider_uid text,contact text);
        INSERT INTO public.canteen_orders VALUES(1,'student','','19900000000');
        CREATE FUNCTION public.canteen_order_of_my_store(bigint) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
        ALTER TABLE public.canteen_orders ENABLE ROW LEVEL SECURITY;
        GRANT SELECT ON public.canteen_orders TO authenticated;
        CREATE POLICY legacy_pool ON public.canteen_orders FOR SELECT TO authenticated USING(true);
        CREATE TABLE public.shop_stores(id bigint PRIMARY KEY,name text,emoji text,logo_url text,cover_url text,description text,notice text,campus text,building text,room text,contact text,delivery_mode text,hours_text text,hours_slots jsonb,force_closed boolean,force_close_note text,status text,sort integer);
        CREATE TABLE public.shop_goods(store_id bigint,status text,sold_out boolean);
        CREATE TABLE public.shop_groups(store_id bigint,status text);
        INSERT INTO public.shop_stores(id,name,contact,status) VALUES(1,'shop','19900000000','open');
      `)
      for(const [table,view] of [['secondhand_items','v_secondhand_public'],['tasks','v_tasks_public'],['lost_items','v_lost_public'],['help_items','v_help_public'],['feedbacks','v_feedbacks_public']]) {
        await db.exec(`CREATE TABLE public.${table}(id bigint PRIMARY KEY,title text,creator_uid text,contact text);
          INSERT INTO public.${table} VALUES(1,'public content','student','19900000000');
          GRANT SELECT ON public.${table} TO anon,authenticated;
          ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
          CREATE POLICY legacy_all ON public.${table} FOR SELECT TO authenticated USING(true);
          CREATE VIEW public.${view} AS SELECT id,title FROM public.${table};
          GRANT SELECT ON public.${view} TO anon,authenticated;`)
      }
      await db.exec(`ALTER TABLE public.activity_signups ENABLE ROW LEVEL SECURITY;
        CREATE POLICY legacy_roster ON public.activity_signups FOR SELECT TO authenticated USING(true);
        GRANT SELECT ON public.activity_signups TO anon,authenticated;`)
      const contactSql=readFileSync('docs/sql/contact-privacy-149.sql','utf8')
      await db.exec(contactSql)
      for(const table of ['secondhand_items','tasks','lost_items','help_items','feedbacks']) {
        assert.equal((await as('forged',`SELECT contact FROM public.${table}`)).rows.length,0)
        assert.equal((await as('student',`SELECT contact FROM public.${table}`)).rows.length,1)
      }
      const feed=(await as('',"SELECT * FROM public.v_tasks_public",'anon')).rows
      assert.equal(feed[0].creator_uid,'student')
      assert.equal('contact' in feed[0],false)
      await assert.rejects(as('',"SELECT contact FROM public.tasks",'anon'),{code:'42501'})
      assert.equal((await as('forged','SELECT * FROM public.activity_signups')).rows.length,0)
      const roster=(await as('owner','SELECT * FROM public.activity_signup_roster_149(1)')).rows
      assert.equal(roster.length,1);assert.equal(roster[0].contact,'');assert.equal(roster[0].building,'')
      await assert.rejects(as('forged','SELECT * FROM public.activity_signup_roster_149(1)'),{code:'42501'})
      assert.equal((await as('forged','SELECT contact FROM public.canteen_orders')).rows.length,0)
      assert.equal((await as('student','SELECT contact FROM public.canteen_orders')).rows.length,1)
      await db.exec('GRANT SELECT ON public.v_shop_stores_public TO anon,authenticated')
      assert.equal((await as('',"SELECT contact FROM public.v_shop_stores_public",'anon')).rows[0].contact,'')
      await db.exec(contactSql)
      assert.equal((await as('forged','SELECT contact FROM public.tasks')).rows.length,0)
    })
    if (process.env.OHU_SECURITY_FUZZ === '1') {
      await t.test('fast-check generated names and filter payloads cannot cross private row or identity boundaries', async () => {
        const fc = createRequire(resolve('.codex/qa/security150/js/package.json'))('fast-check')
        const payload = fc.oneof(fc.string({ maxLength: 80 }), fc.constantFrom(
          "owner", "owner-login", "legacy magic name", "' OR 1=1 --", "%", "_", "19900000000", "admin", "站长", "\\u0000"))
        await fc.assert(fc.asyncProperty(payload, payload, async (nickname, filter) => {
          await db.exec('SET ROLE inherited_client')
          await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", ['forged'])
          try {
            await db.query('UPDATE public.profiles SET username=$1 WHERE uid=$2', [nickname, 'forged'])
            assert.equal((await db.query('SELECT public.is_admin_user() AS ok')).rows[0].ok, false)
            assert.equal((await db.query('SELECT public.is_super_admin_user() AS ok')).rows[0].ok, false)
            for (const table of ['tasks','secondhand_items','lost_items','help_items','feedbacks']) {
              assert.equal((await db.query(`SELECT contact FROM public.${table} WHERE title ILIKE $1 OR true`, [filter])).rows.length, 0)
            }
            await assert.rejects(db.query('SELECT * FROM auth.users'), {code: '42501'})
            await assert.rejects(db.query('SELECT * FROM public.admin_search_users($1)', [filter]), {code: '42501'})
            const feed = (await db.query('SELECT * FROM public.v_tasks_public')).rows
            assert.equal(feed.length, 1)
            assert.equal('contact' in feed[0], false)
            assert.equal(feed[0].creator_uid, 'student')
          } finally { await db.exec('RESET ROLE; RESET request.jwt.claim.sub') }
        }), { seed: 20261102, numRuns: 200, endOnFailure: true })
      })
    }
  } finally { await db.close() }
})
