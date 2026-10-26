# ADR 0006: Payments behind a PaymentProvider port

- Status: Accepted (2026-10)

## Context
Optional no-show deposits are a key product lever (paid events average about 17% no-shows vs about 28% for free ones). Launch is global with "every payment method". Stripe covers cards, Apple Pay, Google Pay and many local methods, but does not open merchant accounts for Israeli companies, and Israeli users expect Bit. Card holds expire after about 7 days.

## Decision
- `packages/payments` defines a `PaymentProvider` port (`createDepositSetup`, `placeHold`, `capture`, `release`, `refund`, `parseWebhook`) with `StripeProvider` (primary; Payment Element on web, PaymentSheet on native) and `FakeProvider` (tests, mock adapter).
- Local PSP adapters (e.g. PayPlus or Meshulam with Bit for Israel) implement the same port; routing by merchant-of-record entity and user country. Shared types: `Money`, `PaymentIntentStatus`, `Payment`, `DepositState` in `@st/domain`.
- Deposit flow: SetupIntent at join → manual-capture hold at `startsAt − 24h` → release on attendance/excuse/cancel, capture on an undisputed or upheld no-show.
- Only Edge Functions talk to providers; `payments-webhook` (signature-verified) is the only path that advances payment status; every operation uses an idempotency key.

## Consequences
- + Adding a market-specific PSP is an adapter, not a rewrite; testable with `FakeProvider`.
- + No card data touches our servers (provider-hosted UI).
- − Lowest-common-denominator port: provider-specific features need explicit port extensions.
- − Host payouts (Stripe Connect / marketplace rules) are deferred; MVP forfeits go to a platform-held pot.
- − Native payment sheets require extra dependencies (e.g. `@stripe/stripe-react-native`) and EAS config.

## Update (M3, contract v2)
- A no-show deposit is captured only after an **undisputed** 48 h dispute window, or after a moderator upholds the card; an overturn or auto-void releases or refunds it. Waitlist acceptance (`acceptWaitlistOffer`) collects the payment method at that moment (`Participant.paymentReady`).
