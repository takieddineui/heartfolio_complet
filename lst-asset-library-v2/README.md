# Love Story Timeline — Visual Asset Library V2

A clean, independently-reviewable V2 asset library for the **Love Story
Timeline (LST)** product, split into two clearly-separated deliverables:

1. **`customer-artwork/`** — authentic LST artwork exactly as a customer
   receives it after personalising (the real print deliverable: no marketing
   copy, no frames, no logos, no overlays).
2. **`marketing-mockups/`** — the *same* customer artwork shown in three
   premium presentation environments, as a hypothesis test.

Existing production assets (e.g. `social/`, `frontend-heartfolio/public/captures/`)
were **not modified or deleted**. This is a new, separate directory.

---

## 1. Audit findings (verified against the product source, not assumed)

Read directly from `backend/apps/delivery/product_renderers/love_story_timeline/`:

- **Six current styles** (`data.py` `LAYOUTS`, all marked "closed" in CLAUDE.md):
  `neat-stack`, `alternating-tilt`, `overlapping-cascade`, `dotted-branching`,
  `horizontal-polaroid`, `horizontal-circles`. All six are included; nothing
  else exists to exclude. (`horizontal-polaroid`/`horizontal-circles` render
  **landscape** on print targets — that is the real product behaviour, kept.)
- **Milestones:** `MIN_EVENTS = 3`, `MAX_EVENTS = 8`. The library uses 3, 4, 5,
  6 and 8. (The Studio UI currently caps new projects at 5, but the renderer
  and saved/paid orders support up to 8; the brief asks for an 8-milestone
  sample, and "if the count is greater than the max, use the max" → 8.)
- **Fields & caps (enforced by the renderer, obeyed here):** people 1–2 ·
  posterTitle ≤ 40 · subtitle ≤ 60 · dedication ≤ 180 · milestone title ≤ 40 ·
  description ≤ 140 · location ≤ 40 · **every milestone needs a photo** ·
  `storyType ∈ {couple, family, parents, gift}`.
- **Palettes (8)** and **typographies (4)** from `data.py`; the library spreads
  six palettes and all four typographies across the six scenarios.
- **Rendering:** produced by the **actual product renderer** (`png_renderer.py`),
  driven with the real sample content — not an approximation. Target
  `print-classic-edged` (**2400×3000**, 300 dpi PNG; landscape styles 3000×2400).
- **Photos:** the 15 licensed Unsplash sample photos in
  `backend/apps/delivery/marketing_samples/photos` (Unsplash licence, free for
  commercial use), used as stand-ins for a customer's own photos.

## 2. Customer-ready artwork library

Six **distinct fictional stories** (no couple reused), each authored **natively
in six languages** (not machine-translated), each assigned a different style so
all six are represented:

| Scenario | Story | storyType | Milestones | Style | Palette / Type |
|---|---|---|---:|---|---|
| s1-new-love | a new relationship | couple | 3 | neat-stack | blush / serif-classic |
| s2-first-anniversary | one year together | couple | 5 | overlapping-cascade | gold / script |
| s3-ten-years | a decade | couple | 8 | alternating-tilt | midnight / modern |
| s4-engaged-wedding | proposal → wedding → home | couple | 5 | dotted-branching | classic / serif-classic |
| s5-long-distance | two cities | couple | 6 | horizontal-polaroid | sage / typewriter |
| s6-parents-story | a tribute to parents | parents | 4 | horizontal-circles | terracotta / serif-classic |

Languages: **en, fr, ar, es, ru, zh-CN** → **36 artwork files** (6 × 6).

## 3. Marketing mockups

Three directions, each the *same* artwork inserted as an **unchanged** framed
layer (hash-verified untouched): **luxury-editorial**, **modern-minimalist**,
**warm-romantic**. Six "hero" artworks (one per style, spread across all six
languages) × 3 directions = **18 mockups**, 1200×1800 (2:3, Pinterest-ready).
Comparable artwork is used across the three directions so presentation — not the
story — is what is being tested.

---

## Decisions to confirm (please review)

1. **Mockup environments are built in code, not AI-generated.** No
   image-generation model is available in this environment, so the three
   directions are high-quality procedural interiors (wall, light, frame,
   shadow). The brief *permits* AI backgrounds but does not require them; the
   artwork is never AI-redrawn. If you want photoreal AI rooms, that needs an
   image model and a second pass.
2. **es / ru / zh-CN are sample-only, not live-supported.** The live product
   localises for en/fr/ar only. These three render correctly via **sample-only
   shims that touch no production code**: Russian Cyrillic is already covered by
   the renderer's DejaVu faces; Chinese uses the renderer's own `MixedScriptFont`
   with a **WenQuanYi Zen Hei** CJK fallback; dates and the "days together" line
   are localised for es/ru/zh in the driver. **This does not mean the website
   supports these languages.**
3. **Chinese typography is a single sans CJK face.** All four typographies fall
   back to WenQuanYi Zen Hei for Han characters (Latin stays in the style's
   DejaVu face), so serif/script/typewriter Chinese don't vary as the Latin ones
   do. Upgrading to Noto Serif/Sans SC would need those fonts added.
4. **Print target = `print-classic-edged` (2400×3000).** One real deliverable
   per artwork; the printable pack actually ships several sizes/mountings — say
   the word and I can also emit A4 (2480×3508) and poster (3600×5400) variants.

## Known limitations

- **Copy is not native-reviewed.** All six languages were authored for this
  library; treat them as drafts pending a native speaker's review before any
  public use (the repo itself notes even its production fr/ar copy is awaiting
  native review).
- **Horizontal styles are landscape** (authentic), so two of six styles are not
  vertical — less ideal for Pinterest but true to the product.
- Photos are shared sample images reused across scenarios (stand-ins for a
  customer's own uploads).

## Honesty

LST is a **digital** keepsake that also includes **print-ready files**. The
mockups show *the customer's own print, framed by them* — **nothing is shipped
or printed by Heartfolio**. The mockups carry no sales copy, badges or logos.

---

## Structure

```
lst-asset-library-v2/
├── README.md
├── customer-artwork/{en,fr,ar,es,ru,zh-CN}/<scenario>-<style>.png   (36)
├── marketing-mockups/{luxury-editorial,modern-minimalist,warm-romantic}/   (18)
│       <scenario>-<lang>-<style>.jpg
├── contact-sheets/
│       artwork-<lang>.png            (6 — all styles per language)
│       mockups-directions.png        (6 heroes × 3 directions)
├── manifest/
│       manifest.csv · manifest.json  (every asset, full metadata)
│       artwork_manifest.json · mockup_manifest.json
└── scripts/
        content_scenarios.py   the six scenarios in six languages
        render_artwork.py       drives the REAL renderer (+ sample-only shims)
        build_mockups.py        procedural interior compositor
        build_contact.py        contact sheets + unified manifest
        validate.py             QA checks
```

## QA (run `python scripts/validate.py`)

**16 / 16 checks pass:** six current styles only (no obsolete/first-edition);
all six styles and six languages present; 36 artwork + 18 mockups; every mockup
references a real, existing source artwork; source artwork hash-verified
unchanged by mockup production; every file a valid non-empty image; no
duplicates, no missing or stray files; milestone counts within 3–8.

## Regenerate

```
# needs the backend Python deps + Pillow[raqm] + a CJK font (WenQuanYi) + the venv
python scripts/render_artwork.py     # 36 customer artworks (real renderer)
python scripts/build_mockups.py      # 18 mockups (artwork inserted unchanged)
python scripts/build_contact.py      # contact sheets + manifest
python scripts/validate.py           # QA
```
