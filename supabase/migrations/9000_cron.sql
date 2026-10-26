-- 9000_cron.sql
-- pg_cron schedules. Guarded: pg_cron is not available in PGlite (tests call the job functions
-- directly) and may be disabled on a project. Jobs are idempotent and take advisory locks.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('st_process_no_shows',       '*/5 * * * *', 'select public.process_no_shows()');
    perform cron.schedule('st_expire_sanctions',       '* * * * *',   'select public.expire_sanctions()');
    perform cron.schedule('st_expire_waitlist_offers', '* * * * *',   'select public.expire_waitlist_offers()');
    perform cron.schedule('st_place_deposit_holds',    '*/5 * * * *', 'select public.place_deposit_holds()');
    perform cron.schedule('st_settle_deposits',        '*/5 * * * *', 'select public.settle_deposits()');
    perform cron.schedule('st_purge_expired_messages', '*/10 * * * *', 'select public.purge_expired_messages()');
    perform cron.schedule('st_recheck_pending',        '* * * * *',   'select public.recheck_pending_messages()');
    perform cron.schedule('st_purge_retained',         '17 3 * * *',  'select public.purge_retained()');
    perform cron.schedule('st_purge_retention',        '37 3 * * *',  'select public.purge_retention()');
  end if;
end $$;
