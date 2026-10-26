# Security & Abuse Review #2: Phase 1.5

**Scope:**
- series/roster, invite migration, Glicko and peer ratings, media vault, network: migrations 0100–0107, 0190, 0191 and 9001;
- Edge Functions media-upload, media-process, media-purge, rating-period, series-jobs and invite-preview;
- the matching domain modules.

**Method:** same as review #1. Code review plus proof-of-concept tests in the pglite harness; the scratch file was deleted afterwards. **No regression** of the 17 fixes from review #1.
**Status:** fix round in progress. The DB engineer owns the SQL fixes and the Functions engineer the function fixes. Every fix ships with a regression test (`supabase/tests/security_regressions2.test.ts`, plus the function tests).

| ID | Sev | Finding | Proof | Owner | Fix |
|---|---|---|---|---|---|
| H1 | High | The CSAM restriction only touches the profile's `*_until` fields. It is wiped on recompute, and the user can still upload and host. Re-registering clears it | PROVEN | Functions + DB | Emit `RestrictAccountPendingReview` to create a durable hold: no uploads, hosting suspended, persisted in the phone HMAC |
| H2 | High | Result confirmations aren't tied to the score, so the host can flip the score after players confirm, and Glicko updates from the flipped result | PROVEN | DB | Reset or score-match confirmations on any score change |
| M1 | Med | The venue vault links games with a hidden location to their venue | PROVEN | DB | Require `not hide_exact_location` for venue_public |
| M2 | Med | Friend-request (and roster-join) notification spam by bypassing the rate limit | PROVEN | DB | Rate-limit on an append-only log; 30-day cooldown per pair; dedupe keys without a timestamp |
| M3 | Med | A user who declined a tag can be re-tagged and pinged repeatedly | PROVEN | DB | Refuse a re-tag after a decline or veto |
| M4 | Med | Schedule edits flood games and notifications | PROVEN | DB | Edit rate limits; hard-delete empty rescheduled occurrences |
| L1 | Low | The host can void rating eligibility by re-saving teams after kickoff | PROVEN | DB | Guard `save_teams` on time and status |
| L2 | Low | Occurrences inside the roster-only window are visible to strangers | PROVEN | DB | Policy and view filter |
| L3 | Low | The sanitizer keeps APP0/JFXX thumbnails, JPGn segments and WebP ANMF | Code reading | Functions | Rewrite APP0; drop JPGn; filter ANMF |
| L4 | Low | Null reliability is not frozen, so brand-new Sybil accounts get Glicko updates | Code reading | DB + domain | Treat null as frozen |
| L5 | Low | The uploader can tell a CSAM block from a normal policy block (a tip-off) | Code reading | DB + Functions | Identical generic block |
| L6 | Low | The invite-preview rate limit trusts the first `X-Forwarded-For` hop | Code reading | Functions | Use the trusted proxy's hop |

**Retention notes:**
- Purge blocked non-CSAM rows.
- `media-purge` requires `st_dispatch` to be configured.
- Expire upload intents and purge orphaned originals.

**Verified secure:**
- **Grants:** anon can execute only `get_invite_preview` and `st_now`. Every SECURITY DEFINER function pins `search_path`. Every new table has RLS with no client writes, and internal jobs are service-only.
- **Invite preview:** exposes nothing sensitive. Rotated tokens stop working, and output is escaped.
- **Rosters:** the priority window is enforced on every path.
- **Network:** privacy settings and blocks are respected.
- **Peer ratings:** gated, and never read by trust or sanction code.
- **Media:**
  - Tags stay invisible until accepted, and the veto persists.
  - Storage paths are validated, and originals and quarantined files are never readable.
  - No SSRF.
  - CSAM originals are preserved under legal hold and never published.
- **Account deletion:** complete.
