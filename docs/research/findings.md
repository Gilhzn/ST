# Research Findings (web research, Oct 2026)

Condensed from three research tracks (competition and product, technology, compliance) plus the architect review. Each section lists sources inline. Treat any item marked "verify" as needing a primary-source check before launch.

## A. Market and competition
- **Playtomic** (padel/tennis): 4.7M players, 6,000+ clubs. €29M net revenue on €346M GMV (Sep 2025 YTD).
  - The only hard no-show deterrent in the category. Players prepay online and can cancel free up to 24h before.
  - A no-show is reported by another player and becomes an in-app debt that blocks use until paid.
  - Its 0–7 level is weighted by a reliability %.
  - Sources: https://playerhelp.playtomic.com/hc/en-gb/articles/43240624037393 , https://athletechnews.com/playtomic-raises-6-million-community-funding-racket-sports/
- **Footy Addicts** (UK) uses a soft reliability score. Plei (US) has about 200K users. OpenSports is organiser SaaS from $20/month with waitlists. Spond and TeamSnap are RSVP tools only.
- **Strava** has about 150M users; Premium is $79.99/yr with about 2% paying. DUPR+ (pickleball rating) is $29.99/yr.
- **No-shows:** paid events average about 17% vs about 28% for free ones (PheedLoop). A refundable deposit reduced no-shows to about 10% (single anecdote, Skift).
- **Proven revenue** in the category is booking commission plus payment fees: about 8.4% take rate at Playtomic, 4.3% + 20p at Footy Addicts. Sponsorships and coupons have no benchmarks.
- **Cold start:**
  - Seed the constrained side first: hosts and venues.
  - Launch one city and one niche to reach liquidity.
  - KPIs: fill rate, time-to-fill, host repeat rate.
  - The real incumbent is WhatsApp groups, so provide "import a WhatsApp group" and invite links.
- **Safety:** women report much more harassment in sport (Her Game Too), so offer women-only games and hide the exact location until a player is approved.

## B. Technology
- **Geofencing:**
  - iOS allows 20 regions per app and is unreliable below about 100m. CLCircularRegion is deprecated in iOS 18 in favour of CLMonitor.
  - Android allows 100 geofences and recommends a radius of at least 100–150m; latency is 2–6 min.
  - Android 14+ foreground services need the FOREGROUND_SERVICE_LOCATION type.
  - A 30–50m OS geofence is not reliable. Use a 150–200m OS geofence as a wake-up, then a precise foreground check with accuracy ≤25m and distance ≤50m + accuracy over 2–3 samples, with fallbacks.
  - Sources: https://developer.android.com/training/location/geofencing , https://radar.com/blog/limitations-of-ios-geofencing
- **Supabase:**
  - PostGIS with `ST_DWithin` on geography plus a GiST index.
  - Realtime Broadcast for chat, with RLS and `expires_at` filtering.
  - pg_cron for purges.
  - Write Edge Functions as plain TS behind a `handle(req, deps)` interface so they can be ported.
- **Maps:** MapLibre (no vendor lock-in; tiles from MapTiler, Stadia or OpenFreeMap) with supercluster on the client. Server tiles can come later.
- **Moderation:**
  - Perspective API is sunset at the end of 2026.
  - OpenAI omni-moderation is free and covers 40 languages, with higher false-positive rates.
  - Azure Content Safety is weak for he/ar/ru/hi.
  - Use an LLM classifier (Claude Haiku, `claude-haiku-5-5`) for context.
  - The pipeline layers: client blocklist → server omni + LLM in parallel → a 1.5s timeout.
- **Translation:** DeepL added Hebrew in June 2025; verify Hindi support. Google Translate covers all 12 languages. Use an LLM as a fallback for slang. Cache per message and language.
- **Video:** Cloudflare Stream for reels and live (RTMP from GoPro), at about $1 per 1,000 delivered minutes. LiveKit for interactive streams. Both are deferred.
- **Anti-spoofing:**
  - Android: `Location.isMock()` plus Play Integrity.
  - iOS: App Attest.
  - Server heuristics: impossible speed, sample spread.
  - Never sanction on one signal.
- **i18n:**
  - i18next + ICU. CLDR plurals: Arabic has 6 forms; Russian has one/few/many.
  - RTL on native via `I18nManager.forceRTL` and a reload; on web via `dir`.
  - Use logical styles (start/end). Isolate bidi text in chat with FSI/PDI.
  - Use Noto fonts for each script.

## C. Compliance (not legal advice — counsel review required)
- **Apple:**
  - 1.2 (UGC) requires a filter, report, block, timely responses and published contact info. It bans random/anonymous chat.
  - 5.1.1(iii) prefers pickers over full Contacts access. 5.1.2(iv) forbids building a contact database from Contacts.
  - 5.1.1(v) requires in-app account deletion. 5.1.2(i) says the app must not require location to function.
  - 4.8: if social login is offered, Sign in with Apple must be offered too.
  - 3.1.3(d): 1:1 real-time services such as personal training may pay outside IAP; 1:few and 1:many sessions need IAP.
  - Source: https://developer.apple.com/app-store/review/guidelines/
- **Google Play:**
  - Background location needs a declaration form, a demo video, an in-app prominent disclosure and a core-feature justification. "Attendance tracking" is likely to be rejected.
  - UGC policy requires report/block for users and content plus ongoing moderation.
  - Account deletion is required both in-app and via a web link.
- **GDPR Art. 22(3):** for solely automated decisions, users have the right to human intervention and to contest. Permanent bans are likely "similarly significant".
- **DSA:**
  - Art. 17 requires a statement of reasons for any visibility restriction or suspension, and applies to small enterprises too. A shadowban without notice is non-compliant.
  - Art. 20 (internal complaints) has a small-enterprise exemption under Art. 19, but build it anyway.
  - Art. 20(6) says decisions must not be taken solely by automated means.
- **Israel Privacy Protection Law, Amendment 13** (in force 14 Aug 2025): DPO and notification duties for systematic monitoring and large-scale sensitive data. Geolocation is high-scrutiny. Verify with Israeli counsel.
- **CCPA/CPRA:** precise geolocation (within 1,850 ft) is sensitive personal information, which brings a "Limit Use" right. Ads should use coarse location only, with opt-in.
- **Minors:** amended COPPA has been fully enforceable since April 2026. The GDPR consent age is 13–16 depending on the country. Research recommendation at the time: 16+ at launch and 18+ for live streaming (superseded: see Owner decisions below).
- **Contacts:** hashed phone numbers are trivially reversible (Signal moved to SGX enclaves). Best practice is not to upload contacts at all; use invite links, QR codes or the OS picker.

## D. Redesign decisions (spec v4 → v5)
| v4 mechanic | v5 design | Why |
|---|---|---|
| Background GPS from 1h before | Opt-in wake-up geofence (native) + foreground precise check-in + QR/host/peer fallbacks; web uses QR | Play background-location policy; iOS/Android geofence accuracy; Apple 5.1.2(i) |
| Contacts upload cross-check | Peer confirmation by ≥2 verified attendees; invite links; OS picker | Apple 5.1.2(iv), GDPR minimisation |
| Auto yellow, auto suspension week/month/permanent | Auto yellow (48h dispute) → auto 7d/30d bans; permanent only via human review | GDPR 22(3), DSA 17/20 |
| Shadowban at 3 reports | 3 independent non-colluding reporters → 72h visibility restriction + notice of reasons + appeal + review | DSA 17, Apple/Play |
| Host loses rights permanently | Automatic host suspension + review; permanent only by a human | Same |
| Ephemeral chat 2–4h | Purge at end+3h; reported/blocked messages retained 90 days for abuse handling | Evidence for appeals and law enforcement |
| Pre-send NLP block | Block, nudge or allow with an explanation; 3 blocks in 7d → yellow card + 24h mute | Apple 1.2; transparency |
| (new) | Optional deposit (manual-capture hold), waitlist auto-promotion, reliability %, women-only games, hidden location until approval, age gate (originally 16+; now 18+, see Owner decisions) | Research §A |

## Owner decisions (post-research, 2026-10)
The product owner made the following decisions after this research. Where they conflict with the findings above (minors, payments, seed cities), the decisions win.
1. **Minimum age is 18+ worldwide** (was 16+ with 18+ for live streaming). This removes the 16-17 protections track; COPPA and GDPR Art. 8 child-consent rules largely fall away. The UK Online Safety Act children's-access assessment is still required. Configured by `trust_config.min_age_years` (default 18), mirrored as `TrustConfig.minAgeYears` / `MIN_AGE_YEARS`.
2. **Payments:** incorporate a foreign entity (US/EU/UK) and use Stripe as the single global processor, including for Israeli users. Bit and an Israeli local PSP stay an interface stub for a later phase (ADR 0006).
3. **Seed cities:** Tel Aviv first, then London (the Madrid option is dropped).
