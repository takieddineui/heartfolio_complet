# Heartfolio — Customer Artwork Library V2

A clean, validated **customer-ready artwork** library for two products:
**Love Story Timeline** and **Song Poster**. This is artwork only — **no
marketing mockups, frames, room scenes, captions, hashtags or schedules.**
Every file is the genuine flat deliverable a customer receives after
personalising.

Produced with each product's **real Pillow renderer**; nothing is redrawn,
redesigned or AI-approximated. Existing project assets were **not modified or
deleted** — this is a separate directory. (The earlier `lst-asset-library-v2/`,
which also contains marketing mockups, is left untouched; its validated LST
artwork is **reused here byte-for-byte**.)

## Contents

| Product | Styles / themes | Languages | Files |
|---|---|---|---:|
| Love Story Timeline | 6 styles | 6 | 36 |
| Song Poster | 8 themes | 6 | 48 |
| **Total** | | | **84** |

- **LST styles (current, all included):** neat-stack, alternating-tilt,
  overlapping-cascade, dotted-branching, horizontal-polaroid, horizontal-circles.
- **Song Poster themes (current, all included):** player, ledger, ephemeris,
  contactsheet, label, award, sleeve, mosaic.
- **Languages:** en, fr, **ar (RTL)**, es, ru, zh-CN.

## Output dimensions / format

- Target `print-classic-edged`, 300 dpi **PNG**.
- **2400×3000** (portrait) for most styles/themes.
- **3000×2400** (landscape) for the layouts/themes that are landscape by the
  real product design: LST `horizontal-polaroid`, `horizontal-circles`;
  Song Poster `award`, `sleeve`.

## Languages — live vs sample-only (important)

- **en / fr / ar are languages the live product renders.**
- **es / ru / zh-CN are SAMPLE-ONLY.** They render correctly here via
  **sample-only shims that touch no production code**: Russian Cyrillic is
  covered by the renderer's DejaVu faces; Chinese uses the renderer's own
  `MixedScriptFont` with a **WenQuanYi Zen Hei** CJK fallback; and (LST only)
  dates and the duration line are localised for es/ru/zh in the driver.
  **This does NOT mean the live website supports es/ru/zh-CN.**

## Scenarios (fictional, varied)

- **LST:** six distinct stories — a new couple (3 milestones), a first
  anniversary (5), a decade (8, the real max), engagement→wedding (5),
  long-distance (6), a tribute to parents (4, `parents` story type). Six
  palettes, all four typographies; names/dates/places vary per language.
- **Song Poster:** eight fictional songs across genres/moods/decades/contexts
  (indie, singer-songwriter, dream-pop, nostalgic pop, soul, anthemic rock,
  bossa jazz, electronic pop; 1960s–2020s; first dance, long marriage, long
  distance, anniversary, wedding, milestone, timeless love, new love). **All
  titles/artists/dedications are fictional** — no real songs, no lyrics, no
  copyrighted text.

## Structure

```
customer-artwork-library-v2/
├── README.md · QA-REPORT.md
├── love-story-timeline/{en,fr,ar,es,ru,zh-CN}/<scenario>-<style>.png   (36)
├── song-poster/{en,fr,ar,es,ru,zh-CN}/<scenario>-<theme>.png           (48)
├── contact-sheets/
│     love-story-timeline-<lang>.png   (6)
│     song-poster-<lang>.png           (6)
├── manifest/
│     manifest.csv · manifest.json     (all 84, full metadata)
│     song_manifest.json
└── scripts/
      content_scenarios_lst.py   the six LST stories in six languages
      content_songs.py            the eight songs in six languages
      render_lst.py               real LST renderer (+ sample-only shims)
      render_songs.py             real Song Poster renderer (+ CJK shim)
      build_contact.py            contact sheets + unified manifest
      validate.py                 QA checks
```

## Known limitations

- **Copy is not native-reviewed.** All six languages were authored for this
  library; treat them as drafts pending native review before any public use.
- **Chinese uses one sans CJK face** (WenQuanYi Zen Hei) for Han glyphs across
  every theme/typography (Latin stays in the theme's DejaVu face). Noto
  Serif/Sans SC would be an upgrade needing those fonts.
- **Song Poster `sleeve` ring:** the disc ring draws the dedication in plain
  DejaVu with no shaping (a documented product limitation). The dedication is
  therefore **left blank for ar and zh-CN on the sleeve theme only** (the ring
  is empty; the main title/artist still localise). Latin/Cyrillic ring text is
  fine (those scripts don't join).
- **YouTube fields** are syntactically-valid dummy placeholders; the print
  never fetches them (only checkout's oEmbed check would, which is not run).
- **Horizontal styles/themes are landscape** (authentic product behaviour).
- Photos are the licensed Unsplash sample images (Unsplash licence), reused as
  stand-ins for a customer's own uploads.

## Honesty

LST and Song Poster are **digital** keepsakes that also include **print-ready
files**. These are those genuine print files — no frames, no mockups, no
marketing. Nothing here implies a physical product is shipped, and nothing
claims the live site supports a language it does not.

## Regenerate

```
# needs the backend Python deps + Pillow[raqm] + WenQuanYi CJK font
python scripts/render_lst.py       # 36 LST artworks (or reuse the copied set)
python scripts/render_songs.py     # 48 Song Poster artworks
python scripts/build_contact.py    # contact sheets + unified manifest
python scripts/validate.py         # QA (expects 23/23 pass)
```
