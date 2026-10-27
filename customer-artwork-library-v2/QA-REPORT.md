# QA Report — Customer Artwork Library V2

Date: 2026-10-27 · Scope: Love Story Timeline + Song Poster, artwork only.

## 1. Audit (before generating)

Read directly from the product source, not assumed:

- **LST styles** (`love_story_timeline/data.py` `LAYOUTS`): the six current,
  closed styles. No obsolete/first-edition layout exists to exclude.
- **Song Poster themes** (`song_poster/data.py` `THEMES`): the eight current
  themes (`player, ledger, ephemeris, contactsheet, label, award, sleeve,
  mosaic`). No deprecated theme to exclude.
- **Real fields/limits obeyed** — LST: milestones 3–8, people 1–2,
  posterTitle ≤40, subtitle ≤60, dedication ≤180, title ≤40, description ≤140,
  location ≤40, photo required, storyType ∈ {couple, family, parents, gift}.
  Song Poster: track ≤60, artist ≤60, dedication ≤180, photo required,
  youtubeUrl + matching youtubeVideoId required (validated, not drawn).
- **LST artwork reused, not regenerated.** The 36 already-validated V2 LST
  artworks were audited and copied **byte-for-byte** (sha256-verified). No
  defect was found that warranted regeneration.

## 2. Counts

| Check | Expected | Actual |
|---|---|---|
| LST artworks | 36 (6 styles × 6 languages) | 36 ✓ |
| Song Poster artworks | 48 (8 themes × 6 languages) | 48 ✓ |
| Total | 84 | 84 ✓ |
| Languages (each product) | en, fr, ar, es, ru, zh-CN | all present ✓ |
| Contact sheets | 12 (2 products × 6 languages) | 12 ✓ |
| Manifest rows | 84 | 84 ✓ |

Rendering failures: **0** (LST 36/36, Song 48/48).

## 3. Automated validation (`scripts/validate.py`)

**23 / 23 checks passed:** only current styles/themes (no obsolete); all six
styles + eight themes present; all six languages; every file a valid non-empty
image; no missing, stray, duplicate or zero-byte files; LST milestones within
3–8; Song fields within caps; **artwork-only (no mockup/marketing directories)**;
LST artwork byte-identical to the validated source; every manifest file exists.

## 4. Language / typography / layout review (visual, representative files)

| Language | Script coverage | Result |
|---|---|---|
| en | Latin (DejaVu) | ✓ clean, no clipping |
| fr | Latin + accents (é, à, ô, ù…) | ✓ accents render, natural wrapping |
| es | Latin + accents/ñ (í, ó, ñ, ¿) | ✓ |
| ru | **Cyrillic** (DejaVu) | ✓ full coverage, localised dates/duration (LST) |
| ar | **Arabic RTL** (Noto Kufi/Naskh via MixedScriptFont) | ✓ correct shaping, joining, RTL alignment; localised dates/duration (LST) |
| zh-CN | **Simplified Chinese** (WenQuanYi fallback) | ✓ Han glyphs render across all themes/styles; localised dates (LST) |

Specific checks:
- LST dates localise per language (e.g. `30 июл. 2023`, `2014年9月6日`,
  `18 jun. 2023`); duration line localises (`在一起 3,653 天`, `439 días
  juntos`, `14,610 يومًا جنبًا إلى جنب` for the parents story).
- Song Poster: longest Chinese title (`我们还是把它建起来了`, award theme) fits
  with no clipping; sleeve ring renders Latin/Cyrillic dedications; sleeve
  dedication correctly **blank** for ar/zh-CN (no unjoined/tofu text).
- No text overflow, clipping or box-glyphs (tofu) found in the inspected set
  across both products and all six languages.

## 5. Known limitations (carried forward, not defects)

1. All six languages' copy is author-drafted, **not native-reviewed**.
2. Chinese is a single sans CJK face (WenQuanYi) across all themes/typographies.
3. Song Poster `sleeve` ring is unshaped plain DejaVu → ar/zh-CN dedication
   blanked on that theme only.
4. es/ru/zh-CN are **sample-only**; the live site does not support them.
5. Horizontal LST styles and the award/sleeve themes are landscape (authentic).
6. Photos are shared licensed Unsplash samples reused as stand-ins.

## 6. Decisions for your review

- **Print target.** One real deliverable per artwork (`print-classic-edged`,
  2400×3000). The printable pack actually ships several sizes/mountings — say
  the word and I can also emit A4 (2480×3508) and poster (3600×5400).
- **Chinese typography.** Upgrade from WenQuanYi to Noto Serif/Sans SC for
  per-typography fidelity? (needs those fonts added.)
- **Native copy review** before any of this is used publicly.

Nothing has been committed, pushed, or published; the live product and website
are unchanged. Ready for your review.
