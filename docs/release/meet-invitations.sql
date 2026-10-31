-- 碰个空: private invitations and opt-in campus activity matching.
-- Additive migration. Apply only after reviewing; no application credentials live here.
BEGIN;

CREATE TABLE IF NOT EXISTS public.meet_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  owner_uid text NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60),
  organizer_name text NOT NULL CHECK (char_length(organizer_name) BETWEEN 1 AND 24),
  starts_on date NOT NULL,
  days integer NOT NULL CHECK (days BETWEEN 1 AND 7),
  duration_minutes integer NOT NULL CHECK (duration_minutes IN (30,60,90,120)),
  activity text NOT NULL DEFAULT 'study' CHECK (activity IN ('study','billiards','mahjong','badminton','meal','other')),
  target_size integer NOT NULL DEFAULT 2 CHECK (target_size BETWEEN 2 AND 20),
  campus text NOT NULL DEFAULT '' CHECK (char_length(campus) <= 80),
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  vibe text NOT NULL DEFAULT 'any' CHECK (vibe IN ('any','E','I')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at timestamptz,
  confirmed_start timestamp,
  confirmed_end timestamp,
  CHECK (visibility = 'private' OR char_length(campus) > 0)
);

CREATE TABLE IF NOT EXISTS public.meet_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL REFERENCES public.meet_invitations(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  participant_uid text,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 24),
  vibe text NOT NULL DEFAULT 'any' CHECK (vibe IN ('any','E','I')),
  slots jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(slots) = 'array'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(invitation_id, token_hash)
);
ALTER TABLE public.meet_responses ADD COLUMN IF NOT EXISTS personality_type text;
ALTER TABLE public.meet_responses ADD COLUMN IF NOT EXISTS preferred_personality text;
DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='meet_responses_personality_type_check' AND conrelid='public.meet_responses'::regclass) THEN
    ALTER TABLE public.meet_responses ADD CONSTRAINT meet_responses_personality_type_check CHECK (personality_type IS NULL OR personality_type IN ('ISTJ','ISFJ','INFJ','INTJ','ISTP','ISFP','INFP','INTP','ESTP','ESFP','ENFP','ENTP','ESTJ','ESFJ','ENFJ','ENTJ'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='meet_responses_preferred_personality_check' AND conrelid='public.meet_responses'::regclass) THEN
    ALTER TABLE public.meet_responses ADD CONSTRAINT meet_responses_preferred_personality_check CHECK (preferred_personality IS NULL OR preferred_personality IN ('ISTJ','ISFJ','INFJ','INTJ','ISTP','ISFP','INFP','INTP','ESTP','ESFP','ENFP','ENTP','ESTJ','ESFJ','ENFJ','ENTJ'));
  END IF;
END;
$constraints$;
CREATE UNIQUE INDEX IF NOT EXISTS meet_response_owner ON public.meet_responses(invitation_id, participant_uid) WHERE participant_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS meet_discovery ON public.meet_invitations(campus, activity, starts_on) WHERE visibility='public' AND closed_at IS NULL AND confirmed_start IS NULL;
ALTER TABLE public.meet_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meet_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meet_invitations, public.meet_responses FROM PUBLIC, anon, authenticated;

-- Do not grant internal helpers to API clients. Every public entry rechecks its boundary.
CREATE OR REPLACE FUNCTION public.meet_signed_uid()
RETURNS text LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE claims jsonb; actor text;
BEGIN
  actor := nullif(auth.uid(), '');
  BEGIN
    claims := coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  -- The existing CloudBase project uses current_is_anon() as the canonical
  -- distinction between registered and anonymous auth sessions. Some provider
  -- tokens may not carry is_anonymous in request.jwt.claims, so checking the
  -- JWT flag alone could accidentally accept an anonymous session.
  IF auth.role() IS DISTINCT FROM 'authenticated' OR actor IS NULL
    OR coalesce(public.current_is_anon(), true)
    OR coalesce(claims->>'is_anonymous','false') = 'true' THEN RETURN NULL; END IF;
  RETURN actor;
END;
$function$;

CREATE OR REPLACE FUNCTION public.meet_payload(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'id',m.id,'code',m.code,'title',m.title,'organizerName',m.organizer_name,
    'startsOn',to_char(m.starts_on,'YYYY-MM-DD'),'days',m.days,'durationMinutes',m.duration_minutes,
    'activity',m.activity,'targetSize',m.target_size,'campus',m.campus,'visibility',m.visibility,'vibe',m.vibe,
    'createdAt',m.created_at,'closedAt',m.closed_at,
    'confirmedStart',to_char(m.confirmed_start,'YYYY-MM-DD"T"HH24:MI'),
    'confirmedEnd',to_char(m.confirmed_end,'YYYY-MM-DD"T"HH24:MI'),
    'mine',m.owner_uid IS NOT DISTINCT FROM public.meet_signed_uid(),
    'detailsVisible',true,
    'participantCount',(SELECT count(*)::int FROM public.meet_responses r WHERE r.invitation_id=m.id),
    'participants',coalesce((SELECT jsonb_agg(jsonb_build_object('name',r.name,'vibe',r.vibe,'personalityType',r.personality_type) ORDER BY r.created_at,r.id) FROM public.meet_responses r WHERE r.invitation_id=m.id),'[]'::jsonb),
    'slotCounts',coalesce((SELECT jsonb_agg(jsonb_build_object('slot',a.slot,'count',a.n) ORDER BY a.slot) FROM (
      SELECT s.slot,count(*)::int AS n FROM public.meet_responses r CROSS JOIN LATERAL jsonb_array_elements_text(r.slots) s(slot)
      WHERE r.invitation_id=m.id GROUP BY s.slot
    ) a),'[]'::jsonb)
  ) FROM public.meet_invitations m WHERE m.id=p_id;
$function$;

-- Public discovery cards only need activity metadata and the aggregate headcount.
-- Keep participant names, vibes and per-slot availability behind the invitation capability.
CREATE OR REPLACE FUNCTION public.meet_preview_payload(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'id',m.id,'code',m.code,'title',m.title,'organizerName','',
    'startsOn',to_char(m.starts_on,'YYYY-MM-DD'),'days',m.days,'durationMinutes',m.duration_minutes,
    'activity',m.activity,'targetSize',m.target_size,'campus',m.campus,'visibility',m.visibility,'vibe','any',
    'createdAt',m.created_at,'closedAt',m.closed_at,
    'confirmedStart',to_char(m.confirmed_start,'YYYY-MM-DD"T"HH24:MI'),
    'confirmedEnd',to_char(m.confirmed_end,'YYYY-MM-DD"T"HH24:MI'),
    'mine',false,
    'detailsVisible',false,
    'participantCount',(SELECT count(*)::int FROM public.meet_responses r WHERE r.invitation_id=m.id),
    'participants','[]'::jsonb,
    'slotCounts','[]'::jsonb
  ) FROM public.meet_invitations m WHERE m.id=p_id;
$function$;

DROP FUNCTION IF EXISTS public.meet_create(text,text,integer,integer,text,text,integer,text,text,text,jsonb,text);
CREATE OR REPLACE FUNCTION public.meet_create(
  p_title text,p_starts_on text,p_days integer,p_duration_minutes integer,p_organizer_name text,
  p_activity text DEFAULT 'study',p_target_size integer DEFAULT 2,p_campus text DEFAULT '',
  p_visibility text DEFAULT 'private',p_vibe text DEFAULT 'any',p_slots jsonb DEFAULT NULL,p_token text DEFAULT NULL,
  p_personality_type text DEFAULT NULL,p_preferred_personality text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE actor text; start_date date; created_id uuid; created_code text; today date := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date;
BEGIN
  actor := public.meet_signed_uid();
  IF actor IS NULL THEN RAISE EXCEPTION '请先登录哦狐再发起活动' USING ERRCODE='42501'; END IF;
  IF p_title IS NULL OR btrim(p_title)='' OR char_length(btrim(p_title))>60
    OR p_organizer_name IS NULL OR btrim(p_organizer_name)='' OR char_length(btrim(p_organizer_name))>24 THEN
    RAISE EXCEPTION '请填写活动名称和发起人昵称';
  END IF;
  IF p_starts_on IS NULL OR p_starts_on !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION '请选择有效日期'; END IF;
  BEGIN start_date:=p_starts_on::date; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION '请选择有效日期'; END;
  IF to_char(start_date,'YYYY-MM-DD')<>p_starts_on OR start_date<today OR start_date>today+90
    OR p_days IS NULL OR p_days NOT BETWEEN 1 AND 7 OR p_duration_minutes IS NULL OR p_duration_minutes NOT IN (30,60,90,120) THEN
    RAISE EXCEPTION '活动范围为未来90天内的1至7天，时长为30至120分钟';
  END IF;
  IF p_activity IS NULL OR p_activity NOT IN ('study','billiards','mahjong','badminton','meal','other')
    OR p_target_size IS NULL OR p_target_size NOT BETWEEN 2 AND 20
    OR p_visibility IS NULL OR p_visibility NOT IN ('private','public')
    OR p_vibe IS NULL OR p_vibe NOT IN ('any','E','I')
    OR p_campus IS NULL OR char_length(btrim(p_campus))>80
    OR (p_visibility='public' AND btrim(p_campus)='') THEN RAISE EXCEPTION '请检查活动项目、人数、学校和公开范围'; END IF;
  IF (p_personality_type IS NOT NULL AND p_personality_type NOT IN ('ISTJ','ISFJ','INFJ','INTJ','ISTP','ISFP','INFP','INTP','ESTP','ESFP','ENFP','ENTP','ESTJ','ESFJ','ENFJ','ENTJ'))
    OR (p_preferred_personality IS NOT NULL AND p_preferred_personality NOT IN ('ISTJ','ISFJ','INFJ','INTJ','ISTP','ISFP','INFP','INTP','ESTP','ESFP','ENFP','ENTP','ESTJ','ESFJ','ENFJ','ENTJ')) THEN RAISE EXCEPTION '人格类型无效'; END IF;
  -- An account can own at most 50 still-open rooms, keeping creation bounded.
  PERFORM pg_advisory_xact_lock(hashtextextended(actor,2701));
  IF (SELECT count(*) FROM public.meet_invitations WHERE owner_uid=actor AND closed_at IS NULL AND starts_on+days>today)>=50 THEN RAISE EXCEPTION '进行中的活动较多，请先结束不再使用的活动'; END IF;
  INSERT INTO public.meet_invitations(owner_uid,title,organizer_name,starts_on,days,duration_minutes,activity,target_size,campus,visibility,vibe)
  VALUES(actor,btrim(p_title),btrim(p_organizer_name),start_date,p_days,p_duration_minutes,p_activity,p_target_size,btrim(p_campus),p_visibility,p_vibe) RETURNING id INTO created_id;
  IF p_slots IS NOT NULL OR p_token IS NOT NULL THEN
    IF p_slots IS NULL OR p_token IS NULL THEN RAISE EXCEPTION '请同时提交发起人的空闲时间和参与凭证'; END IF;
    SELECT code INTO created_code FROM public.meet_invitations WHERE id=created_id;
    RETURN public.meet_respond(created_code,p_organizer_name,p_token,p_slots,p_vibe,p_personality_type,p_preferred_personality);
  END IF;
  RETURN public.meet_payload(created_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.meet_get(p_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE found_id uuid;
BEGIN
  IF p_code IS NULL OR p_code !~ '^[a-fA-F0-9]{32}$' THEN RAISE EXCEPTION '活动不存在或链接不完整'; END IF;
  SELECT id INTO found_id FROM public.meet_invitations WHERE code=lower(p_code);
  IF found_id IS NULL THEN RAISE EXCEPTION '活动不存在或链接不完整'; END IF;
  RETURN public.meet_preview_payload(found_id);
END;
$function$;

-- Invite links are shareable identifiers, not authorization to read the group.
-- Full details require organizer identity, participant identity, or a guest token.
CREATE OR REPLACE FUNCTION public.meet_get_member(p_code text,p_token text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE found_id uuid; owner_id text; actor text:=public.meet_signed_uid(); token_digest text;
BEGIN
  IF p_code IS NULL OR p_code !~ '^[a-fA-F0-9]{32}$' THEN RAISE EXCEPTION '活动不存在或链接不完整'; END IF;
  IF p_token IS NOT NULL AND p_token !~ '^[a-fA-F0-9]{64}$' THEN RAISE EXCEPTION '参与凭证无效'; END IF;
  SELECT id,owner_uid INTO found_id,owner_id FROM public.meet_invitations WHERE code=lower(p_code);
  IF found_id IS NULL THEN RAISE EXCEPTION '活动不存在或链接不完整'; END IF;
  IF p_token IS NOT NULL THEN token_digest:=encode(sha256(convert_to(lower(p_token),'UTF8')),'hex'); END IF;
  IF (actor IS NOT NULL AND owner_id=actor)
    OR (actor IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.meet_responses r WHERE r.invitation_id=found_id AND r.participant_uid=actor
    ))
    OR (token_digest IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.meet_responses r WHERE r.invitation_id=found_id AND r.token_hash=token_digest
        AND (r.participant_uid IS NULL OR r.participant_uid=actor)
    )) THEN
    RETURN public.meet_payload(found_id);
  END IF;
  RETURN public.meet_preview_payload(found_id);
END;
$function$;

DROP FUNCTION IF EXISTS public.meet_respond(text,text,text,jsonb,text);
CREATE OR REPLACE FUNCTION public.meet_respond(p_code text,p_name text,p_token text,p_slots jsonb,p_vibe text DEFAULT 'any',p_personality_type text DEFAULT NULL,p_preferred_personality text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE m public.meet_invitations; token_digest text; actor text; existing_id uuid; slot text; at_time timestamp; normalized jsonb;
BEGIN
  IF p_code IS NULL OR p_code !~ '^[a-fA-F0-9]{32}$' THEN RAISE EXCEPTION '活动不存在或链接不完整'; END IF;
  SELECT * INTO m FROM public.meet_invitations WHERE code=lower(p_code) FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION '活动不存在或链接不完整'; END IF;
  IF m.closed_at IS NOT NULL OR m.confirmed_start IS NOT NULL THEN RAISE EXCEPTION '活动已结束或已确定时间，不能再修改回复'; END IF;
  IF m.starts_on+m.days <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date THEN RAISE EXCEPTION '活动日期已过，请发起新的活动'; END IF;
  actor:=public.meet_signed_uid();
  IF m.visibility='public' AND actor IS NULL THEN RAISE EXCEPTION '加入同校公开活动前，请先登录哦狐' USING ERRCODE='42501'; END IF;
  IF p_name IS NULL OR btrim(p_name)='' OR char_length(btrim(p_name))>24 THEN RAISE EXCEPTION '昵称需为1至24字'; END IF;
  IF p_vibe IS NULL OR p_vibe NOT IN ('any','E','I') THEN RAISE EXCEPTION '请选择E人、I人或不限'; END IF;
  IF (p_personality_type IS NOT NULL AND p_personality_type NOT IN ('ISTJ','ISFJ','INFJ','INTJ','ISTP','ISFP','INFP','INTP','ESTP','ESFP','ENFP','ENTP','ESTJ','ESFJ','ENFJ','ENTJ'))
    OR (p_preferred_personality IS NOT NULL AND p_preferred_personality NOT IN ('ISTJ','ISFJ','INFJ','INTJ','ISTP','ISFP','INFP','INTP','ESTP','ESFP','ENFP','ENTP','ESTJ','ESFJ','ENFJ','ENTJ')) THEN RAISE EXCEPTION '人格类型无效'; END IF;
  IF p_token IS NULL OR p_token !~ '^[a-fA-F0-9]{64}$' THEN RAISE EXCEPTION '参与凭证无效，请重新打开页面'; END IF;
  IF p_slots IS NULL OR jsonb_typeof(p_slots)<>'array' OR jsonb_array_length(p_slots)=0 OR jsonb_array_length(p_slots)>m.days*28 THEN RAISE EXCEPTION '请选择至少一个有效空闲时间'; END IF;
  FOR slot IN SELECT value #>> '{}' FROM jsonb_array_elements(p_slots) LOOP
    IF slot IS NULL OR slot !~ '^\d{4}-\d{2}-\d{2}T(0[8-9]|1[0-9]|2[0-1]):(00|30)$' THEN RAISE EXCEPTION '空闲时间格式无效'; END IF;
    BEGIN at_time:=slot::timestamp; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION '空闲时间格式无效'; END;
    IF to_char(at_time,'YYYY-MM-DD"T"HH24:MI')<>slot OR at_time::date<m.starts_on OR at_time::date>=m.starts_on+m.days THEN RAISE EXCEPTION '空闲时间超出活动范围'; END IF;
  END LOOP;
  SELECT coalesce(jsonb_agg(v ORDER BY v),'[]'::jsonb) INTO normalized FROM (SELECT DISTINCT jsonb_array_elements_text(p_slots) AS v) a;
  -- A reply must contain at least one future uninterrupted window long enough
  -- for the activity. Without this, a participant could occupy a place while
  -- making any confirmed time mathematically impossible.
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(normalized) s(slot)
    WHERE s.slot::timestamp > CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai'
      AND s.slot::timestamp::time + m.duration_minutes*interval '1 minute' <= time '22:00'
      AND NOT EXISTS (
        SELECT 1 FROM generate_series(s.slot::timestamp,
          s.slot::timestamp + (m.duration_minutes-30)*interval '1 minute',interval '30 minutes') g(at_time)
        WHERE NOT normalized ? to_char(g.at_time,'YYYY-MM-DD"T"HH24:MI')
      )
  ) THEN RAISE EXCEPTION '请选择至少一段满足活动时长的连续未来空闲时间'; END IF;
  token_digest:=encode(sha256(convert_to(lower(p_token),'UTF8')),'hex');
  IF actor IS NOT NULL THEN SELECT id INTO existing_id FROM public.meet_responses WHERE invitation_id=m.id AND participant_uid=actor; END IF;
  IF existing_id IS NULL THEN SELECT id INTO existing_id FROM public.meet_responses WHERE invitation_id=m.id AND token_hash=token_digest; END IF;
  IF existing_id IS NULL AND (SELECT count(*) FROM public.meet_responses WHERE invitation_id=m.id)>=m.target_size THEN RAISE EXCEPTION '活动人数已满，可以发起另一个活动'; END IF;
  IF existing_id IS NULL THEN
    INSERT INTO public.meet_responses(invitation_id,token_hash,participant_uid,name,vibe,slots,personality_type,preferred_personality)
    VALUES(m.id,token_digest,actor,btrim(p_name),p_vibe,normalized,p_personality_type,p_preferred_personality);
  ELSE
    -- An authenticated identity can edit its own row across devices. A private
    -- invitation capability may edit only the exact anonymous row it created.
    IF EXISTS(SELECT 1 FROM public.meet_responses WHERE id=existing_id AND participant_uid IS NOT NULL AND participant_uid IS DISTINCT FROM actor) THEN
      RAISE EXCEPTION '此回复属于另一个账号，请使用自己的参与凭证' USING ERRCODE='42501';
    END IF;
    UPDATE public.meet_responses SET name=btrim(p_name),vibe=p_vibe,slots=normalized,personality_type=p_personality_type,preferred_personality=p_preferred_personality,updated_at=CURRENT_TIMESTAMP,
      participant_uid=coalesce(participant_uid,actor) WHERE id=existing_id;
  END IF;
  RETURN public.meet_payload(m.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.meet_confirm(p_code text,p_start text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE m public.meet_invitations; at_time timestamp; required text[]; participant_count integer;
BEGIN
  SELECT * INTO m FROM public.meet_invitations WHERE code=lower(p_code) FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION '活动不存在'; END IF;
  IF public.meet_signed_uid() IS NULL OR m.owner_uid IS DISTINCT FROM public.meet_signed_uid() THEN RAISE EXCEPTION '只有发起人可以确定时间' USING ERRCODE='42501'; END IF;
  IF m.closed_at IS NOT NULL THEN RAISE EXCEPTION '活动已结束'; END IF;
  IF p_start IS NULL OR p_start !~ '^\d{4}-\d{2}-\d{2}T(0[8-9]|1[0-9]|2[0-1]):(00|30)$' THEN RAISE EXCEPTION '请选择有效时间'; END IF;
  BEGIN at_time:=p_start::timestamp; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION '请选择有效时间'; END;
  IF m.confirmed_start IS NOT NULL THEN
    IF m.confirmed_start=at_time THEN RETURN public.meet_payload(m.id); END IF;
    RAISE EXCEPTION '活动已确定时间';
  END IF;
  IF at_time<=CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai' OR at_time::date<m.starts_on OR at_time::date>=m.starts_on+m.days
    OR at_time::time + m.duration_minutes*interval '1 minute'>time '22:00' THEN RAISE EXCEPTION '请选择活动范围内尚未开始的时间'; END IF;
  SELECT count(*)::int INTO participant_count FROM public.meet_responses WHERE invitation_id=m.id;
  IF participant_count<m.target_size THEN RAISE EXCEPTION '人数尚未到齐，暂不能确认成局'; END IF;
  SELECT array_agg(to_char(s,'YYYY-MM-DD"T"HH24:MI')) INTO required FROM generate_series(at_time,at_time+(m.duration_minutes-30)*interval '1 minute',interval '30 minutes') s;
  IF EXISTS(SELECT 1 FROM public.meet_responses WHERE invitation_id=m.id AND NOT slots ?& required) THEN RAISE EXCEPTION '此时段尚未获得所有参与者确认'; END IF;
  UPDATE public.meet_invitations SET confirmed_start=at_time,confirmed_end=at_time+m.duration_minutes*interval '1 minute' WHERE id=m.id;
  RETURN public.meet_payload(m.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.meet_close(p_code text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE m public.meet_invitations;
BEGIN
  SELECT * INTO m FROM public.meet_invitations WHERE code=lower(p_code) FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION '活动不存在'; END IF;
  IF public.meet_signed_uid() IS NULL OR m.owner_uid IS DISTINCT FROM public.meet_signed_uid() THEN RAISE EXCEPTION '只有发起人可以结束活动' USING ERRCODE='42501'; END IF;
  UPDATE public.meet_invitations SET closed_at=coalesce(closed_at,CURRENT_TIMESTAMP) WHERE id=m.id;
  RETURN public.meet_payload(m.id);
END;
$function$;

-- A participant can release a place. A signed-in participant is identified by
-- their account across devices; a guest needs the same secret used to join.
-- The organizer closes the activity instead of removing their own response.
CREATE OR REPLACE FUNCTION public.meet_leave(p_code text,p_token text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE m public.meet_invitations; actor text; token_digest text; found_id uuid;
BEGIN
  IF p_code IS NULL OR p_code !~ '^[a-fA-F0-9]{32}$' THEN RAISE EXCEPTION '活动不存在或链接不完整'; END IF;
  SELECT * INTO m FROM public.meet_invitations WHERE code=lower(p_code) FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION '活动不存在或链接不完整'; END IF;
  IF m.closed_at IS NOT NULL OR m.confirmed_start IS NOT NULL THEN RAISE EXCEPTION '活动已结束或已确定时间，不能退出'; END IF;
  actor:=public.meet_signed_uid();
  IF actor IS NOT NULL AND m.owner_uid=actor THEN RAISE EXCEPTION '发起人可以结束活动'; END IF;
  IF p_token IS NULL OR p_token !~ '^[a-fA-F0-9]{64}$' THEN RAISE EXCEPTION '参与凭证无效，请重新打开页面'; END IF;
  token_digest:=encode(sha256(convert_to(lower(p_token),'UTF8')),'hex');
  IF actor IS NOT NULL THEN
    SELECT id INTO found_id FROM public.meet_responses WHERE invitation_id=m.id AND participant_uid=actor;
  END IF;
  IF found_id IS NULL THEN
    SELECT id INTO found_id FROM public.meet_responses WHERE invitation_id=m.id AND token_hash=token_digest AND participant_uid IS NULL;
  END IF;
  -- Unknown credentials must not turn this mutation RPC into a details oracle.
  -- A member who has left also loses access to the private group payload.
  IF found_id IS NULL THEN RETURN public.meet_preview_payload(m.id); END IF;
  DELETE FROM public.meet_responses WHERE id=found_id;
  RETURN public.meet_preview_payload(m.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.meet_list()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE actor text:=public.meet_signed_uid(); result jsonb;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION '请先登录哦狐' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(public.meet_payload(a.id) ORDER BY a.created_at DESC),'[]'::jsonb) INTO result FROM (
    SELECT m.id,m.created_at FROM public.meet_invitations m
    WHERE m.owner_uid=actor OR EXISTS (
      SELECT 1 FROM public.meet_responses r WHERE r.invitation_id=m.id AND r.participant_uid=actor
    )
    ORDER BY m.created_at DESC LIMIT 50
  ) a;
  RETURN result;
END;
$function$;

DROP FUNCTION IF EXISTS public.meet_discover(text,text,jsonb,text);
CREATE OR REPLACE FUNCTION public.meet_discover(p_campus text,p_activity text DEFAULT '',p_slots jsonb DEFAULT '[]'::jsonb,p_preferred_vibe text DEFAULT 'any',p_personality_type text DEFAULT NULL,p_preferred_personality text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE result jsonb; slot text; at_time timestamp; actor text:=public.meet_signed_uid();
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION '请先登录哦狐再找同校搭子' USING ERRCODE='42501'; END IF;
  IF p_campus IS NULL OR btrim(p_campus)='' OR char_length(btrim(p_campus))>80 THEN RAISE EXCEPTION '请先选择学校'; END IF;
  IF p_activity IS NULL OR p_activity NOT IN ('','study','billiards','mahjong','badminton','meal','other') THEN RAISE EXCEPTION '活动项目无效'; END IF;
  IF p_preferred_vibe IS NULL OR p_preferred_vibe NOT IN ('any','E','I') THEN RAISE EXCEPTION '搭子类型无效'; END IF;
  IF (p_personality_type IS NOT NULL AND p_personality_type NOT IN ('ISTJ','ISFJ','INFJ','INTJ','ISTP','ISFP','INFP','INTP','ESTP','ESFP','ENFP','ENTP','ESTJ','ESFJ','ENFJ','ENTJ'))
    OR (p_preferred_personality IS NOT NULL AND p_preferred_personality NOT IN ('ISTJ','ISFJ','INFJ','INTJ','ISTP','ISFP','INFP','INTP','ESTP','ESFP','ENFP','ENTP','ESTJ','ESFJ','ENFJ','ENTJ')) THEN RAISE EXCEPTION '人格偏好无效'; END IF;
  IF p_slots IS NULL OR jsonb_typeof(p_slots)<>'array' OR jsonb_array_length(p_slots)>196 THEN RAISE EXCEPTION '空闲时间无效'; END IF;
  FOR slot IN SELECT value #>> '{}' FROM jsonb_array_elements(p_slots) LOOP
    IF slot IS NULL OR slot !~ '^\d{4}-\d{2}-\d{2}T(0[8-9]|1[0-9]|2[0-1]):(00|30)$' THEN RAISE EXCEPTION '空闲时间无效'; END IF;
    BEGIN at_time:=slot::timestamp; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION '空闲时间无效'; END;
  END LOOP;
  SELECT coalesce(jsonb_agg(public.meet_preview_payload(a.id)||jsonb_build_object('personalityMatch',a.personality_match) ORDER BY a.personality_match DESC,a.match_priority DESC,a.created_at DESC),'[]'::jsonb) INTO result FROM (
    SELECT m.id,m.created_at,
      CASE WHEN p_preferred_vibe <> 'any' AND EXISTS (
        SELECT 1 FROM public.meet_responses preferred WHERE preferred.invitation_id=m.id AND preferred.vibe=p_preferred_vibe
      ) THEN 1 ELSE 0 END AS match_priority
      ,CASE WHEN (p_personality_type IS NOT NULL OR p_preferred_personality IS NOT NULL)
        AND (p_preferred_personality IS NULL OR EXISTS (SELECT 1 FROM public.meet_responses r WHERE r.invitation_id=m.id AND r.personality_type=p_preferred_personality))
        AND (p_personality_type IS NULL OR EXISTS (SELECT 1 FROM public.meet_responses r WHERE r.invitation_id=m.id AND r.preferred_personality=p_personality_type))
        THEN true ELSE false END AS personality_match
    FROM public.meet_invitations m WHERE m.campus=btrim(p_campus) AND m.visibility='public'
      AND m.closed_at IS NULL AND m.confirmed_start IS NULL AND m.starts_on+m.days>(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date
      AND (p_activity='' OR m.activity=p_activity)
      AND (SELECT count(*) FROM public.meet_responses r WHERE r.invitation_id=m.id)<m.target_size
      AND (jsonb_array_length(p_slots)=0 OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(p_slots) c(slot)
        WHERE c.slot::timestamp>CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai'
          AND c.slot::timestamp::date>=m.starts_on AND c.slot::timestamp::date<m.starts_on+m.days
          AND c.slot::timestamp::time + m.duration_minutes*interval '1 minute'<=time '22:00'
          AND NOT EXISTS (
            SELECT 1 FROM generate_series(c.slot::timestamp,c.slot::timestamp+(m.duration_minutes-30)*interval '1 minute',interval '30 minutes') g(time)
            WHERE NOT p_slots ? to_char(g.time,'YYYY-MM-DD"T"HH24:MI')
              OR EXISTS (SELECT 1 FROM public.meet_responses r WHERE r.invitation_id=m.id AND NOT r.slots ? to_char(g.time,'YYYY-MM-DD"T"HH24:MI'))
          )
      )) ORDER BY match_priority DESC,m.created_at DESC LIMIT 30
  ) a;
  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.meet_signed_uid(), public.meet_payload(uuid), public.meet_preview_payload(uuid),
  public.meet_create(text,text,integer,integer,text,text,integer,text,text,text,jsonb,text,text,text), public.meet_get(text),
  public.meet_get_member(text,text),
  public.meet_respond(text,text,text,jsonb,text,text,text), public.meet_confirm(text,text), public.meet_close(text), public.meet_leave(text,text), public.meet_list(),
  public.meet_discover(text,text,jsonb,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meet_create(text,text,integer,integer,text,text,integer,text,text,text,jsonb,text,text,text),
  public.meet_confirm(text,text),public.meet_close(text),public.meet_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.meet_get(text),public.meet_respond(text,text,text,jsonb,text,text,text),public.meet_leave(text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meet_get_member(text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meet_discover(text,text,jsonb,text,text,text) TO authenticated;
COMMIT;
