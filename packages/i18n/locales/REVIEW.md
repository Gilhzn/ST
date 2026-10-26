# Translation review status

`en` is the source of truth. **Every other locale (he, ar, es, zh-Hans, zh-Hant, ja, pt, ru, fr, it, de, hi) was produced by an LLM translator and has not been reviewed by a native speaker.** All of them carry the "requires native review" flag until a reviewer signs off below.

## Review order

1. **`legal`** (all locales): privacy, terms, community rules, contact. The English text is itself a placeholder that legal counsel must replace before launch; translate again after that, do not just review.
2. **`trust`** (statements of reasons, sanctions, appeals, reliability): DSA Art. 17 / Art. 20 copy. Needs to be respectful, specific and correct about rules and durations.
3. **`errors`, `notifications`, `checkin`, `chat`** (moderation messages, safety copy such as `self_harm`).
4. The rest (`common`, `auth`, `map`, `games`, `profile`, `settings`).

## Choices a reviewer should confirm

| Locale | Choice |
|---|---|
| he | Gender-neutral wording: past tense, infinitives, `אפשר ל...`; slash forms (`אמין/ה`) only where unavoidable. |
| ar | Modern Standard Arabic; verbal nouns on buttons; 6 CLDR plural forms everywhere. |
| es | Neutral Spanish, informal `tú`; venue = "lugar"; host = "organizador". |
| pt | Brazilian Portuguese (also used for `pt-PT` devices); `você`. |
| fr | Informal `tu`; narrow punctuation uses a no-break space before `: ? ! ;`. |
| it | Informal `tu`. |
| de | Informal `du`; gender-inclusive colon (`Spieler:innen`). |
| ru | `вы`; plural forms and cases are hand-built per noun; "игра" for game, "площадка" for venue. |
| zh-Hans / zh-Hant | Mainland vs. Taiwan vocabulary (e.g. 组织者 / 主辦人, 签到 / 報到). |
| ja | Polite です・ます style; "会場" for venue, "主催者" for host. |
| hi | Polite `आप`; "मैच" for game, "मैदान" for venue; Latin position abbreviations. |

## Sign-off

Add a row when a native reviewer has checked a namespace.

| Locale | Namespace | Reviewer | Date |
|---|---|---|---|
| | | | |

Run `npm run i18n:check` after every edit: it verifies key parity with `en`, ICU syntax, placeholders and CLDR plural categories.
