-- 0002_identity.sql
-- Profiles (public + private), sports, user sports, push tokens, blocks, roles.

-- ---------------------------------------------------------------------------
-- sports (reference data; mirrors SPORT_POSITIONS and VENUE_RATING_ATTRIBUTES in types.ts)
-- ---------------------------------------------------------------------------
create table public.sports (
  id text primary key check (id ~ '^[a-z][a-z0-9_]*$'),
  positions text[] not null default '{}',
  rating_attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(rating_attributes) = 'object'),
  sort_order int not null default 0
);

insert into public.sports (id, positions, rating_attributes, sort_order) values
  ('football', array['goalkeeper', 'defender', 'midfielder', 'forward'],
   '{"surface": ["natural_grass", "artificial_turf", "hard", "indoor"], "lighting": "score", "goals_nets": "score"}', 1),
  ('basketball', array['point_guard', 'shooting_guard', 'small_forward', 'power_forward', 'center'],
   '{"surface": ["outdoor_hard", "indoor_wood", "rubber"], "hoops": "score", "nets": "score", "lighting": "score"}', 2),
  ('tennis', array[]::text[],
   '{"surface": ["clay", "hard", "grass", "carpet"], "nets": "score", "lighting": "score"}', 3),
  ('padel', array['left_side', 'right_side'],
   '{"walls": ["glass", "masonry"], "surface": ["artificial_turf", "hard"], "lighting": "score"}', 4),
  ('running', array[]::text[],
   '{"surface": ["track", "road", "trail", "mixed"], "lighting": "score", "water_access": "score"}', 5),
  ('volleyball', array['setter', 'outside_hitter', 'opposite', 'middle_blocker', 'libero'],
   '{"surface": ["sand", "indoor", "grass"], "net": "score", "lighting": "score"}', 6);

-- ---------------------------------------------------------------------------
-- profiles
-- No FK to auth.users on purpose: on account deletion the profile becomes a pseudonymous
-- tombstone that outlives the auth user, so sanctions/audit rows keep a valid referent.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key,
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 1024),
  bio text check (bio is null or char_length(bio) <= 280),
  locale public.locale_code not null default 'en',
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  -- Reliability snapshot (written only by definer functions / service role)
  reliability_score numeric(6, 5) check (reliability_score is null or reliability_score between 0 and 1),
  reliability_status public.reliability_status not null default 'new',
  reliability_verified_count int not null default 0,
  reliability_commitment_count int not null default 0,
  reliability_late_cancel_count int not null default 0,
  reliability_no_show_count int not null default 0,
  reliability_computed_at timestamptz not null default now(),
  verified_host boolean not null default false,
  -- Projections of in-force sanctions (sanctions are the source of truth)
  chat_muted_until timestamptz,
  join_banned_until timestamptz,
  host_suspended_until timestamptz,
  visibility_restricted_until timestamptz,
  permanently_banned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger profiles_touch before update on public.profiles
  for each row execute function public.st_touch_updated_at();

-- ---------------------------------------------------------------------------
-- profile_private (owner-only; never exposed to other users)
-- ---------------------------------------------------------------------------
create table public.profile_private (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  birth_year int not null check (birth_year between 1900 and 2100),
  birth_month int not null check (birth_month between 1 and 12),
  gender public.gender not null default 'undisclosed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profile_private_touch before update on public.profile_private
  for each row execute function public.st_touch_updated_at();

-- ---------------------------------------------------------------------------
-- user_sports
-- ---------------------------------------------------------------------------
create table public.user_sports (
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  sport text not null references public.sports (id),
  self_skill smallint not null check (self_skill between 1 and 5),
  attributes jsonb not null check (
    jsonb_typeof(attributes) = 'object'
    and (attributes ->> 'speed') ~ '^[1-5]$'
    and (attributes ->> 'control') ~ '^[1-5]$'
    and (attributes ->> 'overall') ~ '^[1-5]$'
  ),
  positions text[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (user_id, sport)
);

create function public.st_user_sports_validate() returns trigger
language plpgsql set search_path = ''
as $$
declare allowed text[];
begin
  select s.positions into allowed from public.sports s where s.id = new.sport;
  if not (new.positions <@ coalesce(allowed, '{}')) then
    perform public.st_raise('validation', 'position not valid for sport');
  end if;
  if cardinality(new.positions) <> cardinality(array(select distinct unnest(new.positions))) then
    perform public.st_raise('validation', 'duplicate position');
  end if;
  return new;
end $$;
create trigger user_sports_validate before insert or update on public.user_sports
  for each row execute function public.st_user_sports_validate();

-- ---------------------------------------------------------------------------
-- push_tokens
-- ---------------------------------------------------------------------------
create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  token text not null unique check (char_length(token) between 8 and 512),
  platform public.push_platform not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id);

-- ---------------------------------------------------------------------------
-- blocks
-- ---------------------------------------------------------------------------
create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

-- ---------------------------------------------------------------------------
-- app_roles (moderators/admins; managed by service role only)
-- ---------------------------------------------------------------------------
create table public.app_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  granted_by uuid,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- ---------------------------------------------------------------------------
-- Identity helpers (definer, used by RLS policies and RPCs)
-- ---------------------------------------------------------------------------
create function public.st_is_moderator(p_uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = ''
as $$ select p_uid is not null and exists (select 1 from public.app_roles r where r.user_id = p_uid) $$;

-- True when either user blocked the other.
create function public.st_is_blocked(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_a is not null and p_b is not null and exists (
    select 1 from public.blocks b
    where (b.blocker_id = p_a and b.blocked_id = p_b) or (b.blocker_id = p_b and b.blocked_id = p_a))
$$;

-- True while the user's content must be hidden from others (visibility restriction or ban/deletion).
create function public.st_is_hidden_user(p_uid uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_uid
      and (p.deleted_at is not null or p.permanently_banned
           or coalesce(p.visibility_restricted_until > public.st_now(), false)))
$$;

-- Public card of a user (DSA-safe: no private columns). Definer view with explicit row filters:
-- hides deleted, blocked-pair and (to others) visibility-restricted users.
create view public.public_profiles with (security_barrier = true) as
  select p.id,
         p.display_name,
         p.avatar_url,
         p.reliability_score,
         p.reliability_status,
         p.verified_host,
         p.created_at as member_since
  from public.profiles p
  where auth.uid() is not null
    and p.deleted_at is null
    and (
      p.id = auth.uid()
      or public.st_is_moderator()
      or (not public.st_is_blocked(p.id, auth.uid())
          and not p.permanently_banned
          and not coalesce(p.visibility_restricted_until > public.st_now(), false))
    );
