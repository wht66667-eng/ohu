-- Run after campus-map-132.sql and campus-map-city-134.sql.
-- Local photos stay on the device; only explicitly submitted photos are stored here.
begin;
create or replace function public.campus_valid_photo_urls(urls text[])
returns boolean language sql immutable as $$
  select coalesce(cardinality(urls) <= 3 and not exists (
    select 1 from unnest(urls) u where u is null or length(u) > 2048 or u !~* '^https?://'
  ), false);
$$;
alter table public.campus_pois add column if not exists image_urls text[] not null default '{}';
alter table public.campus_pois add column if not exists note text not null default '';
alter table public.campus_poi_submissions add column if not exists image_urls text[] not null default '{}';
alter table public.campus_pois drop constraint if exists campus_pois_photos_valid;
alter table public.campus_pois add constraint campus_pois_photos_valid check (public.campus_valid_photo_urls(image_urls));
alter table public.campus_poi_submissions drop constraint if exists campus_submissions_photos_valid;
alter table public.campus_poi_submissions add constraint campus_submissions_photos_valid check (public.campus_valid_photo_urls(image_urls));

create or replace function public.campus_poi_submission_approval()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='approved' and old.status='pending' then
    if not public.is_admin_user() then raise exception 'admin approval required'; end if;
    insert into public.campus_pois(campus_id,name,category,lng,lat,enabled,verification_status,verified_at,image_urls,note)
    values (new.campus_id,new.name,new.category,new.lng,new.lat,true,'verified',now(),new.image_urls,new.note)
    on conflict (campus_id,name) do nothing;
    if not found then
      raise exception '同名地点已存在，请核对已有地点并修改名称后重新审核';
    end if;
    new.reviewed_at=now();
  elsif new.status='rejected' and old.status='pending' then
    if not public.is_admin_user() then raise exception 'admin review required'; end if;
    new.reviewed_at=now();
  end if;
  return new;
end;
$$;
commit;
