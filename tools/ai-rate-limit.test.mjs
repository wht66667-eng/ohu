import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const { PGlite } = await import(pathToFileURL(resolve('.codex/qa/friends131-pg/node_modules/@electric-sql/pglite/dist/index.js')).href)

test('server-owned counters cannot be read, reset or invoked by client roles', async t => {
  const db = new PGlite()
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE ROLE inherited_client INHERIT; GRANT authenticated TO inherited_client;
      CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'') $$;
      GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
      CREATE TABLE public.function_rate_limits(id bigserial PRIMARY KEY,scope text,actor text,window_start timestamptz,hits int,updated_at timestamptz,UNIQUE(scope,actor,window_start));
      GRANT ALL ON public.function_rate_limits TO authenticated; GRANT SELECT ON public.function_rate_limits TO anon;`)
    await db.exec(readFileSync('docs/sql/ai-rate-limit-lockdown-150.sql','utf8'))
    for (const role of ['anon','authenticated','inherited_client']) await t.test(role,async()=>{
      await db.exec(`SET ROLE ${role}`)
      for (const query of ['SELECT * FROM public.function_rate_limits','DELETE FROM public.function_rate_limits',"UPDATE public.function_rate_limits SET hits=0","SELECT public.rate_limit_hit('agnes-ai:generate:60','uid:other',9999,1)"])
        await assert.rejects(db.query(query),{code:'42501'})
      await db.exec('RESET ROLE')
    })
    await t.test('server quotas enforce minute and daily windows independently',async()=>{
      await db.exec('SET ROLE service_role')
      for (let i=1;i<=9;i++) {
        const {rows}=await db.query("SELECT public.rate_limit_hit('agnes-ai:generate:60','uid:probe',8,60) AS result")
        assert.equal(rows[0].result.ok,i<=8)
      }
      assert.equal((await db.query("SELECT public.rate_limit_hit('agnes-ai:generate:86400','uid:probe',120,86400) AS result")).rows[0].result.ok,true)
      for (const query of ["SELECT public.rate_limit_hit('s','a',0,60)","SELECT public.rate_limit_hit('s','a',1,86401)","SELECT public.rate_limit_hit(repeat('x',101),'a',1,60)"])
        await assert.rejects(db.query(query),{code:'22023'})
      await db.exec('RESET ROLE')
      assert.equal((await db.query("SELECT hits FROM public.function_rate_limits WHERE scope='agnes-ai:generate:86400'")).rows[0].hits,1)
    })
  } finally { await db.close() }
})
