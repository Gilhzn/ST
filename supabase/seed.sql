-- supabase/seed.sql — demo data for local development and preview branches (`supabase db reset`).
-- Never applied to production (`supabase db push` does not run seeds).
-- Demo hosts in 8 cities, venues per city and upcoming games relative to now().

-- Demo users (auth + profile + private). Phone numbers are from fictional/test ranges.
insert into auth.users (id, phone, created_at, raw_user_meta_data)
select u.id, u.phone, now() - interval '120 days', '{"demo": true}'::jsonb
from (values
  ('11111111-0000-4000-8000-000000000001'::uuid, '15550000001'),
  ('11111111-0000-4000-8000-000000000002'::uuid, '15550000002'),
  ('11111111-0000-4000-8000-000000000003'::uuid, '15550000003'),
  ('11111111-0000-4000-8000-000000000004'::uuid, '15550000004'),
  ('11111111-0000-4000-8000-000000000005'::uuid, '15550000005'),
  ('11111111-0000-4000-8000-000000000006'::uuid, '15550000006'),
  ('11111111-0000-4000-8000-000000000007'::uuid, '15550000007'),
  ('11111111-0000-4000-8000-000000000008'::uuid, '15550000008')
) as u(id, phone)
on conflict (id) do nothing;

insert into public.profiles (id, display_name, locale, country_code, verified_host, created_at)
values
  ('11111111-0000-4000-8000-000000000001', 'Noa (Tel Aviv)', 'he', 'IL', true, now() - interval '120 days'),
  ('11111111-0000-4000-8000-000000000002', 'Oliver (London)', 'en', 'GB', true, now() - interval '120 days'),
  ('11111111-0000-4000-8000-000000000003', 'Lucía (Madrid)', 'es', 'ES', false, now() - interval '120 days'),
  ('11111111-0000-4000-8000-000000000004', 'Rafael (São Paulo)', 'pt', 'BR', true, now() - interval '120 days'),
  ('11111111-0000-4000-8000-000000000005', 'Haruto (Tokyo)', 'ja', 'JP', false, now() - interval '120 days'),
  ('11111111-0000-4000-8000-000000000006', 'Maya (New York)', 'en', 'US', true, now() - interval '120 days'),
  ('11111111-0000-4000-8000-000000000007', 'Arjun (Mumbai)', 'hi', 'IN', false, now() - interval '120 days'),
  ('11111111-0000-4000-8000-000000000008', 'Camille (Paris)', 'fr', 'FR', false, now() - interval '120 days')
on conflict (id) do nothing;

insert into public.profile_private (user_id, phone, birth_year, birth_month, gender)
select p.id, '+' || u.phone, 1992, 6, case when p.id::text like '%1' or p.id::text like '%6' then 'female'::public.gender else 'undisclosed'::public.gender end
from public.profiles p join auth.users u on u.id = p.id
where p.id::text like '11111111-0000-4000-8000-00000000000%'
on conflict (user_id) do nothing;

-- Venues: (name, lat, lng, address, country, sports, creator)
insert into public.venues (id, name, geog, address, country_code, sports, created_by)
select v.id::uuid, v.name, public.st_point(v.lat, v.lng), v.addr, v.cc, v.sports, v.creator::uuid
from (values
  ('22222222-0000-4000-8000-000000000101', 'Gordon Beach Courts', 32.0853, 34.7678, 'Gordon Beach, Tel Aviv', 'IL', array['volleyball', 'running'], '11111111-0000-4000-8000-000000000001'),
  ('22222222-0000-4000-8000-000000000102', 'Yarkon Park Pitch', 32.0989, 34.8118, 'Yarkon Park, Tel Aviv', 'IL', array['football', 'running'], '11111111-0000-4000-8000-000000000001'),
  ('22222222-0000-4000-8000-000000000201', 'Hackney Marshes', 51.5541, -0.0262, 'Homerton Rd, London', 'GB', array['football'], '11111111-0000-4000-8000-000000000002'),
  ('22222222-0000-4000-8000-000000000202', 'Regent''s Park Tennis', 51.5313, -0.1570, 'Regent''s Park, London', 'GB', array['tennis'], '11111111-0000-4000-8000-000000000002'),
  ('22222222-0000-4000-8000-000000000203', 'Hyde Park Pitches', 51.5073, -0.1657, 'Hyde Park, London W2', 'GB', array['football', 'running'], '11111111-0000-4000-8000-000000000002'),
  ('22222222-0000-4000-8000-000000000204', 'Westway Sports Centre', 51.5203, -0.2126, '1 Crowthorne Rd, London W10', 'GB', array['basketball', 'football'], '11111111-0000-4000-8000-000000000002'),
  ('22222222-0000-4000-8000-000000000205', 'Battersea Park Track', 51.4791, -0.1566, 'Battersea Park, London SW11', 'GB', array['running'], '11111111-0000-4000-8000-000000000002'),
  ('22222222-0000-4000-8000-000000000301', 'Parque del Retiro Courts', 40.4153, -3.6845, 'Retiro, Madrid', 'ES', array['padel', 'tennis'], '11111111-0000-4000-8000-000000000003'),
  ('22222222-0000-4000-8000-000000000302', 'Madrid Río Canchas', 40.4010, -3.7210, 'Madrid Río, Madrid', 'ES', array['football', 'basketball'], '11111111-0000-4000-8000-000000000003'),
  ('22222222-0000-4000-8000-000000000401', 'Parque Ibirapuera Quadras', -23.5874, -46.6576, 'Ibirapuera, São Paulo', 'BR', array['football', 'volleyball', 'running'], '11111111-0000-4000-8000-000000000004'),
  ('22222222-0000-4000-8000-000000000501', 'Yoyogi Park Courts', 35.6717, 139.6950, 'Yoyogi, Shibuya, Tokyo', 'JP', array['basketball', 'running'], '11111111-0000-4000-8000-000000000005'),
  ('22222222-0000-4000-8000-000000000601', 'West 4th Street Courts', 40.7310, -74.0010, '6th Ave & W 4th St, New York', 'US', array['basketball'], '11111111-0000-4000-8000-000000000006'),
  ('22222222-0000-4000-8000-000000000602', 'Central Park Great Lawn', 40.7812, -73.9665, 'Central Park, New York', 'US', array['football', 'running'], '11111111-0000-4000-8000-000000000006'),
  ('22222222-0000-4000-8000-000000000701', 'Shivaji Park Ground', 19.0269, 72.8381, 'Dadar, Mumbai', 'IN', array['football', 'running'], '11111111-0000-4000-8000-000000000007'),
  ('22222222-0000-4000-8000-000000000801', 'Champ de Mars Terrain', 48.8556, 2.2986, 'Champ de Mars, Paris', 'FR', array['football', 'running'], '11111111-0000-4000-8000-000000000008'),
  ('22222222-0000-4000-8000-000000000802', 'Paris Padel Club', 48.8370, 2.2620, 'Porte de Saint-Cloud, Paris', 'FR', array['padel'], '11111111-0000-4000-8000-000000000008')
) as v(id, name, lat, lng, addr, cc, sports, creator)
on conflict (id) do nothing;

-- Upcoming games: (id, host, venue, sport, title, visibility, hide, capacity, starts_in, minutes, deposit, currency, women_only, teams)
insert into public.games (id, host_id, venue_id, sport, title, visibility, geog, approx_geog, hide_exact_location, capacity,
                          starts_at, ends_at, deposit_minor, currency, women_only, team_count)
select g.id::uuid, g.host::uuid, g.venue::uuid, g.sport, g.title, g.vis::public.game_visibility, ve.geog, ve.geog, g.hide, g.cap,
       date_trunc('hour', now()) + g.starts_in, date_trunc('hour', now()) + g.starts_in + make_interval(mins => g.minutes),
       g.deposit, g.currency, g.women, g.teams
from (values
  ('33333333-0000-4000-8000-000000000101', '11111111-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000101', 'volleyball', 'Sunset beach volley', 'public', false, 8, interval '1 day 2 hours', 90, 0, 'ILS', false, 2),
  ('33333333-0000-4000-8000-000000000102', '11111111-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000102', 'football', 'Women''s 7-a-side', 'public', true, 14, interval '2 days', 90, 2000, 'ILS', true, 2),
  ('33333333-0000-4000-8000-000000000201', '11111111-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000201', 'football', 'Sunday league kickabout', 'public', false, 22, interval '3 days', 90, 400, 'GBP', false, 2),
  ('33333333-0000-4000-8000-000000000202', '11111111-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000202', 'tennis', 'Doubles ladder', 'private', true, 4, interval '1 day 5 hours', 60, 0, 'GBP', false, 2),
  ('33333333-0000-4000-8000-000000000203', '11111111-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000203', 'football', 'Midweek 5-a-side', 'public', false, 10, interval '1 day 3 hours', 60, 400, 'GBP', false, 2),
  ('33333333-0000-4000-8000-000000000204', '11111111-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000204', 'basketball', 'Westway run', 'public', false, 10, interval '2 days 4 hours', 90, 200, 'GBP', false, 2),
  ('33333333-0000-4000-8000-000000000205', '11111111-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000205', 'running', 'Saturday 5k tempo', 'public', false, 20, interval '5 days', 45, 0, 'GBP', false, 1),
  ('33333333-0000-4000-8000-000000000301', '11111111-0000-4000-8000-000000000003', '22222222-0000-4000-8000-000000000301', 'padel', 'Pádel after work', 'public', false, 4, interval '20 hours', 90, 500, 'EUR', false, 2),
  ('33333333-0000-4000-8000-000000000401', '11111111-0000-4000-8000-000000000004', '22222222-0000-4000-8000-000000000401', 'football', 'Pelada de sábado', 'public', false, 12, interval '4 days', 120, 0, 'BRL', false, 2),
  ('33333333-0000-4000-8000-000000000501', '11111111-0000-4000-8000-000000000005', '22222222-0000-4000-8000-000000000501', 'basketball', '3x3 pickup', 'public', false, 6, interval '1 day', 60, 0, 'JPY', false, 2),
  ('33333333-0000-4000-8000-000000000601', '11111111-0000-4000-8000-000000000006', '22222222-0000-4000-8000-000000000601', 'basketball', 'The Cage run', 'public', false, 10, interval '6 hours', 90, 0, 'USD', false, 2),
  ('33333333-0000-4000-8000-000000000602', '11111111-0000-4000-8000-000000000006', '22222222-0000-4000-8000-000000000602', 'running', 'Reservoir 10k', 'public', false, 30, interval '2 days 1 hour', 75, 0, 'USD', false, 1),
  ('33333333-0000-4000-8000-000000000701', '11111111-0000-4000-8000-000000000007', '22222222-0000-4000-8000-000000000701', 'football', 'Morning 5-a-side', 'public', false, 10, interval '1 day 12 hours', 60, 20000, 'INR', false, 2),
  ('33333333-0000-4000-8000-000000000801', '11111111-0000-4000-8000-000000000008', '22222222-0000-4000-8000-000000000801', 'running', 'Footing au Champ de Mars', 'public', false, 20, interval '1 day 15 hours', 60, 0, 'EUR', false, 1),
  ('33333333-0000-4000-8000-000000000802', '11111111-0000-4000-8000-000000000008', '22222222-0000-4000-8000-000000000802', 'padel', 'Padel entre amis', 'private', true, 4, interval '3 days 4 hours', 90, 1000, 'EUR', false, 2)
) as g(id, host, venue, sport, title, vis, hide, cap, starts_in, minutes, deposit, currency, women, teams)
join public.venues ve on ve.id = g.venue::uuid
on conflict (id) do nothing;

-- Hosts are approved participants of their games.
insert into public.game_participants (game_id, user_id, status, requested_at, decided_at)
select g.id, g.host_id, 'approved', now(), now()
from public.games g where g.id::text like '33333333-0000-4000-8000-%'
on conflict do nothing;

-- Recurring series (GAME-010): a weekly Tuesday 20:00 game in Tel Aviv (Asia/Jerusalem) and a weekly
-- Thursday 19:30 game in London (Europe/London), generated 4 weeks ahead in local time (DST-correct),
-- each with two regulars (one "always in", auto-joined to every occurrence).
insert into auth.users (id, phone, created_at, raw_user_meta_data)
select u.id, u.phone, now() - interval '90 days', '{"demo": true}'::jsonb
from (values
  ('11111111-0000-4000-8000-000000000011'::uuid, '15550000011'),
  ('11111111-0000-4000-8000-000000000012'::uuid, '15550000012'),
  ('11111111-0000-4000-8000-000000000021'::uuid, '15550000021'),
  ('11111111-0000-4000-8000-000000000022'::uuid, '15550000022')
) as u(id, phone)
on conflict (id) do nothing;

insert into public.profiles (id, display_name, locale, country_code, created_at)
values
  ('11111111-0000-4000-8000-000000000011', 'Yoni (Tel Aviv)', 'he', 'IL', now() - interval '90 days'),
  ('11111111-0000-4000-8000-000000000012', 'Dana (Tel Aviv)', 'he', 'IL', now() - interval '90 days'),
  ('11111111-0000-4000-8000-000000000021', 'Sam (London)', 'en', 'GB', now() - interval '90 days'),
  ('11111111-0000-4000-8000-000000000022', 'Priya (London)', 'en', 'GB', now() - interval '90 days')
on conflict (id) do nothing;

insert into public.profile_private (user_id, phone, birth_year, birth_month, gender)
select p.id, '+' || u.phone, 1994, 3, 'undisclosed'
from public.profiles p join auth.users u on u.id = p.id
where p.id in ('11111111-0000-4000-8000-000000000011', '11111111-0000-4000-8000-000000000012',
               '11111111-0000-4000-8000-000000000021', '11111111-0000-4000-8000-000000000022')
on conflict (user_id) do nothing;

insert into public.game_series (id, host_id, sport, title, visibility, venue_id, geog, approx_geog, capacity, min_players, deposit_minor,
                                currency, team_count, recurrence, weekday, start_time, time_zone, duration_minutes, anchor_date,
                                created_at, updated_at)
select s.id::uuid, s.host::uuid, s.sport, s.title, 'public', s.venue::uuid, ve.geog, ve.geog, s.cap, 6, 0, s.currency, 2, 'weekly', s.wd,
       s.st::time, s.tz, s.minutes,
       ((now() at time zone s.tz)::date + ((s.wd - extract(isodow from (now() at time zone s.tz)::date)::int + 7) % 7))::date,
       now(), now()
from (values
  ('44444444-0000-4000-8000-000000000101', '11111111-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000102',
   'football', 'Tuesday night 7-a-side', 14, 'ILS', 2, '20:00', 'Asia/Jerusalem', 90),
  ('44444444-0000-4000-8000-000000000201', '11111111-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000203',
   'football', 'Thursday 5-a-side', 10, 'GBP', 4, '19:30', 'Europe/London', 60)
) as s(id, host, venue, sport, title, cap, currency, wd, st, tz, minutes)
join public.venues ve on ve.id = s.venue::uuid
on conflict (id) do nothing;

insert into public.series_roster (series_id, user_id, status, always_in, joined_via, joined_at)
values
  ('44444444-0000-4000-8000-000000000101', '11111111-0000-4000-8000-000000000011', 'regular', true, 'invite_link', now() - interval '2 days'),
  ('44444444-0000-4000-8000-000000000101', '11111111-0000-4000-8000-000000000012', 'regular', false, 'invite_link', now() - interval '1 day'),
  ('44444444-0000-4000-8000-000000000201', '11111111-0000-4000-8000-000000000021', 'regular', true, 'invite_link', now() - interval '2 days'),
  ('44444444-0000-4000-8000-000000000201', '11111111-0000-4000-8000-000000000022', 'regular', false, 'host', now() - interval '1 day')
on conflict do nothing;

select public.st_series_generate(s.id, now()) from public.game_series s where s.id::text like '44444444-0000-4000-8000-%';
