-- 0003_venues.sql
-- Venues on the map, per-sport ratings (attributes validated per sport) and Waze-style reports.

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  geog extensions.geography(Point, 4326) not null,
  address text check (address is null or char_length(address) <= 300),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  sports text[] not null check (cardinality(sports) between 1 and 6),
  status public.venue_status not null default 'active',
  rating_avg numeric(4, 3),
  rating_count int not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index venues_geog_gist on public.venues using gist (geog);
create index venues_status_idx on public.venues (status);
create index venues_sports_gin on public.venues using gin (sports);
create trigger venues_touch before update on public.venues
  for each row execute function public.st_touch_updated_at();

create function public.st_venues_validate() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if exists (select 1 from unnest(new.sports) s where s not in (select id from public.sports)) then
    perform public.st_raise('validation', 'unknown sport');
  end if;
  if cardinality(new.sports) <> cardinality(array(select distinct unnest(new.sports))) then
    perform public.st_raise('validation', 'duplicate sport');
  end if;
  return new;
end $$;
create trigger venues_validate before insert or update of sports on public.venues
  for each row execute function public.st_venues_validate();

-- Venue rows with lat/lng for clients. security_invoker: filtered by the venues RLS policy.
create view public.venue_views with (security_invoker = true) as
  select v.id, v.name,
         extensions.st_y(v.geog::extensions.geometry) as lat,
         extensions.st_x(v.geog::extensions.geometry) as lng,
         v.address, v.country_code, v.sports, v.status, v.rating_avg, v.rating_count, v.created_by, v.created_at
  from public.venues v;

-- ---------------------------------------------------------------------------
-- venue_ratings: one per (venue, user, sport); attributes validated against sports.rating_attributes
-- ---------------------------------------------------------------------------
create table public.venue_ratings (
  venue_id uuid not null references public.venues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  sport text not null references public.sports (id),
  overall smallint not null check (overall between 1 and 5),
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (venue_id, user_id, sport)
);
create index venue_ratings_user_idx on public.venue_ratings (user_id);
create trigger venue_ratings_touch before update on public.venue_ratings
  for each row execute function public.st_touch_updated_at();

create function public.st_venue_ratings_validate() returns trigger
language plpgsql set search_path = ''
as $$
declare
  schema jsonb;
  k text;
  v jsonb;
  d jsonb;
begin
  select s.rating_attributes into schema from public.sports s where s.id = new.sport;
  if schema is null then
    perform public.st_raise('validation', 'unknown sport');
  end if;
  if not exists (select 1 from public.venues ve where ve.id = new.venue_id and new.sport = any (ve.sports)) then
    perform public.st_raise('validation', 'sport not offered at venue');
  end if;
  for k, v in select * from jsonb_each(new.attributes) loop
    d := schema -> k;
    if d is null then
      perform public.st_raise('validation', 'unknown attribute ' || k);
    elsif d = '"score"'::jsonb then
      if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[1-5]$' then
        perform public.st_raise('validation', 'attribute ' || k || ' must be 1..5');
      end if;
    elsif jsonb_typeof(d) = 'array' then
      if jsonb_typeof(v) <> 'string' or not (d @> jsonb_build_array(v)) then
        perform public.st_raise('validation', 'attribute ' || k || ' has an invalid value');
      end if;
    else
      perform public.st_raise('validation', 'bad attribute schema');
    end if;
  end loop;
  return new;
end $$;
create trigger venue_ratings_validate before insert or update on public.venue_ratings
  for each row execute function public.st_venue_ratings_validate();

-- Keep venues.rating_avg / rating_count in sync (definer: clients cannot write venues).
create function public.st_venue_ratings_aggregate() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare vid uuid := coalesce(new.venue_id, old.venue_id);
begin
  update public.venues ve set
    rating_avg = (select round(avg(r.overall)::numeric, 3) from public.venue_ratings r where r.venue_id = vid),
    rating_count = (select count(*) from public.venue_ratings r where r.venue_id = vid)
  where ve.id = vid;
  return null;
end $$;
create trigger venue_ratings_aggregate after insert or update or delete on public.venue_ratings
  for each row execute function public.st_venue_ratings_aggregate();

-- ---------------------------------------------------------------------------
-- venue_reports: unique per (venue, reporter)
-- ---------------------------------------------------------------------------
create table public.venue_reports (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason public.venue_report_reason not null,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (venue_id, reporter_id)
);
create index venue_reports_reporter_idx on public.venue_reports (reporter_id);
