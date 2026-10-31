-- One transaction per moderation action; no existing account/business rows rewritten at deployment.
BEGIN;
CREATE OR REPLACE FUNCTION public.admin_set_account_access(account text, banned boolean, target_uid text, reason text DEFAULT '违反校园社区规范')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid text;
  v_actor text := auth.uid();
  v_blocked boolean;
  v_protected boolean;
  v_result jsonb;
  v_reason text := left(coalesce(nullif(btrim(reason), ''), '违反校园社区规范'), 120);
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.uid = v_actor AND p.is_super_admin AND p.banned_at IS NULL
  ) THEN
    RAISE EXCEPTION '仅未被封禁的站长可执行此操作' USING ERRCODE = '42501';
  END IF;
  IF banned IS NULL OR nullif(btrim(account), '') IS NULL OR nullif(btrim(target_uid), '') IS NULL THEN
    RAISE EXCEPTION '账号和目标状态不能为空' USING ERRCODE = '22023';
  END IF;
  v_uid := public.admin_resolve_uid(account);
  IF v_uid IS DISTINCT FROM target_uid THEN
    RAISE EXCEPTION '账号信息已变化，请重新查询后重试' USING ERRCODE = '22023';
  END IF;
  SELECT p.banned_at IS NOT NULL, coalesce(p.is_admin, false) OR coalesce(p.is_super_admin, false)
    INTO v_blocked, v_protected FROM public.profiles p WHERE p.uid = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '未找到账号'; END IF;
  IF v_protected THEN RAISE EXCEPTION '不能封禁或解封管理员账号' USING ERRCODE = '42501'; END IF;

  IF banned THEN
    IF NOT v_blocked THEN
      v_result := public.admin_ban_user(account, v_reason);
      IF v_result->>'uid' IS DISTINCT FROM v_uid THEN RAISE EXCEPTION '账号信息已变化，请重新查询后重试'; END IF;
    END IF;
    INSERT INTO public.user_sanctions(uid, kind, until_at, reason, actor_uid, created_at)
      SELECT v_uid, 'account', NULL, v_reason, v_actor, now()
      WHERE NOT EXISTS (
        SELECT 1 FROM public.user_sanctions s WHERE s.uid = v_uid AND s.kind = 'account' AND s.until_at IS NULL
      );
  ELSE
    IF v_blocked THEN
      v_result := public.admin_unban_user(account);
      IF v_result->>'uid' IS DISTINCT FROM v_uid THEN RAISE EXCEPTION '账号信息已变化，请重新查询后重试'; END IF;
    END IF;
    DELETE FROM public.user_sanctions s WHERE s.uid = v_uid AND s.kind = 'account';
  END IF;
  RETURN jsonb_build_object('ok', true, 'uid', v_uid, 'account', account, 'banned', banned);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_set_account_access(text, boolean, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_account_access(text, boolean, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_account_access(text, boolean, text, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
