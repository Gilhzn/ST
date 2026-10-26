# ADR 0004: Compliance-driven Trust Engine

- Status: Accepted (2026-10)

## Context
PRD v4 asked for background GPS attendance from one hour before the game, contact-book cross-checks, automatic permanent suspensions and silent shadowbans with "zero human intervention". Research (docs/research/findings.md) shows these conflict with Google Play background-location policy, Apple 5.1.2(iv) / 5.1.1(iii), GDPR Art. 22(3), DSA Art. 17 / 20(6) and store UGC rules, and that 30–50 m OS geofences are not reliable.

## Decision
Keep the goal (reliable attendance, deterrence, safety); change the mechanism:
- **Attendance:** two-stage check-in. Optional native wake-up geofence (feature-flagged) or a time-based reminder, then foreground precise GPS verified server-side (accuracy ≤ 25 m, distance ≤ 50 m + accuracy, 2–3 samples), with QR, host and peer fallbacks. No contact uploads. Spoofing signals never sanction alone.
- **Sanctions:** automated measures are temporary only and always carry a statement of reasons, an expiry and an appeal path. Yellow card disputable for 48 h; 2 cards → 7-day join ban; 3 → 30 days; 4+ → human review. Permanent bans only by a moderator (encoded in the `Sanction` type and a SQL CHECK).
- **Toxicity:** 3 independent, qualifying, non-colluding reporters in 14 days → 72 h visibility restriction, notification with reasons, appeal and review queue. No silent shadowbans.
- **Host reliability:** automatic temporary host suspension + review; permanent loss of hosting rights only by a human.
- Optional deposits add an economic deterrent.

## Consequences
- + Store-approvable and aligned with GDPR/DSA; fairer, explainable outcomes.
- + Fewer false positives (fallbacks instead of sanctions on GPS failure).
- − Requires a moderator workflow and SLA (review queue), i.e. some human cost.
- − Less "magic" than background tracking; check-in needs a user action.
- − Legal review by counsel is still required per market (Israel Amendment 13, CCPA, DSA).
