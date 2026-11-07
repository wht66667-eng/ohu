-- Reviewed against production metadata on 2026-11-02. No business rows exported.
-- Counters are server-owned: client roles must never edit or reset them.
BEGIN;
ALTER TABLE public.function_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.function_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.function_rate_limits TO service_role;
DROP POLICY IF EXISTS ohu_rate_limit_service ON public.function_rate_limits;
CREATE POLICY ohu_rate_limit_service ON public.function_rate_limits TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.rate_limit_hit(p_scope text,p_actor text,p_limit integer,p_window_seconds integer DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
DECLARE
  v_window integer := coalesce(p_window_seconds,60);
  v_caller text;
  v_key text;
  v_start timestamptz;
  v_reset timestamptz;
  v_hits integer;
BEGIN
  IF p_scope IS NULL OR length(btrim(p_scope)) NOT BETWEEN 1 AND 100
    OR p_actor IS NULL OR length(btrim(p_actor)) NOT BETWEEN 1 AND 120
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10000
    OR v_window NOT BETWEEN 1 AND 86400 THEN
    RAISE EXCEPTION 'Invalid rate limit parameters' USING ERRCODE='22023';
  END IF;
  v_caller := auth.uid();
  v_key := CASE WHEN v_caller IS NULL THEN p_actor ELSE 'uid:' || v_caller END;
  v_start := to_timestamp(floor(extract(epoch FROM now())/v_window)*v_window);
  v_reset := v_start+make_interval(secs=>v_window);
  INSERT INTO public.function_rate_limits(scope,actor,window_start,hits,updated_at)
    VALUES(p_scope,v_key,v_start,1,now())
  ON CONFLICT(scope,actor,window_start) DO UPDATE
    SET hits=least(public.function_rate_limits.hits,2147483646)+1,updated_at=now()
    RETURNING hits INTO v_hits;
  -- A short-window request cannot delete active daily counters.
  IF random()<0.01 THEN
    DELETE FROM public.function_rate_limits WHERE window_start<now()-interval '30 days';
  END IF;
  RETURN jsonb_build_object('ok',v_hits<=p_limit,'remaining',greatest(0,p_limit-v_hits),
    'retry_after',CASE WHEN v_hits>p_limit THEN greatest(1,ceil(extract(epoch FROM(v_reset-now()))))::int ELSE 0 END,
    'limit',p_limit);
END;
$$;
REVOKE ALL ON FUNCTION public.rate_limit_hit(text,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text,text,integer,integer) TO service_role;
COMMIT;
