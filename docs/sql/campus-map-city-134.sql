-- Ohhu city map and private check-in extension, release 1.2.134.
-- Additive and idempotent. Review, then apply manually to the intended CloudBase DB.
-- OSM-derived coordinates are enabled as candidates and require local verification.
begin;

alter table public.campus_pois add column if not exists source_url text;
alter table public.campus_pois add column if not exists source_license text;
alter table public.campus_pois add column if not exists verification_status text not null default 'candidate';
alter table public.campus_pois add column if not exists verified_at timestamptz;

insert into public.campus_schools(id,name,city,enabled)
values ('lyg','连云港全城','连云港',true)
on conflict (id) do update set name=excluded.name, city=excluded.city, enabled=true;

insert into public.campus_campuses(school_id,name,center_lng,center_lat,enabled)
values ('lyg','连云港全域',119.2172,34.5933,true)
on conflict (school_id,name) do update set center_lng=excluded.center_lng, center_lat=excluded.center_lat, enabled=true;

insert into public.campus_pois(campus_id,name,category,lng,lat,enabled,source_url,source_license,verification_status)
select c.id,p.name,p.category,p.lng,p.lat,true,p.source_url,'OpenStreetMap ODbL 1.0','candidate'
from public.campus_campuses c
cross join (values
  ('花果山风景区','好玩 · 山海景区',119.29495,34.64538,'https://www.openstreetmap.org/node/6081616899'),
  ('海上云台山国家森林公园南门','好玩 · 山海景区',119.42339,34.70662,'https://www.openstreetmap.org/node/10095329710'),
  ('孔望山风景区','好玩 · 山海景区',119.16850,34.56795,'https://www.openstreetmap.org/way/1006685101'),
  ('桃花涧风景区','好玩 · 山海景区',119.13220,34.53850,'https://www.openstreetmap.org/way/1364903055'),
  ('连云港市博物馆','好玩 · 文化场馆',119.21836,34.59488,'https://www.openstreetmap.org/way/1325570480'),
  ('东海县西双湖国家湿地公园','好玩 · 公园',118.71808,34.52966,'https://www.openstreetmap.org/way/1368997928'),
  ('连云港民主路老街','好玩 · 历史街区',119.17021,34.60543,'https://www.openstreetmap.org/way/1365142928'),
  ('连云港市海鲜蔬菜直销市场','美食 · 海鲜集市',119.17658,34.58620,'https://www.openstreetmap.org/way/1018730838'),
  ('泰源市场','美食 · 农贸集市',119.18658,34.60810,'https://www.openstreetmap.org/way/1365332559'),
  ('院前农贸市场','美食 · 农贸集市',119.35040,34.73571,'https://www.openstreetmap.org/way/1365488125'),
  ('赣榆中心社区农贸市场','美食 · 农贸集市',119.12497,34.84790,'https://www.openstreetmap.org/way/820318370'),
  ('东海县海陵农贸市场','美食 · 农贸集市',118.76882,34.52813,'https://www.openstreetmap.org/way/1366251529'),
  ('海宁路农产品综合市场','美食 · 农贸集市',119.18815,34.58135,'https://www.openstreetmap.org/way/1365277851')
) as p(name,category,lng,lat,source_url)
where c.school_id='lyg' and c.name='连云港全域'
on conflict (campus_id,name) do update set
  category=excluded.category,lng=excluded.lng,lat=excluded.lat,enabled=true,
  source_url=excluded.source_url,source_license=excluded.source_license,
  verification_status=case when public.campus_pois.verification_status='verified' then 'verified' else 'candidate' end;

create table if not exists public.campus_poi_checkins (
  id bigserial primary key,
  poi_id bigint not null references public.campus_pois(id) on delete cascade,
  user_uid text not null,
  note text not null default '' check (char_length(note) <= 240),
  is_public boolean not null default false,
  status text not null default 'private' check (status in ('private','pending','published','hidden')),
  created_at timestamptz not null default now(),
  check ((is_public and status in ('pending','published','hidden')) or (not is_public and status='private'))
);
create index if not exists campus_poi_checkins_owner on public.campus_poi_checkins(user_uid,created_at desc);
create index if not exists campus_poi_checkins_public on public.campus_poi_checkins(poi_id,created_at desc) where is_public and status='published';
alter table public.campus_poi_checkins enable row level security;

drop policy if exists campus_poi_checkins_read on public.campus_poi_checkins;
create policy campus_poi_checkins_read on public.campus_poi_checkins for select to authenticated
  using (user_uid=auth.uid()::text or (is_public and status='published') or public.is_admin_user());
drop policy if exists campus_poi_checkins_insert on public.campus_poi_checkins;
create policy campus_poi_checkins_insert on public.campus_poi_checkins for insert to authenticated
  with check (
    user_uid=auth.uid()::text
    and ((not is_public and status='private') or (is_public and status='pending'))
    and exists (select 1 from public.campus_pois p where p.id=poi_id and p.enabled)
  );
drop policy if exists campus_poi_checkins_moderate on public.campus_poi_checkins;
create policy campus_poi_checkins_moderate on public.campus_poi_checkins for update to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());
drop policy if exists campus_poi_checkins_delete on public.campus_poi_checkins;
create policy campus_poi_checkins_delete on public.campus_poi_checkins for delete to authenticated
  using (user_uid=auth.uid()::text or public.is_admin_user());

grant select,insert,update,delete on public.campus_poi_checkins to authenticated;
grant usage,select on sequence public.campus_poi_checkins_id_seq to authenticated;

create table if not exists public.campus_poi_submissions (
  id bigserial primary key,
  campus_id bigint not null references public.campus_campuses(id) on delete cascade,
  user_uid text not null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  category text not null check (category in ('美食','好玩','打卡')),
  lng double precision not null check (lng between 118 and 120),
  lat double precision not null check (lat between 33 and 36),
  note text not null default '' check (char_length(note) <= 240),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists campus_poi_submissions_review on public.campus_poi_submissions(status,created_at desc);
alter table public.campus_poi_submissions enable row level security;

drop policy if exists campus_poi_submissions_read on public.campus_poi_submissions;
create policy campus_poi_submissions_read on public.campus_poi_submissions for select to authenticated
  using (user_uid=auth.uid()::text or public.is_admin_user());
drop policy if exists campus_poi_submissions_insert on public.campus_poi_submissions;
create policy campus_poi_submissions_insert on public.campus_poi_submissions for insert to authenticated
  with check (
    user_uid=auth.uid()::text and status='pending'
    and exists (select 1 from public.campus_campuses c where c.id=campus_id and c.enabled)
  );
drop policy if exists campus_poi_submissions_moderate on public.campus_poi_submissions;
create policy campus_poi_submissions_moderate on public.campus_poi_submissions for update to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());
grant select,insert,update on public.campus_poi_submissions to authenticated;
grant usage,select on sequence public.campus_poi_submissions_id_seq to authenticated;

create or replace function public.campus_poi_submission_approval()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='approved' and old.status='pending' then
    if not public.is_admin_user() then raise exception 'admin approval required'; end if;
    insert into public.campus_pois(campus_id,name,category,lng,lat,enabled,verification_status,verified_at)
    values (new.campus_id,new.name,new.category,new.lng,new.lat,true,'verified',now())
    on conflict (campus_id,name) do nothing;
    new.reviewed_at=now();
  elsif new.status='rejected' and old.status='pending' then
    if not public.is_admin_user() then raise exception 'admin review required'; end if;
    new.reviewed_at=now();
  end if;
  return new;
end;
$$;
drop trigger if exists campus_poi_submission_review on public.campus_poi_submissions;
create trigger campus_poi_submission_review before update of status on public.campus_poi_submissions
for each row execute function public.campus_poi_submission_approval();

commit;
