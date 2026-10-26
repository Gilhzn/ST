# ADR 0006: Payments behind a PaymentProvider port

- Status: Accepted (2026-10). Amended 2026-10 by the owner decision below (single global processor).

## Context
Optional no-show deposits are a key product lever (paid events average about 17% no-shows vs about 28% for free ones). Launch is global with "every payment method". Stripe covers cards, Apple Pay, Google Pay and many local methods, but does not open merchant accounts for Israeli companies, and Israeli users expect Bit. **Owner decision (2026-10): incorporate a foreign entity (US, EU or UK) and use Stripe as the single global processor, including for Israeli users.** Card holds expire after about 7 days.

## Decision
- `packages/payments` defines a `PaymentProvider` port (`createDepositSetup`, `placeHold`, `capture`, `release`, `refund`, `parseWebhook`) with `StripeProvider` (primary; Payment Element on web, PaymentSheet on native) and `FakeProvider` (tests, mock adapter).
- **Stripe is the single global processor for all markets, including Israel** (cards, Apple Pay and Google Pay via Stripe). The merchant of record is the new foreign entity (US/EU/UK, jurisdiction to be chosen with counsel and the accountant). Israeli users are charged by Stripe in ILS (or their card currency) through the same `StripeProvider`.
- Bit and the Israeli local PSP are **deferred to a later phase and remain an interface stub**: `LocalPspProvider` (`packages/payments/src/local-psp.ts`) keeps implementing the port behind a `LocalPspClient` interface, with no signed PSP contract and no production routing. The port, `routeFor()` and the charge-and-refund path stay in place so a local PSP can be enabled as an adapter later. Until then, Bit and other no-hold push methods are not offered in Israel.
- Shared types: `Money`, `PaymentIntentStatus`, `Payment`, `DepositState` in `@st/domain`.
- Deposit flow: SetupIntent at join → manual-capture hold at `startsAt − 24h` → release on attendance/excuse/cancel, capture on an undisputed or upheld no-show.
- Only Edge Functions talk to providers; `payments-webhook` (signature-verified) is the only path that advances payment status; every operation uses an idempotency key.

## Consequences
- + Adding a market-specific PSP is an adapter, not a rewrite; testable with `FakeProvider`.
- + No card data touches our servers (provider-hosted UI).
- − Lowest-common-denominator port: provider-specific features need explicit port extensions.
- − Host payouts (Stripe Connect / marketplace rules) are deferred; MVP forfeits go to a platform-held pot. Stripe Connect (Express) for the future trainer marketplace requires the foreign entity to be the platform account.
- + One processor, one webhook surface, one reconciliation and one PCI scope: **SAQ A** via Stripe Elements / Payment Element / PaymentSheet (no PAN on our servers).
- − Israeli users lose Bit until the local PSP phase; some Israeli users will see a foreign merchant name on their card statement. Statement descriptor and support language must be set accordingly.
- − Requires the corporate and tax work below before any live payment. Not an engineering task, but a launch blocker for deposits.
- − Native payment sheets require extra dependencies (e.g. `@stripe/stripe-react-native`) and EAS config.

## Update (M3, contract v2)
- A no-show deposit is captured only after an **undisputed** 48 h dispute window, or after a moderator upholds the card; an overturn or auto-void releases or refunds it. Waitlist acceptance (`acceptWaitlistOffer`) collects the payment method at that moment (`Participant.paymentReady`).

## Notes for counsel and the accountant (open items before live payments)
- **Entity jurisdiction:** choose US (e.g. Delaware), EU (e.g. Ireland, Netherlands, Estonia) or UK for the Stripe account holder and merchant of record. Consider the founders' Israeli tax residency (CFC and permanent-establishment exposure), transfer pricing between the entity and any Israeli operating company, and IP ownership. Stripe must support the chosen country and the founders' KYC.
- **VAT/GST registration:** UK VAT (digital services and any UK supply, including London deposits and fees); EU One-Stop Shop (OSS) for B2C digital services; **Israeli VAT on digital services supplied by a foreign entity to Israeli consumers** (registration and reporting as a non-resident supplier); other markets as sales grow (e.g. via Stripe Tax). Deposit forfeits and service fees may be treated differently from refunded deposits.
- **PCI DSS:** target SAQ A. Card data is entered only in Stripe-hosted Elements / Payment Element / PaymentSheet; keep CSP and script-integrity controls on web payment pages.
- **Stripe Connect:** the future trainer and host-payout marketplace (Connect Express, KYC, DAC7 reporting) depends on the same entity being the platform. Confirm cross-border payout coverage for Israeli trainers.
- **Consumer and licensing:** confirm the merchant-of-record and no-stored-value model, and the consumer-law treatment of forfeited deposits, in each launch market (see `docs/compliance.md` PAY-*, ISR-10).
