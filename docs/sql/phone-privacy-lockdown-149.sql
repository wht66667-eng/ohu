-- Emergency privilege repair. Preserve accounts and evidence; never promote by display name.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM PUBLIC, anon, authenticated;
CREATE SCHEMA IF NOT EXISTS ohu_security;
REVOKE ALL ON SCHEMA ohu_security FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS ohu_security.admin_identity_sources (
  account text PRIMARY KEY, uid text NOT NULL, role text NOT NULL CHECK(role IN ('admin','super_admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ohu_security.role_quarantine (
  uid text PRIMARY KEY, was_admin boolean, was_super_admin boolean,
  recorded_at timestamptz NOT NULL DEFAULT now(), reason text NOT NULL
);
CREATE TABLE IF NOT EXISTS ohu_security.incident_definitions (
  signature text PRIMARY KEY, definition text NOT NULL, captured_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO ohu_security.incident_definitions(signature,definition)
SELECT p.oid::regprocedure::text,pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('bootstrap_named_super_admin','ensure_bootstrap_super_admin','is_admin_user','is_super_admin_user','admin_search_users')
ON CONFLICT(signature) DO NOTHING;
ALTER TABLE ohu_security.admin_identity_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE ohu_security.role_quarantine ENABLE ROW LEVEL SECURITY;
ALTER TABLE ohu_security.incident_definitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA ohu_security FROM PUBLIC, anon, authenticated;

-- Seed immutable UID bindings from the pre-existing authorization register and
-- authentication identity, never from an editable profile nickname.
INSERT INTO ohu_security.admin_identity_sources(account,uid,role)
SELECT a.account, min(u.id::text), a.role FROM public.admin_accounts a
JOIN auth.users u ON u.username=a.account OR (
  regexp_replace(a.account,'[^0-9]','','g') ~ '^(86)?1[0-9]{10}$'
  AND right(regexp_replace(u.phone_number,'[^0-9]','','g'),11)=right(regexp_replace(a.account,'[^0-9]','','g'),11)
)
WHERE a.role IN ('admin','super_admin') GROUP BY a.account,a.role
HAVING count(DISTINCT u.id::text)=1
ON CONFLICT(account) DO NOTHING;
DO $preflight$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ohu_security.admin_identity_sources a JOIN public.profiles p ON p.uid=a.uid
    WHERE a.role='super_admin' AND p.is_super_admin AND p.banned_at IS NULL) THEN
    RAISE EXCEPTION 'No verified owner binding; abort without changing access';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.is_admin_user() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT EXISTS(SELECT 1 FROM ohu_security.admin_identity_sources a JOIN public.profiles p ON p.uid=a.uid
    WHERE a.uid=auth.uid() AND p.is_admin AND p.banned_at IS NULL)
$f$;
CREATE OR REPLACE FUNCTION public.is_super_admin_user() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT EXISTS(SELECT 1 FROM ohu_security.admin_identity_sources a JOIN public.profiles p ON p.uid=a.uid
    WHERE a.uid=auth.uid() AND a.role='super_admin' AND p.is_super_admin AND p.banned_at IS NULL)
$f$;
REVOKE ALL ON FUNCTION public.is_admin_user(),public.is_super_admin_user() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_admin_user(),public.is_super_admin_user() TO authenticated;
-- Anonymous policies may use these predicates; they return false for no identity.
GRANT EXECUTE ON FUNCTION public.is_admin_user(),public.is_super_admin_user() TO anon;

CREATE OR REPLACE FUNCTION public.sync_admin_identity_149() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE resolved_uid text; matches integer;
BEGIN
  IF NOT public.is_super_admin_user() THEN
    RAISE EXCEPTION 'Only the verified owner may change administrative identities' USING ERRCODE='42501';
  END IF;
  IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND OLD.account IS DISTINCT FROM NEW.account) THEN
    DELETE FROM ohu_security.admin_identity_sources WHERE account=OLD.account;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  SELECT a.uid INTO resolved_uid FROM ohu_security.admin_identity_sources a WHERE a.account=NEW.account;
  IF resolved_uid IS NULL THEN
    SELECT min(u.id::text),count(DISTINCT u.id::text) INTO resolved_uid,matches FROM auth.users u
    WHERE u.username=NEW.account OR (
      regexp_replace(NEW.account,'[^0-9]','','g') ~ '^(86)?1[0-9]{10}$'
      AND right(regexp_replace(u.phone_number,'[^0-9]','','g'),11)=right(regexp_replace(NEW.account,'[^0-9]','','g'),11));
    IF matches<>1 THEN RAISE EXCEPTION 'Authorization must refer to one existing identity' USING ERRCODE='22023'; END IF;
  END IF;
  INSERT INTO ohu_security.admin_identity_sources(account,uid,role) VALUES(NEW.account,resolved_uid,NEW.role)
    ON CONFLICT(account) DO UPDATE SET role=EXCLUDED.role;
  RETURN NEW;
END;
$f$;
REVOKE ALL ON FUNCTION public.sync_admin_identity_149() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS admin_identity_sync_149 ON public.admin_accounts;
CREATE TRIGGER admin_identity_sync_149 AFTER INSERT OR UPDATE OR DELETE ON public.admin_accounts
  FOR EACH ROW EXECUTE FUNCTION public.sync_admin_identity_149();

DROP TRIGGER IF EXISTS trg_bootstrap_named_super_admin ON public.profiles;
CREATE OR REPLACE FUNCTION public.bootstrap_named_super_admin() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$ BEGIN RETURN NEW; END; $f$;
CREATE OR REPLACE FUNCTION public.ensure_bootstrap_super_admin() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $f$
  SELECT jsonb_build_object('ok',false,'code','BOOTSTRAP_DISABLED')
$f$;
REVOKE ALL ON FUNCTION public.bootstrap_named_super_admin(), public.ensure_bootstrap_super_admin() FROM PUBLIC,anon,authenticated;

-- Quarantine unbound historical flags before removing their effect. No users deleted.
INSERT INTO ohu_security.role_quarantine(uid,was_admin,was_super_admin,reason)
SELECT p.uid,p.is_admin,p.is_super_admin,'Unbound legacy administrative flags; requires owner review'
FROM public.profiles p WHERE (p.is_admin OR p.is_super_admin) AND NOT EXISTS(
  SELECT 1 FROM ohu_security.admin_identity_sources a WHERE a.uid=p.uid AND (NOT p.is_super_admin OR a.role='super_admin'))
ON CONFLICT(uid) DO NOTHING;
SELECT set_config('app.profiles_guard_bypass','on',true);
UPDATE public.profiles p SET is_admin=false,is_super_admin=false WHERE (p.is_admin OR p.is_super_admin)
  AND EXISTS(SELECT 1 FROM ohu_security.role_quarantine q WHERE q.uid=p.uid)
  AND NOT EXISTS(SELECT 1 FROM ohu_security.admin_identity_sources a WHERE a.uid=p.uid AND (NOT p.is_super_admin OR a.role='super_admin'));
SELECT set_config('app.profiles_guard_bypass','off',true);
REVOKE DELETE,TRIGGER,TRUNCATE ON public.profiles FROM PUBLIC,anon,authenticated;
REVOKE TRIGGER,TRUNCATE ON public.admin_accounts FROM PUBLIC,anon,authenticated;

-- Authentication data RPCs are owner-only, bounded and use literal substring search.
CREATE OR REPLACE FUNCTION public.admin_search_users(q text)
RETURNS TABLE(uid text,account text,nickname text,is_admin boolean,is_super_admin boolean,banned boolean,banned_note text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE term text := btrim(coalesce(q,''));
BEGIN
  IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Owner access required' USING ERRCODE='42501'; END IF;
  IF char_length(term)<3 OR char_length(term)>64 THEN RAISE EXCEPTION 'Search requires 3 to 64 characters' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT p.uid,coalesce(nullif(u.phone_number,''),u.username),p.username,p.is_admin,p.is_super_admin,
    p.banned_at IS NOT NULL,coalesce(p.banned_note,'')
  FROM auth.users u JOIN public.profiles p ON p.uid=u.id::text
  WHERE strpos(coalesce(u.phone_number,''),term)>0 OR strpos(coalesce(u.username,''),term)>0 OR strpos(coalesce(p.username,''),term)>0
  ORDER BY p.created_at DESC LIMIT 10;
END;
$f$;
DO $acl$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature,p.prorettype='trigger'::regtype AS is_trigger
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND (p.proname LIKE 'admin_%' OR p.prorettype='trigger'::regtype)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon',f.signature);
    IF f.is_trigger THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated',f.signature);
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
    END IF;
  END LOOP;
END;
$acl$;
NOTIFY pgrst,'reload schema';
COMMIT;
