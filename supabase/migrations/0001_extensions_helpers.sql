-- 0001_extensions_helpers.sql
-- Extensions, enum types mirroring packages/domain/src/types.ts string unions, and core helpers.
-- Portable to Supabase Postgres 15/17 and PGlite 18 (no uuidv7, explicit GENERATED ... STORED).

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums (values identical to the TS string literal unions)
-- ---------------------------------------------------------------------------
create type public.locale_code as enum
  ('en', 'he', 'ar', 'es', 'zh-Hans', 'zh-Hant', 'ja', 'pt', 'ru', 'fr', 'it', 'de', 'hi');
create type public.gender as enum ('female', 'male', 'non_binary', 'undisclosed');
create type public.reliability_status as enum ('green', 'yellow', 'red', 'new');
create type public.app_role as enum ('moderator', 'admin');
create type public.venue_status as enum ('active', 'hidden_pending_review', 'removed');
create type public.venue_report_reason as enum ('no_venue_here', 'wrong_location', 'closed', 'duplicate', 'unsafe', 'other');
create type public.game_visibility as enum ('public', 'private');
create type public.game_status as enum ('scheduled', 'cancelled', 'completed');
create type public.deposit_forfeit_target as enum ('host', 'pot');
create type public.participant_status as enum ('requested', 'approved', 'waitlisted', 'rejected', 'cancelled', 'removed');
create type public.attendance_status as enum ('unknown', 'verified', 'no_show_unverified', 'excused');
create type public.checkin_method as enum ('gps', 'qr', 'host', 'peer');
create type public.checkin_reject_reason as enum (
  'not_participant', 'already_checked_in', 'outside_window', 'insufficient_samples', 'samples_too_close',
  'low_accuracy', 'too_far', 'spread_too_large', 'suspected_spoofing', 'invalid_qr', 'expired_qr', 'not_host',
  'insufficient_peers', 'reciprocal_only', 'blocked_pair');
create type public.spoof_signal as enum ('mock_location', 'impossible_speed', 'inconsistent_spread', 'clock_skew');
create type public.sanction_kind as enum
  ('yellow_card', 'join_ban', 'chat_mute', 'visibility_restriction', 'host_suspension', 'permanent_ban');
create type public.sanction_reason_code as enum (
  'late_cancel', 'no_show', 'chat_blocks', 'escalation_two_cards', 'escalation_three_cards', 'toxicity_reports',
  'fake_venue', 'low_host_rating', 'moderator_decision');
create type public.sanction_status as enum ('active', 'disputed', 'upheld', 'overturned', 'expired');
create type public.sanction_decider as enum ('system', 'moderator');
create type public.appeal_status as enum ('open', 'upheld', 'overturned', 'withdrawn');
create type public.user_report_category as enum ('violence', 'unsportsmanlike', 'harassment', 'spam', 'other');
create type public.review_kind as enum (
  'toxicity_reports', 'collusion_suspected', 'permanent_ban_candidate', 'host_reliability', 'venue_reports',
  'sanction_dispute', 'appeal', 'chat_recheck');
create type public.review_status as enum ('open', 'in_review', 'resolved');
create type public.review_priority as enum ('low', 'normal', 'high');
create type public.moderator_decision as enum
  ('dismiss', 'uphold', 'overturn', 'permanent_ban', 'lift_restriction', 'remove_venue', 'restore_venue');
-- Stored chat messages are never 'block' (blocked messages go to moderation_retained only).
create type public.message_moderation as enum ('allow', 'nudge', 'pending');
create type public.translation_provider as enum ('deepl', 'google', 'llm');
create type public.notification_kind as enum (
  'join_requested', 'join_approved', 'join_rejected', 'join_waitlisted', 'waitlist_promoted', 'participant_removed',
  'game_cancelled', 'game_reminder', 'checkin_open', 'result_requested', 'sanction_issued', 'sanction_decided',
  'appeal_decided', 'visibility_restricted', 'chat_muted', 'venue_hidden', 'deposit_action_required');
create type public.push_platform as enum ('ios', 'android', 'web');
create type public.payment_intent_status as enum (
  'requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'requires_capture',
  'succeeded', 'canceled', 'failed');
create type public.payment_provider_id as enum ('stripe', 'fake', 'payplus');
create type public.payment_purpose as enum ('deposit');
create type public.deposit_state as enum ('setup', 'held', 'released', 'forfeited', 'failed');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Single source of "now" for every time-dependent rule. Tests set the transaction-local GUC
-- `st.now`; production leaves it unset and gets now().
create function public.st_now() returns timestamptz
language sql stable parallel safe set search_path = ''
as $$ select coalesce(nullif(current_setting('st.now', true), '')::timestamptz, now()) $$;

-- Raise a client-facing error. The message is `ST:<ErrorCode>` (types.ts ErrorCode); adapters map it.
create function public.st_raise(p_code text, p_detail text default null) returns void
language plpgsql immutable set search_path = ''
as $$
begin
  raise exception using
    message = 'ST:' || p_code,
    detail = coalesce(p_detail, ''),
    errcode = case p_code
      when 'unauthenticated' then '28000'
      when 'forbidden' then '42501'
      when 'not_found' then 'P0002'
      when 'validation' then '22023'
      when 'conflict' then '23505'
      else 'P0001'
    end;
end $$;

-- Caller id or ST:unauthenticated.
create function public.st_uid() returns uuid
language plpgsql stable set search_path = ''
as $$
declare v uuid := auth.uid();
begin
  if v is null then perform public.st_raise('unauthenticated'); end if;
  return v;
end $$;

-- ~500 m privacy grid: snaps a point to the centre of its grid cell. Longitude step widens with
-- latitude so cells stay roughly square. Deterministic, so the same game always gets the same
-- approximate point (no averaging attack across requests).
create function public.st_approx_point(p_geog extensions.geography) returns extensions.geography
language plpgsql immutable parallel safe set search_path = ''
as $$
declare
  lat double precision := extensions.st_y(p_geog::extensions.geometry);
  lng double precision := extensions.st_x(p_geog::extensions.geometry);
  lat_step constant double precision := 0.0045; -- ≈ 500 m
  lng_step double precision;
  slat double precision;
  slng double precision;
begin
  slat := floor(lat / lat_step) * lat_step + lat_step / 2;
  lng_step := lat_step / greatest(cos(radians(slat)), 0.01);
  slng := floor(lng / lng_step) * lng_step + lng_step / 2;
  slat := least(greatest(slat, -90), 90);
  if slng > 180 then slng := slng - 360; end if;
  if slng < -180 then slng := slng + 360; end if;
  return extensions.st_setsrid(extensions.st_makepoint(slng, slat), 4326)::extensions.geography;
end $$;

create function public.st_point(p_lat double precision, p_lng double precision) returns extensions.geography
language plpgsql immutable set search_path = ''
as $$
begin
  if p_lat is null or p_lng is null or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    perform public.st_raise('validation', 'invalid coordinates');
  end if;
  return extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
end $$;

-- Generic updated_at trigger.
create function public.st_touch_updated_at() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := public.st_now();
  return new;
end $$;
