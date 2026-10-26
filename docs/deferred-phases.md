# Sport Talent: Deferred Phases Specification (v1.0, aligned to PRD v5.0)

| Field | Value |
|---|---|
| Date | 2026-10-26 |
| Owner | Product Strategy & Compliance |
| Scope | Features excluded from the MVP (PRD v5 §10). Each one has a goal, scope, requirements, dependencies, compliance and acceptance criteria |
| Rule | No deferred feature starts before its **phase gate** (§0.2) is met. These are metric gates, not dates |

> **Hebrew note:** This document details the features deferred from the MVP. A feature enters development only after the previous phase's metric gate is met. Without liquidity in the core loop, the add-on layers are a waste.

---

## 0. Overview

### 0.1 Phase map

| Phase | Theme | Features (section) |
|---|---|---|
| **Ph2: Host Economy** (months 3–6 after MVP) | Monetise host value. Deepen trust | §1 Paid games & host payouts · §2 Pro / Host Pro (RevenueCat) · §3 Boosted events · §4 Peer ratings & Glicko · §5 Weather · §6 Small items (venue claim, chat images, Verified Host ID, travel alerts, Safety check) |
| **Ph3: Ecosystem** (months 6–12) | Content and services | §7 Media Vault · §8 Reels / Explore · §9 Trainers marketplace · §10 Tournaments & leagues · §6 DMs between co-players · venue booking commission |
| **Ph4: Super-App** (12+ months) | Media at scale and local commerce | §11 Live streaming (Cloudflare Stream / LiveKit, GoPro RTMP) · §12 Nutrition partners & coupons · §13 Geo ads |

### 0.2 Phase gates

| Gate | Metric conditions (rolling 4 weeks) | Non-metric conditions |
|---|---|---|
| Enter Ph2 | First seed city (Tel Aviv; London follows): fill rate ≥ 60%, show-up ≥ 85%, host repeat ≥ 40%, wrongful sanctions < 5%, crash-free ≥ 99.5% | Store approvals. DPIA signed. Pen test passed |
| Enter Ph3 | 2 cities with liquidity score ≥ 60%. Payment success ≥ 97%. Chargebacks < 0.5%. P0 report SLA met ≥ 95% | T&S team ≥ 4 FTE-equivalent. Image moderation vendor contracted |
| Enter Ph4 | ≥ 5 liquid cities. Pro conversion ≥ 1.5%. Media reports actioned within SLA ≥ 95% | Live-moderation runbook. Kill switch drill passed. Counsel sign-off on live (and on age-assurance strength) |

### 0.3 Dependency graph

```
MVP core (games, trust, chat, deposits, payments port)
 ├─► §1 Paid games & Connect payouts ─┬─► §9 Trainers marketplace ─► §12 Nutrition/coupons
 │                                    ├─► §10 Tournaments (entry fees)
 │                                    └─► Venue booking commission (Ph3)
 ├─► §2 Pro / Host Pro (RevenueCat) ──► §7 Media Vault (extended storage for Pro)
 ├─► §3 Boosted events ───────────────► §13 Geo ads (shared ad-label and ranking infra)
 ├─► §4 Peer ratings & Glicko ────────► §10 Tournaments (seeding)
 ├─► §5 Weather
 └─► §6 Chat images (image moderation + CSAM) ─► §7 Media Vault ─► §8 Reels ─► §11 Live streaming
```

---

## 1. Paid games, court-fee collection and host payouts (Ph2)

**Goal.** Let hosts collect court fees in the app, replacing manual Bit and cash collection (a pain point mainly in Israel; in the UK, cash and bank transfers). This is the first proven revenue line in the category (Footy Addicts 4.3% + 20p; Playtomic take rate about 8.4%).

**Requirements**

| ID | Requirement |
|---|---|
| PAID-001 | The host sets a price per player (currency of the venue country). The price is shown on the game card and before joining |
| PAID-002 | **Host onboarding: Stripe Connect Express** (KYC, payouts, tax info collection for DAC7). The same Stripe Connect platform serves Israel (the foreign entity is the platform, ADR 0006). An Israeli local PSP marketplace is a possible later alternative |
| PAID-003 | Player pays at approval (or at waitlist promotion). Service fee: **5% + $0.30 equivalent, capped at $2 per player**, shown separately. Founding Hosts pay 0% for 12 months |
| PAID-004 | **Refunds:** player cancels ≥ 24h before → full refund. Between 24h and 2h → refund if the spot is refilled, otherwise host policy (none / 50% / full). < 2h → no refund (plus the TRUST card rules). Host cancels, or the game doesn't happen → full refund including the service fee |
| PAID-005 | **Payout** to the host at `ends_at + 48h` (after the dispute window). A paid game that didn't happen withholds the payout and refunds |
| PAID-006 | **Deposit forfeits:** 80% to verified hosts with Connect, 20% to the platform (replaces the MVP Community Fund for those hosts) |
| PAID-007 | **Apple 3.1.3(e) / Play Payments policy:** physical-world service, so **non-IAP**. Apple Pay and Google Pay via Stripe are allowed |
| PAID-008 | DAC7 seller reporting (EU). 1099-K style obligations in the US ⚖️ |

**Dependencies.** MVP payments port, the foreign entity and Stripe account (ADR 0006), Connect platform setup, DAC7 data collection.

**Acceptance criteria**
- **AC-PAID-003.** **Given** a game priced €6 and a player approved. **When** they pay with iDEAL. **Then** they are charged €6 + €0.60 service fee, the host balance shows €6 pending, and the receipt itemises both.
- **AC-PAID-005.** **Given** the game took place (TRUST-011). **When** `ends_at + 48h` passes with no open disputes. **Then** a Connect transfer of €6 × N is created with idempotency key `payout:{game_id}`.
- **AC-PAID-004.** **Given** the host cancels 3h before. **When** the cancellation is confirmed. **Then** all players are refunded in full, including the fee, within 5 business days, and the host receives GAME-047 notifications.

**Metrics.** % of hosts with Connect, paid-game share, payment success ≥ 97%, refund rate, chargeback < 0.5%.

---

## 2. Sport Talent Pro and Host Pro via RevenueCat (Ph2)

**Goal.** Subscription revenue that never touches trust or core access.

| Plan | Price (US anchor; localised via store price tiers) | Features |
|---|---|---|
| **Pro (player)** | $4.99/mo or **$34.99/yr**. 14-day trial | Heatmaps of games played (venue-level, not GPS tracks), performance and attendance graphs, season comparisons, rating history (§4), advanced Travel alerts, extended media storage (when §7 ships), Pro badge (cosmetic) |
| **Host Pro** | $9.99/mo or **$79.99/yr**. 12 months free for Founding Hosts | Unlimited recurring series (free tier: 3), more than 2 co-hosts, fill and show-up analytics per series, league branding (logo, colours), custom deposit amounts, advanced waitlist rules, CSV export, priority support |

**Requirements**

| ID | Requirement |
|---|---|
| SUB-001 | **RevenueCat** with entitlements `pro` and `host_pro`. iOS StoreKit 2 and Google Play Billing. Web through Stripe Billing, synced to RevenueCat |
| SUB-002 | Apple 3.1.1 / Play Billing: digital features → IAP in the apps. US storefront link-outs ⚖️ |
| SUB-003 | **Never paywalled:** joining, hosting (up to 3 series), check-in, reliability, appeals, safety features, data export |
| SUB-004 | Restore purchases. Grace period and billing retry handled by RevenueCat webhooks → `db.entitlements` |
| SUB-005 | Paywall placements are contextual only (e.g. tapping "Heatmap"). No interstitial paywalls in core flows. No dark patterns (cancellation is as easy as purchase, per FTC "click-to-cancel" and the EU) |
| SUB-006 | Subscription eligibility follows the 18+ rule (all users are adults). Contract-law checks (UK, EU, Israel auto-renewal and cancellation rules) are still required ⚖️ |
| SUB-007 | Heatmaps are built from check-in venue IDs, never from location tracks |

**Acceptance criteria**
- **AC-SUB-001.** **Given** a user buys Pro on iOS. **When** they sign in on web. **Then** Pro features are unlocked within 60s through the RevenueCat webhook entitlement.
- **AC-SUB-003.** **Given** a free user. **When** they create their 4th recurring series. **Then** they see the Host Pro upsell, while one-off games stay unlimited and free.
- **AC-SUB-005.** **Given** a subscriber. **When** they open "Manage subscription". **Then** a deep link to store management (or Stripe portal on web) is reachable in ≤ 2 taps.

**Metrics.** Pro conversion target 2–3% of monthly active players (Strava benchmark about 2%). Host Pro 4% of active hosts. Churn < 6%/mo.

---

## 3. Boosted events (Ph2)

**Goal.** Hosts pay to fill faster. This is also the first ad-labelling infrastructure.

| ID | Requirement |
|---|---|
| BOOST-001 | Products: **24h at $1.99, 72h at $4.99** (localised). Consumable IAP on iOS and Android (digital promotion), Stripe on web |
| BOOST-002 | Eligibility: public game; host reliability ≥ 80%; no active host suspension; **not women-only, not hidden-location** (avoid amplifying exposure) |
| BOOST-003 | Placement: highlighted pin plus top position in the list for the matching sport and filters within the radius. **At most 1 boosted game per H3 res-7 cell per sport** at a time (auction-free, first-come). Additional purchases queue for the next slot, with an ETA shown |
| BOOST-004 | Clearly labelled "Promoted" with an info sheet: who paid, why you see it (sport filter and area) (DSA Art. 26 spirit) |
| BOOST-005 | Boost auto-stops when the game is full. Unused hours become **in-app boost credit** (non-cash, non-transferable). Cancelled game → credit |
| BOOST-006 | Boost never affects trust, approval or waitlist order |

**Acceptance criteria**
- **AC-BOOST-003.** **Given** a boosted football game in a cell. **When** a second host buys a boost for the same cell and sport. **Then** they get "Next slot in 14h". Purchase is allowed only after confirming the queue.
- **AC-BOOST-005.** **Given** a 72h boost that fills after 10h. **Then** the boost stops and 62h of credit is granted.

**Metrics.** Time-to-fill uplift for boosted games vs a matched control (target −30%), boost repurchase rate.

---

## 4. Peer ratings and Glicko skill rating, gated by reliability (Ph2)

**Goal.**
- Better squad balancing and matchmaking (v4 "speed, control, overall").
- Resistance to gaming, achieved by letting only reliable, verified participants influence ratings.

### 4.1 Peer attribute ratings

| ID | Requirement |
|---|---|
| RATE-001 | After a game, verified attendees may rate up to 5 co-players on sport attributes (`sports.rating_attributes`, e.g. football: speed, ball control, passing, defence, overall; basketball: shooting, handling, defence…) on a 1–5 scale. Window: until `ends_at + 48h` |
| RATE-002 | **Rater gating:** rater reliability ≥ 80%, ≥ 5 verified games in the sport, no active sanction, and the rater checked in to that game. Blocked pairs can't rate each other |
| RATE-003 | **Anti-collusion:** per-pair weight decays after 3 ratings in 30 days. Reciprocal "10/10" clusters are down-weighted. Outlier ratings beyond 2σ of the consensus are trimmed |
| RATE-004 | **Aggregation:** Bayesian mean with the self-assessment as the prior (weight 3). Shown to the player privately. Hosts see a 1–5 band for balancing. Not public by default |
| RATE-005 | Ratings are never used for sanctions |

### 4.2 Glicko-2 skill rating

| ID | Requirement |
|---|---|
| GLK-001 | **Glicko-2 per sport and format family** (e.g. football small-sided). Initial r = 1500, RD = 350, σ = 0.06. Rating period = 1 week |
| GLK-002 | **Team games:** each player is updated against the opposing team's composite (mean r, RMS RD). Outcome is win/draw/loss only (**no margin**, to discourage running up the score). Individual sports (tennis, padel) use standard 1v1 / 2v2 |
| GLK-003 | **Eligible games only:** a result confirmed by majority (GAME-071), ≥ 70% of approved participants verified (check-in), teams published before kickoff, and no "disputed" flag |
| GLK-004 | **Gating by reliability:** players with reliability < 70% are **excluded from updates** (their games still count for others, using their last rating as fixed). The rating is **displayed** only when reliability ≥ 80%, ≥ 10 rated games, and RD < 100. Otherwise it reads "Provisional" |
| GLK-005 | **Display level 0–7** (category-familiar, cf. Playtomic): `level = clamp((r − 900) / 200, 0, 7)` with one decimal place. Shown alongside the RD-based confidence |
| GLK-006 | **Usage:** squad balancing input (replaces self-level when it isn't provisional), host level filters, tournament seeding (§10) |
| GLK-007 | **Golden test vectors** shared between TS and SQL (same parity approach as the MVP) |

**Acceptance criteria**
- **AC-GLK-003.** **Given** a game where 6 of 10 participants checked in. **When** a result is submitted. **Then** no rating updates occur and the game is labelled "Not rated: too few verified players".
- **AC-GLK-004.** **Given** a player with reliability 65%. **When** their team wins. **Then** their r is unchanged, opponents' updates use the player's frozen r, and the player sees "Improve reliability to 70% to earn rating".
- **AC-RATE-002.** **Given** a rater with 3 verified games in basketball. **When** they open post-game ratings. **Then** attribute ratings are disabled, with the explanation "Rate after 5 verified games".

**Dependencies.** GAME-071 result confirmation, the reliability engine, `sports.rating_attributes` seed.

---

## 5. Weather (Ph2)

**Goal.** Reduce surprise cancellations, and make weather cancellations fair to hosts.

| ID | Requirement |
|---|---|
| WX-001 | A `WeatherProvider` port. Candidates: Open-Meteo (commercial plan), Apple WeatherKit (attribution required), Tomorrow.io. Cache per H3 res-7 cell per hour |
| WX-002 | Forecast chip on outdoor games within 7 days: icon, temperature, precipitation %, wind |
| WX-003 | **Alerts** to host and participants at T−24h and T−3h when: precipitation probability ≥ 60% with ≥ 1 mm/h, wind ≥ 40 km/h, heat index ≥ 35 °C, thunderstorm/lightning risk, or AQI "unhealthy" |
| WX-004 | **Objective weather cancel:** if an alert (WX-003) is active, the host can "Cancel for weather" at any time with **no host card** (closes the force-majeure abuse gap in GAME-047). Without an active alert, normal rules apply |
| WX-005 | Indoor venues are excluded. Data-source attribution shown |

**Acceptance criteria.** **Given** an active thunderstorm alert 90 min before the game. **When** the host cancels for weather. **Then** no card is issued, deposits and fees are refunded, and participants get "Cancelled due to weather" plus indoor alternatives nearby.

---

## 6. Smaller Ph2/Ph3 items

| ID | Feature | Phase | Key requirements | Compliance / dependency |
|---|---|---|---|---|
| CLAIM-001 | **Venue claim** (owner dashboard) | Ph2 | Verification via business document, domain email or a phone callback. Owner edits details, hours and photos. Owner-claimed venues are never auto-hidden (MAP-010). Basic demand stats (aggregated, k ≥ 20) | DSA Art. 16 notices from owners. Booking integration in Ph3 |
| IMG-001 | **Images in game chat** | Ph2 | Image moderation (omni-moderation image input) plus **CSAM hash matching** before delivery. EXIF/GPS stripping. Purged with the chat (end+3h). Retained 90d if reported. No images from accounts < 30 days old, or from or to 16–17s | Apple 1.2. NCMEC/INHOPE reporting |
| VHOST-ID | **Verified Host with ID** | Ph2 | Stripe Identity (document + selfie). Only a "verified" flag is stored, never the document | Biometric processing by Stripe as processor ⚖️ (GDPR Art. 9 basis = explicit consent) |
| TRAVEL-ALERT | **Travel alerts** | Ph2 | Notify when matching games appear in a saved trip city and date range. ≤ 1 push/day | — |
| SAFE-020 | **Safety check** | Ph2 | Share game details with a trusted contact through the share sheet. No live location | — |
| DM-001 | **DMs between co-players** | Ph3 | Only between users who played together in a verified game within 90 days, **with mutual opt-in**. Same moderation pipeline. Report and block. Retention 30 days | Apple 1.2. UK OSA user-to-user duties |
| BOOK-001 | **Venue booking commission** | Ph3 | Integrations with venue booking systems (API partners). Book a court while creating a game. Commission 6–10% | Connect. Venue contracts |

---

## 7. Media Vault (Ph3)

**Goal.** Post-match memories tied to games and venues (v4 §4), designed for consent.

| ID | Requirement |
|---|---|
| VAULT-001 | **Upload window:** verified attendees only, from `starts_at` to `ends_at + 2h` (v4 kept). The gallery then locks for new uploads |
| VAULT-002 | Photos (≤ 20 MB) and videos (≤ 60 s, ≤ 200 MB). Up to 30 items per user per game. Storage: Cloudflare Images/Stream or Supabase Storage plus a CDN |
| VAULT-003 | **Pre-publication pipeline:** EXIF and GPS strip → CSAM hash match (e.g. Cloudflare CSAM Scanning Tool / PhotoDNA) → image/video moderation (sampled frames for video) → publish. Positive CSAM → block, preserve, report (NCMEC/hotline), account action |
| VAULT-004 | **Visibility levels:** `participants` (default) → `venue_public` (appears in the venue vault) only when the uploader opts in **and** every tagged person consents. Untagged, recognisable people can request removal or blur |
| VAULT-005 | **Consent tagging:** a tag is a request. It is invisible until accepted. Tagged users can untag at any time, which also removes the item from `venue_public` if they request it. All users are 18+, so there is no age-based exception |
| VAULT-006 | **Venue vault:** per-venue history with a date filter, showing only `venue_public` items |
| VAULT-007 | **Retention:** 12 months free (Pro: unlimited while subscribed, then 90 days' grace). Deleted on account deletion. Others' items in which the user was tagged are untagged |
| VAULT-008 | Report on every item. Copyright notices go through the DSA Art. 16 form |
| VAULT-009 | Google Play Photo Picker, iOS PHPicker. No broad media permissions |

**Acceptance criteria**
- **AC-VAULT-001.** **Given** a game ended at 20:00. **When** a participant uploads at 22:05. **Then** the upload is rejected with "Gallery locked 2 hours after the game".
- **AC-VAULT-004.** **Given** a photo tagging 3 players, 2 of whom accepted. **When** the uploader sets `venue_public`. **Then** the photo stays `participants`-only until the third accepts or is untagged.
- **AC-VAULT-005.** **Given** a tagged user who has not accepted the tag. **When** anyone attempts `venue_public`. **Then** the item stays at `participants` and the action is blocked with an explanation.
- **AC-VAULT-003.** **Given** an upload matching a CSAM hash. **Then** it is never published, the evidence is preserved under legal hold, a report is filed, and the account is restricted pending human review.

**Dependencies.** IMG-001 pipeline, T&S staffing, a vendor for video moderation.

---

## 8. Reels and the Explore tab (Ph3)

| ID | Requirement |
|---|---|
| REEL-001 | Short clips (≤ 60 s) published from the Vault with `venue_public` consent rules. The Explore tab returns to the tab bar |
| REEL-002 | **Ranking:** recency, followed sports, nearby (city-level), engagement. **A non-personalised chronological option** is always available. Ranking is explained in the T&C (DSA Art. 27) |
| REEL-003 | New accounts (< 30 days) or low-reliability accounts: clips are held for pre-moderation before public distribution |
| REEL-004 | All users are 18+, so there is no teen feed. Reels still require consent from everyone shown (VAULT-005) |
| REEL-005 | Comments: off by default. Enabled per reel for adults only, with the full moderation pipeline |
| REEL-006 | Metrics guardrail: Explore must not reduce WFPS (an A/B holdout is required at launch) |

**AC-REEL-002.** **Given** a user who selects "Latest". **Then** the feed is reverse-chronological with no personalisation signals, and the setting persists.

---

## 9. Trainers and experts marketplace (Ph3)

**Goal.** Trainers, nutritionists and physiotherapists offer services to active players (v4 §5).

| ID | Requirement |
|---|---|
| TRN-001 | **Provider onboarding:** profile, services, prices, service area, and **credential verification** (document plus human check, with the date shown). Licensed professions (physio, dietitian) need a licence number verified against a registry where available ⚖️ |
| TRN-002 | **Stripe Connect Express** for payouts and KYC. Platform commission **12%** (Founding providers 5% for 6 months). DAC7 reporting |
| TRN-003 | **Payment channel by service type (Apple):**<br>(a) In-person sessions are services consumed outside the app: **must use non-IAP** (3.1.3(e)).<br>(b) 1:1 real-time video sessions **may use non-IAP** (3.1.3(d)).<br>(c) 1:few or 1:many live classes, and recorded programmes or plans: **IAP required** (3.1.3(d)). These are deferred until IAP economics are validated.<br>Google Play applies the equivalent physical/digital split |
| TRN-004 | **Booking:** availability calendar, request or instant book, a cancellation policy chosen from 3 presets, reminders. Check-in reuses the TRUST QR flow for in-person sessions (provider shows the QR) |
| TRN-005 | **Reviews only from completed, paid bookings** (v4 kept). One review per booking. The provider can reply once |
| TRN-006 | **Messaging:** scoped to a booking, open from booking until 7 days after the session. Full moderation pipeline. Report and block |
| TRN-007 | **Safeguarding:** all customers are 18+. Trainers who coach minors outside the app are out of scope. Trainer background checks (e.g. DBS in the UK) are a trust option, not a minors rule ⚖️ |
| TRN-008 | **Health data:** nutrition and physio intake forms may include health data (GDPR Art. 9, WA MHMDA). The provider is an independent controller for clinical notes. We store only booking metadata. DPIA addendum ⚖️ |
| TRN-009 | Disputes: the platform mediates within 7 days. A refund-from-commission policy is defined |

**Acceptance criteria**
- **AC-TRN-003.** **Given** an iOS user booking an in-person session. **Then** checkout uses Stripe or Apple Pay (not IAP). **Given** they buy a recorded 4-week plan. **Then** checkout uses IAP.
- **AC-TRN-005.** **Given** a user without a completed booking with the provider. **Then** the "Write review" action is not available.
- **AC-TRN-001.** **Given** a provider with an unverified licence. **Then** the profile shows no "Licensed physiotherapist" title, only "Fitness services".

**Dependencies.** §1 Connect, §6 DM moderation infrastructure, a credential verification vendor.

---

## 10. Tournaments and leagues (Ph3)

| ID | Requirement |
|---|---|
| TOUR-001 | **Formats:** round robin, single elimination, groups + knockout, and season league (fixtures over weeks), plus a ladder for racket sports |
| TOUR-002 | **Entities:** `tournaments`, `tournament_teams` (captain, roster ≥ min size), `fixtures` (each fixture is a game with lifecycle, check-in and results) |
| TOUR-003 | **Registration:** team or individual (auto-teams). Entry fee through Connect (§1). Waitlist. Roster lock date |
| TOUR-004 | **Seeding** by team mean Glicko (§4) when it isn't provisional, otherwise random with a seeded RNG. Brackets are regenerated deterministically |
| TOUR-005 | **Results:** both captains confirm within 2h. A dispute goes to the organiser, then platform T&S |
| TOUR-006 | **No-shows:** forfeit rules per format. Individual no-shows follow the TRUST cards |
| TOUR-007 | Standings (points, tiebreakers: head-to-head, goal difference, fair-play from cards). Public tournament page (SEO) |
| TOUR-008 | Sponsorship slot: organiser logo plus sponsor banner, labelled "Sponsored" |

**AC-TOUR-004.** **Given** 8 teams with non-provisional ratings. **When** the bracket is generated. **Then** seeds 1 and 2 are in opposite halves, and regenerating with the same seed yields an identical bracket.

---

## 11. Live streaming: smartphone and GoPro (Ph4)

**Goal.** Live broadcast of games (v4 §4) under the strictest safety design in the product.

### 11.1 Architecture

| Use case | Technology | Notes |
|---|---|---|
| One-to-many broadcast from a phone | **Cloudflare Stream Live**: WHIP (WebRTC) ingest from the app, HLS/DASH playback | About $1 per 1,000 delivered minutes (findings §B). Recording optional |
| **GoPro / action cameras** | **RTMPS ingest** to Cloudflare Stream. The host gets a per-stream RTMP URL and key in the app, to paste into the GoPro Quik app (live to a custom RTMP URL on supported HERO models). SRT also supported | The key rotates per stream and expires at game end + 30 min |
| Interactive (co-commentary, multi-cam, low latency) | **LiveKit** (Cloud or self-host) | Phase 4b |

### 11.2 Safety requirements (mandatory, PRD MEDIA-004/005)

| ID | Requirement |
|---|---|
| LIVE-001 | Everyone on the platform is 18+ (`trust_config.min_age_years`, default 18), so there is no separate age gate for streaming. Viewers must be signed-in users (no anonymous viewing in the first release) |
| LIVE-002 | Streamer eligibility: Verified Host (with ID, VHOST-ID), reliability ≥ 85%, no sanction in 180 days |
| LIVE-003 | **Consent:** a game can be marked "May be streamed" only at creation. Every participant must accept at join. Opting out later blocks streaming of that game. In-stream indicator for participants |
| LIVE-004 | **Kill switch:** moderators can end a stream (≤ 10 s), all streams in a country, or all streams globally (MOD-006). An automated trigger ends the stream on a high-confidence violation in sampled frames |
| LIVE-005 | **Real-time moderation:** frames sampled every 5 s through vision moderation, plus viewer reports, which create a P0 queue item while the stream is live |
| LIVE-006 | Live chat for viewers: off by default. If enabled, it goes through the full moderation pipeline. Slow mode |
| LIVE-007 | Recordings: retained 30 days (participants can view), unless published to the Vault under VAULT-004 consent rules |
| LIVE-008 | No streaming from changing rooms. Policy and T&C prohibit filming non-participants in private settings. Report category "privacy violation" |
| LIVE-009 | Age rating update in the stores. Counsel sign-off (UK OSA livestreaming measures, DSA) ⚖️ |

**Acceptance criteria**
- **AC-LIVE-001.** **Given** a game where not every participant accepted "May be streamed" (LIVE-003). **When** the host taps "Go live". **Then** the action is unavailable with an explanation. Anonymous (signed-out) viewers cannot open the stream.
- **AC-LIVE-004.** **Given** an active stream. **When** a moderator presses "End stream". **Then** ingest is disconnected and playback stops for all viewers within 10 s, the stream key is revoked, and an SoR is sent to the streamer.
- **AC-LIVE-GoPro.** **Given** a verified host. **When** they request a GoPro stream. **Then** they get an RTMPS URL and a single-use key valid until `ends_at + 30 min`. The stream appears in-app within 15 s of ingest starting.

**Dependencies.** §7 media pipeline, VHOST-ID, the T&S live on-call rota, the vision-moderation vendor.

---

## 12. Nutrition partners and coupons (Ph4)

| ID | Requirement |
|---|---|
| CPN-001 | **Partners:** sport-supporting local businesses (healthy food, juice bars, sports shops, physio clinics) onboarded through a web portal. Business verification. Map layer "Partners" (toggleable, off for teens) |
| CPN-002 | **Coupon trigger:** after a **verified check-in** at a venue within ≤ 1 km of the partner. The coupon is issued at `ends_at`, valid 24–72h. **No additional location collection**: the trigger is the check-in record itself (PRD ECO-007) |
| CPN-003 | **Single-use:** a unique code plus QR. The partner redeems through the portal or a scan. One coupon per user per partner per 7 days |
| CPN-004 | **Consent:** a "Local offers" opt-in (marketing) is required (ePrivacy, Israel Communications Law §30A). Off by default. |
| CPN-005 | **Partner analytics:** aggregated only (issued, redeemed, by day), with k-anonymity ≥ 20. No user identities shared |
| CPN-006 | **Nutrition content:** no health claims beyond authorised ones (EU Reg. 1924/2006 and equivalents). "Not medical advice" disclaimer |
| CPN-007 | Billing: CPA per redemption, invoiced through Stripe |

**AC-CPN-002.** **Given** a user opted in who checked in at a venue 600 m from a partner. **When** the game ends. **Then** one coupon is issued. **Given** a user who did not opt in. **Then** no coupon is issued and the partner is not informed.

---

## 13. Geo ads (Ph4)

| ID | Requirement |
|---|---|
| ADS-001 | **First-party, contextual ad server.** No third-party ad SDKs and no cross-app tracking, so no ATT prompt is needed |
| ADS-002 | **Coarse location only:** city or an H3 res-6 cell (about 36 km²), and only with an explicit "Personalised local ads" opt-in. Without opt-in: city-level contextual (from the selected map area), with no stored location |
| ADS-003 | **Never use precise location**, check-in history or gender for ad targeting. CPRA "Limit Use" honoured. No "sale/share" of personal data |
| ADS-004 | No ads in chat, sanctions, appeals, check-in or payment flows |
| ADS-005 | **Label** "Ad" plus a "Why am I seeing this?" sheet: advertiser, who paid, main parameters (DSA Art. 26). Frequency cap of 3 per day per advertiser |
| ADS-006 | Advertiser verification and creative review (prohibited categories: gambling, alcohol to restricted markets, weight-loss claims, adult content) |
| ADS-007 | Formats: a sponsored card in the list view (max 1 per 10 items), and a sponsored venue pin (partner venues only) |
| ADS-008 | Guardrail: an A/B holdout must show no statistically significant drop in WFPS or D30 |

**AC-ADS-002.** **Given** a user without opt-in browsing London. **Then** ads are selected by "London + selected sport" only, and no location is persisted in the ad logs.

---

## 14. Cross-cutting requirements for all deferred features

1. **Trust first.** No deferred feature may let money, boosts, subscriptions or content buy trust, approval priority or protection from sanctions.
2. **Age.** The minimum age is 18+ worldwide (`trust_config.min_age_years`, default 18). A feature that would introduce minors or age-differentiated behaviour (for example coaching of under-18s) needs a new owner decision and a counsel review first.
3. **SoR and appeals.** Any new moderation action, such as removing media, ending a stream or delisting a provider, must use the SoR template (compliance.md §6) and the appeals flow.
4. **Retention.** Each feature adds rows to the data inventory (compliance.md §4) before development starts.
5. **i18n.** All 13 locales plus RTL. New legal text is native-reviewed.
6. **Kill switch.** Every feature ships behind a remote flag with a per-country off switch.
7. **Metrics guardrail.** Each launch is A/B-tested against WFPS and D30. A feature that harms the core loop is rolled back.
