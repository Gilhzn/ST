-- 0103_media_vault.sql (Phase 1.5, contract v3)
-- Media Vault (deferred-phases §7, VAULT-001..009), mirroring packages/domain/src/vault:
--  * upload intents for verified attendees only, window startsAt … endsAt + 2 h (both inclusive),
--    MIME/size/duration limits, 30 items per user per game (create_upload_intent);
--  * the pre-publication pipeline (media-process Edge Function, service role) finalises an item
--    (finalize_media); a CSAM match is blocked, kept under legal hold and never published;
--  * consent tagging: a tag is a request, invisible until accepted; `venue_public` only when the
--    uploader opted in AND no tag blocks it (requested, declined, or removed with a veto); a decline
--    or "remove from public" vetoes for good; only public, non-women-only games with a venue can
--    ever reach the venue vault (GAME-017: no location trail for hidden-location games);
--  * reports (VAULT-008), retention 12 months (VAULT-007), account deletion.
-- Reject reasons (MediaRejectReason) are raised as `ST:<code>: <reason>` with the code of
-- mediaRejectErrorCode() (forbidden / outside_window / validation / rate_limited / conflict).

create type public.media_kind as enum ('photo', 'video');
create type public.media_status as enum ('processing', 'published', 'blocked', 'removed');
create type public.media_visibility as enum ('participants', 'venue_public');
create type public.media_tag_status as enum ('requested', 'accepted', 'declined', 'removed');
create type public.media_report_reason as enum ('nudity', 'violence', 'harassment', 'privacy', 'copyright', 'spam', 'other');

-- ReviewKind (types.ts v3) + media reports (VAULT-008).
alter type public.review_kind add value if not exists 'media_csam';
alter type public.review_kind add value if not exists 'media_report';

alter table public.phase15_config add column media_pro_grace_days numeric not null default 90;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.media_items (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  venue_id uuid references public.venues (id) on delete set null,
  uploader_id uuid not null references public.profiles (id) on delete cascade,
  kind public.media_kind not null,
  status public.media_status not null default 'processing',
  -- Effective visibility (maintained by st_media_refresh_visibility).
  visibility public.media_visibility not null default 'participants',
  public_opt_in boolean not null default false,
  mime_type text not null check (char_length(mime_type) <= 100),
  size_bytes bigint not null check (size_bytes > 0),
  duration_seconds numeric check (duration_seconds is null or duration_seconds >= 0),
  -- Original upload (`originals/<game>/<uploader>/<id>.<ext>`), never client-readable.
  storage_path text not null unique check (storage_path ~ '^originals/'),
  upload_expires_at timestamptz not null,
  -- Sanitised display object and thumbnail (`media/<game>/<id>/…`) or the video provider ref.
  published_path text check (published_path is null or published_path ~ '^media/'),
  thumbnail_path text check (thumbnail_path is null or thumbnail_path ~ '^media/'),
  playback_ref text check (playback_ref is null or char_length(playback_ref) <= 200),
  verdict jsonb,
  -- VAULT-003: CSAM evidence is preserved (never deleted by retention or account deletion).
  legal_hold boolean not null default false,
  -- VAULT-008: hidden from galleries after reports, pending a moderator.
  hidden_pending_review boolean not null default false,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  expires_at timestamptz not null,
  removed_at timestamptz,
  removed_by uuid,
  updated_at timestamptz not null default now(),
  check ((status = 'removed') = (removed_at is not null)),
  check (visibility = 'participants' or (status = 'published' and public_opt_in and not hidden_pending_review))
);
create index media_items_game_idx on public.media_items (game_id, created_at desc);
create index media_items_venue_idx on public.media_items (venue_id, created_at desc) where visibility = 'venue_public';
create index media_items_uploader_idx on public.media_items (uploader_id, game_id);
create index media_items_expiry_idx on public.media_items (expires_at) where status in ('processing', 'published');
create trigger media_items_touch before update on public.media_items
  for each row execute function public.st_touch_updated_at();

create table public.media_tags (
  media_id uuid not null references public.media_items (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  tagged_by uuid not null references public.profiles (id) on delete cascade,
  status public.media_tag_status not null default 'requested',
  veto_public boolean not null default false,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  primary key (media_id, user_id),
  check (user_id <> tagged_by),
  check (status <> 'declined' or veto_public)
);
create index media_tags_user_idx on public.media_tags (user_id, status);

create table public.media_reports (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null references public.media_items (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason public.media_report_reason not null,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (media_id, reporter_id)
);

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

-- MEDIA_MIME_TYPES (vault/index.ts) → object key extension.
create function public.st_media_ext(p_kind public.media_kind, p_mime text) returns text
language sql immutable set search_path = ''
as $$
  select case p_kind
           when 'photo' then case lower(p_mime) when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/heic' then 'heic'
                                                when 'image/heif' then 'heif' when 'image/webp' then 'webp' end
           when 'video' then case lower(p_mime) when 'video/mp4' then 'mp4' when 'video/quicktime' then 'mov'
                                                when 'video/webm' then 'webm' end
         end
$$;

-- mediaRejectErrorCode()
create function public.st_media_reject(p_reason text) returns void
language plpgsql immutable set search_path = ''
as $$
declare code text := case p_reason
  when 'not_verified_attendee' then 'forbidden' when 'not_uploader' then 'forbidden'
  when 'window_not_open' then 'outside_window' when 'window_closed' then 'outside_window'
  when 'user_cap_reached' then 'rate_limited'
  when 'not_published' then 'conflict' when 'tags_pending' then 'conflict'
  else 'validation' end;
begin
  raise exception using message = 'ST:' || code || ': ' || p_reason, detail = p_reason,
    errcode = case code when 'forbidden' then '42501' when 'validation' then '22023' when 'conflict' then '23505' else 'P0001' end;
end $$;

-- Venue vault eligibility of the item's game (DB guard on top of the consent rule).
create function public.st_media_game_allows_public(p_game_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.games g
                 where g.id = p_game_id and g.visibility = 'public' and not g.women_only and g.venue_id is not null)
$$;

-- consentBlockers(): tags still blocking venue_public (requested, declined, removed with a veto).
create function public.st_media_blockers(p_media_id uuid) returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(t.user_id order by t.user_id::text collate "C"), '{}')
  from public.media_tags t
  where t.media_id = p_media_id
    and (t.status in ('requested', 'declined') or (t.status = 'removed' and t.veto_public))
$$;

-- effectiveMediaVisibility(): recompute and store. Returns the visibility.
create function public.st_media_refresh_visibility(p_media_id uuid) returns public.media_visibility
language plpgsql security definer set search_path = ''
as $$
declare
  m public.media_items;
  v public.media_visibility;
begin
  select * into m from public.media_items x where x.id = p_media_id for update;
  if m.id is null then return null; end if;
  v := case when m.public_opt_in and m.status = 'published' and not m.hidden_pending_review
                 and cardinality(public.st_media_blockers(m.id)) = 0 and public.st_media_game_allows_public(m.game_id)
            then 'venue_public' else 'participants' end;
  if v <> m.visibility then
    update public.media_items x set visibility = v where x.id = m.id;
  end if;
  return v;
end $$;

-- May `p_uid` see item `m` (published)? Participants of the game (approved), the uploader, moderators;
-- venue_public items: any signed-in user. Blocked uploaders and hidden users are never shown.
create function public.st_media_visible(m public.media_items, p_uid uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_uid is not null and (
    m.uploader_id = p_uid
    or public.st_is_moderator(p_uid)
    or (m.status = 'published' and not m.hidden_pending_review
        and not public.st_is_blocked(m.uploader_id, p_uid) and not public.st_is_hidden_user(m.uploader_id)
        and (m.visibility = 'venue_public' or public.st_is_approved(m.game_id, p_uid))))
$$;

create function public.st_my_media_visible(p_media_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.media_items m where m.id = p_media_id and public.st_media_visible(m, auth.uid())) $$;

create function public.st_am_media_uploader(p_media_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select auth.uid() is not null and exists (select 1 from public.media_items m where m.id = p_media_id and m.uploader_id = auth.uid()) $$;

-- MediaItem JSON (+ accepted tags visible to the viewer, + pendingUserIds for the uploader).
create function public.st_media_json(m public.media_items, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id, 'gameId', m.game_id, 'venueId', m.venue_id, 'uploaderId', m.uploader_id, 'kind', m.kind, 'status', m.status,
    'visibility', m.visibility, 'publicOptIn', m.public_opt_in, 'mimeType', m.mime_type, 'sizeBytes', m.size_bytes,
    'durationSeconds', m.duration_seconds,
    'storagePath', coalesce(m.published_path, case when m.uploader_id = p_viewer then m.storage_path end),
    'thumbnailPath', m.thumbnail_path, 'playbackRef', m.playback_ref,
    'createdAt', public.dm_iso(m.created_at), 'publishedAt', public.dm_iso(m.published_at),
    'expiresAt', public.dm_iso(m.expires_at), 'removedAt', public.dm_iso(m.removed_at),
    'acceptedTags', (select coalesce(jsonb_agg(t.user_id order by t.user_id::text collate "C"), '[]'::jsonb)
                     from public.media_tags t
                     where t.media_id = m.id and t.status = 'accepted'
                       and not public.st_is_blocked(t.user_id, p_viewer) and not public.st_hidden_from_me(t.user_id)),
    'pendingUserIds', case when m.uploader_id = p_viewer and m.public_opt_in then to_jsonb(public.st_media_blockers(m.id))
                           else '[]'::jsonb end)
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- createMediaUploadIntent (VAULT-001/002; media-upload Edge Function as the caller). Allocates the
-- item (status processing) and the object key of the original. Returns
-- { mediaId, storagePath, maxBytes, expiresAt } (expiresAt = the signed-upload deadline).
create function public.create_upload_intent(p_game_id uuid, p_kind public.media_kind, p_mime_type text, p_size_bytes bigint,
                                            p_duration_seconds numeric default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles := public.st_active_profile();
  t timestamptz := public.st_now();
  p15 public.phase15_config := public.st_p15();
  g public.games;
  existing int;
  res jsonb;
  mid uuid := gen_random_uuid();
  path text;
begin
  select * into g from public.games x where x.id = p_game_id for update;
  if g.id is null or not public.st_can_see_game(g.id, me.id) then perform public.st_raise('not_found'); end if;
  if g.status = 'cancelled' then perform public.st_raise('game_not_open'); end if;
  select count(*) into existing from public.media_items m
  where m.game_id = g.id and m.uploader_id = me.id and m.status <> 'removed';
  -- checkMediaUpload() (dm_check_media_upload, vault.upload goldens).
  res := public.dm_check_media_upload(jsonb_build_object(
      'game', jsonb_build_object('startsAt', public.dm_iso(g.starts_at), 'endsAt', public.dm_iso(g.ends_at)),
      'verifiedAttendee', exists (select 1 from public.game_participants gp where gp.game_id = g.id and gp.user_id = me.id
                                    and gp.status = 'approved' and gp.attendance = 'verified'),
      'request', jsonb_build_object('gameId', g.id, 'kind', p_kind, 'mimeType', p_mime_type, 'sizeBytes', p_size_bytes,
                                    'durationSeconds', p_duration_seconds),
      'existingCount', existing), p15, t);
  if not (res ->> 'ok')::boolean then perform public.st_media_reject(res ->> 'error'); end if;
  -- DB guards on top of the domain rule: the pipeline cannot sanitise HEIC/HEIF (refused, never
  -- published unsanitised), and an account restricted pending a CSAM review cannot upload.
  if lower(p_mime_type) in ('image/heic', 'image/heif') then perform public.st_media_reject('unsupported_type'); end if;
  if exists (select 1 from public.account_review_holds x where x.user_id = me.id and x.until > t) then
    perform public.st_raise('forbidden', 'account restricted pending review');
  end if;
  path := 'originals/' || g.id::text || '/' || me.id::text || '/' || mid::text || '.' || public.st_media_ext(p_kind, p_mime_type);
  insert into public.media_items (id, game_id, venue_id, uploader_id, kind, status, mime_type, size_bytes, duration_seconds,
                                  storage_path, upload_expires_at, created_at, expires_at)
  values (mid, g.id, g.venue_id, me.id, p_kind, 'processing', lower(p_mime_type), p_size_bytes,
          case when p_kind = 'video' then p_duration_seconds end, path, t + interval '2 hours', t,
          ((t at time zone 'UTC') + p15.media_retention_months * interval '1 month') at time zone 'UTC');
  return jsonb_build_object('mediaId', mid, 'storagePath', path,
    'maxBytes', (res #>> '{value,maxBytes}')::bigint,
    'expiresAt', public.dm_iso(t + interval '2 hours'));
end $$;

-- finalize_media (service role only; media-process after EXIF strip → CSAM hash → moderation).
-- Idempotent: only a `processing` item changes; returns the resulting status. `published` stores
-- the sanitised object paths and applies the effective visibility; `blocked` notifies the uploader
-- with the policy reason, except for a CSAM match (decision `csam`): legal hold, no notice (the
-- function files the report, restricts the account and queues the media_csam review).
create function public.finalize_media(p_media_id uuid, p_status text, p_verdict jsonb, p_published_path text default null,
                                      p_thumbnail_path text default null, p_mime_type text default null,
                                      p_size_bytes bigint default null, p_duration_seconds numeric default null,
                                      p_playback_ref text default null) returns public.media_status
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  m public.media_items;
  csam boolean;
  prefix text;
begin
  if p_status is null or p_status not in ('published', 'blocked') then perform public.st_raise('validation', 'status'); end if;
  if p_verdict is null or jsonb_typeof(p_verdict) <> 'object' or p_verdict ->> 'decision' not in ('publish', 'block', 'csam')
     or (p_status = 'published') <> (p_verdict ->> 'decision' = 'publish') then
    perform public.st_raise('validation', 'verdict');
  end if;
  select * into m from public.media_items x where x.id = p_media_id for update;
  if m.id is null then perform public.st_raise('not_found'); end if;
  if m.status <> 'processing' then return m.status; end if;
  csam := p_verdict ->> 'decision' = 'csam' or coalesce((p_verdict ->> 'csamHashMatch')::boolean, false);
  if p_status = 'published' and csam then perform public.st_raise('validation', 'csam match cannot publish'); end if;
  prefix := 'media/' || m.game_id::text || '/' || m.id::text || '/';
  if p_status = 'published' then
    if (p_published_path is null and p_playback_ref is null)
       or (p_published_path is not null and (left(p_published_path, length(prefix)) <> prefix or p_published_path ~ '\.\.'))
       or (p_thumbnail_path is not null and (left(p_thumbnail_path, length(prefix)) <> prefix or p_thumbnail_path ~ '\.\.')) then
      perform public.st_raise('validation', 'paths');
    end if;
    if m.kind = 'video' and p_duration_seconds is not null and p_duration_seconds > (public.st_p15()).media_video_max_seconds then
      perform public.st_raise('validation', 'too_long');
    end if;
    update public.media_items x set status = 'published', published_at = t, published_path = p_published_path,
           thumbnail_path = p_thumbnail_path, playback_ref = p_playback_ref,
           mime_type = coalesce(lower(p_mime_type), x.mime_type), size_bytes = coalesce(p_size_bytes, x.size_bytes),
           duration_seconds = coalesce(p_duration_seconds, x.duration_seconds), verdict = p_verdict
    where x.id = m.id;
    perform public.st_media_refresh_visibility(m.id);
  else
    update public.media_items x set status = 'blocked', visibility = 'participants', verdict = p_verdict,
           legal_hold = x.legal_hold or csam, published_path = null, thumbnail_path = null
    where x.id = m.id;
    if not csam then
      perform public.st_notify(m.uploader_id, 'media_blocked',
        jsonb_build_object('mediaId', m.id, 'reasonKey', coalesce(p_verdict ->> 'reasonKey', 'media.blocked.policy')),
        m.game_id, null, 'notify:media_blocked:' || m.id::text);
    end if;
    perform public.st_audit(case when csam then 'media.csam_blocked' else 'media.blocked' end, m.uploader_id,
      jsonb_build_object('mediaId', m.id, 'gameId', m.game_id), null);
  end if;
  select x.status into m.status from public.media_items x where x.id = m.id;
  return m.status;
end $$;

-- tagMedia: the uploader tags approved co-participants; each tag is a request (invisible until
-- accepted). Rejects forbidden (not the uploader / not a participant), blocked, validation
-- (empty, duplicates, self, > 50), conflict (blocked/removed item, or already tagged).
create function public.tag_user(p_media_id uuid, p_user_ids uuid[]) returns setof public.media_tags
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles := public.st_active_profile();
  t timestamptz := public.st_now();
  m public.media_items;
  u uuid;
begin
  select * into m from public.media_items x where x.id = p_media_id for update;
  if m.id is null or not public.st_media_visible(m, me.id) then perform public.st_raise('not_found'); end if;
  if m.uploader_id <> me.id then perform public.st_raise('forbidden'); end if;
  if m.status in ('blocked', 'removed') then perform public.st_raise('conflict'); end if;
  if p_user_ids is null or cardinality(p_user_ids) = 0 or cardinality(p_user_ids) > 50
     or cardinality(p_user_ids) <> (select count(distinct x) from unnest(p_user_ids) x)
     or me.id = any (p_user_ids) or array_position(p_user_ids, null) is not null then
    perform public.st_raise('validation');
  end if;
  foreach u in array p_user_ids loop
    if not public.st_is_approved(m.game_id, u) then perform public.st_raise('forbidden', 'not a participant'); end if;
    if public.st_is_blocked(me.id, u) then perform public.st_raise('blocked'); end if;
    if exists (select 1 from public.media_tags x where x.media_id = m.id and x.user_id = u and x.status <> 'removed') then
      perform public.st_raise('conflict', 'already tagged');
    end if;
  end loop;
  perform public.st_rate_limit(
    (select count(*) from public.media_tags x where x.tagged_by = me.id and x.created_at > t - interval '24 hours'), 200);
  for u in select x from unnest(p_user_ids) x order by x::text collate "C" loop
    insert into public.media_tags as x (media_id, user_id, tagged_by, status, veto_public, created_at, decided_at)
    values (m.id, u, me.id, 'requested', false, t, null)
    on conflict (media_id, user_id) do update set tagged_by = excluded.tagged_by, status = 'requested',
                                                  created_at = excluded.created_at, decided_at = null;
    perform public.st_notify(u, 'media_tag_request', jsonb_build_object('mediaId', m.id), m.game_id, null,
                             'notify:media_tag_request:' || m.id::text || ':' || u::text || ':' || public.dm_iso(t));
  end loop;
  perform public.st_media_refresh_visibility(m.id);
  return query select * from public.media_tags x where x.media_id = m.id and x.user_id = any (p_user_ids)
               order by x.user_id::text collate "C";
end $$;

-- respondToMediaTag: the tagged caller accepts or declines a pending tag (a decline vetoes
-- venue_public for good). Rejects not_found.
create function public.respond_tag(p_media_id uuid, p_accept boolean) returns public.media_tags
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  t timestamptz := public.st_now();
  tg public.media_tags;
begin
  if p_accept is null then perform public.st_raise('validation'); end if;
  update public.media_tags x
     set status = case when p_accept then 'accepted'::public.media_tag_status else 'declined'::public.media_tag_status end,
         veto_public = x.veto_public or not p_accept, decided_at = t
  where x.media_id = p_media_id and x.user_id = uid and x.status = 'requested'
  returning * into tg;
  if tg.media_id is null then perform public.st_raise('not_found'); end if;
  perform public.st_media_refresh_visibility(p_media_id);
  return tg;
end $$;

-- untag: the tagged caller untags themselves at any time (VAULT-005; `p_remove_from_public` also
-- vetoes venue_public for good), or the uploader removes a tag (`p_user_id`, the "or is untagged"
-- path of AC-VAULT-004; a prior veto persists). Rejects not_found / forbidden.
create function public.untag(p_media_id uuid, p_remove_from_public boolean default false, p_user_id uuid default null)
returns public.media_tags
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  t timestamptz := public.st_now();
  target uuid := coalesce(p_user_id, uid);
  tg public.media_tags;
begin
  if target <> uid and not exists (select 1 from public.media_items m where m.id = p_media_id and m.uploader_id = uid) then
    perform public.st_raise('forbidden');
  end if;
  update public.media_tags x set status = 'removed', decided_at = t,
         veto_public = x.veto_public or (target = uid and coalesce(p_remove_from_public, false))
  where x.media_id = p_media_id and x.user_id = target and x.status <> 'removed'
  returning * into tg;
  if tg.media_id is null then perform public.st_raise('not_found'); end if;
  perform public.st_media_refresh_visibility(p_media_id);
  return tg;
end $$;

-- setMediaVisibility (VAULT-004, AC-VAULT-004/005): the uploader's opt-in is stored; venue_public is
-- applied only while no tag blocks it, otherwise the item stays `participants` and
-- `pendingUserIds` explains why. Rejects not_uploader (forbidden), not_published (conflict) for
-- blocked/removed items, and forbidden for private or women-only games or games without a venue.
create function public.set_visibility(p_media_id uuid, p_visibility public.media_visibility) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles := public.st_active_profile();
  m public.media_items;
begin
  if p_visibility is null then perform public.st_raise('validation'); end if;
  select * into m from public.media_items x where x.id = p_media_id for update;
  if m.id is null or not public.st_media_visible(m, me.id) then perform public.st_raise('not_found'); end if;
  if m.uploader_id <> me.id then perform public.st_media_reject('not_uploader'); end if;
  if m.status in ('blocked', 'removed') then perform public.st_media_reject('not_published'); end if;
  if p_visibility = 'venue_public' and not public.st_media_game_allows_public(m.game_id) then
    perform public.st_raise('forbidden', 'venue vault not allowed for this game');
  end if;
  update public.media_items x set public_opt_in = (p_visibility = 'venue_public'),
         visibility = case when p_visibility = 'venue_public' then x.visibility else 'participants'::public.media_visibility end
  where x.id = m.id;
  perform public.st_media_refresh_visibility(m.id);
  select * into m from public.media_items x where x.id = m.id;
  return public.st_media_json(m, me.id);
end $$;

-- deleteMedia: uploader or moderator. Blocked (evidence) items are never deleted here.
create function public.delete_media(p_media_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  m public.media_items;
begin
  select * into m from public.media_items x where x.id = p_media_id for update;
  if m.id is null or not public.st_media_visible(m, uid) then perform public.st_raise('not_found'); end if;
  if m.uploader_id <> uid and not public.st_is_moderator(uid) then perform public.st_raise('forbidden'); end if;
  if m.status = 'removed' then perform public.st_raise('not_found'); end if;
  perform public.st_remove_media(m.id, uid);
  if m.uploader_id <> uid then
    perform public.st_audit('media.removed_by_moderator', m.uploader_id, jsonb_build_object('mediaId', m.id), uid);
  end if;
end $$;

-- Removal (status removed, visibility participants) + object deletion through the media-purge
-- Edge Function (pg_net; no-op where not configured). Legal-hold items keep their objects.
create function public.st_remove_media(p_media_id uuid, p_by uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare m public.media_items;
begin
  update public.media_items x set status = 'removed', visibility = 'participants', public_opt_in = false,
         removed_at = public.st_now(), removed_by = p_by
  where x.id = p_media_id and x.status <> 'removed'
  returning * into m;
  if m.id is not null and not m.legal_hold then
    perform public.st_dispatch('media-purge', jsonb_build_object('mediaId', m.id,
      'paths', to_jsonb(array_remove(array[m.storage_path, m.published_path, m.thumbnail_path], null)),
      'prefix', 'media/' || m.game_id::text || '/' || m.id::text || '/', 'playbackRef', m.playback_ref));
  end if;
end $$;

-- reportMedia (VAULT-008): anyone who can see the item, once; 3 distinct reporters hide it from
-- galleries pending a moderator (media_report review). Copyright notices use the DSA Art. 16 form.
create function public.report_media(p_media_id uuid, p_reason public.media_report_reason, p_note text default null)
returns public.media_reports
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles := public.st_active_profile();
  t timestamptz := public.st_now();
  m public.media_items;
  r public.media_reports;
  n int;
begin
  if p_reason is null then perform public.st_raise('validation'); end if;
  select * into m from public.media_items x where x.id = p_media_id for update;
  if m.id is null or m.status <> 'published' or not public.st_media_visible(m, me.id) then perform public.st_raise('not_found'); end if;
  if m.uploader_id = me.id then perform public.st_raise('validation', 'own item'); end if;
  if exists (select 1 from public.media_reports x where x.media_id = m.id and x.reporter_id = me.id) then
    perform public.st_raise('already_reported');
  end if;
  perform public.st_rate_limit(
    (select count(*) from public.media_reports x where x.reporter_id = me.id and x.created_at > t - interval '24 hours'), 20);
  insert into public.media_reports (media_id, reporter_id, reason, note, created_at)
  values (m.id, me.id, p_reason, p_note, t) returning * into r;
  select count(distinct x.reporter_id) into n from public.media_reports x where x.media_id = m.id;
  perform public.st_enqueue_review('media_report', 'media_report:' || m.id::text, m.uploader_id,
    case when n >= 3 or p_reason in ('nudity', 'violence') then 'high'::public.review_priority else 'normal'::public.review_priority end,
    jsonb_build_object('mediaId', m.id, 'reporters', n), '{}', m.venue_id, m.game_id);
  if n >= 3 and not m.hidden_pending_review then
    update public.media_items x set hidden_pending_review = true, visibility = 'participants' where x.id = m.id;
  end if;
  return r;
end $$;

-- Moderator decision on a media item: 'remove' or 'restore' (un-hide). Audited.
create function public.moderate_media(p_media_id uuid, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  m public.media_items;
begin
  if not public.st_is_moderator(uid) then perform public.st_raise('forbidden'); end if;
  if p_action is null or p_action not in ('remove', 'restore') then perform public.st_raise('validation'); end if;
  select * into m from public.media_items x where x.id = p_media_id for update;
  if m.id is null then perform public.st_raise('not_found'); end if;
  if p_action = 'remove' then
    perform public.st_remove_media(m.id, uid);
  else
    update public.media_items x set hidden_pending_review = false where x.id = m.id;
    perform public.st_media_refresh_visibility(m.id);
  end if;
  update public.review_queue q set status = 'resolved',
         resolution = case when p_action = 'remove' then 'uphold'::public.moderator_decision else 'dismiss'::public.moderator_decision end,
         resolved_by = uid, resolved_at = public.st_now(), decision_note = p_note
  where q.dedupe_key = 'media_report:' || m.id::text and q.status <> 'resolved';
  perform public.st_audit('media.moderated', m.uploader_id, jsonb_build_object('mediaId', m.id, 'action', p_action, 'note', p_note), uid);
end $$;

-- listGameMedia: published items of a game for its participants (approved), host and moderators,
-- newest first; the caller's own items in any non-removed state are included.
create function public.game_gallery(p_game_id uuid) returns setof jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := public.st_uid();
begin
  if not (public.st_is_approved(p_game_id, uid) or public.st_is_moderator(uid)) then perform public.st_raise('forbidden'); end if;
  return query
    select public.st_media_json(m, uid) from public.media_items m
    where m.game_id = p_game_id and m.status <> 'removed'
      and ((m.status = 'published' and public.st_media_visible(m, uid)) or m.uploader_id = uid)
    order by coalesce(m.published_at, m.created_at) desc, m.id
    limit 500;
end $$;

-- listVenueMedia (VAULT-006): venue_public + published items of a venue, optional date range on
-- the game start ([from, to)), newest first. Signed-in users only.
create function public.venue_vault(p_venue_id uuid, p_from timestamptz default null, p_to timestamptz default null)
returns setof jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := public.st_uid();
begin
  if p_from is not null and p_to is not null and p_to <= p_from then perform public.st_raise('validation', 'range'); end if;
  return query
    select public.st_media_json(m, uid) from public.media_items m
    join public.games g on g.id = m.game_id
    where m.venue_id = p_venue_id and m.visibility = 'venue_public' and m.status = 'published' and not m.hidden_pending_review
      and g.starts_at >= coalesce(p_from, '-infinity'::timestamptz) and g.starts_at < coalesce(p_to, 'infinity'::timestamptz)
      and public.st_media_visible(m, uid)
    order by m.published_at desc, m.id
    limit 500;
end $$;

-- Pending tag requests for the caller (listMyTagRequests).
create function public.my_tag_requests() returns setof public.media_tags
language sql stable security definer set search_path = ''
as $$
  select t.* from public.media_tags t join public.media_items m on m.id = t.media_id
  where t.user_id = auth.uid() and t.status = 'requested' and m.status in ('processing', 'published')
    and not public.st_is_blocked(m.uploader_id, auth.uid())
  order by t.created_at desc
$$;

-- ---------------------------------------------------------------------------
-- Retention (VAULT-007) and account deletion
-- ---------------------------------------------------------------------------

-- Job: items past expires_at (createdAt + 12 months) are removed with their objects (legal hold
-- and blocked evidence excepted); uploads never completed within 24 h are dropped; removed rows
-- are hard-deleted after 30 days. Returns the number removed.
create function public.purge_media() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  m record;
  n int := 0;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('st:purge_media')) then return 0; end if;
  for m in select x.id from public.media_items x
           where not x.legal_hold and x.status in ('processing', 'published')
             and (x.expires_at <= t or (x.status = 'processing' and x.created_at <= t - interval '24 hours'))
           order by x.expires_at, x.id limit 5000 loop
    perform public.st_remove_media(m.id, null);
    n := n + 1;
  end loop;
  delete from public.media_items x where x.status = 'removed' and not x.legal_hold and x.removed_at <= t - interval '30 days';
  return n;
end $$;

-- Account deletion (VAULT-007): the user's items are removed (objects purged, rows deleted unless
-- under legal hold); their tags on others' items are removed with a veto (untagDeletedAccount) and
-- visibility is recomputed (the veto persists); their reports are deleted.
create function public.st_media_delete_account(p_uid uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  m record;
begin
  for m in select x.id from public.media_items x where x.uploader_id = p_uid and x.status <> 'removed' loop
    perform public.st_remove_media(m.id, p_uid);
  end loop;
  delete from public.media_items x where x.uploader_id = p_uid and not x.legal_hold;
  for m in update public.media_tags x set status = 'removed', veto_public = true, decided_at = t
           where x.user_id = p_uid and not (x.status = 'removed' and x.veto_public)
           returning x.media_id loop
    perform public.st_media_refresh_visibility(m.media_id);
  end loop;
  -- The removed+veto tag rows stay (pseudonymous tombstone id) so the veto keeps blocking venue_public.
  delete from public.media_reports x where x.reporter_id = p_uid;
end $$;
