# Sport Talent Design System — Design Language v2 "Floodlight"

**Owner:** UI/UX Design Lead. **Code:** `packages/ui` (`@st/ui`). **Status:** v2 (replaces v1 "Night Court + Volt"). **Specimen:** `/dev/design` in the app (light/dark/RTL toggles).

This document is the source of truth for visual language, interaction rules, RTL/i18n behaviour, accessibility and screen-level layouts. Token values live in `packages/ui/src/tokens.ts`. Tests in `packages/ui/test` enforce the numbers quoted here; if this doc and the code disagree, the code wins and this doc is the bug.

Contents:
0. Why v2 (audit of v1)
1. Brand
2. Color
3. Sport system (colors, gradients, glyphs)
4. Reliability status
5. Typography and per-script fonts
6. Spacing, radius, sizing, elevation
7. Motion
8. Haptics
9. Iconography (Phosphor)
10. RTL rules
11. Bidi text
12. Accessibility
13. Information architecture and navigation
14. Component specs
15. Screen-by-screen v2 layouts
16. UX copy principles
17. `@st/ui` API inventory and migration
18. Tooling (screenshot tour) and requests to other owners

---

## 0. Why v2 — audit of v1 (screenshots: `node apps/mobile-web/scripts/screens.mjs`)

What made v1 read as "amateur", in order of impact:

1. **No hierarchy on the money screens.** Game details is a column of same-weight rows: sport dot, title, time, venue, host card, a "7 of 10 players" chip, a flat player list, then three competing buttons (filled, two outlines and a link) in the footer. Nothing says "this is the game, this is when, this is how full". The map sheet peeks at a single card's eyebrow.
2. **Generic icon set.** MaterialCommunityIcons mixes stroke weights and metaphors (radar for "live", clock-fast, scoreboard). Outline/filled pairs look like two different icons. Sports are a colored *dot* (●■◆) — no sport glyph anywhere.
3. **Everything is a pill with a border.** Filters, radius chips, segments, tabs, tags and buttons are all 40–48dp outlined capsules with the same 1.5dp grey stroke, so the eye can't tell controls from data. Selected = lavender fill + tiny ✓.
4. **Flat, grey canvas.** Cards are white on #F6F7FB with a 1px shadow, no color moments except one volt FAB. Dark mode is the same layout inverted; the lavender primary button glows.
5. **Typography without a voice.** System/Noto at 26/22/18 with 600 weight; numbers (7/10, 90%, 19:05) are the same size as labels. Stats tiles are 13 in 28pt next to an equally loud label.
6. **Spacing rhythm is uneven.** 16dp gutters everywhere, but 48dp gaps between sections and 4dp inside groups; the map controls stack in three full-width rows that push the map down 40%.
7. **Map.** A huge brand-colored radius disc dominates; pins are generic circles; clusters are black discs with three tiny shapes stuck underneath.
8. **Empty states and loading** are a glyph in a disc ("◎") and spinners; no illustration, no brand.
9. **Navigation and microinteractions.** Tab bar is a flat white strip with a lavender blob; no blur, no haptics, presses only change background color; no motion on selection.
10. **Auth** opens on a form under an all-caps eyebrow. No brand moment at all.

v2 fixes these with: a sport-led color + glyph system, Phosphor icons, a real type voice (Rubik) with tabular stat numerals, hero game cards with gradient bands, teardrop pins, a blurred tab bar with fill icons, soft layered elevation, SVG illustrations, spring motion and a haptics map.

---

## 1. Brand

**Personality: energetic · premium · trustworthy.** We are the floodlights coming on at the local pitch: dark-indigo night, volt energy, every sport its own color. Not a fitness-tracker rainbow, not a SaaS blue.

| Principle | In the UI |
|---|---|
| **Sport first** | Every game carries its sport: a colored gradient band, a Phosphor glyph, a sport-colored teardrop on the map. Color is never the only cue: the glyph is the identity. |
| **Floodlight contrast** | Brand moments are deep indigo night (`brandNight`) with white type and one volt highlight. Content surfaces stay calm and neutral (brand-tinted greys). |
| **Scoreboard numbers** | Time, players (7/10), %, scores and distances are tabular, heavier and bigger than their labels (`statLarge`, `numeric`, `statSmall`). |
| **One volt moment per screen** | Volt (`#CCFF33`) is a fill with ink content: FAB, "Live" pill, success sparkles, the brand ball. Never text on white. |
| **Fair play, calm trust** | Sanctions and reliability use neutral surfaces + a status badge (icon + label + %), never full-screen red. Always a next step. |
| **Global by default** | Every layout mirrors; numbers and times are LTR isolates; illustrations contain no text. |

**Avoid:** emoji as UI icons, outlined pills for everything, more than one gradient per card, glass over map tiles (only the tab bar is translucent), red as a brand color, ALL CAPS outside Latin/Cyrillic overlines.

**Brand mark** (`BrandMark`): indigo squircle (radius 12/40), two white motion arcs, volt ball. Wordmark "Sport Talent" in Rubik 800, −0.3 tracking. Never mirrors.

---

## 2. Color

Components use **semantic tokens only** (`theme.colors.*`). Neutrals are **tinted toward the brand hue (~250°)** — tested: the blue channel leads and nothing is pure grey.

### 2.1 Semantic tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `background` | `#F6F6FB` | `#0B0A1C` | Canvas |
| `surface` | `#FFFFFF` | `#17162E` | Cards, list groups |
| `surfaceRaised` | `#FFFFFF` | `#1F1E3A` | Sheets, menus, segmented thumb (dark) |
| `surfaceSunken` | `#EFEEF6` | `#100F24` | Inputs, chips, segmented track, skeleton |
| `surfaceInverse` / `textInverse` | `#121129` / `#F4F4FA` | `#F4F4FA` / `#121129` | Toasts, cluster bubbles, selected chips |
| `surfaceGlass` | `rgba(255,255,255,.82)` | `rgba(23,22,46,.78)` | Tab bar over blur |
| `text` (= `textPrimary`) | `#121129` | `#F4F4FA` | Primary text |
| `textSecondary` | `#4A4968` | `#B9B8D4` | Metadata |
| `textTertiary` | `#5F5E80` | `#9897B9` | Helper, timestamps, chevrons (AA) |
| `textOnMedia` | `#FFFFFF` | `#FFFFFF` | Text on sport gradients / hero |
| `border` | `#E3E2EE` | `#2C2B4A` | Hairlines; dark-mode card edges |
| `borderStrong` | `#8B8AAE` | `#6E6D92` | Outline buttons (≥ 3:1) |
| `primary` / `onPrimary` | `#5B3DF5` / `#FFF` | `#8F7DFF` / `#08071A` | Primary actions, active tab, rings |
| `primaryPressed` | `#3C1FC7` | `#AA9DFF` | Pressed |
| `primarySubtle` / `onPrimarySubtle` | `#EFEDFF` / `#3C1FC7` | `#221A55` / `#C7BEFF` | Tonal buttons, active tab pill, icon wells |
| `primaryText` | `#4A2BE6` | `#AA9DFF` | Links, ghost buttons |
| `accent` / `onAccent` / `accentPressed` | `#CCFF33` / `#121129` / `#B8F000` | `#CCFF33` / `#08071A` / `#E1FF66` | Volt moments |
| `danger` · `success` · `warning` · `info` (+ `on*`, `*Subtle`, `*Text`) | `#D11F2D` · `#11803F` · `#FFB21E` · `#0A5FC2` | `#FF6B76` · `#3FD98A` · `#FFC24D` · `#6CB6FF` | Status |
| `focusRing` | `#5B3DF5` | `#8F7DFF` | 3dp outline, 2dp offset |
| `skeleton` / `skeletonHighlight` | `#EFEEF6` / `#F4F4FA` | `#1F1E3A` / `#2C2B4A` | Shimmer |
| `pinRing` / `pinOutline` / `mapBase` | `#FFF` / `#121129` / `#F2EFE9` | `#FFF` / `#F4F4FA` / `#1B1D24` | Map markers |

Dark mode is **not** inverted light: primary turns lavender with ink text; elevation becomes lighter surfaces + a `border` hairline (§6.4); sport fills and gradients are identical in both schemes (they sit on their own white glyph/ring).

### 2.2 Verified contrast (WCAG 2.2 AA; `test/tokens.test.ts`)

| Pair (fg on bg) | Use | Light | Dark | Min |
|---|---|---|---|---|
| `text` on `background` | body on canvas | **17.13** | **17.84** | 4.5 |
| `text` on `surface` | body on cards | **18.45** | **16.10** | 4.5 |
| `text` on `surfaceRaised` | sheets | **18.45** | **14.69** | 4.5 |
| `text` on `surfaceSunken` | inputs, chips | **16.02** | **17.18** | 4.5 |
| `textSecondary` on `surface` / `surfaceSunken` | metadata, segments | **8.59 / 7.46** | **9.13 / 9.74** | 4.5 |
| `textTertiary` on `surface` / `background` / `surfaceSunken` | helper, timestamps | **6.18 / 5.73 / 5.36** | **6.27 / 6.95 / 6.69** | 4.5 |
| `textInverse` on `surfaceInverse` | toasts, clusters, selected chip | **16.84** | **16.84** | 4.5 |
| `onPrimary` on `primary` / `primaryPressed` | primary button | **6.12 / 9.49** | **6.20 / 8.50** | 4.5 |
| `onPrimarySubtle` on `primarySubtle` | tonal, active tab | **8.24** | **9.09** | 4.5 |
| `primaryText` on `surface` / `background` | links | **7.56 / 7.01** | **7.54 / 8.35** | 4.5 |
| `onAccent` on `accent` / `accentPressed` | volt | **15.75 / 13.62** | **16.97 / 17.71** | 4.5 |
| `onDanger` on `danger` | danger button | **5.32** | **7.22** | 4.5 |
| `dangerText` on `surface` / `dangerSubtle` | errors | **6.95 / 5.99** | **8.56 / 7.84** | 4.5 |
| `onSuccess` on `success`; `successText` on `successSubtle` / `surface` | success | **5.02; 5.89 / 6.61** | **10.90; 9.72 / 11.93** | 4.5 |
| `warningText` on `warningSubtle` | warning banner | **7.43** | **10.52** | 4.5 |
| `infoText` on `infoSubtle` / `surface` | info | **6.01 / 7.00** | **9.20 / 10.41** | 4.5 |
| `borderStrong` on `surface` / `background` | outlines | **3.31 / 3.07** | **3.58 / 3.97** | 3 |
| `focusRing` on `background` / `surface` | focus | **5.68 / 6.12** | **6.09 / 5.50** | 3 |
| `primary` on `surface` | active icon, rings | **6.12** | **5.50** | 3 |
| `pinOutline` on `mapBase` | pin vs tiles | **16.08** | **15.36** | 3 |

Rule: any new text/background combination goes into `contrastPairs`; the test checks it automatically.

---

## 3. Sport system

Each sport has: a **marker color** (white glyph ≥ 3:1, WCAG 1.4.11 graphic), a **gradient** (white text ≥ 4.5:1 on both stops), a **tint + text** pair per scheme (≥ 4.5:1), and a unique **Phosphor glyph** — the primary non-color identity cue.

| Sport | Marker | White glyph | Gradient (band) | White on stops | Light text/tint | Dark text/tint | Glyph |
|---|---|---|---|---|---|---|---|
| football | `#00A846` | 3.14 | `#008738` → `#006649` | 4.64 / 7.01 | `#007832` / `#E0FFED` 5.28 | `#70FFAC` / `#104125` 9.19 | `SoccerBall` |
| basketball | `#FF5E1A` | 3.06 | `#D43F00` → `#B31100` | 4.66 / 7.01 | `#BD3800` / `#FFE9E0` 4.82 | `#FF9B70` / `#411F10` 7.12 | `Basketball` |
| tennis | `#72A008` | 3.11 | `#5A7E06` → `#166602` | 4.75 / 7.15 | `#507006` / `#F5FEE2` 5.51 | `#D1F877` / `#323F13` 9.38 | `TennisBall` |
| padel | `#6E89F7` | 3.19 | `#4568F5` → `#3D2FF9` | 4.61 / 7.06 | `#2D54F3` / `#E2E7FD` 4.65 | `#8FA4FA` / `#131C3F` 7.00 | `Racquet` |
| running | `#E56CA2` | 3.00 | `#D92877` → `#A3177F` | 4.65 / 7.03 | `#C12269` / `#FAE5EF` 4.73 | `#EA86B2` / `#3A1827` 6.38 | `PersonSimpleRun` |
| volleyball | `#0B9FD0` | 3.05 | `#097EA5` → `#0554B5` | 4.63 / 7.14 | `#086F91` / `#E2F7FD` 5.13 | `#77D8F8` / `#13343F` 8.15 | `Volleyball` |

**Distinctness:** min pairwise CIE76 ΔE **31.8** (normal vision, test ≥ 25). Under simulated CVD (Machado 2009): protanopia 12.6, deuteranopia 12.4, tritanopia 12.1 (test ≥ 12). v1 hit ≥ 15 with Okabe–Ito fills, but those could not carry a white glyph (tennis yellow 1.4:1). v2 trades a little CVD separation for a consistent white-glyph marker, and moves identity onto the glyph (unique per sport, tested), which works in grayscale too.

**Gradients** (`gradients` token, `<Gradient name>`): `brand` (`#5B3DF5`→`#3C1FC7`), `brandNight` (`#221A55`→`#0B0A1C`), `volt`, `live`, `scrimBottom`, plus one per sport. Diagonal top-start → bottom-end; horizontal/diagonal gradients mirror in RTL. **Max one gradient per card.**

Adding a sport: a marker color passing the ΔE tests with white ≥ 3:1, gradient stops ≥ 4.5:1, a Phosphor glyph not already used, an entry in the icon registry, and a design review.

---

## 4. Reliability status

Derived by the domain (`green` ≥ 85% and no yellow card, `red` = ban or < 60%, `new` < 3 games, else `yellow`). The UI always shows **icon + label (+ %)**; shape differs too (pill for green/new, squared for yellow/red, dashed outline for new).

| Status | Phosphor (fill) | Label (en) | Light fg/bg | Dark fg/bg |
|---|---|---|---|---|
| green | `ShieldCheck` | Reliable · 92% | `#0E6B37` / `#E2F7EA` | `#74EBA9` / `#0D3020` |
| yellow | `Warning` | Caution · 74% | `#6E4700` / `#FFF3D6` | `#FFD685` / `#35270A` |
| red | `Prohibit` | Restricted · 52% | `#B3121F` / `#FFE9EB` | `#FF97A0` / `#3D1219` |
| new | `Sparkle` | New player | `#363F7D` / `#E9EBF8` | `#BAC2FF` / `#1E2140` |

All fg ≥ 4.5:1 on bg and on surface; solids ≥ 3:1 on surface (tested). The profile hero is a **ReliabilityRing** (status-colored arc, 44/48 `statLarge` %, label under it). The percentage is an LTR isolate. Approved en labels: *Reliable / Caution / Restricted / New player*.

---

## 5. Typography and per-script fonts

### 5.1 Faces
- **Rubik** (`@expo-google-fonts/rubik`, weights 400/500/600/700/800) — the brand face for **Latin, Cyrillic and Hebrew** (en, es, pt, fr, it, de, ru, he). Slightly rounded geometric: sporty without being childish; native Hebrew design.
- **Fallbacks:** Noto Sans Arabic (ar), Noto Sans Devanagari (hi), Noto Sans SC/TC/JP (zh-Hans, zh-Hant, ja; not bundled: system Han font until lazily loaded). On web the stack always starts with Rubik so Latin runs and digits inside Arabic/CJK text render in the brand face.

### 5.2 Scale (`typography`, Latin base)

| Variant | Size/line | Weight | Tracking | Use |
|---|---|---|---|---|
| `display` | 40/44 | 800 | −1.0 | Auth hero, celebration |
| `largeTitle` | 32/38 | 700 | −0.6 | `LargeHeader` titles (tab roots) |
| `title1` | 26/32 | 700 | −0.4 | Screen titles, hero card time |
| `title2` | 21/28 | 600 | −0.2 | Section titles, empty-state titles |
| `title3` | 18/24 | 600 | −0.1 | Card titles, sheet titles |
| `headline` | 16/22 | 600 | 0 | Button labels, row emphasis |
| `body` | 16/24 | 400 | 0 | Default |
| `bodyStrong` | 16/24 | 500 | 0 | Emphasis in text |
| `callout` | 15/22 | 400 | 0 | Secondary paragraphs, values |
| `label` | 14/20 | 500 | 0.1 | Chips, form labels |
| `footnote` | 13/18 | 400 | 0.1 | Metadata, helper, pills |
| `caption` | 12/16 | 400 | 0.2 | Timestamps, tab labels |
| `overline` | 12/16 | 600 | 1.0, UPPERCASE (Latin/Cyrillic only) | Section eyebrows, band eyebrow |
| `numeric` | 28/34 | 700 | −0.4, **tabular** | Scores, stat tiles |
| `statLarge` | 44/48 | 800 | −1.2, **tabular** | Reliability %, result score |
| `statSmall` | 17/22 | 600 | −0.1, **tabular** | 7/10 in cards, counters |

Rules: numbers are always one step heavier/bigger than their label; tabular numerals (`fontVariant: tabular-nums`, Rubik has `tnum`) on every changing number; emphasis by weight (never italics); `Text weight=` overrides a variant's weight with the matching registered face.

### 5.3 Loading and platform behaviour (`fonts.ts`, `fontAssets.ts`)
- Native needs one registered family per weight: `fontFamilyForScript("hebrew", { weight: "bold" })` → `Rubik_700Bold`; Arabic → `NotoSansArabic_700Bold`.
- `useAppFonts(locale)` loads Rubik + the locale's script group (`fontGroupsForLocale`: `rubik`, `arabic`, `devanagari`) via expo-font on **web and native**; pass the result as `<ThemeProvider brandFonts>`. With `brandFonts`, family names carry the weight and `fontWeight` is not set (prevents synthetic bold on Android and browsers). Until loaded, system fonts with `fontWeight`.
- Legacy: `fontsLoaded` (v1 Noto loader) still works (`legacyFontStacks`) until the app migrates.
- Web: on a `<html dir="rtl">` page, UI `Text` sets `dir` to the UI direction (react-native-web defaults to `dir="auto"`, which left-aligned Latin/numeric UI strings in Hebrew).

### 5.4 Per-script adjustments (`typeStyleFor`)

| Script | Line-height × | Min size | Tracking | Uppercase | Android font padding |
|---|---|---|---|---|---|
| latin (+Cyrillic) | 1.00 | 12 | yes | yes | false |
| hebrew | 1.05 | 12 | no | n/a | false |
| arabic | 1.25 | 13 | no (breaks joining) | n/a | true |
| devanagari | 1.25 | 13 | no (breaks conjuncts) | n/a | true |
| sc / tc / jp | 1.12 | 12 | no | n/a | false |

Truncate with `numberOfLines`, design for +40% text expansion, buttons wrap to two lines before truncating.

---

## 6. Spacing, radius, sizing, elevation

### 6.1 Spacing — 4pt grid
`xxs 2 · xs 4 · sm 8 · md 12 · lg 16 · xl 24 · xxl 32 · xxxl 48 · huge 64` (xxs is the only half-step; tested).
- Screen gutter 16 (24 at ≥ 768). Card padding 16. Section gap 24; title→content 12; inside a group 8.
- List rows ≥ 56; chips gap 8; form fields gap 16.

### 6.2 Radius — generous, not bubbly
`xs 6 · sm 10 · md 14 · lg 20 · xl 28 · pill`. Buttons/inputs/segments **14** (sm button 10), cards and list groups **20**, sheets and hero panel **28**, chips/pills/avatars **pill**. Icon wells are squircles (10 or 32% of size). Corners are logical (`borderTopStartRadius`).

### 6.3 Sizing
Touch target **48** everywhere (smaller visuals extend with `hitSlop`). Buttons 36/48/56. Inputs 52. Icon buttons 36/44/52. Tab bar 64 + safe area. Avatars 24/32/40/56/88. Teardrop pin 40×50 (52×65 selected). FAB 56. Icons 16/20/24/28.

### 6.4 Elevation (`theme.elevation(level)`)

| Level | Light (layered key + ambient, ink-tinted) | Dark | Use |
|---|---|---|---|
| 0 | none | none | flat |
| 1 | `0 1 2 /.05, 0 4 12 /.06` | `surface` + 1px `border` | cards, list groups, stat tiles |
| 2 | `0 2 4 /.05, 0 10 24 /.10` | `surfaceRaised` + border + `0 8 24 /.36` | hero cards, controls over map |
| 3 | `0 4 10 /.06, 0 18 44 /.16` | raised + border + `0 16 40 /.48` | bottom sheets, menus |
| 4 | `0 8 16 /.08, 0 28 72 /.24` | raised + border + `0 24 64 /.60` | dialogs |

Colored glows only on the primary button (indigo) and FAB (volt). Controls over the map are `surface` + level 2 (`IconButton variant="glass"`, `Chip tone="elevated"`), never translucent glass over tiles.

---

## 7. Motion

| Token | Value | Use |
|---|---|---|
| `springs.press` | damping 26 · stiffness 520 · mass 0.7 | Press-in scale (0.97 buttons, 0.985 cards, 0.92 icon buttons) |
| `springs.snappy` | 22 · 380 · 0.9 | Segmented thumb, chip toggle, tab pill |
| `springs.gentle` | 24 · 220 · 1 | Sheet detents, cards entering |
| `springs.bouncy` | 12 · 260 · 0.9 | Check-in success, pin select |
| `duration.fast/base/slow/sheet` | 120 / 200 / 320 / 280 ms | Fades, cross-fades |
| `duration.shimmer` | 1400 ms | Skeleton sweep |
| `duration.toast` | 4000 ms | Toast dwell |
| `duration.qrRotation` | 30 000 ms | Host QR |

- Easing for timing animations: standard `0.2,0,0,1`, enter `0,0,0.2,1`, exit `0.4,0,1,1`.
- Meaningful motion only: press feedback, selection thumbs, sheet detents, progress rings filling (640ms), live-pin beacon, skeleton shimmer, success celebration (≤ 800ms, once).
- **Reduced motion** (`theme.reducedMotion`): no scale/spring/pulse/shimmer (`usePressScale` becomes a no-op; rings jump to value; skeleton static; live beacon static); durations capped at 120ms (`motionDuration(key, true)`); QR rotation still happens, instantly.
- Never animate more than one large element over the map at once. No autoplay > 5s without pause (WCAG 2.2.2).

---

## 8. Haptics (`Haptics`, `hapticMap`; silent on web)

| Event (`Haptics.trigger(...)`) | Kind | Where |
|---|---|---|
| `tabChange`, `chipToggle`, `segmentChange`, `pinSelect`, `scorePlusMinus` | selection | TabBarItem, Chip, Segmented, map, result stepper |
| `buttonPrimary`, `sheetDetent`, `pullToRefresh` | light | Button primary/accent (default), Sheet, lists |
| `fab`, `joinGame` | medium | Fab, Join game |
| `checkInSuccess`, `publishGame`, `resultSubmitted` | success | Check-in, wizard publish, result |
| `limitReached`, `destructiveConfirm` | warning | 4th sport chip, Delete/Cancel confirm |
| `actionFailed` | error | Failed network action |

Haptics accompany a visible change; never the only feedback. Max one haptic per user action.

---

## 9. Iconography — Phosphor only

- **Library:** `phosphor-react-native` through the curated registry in `@st/ui` (`IconName`, ~100 icons, deep per-icon imports; unused icons are not bundled — verified in the web export).
- **Weights:** `regular` for UI; `fill` for the active tab, selected toggles and glyphs on solid fills (pins, badges); `duotone` for sport and feature illustration (icon wells, stat tiles, chips' sport glyph); `bold` inside buttons and on media.
- **Sizes:** 16 (inline with footnote/caption), 20 (lists, inputs, buttons), 24 (nav, actions, tab bar), 28 (hero/emphasis). Token `iconSizes`.
- **Color:** `textSecondary` by default; `primary` for active; sport `text` for sport glyphs on surfaces; white on gradients/pins.
- **A11y:** decorative by default (`aria-hidden`); pass `label` for a standalone meaningful icon; icon-only buttons are `IconButton` with a required `label`.
- **RTL mirroring** (`directionalIcons`, automatic in `<Icon>`): `ArrowLeft`, `ArrowRight`, `ArrowSquareOut`, `CaretLeft`, `CaretRight`, `PaperPlaneRight`, `SignOut`, `ListBullets`, `ChatCircleText`, `Share`. Never mirrored: sports, objects, `Check`, clocks, `QrCode`, `MagnifyingGlass`, `Plus`, logos, `Translate`.

Semantic map (use these everywhere):

| Concept | Icon | Concept | Icon |
|---|---|---|---|
| Map tab | `MapTrifold` | Games tab | `CalendarStar` |
| Inbox tab | `ChatsCircle` | Profile tab | `UserCircle` |
| Create | `Plus` | Check-in | `MapPin` / success `CheckCircle` |
| Host QR | `QrCode` (scan: `Scan`) | Live | volt `StatusPill tone="live"` (or `Broadcast`) |
| Starting soon | `ClockCountdown` | Waitlist | `Hourglass` |
| Deposit | `Coins` | Women only | `GenderFemale` |
| Private | `LockSimple` | Verified host | `SealCheck` |
| Hosting | `Strategy` | Players | `Users` / `UsersThree` |
| Report | `Flag` | Block | `UserMinus` |
| Translate | `Translate` | Teams reshuffle | `Shuffle` |
| Result | `Trophy` | Settings | `GearSix` |
| Locate me | `GpsFix` | Filters | `SlidersHorizontal` |
| Back | `ArrowLeft` | Disclosure | `CaretRight` |

---

## 10. RTL rules

The app runs RTL for `he` and `ar`. Native: `I18nManager.forceRTL` + reload. Web: `<html dir>` + `direction` on the root (`ThemeProvider`).

### 10.1 Logical properties only
- `marginStart/End`, `paddingStart/End`, `start/end`, `borderStart*`, `borderTopStartRadius…`. `flexDirection: "row"` already follows direction.
- **Forbidden** in `packages/ui` (`test/logical-styles.test.ts`): `marginLeft/Right`, `paddingLeft/Right`, `left:`/`right:`, `textAlign: 'left'|'right'`, `borderLeft*/Right*`, physical corner radii, `row-reverse` as an RTL hack, raw `translateX` (animate the logical `start` offset instead — Segmented thumb, Skeleton shimmer).
- Text alignment: start (default) or center only.

### 10.2 What mirrors

| Mirrors in RTL | Does **not** mirror |
|---|---|
| Directional icons (§9), wizard order, steppers, progress bars, **progress rings** (fill runs counter-clockwise), segmented order, avatar stacks, gradient direction, skeleton sweep | Logos, sport glyphs, map and map markers, QR codes, camera preview, media controls |
| Tab order (Map at the start edge), rail side, chat bubbles (own at end), swipe direction | Numbers, times, scores ("3–1"), phone numbers, "+3"/"99+" counts (LTR isolates) |
| Hero illustration composition (art flips with the floating badges) | Checkmarks, clocks, `Translate` |

### 10.3 Practices
- UI strings follow the UI direction (`Text` sets web `dir`); user content uses `BidiText`; inline `BidiText` keeps the UI paragraph direction with the value FSI-isolated, block mode (chat bubbles) takes the content's direction.
- Inputs: phone, OTP, email, URL, codes → `inputDirection="ltr"`; names/messages `auto`.
- No string concatenation; ICU placeholders + `isolateValues()`.

---

## 11. Bidi text

- Every interpolated user value is wrapped in **FSI…PDI** (`isolate(v)`), numbers/phones/scores/URLs/counts in **LRI…PDI** (`isolate(v, 'ltr')`).
- `stripBidiControls` on all user input before display (Trojan-Source style spoofing); the server strips on write too.
- Chat bubble: `<BidiText mode="block">` — paragraph direction from the first strong character; placement follows the UI; footer time is an LTR isolate.
- Translate: translated text renders with its target language direction and font; "Show original" one tap away.

---

## 12. Accessibility (WCAG 2.2 AA, HIG, Material)

- **Targets:** ≥ 48dp (`hitSlop` on 36dp buttons, 40dp chips, 36/44dp icon buttons). 8dp between adjacent targets.
- **Semantics with `role` / `aria-*` only** (`test/a11y-props.test.ts`): `aria-checked`, `aria-selected` (tabs only), `aria-expanded`, `aria-disabled`, `aria-busy`, `aria-pressed`, `aria-hidden`, `aria-live`, `aria-valuenow/min/max/valuetext` (ProgressRing). Never `accessibilityState`/`accessibilityRole`/`accessibilityLabel` (react-native-web 0.21 ignores them). Allowed: `accessible`, `accessibilityHint`, `accessibilityActions`.
- **Roles by component:** Button/IconButton/Fab/Card(pressable)/GameHeroCard/MapPinMarker/ClusterMarker `button`; Chip `checkbox|radio|tab`; Segmented `radiogroup` + `radio`; TabBar `tablist` + `tab`; ProgressRing `progressbar`; StatusBadge/AvatarStack/Avatar `img`; Toast `status`/`alert`; LargeHeader title `heading`.
- **One focus stop per card** with a summary `accessibilityLabel` ("Football, Sunset 5v5 at Yarkon, today 19:05, 7 of 10 players, 1.2 km, deposit 20 shekels").
- **Color independence:** sport = glyph; status = icon + label + shape; selection = fill + check icon/weight; active tab = fill icon + pill + weight; full game = hollow pin + lock icon.
- **Focus:** 3dp `focusRing` with 2dp offset on every pressable; sheets/modals move focus to the title and return it; web modals trap focus, Escape closes.
- **Dynamic type:** `allowFontScaling` on with per-variant caps (1.3–2×); layouts reflow at 200%. Fixed sizes only for pins, avatars and badges.
- **Motion:** §7 reduced motion. **Dragging alternatives:** sheet handle tap + actions; radius as chips; teams moves via buttons.
- Decorative art (illustrations, gradients, watermark glyphs, dividers) is hidden from assistive tech.

---

## 13. Information architecture and navigation

| Tab | Icon | Purpose | Route |
|---|---|---|---|
| Map (default) | `MapTrifold` | Discover games/venues | `(tabs)/map` |
| Games | `CalendarStar` | Upcoming / hosting / past | `(tabs)/games` |
| Inbox | `ChatsCircle` | Chats + notifications | `(tabs)/inbox` |
| Profile | `UserCircle` | Reliability, stats, settings entry | `(tabs)/profile` |

| Width | Navigation |
|---|---|
| < 768 | `TabBar` (blur on iOS/web, solid on Android, 64dp + safe area, hairline top, active pill + fill icon + semibold label, selection haptic). FAB "Create game" floats 16dp above the tab bar at the end edge. |
| 768–1023 | Rail 80dp at the start edge: volt `Fab` (Create) on top, `TabBarItem vertical` items, Settings `IconButton` at the bottom. |
| ≥ 1024 | Rail + map/list split (list pane 400dp at the start edge). |

Modal flows (Create, Check-in, Result) are full-screen on phones and centered 560dp dialogs on wide web.

---

## 14. Component specs (`@st/ui`)

**Button** — heights 36/48/56, radius 14 (10 for sm), label `headline` (sm `label`), icon 20 bold (`icon` start, `iconEnd` end), gap 8. Variants: `primary` (brand fill + indigo glow on light), `secondary` (tonal `primarySubtle`), `outline` (hairline `borderStrong`), `ghost` (text `primaryText`), `danger`, `accent` (volt + volt glow). Spring press 0.97; haptic `buttonPrimary` on primary/accent. Loading: spinner replaces the icon, width stable, `aria-busy`. One primary per view; footers: primary full-width `lg`, secondary actions as `outline`/`ghost` on one row below.

**IconButton** — 36/44/52 round; `plain` | `tonal` (sunken) | `filled` (brand) | `glass` (surface + elevation 2, over map/media) | `inverse`. Required `label`. Optional `badge` (number or dot), `selected` → `aria-pressed` + fill icon.

**Fab** — 56 round or extended pill; volt gradient + ink `Plus` (bold 24) + volt glow; `tone="primary"` for brand. Medium haptic.

**Chip** — pill, 40 (sm 32). Unselected `surfaceSunken` (dark: + hairline); selected **inverse fill** (ink on light, near-white on dark) + bold `Check`. `sport` shows the duotone sport glyph in sport color. `tone="elevated"` for chips over the map. Roles checkbox/radio/tab.

**Segmented** — sunken track radius 14, padding 3, raised thumb (surface + soft shadow; dark: raised + border) sliding with `springs.snappy`; equal widths; optional icon and count badge per option. `radiogroup`/`radio`.

**Card** — radius 20, padding 16, `elevated` (default) | `outlined` | `filled`; pressable cards scale 0.985.

**GameHeroCard** — the v2 game card (props only):
- *Band* (sport gradient, padding 16, min 104): start: `SportGlyphBadge variant="glass"` 44 squircle; then column: `overline` sport label (white 88%), **time** `title1` bold tabular white (LTR isolate), day · relative `footnote` white; end: `StatusPill` (glass; `live` = volt). Watermark: the sport glyph at 132dp, fill, white 16%, bleeding off the bottom-end corner.
- *Body* (padding 16, gap 12): title `title3` (2 lines, BidiText); `MapPin` 16 + venue `footnote` + "·" + distance (LTR isolate); tag row: host `StatusBadge sm`, deposit pill (`Coins`, warning tone), tags (neutral pills).
- Hairline, then *footer*: `AvatarStack` (sm, max 4, "+N"), `7/10` `statSmall` + "7 of 10 players" caption, `ProgressRing` 40/4 at the end (brand; sport color at ≥ 75%; grey + `LockSimple` when full).
- Elevation 2 (dark: 1 = border). One focus stop with `accessibilityLabel`.

**MapPinMarker** — 40×50 teardrop (`MAP_PIN_ANCHOR` = bottom tip), sport fill, 2.6 white ring, 55% ink hairline, contact-shadow ellipse, white `fill` glyph (46% of width) centered in the head. `selected`: 52×65 + 7px brand halo. `full`: white fill, sport ring 3.2, sport-colored glyph. `live`: volt beacon at the top-end (pulses 1.6s unless reduced motion). Hit area ≥ 48 wide.

**ClusterMarker** — 40/48/56 (<10/<100/≥100) inverse disc, white outer ring, sport-colored **ring segments** proportional to each sport's share (2.5 gaps), tabular count (`999+` max, LTR isolate), layered shadow. Anchor center.

**TabBar / TabBarItem** — see §13. Item: 56×32 pill (`primarySubtle` when active), 24 icon (fill active / regular inactive), 11.5 caption label; badge (count or dot) at the icon's top-end.

**LargeHeader** — action row 52 (back `IconButton` + end actions), eyebrow `footnote`, `largeTitle`, subtitle `callout`, then optional children (Segmented, search). Background = canvas.

**ListItem / ListGroup** — 56+ rows: 36 squircle icon well (duotone icon on tone tint, or sport tint), title `body`, subtitle `footnote`, value `callout` tertiary, trailing slot, `CaretRight` 18 bold tertiary (mirrors). Groups: overline header (start-inset 16), radius-20 card at elevation 1, inset hairlines, footnote footer. `destructive` → danger text + danger well.

**StatTile** — elevation 1, radius 20, padding 16; 36 icon well (brand or sport tint, duotone); `numeric` value; `footnote` label; optional caption (+3 this month, positive tone). 2×2 grid on Profile.

**ProgressRing / ReliabilityRing** — SVG arc, round caps, track `surfaceSunken`, optional two-stop gradient, animates from 0 (640ms), mirrors in RTL. ReliabilityRing 132: stroke 12, status solid color, % at 24% of size + label.

**Avatar / AvatarStack** — jewel-tone fills (≥ 4.5:1 white initials), Rubik 600 initials; `ring` for stacks/media; stack overlap 30%, "+N" bubble on sunken.

**StatusBadge / StatusDot / StatusPill** — §4; StatusPill tones neutral/brand/success/warning/danger/info/live/glass, 24 (sm) or 30 tall, 14/16 bold icon.

**TextField** — label `label` secondary above; field 52, radius 14, **filled** `surfaceSunken`; focus: surface + 2dp `focusRing` border + 4dp brand halo; error: danger border + `WarningCircle` + footnote message (live region). Optional start `icon`.

**Sheet** — radius 28 top, grabber 36×5 (`textTertiary` 40%), elevation 3, detents with `springs.gentle` and a light haptic; handle is a button with expand/collapse actions.

**Skeleton / SkeletonText / SkeletonGameCard** — `skeleton` blocks with a highlight sweep from the start edge (1.4s); static with reduced motion; containers set `aria-busy`.

**Toast** — inverse card radius 20, 32 tone disc (success green, error red, warning amber, info sky, neutral brand) with bold icon, title `label` 600 + message footnote 78%, optional action (indigo on inverse) and close. Top of screen under the status bar; 4s; `status`/`alert`.

**Gradient** — expo-linear-gradient with tokens; RTL-aware.

**Illustration** — 160 (120 in cards) SVG spot art: `emptyGames`, `noChat`, `noNotifications`, `success`, `location`, `ageGate`, `offline`, `error`. Brand blob backdrop, contact shadow, indigo gradient objects, volt accents; no text; themed for dark.

**AuthHero / BrandMark** — night-stadium panel (brand-night gradient, floodlight beams, faint perspective pitch, volt ball flight), four floating solid sport badges in the top-end quadrant, brand mark + wordmark top-start, `display` headline + body subtitle at the bottom; bottom corners 28; always dark.

**EmptyState** — Illustration + `title2` + `callout` body + primary (with icon) and ghost actions.

**Haptics** — `Haptics.selection()/light()/medium()/success()/warning()/error()`, `Haptics.trigger(event)`; no-op on web.

---

## 15. Screen-by-screen v2 layouts

Shared rules: skeletons not spinners (show after 300ms); offline = warning `Toast`/banner "You're offline. Showing saved info."; every error says what happened + Retry. Gutters 16. Section spacing 24.

### 15.1 Auth: phone → OTP → age → onboarding
- **Phone:** `AuthHero` (height 380 + safe top; headline "Find a game. Show up. Play.") then a sheet-like panel (canvas, overlapping the hero by 0 — content starts 24 below): `title2` "What's your phone number?", `callout` helper, country picker as a `TextField`-styled select with flag + dial code, phone `TextField icon="Phone" inputDirection="ltr"`, primary `lg` full-width "Send code", legal footnote with links. Demo hint as an info `StatusPill`.
- **OTP:** `LargeHeader` with back, title "Enter the code", subtitle "Sent to +972 …" (LTR isolate) + "Change"; 6 boxed cells (52×56, radius 14, sunken; focused cell brand border) rendered over one input; countdown footnote → "Resend code" ghost. Success → light haptic.
- **Age gate:** `Illustration ageGate` (120), title2 + copy, month/year selects side by side, primary "Continue". Under-18 stop: `EmptyState tone="restricted"`.
- **Onboarding:** title "Set up your profile"; name field; "Your sports" as a 2-column grid of **sport tiles** (Card filled, `SportGlyphBadge tint` 40 + name; selected = sport-colored 2dp border + check), positions as chips; primary "Start playing".
- **Location pre-prompt:** bottom sheet with `Illustration location`, title, body, primary "Allow location", ghost "Not now".

### 15.2 Map (home)
- Full-bleed map (light/dark tiles by scheme). **Top overlay** (safe top + 8): one row — search field (sunken→surface, elevation 2, `MagnifyingGlass`, radius 14, flex) + `IconButton glass` `SlidersHorizontal` (opens filter sheet with sport chips + radius segmented). Below: a horizontally scrolling row of **elevated sport chips** (max 3, `tone="elevated"`). The radius chips move into the filter sheet (v1 spent a whole row on them).
- **Radius:** a subtle 1.5dp dashed brand circle with 6% fill, shown only while changing radius (fades out after 1.2s; static with reduced motion).
- **Markers:** `MapPinMarker` per game, `ClusterMarker` for clusters; tap pin → `selected` + selection haptic + sheet scrolls to the card.
- **End-edge stack** above the sheet: `IconButton glass` `GpsFix`, `ListBullets` (list view).
- **Sheet** (peek 148 / half 45% / full): header row — `title3` "8 games nearby" + sort as a small tonal `Segmented` (Soonest | Nearest); body: `GameHeroCard`s, gap 12; venues after games as `ListItem`s with sport wells.
- **FAB** (volt, 56) at end edge 16 above the sheet peek.
- States: loading → 2 `SkeletonGameCard`; empty → `EmptyState emptyGames` ("No games within 5 km", Widen to 10 km / Create a game); location denied → search prompt card; error → `EmptyState error` + Retry.

### 15.3 Venue sheet
Half detent. Header: `SportGlyphBadge`s of sports offered, venue `title2` (BidiText), `MapPin` + address + distance, actions row: primary "Start a game here", outline "Directions" (`ArrowSquareOut`). Rating row: big `numeric` 4.2 + stars (`Star` fill, volt-free, warning color) + "38 ratings"; attributes as `ListGroup` rows with a 5-segment meter. "Upcoming here" `GameHeroCard`s. Footer ghost "No venue here? Report it" (`Flag`).

### 15.4 Game details
- **Hero:** full-width sport gradient header (height 220 + safe top, bottom corners 28): top row back `IconButton inverse-on-media` (white glyph on 20% white), share and overflow at the end; sport overline; title `title1` white (2 lines); time row `title2` tabular + date; watermark glyph 180dp at 14%.
- **Facts strip** (overlapping the hero by −24, Card elevation 2, radius 20): three columns separated by hairlines — Players `7/10` (`statSmall`) + ProgressRing 32 · Starts `in 45 min` · Distance `1.2 km`; below, pills: deposit, women only, private, level.
- **Venue card:** `ListItem` with `MapPin` well, venue + address, trailing "Directions" link; hidden location → `LockSimple` + "Exact spot shared after the host approves you".
- **Host:** `ListItem` Avatar md, "Hosted by Yossi", `SealCheck` verified, trailing `StatusBadge sm`.
- **Players:** `title3` "Players · 7/10" + AvatarStack; `ListGroup` of participants (Avatar + name + StatusDot + position chips; "Checked in" success pill). Host-only sections "Requests" (approve = primary sm, reject = outline sm) and "Waitlist".
- **Sticky footer** (surface + top hairline, blur on iOS/web): primary `lg` full-width by state (Join game `Lightning` / Request to join / Join waitlist #3 / Check in `MapPin`); below it one row of `IconButton tonal`s — Chat (`ChatsCircle`, unread badge), Directions, Share — and a ghost "Can't make it". Deposit disclosure line above the button when relevant.
- States: cancelled banner (danger tone card), ended → Result + Rate host.

### 15.5 Create game wizard
Full-screen modal. Header: close `X`, title "Create game", **segmented progress** (5 equal bars, brand fill, 4dp, gap 4; mirrors), "Step 2 of 5" caption (live). Step 1 Sport: 2×3 grid of sport tiles (as onboarding) + title field + team count `Segmented`. Step 2 Where: search field + venue `ListItem`s with sport wells and distance; map pin-drop card; "Hide exact location" switch row. Step 3 When: day chips (horizontal scroll), time field, duration `Segmented`. Step 4 Who: capacity and minimum players as big steppers (`IconButton tonal` −/+ around a `statLarge` value), visibility as two selectable cards (`GlobeHemisphereWest` public / `LockSimple` private), women-only switch row. Step 5 Deposit: switch + amount field + explainer card (`Coins`). Review: `ListGroup` with an "Edit" per row. Footer: outline Back + primary Next/Publish (`lg`). Publish → `Illustration success` screen + share buttons (WhatsApp, Copy link) + success haptic.

### 15.6 Teams
Two team cards side by side (stacked < 360dp): header with bib pattern (Team A solid brand, Team B striped neutral) + name + average; players as rows with position chips. Balance card: `ProgressRing` (balance score) + "Balanced · rating diff 0.3". Footer: outline `Shuffle` "Reshuffle" + primary `LockSimple` "Lock teams".

### 15.7 Chat
Header: back + sport badge 32 + game title + time; info `StatusPill` "Messages disappear 3h after the game". Bubbles: radius 20 with a 6 tail corner at the sender side; own `primary` fill / white text at the end, others `surface` elevation 1 at the start; author name + StatusDot above the first of a group; time footer caption (LTR). Composer: sunken field radius 24 + send `IconButton filled` (`PaperPlaneRight`, mirrors). Nudge/block cards: warning/danger `Toast`-styled inline cards above the composer. Empty: `EmptyState noChat`.

### 15.8 Check-in
Center stage `ProgressRing` 200 (stroke 14, `live` gradient) with `MapPin` 48 fill inside → on success morphs to `CheckCircle` + bouncy spring + success haptic + "You're checked in" `title1`. Accuracy text under it (live region). "Other ways" `ListGroup`: Scan host QR (`Scan`), Enter code (`QrCode`), Ask a teammate (`UsersThree`).

### 15.9 Host QR
Dark `brandNight` full screen (always dark, keep awake). QR on white 280 in a radius-28 card, 30s countdown as a ring around a small timer pill under it; 6-digit fallback code in `numeric` tabular with letter-spacing 4; checked-in counter "7 of 10 checked in" with AvatarStack. Secondary: "Mark players manually" outline (white).

### 15.10 Result
Two team columns with big `statLarge` scores between −/+ `IconButton tonal lg` steppers (selection haptic), "–" separator, LTR isolate preview "2–1"; window countdown `StatusPill info`. Primary "Submit result" → success toast + haptic.

### 15.11 Games tab
`LargeHeader` ("Games", subtitle "3 upcoming") with `Segmented` Upcoming | Hosting | Past (counts). Section headers as overlines ("You're in", "On the waitlist", "Hosting") above `GameHeroCard`s. Pull to refresh (light haptic). Empty: `EmptyState emptyGames` + "Find a game".

### 15.12 Inbox
`LargeHeader` "Inbox" + `Segmented` Notifications | Chats (unread counts). Notifications: `ListItem` rows with tone wells (`ShieldWarning` warning for sanctions, pinned first with "Pinned until you read it" pill; `UserPlus` brand for requests), unread dot at the end. Chats: rows with sport badge 40, game title, last message, time, unread count. Empty: `noNotifications` / `noChat`.

### 15.13 Profile
Header band: `brandNight` gradient panel (radius 28 bottom) with Avatar xl (ring), name `title1` white, "Member since" footnote, sports as glass chips with glyphs; settings `IconButton` (`GearSix`) at the end of the top row. **Reliability card** (elevation 2, overlapping the band by −32): `ReliabilityRing` 132 at the start + `StatusBadge` + "Based on your last 90 days…" + yellow-card row (`Warning`) + "How this works" link. **Stats** 2×2 `StatTile`s (Games played `SoccerBall`, Verified check-ins `CheckCircle`, As host `Strategy`, No-shows `Prohibit`). Sports & positions as `ListGroup` rows with sport wells. Sanctions: warning-tone `ListItem` → §15.14. History: compact game rows.

### 15.14 Sanctions
Calm: `LargeHeader` "Account status"; status card (warning tint, `ShieldWarning` well, what applies + "Ends in 6 days" `statSmall`); statement of reasons as `ListGroup` sections; "Way back" card with a progress ring ("Show up to 2 more games"); primary "Appeal" / "Dispute this card"; appeal timeline as a vertical stepper (dots + hairline, mirrors).

### 15.15 Settings and language
`LargeHeader` "Settings". `ListGroup`s: Account (Phone, Linked logins), Preferences (Language `Translate` info, Theme `Moon` neutral, Notifications `Bell` warning), Privacy & safety (`ShieldCheck` success, Blocked users `UserMinus`), Legal (`FileText`), Danger zone (`Trash` destructive "Delete account"), Sign out (`SignOut` destructive, no chevron). Version caption centered. Theme: `Segmented` System | Light | Dark with icons. Language: `ListGroup` of native names (each in its own script), radio semantics, selected = brand `Check` at the end; "Use device language" on top.

---

## 16. UX copy principles

Voice: a friendly captain. Short, direct, active, second person.
1. Say what happened, then what to do ("Couldn't load games. Check your connection and try again.").
2. Buttons are verbs describing the result ("Join game", "Publish game").
3. No blame for system/device limits ("We can't confirm your location yet").
4. Sanctions: fact, rule, consequence, duration, way back, appeal — neutral, no shaming, no exclamation marks; say whether a human was involved.
5. Moderation nudges explain and offer a choice.
6. Deposit copy: amount, when held, when released, cancel rule — before payment; "hold", not "charge".
7. Inclusive/global: no idioms, gender-neutral where possible, ICU `select` for he/ar, no emoji in system copy.
8. Numbers and dates via `Intl`; relative + absolute on details.
9. Titles ≤ 40 chars, buttons ≤ 20 (en), card body ≤ 2 lines; design for +40%.
10. Empty states invite action ("No games nearby yet. Be the first.").

---

## 17. `@st/ui` API inventory and migration

### 17.1 Exports
- **Tokens:** `palette`, `colors`, `lightColors`, `darkColors`, `contrastPairs`, `sportColors`, `sportKeys`, `gradients`, `reliabilityColors`, `avatarFills`, `spacing`, `radius`, `iconSizes`, `sizing`, `borderWidth`, `typography`, `fontWeights`, `elevation`, `motion`, `motionDuration`, `hapticMap`, `zIndex`, `tokens`, `RADIUS_OPTIONS_KM`, `MAX_SPORT_FILTERS`.
- **Fonts:** `fontStacks`, `brandFont`, `legacyFontStacks`, `fontFamilyForLocale/Script`, `fontAssetNames`, `fontGroupsForLocale`, `bundledScripts`, `requiredFontPackages`, `googleFontsCssUrl`, `typeStyleFor`, `scriptForLocale`, `detectScript`, `isRtlLocale`, `supportedLocales`, `localeNativeNames`; RN: `fontAssets`, `fontAssetsForLocale`, `useAppFonts(locale)`.
- **Theme:** `ThemeProvider` (`locale`, `brandFonts`, `fontsLoaded` (legacy), `initialPreference`, `onPreferenceChange`, `direction`), `useTheme()` (+ `sport(key)`, `gradients`, `brandFonts`), `useMirrorStyle`.
- **Icons:** `Icon`, `SportIcon`, `SportGlyphBadge`, `IconName`, `iconRegistry`, `iconNames`, `resolveIcon`, `directionalIcons`, `isDirectionalIcon`, `legacyIconMap`.
- **Components:** `Text`, `Button`, `IconButton`, `Fab`, `Chip`, `SportDot` (deprecated), `Segmented`, `Card`, `GameHeroCard`, `ListItem`, `ListGroup`, `StatTile`, `ProgressRing`, `ReliabilityRing`, `Sheet`, `StatusBadge`, `StatusDot`, `StatusPill`, `PinBadge`/`ClusterBadge` (deprecated), `MapPinMarker`, `ClusterMarker`, `MAP_PIN_ANCHOR`, `mapPinSize`, `TabBar`, `TabBarItem`, `LargeHeader`, `Skeleton`, `SkeletonText`, `SkeletonGameCard`, `Toast`, `Gradient`, `Illustration`, `BrandMark`, `AuthHero`, `BidiText`, `Stack`, `Row`, `TextField`, `Avatar`, `AvatarStack`, `EmptyState`, `Divider`, `Mirror`, `Haptics`, `usePressScale`; bidi/color helpers as v1.

### 17.2 Back-compat (app keeps compiling)
- All v1 names still exported. `Button variant="secondary"` is now **tonal**; use `outline` for the old look. `Card outlined` → `variant="outlined"`. `fontsLoaded` keeps the Noto mapping; switch to `brandFonts={useAppFonts(locale)}` to get Rubik.
- `sportColors[s].icon` (MCI name) and `.shape/.glyph` remain (deprecated); new `.phosphor`, `.gradient`, `.tint`, `.text`.
- `PinBadge`/`ClusterBadge` keep the v1 center anchor; `MapPinMarker` anchors at the tip (`MAP_PIN_ANCHOR`) — change the marker anchor when migrating.

### 17.3 Migration steps for app developers
1. Root: `const brandFonts = useAppFonts(locale)` (from `@st/ui`) → `<ThemeProvider brandFonts={brandFonts}>`; delete `src/platform/fonts*.ts`.
2. Replace `src/components/Icon.tsx` with `@st/ui`'s `Icon` (Phosphor names, `legacyIconMap` for the table in §17.4); outline/filled pairs become `weight="regular" | "fill"`.
3. `AppNav` → `TabBar` + `TabBarItem` (wrap in `TabTrigger asChild`; keep `testID`s); rail → `TabBarItem vertical` + `Fab`.
4. `GameCard` → `GameHeroCard`; `ReliabilityBadge` → `StatusBadge`/`ReliabilityRing`; `SegmentedControl` → `Segmented` (keeps `aria-checked` on segments); settings rows → `ListGroup`/`ListItem`; `States.tsx` → `EmptyState` + `Skeleton*`; `Toast` visuals → `Toast`.
5. Map: `PinBadge` → `MapPinMarker` (anchor bottom), `ClusterBadge` → `ClusterMarker` with per-sport counts.

### 17.4 MaterialCommunityIcons → Phosphor (every name used in apps/mobile-web/src)

| MCI | Phosphor | MCI | Phosphor |
|---|---|---|---|
| account-cancel(-outline) | UserMinus | map-marker-check | CheckCircle (check-in) |
| account-circle(-outline) | UserCircle | map-marker-plus-outline | MapPinPlus |
| account-group | UsersThree | map-marker-radius(-outline), map-outline | MapTrifold |
| account-plus-outline | UserPlus | message-off-outline | ChatSlash |
| alert-circle-outline | WarningCircle | message-text(-outline) | ChatsCircle |
| alert-outline | Warning | minus / plus | Minus / Plus |
| arrow-left | ArrowLeft | open-in-new | ArrowSquareOut |
| bell-outline | Bell | party-popper | Confetti |
| calendar-clock | CalendarDots | pencil-outline | PencilSimple |
| calendar-remove-outline | CalendarX | phone(-outline) | Phone |
| calendar-star(-outline) | CalendarStar | qrcode-scan | QrCode |
| check / check-circle(-outline) | Check / CheckCircle | radar | Broadcast |
| check-decagram(-outline) | SealCheck | refresh | ArrowClockwise |
| chevron-down/up/right | CaretDown/CaretUp/CaretRight | scoreboard-outline | Trophy |
| circle-outline | Circle | send | PaperPlaneRight |
| clock-fast | ClockCountdown | shield-alert-outline | ShieldWarning |
| clock-outline | Clock | shield-check-outline | ShieldCheck |
| close / close-circle-outline | X / XCircle | shield-lock-outline (deposit) | Coins |
| cog-outline | GearSix | timer-sand | Hourglass |
| crosshairs-gps | GpsFix | translate | Translate |
| delete-outline | Trash | whistle-outline (hosting) | Strategy |
| dots-horizontal | DotsThree | soccer · basketball · tennis | SoccerBall · Basketball · TennisBall |
| download-outline | DownloadSimple | racquetball · run-fast · volleyball | Racquet · PersonSimpleRun · Volleyball |
| earth | GlobeHemisphereWest | email-outline | EnvelopeSimple |
| file-document-outline | FileText | flag-outline | Flag |
| format-list-bulleted | ListBullets | gender-female | GenderFemale |
| lock-outline | LockSimple | magnify | MagnifyingGlass |

---

## 18. Tooling and requests

**Screenshot tour** — `apps/mobile-web/scripts/screens.mjs` (Playwright, Pixel 7, static server with SPA fallback, in-app navigation only):
```
EXPO_PUBLIC_DATA=mock npx expo export --platform web --output-dir dist   # in apps/mobile-web
node scripts/screens.mjs                                  # all screens × en,he × light,dark
node scripts/screens.mjs --only map,game,design --locale he --scheme dark
node scripts/screens.mjs --list                           # screen names
SCREENS_OUT=/tmp/shots node scripts/screens.mjs --full    # scrolled screens as .NN.png parts
```
Screens: phone, otp, age, onboarding, map, map-list, venue-sheet, game, chat, checkin, games, result, inbox, profile, sanctions, settings, language, create-1…5, create-review, game-host, host-qr, teams, design.

**Requests:**
- *App devs:* §17.3 migration; add the `screens.mjs` run to visual QA; consider an app-wide ESLint rule mirroring `logical-styles.test.ts`.
- *i18n:* keys for the new copy (§15), ICU for "N of M players", "+N".
- *QA:* axe on each screen in en/he/ar; 200% text; reduced-motion pass; CVD spot checks of the map (glyphs must stay legible at 40dp).
