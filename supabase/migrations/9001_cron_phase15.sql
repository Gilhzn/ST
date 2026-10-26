-- 9001_cron_phase15.sql
-- pg_cron schedules for the Phase 1.5 jobs. Guarded like 9000 (no-op without pg_cron). Every job is
-- idempotent and advisory-locked. (The series-jobs Edge Function can run generate/autojoin instead
-- when push fan-out is wanted; both paths are safe to run together.)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('st_generate_occurrences',   '7 * * * *',    'select public.generate_occurrences()');
    perform cron.schedule('st_always_in_autojoin',     '*/10 * * * *', 'select public.always_in_autojoin()');
    perform cron.schedule('st_run_rating_period',      '23 * * * *',   'select public.run_rating_period()');
    perform cron.schedule('st_derive_played_with',     '41 2 * * *',   'select public.derive_played_with()');
    perform cron.schedule('st_purge_phase15',          '53 3 * * *',   'select public.purge_phase15_retention()');
  end if;
end $$;
