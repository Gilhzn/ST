# Sport Talent Design System

**Owner:** UI/UX Expert. **Code:** `packages/ui` (`@st/ui`). **Status:** v1 for Core MVP (M1c).

This document is the source of truth for visual language, interaction rules, RTL/i18n behaviour, accessibility and screen-level UX. Token values live in `packages/ui/src/tokens.ts`. The tests in `packages/ui/test` enforce the numbers quoted here, so if this doc and the code disagree, the code wins and this doc is the bug.

Contents:
1. Brand direction
2. Color system
3. Sport color coding (map pins)
4. Reliability status
5. Typography and per-script fonts
6. Spacing, radius, sizing, elevation
7. Motion
8. Iconography
9. RTL rules
10. Bidi text (chat, names, numbers)
11. Accessibility
12. Information architecture and navigation
13. Screen specs
14. UX copy principles
15. `@st/ui` component inventory and how the app consumes it
16. Requests to other owners

---

## 1. Brand direction

**Personality:** *energetic, trustworthy, sporty, fair.* We're the referee and the scoreboard of pickup sport. We are not a fitness-tracker gradient and not a generic blue SaaS.

| Principle | What it means in UI |
|---|---|
| **Night Court + Volt** | Deep indigo (`#4B2FE0`) carries trust. Volt yellow‑green (`#C5F230`) carries energy. Volt is only ever a *fill* with ink text on it (14:1), never text on white. One volt moment per screen: the Create‑Game FAB, "Live now" markers, the reliability meter tip, the "lane line" on starting‑soon cards. |
| **Scoreboard clarity** | Numbers (players 6/10, scores, countdowns, km, %) use tabular figures (`numeric` variant, `fontVariant: tabular-nums`) and bold weight. Information is scannable at arm's length outdoors. |
| **The lane line** | A 4dp volt bar on the *start* edge of a card (`Card accentEdge`) marks "starting within 2h / live". It mirrors in RTL. It's our signature motif and replaces decorative gradients. |
| **Fair play, not punishment** | Trust UI (cards, bans) is calm and specific. We use neutral surfaces with a status pill. We never show a full‑screen red takeover, and we always offer a next step. |
| **Outdoor‑ready** | High contrast (body ≥ 15:1), large hit areas (48dp), light theme default in daylight, dark theme for evening games and OLED battery. |
| **Global by default** | No idioms in iconography. Shapes and icons carry meaning, not color alone. Every layout works mirrored. |

**Avoid:** stock gradients, glassmorphism over maps (it kills contrast on tiles), emoji as primary UI icons (OK as a fallback only), ALL CAPS outside Latin, and red as a brand color (red is reserved for danger and the red status).

---

## 2. Color system

Components only use **semantic tokens** (`theme.colors.*`). They never use raw palette values. Light and dark are separate sets with the same keys (`lightColors`, `darkColors`).

### 2.1 Semantic tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `background` | `#F6F7FB` | `#0A0B12` | App canvas |
| `surface` | `#FFFFFF` | `#14151F` | Cards, rows |
| `surfaceRaised` | `#FFFFFF` | `#1C1E2B` | Sheets, menus. In dark mode, elevation = lighter surface. |
| `surfaceSunken` | `#EDEEF4` | `#0F1018` | Inputs, skeleton, segmented track |
| `surfaceInverse` / `textInverse` | `#12131C` / `#F2F3F8` | `#F2F3F8` / `#12131C` | Toasts, cluster pins |
| `text` | `#12131C` | `#F2F3F8` | Primary text |
| `textSecondary` | `#4B4E63` | `#B4B7CA` | Metadata |
| `textTertiary` | `#62667D` | `#9094AB` | Placeholders, helper text, timestamps (still AA) |
| `border` | `#D6D8E3` | `#2B2E40` | Decorative hairlines |
| `borderStrong` | `#8A8EA6` | `#6B6F88` | Input/chip outlines (≥ 3:1, WCAG 1.4.11) |
| `primary` / `onPrimary` | `#4B2FE0` / `#FFF` | `#9A8CFF` / `#0A0B12` | Primary actions |
| `primaryPressed` | `#3A21C0` | `#B3A8FF` | Pressed |
| `primarySubtle` / `onPrimarySubtle` | `#ECE9FF` / `#3A21C0` | `#262247` / `#C9C1FF` | Selected chips, info highlights |
| `primaryText` | `#4126D6` | `#B3A8FF` | Links, ghost buttons |
| `accent` / `onAccent` | `#C5F230` / `#12131C` | `#D2FF45` / `#0A0B12` | Volt moments (FAB, live) |
| `danger` / `onDanger` / `dangerText` / `dangerSubtle` | `#C21E2B` / `#FFF` / `#A8141F` / `#FDE7E8` | `#FF6B73` / `#0A0B12` / `#FF9198` / `#3A1418` | Destructive actions, errors |
| `success…` | `#1A7F3C` / `#FFF` / `#146B31` / `#E2F4E7` | `#4CD07D` / `#0A0B12` / `#6EE59A` / `#10301D` | Confirmations |
| `warning…` | `#F5B700` / `#12131C` / `#6B4A00` / `#FFF3CC` | `#FFC83D` / `#0A0B12` / `#FFD466` / `#33280A` | Caution, offline |
| `info…` | `#0B5FB0` / — / `#0A4F93` / `#E3EFFB` | `#6CB4FF` / — / `#8EC6FF` / `#0E2540` | Neutral notices |
| `focusRing` | `#4B2FE0` | `#9A8CFF` | 3dp focus outline, 2dp offset |
| `scrim` | `rgba(10,11,18,.52)` | `rgba(0,0,0,.64)` | Modal backdrop |
| `pinRing` / `pinOutline` | `#FFF` / `#12131C` | `#0A0B12` / `#F2F3F8` | Map pin double ring |

Dark mode is not inverted light mode. Primary becomes a lighter lavender with **ink text** on it. Shadows are replaced by lighter surfaces (`elevation[dark][n].surface`).

### 2.2 Verified contrast (WCAG 2.2 AA)

Computed with the WCAG relative‑luminance formula (`packages/ui/src/color.ts`) and asserted in `test/tokens.test.ts`. Minimums: text 4.5:1 (1.4.3) and non‑text UI 3:1 (1.4.11).

| Pair (fg on bg) | Use | Light | Dark | Min |
|---|---|---|---|---|
| `text` on `background` | body on canvas | **17.27** | **17.72** | 4.5 |
| `text` on `surface` | body on cards | **18.49** | **16.38** | 4.5 |
| `text` on `surfaceRaised` | body on sheets | **18.49** | **14.92** | 4.5 |
| `text` on `surfaceSunken` | input text | **15.97** | **17.11** | 4.5 |
| `textSecondary` on `background` | metadata | **7.64** | **9.88** | 4.5 |
| `textSecondary` on `surface` | metadata on cards | **8.17** | **9.13** | 4.5 |
| `textSecondary` on `surfaceRaised` | metadata on sheets | **8.17** | **8.32** | 4.5 |
| `textTertiary` on `surface` | placeholder/helper | **5.65** | **6.06** | 4.5 |
| `textTertiary` on `surfaceRaised` | helper on sheets | **5.65** | **5.52** | 4.5 |
| `textTertiary` on `surfaceSunken` | placeholder | **4.88** | **6.33** | 4.5 |
| `textInverse` on `surfaceInverse` | toast | **16.69** | **16.69** | 4.5 |
| `onPrimary` on `primary` | primary button | **7.55** | **7.08** | 4.5 |
| `onPrimary` on `primaryPressed` | pressed | **9.73** | **9.31** | 4.5 |
| `onPrimarySubtle` on `primarySubtle` | selected chip | **8.18** | **8.95** | 4.5 |
| `primaryText` on `surface` | link | **8.49** | **8.61** | 4.5 |
| `primaryText` on `background` | link on canvas | **7.93** | **9.31** | 4.5 |
| `onAccent` on `accent` | volt FAB/badge | **14.19** | **16.95** | 4.5 |
| `onDanger` on `danger` | danger button | **5.98** | **7.11** | 4.5 |
| `onDanger` on `dangerPressed` | pressed | **7.54** | **9.12** | 4.5 |
| `dangerText` on `surface` | error text | **7.54** | **8.43** | 4.5 |
| `dangerText` on `dangerSubtle` | error banner | **6.38** | **7.54** | 4.5 |
| `onSuccess` on `success` | success button | **5.07** | **9.94** | 4.5 |
| `successText` on `successSubtle` | success banner | **5.77** | **9.12** | 4.5 |
| `onWarning` on `warning` | warning fill | **10.26** | **12.70** | 4.5 |
| `warningText` on `warningSubtle` | warning banner | **7.27** | **10.26** | 4.5 |
| `infoText` on `infoSubtle` | info banner | **7.05** | **8.60** | 4.5 |
| `infoText` on `surface` | info text | **8.23** | **10.09** | 4.5 |
| `disabledText` on `disabledBg` | disabled (exempt; kept legible) | **4.88** | **5.52** | 3 |
| `borderStrong` on `surface` | input outline | **3.23** | **3.68** | 3 |
| `borderStrong` on `background` | chip outline | **3.02** | **3.98** | 3 |
| `focusRing` on `background` | focus | **7.05** | **7.08** | 3 |
| `focusRing` on `surface` | focus on cards | **7.55** | **6.54** | 3 |
| `pinOutline` on `mapBase` | pin vs tiles | **16.11** | **15.19** | 3 |

Rule: if you add a text/background combination to a component, add it to `contrastPairs` and the test checks it automatically.

---

## 3. Sport color coding (map pins)

Fills come from the **Okabe–Ito** palette, designed for color‑vision deficiency. Color is never the only cue. Each sport also has a **unique silhouette** and a **unique icon**.

| Sport | Fill | Glyph color / ratio | Shape | Icon (MaterialCommunityIcons) | Fallback glyph |
|---|---|---|---|---|---|
| Football | `#009E73` bluish green | ink, 5.74 | circle | `soccer` | ⚽ |
| Basketball | `#D55E00` vermillion | ink, 5.08 | rounded square | `basketball` | 🏀 |
| Tennis | `#F0E442` yellow | ink, 14.85 | diamond | `tennis` | 🎾 |
| Padel | `#0072B2` blue | white, 5.19 | shield | `racquetball` | 🏓 |
| Running | `#CC79A7` reddish purple | ink, 6.41 | horizontal pill | `run-fast` | 🏃 |
| Volleyball | `#E69F00` orange | ink, 8.72 | vertical capsule | `volleyball` | 🏐 |

**Distinctness:** the smallest pairwise CIE76 ΔE is 33.4 in normal vision (basketball/volleyball). Under simulated CVD (Machado 2009, severity 1) it's 22.5 for protanopia (padel/running), 16.9 for deuteranopia (tennis/volleyball) and 16.5 for tritanopia (football/padel). Tests assert ΔE ≥ 25 normal and ≥ 15 for each CVD type. The weakest pairs differ in shape (diamond vs capsule, circle vs shield) and in icon.

**Pin anatomy** (`PinBadge`): fill + 2dp `pinRing` + 1dp `pinOutline` + soft shadow. The outline gives ≥ 15:1 against light and dark tiles, so even yellow (tennis) on cream tiles stays visible.
- **Hit area:** 48dp, whatever the visual size. Visual size is 36dp, or 44dp when selected.
- **States:**
  - `default`;
  - `selected`: +8dp primary ring and a larger size;
  - `live`: volt ring, with a slow 2s pulse only when reduced motion is off;
  - `full`: **hollow** (surface fill, sport‑colored 3dp border, same icon), so "full" isn't conveyed by color either.
- **Clusters** (`ClusterBadge`): an ink (`surfaceInverse`) circle with a tabular count, sized in 3 tiers (36/44/52) by count (<10, <100, ≥100), and up to 3 mini sport shapes underneath. Tapping zooms to the cluster's expansion zoom. The screen‑reader label reads "12 games: football, tennis. Double‑tap to zoom in."
- **Legend:** the filter chips double as the legend (`Chip sport=` shows the same shape and color), so no separate legend is needed.
- **Venue pins** (no game) use the same shape with a 60% size and the `surface` fill plus a sport‑colored border. Games always outrank venues visually.

Adding a sport requires a new color that passes the ΔE tests, a new unused shape (or icon‑only, if we run out of shapes) and a design review.

---

## 4. Reliability status

The status is derived by the domain (`green` = no yellow card and ≥ 85%, `red` = ban or < 60%, `new` = < 3 games, else `yellow`). The UI **always** shows *glyph + label* (+ % when not new). Shape differs too: rounded pill for green and new, squared corners for yellow and red, and a dashed outline for new.

| Status | Glyph | Example label (en) | Light fg/bg → ratio | Dark fg/bg → ratio | Solid vs surface (L/D) |
|---|---|---|---|---|---|
| green | ✓ | Reliable · 92% | `#146B31`/`#E2F4E7` → 5.77 | `#6EE59A`/`#10301D` → 9.12 | 5.07 / 9.19 |
| yellow | ! | Caution · 74% | `#6B4A00`/`#FFF3CC` → 7.27 | `#FFD466`/`#33280A` → 10.26 | 3.63 / 11.74 |
| red | ✕ | Restricted · 52% | `#A8141F`/`#FDE7E8` → 6.38 | `#FF9198`/`#3A1418` → 7.54 | 5.98 / 6.57 |
| new | ✦ | New player | `#33407A`/`#E8EAF6` → 8.13 | `#B9C2FF`/`#1E2236` → 9.14 | 5.37 / 6.59 |

- `StatusBadge` speaks "Reliability: Reliable, 92%". Pass a localized `accessibilityLabel` (component prop; rendered as `aria-label`).
- `StatusDot` (dense lists) is a solid dot with a glyph. It must have an `accessibilityLabel` and must sit next to the name.
- The percentage is wrapped in LRI…PDI so "92%" never reorders inside Arabic or Hebrew text. Locale digit shaping comes from `Intl.NumberFormat`.
- Avoid moralizing labels ("Bad player"). The approved en labels are *Reliable / Caution / Restricted / New player*. The i18n agent owns the translations.

---

## 5. Typography and per-script fonts

### 5.1 Scale (Latin base; `typography` in tokens)

| Variant | Size / line | Weight | Tracking | Max scale | Role |
|---|---|---|---|---|---|
| `display` | 32 / 40 | 700 | −0.5 | 1.4× | Onboarding hero, big countdowns. Header role. |
| `title1` | 26 / 32 | 700 | −0.3 | 1.5× | Screen titles. Header role. |
| `title2` | 22 / 28 | 600 | −0.2 | 1.6× | Section titles |
| `title3` | 18 / 24 | 600 | 0 | 1.8× | Card titles, sheet titles |
| `body` | 16 / 24 | 400 | 0 | 2.0× | Default text |
| `bodyStrong` | 16 / 24 | 600 | 0 | 2.0× | Button labels, emphasis |
| `callout` | 15 / 22 | 500 | 0 | 2.0× | Chat bubbles, list primary |
| `label` | 14 / 20 | 500 | 0.1 | 1.8× | Chips, form labels, small buttons |
| `caption` | 12 / 16 | 400 | 0.2 | 1.8× | Timestamps, helper text |
| `overline` | 12 / 16 | 700 | 0.8, UPPERCASE (Latin/Cyrillic only) | 1.6× | Section eyebrow |
| `numeric` | 28 / 34 | 700 | 0, tabular | 1.4× | Scores, %, countdown |

### 5.2 Font stacks (`src/fonts.ts`)

| Script | Locales | Family (Google / `@expo-google-fonts`) | Web CSS stack (head) |
|---|---|---|---|
| latin (incl. Cyrillic) | en, es, pt, fr, it, de, ru | Noto Sans / `noto-sans` | `"Noto Sans", system-ui, …` |
| hebrew | he | Noto Sans Hebrew / `noto-sans-hebrew` | `"Noto Sans Hebrew", "Noto Sans", Arial, …` |
| arabic | ar | Noto Sans Arabic / `noto-sans-arabic` | `"Noto Sans Arabic", "Noto Sans", Tahoma, …` |
| devanagari | hi | Noto Sans Devanagari / `noto-sans-devanagari` | `"Noto Sans Devanagari", "Noto Sans", "Nirmala UI", …` |
| sc | zh-Hans | Noto Sans SC / `noto-sans-sc` | `"Noto Sans", "Noto Sans SC", "PingFang SC", …` |
| tc | zh-Hant | Noto Sans TC / `noto-sans-tc` | `"Noto Sans", "Noto Sans TC", "PingFang TC", …` |
| jp | ja | Noto Sans JP / `noto-sans-jp` | `"Noto Sans", "Noto Sans JP", "Hiragino Sans", …` |

- **Native** needs one registered family name per weight (`NotoSansArabic_700Bold`). `fontFamilyForLocale(locale, { weight, platform })` returns it. Don't set `fontWeight` together with a weighted family, or Android synthesizes a fake bold. `<Text>` handles this.
- **CJK:** Latin comes first, then the *region‑correct* Han font. Han unification means the same code point has different glyph forms in JP, SC and TC, so `ja` must get the JP font and `zh-Hant` the TC font. On web, also set `<html lang>` (ThemeProvider does this).
- **Mixed content:** user text in another script (an Arabic name in a Hebrew UI) uses `detectScript(text, uiLocale)` → `BidiText`/`Avatar` pick that script's font. Native text engines also do per‑glyph system fallback.
- **Loading strategy:**
  - Native: always bundle Noto Sans and the active locale's family. Lazy‑load the others on language switch.
  - CJK families are several MB each, so never bundle all three in the binary. Fetch them on demand with expo-font from the CDN, and use system CJK until loaded (`fontsLoaded=false` → system font).
  - Web: Google Fonts CSS2 with `display=swap` (`googleFontsCssUrl(scripts)`); `unicode-range` slicing keeps the payload small.

### 5.3 Per-script adjustments (`typeStyleFor(variant, script)`)

| Script | Line-height × | Min size | Tracking | Uppercase | Italic | Android `includeFontPadding` |
|---|---|---|---|---|---|---|
| latin | 1.00 | 12 | yes | yes | yes | false |
| hebrew | 1.05 | 12 | **no** | n/a | **no** (no true italic; use weight) | false |
| arabic | **1.25** (body 16/30) | **13** | **no** (tracking breaks cursive joining) | n/a | **no** | **true** (tall marks clip) |
| devanagari | **1.25** (body 16/30) | **13** | **no** (breaks conjuncts) | n/a | **no** | **true** (shirorekha + matras clip) |
| sc / tc / jp | 1.12 (body 16/27) | 12 | no | n/a | no | false |

Also:
- **Emphasis:** use weight (600/700), never italics or underline (underline is reserved for links).
- **Truncation:** use `numberOfLines`, never character counts. Hindi and German run about 30% longer than English, and CJK about 30% shorter. Buttons wrap to 2 lines before they truncate.
- **Numerals:** use `Intl.NumberFormat(locale)` defaults. Arabic UI may show Arabic‑Indic digits, depending on the locale data. Scores, clocks and phone numbers are LTR isolates (see §10).

---

## 6. Spacing, radius, sizing, elevation

- **Spacing (4pt grid):** `none 0 · xxs 2 · xs 4 · sm 8 · md 12 · lg 16 · xl 24 · xxl 32 · xxxl 48 · huge 64`.
  - Screen gutter `lg` (16); on ≥ 768 it's `xl`.
  - Card padding `lg`.
  - List row min height 56.
  - Gap between stacked form fields `lg`.
  - Gap between chips `sm`.
- **Radius:** `xs 4 · sm 8 · md 12 (inputs) · lg 16 (cards) · xl 24 (sheet top corners) · pill 999 (buttons, chips)`. Corners are logical (`borderTopStartRadius`).
- **Sizing:**
  - Touch target **48** (≥ 44pt iOS / 48dp Android). Avatars 32/40/56/88. Pins 36 (44 selected). FAB 56. Icons 16/20/24.
  - Breakpoints: md 768, lg 1024, xl 1440.
  - Rail 80. Split list pane 400. Max reading width 720.
- **Elevation** (`theme.elevation(level)`): applies a `boxShadow` (RN New Architecture + RNW) and, in dark mode, the lighter surface.
  - 0: flat
  - 1: cards
  - 2: sticky bars, chips over map
  - 3: bottom sheet, menus
  - 4: modal dialogs
  - z-index scale: base 0, sticky 10, fab 20, sheet 30, overlay 40, modal 50, toast 60.
- **Over the map:** controls (chips, radius selector, locate button) sit on `surface` at elevation 2 and never on translucent glass.

---

## 7. Motion

| Token | ms | Use |
|---|---|---|
| `fast` | 120 | Press feedback, chip toggle, focus |
| `base` | 200 | Fades, small moves |
| `slow` | 320 | Screen transitions |
| `sheet` | 280 | Sheet detents (spring `damping 22 / stiffness 240`) |
| `qrRotation` | 30 000 | Host QR refresh (server TOTP step) |

- **Easing (cubic-bezier):** standard `0.2,0,0,1` · enter `0,0,0.2,1` · exit `0.4,0,1,1` · emphasized `0.3,0,0,1.15` (FAB only).
- **Press:** scale 0.97 + pressed color. Hover (web): +opacity.
- **Meaningful motion only:**
  - pin select (scale up), sheet detents, check‑in progress ring, waitlist promotion confetti (≤ 800ms, once);
  - countdowns tick without animation.
- **Reduced motion** (`theme.reducedMotion` from `AccessibilityInfo`; web `prefers-reduced-motion`):
  - no scale/translate/spring/parallax/pulse;
  - durations are capped at 120ms cross‑fades (`motionDuration(key, true)`);
  - the live‑pin pulse becomes a static volt ring, and confetti becomes a static badge;
  - QR rotation still happens (it's functional), as an instant swap.
- **Never** animate more than one large element at once over the map (keeps 60fps on mid‑range Android). No autoplaying motion longer than 5s without a pause control (WCAG 2.2.2).

---

## 8. Iconography

- **Library:** `@expo/vector-icons` → MaterialCommunityIcons (it ships with Expo and covers every sport). Size 24 in nav/actions and 20 inline. Icons get `textSecondary` color by default and `primary` when active.
- **Stroke and style:** outlined icons for inactive tabs and filled for active ones. Active state is never shown by color alone (filled shape + label + indicator bar).
- Glyph fallbacks in `@st/ui` (✓ ! ✕ ✦ and sport emoji) exist so the package has no icon dependency. The app passes real icons via `icon`/`startIcon`.
- **Icon‑only buttons** need `aria-label`, and a tooltip on web hover/focus.
- **Directional icons** are wrapped in `<Mirror>` (see §9). Icons with text baked in (e.g. "A→文" translate) are not mirrored.
- **Semantic icon map** (keep consistent everywhere):
  - Map `map-marker-radius`, Games `calendar-star`, Inbox `message-text`, Network `account-group`, Profile `account-circle`.
  - Create `plus`, Check‑in `map-marker-check`, QR `qrcode-scan`, Report `flag-outline`, Block `account-cancel`, Translate `translate`.
  - Deposit `shield-lock-outline`, Women‑only `gender-female`, Private `lock-outline`, Waitlist `timer-sand`, Verified host `check-decagram`.

---

## 9. RTL rules

The app runs RTL for `he` and `ar`. **Native:** `I18nManager.forceRTL(true)` + reload (restart prompt, §13.17). **Web:** `<html dir>` + the `direction` style on the root (`ThemeProvider`).

### 9.1 Logical properties only
- Use `marginStart/End`, `paddingStart/End`, `start/end`, `borderStartWidth/Color`, `borderTopStartRadius…`. `flexDirection: "row"` already follows direction.
- **Forbidden** in `packages/ui` (enforced by `test/logical-styles.test.ts`, and proposed as an app‑wide ESLint rule):
  - `marginLeft/Right`, `paddingLeft/Right`, `left:`/`right:`;
  - `textAlign: 'left'|'right'`, `borderLeft*/Right*`, physical corner radii;
  - `row-reverse` used as an RTL hack, and raw `translateX` without a direction check.
- **Text alignment:** default/`auto` is start. Only `center` is allowed besides start. Never hard‑align a paragraph to a physical side.

### 9.2 What mirrors

| Mirrors in RTL | Does **not** mirror |
|---|---|
| Back/forward arrows, chevrons (`<Mirror>`) | Logos, brand marks, sport icons |
| List disclosure indicators, breadcrumbs | Media playback controls (play ▶, seek, timelines go LTR) |
| Progress bars, steppers, wizard order, swipe direction (swipe‑to‑reply goes toward start) | **Maps** (geography is absolute), compass, the locate button position follows layout but the map does not |
| Sliders (radius selector min at start), toggles' knob travel | Numbers, phone numbers, scores ("3–1" keeps its order; it's an LTR isolate), clocks and time pickers, charts' time axis |
| Tab order and side rail position (rail on the start side) | Checkmarks ✓, QR codes, camera preview, media thumbnails |
| Icons depicting direction of text (indent, reply arrow, "send" paper plane) | Icons of real‑world objects (ball, whistle, clock hands) |
| Bottom sheet handle stays centered; chat bubbles: own messages at *end* | Translate icon "A→文", keyboard‑shortcut glyphs |

### 9.3 Practices
- Mixed‑direction lists (Hebrew UI with English venue names): each row's text is `BidiText` (auto‑detected direction) while the row layout follows the UI direction.
- Input fields: phone, OTP, email, URL, code, and numbers in forms are `inputDirection="ltr"`. Names and messages use `auto`.
- Concatenating strings in code is forbidden. Use ICU messages with placeholders, and `isolateValues()` for the values.
- QA screenshots are taken in `he` and `ar`, and the e2e test asserts `dir=rtl`. Native gets a visual pass on an RTL device.

---

## 10. Bidi text (chat, names, numbers)

- **Isolation:** every interpolated user value is wrapped in **FSI U+2068 … PDI U+2069** (`isolate(v)`), or **LRI U+2066 … PDI** for numbers, phones, scores and URLs (`isolate(v, 'ltr')`).
  - Example: Hebrew UI "‏{name} הצטרף/ה למשחק" where name = "Dana 2" shows correctly, and the trailing "2" doesn't jump.
- **Sanitize:** strip LRE/RLE/PDF/LRO/RLO and stray isolates from all user input before display (`stripBidiControls`). This prevents spoofed names/messages ("Trojan Source" style), and the server should also strip on write.
- **Chat bubble** (`<BidiText mode="block">`):
  - The paragraph direction comes from the message's first strong character (`detectDirection`), not the UI. An English message in an Arabic UI is left‑aligned inside its bubble.
  - Bubble placement still follows the UI (own messages at the end side).
  - Timestamp and status ticks are an LTR isolate in the bubble footer.
- **Names in sentences:** `<Text>{t('joined', isolateValues({ name }))}</Text>`. A standalone name uses `<BidiText>`.
- **Translate:** the translated text renders with its *target* language direction and font. The original is one tap away ("Show original").

---

## 11. Accessibility (WCAG 2.2 AA, Apple HIG, Material)

- **Touch targets:** ≥ 48dp everywhere (`sizing.touchTarget`). Small visuals extend with `hitSlop` (Button `sm`, Chip 40 → 48). Keep 8dp spacing between adjacent targets (2.5.8).
- **Screen readers:**
  - Every interactive element has a `role` (`button`, `checkbox`, `radio`, `tab`, `link`, `heading`, `img`) and a localized `aria-label`. Labels describe purpose ("Join game"), and `accessibilityHint` (native only) describes the result ("Sends a request to the host").
  - **Use the modern `role` / `aria-*` props** (`aria-checked`, `aria-selected`, `aria-expanded`, `aria-disabled`, `aria-busy`, `aria-hidden`, `aria-live`), never `accessibilityState` / `accessibilityRole` / `accessibilityLabel` / `importantForAccessibility` / `accessibilityLiveRegion`. react-native-web 0.21 ignores `accessibilityState`, so selection never reaches the DOM. `test/a11y-props.test.ts` enforces this in `packages/ui`. Still allowed: `accessible`, `accessibilityHint`, `accessibilityActions`, `accessibilityLanguage`.
  - Don't use `slider`/`adjustable` roles unless `aria-valuenow/min/max` are set (axe: critical). The sheet handle is a `button` with `aria-expanded` ("Expand sheet" / "Collapse sheet"), plus expand/collapse custom actions on native.
  - `aria-selected` only goes on `tab`/`option` roles. Segmented controls are `Chip selectionRole="tab"` inside a `role="tablist"` row. Radius chips are `radio` inside `role="radiogroup"`.
  - Cards are one focus stop with a summary label: "Football, 6 of 10 players, today 18:00, Park HaYarkon, 1.2 kilometres, deposit 20 shekels".
  - Map: pins are focusable with labels. A **List view toggle** is always visible, so the map is never the only way to find games.
  - Live updates (waitlist position, check‑in progress, errors) use `accessibilityLiveRegion="polite"` or `announceForAccessibility`. Errors use `assertive` only when blocking.
  - Decorative elements (dividers, illustrations, glyphs next to text) are hidden from assistive tech.
- **Focus:**
  - The order follows visual reading order in the current direction.
  - On web, the focus ring is a 3dp `focusRing` with a 2dp offset (2.4.7, 2.4.11 not obscured: sticky headers and the sheet must not cover the focused element).
  - When a sheet or modal opens, focus moves to its title. Closing returns focus to the trigger. Modals trap focus on web, and Escape closes them.
- **Dynamic type:** `allowFontScaling` stays on. Each variant has a cap (`maxFontSizeMultiplier`, 1.4–2×). Layouts must reflow at 200%: rows wrap, buttons grow taller, and nothing has a fixed height except pins/avatars. Test with iOS Larger Text XXXL, Android 200% and browser zoom 200% (1.4.4, 1.4.10 reflow at 320 CSS px).
- **Color independence:** status, sport, selection and errors always pair color with a glyph/shape/text (1.4.1).
- **Motion:** respect reduced motion (§7). There's no flashing content.
- **Forms:**
  - Visible labels (never placeholder‑only). Errors are inline, under the field, with ⚠ + text and announced politely (3.3.1, 3.3.3).
  - OTP supports paste and autofill (`textContentType="oneTimeCode"`, `autoComplete="sms-otp"`). There are no cognitive tests at login (3.3.8).
- **Timeouts:**
  - The sanctions countdown is informational only.
  - The QR check‑in never requires speed: a code is valid for ±1 step (≈ 90s window).
  - The OTP resend timer is shown and announced.
- **Dragging alternatives (2.5.7):** the sheet handle has a tap action and expand/collapse actions, the radius slider is a set of chips, and the teams reshuffle and moves use buttons, not drag‑only.
- **Language:** set `lang` on web root and use `accessibilityLanguage` on native Text for content in another language (translated chat).

---

## 12. Information architecture and navigation

### 12.1 Primary destinations

| Tab | Purpose | Route |
|---|---|---|
| **Map** (default) | Discover games/venues nearby or in a planned city | `(tabs)/map` |
| **Games** | My upcoming (hosting / joined / waitlisted / requested), past, invitations | `(tabs)/games` |
| **Inbox** (phase 1) → **Network** (phase 2) | Game chats + notifications (approvals, waitlist, sanctions). Phase 2 adds friends/follow, and Inbox moves under Network. | `(tabs)/inbox` |
| **Profile** | Me: reliability card, stats, positions, history; entry to Settings | `(tabs)/profile` |

Settings is reached from Profile (gear in the header) and from the web rail. The PRD's "side menu" is replaced by Profile → Settings on mobile, a familiar pattern with fewer hidden items.

### 12.2 Layout by width

| Width | Navigation | Map screen |
|---|---|---|
| < 768 (phones; web mobile) | **Bottom tab bar** (4 items, icon + label always visible, 56dp + safe area). FAB "Create game" floats above the tab bar at the end side. | Full‑bleed map, chips on top, bottom sheet with cards (3 detents: peek 120 / half 45% / full). |
| 768–1023 (tablets, small laptops) | **Side rail** (80dp) at the start edge: 4 destinations + Create (volt) + Settings at the bottom. | Map with a floating list panel (360dp) at the start edge, collapsible. |
| ≥ 1024 (web wide) | Rail + optional **split view** | **Map/list split:** list pane 400dp at the start edge, map fills the rest. Hovering a list card highlights its pin and vice versa. The selected game opens a details pane replacing the list (with Back), or in a route on narrow widths. |

- **Deep links:** `invite/[token]`, `game/[id]`, `sanctions/[id]` open over the current tab. Back returns to where the person was.
- **Modal flows** (Create game, Check‑in, Result entry) are full‑screen modals on phones and centered dialogs (max 560dp) on web wide.
- **Moderation console:** a separate web‑only area `/(staff)/moderation`, gated by `app_roles`, using its own rail (§13.19).

---

## 13. Screen specs

Each spec lists layout, components, states (**loading / empty / error / offline**) and primary actions. These apply to all screens:
- Skeletons, not spinners, for content (≤ 300ms → show nothing; > 300ms → skeleton).
- An offline banner (warning tone) sits at the top of the content: "You're offline. Showing saved info." Actions that need the network are disabled, with a hint.
- Every error says what happened and how to fix it, and offers Retry.

### 13.1 Onboarding and phone OTP
- **Layout:**
  1. Welcome: brand mark, `display` headline "Find a game. Show up. Play.", 3 swipeable value cards (map, fair play, chat) with page dots (mirrored order in RTL). Primary **Continue with phone**, then Sign in with Apple and Google, then **Browse first** (guest map, read‑only).
  2. Phone: country picker (flag + dial code; search; defaults from SIM/locale), `TextField inputDirection="ltr"` with `textContentType="telephoneNumber"`. Consent line linking Terms and Privacy.
  3. OTP: 6 boxes rendered as one input (better for paste, autofill and screen readers), LTR. Auto‑submits when complete. A "Resend in 0:30" countdown, then a **Resend code** link, plus **Change number**.
- **States:**
  - Sending: the button shows a loading state, "Sending code…".
  - Wrong code: inline error "That code doesn't match. Check the latest SMS or resend."
  - Too many attempts: "Too many tries. You can request a new code in 10 minutes."
  - Offline: disable Continue with the hint "Connect to the internet to get a code."
- **A11y:** the OTP field label is "Verification code, 6 digits". The countdown is announced at 10s and 0.

### 13.2 Age gate (16+)
- Comes right after OTP, before profile creation. Neutral month + year pickers (no prefilled default; the year list starts empty, so no pre‑selected age). Copy: "Sport Talent is for people 16 and older. We ask for your birth month and year only."
- **Under 16:** a respectful stop screen: "Sorry, you need to be 16 or older to use Sport Talent." Explain that data entered is not kept, and offer **Close**. There's no retry loop: the device is soft‑locked for 24h to discourage age cycling.
- Then a short profile: display name (BidiText preview), primary sport(s) (chips), optional photo, home area (optional; the map works without location).
- **Location permission:** a pre‑prompt explains the benefit and never blocks. "Not now" keeps the map working by city search.

### 13.3 Main Map
- **Top bar (over the map, elevation 2):**
  - search field ("City, venue or address"), start side;
  - a filter row of **sport chips** (horizontal scroll; max 3 selected);
  - a **radius** control.
- **Sport chips:**
  - Selected chips get ✓ + fill + the sport shape.
  - When 3 are selected, the rest show disabled with the hint "You can pick up to 3 sports. Unselect one to add another." A toast also appears on attempt.
  - Chips have `checkbox` semantics.
- **Radius selector:** a segmented control of chips with `radio` semantics: **1 · 2 · 5 · 10 · 30 · 50 km** (miles shown for en‑US/en‑GB with the same underlying km steps). The default is "Auto (GPS)" = 5 km. Changing it draws a radius circle on the map briefly (static with reduced motion).
- **Map:**
  - Clustered pins (supercluster). `PinBadge` for games, small venue pins at zoom ≥ 14.
  - Locate‑me button at the end side above the sheet. Map attribution stays visible (license).
- **Bottom sheet** (`Sheet`, 3 detents):
  - The header shows "{count} games nearby", the sort (Soonest / Nearest) and a **List** toggle (full‑screen list, a11y‑friendly).
  - The body shows game cards. Each card shows:
    - the sport shape;
    - the title, or the venue name (BidiText);
    - the time (today 18:00, an LTR isolate);
    - players `6/10` (tabular) with a progress bar that mirrors in RTL;
    - distance; the host's reliability `StatusBadge sm`;
    - badges (Deposit, Women only, Private, Waitlist);
    - an `accentEdge` when starting < 2h.
  - Venue cards appear after games ("Venues without games: start one").
- **FAB:** a volt "Create game" button (56dp, label visible on wide screens and icon + accessibility label on phones), at the end side above the sheet peek.
- **States:**
  - Loading: skeleton cards plus the map showing old pins dimmed.
  - Empty: "No games within 5 km for football." Actions: **Widen to 10 km**, **Create a game**.
  - Location denied: city search prompt.
  - Error: "Couldn't load games." **Retry**.
  - Offline: cached last results, labelled "Saved 12 min ago".
- **Wide web:** split view (§12.2). The list pane replaces the sheet, and the chips sit above the list.

### 13.4 Venue sheet
- Opens from a venue pin or card, at the half detent.
- **Contents:**
  - Header: name (BidiText), sports offered (SportDots), distance, Directions (opens the OS maps).
  - **Ratings:** overall 1–5 (stars + numeric "4.2 · 38 ratings") and per‑sport attributes. Pitches: grass/turf, lighting, nets. Tennis: clay/hard/grass. Basketball: hoops, nets. Shown as labelled rows with a 5‑step meter and the value as text.
  - Upcoming games here (cards). **Rate this venue** (only after playing here).
- **Report:** under an overflow menu and as a quiet ghost button at the bottom: "**No venue here?** Report it."
  - The flow: confirm reason (no venue / closed / wrong location / private) → "Thanks. We'll check it. Venues reported by 3 people are hidden while we review."
  - One report per person: the button becomes "You reported this".
- **States:** a hidden_pending_review venue isn't listed. If deep‑linked: "This venue is under review."

### 13.5 Create Game wizard
- A full‑screen modal with a 5‑step **stepper**: progress mirrors in RTL, and the label is "Step 2 of 5" (announced).
  1. **Sport:** chips (single select), then the format (5v5, 7v7, singles/doubles…).
  2. **Where:** search, or pick a venue on the map, or drop a pin (requires a venue name). Toggle **Hide exact location until I approve players** (default ON for women‑only).
  3. **When:** date, start, duration (pickers follow locale, 24h/12h), and a recurring option (weekly) as phase‑2 dimmed.
  4. **Who:**
     - capacity (stepper, min/max per sport);
     - Public / Private (invite link);
     - Women‑only;
     - minimum reliability (Any / Caution+ / Reliable only);
     - approval mode (Auto‑approve / I approve).
  5. **Deposit (optional):** toggle plus an amount. It explains: "Players place a refundable hold of ₪20. It's released after check‑in, kept if they don't show." Currency follows the venue country.
- **Review:** a summary card with an Edit link per section. Primary **Publish game**, then the share sheet (WhatsApp link with preview, copy link, QR).
- **States:**
  - Validation errors stay inline and are never only at the end.
  - Leaving mid‑way prompts "Discard draft?". Drafts autosave locally.
  - Offline: steps 1–4 can be filled, and Publish is disabled with the hint "Publish when you're back online."
- **Host restrictions:** if host‑suspended, the FAB opens an explanation instead (links to §13.16).

### 13.6 Game details
- **Header:**
  - sport shape plus the title;
  - time (relative + absolute), venue (hidden until approved, if set: "Exact spot shared after the host approves you");
  - host row (Avatar, name, verified‑host badge, `StatusBadge`).
- **Facts row:** players 6/10 + waitlist 2, format, level, deposit, women‑only, private.
- **Participants:** a list of approved players (Avatar + name + StatusDot + position chips). Requested and waitlisted players show in separate sections (visible to the host only).
- **Primary action** (sticky bottom bar, changes by state):
  - Guest: **Join game**, or **Request to join** (approval mode), or **Join waitlist (#3)** when full.
  - The deposit is disclosed *before* the payment sheet: "₪20 hold · released after check‑in".
  - Requested: "Waiting for host" plus **Cancel request**.
  - Approved: **Check in** (enabled from 30 min before) plus Chat, Directions, **Can't make it** (warns: "Cancelling less than 2 hours before the start counts as a late cancel and gives you a yellow card." Confirm with a danger button).
  - Waitlisted: position (live region) plus Leave waitlist.
- **Host view:** approve/reject per request (two buttons, 48dp each; Reject asks for an optional reason, with templates). Also: Edit, Cancel game (requires a reason; notifies everyone), **Show check‑in QR**, Teams, Enter result.
- **States:**
  - Cancelled game: a banner with the reason.
  - Started: Check‑in emphasized.
  - Ended: Result + Rate host.
  - Error/offline: cached details plus disabled actions.

### 13.7 Check-in
- Opens from Game details → **Check in** (from start −30 min to end).
- **Layout:**
  1. **GPS check:** a circular progress ring (mirrors with direction) with 3 sample dots. The status text is a live region: "Checking your location… 2 of 3". Accuracy is shown as text ("±12 m").
     - Success: green ✓ "You're checked in", with a haptic.
     - If accuracy is poor or out of range, explain gently: "We can't confirm you're at the venue yet. Move into the open or try another way." No accusation.
  2. **Other ways** (always visible below the GPS check, not hidden behind failure):
     - **Scan host QR** (camera with an overlay frame; no mirroring of the camera feed; manual code entry fallback, 6 digits);
     - **Ask a teammate:** sends a confirmation request to checked‑in players. The status reads "Waiting for 2 confirmations · 1 received".
- **Web:** GPS when available, with QR as the primary path.
- **Mock location detected:** never sanction. Show the same "try another way" path.
- **States:** permission denied → explain and go straight to QR/teammate. Offline → queue the GPS samples with a timestamp: "We'll confirm when you're back online."

### 13.8 Host QR display
- Full‑screen, max brightness hint (keep‑awake). A large QR on white (always light, even in dark mode, for scanners), at least 240dp and 60% of the screen width.
- Rotates every **30s**. A thin countdown bar mirrors, and the swap is instant with reduced motion. Shows the 6‑digit fallback code in tabular numerals (LTR isolate).
- "Players scan this to check in. The code refreshes every 30 seconds." There's a checked‑in counter "7 of 10" (live region, polite, throttled to 1 per 10s).
- Also **Mark players manually** (host verification) → a list with toggles.

### 13.9 Teams (balanced squads)
- Two (or N) team columns side by side on wide screens and stacked on phones, with team colors as a **light/dark bib** pattern (striped vs solid header) plus team names "Team A/B", never color alone.
- Each player chip: name, position glyph (GK, DEF, MID, FWD or C, PG…), and the rating hidden by default (privacy) and shown to the host only.
- A balance indicator: "Balanced · rating diff 0.3", and position coverage shown as text.
- Actions:
  - **Reshuffle** (new seed; "Shuffle again" with a 200ms cross‑fade);
  - **Move player** (a tap opens "Move to Team B" with an accessible alternative to drag);
  - **Lock teams** (notifies players).
- States: < 2 checked‑in players → empty state "Teams appear once players check in."

### 13.10 Result entry
- Available from game end until end +2h, with a countdown shown ("You can enter the result for 1h 12m").
- A score stepper per team (big tabular numerals, +/- 48dp buttons, direct input). Teams appear in the same order as the Teams screen, and the layout mirrors, but the score string stays "3–1" (LTR isolate).
- Optional: MVP pick (avatars), "Didn't play / cancelled". **Submit result** → confirmation "Result saved. Players can dispute it for 24h."
- After the window: read‑only, "The result window closed at 20:00."

### 13.11 Game chat
- Header: game title plus the time and an "Messages disappear 3 hours after the game" info chip (tap for details).
- **Bubbles:**
  - own messages at the end side with `primarySubtle`, others at the start with `surface`;
  - the author name above the first bubble of a group (BidiText) plus a StatusDot;
  - the body is `BidiText mode="block"`;
  - a footer with the time (LTR isolate).
  - Long‑press (or the ⋯ button for a11y and web) offers: Reply, Copy, **Translate**, **Report message**, **Block {name}**.
- **Translate:**
  - A per‑message "Translate" text button appears when the message language ≠ UI language.
  - The translated text replaces the original with a "Translated from Arabic · Show original" caption.
  - A global "Auto‑translate this chat" toggle sits in the chat menu.
- **Composer:**
  - auto direction (`inputDirection="auto"`); the send button mirrors (paper plane points to the end).
  - **Moderation nudge** (the server returns `nudge`): an inline warning card above the composer, never a modal: "This might come across as hurtful. Edit message / Send anyway."
  - **Block** (`block`): the message isn't sent and stays in the composer. "This message breaks our community rules (threats or hate). Edit it to send." Link: **Community rules**. After the second block in 7 days, add: "One more and chat will be paused for 24 hours."
  - **Muted:** the composer is replaced by "Chat paused until 18:40 · Why?" → Sanctions screen.
  - **Allow‑pending** (provider timeout): the message shows normally to the sender with a subtle clock "Checking…" until confirmed.
- **Report message:** reasons (harassment, hate, threats, spam, sexual content, other + text). "Thanks. We'll review this. The message is kept for 90 days for review." Block is offered right after.
- **States:**
  - empty: "Say hi to your teammates. Messages disappear 3 hours after the game."
  - expired: "This chat has ended."
  - offline: messages queue with a ⏱ icon, plus "Not sent. Tap to retry".

### 13.12 Profile
- **Header:** Avatar xl, name (BidiText), home city, sports chips, Edit.
- **Reliability card** (the hero card):
  - a big `numeric` "92%" with the label;
  - `StatusBadge` (glyph + label);
  - a meter: a horizontal bar that mirrors, with the solid status color and threshold ticks at 60% and 85%, labelled;
  - "Based on your last 90 days: 23 games, 22 check‑ins, 1 late cancel."
  - "How this works" link. Yellow cards are shown as a count with expiry ("1 yellow card · expires 12 Nov").
  - For `new`: "New player · play 3 games to get a reliability score."
- **Stats:** games played, as host, check‑in rate, favourite venue (cards in a 2×2 grid; tabular numerals).
- **Positions:** per sport, the primary/secondary position chips.
- **History:** a list of past games with results.
- **Other people's profile:** the same layout, with no private stats (phone, exact counts), plus **Report** and **Block** in an overflow menu.

### 13.13 Sanctions and appeal
- Reached from notifications, the profile reliability card, or a blocked action.
- **Layout (calm, informational):**
  1. Status card: what applies ("You can't request to join games"), since when, and **until when** with a countdown ("Ends in 6 days 4 hours", plus the exact date and time). Never only red: info tone with the red status badge.
  2. **Statement of reasons** (DSA Art.17):
     - what happened, with the facts (dates, game names);
     - which rule;
     - whether the decision was automated ("This was decided automatically based on check‑in records. A person will review it if you appeal.");
     - what it affects and what it doesn't ("You can still chat in games you're in.").
  3. **How to fix / what's next:** "Show up to your next 2 games to get back to green". The link for yellow‑card expiry.
  4. **Appeal / Dispute:**
     - For a yellow card within 48h: **Dispute this card**. After that: **Appeal**.
     - The form: a reason select, a text field (min 20 characters, counter, auto direction), optional evidence (screenshot), and the contact language.
     - Submit → "Appeal received. A person will review it, usually within 72 hours. We'll notify you."
     - Appeal status timeline: Received → In review → Decided (upheld/overturned, with the reasoning).
- **States:**
  - expired sanction: "This ended on …" (read‑only);
  - dispute window closed: explain that an appeal is still possible;
  - offline: the form saves a draft.

### 13.14 Settings
- Sections:
  - Account (phone, linked logins);
  - **Language**;
  - **Theme**;
  - **Notifications**;
  - **Privacy and safety**;
  - Legal;
  - **Delete account**;
  - app version (tap ×7 = diagnostics).
- **Language picker:**
  - 12 languages (13 entries; Chinese is split) shown in their **native names**, each rendered in its own script/font: English · עברית · العربية · Español · 简体中文 · 繁體中文 · 日本語 · Português · Русский · Français · Italiano · Deutsch · हिन्दी (`localeNativeNames`).
  - The current one is marked ✓ (radio semantics), with a secondary line in the current UI language ("Hebrew") for orientation.
  - "Use device language" sits on top.
  - **Restart prompt:** when switching between LTR↔RTL on native, show a dialog: "**Restart to switch to العربية?** The app needs to restart to change the reading direction. **Restart now** / Later." The dialog text is in the *target* language plus the current one.
  - Web switches instantly.
- **Theme:** System / Light / Dark (radio), with a live preview swatch. It persists via `onPreferenceChange`.
- **Notifications:** per category toggles: join requests, approvals, waitlist promotion, game reminders, chat, sanctions (can't disable: legal notice). There's a link to OS settings if the OS permission is off.
- **Privacy:**
  - profile visibility; show my reliability % (always visible to hosts when applying, which is explained);
  - location: precise vs approximate, background wake‑up check‑in opt‑in (with a prominent disclosure);
  - blocked users list; download my data.
- **Delete account:** a danger zone at the bottom. A full screen explains what is deleted and what's kept (pseudonymised sanction records, legal basis). Then: type "DELETE" or confirm by OTP → **Delete my account** (danger). The web link is also available (Play policy).

### 13.15 Inbox (phase 1)
- Segments: Chats | Notifications. Notifications are grouped by game. Sanction notices are pinned until read and open §13.13. Empty: "No messages yet. Join a game to start chatting."

### 13.16 Host restriction screen
- A variant of §13.13 for `host_suspension`: same layout, plus "Games you already host stay active" / or not, according to the rule.

### 13.17 Restart for RTL (system dialog spec)
- Native only. Modal dialog, focus on the title. The primary action calls `I18nManager.forceRTL(...)` and then `Updates.reloadAsync()` (expo-updates) or `DevSettings.reload()` in dev. Pending drafts are saved first.

### 13.18 Invite landing (`invite/[token]`)
- Game preview card (deposit, women‑only, private badges) and **Join** (or Sign up to join). Expired: "This invite has expired. Ask the host for a new link."

### 13.19 Moderation console (web only, staff)
- **Gate:** the `moderator` or `admin` role. Desktop‑first (≥ 1024). Dense table density (row 44). Keyboard shortcuts (J/K next/prev, A approve, O overturn, E escalate, `?` help). Every shortcut has a visible button equivalent.
- **Layout:** start rail with Queues (Reports, Appeals, Venues, Chat blocks, Host reviews) and counts. A center list table (type, subject, age, SLA timer, auto‑decision, priority). An end detail panel.
- **Detail panel:**
  - subject profile summary (reliability, history, previous sanctions);
  - the evidence (retained messages with **original + translation side by side**; check‑in samples rendered as a mini map; reporter list with independence/collusion flags);
  - the automated decision and its rule;
  - **Decision form:** Uphold / Overturn / Modify (duration) / Escalate. A **mandatory statement of reasons** (templates per reason code, editable, previewed in the user's language). Also notify the user, and the audit note.
- Everything is logged in `audit_log`. Show who/when on each item. Two‑person review is required for permanent bans (a "Needs second reviewer" state).
- **States:** an empty queue shows "Queue clear 🎉" (emoji OK for staff). Conflicts: "Another moderator is reviewing this" (soft lock). SLA breaches are highlighted with a ⚠ icon + text, not only red.
- **Wellbeing:** sensitive media is blurred by default with click‑to‑reveal. Session break reminders.

---

## 14. UX copy principles

**Voice:** a friendly captain, not a referee shouting. Short, direct, active voice, second person. Use sport vocabulary lightly ("Check in", "Join", "Bench" is avoided because it's ambiguous when translated).

1. **Say what happened, then what to do.** "Couldn't load games. Check your connection and try again." Never "Error 500".
2. **Buttons are verbs that describe the result:** "Join game", "Send request", "Publish game", "Delete my account". Avoid "OK/Submit" when a specific verb exists.
3. **No blame for system or device limits.** GPS failure → "We can't confirm your location yet", never "You are not at the venue".
4. **Sanctions copy must be respectful, specific and fixable:**
   - State the *fact*, the *rule*, the *consequence*, the *duration* and the *way back*, and give the appeal link in the first view.
   - Be neutral: "You didn't check in to *Sunday Football* on 3 Nov, and it counts as a no‑show." Not "You flaked".
   - Don't use shaming words (bad, toxic, cheater), don't use exclamation marks, and don't use all‑caps.
   - Always say whether a human was involved, and that the person can ask for one.
   - Pattern: **What:** "You can't request to join games for 7 days." → **Why:** "2 yellow cards in 30 days (no‑show on 3 Nov, late cancel on 9 Nov)." → **Way back:** "This ends on 17 Nov at 10:00. Show up to your next games to raise your reliability." → **Disagree?** "Appeal. A person will review it."
5. **Chat moderation nudges explain and offer a choice.** Never say "Your message was flagged".
6. **Deposit/payment copy:** the amount, when it's charged, when it's released and the cancel rule appear before the payment sheet. "Hold", not "charge", unless it's captured.
7. **Inclusive and global:**
   - No idioms or puns that won't translate; gender‑neutral second person where the language allows.
   - Hebrew and Arabic: the i18n agent uses ICU `select` for gender if the user chose one, and otherwise neutral/plural forms.
   - Don't use emoji in system copy (except celebratory moments, and never as the only content).
8. **Numbers and dates** always come from `Intl` with the user's locale. Relative times ("in 2h") come with an absolute time on details screens.
9. **Length:** titles ≤ 40 characters, buttons ≤ 20 in en (other languages grow), body ≤ 2 lines in cards. Design for +40% expansion.
10. **Empty states invite action:** "No games nearby yet. Be the first. Create a game."

---

## 15. `@st/ui` component inventory and consumption

| Export | Purpose / notes |
|---|---|
| `tokens`, `colors`, `lightColors`, `darkColors`, `sportColors`, `reliabilityColors`, `spacing`, `radius`, `sizing`, `typography`, `elevation`, `motion`, `motionDuration`, `contrastPairs`, `RADIUS_OPTIONS_KM`, `MAX_SPORT_FILTERS`, `avatarFills` | Pure tokens (no RN import) |
| `contrastRatio`, `relativeLuminance`, `deltaE`, `simulateCvd`, `withAlpha` | Color math |
| `fontFamilyForLocale`, `fontFamilyForScript`, `scriptForLocale`, `isRtlLocale`, `detectScript`, `typeStyleFor`, `fontStacks`, `scriptMetrics`, `supportedLocales`, `localeNativeNames`, `requiredFontPackages`, `googleFontsCssUrl` | Fonts and scripts |
| `isolate`, `isolateValues`, `stripBidiControls`, `detectDirection`, `containsRtl`, `initialsFor`, `FSI/LRI/RLI/PDI` | Bidi |
| `ThemeProvider`, `useTheme`, `useMirrorStyle` | Theme context (`colors`, `scheme`, `preference`, `setPreference`, `direction`, `isRTL`, `locale`, `script`, `reducedMotion`, `elevation()`, `fontFamily()`) |
| `Text` | Variants, semantic color, script‑aware font/line‑height, header role, dynamic‑type caps |
| `Button` | `primary/secondary/ghost/danger/accent`, `sm/md/lg`, `loading`, start/end icons, focus ring, 48dp target |
| `Chip`, `SportDot` | Selectable chip (`checkbox`/`radio` via `aria-checked`, `tab` via `aria-selected`; ✓ glyph), sport marker |
| `Card` | Surface, elevation/outlined, `accentEdge` lane line, pressable |
| `Sheet` | Bottom sheet with detents: drag, tap, and a handle `button` with `aria-expanded` |
| `StatusBadge`, `StatusDot` | Reliability glyph + label (+%) |
| `PinBadge`, `ClusterBadge` | Sport map markers, clusters |
| `BidiText` | FSI/PDI isolation, sanitization, writingDirection, script font |
| `Stack`, `Row` | Gap, logical alignment, padding tokens |
| `TextField` | Label, helper, error (⚠ + live region), start/end adornments, `inputDirection` |
| `Avatar` | Image or initials (grapheme/CJK aware), badge slot |
| `EmptyState` | empty/error/offline/restricted with actions |
| `Divider`, `Mirror` | Hairline; RTL flip wrapper for directional icons |

### How the app consumes it

```tsx
// apps/mobile-web/src/app/_layout.tsx
import { useFonts } from "expo-font";
import { NotoSans_400Regular, NotoSans_500Medium, NotoSans_600SemiBold, NotoSans_700Bold } from "@expo-google-fonts/noto-sans";
// + the active locale's family (e.g. @expo-google-fonts/noto-sans-hebrew), CJK lazily
import { ThemeProvider } from "@st/ui";

export default function RootLayout() {
  const locale = useLocale();                 // from @st/i18n
  const [fontsLoaded] = useFonts({ NotoSans_400Regular, NotoSans_500Medium, NotoSans_600SemiBold, NotoSans_700Bold /* … */ });
  const stored = useStoredThemePreference();  // "system" | "light" | "dark"
  return (
    <ThemeProvider
      locale={locale}
      fontsLoaded={fontsLoaded}               // native: system font until true; web uses CSS stacks
      initialPreference={stored}
      onPreferenceChange={persistThemePreference}
      // direction: omit → native uses I18nManager.isRTL, web derives from locale
    >
      <Stack />
    </ThemeProvider>
  );
}
```

- Screens use `useTheme()` for colors, `isRTL` and `reducedMotion`. Pass `theme.scheme` to the map style (light/dark tiles) and to `StatusBar`.
- Web: add `googleFontsCssUrl([...scripts])` as a `<link rel="stylesheet">` in `app/+html.tsx`, with `preconnect` to fonts.gstatic.com.
- The template's `constants/theme.ts`, `themed-text.tsx` and `themed-view.tsx` should be replaced by `@st/ui` (`Text`, `useTheme().colors`).
- Navigation colors: tab bar background `surface`, active `primary` + filled icon + label, inactive `textSecondary`, top border `border`.

---

## 16. Requests to other owners

- **Orchestrator (deps):** add to `apps/mobile-web`: `@expo-google-fonts/noto-sans`, `noto-sans-hebrew`, `noto-sans-arabic`, `noto-sans-devanagari`, `noto-sans-sc`, `noto-sans-tc`, `noto-sans-jp` (CJK lazily loaded), plus `expo-font` (if not already present) and `@expo/vector-icons`. Also consider an app‑wide ESLint `no-restricted-syntax` rule mirroring `packages/ui/test/logical-styles.test.ts`.
- **i18n:** use `isolateValues()` for all interpolations with user data; use the endonyms from `localeNativeNames`; ICU gender `select` for he/ar; add the copy keys from §13/§14.
- **DB/Functions:** strip bidi control characters (`U+202A–U+202E`, `U+2066–U+2069`) from names, venue names and chat on write. Return the moderation outcome as `allow | nudge | block | allow_pending`, plus a reason code for copy.
- **QA:** axe on web for each screen in en/he/ar; screenshot each screen at 200% text; assert `dir="rtl"`; CVD simulation spot checks of the map.
