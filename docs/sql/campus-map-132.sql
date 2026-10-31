-- Ohhu campus map/social additive schema, release 1.2.132.
-- Apply only after reviewing the target CloudBase environment. This migration does not
-- alter or backfill existing accounts, moments, schedule links, or reminders.
begin;

create table if not exists public.campus_schools (
  id text primary key,
  name text not null,
  city text not null default '',
  map_style_url text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  constraint campus_school_style_https check (map_style_url is null or map_style_url ~ '^https://')
);

create table if not exists public.campus_campuses (
  id bigserial primary key,
  school_id text not null references public.campus_schools(id) on delete restrict,
  name text not null,
  center_lng double precision,
  center_lat double precision,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  constraint campus_center_pair check ((center_lng is null) = (center_lat is null)),
  constraint campus_center_bounds check (center_lng is null or (center_lng between -180 and 180 and center_lat between -90 and 90)),
  unique (school_id, name)
);

create table if not exists public.campus_pois (
  id bigserial primary key,
  campus_id bigint not null references public.campus_campuses(id) on delete restrict,
  name text not null,
  category text not null default '地点',
  lng double precision not null check (lng between -180 and 180),
  lat double precision not null check (lat between -90 and 90),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (campus_id, name)
);

create table if not exists public.campus_posts (
  id bigserial primary key,
  school_id text not null references public.campus_schools(id) on delete restrict,
  campus_id bigint references public.campus_campuses(id) on delete set null,
  poi_id bigint references public.campus_pois(id) on delete set null,
  author_uid text not null,
  author_name text not null default '校园用户',
  author_avatar text not null default '',
  body text not null default '' check (char_length(body) <= 1000),
  image_urls text[] not null default '{}',
  audience text not null default 'guest_public' check (audience = 'guest_public'),
  status text not null default 'pending' check (status in ('pending','published','hidden')),
  like_count integer not null default 0 check (like_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(btrim(body)) > 0 or cardinality(image_urls) > 0)
);
create index if not exists campus_posts_public_feed on public.campus_posts(school_id, campus_id, created_at desc) where status = 'published';

create table if not exists public.campus_post_likes (
  post_id bigint not null references public.campus_posts(id) on delete cascade,
  user_uid text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_uid)
);

create table if not exists public.campus_post_comments (
  id bigserial primary key,
  post_id bigint not null references public.campus_posts(id) on delete cascade,
  user_uid text not null,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  status text not null default 'published' check (status in ('published','hidden')),
  created_at timestamptz not null default now()
);

alter table public.campus_schools enable row level security;
alter table public.campus_campuses enable row level security;
alter table public.campus_pois enable row level security;
alter table public.campus_posts enable row level security;
alter table public.campus_post_likes enable row level security;
alter table public.campus_post_comments enable row level security;

drop policy if exists campus_schools_read on public.campus_schools;
create policy campus_schools_read on public.campus_schools for select to anon, authenticated using (enabled or public.is_admin_user());
drop policy if exists campus_schools_admin on public.campus_schools;
create policy campus_schools_admin on public.campus_schools for all to authenticated using (public.is_admin_user()) with check (public.is_admin_user());

drop policy if exists campus_campuses_read on public.campus_campuses;
create policy campus_campuses_read on public.campus_campuses for select to anon, authenticated using (enabled or public.is_admin_user());
drop policy if exists campus_campuses_admin on public.campus_campuses;
create policy campus_campuses_admin on public.campus_campuses for all to authenticated using (public.is_admin_user()) with check (public.is_admin_user());

drop policy if exists campus_pois_read on public.campus_pois;
create policy campus_pois_read on public.campus_pois for select to anon, authenticated using (enabled or public.is_admin_user());
drop policy if exists campus_pois_admin on public.campus_pois;
create policy campus_pois_admin on public.campus_pois for all to authenticated using (public.is_admin_user()) with check (public.is_admin_user());

drop policy if exists campus_posts_public_read on public.campus_posts;
create policy campus_posts_public_read on public.campus_posts for select to anon, authenticated using (status = 'published' and audience = 'guest_public');
drop policy if exists campus_posts_owner_read on public.campus_posts;
create policy campus_posts_owner_read on public.campus_posts for select to authenticated using (author_uid = auth.uid()::text or public.is_admin_user());
drop policy if exists campus_posts_insert on public.campus_posts;
create policy campus_posts_insert on public.campus_posts for insert to authenticated with check (author_uid = auth.uid()::text and status = 'pending' and audience = 'guest_public');
drop policy if exists campus_posts_moderate on public.campus_posts;
create policy campus_posts_moderate on public.campus_posts for update to authenticated using (public.is_admin_user()) with check (public.is_admin_user());
drop policy if exists campus_posts_owner_delete on public.campus_posts;
create policy campus_posts_owner_delete on public.campus_posts for delete to authenticated using (author_uid = auth.uid()::text or public.is_admin_user());

drop policy if exists campus_likes_read on public.campus_post_likes;
create policy campus_likes_read on public.campus_post_likes for select to authenticated using (user_uid = auth.uid()::text or exists (select 1 from public.campus_posts p where p.id = post_id and p.status='published' and p.audience='guest_public'));
drop policy if exists campus_likes_insert on public.campus_post_likes;
create policy campus_likes_insert on public.campus_post_likes for insert to authenticated with check (user_uid = auth.uid()::text and exists (select 1 from public.campus_posts p where p.id = post_id and p.status='published' and p.audience='guest_public'));
drop policy if exists campus_likes_delete on public.campus_post_likes;
create policy campus_likes_delete on public.campus_post_likes for delete to authenticated using (user_uid = auth.uid()::text or public.is_admin_user());

drop policy if exists campus_comments_read on public.campus_post_comments;
create policy campus_comments_read on public.campus_post_comments for select to anon, authenticated using (status='published' and exists (select 1 from public.campus_posts p where p.id=post_id and p.status='published' and p.audience='guest_public'));
drop policy if exists campus_comments_insert on public.campus_post_comments;
create policy campus_comments_insert on public.campus_post_comments for insert to authenticated with check (user_uid=auth.uid()::text and status='published' and exists (select 1 from public.campus_posts p where p.id=post_id and p.status='published' and p.audience='guest_public'));
drop policy if exists campus_comments_moderate on public.campus_post_comments;
create policy campus_comments_moderate on public.campus_post_comments for update to authenticated using (public.is_admin_user()) with check (public.is_admin_user());

grant select on public.campus_schools, public.campus_campuses, public.campus_pois to anon, authenticated;
grant select on public.campus_posts, public.campus_post_comments to authenticated;
revoke select on public.campus_posts from anon;
grant select (id, school_id, campus_id, poi_id, author_name, author_avatar, body, image_urls, audience, status, like_count, created_at, updated_at) on public.campus_posts to anon;
revoke select on public.campus_post_comments from anon;
grant select (id, post_id, body, status, created_at) on public.campus_post_comments to anon;
grant insert, update, delete on public.campus_schools, public.campus_campuses, public.campus_pois, public.campus_posts, public.campus_post_comments to authenticated;
grant select, insert, delete on public.campus_post_likes to authenticated;
grant usage, select on sequence public.campus_campuses_id_seq, public.campus_pois_id_seq, public.campus_posts_id_seq, public.campus_post_comments_id_seq to authenticated;

create or replace function public.campus_post_like_count_delta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.campus_posts set like_count = like_count + 1 where id = new.post_id;
    return new;
  end if;
  update public.campus_posts set like_count = greatest(0, like_count - 1) where id = old.post_id;
  return old;
end;
$$;
drop trigger if exists campus_post_like_count on public.campus_post_likes;
create trigger campus_post_like_count after insert or delete on public.campus_post_likes
for each row execute function public.campus_post_like_count_delta();

insert into public.campus_schools(id,name,city,enabled) values
 ('jou','江苏海洋大学','连云港',true),
 ('nmukd','南京医科大学康达学院','连云港',true),
 ('lygsf','连云港师范学院','连云港',true),
 ('lygtc','连云港职业技术学院','连云港',true),
 ('jscfa','江苏财会职业学院','连云港',true)
on conflict (id) do update set name=excluded.name, city=excluded.city;

commit;
