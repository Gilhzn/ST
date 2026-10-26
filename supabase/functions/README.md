# Supabase Edge Functions

Server logic that needs secrets or third-party vendors: chat moderation, translation, GPS check-in,
deposits, account deletion and push. Owner: Full-stack (Functions/Payments). See
[architecture §4–§6](../../docs/architecture.md), [ADR 0005](../../docs/adr/0005-moderation-pipeline.md) and
[ADR 0006](../../docs/adr/0006-payments-port.md).

## Layout

```
_shared/            runtime-agnostic modules (http, auth, supabase client, store, moderation, translate, push, i18n, log…)
_test/              test helpers (Node only, never deployed)
<function>/handler.ts   pure `handle(req, deps)`: all logic, unit-tested in Node with fakes
<function>/index.ts     Deno entrypoint: builds real deps and calls `Deno.serve` (excluded from tsc)
build-domain.mjs    bundles @st/domain + @st/payments for Deno, copies push copy, writes import_map.json
import_map.json     generated, committed: how Deno resolves the bare specifiers below
package.json        not a workspace; only the `imports` field, so Node/tsc/vitest resolve `#shared/*` and `#fn/*`
```

### Module resolution (one source, two runtimes)

Handlers import `@st/domain`, `@st/payments`, `#shared/<module>` and `#fn/<function>/handler`.

| Runtime | `@st/domain`, `@st/payments` | `#shared/*`, `#fn/*` |
|---|---|---|
| Node (tsc, vitest) | npm workspace packages (TypeScript sources) | `package.json` `imports` → `./_shared/*.ts`, `./*.ts` |
| Deno (deploy) | `import_map.json` → `_shared/domain.mjs`, `_shared/payments.mjs` (esbuild bundles) | `import_map.json`, one explicit entry per module |

This avoids `.ts` extensions in shared code (which `supabase/tsconfig.json` would reject without
`allowImportingTsExtensions`). `index.ts` files are Deno-only and use ordinary `./x.ts` imports plus
pinned `npm:` specifiers (`npm:@anthropic-ai/sdk@1.3.0`, `npm:stripe@23.0.1`).
`deno-graph.test.ts` bundles every `index.ts` with the import map (esbuild) so a missing entry fails CI.

```bash
node supabase/functions/build-domain.mjs           # before every deploy (and after changing domain/payments/i18n)
node supabase/functions/build-domain.mjs --check   # CI: import_map.json is up to date
```

`_shared/domain.mjs`, `_shared/payments.mjs` and `_shared/notifications.json` are generated and gitignored.

## Function catalog

| Function | Caller / auth | Purpose |
|---|---|---|
| `send-message` | app, user JWT | Only write path into game chat: membership, mute and window checks; bidi/control stripping (≤1000 chars); rate limits (20/min, 5 identical → spam); blocklist + OpenAI `omni-moderation-latest` ∥ Claude `claude-haiku-5-5` (strict JSON) under 1.5 s → domain policy. allow/pending → insert + Broadcast `game:<id>`; nudge → returned with `requiresConfirmation` (resend with `confirmNudge: true`); block → `moderation_retained` (90 d) + trust engine (3 blocks/7 d → card + 24 h mute via `apply_effects`). |
| `moderation-recheck` | `recheck_pending_messages` job, internal | Re-moderates `pending` messages; a block retracts (Broadcast `retracted`), retains and counts; still unavailable after 10 min → `chat_recheck` review. |
| `translate-message` | app, user JWT | Reads the message under RLS; cache `message_translations`; Google → DeepL → Claude; target = profile locale; pending messages are not translated. |
| `checkin-verify` | app, user JWT | Stage-2 GPS: pin read via `game_views` as the caller; domain `verifyGps`; `record_checkin_verdict` (service role); returns the verdict with fallbacks (qr/peer/host). Integrity token is a seam (`IntegrityVerifier`, not configured yet). |
| `trust-evaluate` | DB webhook / cron, internal | Runs `applyTrustEvent` on `{ events }` or a database-webhook insert (`user_reports`, `venue_reports`, `appeals`) and applies effects. `dryRun` supported. |
| `create-deposit` | app, user JWT | Cards/wallets: SetupIntent now, hold later. Push methods (iDEAL, Pix, BLIK, Bancontact…): automatic-capture intent confirmed now (charge-and-refund). Idempotent per participant. |
| `payments-webhook` | PSP, signature (`--no-verify-jwt`) | Verifies the signature on the raw body, dedupes by event id (`payment_events`), applies monotonic transitions (`reconcileEventRow` + `applyPaymentEvent`), notifies on declined holds. `?provider=stripe` (default) / `fake`. |
| `payments-hold` | `place_deposit_holds` job, internal | Places the off-session manual-capture hold at max(T−24h, approval). |
| `payments-settle` | `settle_deposits` job, internal | Re-checks the SQL request with domain `decideSettlement`; release (cancel/refund) or forfeit (capture after the 48 h dispute window). Disagreement → deferred + audit. |
| `settle-deposits` | internal | Same handlers with `{ kind: 'hold' \| 'settle', payment_id \| sweep }` (manual / fallback sweeps). |
| `delete-account` | app, user JWT | Releases deposits of games not yet ended, `delete_my_account()` as the user, detaches saved methods at the PSP, deletes the auth user last. Idempotent. |
| `push-dispatch` | DB webhook on `notifications` insert, internal | Renders `notifications:<kind>.title\|body` in the recipient locale (English fallback), Expo batches ≤100, deletes `DeviceNotRegistered` tokens. Web Push is a stub. |

Internal callers authenticate with `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` (what `st_dispatch`
sends) or `FUNCTIONS_INTERNAL_SECRET`.

## Environment variables

| Variable | Used by | Notes |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | all | Provided by the platform. |
| `ALLOWED_ORIGINS` | user-facing | Comma-separated web origins for CORS (native apps send no Origin). |
| `FUNCTIONS_INTERNAL_SECRET` | internal | Optional extra bearer secret (≥16 chars) for cron/webhooks. |
| `OPENAI_API_KEY` | send-message, moderation-recheck | omni-moderation. |
| `ANTHROPIC_API_KEY` | send-message, moderation-recheck, translate-message | Claude classifier and translation fallback. |
| `GOOGLE_TRANSLATE_KEY` | translate-message | Cloud Translation v2. |
| `DEEPL_KEY` | translate-message | Keys ending in `:fx` use the free endpoint. |
| `STRIPE_SECRET_KEY` | create-deposit, payments-*, settle-deposits, delete-account | |
| `STRIPE_WEBHOOK_SECRET` | payments-webhook | `whsec_…` of the endpoint below. |
| `EXPO_ACCESS_TOKEN` | push-dispatch | Expo enhanced push security. |
| `PAYMENTS_FAKE=1`, `FAKE_WEBHOOK_SECRET` | deposit functions | Non-production only: routes deposits to the in-memory FakeProvider. |

Any vendor key may be absent: the provider is skipped (moderation then degrades to `pending`, translation
returns 503 when no provider is configured).

## Deploy

```bash
node supabase/functions/build-domain.mjs
supabase secrets set OPENAI_API_KEY=… ANTHROPIC_API_KEY=… GOOGLE_TRANSLATE_KEY=… DEEPL_KEY=… \
  STRIPE_SECRET_KEY=… STRIPE_WEBHOOK_SECRET=… EXPO_ACCESS_TOKEN=… ALLOWED_ORIGINS=https://app.example
IM=--import-map=supabase/functions/import_map.json
# user-facing (gateway JWT check + GoTrue verification in the handler)
supabase functions deploy send-message translate-message checkin-verify create-deposit delete-account $IM
# PSP and internal callers authenticate themselves
supabase functions deploy payments-webhook trust-evaluate push-dispatch moderation-recheck \
  payments-hold payments-settle settle-deposits --no-verify-jwt $IM
```

Then:

- **Stripe** webhook endpoint `https://<ref>.supabase.co/functions/v1/payments-webhook?provider=stripe` with
  `setup_intent.succeeded`, `setup_intent.setup_failed`, `setup_intent.requires_action`,
  `payment_intent.amount_capturable_updated`, `payment_intent.succeeded`, `payment_intent.payment_failed`,
  `payment_intent.canceled`, `payment_intent.processing`, `payment_intent.requires_action`,
  `charge.refunded`, `charge.dispute.created`.
- **Database webhooks**: `notifications` INSERT → `push-dispatch`; optionally `user_reports`,
  `venue_reports`, `appeals` INSERT → `trust-evaluate` (rules are SQL-authoritative; effects are idempotent).
- **pg_cron → functions**: `alter database postgres set st.functions_url = 'https://<ref>.functions.supabase.co'`
  and a Vault secret `st_functions_key` (see `migrations/0011_jobs_effects.sql`).

## Tests

```bash
npx vitest run --project @st/supabase supabase/functions   # handlers + shared modules (fakes, no network)
npx tsc -p supabase/tsconfig.json
```

Fakes cover every vendor: moderation providers (allow/nudge/block, timeouts → pending, malformed output),
translators (fallback order, caching), `FakeProvider` (full deposit lifecycle, signatures, idempotency),
Expo push (batching, token cleanup) and an in-memory payments DB (`_test/payments-db.ts`).

## Privacy and security notes

- Logs are JSON with key-based redaction (`body`, `text`, `token`, `secret`, `lat/lng`, …); message content,
  translations, GPS samples and client secrets are never logged.
- Vendors receive only message text plus up to 5 earlier messages labelled SENDER/OTHER, never user ids.
- Bidi controls are stripped server side (Trojan-Source style spoofing); the app isolates every message with FSI/PDI.
- No card data passes through these functions; only provider references and client secrets for the payment sheet.
