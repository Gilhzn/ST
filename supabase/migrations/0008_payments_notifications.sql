-- 0008_payments_notifications.sql
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

-- Security M4 / TRUST-060: deposits are chosen from fixed per-currency tiers (≈ $2 / $5 / $10 / $20).
create table public.deposit_tiers (
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor int not null check (amount_minor > 0),
  primary key (currency, amount_minor)
);
insert into public.deposit_tiers (currency, amount_minor)
select t.currency, unnest(t.amounts)
from (values
  ('USD', array[200, 500, 1000, 2000]),
  ('EUR', array[200, 300, 500, 1000, 2000]),
  ('GBP', array[200, 400, 800, 1600]),
  ('CHF', array[200, 500, 1000, 2000]),
  ('ILS', array[1000, 2000, 3000, 5000, 7500]),
  ('BRL', array[1000, 2500, 5000, 10000]),
  ('INR', array[20000, 40000, 80000, 160000]),
  ('JPY', array[300, 800, 1500, 3000]),
  ('CNY', array[1500, 3500, 7000, 14000]),
  ('RUB', array[20000, 50000, 100000, 200000]),
  ('CAD', array[300, 700, 1400, 2800]),
  ('AUD', array[300, 800, 1500, 3000]),
  ('MXN', array[4000, 10000, 20000, 40000])
) as t(currency, amounts);

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
  -- When settle_deposits() handed the settlement to the payments-settle Edge Function.
  settlement_dispatched_at timestamptz,
  -- Last time place_deposit_holds() dispatched a hold request (re-dispatched after 15 minutes).
  hold_requested_at timestamptz,
  -- Provider flow step (packages/payments): SetupIntent, manual-capture hold, or charge-and-refund
  -- for methods without holds (TRUST-062).
  step text not null default 'setup' check (step in ('setup', 'hold', 'charge')),
  payment_method_id text,
  -- When the deposit was secured (method saved / hold placed / charged).
  secured_at timestamptz,
  idempotency_key text not null unique check (char_length(idempotency_key) between 1 and 255),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_user_game_idx on public.payments (user_id, game_id);
create index payments_state_idx on public.payments (deposit_state, status);
create trigger payments_touch before update on public.payments
  for each row execute function public.st_touch_updated_at();

-- Provider customer per user (service role only: RLS on, no client grants).
create table public.payment_customers (
  user_id uuid not null references public.profiles (id),
  provider public.payment_provider_id not null,
  customer_id text not null check (char_length(customer_id) between 1 and 255),
  created_at timestamptz not null default now(),
  primary key (user_id, provider)
);

-- Webhook idempotency: payments-webhook inserts the provider event id with ON CONFLICT DO NOTHING
-- (service role only).
create table public.payment_events (
  id text primary key check (char_length(id) between 1 and 255),
  provider public.payment_provider_id,
  type text,
  payment_id uuid references public.payments (id) on delete set null,
  received_at timestamptz not null default now()
);
create index payment_events_payment_idx on public.payment_events (payment_id);

-- When the deposit is secured (setup succeeded, or charged for charge-and-refund methods), the join
-- request becomes visible to the host and the host is notified.
create function public.st_payments_after_update() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare g public.games;
begin
  -- Card/wallet flow: SetupIntent succeeded. Charge-and-refund methods (iDEAL, Pix, BLIK…, TRUST-062):
  -- the webhook moves status='succeeded' and deposit_state='held' together.
  if (new.step = 'setup' and new.status = 'succeeded' and old.status is distinct from 'succeeded')
     or (new.step = 'charge' and new.deposit_state = 'held' and old.deposit_state is distinct from 'held') then
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
