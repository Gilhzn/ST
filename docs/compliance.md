# Sport Talent: Compliance Register (v1.0, aligned to PRD v5.0)

| Field | Value |
|---|---|
| Date | 2026-10-26 |
| Owner | Product Strategy & Compliance |
| Related | `docs/prd-v5.md` (requirement IDs), `docs/research/findings.md` §C, `docs/architecture.md` |
| Status | Engineering baseline for the MVP. **Not legal advice.** Every row marked ⚖️ **requires counsel review** before launch in the affected market. |

> **Hebrew note:** This register is in English because it goes to external counsel and engineering. Each row maps a legal or store requirement to how the product meets it, which component owns it, and when it ships. Rows marked ⚖️ need confirmation from counsel.

**Status legend**
- **MVP**: ships this round.
- **Ph1.5**: before or at public seed-city launch.
- **Ph2 / Ph3 / Ph4**: ships with that deferred phase.
- **Org**: an organisational task (policy, appointment or filing), not code.

**Owner components (shorthand)**

| Shorthand | Component |
|---|---|
| `domain/trust` | `packages/domain` trust, checkin and moderation pure functions |
| `db` | `supabase/migrations` (RLS, RPCs, pg_cron) |
| `fn:<name>` | the Edge Function of that name |
| `app:<area>` | an `apps/mobile-web` route or area |
| `mod-console` | `app:mod/*`, the web console behind role gating |
| `payments` | `packages/payments` and `fn:create-deposit` / `fn:payments-webhook` |
| `i18n` | `packages/i18n` |
| `legal` | Terms, Privacy Policy, Community Guidelines and Trust Charter content |
| `T&S` | the Trust & Safety team |

---

## 0. Owner decisions that shape this register (2026-10)

1. **Minimum age is 18+ worldwide** (was 16+). Configured by the `trust_config.min_age_years` column (default 18), mirrored as `TrustConfig.minAgeYears` / `MIN_AGE_YEARS` in `packages/domain`. Consequences:
   - COPPA and GDPR Art. 8 child-consent rules largely no longer apply (GDPR-03, MIN-01). Australia's minimum age of 16 is exceeded (MIN-03).
   - The UK Online Safety Act children's-access assessment is still required (OSA-03). Its conclusion is "not likely to be accessed by children" given age assurance.
   - **Counsel-review flag:** the strength of the age assurance (self-declared birth month/year plus a 24h soft lock). Consider stronger age assurance for the UK (MIN-06).
   - The 16-17 protections (SAFE-010 teen protections, teen-restricted games, no deposits or ads for teens) are removed. SAFE-011 now handles suspected under-18 accounts.
   - Live streaming and media are no longer age-gated differently from the rest of the app: everyone is 18+.
2. **Payments:** a foreign entity (US/EU/UK) is incorporated and Stripe is the single global processor, including for Israeli users. Bit and the Israeli local PSP stay an interface stub, deferred (ADR 0006; PAY-10/11/12, ISR-10).
3. **Seed cities:** Tel Aviv first, then London. London adds UK GDPR/ICO registration, the UK OSA assessment, UK VAT and UK consumer law (PRD go-to-market).

---

## 1. Applicability snapshot

| Regime | Applies? | Why | Key exposure |
|---|---|---|---|
| Apple App Store Review Guidelines | Yes | iOS app | 1.2 UGC, 3.1.x payments, 4.8 login, 5.1.1/5.1.2 privacy and data |
| Google Play policies | Yes | Android app | Background location, UGC, account deletion, Data safety form |
| EU GDPR / UK GDPR | Yes | Global launch includes EU and UK users | Location data, automated decisions (Art. 22), DPIA, representative (Art. 27) |
| ePrivacy Directive / PECR | Yes | Device storage and SDKs, marketing messages | Consent for non-essential SDKs and marketing push |
| EU Digital Services Act | Yes | Hosting service and online platform (public games, profiles, venue content, chat) | Art. 14/16/17/18/20/23/25/28. Small-enterprise exemption (Art. 19) covers only Section 3 |
| UK Online Safety Act 2023 | Yes ⚖️ | User-to-user service with UK users (London is a launch city). Minimum age is 18+, so the Children's Code largely falls away, but the children's-access assessment is still required | Illegal-harms risk assessment. Children's-access assessment (conclusion: not likely to be accessed by children, given age assurance) ⚖️ |
| Israel Privacy Protection Law + Amendment 13 (in force 14 Aug 2025) | Yes ⚖️ | Home market (Tel Aviv launch) and Israeli operating team, even though the contracting entity is foreign | DPO, location as "especially sensitive", database duties, security regulations |
| CCPA/CPRA and other US state privacy laws | Likely ⚖️ (thresholds) | US users | Precise geolocation is Sensitive PI, so Limit-Use applies. Opt-in for sensitive data in VA/CO/CT/TX etc. |
| COPPA (amended rule, compliance date Apr 2026) | Largely no longer applies | 18+ service worldwide, not child-directed | Keep the neutral age gate and delete on actual knowledge of an under-13 user (low residual exposure) |
| Australia Social Media Minimum Age (from Dec 2025) | Unlikely ⚖️ | The service is 18+, which is above the Australian minimum age of 16. Scope as an "age-restricted social media platform" matters only for the age-assurance duty | "Reasonable steps" age assurance, if in scope |
| PCI DSS v4.0.1 | Yes (SAQ A) | Card payments via Stripe (single global processor) | Never touch PAN |
| PSD2 SCA | Yes | EU/UK card payments | 3DS on SetupIntent |
| EU consumer law (CRD, UCTD), UK consumer law, Israeli Consumer Protection Law | Yes ⚖️ | Deposits and no-show fees | Clear pre-contract info, fairness of forfeiture |
| EU DAC7 | Ph2 | Hosts and trainers receive money through the platform | Seller due diligence and reporting |
| European Accessibility Act, IS 5568, ADA | Yes ⚖️ (EAA microenterprise exemption) | Consumer e-commerce service | WCAG 2.2 AA / EN 301 549 |
| EU AI Act | Limited | LLM moderation and machine translation, not high-risk | Transparency (Art. 50 from Aug 2026) |
| OpenStreetMap ODbL | Yes ⚖️ | Venue seed import | Attribution and share-alike of the derived database |

---

## 2. Compliance register

### 2.1 Apple App Store

| ID | Requirement | How Sport Talent satisfies it | Owner | Status |
|---|---|---|---|---|
| APL-01 | **1.2 UGC:** filter objectionable material | Client blocklist plus server omni-moderation and LLM classifier before delivery (CHAT-010). Venue and profile text filtered too | `fn:send-message`, `domain/moderation` | MVP |
| APL-02 | **1.2:** report mechanism with timely responses | Report from every user, message, game and venue (SAFE-001). Queue SLAs: P0 1h, standard 24–72h (MOD-002) | `app:report`, `mod-console`, `T&S` | MVP |
| APL-03 | **1.2:** block abusive users | Block with mutual effect (TRUST-047) | `db` (`blocks`), `app` | MVP |
| APL-04 | **1.2:** published contact information | Support and T&S contact in app, website and store listing (SAFE-002) | `legal`, `app:settings` | MVP |
| APL-05 | **1.2:** no random or anonymous chat | Chat exists only inside a game after host approval. No DMs (SAFE-003) | `db` RLS | MVP |
| APL-06 | **5.1.1(v):** in-app account deletion | Settings → Delete account (§8, ONB-009) | `fn:delete-account`, `db: delete_my_account` | MVP |
| APL-07 | **5.1.1(i):** privacy policy in-app and in App Store Connect | `legal/privacy`, linked from onboarding and settings | `legal` | MVP |
| APL-08 | **5.1.1 / 5.1.2(i):** don't require location (or push) to use the app | Manual city search. QR or host check-in without location (MAP-002). Notifications optional | `app:map`, `app:checkin` | MVP |
| APL-09 | **5.1.1(iii), 5.1.2(iv):** prefer pickers and don't build a contact database | OS contact picker only. No `NSContactsUsageDescription`. Nothing uploaded (GAME-033) | `app:invite` | MVP |
| APL-10 | **Purpose strings** for each permission | §5 below | `app` config | MVP |
| APL-11 | **Privacy manifest** (`PrivacyInfo.xcprivacy`, required-reason APIs) and **privacy nutrition labels** | Generated from the data inventory in §4. Third-party SDK manifests checked | `app` build | Ph1.5 |
| APL-12 | **4.8 login services** | MVP is phone OTP only, which triggers no 4.8 obligation. Adding Google or Facebook login means adding Sign in with Apple (ONB-003) | `app:auth` | MVP (rule) |
| APL-13 | **3.1.3(e):** physical services consumed outside the app must not use IAP | Deposits, court-fee collection and in-person training run through Stripe | `payments` | MVP / Ph2 |
| APL-14 | **3.1.3(d):** 1:1 real-time person-to-person services may use non-IAP. 1:few and 1:many must use IAP | Trainer marketplace: 1:1 video through Connect, group live classes and recorded programmes through IAP | `payments` | Ph3 |
| APL-15 | **3.1.1:** digital features (Pro, Host Pro, Boost) need IAP | RevenueCat for IAP. Web billing through Stripe. US-storefront link-out rules ⚖️ | `payments` | Ph2 |
| APL-16 | **2.5.4 / 5.1.1:** background location only for an appropriate purpose | "Always" requested only for the opt-in auto check-in wake-up, with clear value. Feature-flagged (TRUST-002) | `app:platform/geofence` | MVP (flag) |
| APL-17 | **App Attest** for integrity signals | Used as a risk signal only, never as the sole basis for a sanction | `app:platform`, `fn:checkin-verify` | MVP |
| APL-18 | **Age rating questionnaire** | Declare UGC and chat, with an 18+ audience (the highest age rating). Re-rate if live streaming or media lands | Org | Ph1.5 |

### 2.2 Google Play

| ID | Requirement | How satisfied | Owner | Status |
|---|---|---|---|---|
| GPL-01 | **Background location policy:** declaration form, demo video, prominent in-app disclosure, core-feature justification. "Attendance tracking" is likely rejected | **The MVP Android manifest omits `ACCESS_BACKGROUND_LOCATION`** (TRUST-003). Check-in is foreground-only, prompted by local notifications. Auto check-in is submitted later as an opt-in convenience feature with prominent disclosure (§5.2) ⚖️ | `app` manifest | MVP (omit). Ph1.5 (submit) |
| GPL-02 | **Foreground service types** (Android 14+) | No location foreground service: check-in is a short in-screen GPS read | `app:platform` | MVP |
| GPL-03 | **UGC policy:** report and block for users and content, ongoing moderation, terms that prohibit objectionable content | SAFE-001/004, CHAT-010, MOD-* | `app`, `mod-console`, `legal` | MVP |
| GPL-04 | **Account deletion**, both in-app and through a **web link** listed in Play Console | In-app flow plus a web page at `https://<domain>/account/delete` (OTP-authenticated) | `fn:delete-account`, `app:web` | MVP |
| GPL-05 | **Data safety form** | Completed from §4 | Org | Ph1.5 |
| GPL-06 | **User Data policy:** prominent disclosure before collecting sensitive data | Permission primers (ONB-007) with exact text from §5 | `app:onboarding` | MVP |
| GPL-07 | **Play Integrity API**, `Location.isMock()` | Risk signal only (TRUST-006) | `app:platform` | MVP |
| GPL-08 | **POST_NOTIFICATIONS** (Android 13+) runtime permission | Asked in context after a primer | `app` | MVP |
| GPL-09 | **Photo & Video Permissions policy** | When media launches, use the Android Photo Picker and no broad media permission | `app` | Ph3 |
| GPL-10 | **Payments policy:** physical-world services exempt from Play Billing. Digital goods use Play Billing | Same split as APL-13/15 | `payments` | MVP / Ph2 |
| GPL-11 | **Contacts:** no READ_CONTACTS | `ACTION_PICK` intent only | `app:invite` | MVP |

### 2.3 GDPR / UK GDPR

| ID | Requirement | How satisfied | Owner | Status |
|---|---|---|---|---|
| GDPR-01 | **Art. 5:** minimisation, storage limitation | Retention table (§4). Raw location deleted at 30 days. Chat purged at end+3h | `db` pg_cron | MVP |
| GDPR-02 | **Art. 6 lawful bases** ⚖️ | Contract: account, games, chat, check-in on user action. Legitimate interest: trust and safety, fraud, sanctions (LIA documented). Consent: auto check-in background location, analytics SDKs, marketing, coarse-location ads (Ph3). Legal obligation: payments records, law-enforcement requests | `legal` | MVP |
| GDPR-03 | **Art. 8:** child consent age 13–16 | **Largely no longer applicable:** the minimum age is 18+ worldwide (`trust_config.min_age_years`, default 18; `TrustConfig.minAgeYears` / `MIN_AGE_YEARS`), so no parental-consent flow is needed (ONB-004). Residual: users who misstate their age (SAFE-011 deletion path) ⚖️ | `app:age-gate` | MVP |
| GDPR-04 | **Art. 9:** special categories | We collect no health data in the MVP. Gender (for women-only games) is not Art. 9 data but is treated as sensitive: optional, private, single purpose. Ph3 nutrition and trainer data may involve health data, so a DPIA addendum applies | `db` (`profile_private`) | MVP |
| GDPR-05 | **Art. 12–14 transparency** | Layered privacy notice in 13 locales (legal text needs native review). Just-in-time primers | `legal`, `i18n` | MVP |
| GDPR-06 | **Art. 13(2)(f) / 15(1)(h):** meaningful information about the logic of automated decisions | Public Trust Charter with thresholds and formulas (PRD Appendix A). A reliability breakdown on tap (TRUST-034) | `legal`, `app:profile` | MVP |
| GDPR-07 | **Art. 15–21 rights** | Access and export (ONB-010), rectification (profile edit), erasure (§8), objection (privacy settings and support), restriction (support). Response within 1 month | `fn:export`, `fn:delete-account`, Org | MVP |
| GDPR-08 | **Art. 22:** solely automated decisions with legal or similarly significant effects. Users have the right to human intervention, to express their view and to contest (22(3)) | Automated measures are temporary and reversible only: cards, 7- and 30-day bans, 72h restriction, 24h mute. **Every one is contestable** through the appeal path (human review within 72h). **Permanent bans and host revocations are human-only** (TRUST-025/053). Whether 30-day bans count as "similarly significant" ⚖️ is covered by the human-review appeal either way | `domain/trust`, `mod-console` | MVP |
| GDPR-09 | **Art. 25:** privacy by design and by default | Hidden exact location until approval, no location in analytics, opt-in auto check-in | All | MVP |
| GDPR-10 | **Art. 27 EU representative** (if the controller is not established in the EU), and a UK representative | Appoint before EU/UK launch ⚖️ | Org | Ph1.5 |
| GDPR-11 | **Art. 28 processor agreements** | DPAs with every processor in §3 | Org | Ph1.5 |
| GDPR-12 | **Art. 30 records of processing (ROPA)** | Derived from §4 | Org | Ph1.5 |
| GDPR-13 | **Art. 32 security** | NFR-020…027: RLS, encryption, MFA for moderators, pen test | `db`, Platform | MVP |
| GDPR-14 | **Art. 33/34 breach notification within 72h** | Incident runbook. Israeli Data Security Regulations notification in parallel | Org | Ph1.5 |
| GDPR-15 | **Art. 35 DPIA (required)**: systematic location processing, automated trust decisions, potentially large scale | DPIA outline in §11. Finalise before public launch | Compliance | Ph1.5 |
| GDPR-16 | **Art. 37 DPO**: likely required (core activity of regular, systematic monitoring at scale) ⚖️ | Appoint one DPO for GDPR and Amendment 13 | Org | Ph1.5 |
| GDPR-17 | **Chapter V transfers** | Israel has an EU adequacy decision (reaffirmed 2024). US processors through the EU-US Data Privacy Framework or SCCs, with TIAs. EU region selected for Supabase ⚖️ | Org, Platform | Ph1.5 |
| GDPR-18 | **UK Age Appropriate Design Code** (applies to services likely to be accessed by under-18s) | Not likely to be accessed by children given the 18+ rule and age assurance (see OSA-03). Keep high-privacy defaults and no nudge techniques toward weaker privacy as good practice. Counsel to confirm ⚖️ | `app`, `db` | MVP |

### 2.4 ePrivacy / PECR and marketing

| ID | Requirement | How satisfied | Owner | Status |
|---|---|---|---|---|
| EPR-01 | Consent before non-essential device storage or SDKs (analytics, crash with PII, ads) | Crash reporting without PII is strictly necessary (counsel ⚖️). Product analytics load after consent in the EEA and UK. Web cookie banner with Reject on equal footing | `app`, `legal` | MVP |
| EPR-02 | Marketing communications need opt-in (EU, UK PECR, Israel Communications Law §30A, US CAN-SPAM/TCPA) | Transactional push (game, trust, payment) is separate from marketing (coupons, promotions), which is opt-in per channel. OTP SMS is transactional | `app:settings`, `fn:push-dispatch` | MVP (split). Ph3 (marketing) |

### 2.5 EU Digital Services Act

| ID | Article | Requirement | How satisfied | Owner | Status |
|---|---|---|---|---|---|
| DSA-01 | Art. 11–12 | Points of contact for authorities and users | Email and in-app form, published in T&C | Org, `legal` | MVP |
| DSA-02 | Art. 13 | Legal representative in the EU if not established there | Appoint ⚖️ (can coincide with the GDPR Art. 27 representative, subject to counsel) | Org | Ph1.5 |
| DSA-03 | **Art. 14** | T&C in clear language covering restrictions, moderation policies and tools, **algorithmic decision-making**, human review and the complaint system. Plain language | Community Guidelines plus the Trust Charter (thresholds, ladder, appeal). Teen-readable summary | `legal` | MVP |
| DSA-04 | Art. 15 | Transparency reports | Micro and small enterprises are exempt (Art. 15(2)). Metrics are built anyway (MOD-007) | `mod-console` | Ph2 |
| DSA-05 | **Art. 16** | Notice-and-action: an easy electronic mechanism, with substantiated notices that include an explanation, location (URL or ID), name and email (optional for certain offences) and a good-faith statement. Confirm receipt and inform of the decision | Report flow (TRUST-040) for in-app users. **A public web form for non-users** (e.g. a venue owner, or an illegal-content notice) at `/report`. Auto-acknowledgement, and notification of the decision including whether automated means were used | `app:report`, `app:web`, `mod-console` | MVP |
| DSA-06 | **Art. 17** | **A statement of reasons** for any restriction of visibility (incl. demotion), removal, suspension or termination of service or account, or monetary restriction. **A shadowban without notice is non-compliant** | Every sanction, content removal, venue hide and chat block creates an SoR (§6). The v4 shadowban is replaced with a notified 72h restriction (TRUST-043) | `domain/trust`, `db: sanctions.statement_of_reasons` | MVP |
| DSA-07 | Art. 18 | Notify law enforcement of suspected criminal offences involving a threat to life or safety | Escalation procedure (§10, MOD-009) | `T&S`, Org | MVP |
| DSA-08 | Art. 19 | Small-enterprise exemption from Section 3 (Art. 20–28) | Monitor headcount and turnover. We **build Art. 20, 23, 25 and 28 anyway** (store rules plus scaling) | Org | — |
| DSA-09 | **Art. 20** | Internal complaint system, open for **at least 6 months** after a decision. Timely, non-discriminatory, diligent. **Decisions not solely automated** (20(6)) and supervised by qualified staff | Appeals (UX-50) are available for 6 months on every decision (the 48h card window only governs escalation counting). Human decision with templated reasons | `app:sanctions`, `mod-console` | MVP |
| DSA-10 | Art. 21 | Inform users about out-of-court dispute settlement bodies | Included in the SoR redress section ⚖️ (list certified bodies) | `legal` | MVP |
| DSA-11 | **Art. 23** | Suspend users who frequently provide manifestly illegal content, and notifiers who frequently submit manifestly unfounded notices, after a warning | Ladder plus reporter-accuracy de-qualification (TRUST-046), with warning notices | `domain/trust` | MVP |
| DSA-12 | Art. 24(3), 24(5) | MAU on request. Submit SoRs to the Commission transparency database (Section 3, small enterprises exempt) | MAU computed. SoR export to the transparency database is prepared but disabled until the exemption ends | `db`, `mod-console` | Ph2 |
| DSA-13 | Art. 25 | No dark patterns | Equal-weight decline buttons, no forced opt-ins (PRD 7.4) | `app` | MVP |
| DSA-14 | Art. 26 | Ad transparency (label, advertiser, main targeting parameters). No ads based on profiling with special-category data | "Promoted" label on Boost. Ad info sheet. Ads are restricted to 18+ users (everyone) | `app` | Ph2 / Ph3 |
| DSA-15 | Art. 27 | Recommender-system transparency | T&C explain map ranking (time, distance, filters, Boost label) | `legal` | MVP |
| DSA-16 | Art. 28 | Minors: a high level of privacy, safety and security. **No profiling-based ads to minors** | Minimum age is 18+ worldwide, so the Art. 28 duty is largely not triggered. The age gate and SAFE-011 (suspected under-18 account removal) remain the controls. No profiling-based ads in any case ⚖️ | `app`, `db` | MVP |

### 2.6 UK Online Safety Act 2023 and Ofcom codes ⚖️

| ID | Requirement | How satisfied | Owner | Status |
|---|---|---|---|---|
| OSA-01 | Illegal content risk assessment (user-to-user service) | Document an assessment of chat, profiles and venue content (harassment, threats, CSAM, fraud). Review annually | Compliance | Ph1.5 |
| OSA-02 | Illegal content safety duties: proportionate systems, swift takedown, reporting and complaints | CHAT-010/020, MOD-*, appeals | `T&S` | MVP |
| OSA-03 | **Children's access assessment:** without *highly effective age assurance* (HEAA), a service must assess whether children (**under 18**) are likely to access it | Minimum age is 18+ worldwide. Record the assessment with the conclusion **"not likely to be accessed by children"**, given age assurance (self-declared birth month/year, neutral gate, 24h device soft lock, SAFE-011 removal of suspected under-18s, 18+ app-store rating, no child-appealing content). Self-declaration is not HEAA, so **counsel must review the strength of the age assurance** and whether stronger assurance (e.g. a third-party age check, or Apple/Google age signals, MIN-04) is advisable for the UK before the London launch ⚖️ | Compliance | Ph1.5 |
| OSA-04 | Child safety duties (protect from primary-priority and priority content, age-appropriate design) | Apply only if the assessment concludes that children are likely to access the service. At 18+ they are not expected to. Keep the controls that remain useful anyway: moderated chat, no DMs and no media in the MVP, report and block. If counsel concludes that the age assurance is too weak, either add stronger age assurance for UK users or run the children's risk assessment (a fallback plan, not the current decision) | Product, Compliance | Ph1.5 |
| OSA-05 | Terms of service and user reporting/complaints duties | Same mechanisms as DSA-03/05/09 | `legal` | MVP |

### 2.7 Israel

| ID | Requirement | How satisfied | Owner | Status |
|---|---|---|---|---|
| ISR-01 | **PPL Amendment 13 (14 Aug 2025):** expanded definitions. Location data is understood to be within "especially sensitive information" ⚖️ | Location is minimised (window-only, 30-day raw retention, no sharing) and documented in the database definition document | Compliance | MVP |
| ISR-02 | **DPO appointment** where core activities involve systematic monitoring at scale or large-scale especially sensitive data ⚖️ | Appoint one DPO (shared with GDPR-16) | Org | Ph1.5 |
| ISR-03 | **Database notification / registration and a database definition document** under the amended thresholds ⚖️ | Prepare the database definitions document (purposes, data types, transfers, access) | Org | Ph1.5 |
| ISR-04 | **Privacy Protection (Data Security) Regulations 2017**: security level, access control, logging, incident reporting | Classify the database (likely medium/high), with access logs (`audit_log`), annual risk survey and pen test | Platform, Org | Ph1.5 |
| ISR-05 | **Duty to inform (§11)** at collection | Privacy notice in Hebrew and Arabic, plus primers | `legal` | MVP |
| ISR-06 | **Communications Law §30A** (anti-spam) | Marketing push, SMS and email are opt-in only (EPR-02) | `fn:push-dispatch` | MVP (rule) |
| ISR-07 | **Consumer Protection Law:** disclosure for distance transactions. Cancellation rights and leisure exceptions ⚖️ | Pre-join deposit disclosure (TRUST-067). Counsel to confirm the cancellation-regulation exceptions for dated leisure services | `legal`, `payments` | MVP |
| ISR-08 | **Equal Rights for Persons with Disabilities (Service Accessibility) Regs, IS 5568** | WCAG 2.2 AA (superset). Accessibility statement and coordinator contact | `app`, `legal` | MVP |
| ISR-09 | **Women-only games:** the Prohibition of Discrimination in Products and Services Law has exceptions for separation justified by the nature of the service ⚖️ | Optional, host-chosen. Rationale documented as a safety measure | `legal` | MVP |
| ISR-10 | **Payments:** Stripe does not open merchant accounts for Israeli companies, so the merchant of record is a **foreign entity (US/EU/UK)** that serves Israeli users through Stripe as well (cards, Apple Pay, Google Pay). Bit and an Israeli local PSP are an interface stub, deferred (ADR 0006). Israeli VAT on digital services supplied by the foreign entity to Israeli consumers (PAY-11). Licensed payment-service rules if we ever hold funds ⚖️ | Merchant-of-record model, no stored value (TRUST-063). Connect payouts deferred (MON-002); local PSP deferred | `payments`, Org | MVP |

### 2.8 United States: CCPA/CPRA and state privacy laws ⚖️

| ID | Requirement | How satisfied | Owner | Status |
|---|---|---|---|---|
| US-01 | **CPRA:** precise geolocation (within a 1,850 ft radius) is Sensitive PI, which brings the **right to limit use** | Precise location is used only for user-requested check-in (a permitted purpose). No secondary use. "Limit the Use of My Sensitive Personal Information" control in privacy settings (and the notice) | `app:settings`, `legal` | MVP |
| US-02 | **Do Not Sell or Share**, and honour Global Privacy Control | No selling or sharing in the MVP (no ads SDKs). GPC is honoured on web. The link is added if Ph3 ads ever involve sharing | `app:web` | MVP / Ph3 |
| US-03 | Notice at collection, privacy policy with CPRA categories, 12-month look-back | Privacy policy, US section | `legal` | MVP |
| US-04 | CPPA regulations (risk assessments for processing Sensitive PI, ADMT rules) effective 2026 ⚖️ | Risk assessment re-uses the DPIA. ADMT "significant decision" scope is likely not met (no financial, housing, employment or healthcare decisions), but confirm | Compliance | Ph1.5 |
| US-05 | **VA/CO/CT/TX/OR and other state laws:** opt-in consent for sensitive data, including precise geolocation | The location permission is OS-level opt-in, plus an in-app primer that states the purpose. Auto check-in has a separate opt-in | `app` | MVP |
| US-06 | Washington My Health My Data Act ⚖️ | Not triggered in the MVP (no health data). Reassess for Ph3 nutrition and trainers | Compliance | Ph3 |

### 2.9 Age rules (COPPA, international age rules). Minimum age 18+ worldwide

| ID | Requirement | How satisfied | Owner | Status |
|---|---|---|---|---|
| MIN-01 | **COPPA** (amended rule, compliance since Apr 2026): don't knowingly collect from under-13s. A general-audience service with actual knowledge must delete | **Largely no longer applicable** at 18+. Keep the 18+ neutral age gate (ONB-004; `trust_config.min_age_years`, default 18; `TrustConfig.minAgeYears` / `MIN_AGE_YEARS`). Suspected-underage flags lead to deletion (SAFE-011). No child-directed content or marketing | `app:age-gate`, `T&S` | MVP |
| MIN-02 | Neutral age screening (no prompts that encourage lying, no default age) | Month and year pickers with no default and no hint | `app:age-gate` | MVP |
| MIN-03 | **Australia SMMA** (from 10 Dec 2025) ⚖️ | The service is 18+, above the Australian minimum age of 16, so the main risk is only whether "reasonable steps" age assurance must be stronger than self-declaration. Assess before AU marketing | Compliance | Ph1.5 |
| MIN-04 | **US state app-store and age-signal laws** (e.g. Utah, Texas) ⚖️ | Integrate Apple Declared Age Range and Google Play Age Signals APIs where the law requires it. Treat signals as additive to the age gate | `app:platform` | Ph1.5 |
| MIN-05 | **Live streaming and media:** everyone is 18+, so no age-based carve-out is needed. Consent rules for filming and tagging still apply | Deferred-phase rule (MEDIA-003/004) | — | Ph4 |
| MIN-06 | **Age-assurance strength** (self-declared birth month/year plus a 24h device soft lock) ⚖️ | Counsel review flag: is this enough for the UK OSA (OSA-03), Australia (MIN-03) and US state age-signal laws (MIN-04)? Consider stronger age assurance for the UK (e.g. a third-party check or platform age signals). Keep birth month/year only, no ID storage by default | Compliance, Product | Ph1.5 |

### 2.10 Payments

| ID | Requirement | How satisfied | Owner | Status |
|---|---|---|---|---|
| PAY-01 | **PCI DSS v4.0.1, SAQ A** | Card data only in Stripe-hosted components (Stripe Elements / Payment Element on web, PaymentSheet on native). No PAN in logs. CSP and script-integrity review on the payment page | `payments`, `app:web` | MVP |
| PAY-02 | **PSD2 SCA** | SetupIntent with 3DS at join. Holds created off-session at T−24h with mandate. Handle `requires_action` by asking the user to authenticate (TRUST-064) | `payments` | MVP |
| PAY-03 | Webhook authenticity, idempotency | Signature verification. Idempotency keys `deposit:{participant_id}` | `fn:payments-webhook` | MVP |
| PAY-04 | **Deposit forfeiture fairness** (EU Unfair Contract Terms Directive, UK Consumer Rights Act, Israeli Standard Contracts Law, US state consumer law) ⚖️ | Optional and low amount ($2–$20 equivalent). Disclosed before join. Captured only after the 48h dispute window. Refunded if overturned. No capture when the game didn't happen or the spot was refilled | `payments`, `legal` | MVP |
| PAY-05 | **Consumer withdrawal right:** CRD Art. 16(l) exempts leisure services for a specific date ⚖️ | Rely on the exemption. Confirm per market | `legal` | MVP |
| PAY-06 | **Merchant of record and money transmission:** don't hold user funds | MVP: the foreign entity (US/EU/UK) is the merchant of record and captures forfeits through Stripe, with no wallet or stored value. Ph2: Stripe Connect Express (Stripe holds the licences and does KYC) | `payments` | MVP / Ph2 |
| PAY-07 | **DAC7 / platform reporting** of sellers (hosts collecting court fees, trainers) | Collect TIN and address in Connect onboarding. Annual reporting | `payments`, Org | Ph2 |
| PAY-08 | Chargeback evidence | Auto-submit check-in log, accepted terms and SoR | `fn:payments-webhook` | MVP |
| PAY-09 | **Sanctions screening / restricted countries** | Stripe screening. Block sign-up from comprehensively sanctioned jurisdictions ⚖️ | `payments`, Org | Ph1.5 |
| PAY-10 | **Single global processor and entity (owner decision):** incorporate a foreign entity (US/EU/UK) and use Stripe for all markets, **including Israeli users** (cards, Apple Pay, Google Pay via Stripe). Bit and the Israeli local PSP stay an interface stub (`LocalPspProvider`), deferred to a later phase (ADR 0006) | **For counsel and the accountant:** choose the entity jurisdiction (tax residency, CFC and permanent-establishment exposure for Israeli founders, transfer pricing with any Israeli operating company, IP ownership); confirm Stripe supports it; statement descriptor and Hebrew support for Israeli cardholders ⚖️ | Org, `payments` | Ph1.5 |
| PAY-11 | **VAT/GST registration** | **For the accountant:** UK VAT (London deposits, fees and digital services); EU One-Stop Shop (OSS) for B2C digital services; **Israeli VAT on digital services supplied by a foreign entity to Israeli consumers** (non-resident supplier registration); other markets as thresholds are crossed (Stripe Tax). Check the VAT treatment of forfeited deposits versus refunded deposits ⚖️ | Org | Ph1.5 |
| PAY-12 | **Stripe Connect for the future trainer marketplace** (Ph3) | The foreign entity is the Connect platform account. Express onboarding, KYC and DAC7 data (PAY-07). Confirm cross-border payout coverage for Israeli and UK trainers, and the liability model ⚖️ | `payments`, Org | Ph2 / Ph3 |

### 2.11 Accessibility, AI and data licensing

| ID | Requirement | How satisfied | Owner | Status |
|---|---|---|---|---|
| ACC-01 | **EAA** (from 28 Jun 2025) for consumer e-commerce services. EN 301 549 ≈ WCAG 2.1 AA (we target 2.2 AA). Microenterprise exemption ⚖️ | NFR-050…058. Accessibility statement | `app`, `legal` | MVP |
| ACC-02 | ADA (US) | Same target | `app` | MVP |
| AI-01 | **EU AI Act Art. 50** transparency (from Aug 2026) | "Translated automatically" label (CHAT-031). Moderation is disclosed in T&C. No AI-generated content presented as human | `app:chat`, `legal` | MVP |
| AI-02 | LLM vendor data use | Zero-retention or no-training terms with OpenAI and Anthropic. Send only message text plus minimal context, no user identifiers | `fn:send-message`, Org | MVP |
| LIC-01 | **ODbL** for OSM-derived venues ⚖️ | "© OpenStreetMap contributors" attribution on map and venue pages. Keep the OSM-derived layer separable. Counsel to assess share-alike for user-enriched data | `db`, `legal` | MVP |
| LIC-02 | Map tiles terms (MapTiler, Stadia, OpenFreeMap) | Attribution and usage caps per the provider's terms | `app:map` | MVP |

---

## 3. Processors and sub-processors (MVP)

| Processor | Purpose | Data | Region / transfer | Notes |
|---|---|---|---|---|
| Supabase | DB, auth, realtime, functions, storage | All service data | EU region preferred. DPA | Core |
| OTP provider (e.g. Twilio Verify, MessageBird) | SMS / WhatsApp OTP | Phone number | DPF/SCCs | Fraud guard on |
| Stripe | Payments, holds (single global processor, Israel included), Connect (Ph2), Tax | Payment and billing data, name, email | DPF/SCCs | Independent controller for some purposes ⚖️ |
| Israeli PSP (PayPlus / Grow-Meshulam, TBD) | IL cards, Bit | Payment data | IL | **Deferred.** Interface stub only (ADR 0006). No contract, no data flows. Add to this register if a later phase enables it |
| OpenAI (omni-moderation) | Chat moderation | Message text | US. DPF/SCCs | Zero-retention terms ⚖️ |
| Anthropic (`claude-haiku-5-5`) | Contextual moderation, slang translation fallback | Message text plus ≤5 prior messages | US. SCCs | No-training terms |
| Google Cloud Translation / DeepL | Chat translation | Message text | US/EU | DeepL EU-hosted |
| Map tile provider | Map tiles | IP, viewport (no user ID) | EU/US | |
| Expo / APNs / FCM | Push delivery | Push token, notification payload (minimal text) | US | |
| Sentry | Crash and performance | Pseudonymous ID, device data. PII scrubbing | EU region | |
| Analytics (TBD, EU-hosted e.g. PostHog EU) | Product analytics | Pseudonymous events, city/H3-r6 | EU | Consent-gated in EEA/UK |

---

## 4. Data inventory and retention

| Data category | Examples | Purpose | Lawful basis (GDPR) | Retention | Deletion method | Visible to |
|---|---|---|---|---|---|---|
| Account identifiers | Phone (E.164), auth ID | Login, anti-abuse | Contract | Account life | Hard-deleted on account deletion. A **keyed HMAC** of the phone is kept only while a sanction record is retained (ban-evasion check) ⚖️ | User |
| Age data | Birth month and year | Age gate (minimum 18, `trust_config.min_age_years`) | Legal obligation / LI | Account life | Deleted with the account | System only |
| Gender (optional) | Woman / man / non-binary / undisclosed | Women-only eligibility | Consent (explicit, optional) | Until changed or the account is deleted | Deleted | System only |
| Public profile | Display name, sports, positions, level, avatar initials | Matching, teams | Contract | Account life | Deleted. Historical references become "Former member" | Public / participants |
| **Raw location samples** | lat/lng, accuracy, timestamp, integrity flags | Check-in verification | Contract (user-initiated). Consent for auto check-in | **30 days** | pg_cron purge | System, moderators (accuracy and distance only, no maps of movement) |
| Check-in outcome | method, verified/not, game ID | Attendance, reliability | Contract / LI | Account life (history). Reliability uses 90 days | Pseudonymised on deletion | User, host (for that game) |
| Wake-up geofence registrations | region IDs on device | Auto check-in | Consent | On device until game end + 2h | OS unregister | Device only |
| Map search viewport | center, radius | Return results | Contract | **Not stored** (request-scoped). Server logs 30 days without coordinates beyond 2 decimals | — | — |
| Games and participation | Created games, join status, waitlist, teams, results | Core service | Contract | Account life. Games are kept for the venue history | Participant rows pseudonymised on deletion | Participants / public (public games) |
| **Chat messages** | text, sender, game | Coordination | Contract | **ends_at + 3h** | pg_cron hard delete | Approved participants |
| Message translations | translated text per language | Translation | Contract | With the parent message (end + 3h) | Cascade | Participants |
| **Retained flagged messages** | reported, blocked or recheck-removed messages plus classifier output | Abuse handling, appeals, legal | LI / legal obligation | **90 days**. Extended while an appeal is open or under legal hold | pg_cron `purge_retained` | Moderators |
| Moderation decisions (classifier) | category, scores, decision | QA, FP measurement | LI | 90 days (non-retained: aggregate only) | Purge | Moderators |
| User reports | reporter, target, category, text | T&S | LI | 12 months. Reporter pseudonymised afterwards. Linked to a sanction → follows the sanction rule | Purge / pseudonymise | Moderators (reporter identity never shown to the target) |
| **Sanctions and appeals** | kind, reason, SoR, timestamps, decider | Enforcement, DSA/GDPR accountability, ban evasion | LI / legal obligation | **Account life + 2 years, pseudonymised** after account deletion | Pseudonymise (HMAC subject ID) | User (own), moderators |
| Reliability score | derived % | Trust | LI | Recomputed. Not stored beyond the current value and 90-day inputs | Deleted with the account | Public (on profile) |
| Host and venue ratings | stars, tags | Quality | LI | Indefinite, anonymised after rater deletion | Anonymise | Public (aggregate) |
| Venue reports and additions | venue edits | Map quality | LI | 24 months | Anonymise | Moderators |
| Blocks | blocker, blocked | Safety | LI | Account life (of either party) | Deleted when either account is deleted | Blocker |
| Push tokens | device token | Notifications | Contract | Until invalid, logout or deletion | Delete | System |
| Payment records | intents, captures, refunds, receipts (no PAN) | Accounting, tax, disputes | Legal obligation | **7 years** (IL/EU tax norms ⚖️) | Kept pseudonymised after account deletion | User, finance |
| Saved payment methods | Stripe token reference | Deposits | Contract | Until removed or the account is deleted | Detach at Stripe | User |
| QR secrets, invite tokens | HMAC secret, token | Check-in, invites | Contract | QR: game end + 24h. Invite: until rotated or the game/series ends | Purge | Host |
| Audit log | moderator and admin actions, content views | Accountability | LI / legal obligation | 2 years | Purge | Admins |
| Device integrity signals | Play Integrity / App Attest verdicts, mock flags | Anti-spoofing | LI | 30 days (flags summarised into a risk counter) | Purge | System, moderators |
| Analytics events | pseudonymous events, city/H3-r6 | Product improvement | Consent (EEA/UK) / LI | 13 months | Provider TTL | Product team |
| Server and app logs | request logs (no bodies, no PII) | Ops, security | LI | 30 days | TTL | Engineers |
| Backups | full DB | DR | LI | 30 days rolling | Expiry (deleted data disappears from backups within 30 days) | Ops |
| Support tickets | email, conversation | Support | Contract / LI | 24 months after closure | Purge | Support |
| Data export files | JSON bundle | Art. 15/20 | Legal obligation | Download link valid 7 days | Delete | User |

**Retention principles**
- The shortest retention that still serves the purpose.
- Every purge job is idempotent and monitored (NFR-013).
- Legal hold overrides purge only for specific records, with an audit entry.

---

## 5. Permission purpose strings (source English; localised into 13 locales, native review required)

### 5.1 iOS (`Info.plist`)

| Key | String | When requested |
|---|---|---|
| `NSLocationWhenInUseUsageDescription` | "Sport Talent uses your location to show games and courts near you and to confirm your check-in when you arrive at a game. You can always search by city instead." | First tap on "Near me" or the first check-in, after a primer |
| `NSLocationAlwaysAndWhenInUseUsageDescription` | "Optional: allow 'Always' so Sport Talent can remind you to check in when you get near a game you joined. We only watch the area around your upcoming games (up to 3) and never track your route. You can check in manually without this." | Only when the user turns on **Auto check-in** in Settings (feature flag) |
| `NSCameraUsageDescription` | "Sport Talent uses the camera to scan the host's check-in QR code at the game." | First QR scan |
| *(Notifications, no plist key)*. In-app primer text | "Get notified when the host approves you, when a spot opens on the waitlist, and when it's time to check in. You choose which alerts you get in Settings." | After the first join request or game creation |
| *(No `NSContactsUsageDescription`)* | Uses `CNContactPickerViewController`, which needs no permission | — |
| *(No photo library key in the MVP)* | Added with the media phase (Ph3), using PHPicker | — |

### 5.2 Android

| Permission | MVP? | Prominent in-app disclosure (shown before the system dialog) |
|---|---|---|
| `ACCESS_COARSE_LOCATION` + `ACCESS_FINE_LOCATION` | Yes | "Sport Talent uses your location to show nearby games and courts and to confirm your check-in when you tap Check in at a game. Location is used only while you use the app. You can search by city instead." |
| `ACCESS_BACKGROUND_LOCATION` | **No** (not in the MVP manifest. Submit to Play at Ph1.5) | "Auto check-in (optional): Sport Talent collects location data in the background, only near the courts of games you've joined, starting 2 hours before each game, to remind you to check in, even when the app is closed or not in use. We don't track your route and we delete raw location data after 30 days. Turn off any time in Settings." *(Google requires the wording "collects location data … even when the app is closed or not in use.")* |
| `CAMERA` | Yes | "The camera is used only to scan the host's check-in QR code." |
| `POST_NOTIFICATIONS` (13+) | Yes | Same as the iOS notification primer |
| `READ_CONTACTS` | **Never** | — (ACTION_PICK intent) |
| `FOREGROUND_SERVICE_LOCATION` | **No** | — |

### 5.3 Web
- **Browser geolocation:** the same primer as when-in-use.
- **Camera (QR):** `getUserMedia` with a primer.
- **Web push:** opt-in from settings only, never on page load.

---

## 6. Statement of Reasons (SoR) template: DSA Art. 17 and GDPR Art. 22 aligned

**Data model:** `sanctions.statement_of_reasons` (JSONB), also used for content removals and venue hides. Rendered in the user's locale with ICU (legal text needs native review).

| # | Field | Type / values | DSA ref | Example (EN) |
|---|---|---|---|---|
| 1 | `decision_id` | UUID (shown short) | — | `SR-7F3A-21C9` |
| 2 | `decision_type` | `yellow_card`, `join_ban`, `visibility_restriction`, `chat_mute`, `host_suspension`, `content_removal`, `content_hidden_pending_review`, `venue_hidden`, `permanent_ban`, `overturn` | 17(3)(a) | "Temporary visibility restriction" |
| 3 | `scope` | What exactly is restricted (discovery, join public games, chat, hosting) and the territorial scope (global) | 17(3)(a) | "You won't appear on the map or in search and can't join public games. Games you're already in are unaffected." |
| 4 | `starts_at` / `expires_at` | ISO + localised | 17(3)(a) | "Until Thu 29 Oct, 18:40 (your time)" |
| 5 | `facts_and_circumstances` | Templated facts: trigger, game reference, date and evidence type. **Never reporter identities** | 17(3)(b) | "3 players from 2 different games reported harassment between 12–25 Oct." |
| 6 | `notice_based` | bool + notice category (Art. 16) | 17(3)(b) | "Based on user reports." |
| 7 | `automated_detection` | bool | 17(3)(c) | "Content was detected by an automated filter." |
| 8 | `automated_decision` | bool + `human_review_status` (`pending` / `completed`) | 17(3)(c). GDPR 22(3) | "This decision was made automatically and will be reviewed by a person within 72 hours." |
| 9 | `ground_type` | `terms` / `illegal_content` | 17(3)(d)(e) | `terms` |
| 10 | `ground_reference` | Guideline section ID and link. If illegal content: the legal ground | 17(3)(d)(e) | "Community Guidelines §3.2 – Respect" |
| 11 | `explanation` | Plain-language why the ground applies | 17(3)(e) | "Repeated reports of harassment break our Respect rule." |
| 12 | `consequences_if_repeated` | Next ladder step | (Art. 23 warning) | "Another card within 30 days leads to a 7-day join ban." |
| 13 | `redress.internal_appeal` | Deep link, deadline (48h for card escalation counting; any decision appealable for 6 months) | 17(3)(f). Art. 20 | "Appeal in the app – Sanctions & Appeals" |
| 14 | `redress.out_of_court` | Link to the certified ODS bodies list | 17(3)(f). Art. 21 | — |
| 15 | `redress.judicial` | Statement of the right to judicial redress | 17(3)(f) | — |
| 16 | `deposit_effect` | none / hold captured / refunded | — | "Your €5 deposit will be captured on 27 Oct unless you appeal." |
| 17 | `issued_at`, `locale`, `template_version` | — | — | — |

**Delivery**
- In-app (the Sanctions & Appeals center, not dismissible), push, and email if one is on file.
- The SoR must be created **at the latest when the restriction takes effect** (Art. 17(1)).
- Exception: notice is withheld only where law enforcement requests it, or where it would compromise a serious-harm investigation, with an audit entry ⚖️.

---

## 7. Appeals and internal complaint handling (DSA Art. 20, GDPR Art. 22(3))

| Step | Rule |
|---|---|
| Eligibility | Any decision in §6, **for 6 months** after notification. Cards also have the 48h window that freezes escalation counting (TRUST-022) |
| Submission | In-app or on web. Category plus free text (≤2,000 chars) plus optional evidence (screenshot in Ph2). Available in 13 locales |
| Acknowledgement | Immediate in-app plus push |
| Decision maker | A **qualified human moderator**, never solely automated (Art. 20(6)). Permanent bans need a senior moderator plus a second reviewer (four-eyes) |
| SLA | 72h for restrictions and cards. 24h for chat mutes. 7 days max. A card appeal not decided within 7 days is **auto-voided** (TRUST-023) |
| Outcome notice | New SoR (`overturn` or upheld) with reasons and next redress options (ODS, courts) |
| Effects of an overturn | Immediate lift. Deposit not captured or refunded. Reliability recalculated. Reporters' accuracy updated. 14-day protection from re-automation (TRUST-048) |
| Abuse | 3 appeals in 90 days are fine. After that, appeals remain available but without auto-void |
| QA | 5% of decisions double-reviewed weekly. Overturn rate monitored (guardrail below 5% wrongful sanctions) |

---

## 8. Account deletion behaviour (Apple 5.1.1(v), Google Play, GDPR Art. 17)

**Entry points**
- App: Settings → Account → Delete account.
- Web: `https://<domain>/account/delete` (Play requirement), OTP-authenticated.

**Flow**
1. Re-authenticate with OTP.
2. A screen explains what is deleted, what is kept (pseudonymised) and the effects on upcoming games.
3. Optional data export offer.
4. Explicit confirmation ("Delete my account").
5. Confirmation screen, plus an email if one is on file.

**No retention-by-obstruction.** Deletion cannot be blocked by an active sanction, open deposit or upcoming game.

| Timing | Action |
|---|---|
| **Immediately (T0)** | Sign out all sessions and revoke push tokens. Profile hidden everywhere. Removed from all future games and waitlists (no card, even if within 2h). Hosts and participants notified "a player left". **Hosted future games:** transferred to a co-host if one exists. Otherwise cancelled, with participants notified and all holds released. Pending deposit holds **released**. Open join requests withdrawn. Active chat messages from the user replaced with "Deleted user" and purged on the normal schedule. Open appeals closed |
| **≤ 24h (purge job)** | Hard delete: phone, birth data, gender, profile, push tokens, blocks, saved payment-method references (detached at Stripe), raw location samples, preferences, export files. Ratings and reviews written by the user are anonymised ("Former member"). Participation rows are pseudonymised (kept so venue and game history stays coherent) |
| **Retained (pseudonymised)** | **Sanctions and appeals: account life + 2 years**, keyed to an HMAC of the subject ID, plus an HMAC of the phone number to detect ban evasion while the record exists ⚖️. **Payment records: 7 years** (legal obligation). **Retained flagged messages:** until their 90-day expiry, or longer under legal hold. **Audit log:** 2 years |
| **≤ 30 days** | Deleted data ages out of backups |
| Re-registration | Allowed with the same phone. If a pseudonymised active sanction matches the phone HMAC, the remaining sanction period is re-applied, with a notice ⚖️ |

**Acceptance criterion.**
- **Given** a user with an upcoming hosted game (no co-host), a deposit hold on another game, and an active 7-day join ban;
- **When** they confirm deletion;
- **Then** the hosted game is cancelled with notifications, the hold is released, the user can't sign in, and the profile 404s within 1 minute; within 24h the PII tables have no row for the user; the sanction row remains with `subject_hmac` and no direct identifiers.

---

## 9. Data subject and consumer rights handling

| Right | Channel | SLA | Notes |
|---|---|---|---|
| Access / portability (GDPR 15/20, CPRA "know") | In-app export (ONB-010) or support | ≤ 1 month (target 24h) | JSON. Includes sanctions with SoRs, check-in outcomes (no raw samples older than 30 days, since they no longer exist) |
| Rectification | Profile edit or support | ≤ 1 month | Gender can be changed at most once per 90 days (anti-circumvention). Support can override |
| Erasure / delete | §8 | Immediate / ≤ 24h | |
| Objection / restriction | Support form | ≤ 1 month | Objecting to trust processing is weighed against LI. Safety processing is generally overriding ⚖️ |
| Human intervention / contest an automated decision (GDPR 22(3)) | Appeal (§7) | 72h | |
| CPRA Limit Use of Sensitive PI | Privacy settings toggle | Immediate | Disables auto check-in. Precise location then only processed on an explicit check-in tap |
| Opt out of sale / sharing / targeted ads | Toggle, honour GPC | Immediate | N/A in the MVP (no sale or sharing) |
| Withdraw consent | Settings per consent | Immediate | |

---

## 10. Law-enforcement and serious-harm procedure (DSA Art. 18)

1. **Trigger.** A P0 report (credible threat to life or safety, child sexual exploitation, suspected underage plus exploitation), or moderator discovery.
2. **Within 1h:** a moderator assesses the report, applies an interim restriction if needed, sets **legal hold** on the relevant retained messages and check-in outcomes, and escalates to the T&S lead.
3. **If a threat to life or safety is suspected:** notify the law-enforcement or judicial authorities of the relevant Member State (or Europol if unclear) with the information available. For Israel and other countries, notify the local police ⚖️ (counsel to finalise the contact matrix).
4. **CSAM:** report to NCMEC or the national hotline per jurisdiction ⚖️, preserve evidence, never re-share.
5. **Government data requests:** these require valid legal process. Verify, minimise, log, and notify the user unless prohibited. A transparency log is kept.

---

## 11. DPIA outline (GDPR Art. 35, Amendment 13, CPRA risk assessment)

| Processing | Risks to individuals | Mitigations | Residual |
|---|---|---|---|
| Precise location at check-in | Tracking, revealing home or routine, stalking | Window-only collection; user-initiated; no route; 30-day raw deletion; never shown to others; hidden location for sensitive games; no location in analytics | Low |
| Optional auto check-in (background) | Covert tracking perception | Separate opt-in; ≤3 regions; only near joined games; prominent disclosure; easy off | Low–Medium |
| Automated trust decisions | Wrongful exclusion, discrimination, brigading | No single-signal sanctions; qualified independent reporters; collusion checks; temporary-only automation; SoR; 48h dispute; human appeal; fairness-by-default auto-void; overturn-rate guardrail; bias monitoring (sanction rates by locale and gender where known, aggregate only) | Medium → Low |
| Reliability % shown publicly | Stigma, social pressure | Prior smoothing; "New" label; explanation; only a 90-day window; card visibility is the coarse status only | Low |
| Chat moderation through third-party AI | Content exposure to vendors, false positives in he/ar/ru/hi | Zero-retention terms; minimal context; per-language golden sets; FP monitoring; nudge instead of block where borderline; "this is a mistake" feedback | Low–Medium |
| Machine translation | Content to vendor, mistranslation | Labelled; original always available; moderation on the original | Low |
| Users under 18 (misstated age) | An under-18 gets onto an 18+ service | Neutral birth month/year gate; 24h device soft lock; SAFE-011 report and removal; no DMs or media in the MVP; age-assurance strength flagged for counsel (MIN-06) | Low–Medium ⚖️ |
| Gender data (women-only) | Sensitive inference, misuse | Optional; private; single purpose; change rate-limited | Low |
| Deposits | Financial harm, unfair penalty | Low amounts; disclosure; capture after the dispute window; refund on overturn; MoR without stored value | Low |

**Sign-off.** DPO + counsel + product owner, before the Ph1.5 public launch. Review annually or on any material change (media, live, ads, trainers).

---

## 12. Consolidated "requires counsel review" list ⚖️

1. Lawful bases and the legitimate-interest assessment for trust processing (GDPR-02).
2. Whether 7- and 30-day automated join bans are "similarly significant" under Art. 22, and the sufficiency of appeal-based human intervention (GDPR-08).
3. Need for a DPO, the GDPR Art. 27 representative, the DSA Art. 13 representative, and the entity structure (GDPR-10/16, DSA-02, ISR-02).
4. Amendment 13 classification of location data, database notification thresholds, and security level (ISR-01…04).
5. UK OSA: the children's-access assessment conclusion ("not likely to be accessed by children") and, above all, **the strength of the age assurance** (self-declared birth month/year plus 24h soft lock; whether stronger assurance is needed for the UK) (OSA-03/04, MIN-06). Australia SMMA scope (MIN-03). US state age-signal laws (MIN-04). UK GDPR/ICO registration for the London launch.
6. Deposit forfeiture under consumer and unfair-terms law, the CRD Art. 16(l) leisure exemption, and the Israeli cancellation regulations (PAY-04/05, ISR-07).
7. Merchant-of-record and "Community Fund" model, with no stored value. Israeli payment-services licensing. Connect payouts (PAY-06, ISR-10). **Entity jurisdiction, VAT/GST registration (UK VAT, EU OSS, Israeli VAT on digital services) and Stripe Connect platform structure (PAY-10/11/12).**
8. Retaining a phone HMAC to prevent ban evasion after deletion, and the account-life + 2y sanction retention (§4, §8).
9. Payment-record retention period per jurisdiction (7 years assumed).
10. Women-only games under anti-discrimination laws per market (ISR-09, GAME-016).
11. ODbL share-alike for the enriched venue database (LIC-01).
12. US IAP link-out options after the Epic v. Apple rulings, for web billing of Pro (APL-15).
13. Withholding an SoR during serious-harm investigations, and the law-enforcement contact matrix (§6, §10).
14. Crash reporting as "strictly necessary" under ePrivacy (EPR-01).
15. Machine-translated legal texts: none published without native legal review (I18N-008).
16. Age-assurance strength for the UK and other strict-age markets (MIN-06, OSA-03).
17. Entity jurisdiction, VAT/GST registration and Stripe account structure for a foreign entity serving Israeli users (PAY-10/11).

---

## 13. Pre-launch compliance checklist (Ph1.5 gate)

- [ ] Privacy Policy, Terms, Community Guidelines, Trust Charter, Cookie notice, Accessibility statement: final and native-reviewed in all 13 locales
- [ ] DPIA signed off. ROPA complete. LIA documented
- [ ] DPO appointed. EU/UK representatives appointed (if required). DSA points of contact published
- [ ] DPAs signed with all processors (§3). Transfer mechanisms and TIAs in place
- [ ] Israeli database definitions document. Security-level classification. Annual risk survey scheduled
- [ ] UK OSA illegal-harms risk assessment and the children's-access assessment (conclusion: not likely to be accessed by children) recorded. Age-assurance strength reviewed by counsel. UK GDPR / ICO registration done before the London launch
- [ ] App Store: privacy labels, privacy manifest, age rating, demo account for review, UGC contact info
- [ ] Google Play: Data safety form, account-deletion URL, (Ph1.5) background-location declaration plus video
- [ ] Pen test passed. Moderator MFA enforced. Audit log verified
- [ ] Purge jobs verified in staging (location 30d, chat end+3h, retained 90d, backups 30d)
- [ ] SoR templates reviewed by counsel in EN and HE, and native-reviewed in the remaining locales
- [ ] T&S staffing and on-call for the P0 1h SLA. Law-enforcement contact matrix
- [ ] Foreign entity incorporated, Stripe account live, VAT/GST registrations in place (UK VAT, EU OSS, Israeli VAT on digital services)
- [ ] PCI SAQ A completed. Stripe live-mode review. Chargeback evidence automation tested
