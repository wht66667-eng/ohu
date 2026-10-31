-- 举报 + 五端通知 kind 扩展（CloudBase / Postgres）
-- 与 engagement_checkins.sql 一并在控制台执行。

create table if not exists public.reports (
  id bigserial primary key,
  reporter_uid text not null,
  target_type text not null default 'other',
  target_id text not null default '',
  reason text not null default '',
  detail text not null default '',
  status text not null default 'pending',
  admin_note text not null default '',
  created_at timestamptz not null default now(),
  handled_at timestamptz
);

create index if not exists idx_reports_status on public.reports (status, created_at desc);

alter table public.reports enable row level security;

drop policy if exists reports_insert_self on public.reports;
create policy reports_insert_self on public.reports
  for insert with check (auth.uid()::text = reporter_uid);

drop policy if exists reports_select_admin on public.reports;
create policy reports_select_admin on public.reports
  for select using (
    auth.uid()::text = reporter_uid
    or exists (
      select 1 from public.profiles p
      where p.uid = auth.uid()::text and (p.is_admin = true or p.is_super_admin = true)
    )
  );

drop policy if exists reports_update_admin on public.reports;
create policy reports_update_admin on public.reports
  for update using (
    exists (
      select 1 from public.profiles p
      where p.uid = auth.uid()::text and (p.is_admin = true or p.is_super_admin = true)
    )
  );

-- 若 notifications.kind 有 check 约束，按环境放开下列 kind：
-- rider_grab, rider_dispatch, role_apply_admin, report_new
-- 示例（约束名以实际为准，先查 pg_constraint 再改）：
-- alter table public.notifications drop constraint if exists notifications_kind_check;

-- ===== 旧表收敛（线上曾存在 target_kind + bigint target_id 的旧版 reports 表，
-- create table if not exists 对旧表是空操作，下面的 alter 幂等补齐差异）=====
-- 同份补丁也在 docs/release/reports_target_type.sql（deploy:db 会执行）。

alter table public.reports add column if not exists target_type text not null default 'other';
alter table public.reports add column if not exists admin_note text not null default '';
alter table public.reports alter column target_id type text using target_id::text;
alter table public.reports alter column target_id set default '';
alter table public.reports alter column target_kind drop not null;
alter table public.reports alter column target_kind set default null;

update public.reports
set target_type = case target_kind
  when 'secondhand' then 'secondhand'
  when 'task' then 'task'
  else 'other'
end
where target_type = 'other' and target_kind is not null;

-- 旧表 reports_status_check 只允许 open/resolved/dismissed，先删再迁移，最后加新约束。
alter table public.reports drop constraint if exists reports_status_check;
update public.reports set status = 'pending' where status = 'open';
update public.reports set status = 'done' where status = 'resolved';
update public.reports set status = 'rejected' where status = 'dismissed';
alter table public.reports add constraint reports_status_check
check (status = any (array['pending'::text, 'done'::text, 'rejected'::text]));

create index if not exists idx_reports_status on public.reports (status, created_at desc);

notify pgrst, 'reload schema';
