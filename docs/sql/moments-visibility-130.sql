-- 朋友圈 1.2.130：保留所有业务行；好友边允许任意方向，但必须有已接受的申请。
-- friends 和 friend_requests 的现行 SELECT RLS 均允许关系中的任一参与者读取。
-- 子表只查询父 moments；父表不查询子表，因此不产生策略递归。
BEGIN;
DROP POLICY IF EXISTS moments_select_visible ON public.moments;
CREATE POLICY moments_select_visible ON public.moments FOR SELECT TO authenticated USING (
  creator_uid = auth.uid()
  OR visibility = 'public'
  OR (visibility = 'friends_only'
    AND EXISTS (SELECT 1 FROM public.friends f WHERE
      (f.user_uid = auth.uid() AND f.friend_uid = moments.creator_uid)
      OR (f.friend_uid = auth.uid() AND f.user_uid = moments.creator_uid))
    AND EXISTS (SELECT 1 FROM public.friend_requests r WHERE r.status = 'accepted' AND (
      (r.from_uid = auth.uid() AND r.to_uid = moments.creator_uid)
      OR (r.to_uid = auth.uid() AND r.from_uid = moments.creator_uid))))
);
DROP POLICY IF EXISTS moments_likes_select_all ON public.moments_likes;
DROP POLICY IF EXISTS moments_likes_select_visible ON public.moments_likes;
CREATE POLICY moments_likes_select_visible ON public.moments_likes FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.moments m WHERE m.id = moments_likes.moment_id)
);
DROP POLICY IF EXISTS moments_likes_insert_own ON public.moments_likes;
CREATE POLICY moments_likes_insert_own ON public.moments_likes FOR INSERT TO authenticated WITH CHECK (
  liker_uid = auth.uid() AND EXISTS (SELECT 1 FROM public.moments m WHERE m.id = moments_likes.moment_id)
);
DROP POLICY IF EXISTS moments_comments_select_all ON public.moments_comments;
DROP POLICY IF EXISTS moments_comments_select_visible ON public.moments_comments;
CREATE POLICY moments_comments_select_visible ON public.moments_comments FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.moments m WHERE m.id = moments_comments.moment_id)
);
DROP POLICY IF EXISTS moments_comments_insert_own ON public.moments_comments;
CREATE POLICY moments_comments_insert_own ON public.moments_comments FOR INSERT TO authenticated WITH CHECK (
  commenter_uid = auth.uid() AND EXISTS (SELECT 1 FROM public.moments m WHERE m.id = moments_comments.moment_id)
);
COMMIT;
