-- 0007_payments_notifications.sql
-- In-app notifications (the record; push is best effort) and deposit payment records.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind public.notification_kind not null,
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  game_id uuid references public.games (id) on delete set null,
  sanction_id uuid references public.sanctions (id) on delete set null,
  dedupe_key text unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  game_id uuid not null references public.games (id),
  purpose public.payment_purpose not null default 'deposit',
  amount_minor int not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  provider public.payment_provider_id not null default 'stripe',
  provider_ref text,
  status public.payment_intent_status not null default 'requires_payment_method',
  deposit_state public.deposit_state not null default 'setup',
  -- Requested settlement (set by jobs/apply_effects; payments-webhook confirms the final state).
  settlement_requested text check (settlement_requested is null or settlement_requested in ('release', 'forfeit')),
  settlement_requested_at timestamptz,
  -- Last time place_deposit_holds() dispatched a hold request (re-dispatched after 15 minutes).
  hold_requested_at timestamptz,
  idempotency_key text not null unique check (char_length(idempotency_key) between 1 and 255),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_user_game_idx on public.payments (user_id, game_id);
create index payments_state_idx on public.payments (deposit_state, status);
create trigger payments_touch before update on public.payments
  for each row execute function public.st_touch_updated_at();

-- When the deposit payment method is saved (setup succeeded), the join request becomes visible
-- to the host and the host is notified.
create function public.st_payments_after_update() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare g public.games;
begin
  if new.deposit_state = 'setup' and new.status = 'succeeded' and old.status is distinct from 'succeeded' then
    update public.game_participants gp set payment_ready = true
    where gp.game_id = new.game_id and gp.user_id = new.user_id and not gp.payment_ready;
    if found then
      select * into g from public.games x where x.id = new.game_id;
      perform public.st_notify(g.host_id, 'join_requested', jsonb_build_object('gameTitle', g.title),
                               g.id, null, 'join_requested:' || g.id::text || ':' || new.user_id::text || ':' || new.id::text);
    end if;
  end if;
  return null;
end $$;
create trigger payments_after_update after update on public.payments
  for each row execute function public.st_payments_after_update();
