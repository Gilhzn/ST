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

`_shared/domain.mjs`, `_shared/payments.mjs`, `_shared/notifications.json` and `_shared/invite-copy.json` are generated and gitignored.

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
| `media-upload` | app, user JWT | Media Vault (VAULT-001/002). `create_upload_intent` **as the caller** enforces verified attendance, the `startsAt … endsAt + 2h` window, 30 items/user/game, size/duration/type; its `ST:` errors pass through with `details.reason` (`window_closed`, `user_cap_reached`…). Returns a `MediaUploadIntent` with a single-use signed upload URL (`StorageClient.createSignedUploadUrl`) for the key the RPC allocated. |
| `media-process` | Storage webhook / retry job (internal) or the uploader's JWT (`completeMediaUpload`) | Pre-publication pipeline (VAULT-003), idempotent per media id. Photos: strip EXIF/GPS/XMP/comments in pure TS (`_shared/media-sanitize.ts`; unparseable → blocked) → CSAM hash match on the sanitised bytes → image moderation → renditions → upload → `finalize_media` → delete the original. Videos: Cloudflare Stream transcode (drops container metadata) → 202 while transcoding → duration check → CSAM + moderation on sampled frames → finalize. **CSAM match**: never published; original copied to `quarantine/<id>/` (legal hold) with a SHA-256 manifest; report via `CsamReporter`; `apply_effects` restricts the account for 30 days (join ban, visibility, chat mute) and queues a high-priority review; the uploader only sees the generic policy block. Vendor outage or missing key → 503, item stays `processing` (fail closed). |
| `media-purge` | `st_remove_media` via `st_dispatch`, internal | Deletes a removed item's objects (`paths`, everything under its `media/<game>/<id>/` prefix) and its Stream asset. Accepts only `originals/…` and `media/…` keys of that item, never `quarantine/…` (legal hold). Idempotent. |
| `rating-period` | pg_cron, internal | `run_rating_period` (weekly Glicko-2, GLK-001..005), then a `rating_level_changed` notification ("Your level is now 3.4") for displayed ratings whose level moved (never provisional or frozen), deduped per user/sport/family/period, pushed via `push-dispatch`. |
| `series-jobs` | pg_cron, internal | `generate_occurrences` + `always_in_autojoin` (`{ job: 'all' \| 'generate' \| 'autojoin' }`), then hands this run's `series_reconfirm` / `series_auto_released` / `roster_leave_offer` notifications to `push-dispatch`. A failed step → 503 (all steps idempotent). |
| `invite-preview` | public GET (`--no-verify-jwt`) | `/invite-preview/<token>`: HTML with Open Graph + Twitter Card tags (sport, title, day/time, area, free spots, host) for WhatsApp rich previews; meta refresh + link to `<OG_BASE_URL>/invite/<token>`. `get_invite_preview` as anon. Every value HTML-escaped, CSP without scripts, `noindex`, no referrer. Locale from `?lang=` → `Accept-Language` → English (copy: `common:sports`, `games:invite`, optional `invite:preview`). |

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
| `MEDIA_BUCKET` | media-upload, media-process, media-purge | Private Storage bucket (default `media`). Uploads land in `originals/…`; published copies in `media/<gameId>/<mediaId>/`. Set the bucket `file_size_limit` to 200 MB and allow only the accepted MIME types. |
| `MEDIA_QUARANTINE_BUCKET` | media-process | Legal-hold bucket for CSAM evidence (default: `MEDIA_BUCKET`, under `quarantine/`). Use a separate private bucket with no policies (service role only) and no lifecycle deletion. |
| `CSAM_PROVIDER_KEY` | media-process | PhotoDNA Cloud Service subscription key (hash matching). **Unset → nothing is published** (503, fail closed). |
| `OPENAI_API_KEY` | media-process (also chat) | omni-moderation with image input. Unset → nothing is published. |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_STREAM_TOKEN`, `CLOUDFLARE_STREAM_CUSTOMER_CODE` | media-process | Cloudflare Stream (video transcode + thumbnails). Unset → videos stay `processing` (503). |
| `OG_BASE_URL` | invite-preview | Public web app base URL (https). Humans are sent to `<OG_BASE_URL>/invite/<token>`; the preview image is `<OG_BASE_URL>/og/<sport>.png` (1200×630, plus `default.png`), static assets the web app must ship in `public/og/`. |
| `PUSH_VIA_WEBHOOK=1` | rating-period, series-jobs | Set when the `notifications` INSERT webhook already calls `push-dispatch`; the jobs then skip their direct push (no double notifications). |

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
# Phase 1.5
supabase secrets set MEDIA_BUCKET=media MEDIA_QUARANTINE_BUCKET=media-legal-hold CSAM_PROVIDER_KEY=… \
  CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_STREAM_TOKEN=… CLOUDFLARE_STREAM_CUSTOMER_CODE=… OG_BASE_URL=https://app.example
supabase functions deploy media-upload $IM
supabase functions deploy media-process media-purge rating-period series-jobs invite-preview --no-verify-jwt $IM
```

Then:

- **Stripe** webhook endpoint `https://<ref>.supabase.co/functions/v1/payments-webhook?provider=stripe` with
  `setup_intent.succeeded`, `setup_intent.setup_failed`, `setup_intent.requires_action`,
  `payment_intent.amount_capturable_updated`, `payment_intent.succeeded`, `payment_intent.payment_failed`,
  `payment_intent.canceled`, `payment_intent.processing`, `payment_intent.requires_action`,
  `charge.refunded`, `charge.dispute.created`.
- **Database webhooks**: `notifications` INSERT → `push-dispatch`; optionally `user_reports`,
  `venue_reports`, `appeals` INSERT → `trust-evaluate` (rules are SQL-authoritative; effects are idempotent).
- **Storage webhook** (database webhook on `storage.objects` INSERT) → `media-process` with the internal
  bearer; it ignores other buckets and anything outside `originals/`. A retry job should re-invoke
  `media-process` with `{ mediaId }` for items still `processing` after a few minutes (vendor outages,
  video transcodes).
- **pg_cron → functions** (Phase 1.5): `series-jobs` (e.g. every 15 min), `rating-period` (weekly, Monday early UTC).
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

## Media Vault provider ports (`_shared/media-providers.ts`)

| Port | Production adapter | Fake (`_test/media-fakes.ts`) |
|---|---|---|
| `StorageClient` (`_shared/storage.ts`) | Supabase Storage REST (signed upload/download URLs, upload, cross-bucket copy, remove) | `MemoryStorage` |
| `CsamScanner` | PhotoDNA `Match` (`CSAM_PROVIDER_KEY`) | `FakeCsamScanner` |
| `CsamReporter` | `manualCsamReporter`: files nothing; the high-priority review item carries what T&S needs to file the NCMEC / hotline report | `FakeCsamReporter` |
| `ImageModerator` | OpenAI `omni-moderation-latest`, image input (`IMAGE_THRESHOLDS`; a `sexual/minors` signal also queues an urgent review) | `FakeImageModerator` |
| `RenditionProvider` | `storageTransformRenditions` (thumb 320 px / medium 1280 px via Supabase image transformations of the sanitised object) | `fakeRenditions` |
| `VideoProvider` | Cloudflare Stream (copy-from-URL, idempotent by media id, signed thumbnails for frame sampling) | `FakeVideoProvider` |

Vendors get sanitised bytes (or a 1 h signed URL for videos) and the media id only, never user data, except
the CSAM report. The EXIF stripper is tested on real Pillow-made JPEG/PNG/WebP files carrying GPS
(`_test/media-fixtures.ts`; output verified pixel-identical with Pillow) and on hand-crafted segments.

## Privacy and security notes

- Logs are JSON with key-based redaction (`body`, `text`, `token`, `secret`, `lat/lng`, …); message content,
  translations, GPS samples and client secrets are never logged.
- Vendors receive only message text plus up to 5 earlier messages labelled SENDER/OTHER, never user ids.
- Bidi controls are stripped server side (Trojan-Source style spoofing); the app isolates every message with FSI/PDI.
- Media: originals (with EXIF) are deleted once an item is finalised; only sanitised copies are published.
  Media bytes, signed URLs and EXIF are never logged. CSAM evidence lives only under the legal-hold path.
- `invite-preview` escapes every interpolated value (`_shared/html.ts`), accepts only https image URLs, and
  serves `Content-Security-Policy: default-src 'none'` (no scripts) with `Referrer-Policy: no-referrer`.
- No card data passes through these functions; only provider references and client secrets for the payment sheet.
