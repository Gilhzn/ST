# Security & Abuse Review #1 (adversarial QA)

**Scope:** supabase migrations (RLS, RPCs, jobs), Edge Functions, `packages/domain` trust engine, `packages/payments`, and the app's SupabaseAdapter.
**Method:** code review plus proof-of-concept tests in the pglite harness. Findings marked PROVEN were exploited by a PoC test; the rest were found by reading the code.
**Status:** every finding is assigned to its owner for the fix round. Each fix ships with a regression test in `supabase/tests/security_regressions.test.ts` or the domain or function test suites.

| ID | Sev | Finding | Proof | Owner | Fix |
|---|---|---|---|---|---|
| H1 | High | A player can erase a late-cancel card by cancelling, rejoining and cancelling again | PROVEN | DB | `late_cancel` stays set once true; `request_join` refuses to reopen a late-cancelled row |
| H2 | High | The host can check themselves in by QR; a QR relayed to an absent friend still verifies, and that friend can then peer-confirm others | PROVEN | DB + Core | Host can't use QR; QR step is 20s and accepts only the previous step, never a future one; peer anchors must be GPS-verified |
| H3 | High | A host plus 3 sock puppets can impose a 72h visibility restriction on someone | PROVEN | Core + DB | Reports that all come from one game go to review only; at least one reporter must be GPS-verified and not the host |
| H4 | High | Women-only games can be bypassed by flipping gender, or created by a male host | PROVEN | DB | 90-day lock on gender changes; host must be female; exact location hidden by default |
| H5 | High | Deleting the account and re-registering clears every sanction | PROVEN | DB | Keyed HMAC of the phone number kept for sanctions still in force; sanctions re-applied when the number signs up again |
| H6 | High | No Realtime authorization policies exist | Code reading | DB | SELECT policy on `realtime.messages` for participants only; no INSERT policy; public channels disabled |
| M1 | Med | Any participant can overwrite the game result | PROVEN | DB | Host only |
| M2 | Med | 3 throwaway accounts can hide any venue | PROVEN | Core + DB | Venue reporters must be qualified |
| M3 | Med | Device-integrity token is optional; `lastKnown` is never set | Code reading | Functions | Missing token routes to a fallback check-in; last fix is stored for the speed check |
| M4 | Med | Deposit amount and currency are unbounded | Code reading | DB | Deposit tier allow-list; forfeits go to the pot in the MVP |
| M5 | Med | A visibility-restricted user can still chat | Code reading | Functions | Enforced in `send-message` |
| M6 | Med | A host who cancels late faces no consequence | Code reading | Core + DB | Host gets a disputable `late_cancel` card |
| L1 | Low | `st_is_hidden_user` can be used as an oracle | Code reading | DB | Wrapper that only answers relative to the caller |
| L2 | Low | The `st.now` time override can be set by the caller | Code reading | DB | Honoured only in test mode |
| L3 | Low | Translations are shown without moderation | Code reading | Functions | Moderate translated output before caching |
| L4 | Low | The blocklist misses confusable look-alike characters | Code reading | Core | Fold confusables before matching |
| L5 | Low | `remove_participant` and `rotate_qr` have no time guard | Code reading | DB | Guard on game status and time |

**Verified secure:**
- Every SECURITY DEFINER function pins `search_path`.
- EXECUTE grants are exact.
- Moderator and host privilege checks hold.
- Cross-user reads return nothing.
- Column grants protect `qr_secret` and exact location.
- Chat and translation tables accept no direct writes.
- QR MAC is constant-time and rate-limited.
- Stripe webhook signatures and idempotency are correct.
- Amounts are always taken from the database.
- Internal function secret, CORS allow-list and log redaction are in place.
- The moderation classifier isolates the prompt and has strict output.
- Bidi and zero-width characters are stripped.
