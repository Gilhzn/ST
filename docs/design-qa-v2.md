# Design QA: Floodlight v2

**Scope:** every screen and state of `apps/mobile-web`, reviewed on a phone (393×852) in en and he, light and dark. German (long strings) and a 1280px desktop pass were also checked. **Rounds:** baseline r0, then r1, r2 and r3 after fixes, then a final capture.

**Tooling added:**
- `scripts/screens.mjs` now takes `--device phone|pixel7|desktop`. The default is 393×852.
- The tour captures new states: `map-list`, `venue-sheet`, `map-empty`, `map-error`, `game-loading`, `game-scrolled`, `game-error`, `inbox-chats` and `create-published`.
- The tour prints console warnings and errors.
- The mock adapter has a QA hook, `globalThis.__ST_MOCK__ = { latencyMs, offline }`, so loading and error states can be captured without a reload.
- `scripts/axe.mjs` runs @axe-core/playwright with WCAG 2.0/2.1/2.2 A+AA rules over 14 main screens in en/he × light/dark.

Screenshot names follow `<screen>.<locale>.<scheme>.png`. In the table, **before** means round r0 and **after** means round r3 or the final capture.

## Findings log

| # | Issue | Fix | Before → after |
|---|---|---|---|
| 1 | **RTL logical styles were broken on web.** react-native-web only resolves `start/end`, `paddingStart`, `borderStart*` and `borderTopStartRadius` from a `dir` prop, not from CSS `direction`. In he, the FAB, the locate button, the segmented thumbs, the end badges and the inset hairlines all sat on the LTR side. | `ThemeProvider` root view sets `dir` on web (`packages/ui/src/theme.tsx`). | `map.he.*`, `inbox.he.*`, `settings.he.*` |
| 2 | Hebrew relative times read "לפני (2) שעתיים". Chromium's ICU appends the count to the dual form. | `formatRelative` strips the count (`stripDualCount`, `lib/format.ts`). | `inbox.he.light` |
| 3 | Durations wrapped badly: "1 hour, 30 minutes", "29 days, 3 hours", "1 hr, 30 / min". Hebrew used ICU's "1 שעה, 30 דקות". | Compact two-unit `formatDuration` with natural Hebrew ("שעה ו-30 דקות", "שעתיים"). The wizard review uses the compact form. | `sanctions.*`, `result.*`, `create-review.*` |
| 4 | Leftover MaterialCommunityIcons names: `features/profile/GamesList.tsx` (whistle-outline, timer-sand…), `SegmentedControl` ("check") and `LocationDisclosure` ("crosshairs-gps"). | The app `Icon` and `Tag` now accept Phosphor names only, so the type system blocks legacy names. Mapped `crosshairs-gps` → `GpsFix`. Removed the two dead v1 files. | n/a (code) |
| 5 | Focus rings showed after a tap or click, for example the thick ring on the chat Send button after sending. | `showFocusRing()` in `@st/ui` tracks input modality. All pressables (Button, IconButton, Chip, Card, Fab, Segmented, TabBar, ListItem, GameHeroCard) show rings for keyboard focus only. | `chat-block.*` |
| 6 | Create wizard: Back did the same thing as Close on step 1. The progress bar had 6 bars for "Step 1 of 5". A "Repeat weekly · Coming soon" row was a dead control. | Back is hidden on step 1. There are 5 bars, and the review fills all of them. Step 5's button reads **Review**. The dead row is removed. | `create-1.*`, `create-3.*`, `create-5.*` |
| 7 | The map list toggle did nothing on phones, so `map-list` looked like `map`. Tapping a venue in the list did nothing. | List view now renders `VenueDetails` in place, and the tour opens list mode. | `map-list.*`, `venue-sheet.*` (new) |
| 8 | The venue sheet still used v1 parts: deprecated `SportDot`, a text "Close", a text-only rating, and two equal buttons. | v2 venue sheet: solid sport glyph badges, an X icon button, MapPin + distance, one primary "Start a game here" plus a tonal Directions icon, and a rating panel with `numeric` score and stars. | `venue-sheet.*` |
| 9 | Error and loading copy was contradictory: "No games nearby" sat above "Couldn't load this". | The sheet title is empty on error and reads "Loading…" while loading. | `map-error.*` |
| 10 | Search bar: the List/Map pill was clipped at 393px because the web `<input>` has an intrinsic width. | `minWidth: 0` on the input and `flexShrink: 0` on the pill. | `map.en.*` |
| 11 | Truncations: "Shuffle ag…" / "נעילת הקבוצ…" (Teams), "Start a game h…", "Share on Wh…", "in 34 minut…" (hero card), the QR fallback code on the wrong side in he, the de segments ("Anstehe…"), the de tile "Ich kann nic…" and the de "Abstand zur M…". | lg button padding 24→16 with a shrinkable label. The hero status pill moved to the overline row. Share buttons are stacked. The code is an LTR paragraph. ActionTile and Metric labels wrap to 2 lines. Shorter native de/fr/ru/pt/… labels. | `teams.*`, `games.*`, `create-published.*`, `host-qr.he.*` |
| 12 | The host QR countdown read "37" next to "refreshes every 20 seconds", because it counted to the drift-window expiry. | The countdown and refresh run to the next 20 s step boundary. | `host-qr.*` |
| 13 | Check-in: the idle title said "Checking your location" before anything ran. The code field had no guidance on where the code comes from. Hebrew "צ׳ק-אין" broke at its hyphen. | Idle title "Are you at the venue?". Hint and placeholder "Paste the code" (the host copies it). The host card says "Can't scan? Copy the code and send it". A word joiner after "צ׳ק-" in all he strings. | `checkin.*`, `checkin-code.*` |
| 14 | Chat: the stale server nudge stayed visible under a new blocked message. Mock translations were "[en] …" echoes. | The nudge clears on typing and is hidden while a block card shows. A demo phrasebook gives real translations. The Hebrew seed has no "18:00" bidi tangle. "תורגם מ-ערבית" → "תורגם מערבית". | `chat-block.*`, `chat.*` |
| 15 | Inbox: the large title jumped when switching tabs. The chat count looked like an unread badge. Chat rows showed a bare "in 10 minutes". The sanction notice said "Open the app…" inside the app. | Fixed-height action row. No count on Chats. Rows show "Today, 8:50 PM". Copy is now "Tap to see…" in 13 locales. | `inbox.*`, `inbox-chats.*` |
| 16 | Settings showed a raw phone "+972500000001" and a meaningless 4-dot "theme swatch". OTP showed the raw E.164 too. | `formatPhone()` gives "+972 50-000-0001". The swatch is removed. | `settings.*`, `otp.*` |
| 17 | The reliability card repeated itself: badge "Caution" then "Caution: below the reliable level…". | The prefix is dropped next to the badge. | `profile.*` |
| 18 | Radius chips were 34pt (below the 44pt target). The miles labels were "3.1 mi / 6 / 19". | 38pt segments in a 44pt track with hitSlop. Miles are rounded consistently. | `map.*` |
| 19 | Hebrew copy: "לא מגיעים" → "לא אגיע". Sort "הקרובים ביותר בזמן" → "לפי שעה" / "לפי מרחק" (de "Nach Uhrzeit", fr "Les plus tôt"). GPS intro is more natural and gender-inclusive ("המארח/ת"). | Locale edits. | `game.he.*`, `map.he.*` |
| 20 | Console warning on every map visit: `useNativeDriver` is not supported on web. | Native driver only off-web (`MapControls`). | Tour log is now clean |
| 21 | The bio counter "49 / 280" reversed to "280 / 49" in he. | LTR isolate. | `profile-edit.he.*` |

## Accessibility (axe-core, `node scripts/axe.mjs`)

Coverage: 14 screens (phone, otp, map, map-list, game, chat, teams, host-qr, check-in, games, inbox, profile, settings, create) in en/he × light/dark.

- **Before:** 20 serious, 0 critical.
  - *label-content-name-mismatch:* game cards, carousel cards, the players toggle, team rows, the settings language row and the he map cluster.
  - *color-contrast:* the reliability % at 85% opacity (4.32:1) and the own-bubble time at 78% (4.32:1).
- **After:** **0 critical, 0 serious, 0 moderate, 0 minor.**
- Fixes:
  - On web, summary-labelled controls take their name from visible content (WCAG 2.5.3). Native keeps the summary sentence for VoiceOver and TalkBack.
  - ListItem names come from content.
  - Cluster labels include the digit in he and ar.
  - The badge percentage is at full opacity, and own-bubble metadata is at 90%.

## Verification

All of these pass:
- `npm run typecheck`
- `npx eslint .`
- `npm run i18n:check`
- vitest for @st/ui, @st/i18n and @st/mobile-web: 484 tests
- the web export
- `npx playwright test`: 67 passed. The 2 skips are the intentional "RTL project only" test.

Note: the stale, git-ignored `apps/mobile-web/dist-artifact/` build had made `npx eslint .` report 11,000 errors in bundled JS. It was moved out of the tree; rebuild it with `npm run export:artifact` when needed.
