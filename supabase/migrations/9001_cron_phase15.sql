-- 9001_cron_phase15.sql
-- pg_cron schedules for the Phase 1.5 jobs. Guarded like 9000 (no-op without pg_cron). Every job is
-- idempotent and advisory-locked. Series and rating jobs go through the series-jobs / rating-period
-- Edge Functions when st.functions_url is configured (push fan-out), else run in SQL.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('st_series_jobs',        '*/10 * * * *', 'select public.run_series_jobs()');
    perform cron.schedule('st_rating_jobs',        '23 * * * *',   'select public.run_rating_jobs()');
    perform cron.schedule('st_retry_stuck_media',  '*/5 * * * *',  'select public.retry_stuck_media()');
    perform cron.schedule('st_derive_played_with', '41 2 * * *',   'select public.derive_played_with()');
    perform cron.schedule('st_purge_phase15',      '53 3 * * *',   'select public.purge_phase15_retention()');
  end if;
end $$;
