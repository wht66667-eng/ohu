-- Live role-level read verification, with a synthetic non-user identity; no rows exported.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ohu-security-probe-nonuser-149',true);
SELECT set_config('request.jwt.claims','{"sub":"ohu-security-probe-nonuser-149","role":"authenticated","is_anonymous":false}',true);
DO $verify$
DECLARE target text; n bigint;
BEGIN
  IF auth.uid() IS DISTINCT FROM 'ohu-security-probe-nonuser-149' THEN RAISE EXCEPTION 'Probe identity not applied'; END IF;
  IF public.is_admin_user() OR public.is_super_admin_user() THEN RAISE EXCEPTION 'Synthetic user gained privileges'; END IF;
  FOREACH target IN ARRAY ARRAY['profiles','admin_accounts','secondhand_items','tasks','help_items','lost_items','feedbacks','activity_signups','partner_apps','rider_profiles','shop_orders','canteen_orders','shop_group_members'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I',target) INTO n;
    IF n<>0 THEN RAISE EXCEPTION 'Unauthorized cross-user rows in %',target; END IF;
  END LOOP;
  BEGIN
    PERFORM 1 FROM auth.users LIMIT 0;
    RAISE EXCEPTION 'Authentication table exposed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM 1 FROM ohu_security.role_quarantine LIMIT 0;
    RAISE EXCEPTION 'Incident evidence exposed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.ensure_bootstrap_super_admin();
    RAISE EXCEPTION 'Old privilege escalation RPC remains callable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.admin_search_users('123');
    RAISE EXCEPTION 'Ordinary user can search authentication data';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$verify$;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
DO $verify$
BEGIN
  IF public.is_admin_user() OR public.is_super_admin_user() THEN RAISE EXCEPTION 'Anonymous administration exposed'; END IF;
  BEGIN
    PERFORM 1 FROM auth.users LIMIT 0;
    RAISE EXCEPTION 'Anonymous authentication table access';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$verify$;
ROLLBACK;
