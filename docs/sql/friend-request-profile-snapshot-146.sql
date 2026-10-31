-- 1.2.146: optional profile snapshot shown only in an incoming friend request.
-- Existing friend_requests SELECT RLS remains the visibility boundary; this does
-- not add a public profile lookup or broaden the recipient/sender policies.
BEGIN;

ALTER TABLE public.friend_requests
  ADD COLUMN IF NOT EXISTS from_motto varchar(40) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS from_intro varchar(160) NOT NULL DEFAULT '';

COMMENT ON COLUMN public.friend_requests.from_motto IS
  'Sender-chosen motto snapshot shared with the recipient as part of this friend request.';
COMMENT ON COLUMN public.friend_requests.from_intro IS
  'Sender-chosen personal introduction snapshot shared with the recipient as part of this friend request.';

COMMIT;
