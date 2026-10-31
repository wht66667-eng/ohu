-- 1.2.131: new friendship decisions are atomic; preserve every historical row.
-- Apply before the 131 frontend. The 130 client first attempts an edge insert:
-- its verified incoming-pending insert becomes a zero-row success, and its
-- subsequent status update creates the actual edge in the same transaction.
BEGIN;

DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_roles r ON r.rolname = current_user
    WHERE c.oid = 'public.friends'::regclass
      AND (r.rolsuper OR r.rolbypassrls OR (c.relowner = r.oid AND NOT c.relforcerowsecurity))) THEN
    RAISE EXCEPTION 'The migration owner must be able to insert friendship edges without client RLS';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.friend_request_guard_131()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  -- Only actual privileged maintenance roles may bypass validation. A different
  -- role name can inherit authenticated, so a literal name check is unsafe.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_roles r ON r.rolname = current_user
    WHERE c.oid = TG_RELID AND (c.relowner = r.oid OR r.rolsuper OR r.rolbypassrls)) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NULL OR NEW.from_uid IS DISTINCT FROM auth.uid()
      OR NEW.status IS DISTINCT FROM 'pending' OR NEW.from_uid = NEW.to_uid
      OR NEW.to_uid IS NULL OR btrim(NEW.to_uid) = '' THEN
      RAISE EXCEPTION 'A new friend request must be pending and sent by its authenticated sender'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL OR OLD.to_uid IS DISTINCT FROM auth.uid()
    OR (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status')
    OR OLD.status IS DISTINCT FROM 'pending'
    OR NEW.status NOT IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'Only the recipient may decide a pending friend request; participants and request details are immutable'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.friend_edge_legacy_insert_131()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  -- The security-definer acceptance trigger runs as the verified migration owner.
  -- Unprivileged inherited roles follow the same compatibility path as clients.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_roles r ON r.rolname = current_user
    WHERE c.oid = TG_RELID AND (c.relowner = r.oid OR r.rolsuper OR r.rolbypassrls)) THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NOT NULL AND NEW.user_uid = auth.uid()
    AND NEW.friend_uid <> auth.uid()
    AND EXISTS (SELECT 1 FROM public.friend_requests r
      WHERE r.from_uid = NEW.friend_uid AND r.to_uid = auth.uid() AND r.status = 'pending') THEN
    -- PostgreSQL skips the row, including the INSERT WITH CHECK. This acknowledges
    -- the old client's preparatory step without creating an unconfirmed friend.
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'Friend edges are created only by an accepted incoming request'
    USING ERRCODE = '42501';
END;
$function$;

CREATE OR REPLACE FUNCTION public.friend_request_accept_edge_131()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    -- Recheck the end-user identity inside the privileged trigger as well.
    IF auth.uid() IS NULL OR NEW.to_uid IS DISTINCT FROM auth.uid()
      OR NEW.from_uid IS DISTINCT FROM OLD.from_uid
      OR NEW.to_uid IS DISTINCT FROM OLD.to_uid
      OR NEW.from_uid = NEW.to_uid THEN
      RAISE EXCEPTION 'Invalid friend request acceptance' USING ERRCODE = '42501';
    END IF;
    -- Opposite pending requests can be accepted concurrently. Serialize by the
    -- unordered pair so that a pre-existing edge is reused in either direction.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      least(NEW.from_uid, NEW.to_uid) || ':' ||
      greatest(NEW.from_uid, NEW.to_uid), 131));
    IF NOT EXISTS (SELECT 1 FROM public.friends f WHERE
      (f.user_uid = NEW.to_uid AND f.friend_uid = NEW.from_uid)
      OR (f.user_uid = NEW.from_uid AND f.friend_uid = NEW.to_uid)) THEN
      INSERT INTO public.friends (user_uid, friend_uid, friend_name, friend_avatar, created_at)
      VALUES (NEW.to_uid, NEW.from_uid, COALESCE(NEW.from_name, ''), COALESCE(NEW.from_avatar, ''), CURRENT_TIMESTAMP)
      ON CONFLICT (user_uid, friend_uid) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Trigger functions are not public RPCs. Trigger execution does not require
-- client EXECUTE permission; only the migration owner creates the triggers.
REVOKE ALL ON FUNCTION public.friend_request_guard_131() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.friend_edge_legacy_insert_131() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.friend_request_accept_edge_131() FROM PUBLIC, anon, authenticated;
REVOKE TRIGGER, TRUNCATE ON public.friends, public.friend_requests FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS friend_request_guard_131 ON public.friend_requests;
CREATE TRIGGER friend_request_guard_131 BEFORE INSERT OR UPDATE ON public.friend_requests
  FOR EACH ROW EXECUTE FUNCTION public.friend_request_guard_131();
DROP TRIGGER IF EXISTS friend_edge_legacy_insert_131 ON public.friends;
CREATE TRIGGER friend_edge_legacy_insert_131 BEFORE INSERT ON public.friends
  FOR EACH ROW EXECUTE FUNCTION public.friend_edge_legacy_insert_131();
DROP TRIGGER IF EXISTS friend_request_accept_edge_131 ON public.friend_requests;
CREATE TRIGGER friend_request_accept_edge_131 AFTER UPDATE OF status ON public.friend_requests
  FOR EACH ROW EXECUTE FUNCTION public.friend_request_accept_edge_131();

DROP POLICY IF EXISTS friend_requests_insert_own ON public.friend_requests;
CREATE POLICY friend_requests_insert_own ON public.friend_requests FOR INSERT TO authenticated
  WITH CHECK (from_uid = auth.uid() AND status = 'pending' AND from_uid <> to_uid AND btrim(to_uid) <> '');
DROP POLICY IF EXISTS friend_requests_update_own ON public.friend_requests;
CREATE POLICY friend_requests_update_own ON public.friend_requests FOR UPDATE TO authenticated
  USING (to_uid = auth.uid() AND status = 'pending')
  WITH CHECK (to_uid = auth.uid() AND status IN ('accepted', 'rejected'));
DROP POLICY IF EXISTS friends_insert_own ON public.friends;
CREATE POLICY friends_insert_own ON public.friends FOR INSERT TO authenticated WITH CHECK (false);

COMMIT;
