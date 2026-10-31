-- 打卡 / 连击 / 图标状态（CloudBase / Postgres）
-- 在控制台执行一次即可；前端表不存在时会静默降级到本地存储。

create table if not exists public.checkins (
  id bigserial primary key,
  uid text not null,
  shell text not null default 'user',
  date date not null,
  source text not null default 'app',
  created_at timestamptz not null default now(),
  unique (uid, shell, date)
);

create table if not exists public.user_engagement (
  uid text not null,
  shell text not null default 'user',
  streak_current int not null default 0,
  streak_best int not null default 0,
  last_checkin_date date,
  last_active_at timestamptz,
  icon_state text not null default 'default',
  updated_at timestamptz not null default now(),
  primary key (uid, shell)
);

create index if not exists idx_checkins_uid_date on public.checkins (uid, date desc);
create index if not exists idx_engagement_active on public.user_engagement (last_active_at desc);

-- 按需开启 RLS：本人读写
alter table public.checkins enable row level security;
alter table public.user_engagement enable row level security;

drop policy if exists checkins_self on public.checkins;
create policy checkins_self on public.checkins
  for all using (auth.uid()::text = uid) with check (auth.uid()::text = uid);

drop policy if exists engagement_self on public.user_engagement;
create policy engagement_self on public.user_engagement
  for all using (auth.uid()::text = uid) with check (auth.uid()::text = uid);
