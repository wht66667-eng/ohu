-- Keep public content feeds, deny bulk reads of the private contact-bearing rows.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $policies$
DECLARE target text; owner_column text;
BEGIN
  FOREACH target IN ARRAY ARRAY['secondhand_items','tasks','lost_items','help_items','feedbacks','activity_signups'] LOOP
    owner_column := CASE WHEN target='activity_signups' THEN 'uid' ELSE 'creator_uid' END;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',target);
    EXECUTE format('DROP POLICY IF EXISTS contact_privacy_149 ON public.%I',target);
    EXECUTE format('CREATE POLICY contact_privacy_149 ON public.%I AS RESTRICTIVE FOR SELECT TO PUBLIC USING (%I=auth.uid() OR public.is_admin_user())',target,owner_column);
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon',target);
  END LOOP;
END;
$policies$;

-- These explicit public-content views already omit contact. Add the author's UID
-- for in-app messaging, so hiding a phone does not force users to exchange numbers.
DO $views$
DECLARE target text; base_table text; definition text;
BEGIN
  FOREACH target IN ARRAY ARRAY['v_secondhand_public','v_tasks_public','v_lost_public','v_help_public'] LOOP
    base_table:=CASE target WHEN 'v_secondhand_public' THEN 'secondhand_items' WHEN 'v_tasks_public' THEN 'tasks'
      WHEN 'v_lost_public' THEN 'lost_items' ELSE 'help_items' END;
    IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=target AND column_name='creator_uid') THEN
      definition:=regexp_replace(pg_get_viewdef(format('public.%I',target)::regclass,true),';[[:space:]]*$','');
      EXECUTE format('CREATE OR REPLACE VIEW public.%I WITH(security_barrier=true) AS SELECT feed.*,source.creator_uid FROM (%s) feed JOIN public.%I source ON source.id=feed.id',target,definition,base_table);
    END IF;
    EXECUTE format('ALTER VIEW public.%I SET(security_barrier=true)',target);
  END LOOP;
END;
$views$;

CREATE OR REPLACE FUNCTION public.activity_signup_roster_149(p_activity_id bigint)
RETURNS TABLE(id bigint,activity_id bigint,uid text,name text,building text,contact text,created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
  IF auth.uid() IS NULL OR public.current_is_anon() OR NOT (
    public.is_admin_user() OR EXISTS(SELECT 1 FROM public.activities a WHERE a.id=p_activity_id AND a.creator_uid=auth.uid())
  ) THEN RAISE EXCEPTION 'Only the organizer may read this roster' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT s.id,s.activity_id,s.uid,s.name,''::text,''::text,s.created_at
    FROM public.activity_signups s WHERE s.activity_id=p_activity_id ORDER BY s.created_at,s.id LIMIT 500;
END;
$f$;
REVOKE ALL ON FUNCTION public.activity_signup_roster_149(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.activity_signup_roster_149(bigint) TO authenticated;

-- A rider must take an order before reading its private customer contact/address.
DROP POLICY IF EXISTS delivery_contact_privacy_149 ON public.canteen_orders;
CREATE POLICY delivery_contact_privacy_149 ON public.canteen_orders AS RESTRICTIVE FOR SELECT TO PUBLIC
USING(buyer_uid=auth.uid() OR rider_uid=auth.uid() OR public.is_admin_user() OR public.canteen_order_of_my_store(id));

-- Partner onboarding used to copy an application phone into a public storefront.
CREATE OR REPLACE VIEW public.v_shop_stores_public WITH(security_barrier=true) AS
SELECT id,name,emoji,logo_url,cover_url,description,notice,campus,building,room,''::text AS contact,
  delivery_mode,hours_text,hours_slots,force_closed,force_close_note,status,sort,
  (SELECT count(*) FROM public.shop_goods g WHERE g.store_id=s.id AND g.status='on' AND NOT g.sold_out) AS goods_count,
  (SELECT count(*) FROM public.shop_groups gr WHERE gr.store_id=s.id AND gr.status='open') AS group_count
FROM public.shop_stores s WHERE status<>'suspended';
NOTIFY pgrst,'reload schema';
COMMIT;
