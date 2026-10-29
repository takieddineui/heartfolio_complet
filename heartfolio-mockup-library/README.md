# Heartfolio — Minimalist Mockup Library (printable products)

The approved **modern-minimalist** mockup set, generated across the full
printable library in **all six storefront languages**: every **Love Story
Timeline** style and every **Song Poster** theme, each in **three variants**,
in its native orientation.

- **252 mockups** = (6 LST styles + 8 Song Poster themes) × 3 variants × 6
  languages (`en`, `fr`, `ar`, `es`, `ru`, `zh-CN`).
  - 42 per language · 108 Love Story Timeline · 144 Song Poster · 84 per
    variant · 180 portrait + 72 landscape.
- **Variants:** `studio-white` (off-white plaster wall · slim black frame ·
  floating oak shelf), `gallery-white` (bright white wall · slim black frame ·
  no shelf, generous negative space), `concrete-oak` (cool light-grey concrete ·
  slim natural-oak frame · floating shelf).
- **Orientation is automatic:** portrait designs render on a 2560×3200 portrait
  wall; the horizontal LST layouts (`horizontal-polaroid`, `horizontal-circles`)
  and the `award` / `sleeve` Song Poster themes render on a 3200×2560 landscape
  wall — so nothing is cropped or stretched to fit.
- All renders are **sharp / in-focus** with a frame wall cast shadow + contact
  line, inner-mat shadow, soft contact shadows under shelf objects, and a subtle
  glass glare.
- The artwork is composited **UNCHANGED** — opened read-only, scaled
  proportionally only; every source was **sha256-verified unchanged** (252/252).

## Languages

One mockup set per design × 3 variants is generated for each of the six
storefront languages, reading the localized artwork from
`customer-artwork-library-v2/<product>/<lang>/`. Output nests under
`<product>/<lang>/<design>/`. The Arabic (`ar`) artwork is right-to-left as it
comes from the source library; the scene (wall, frame, shelf) is language-neutral.

## Structure

```
heartfolio-mockup-library/
├── README.md
├── love-story-timeline/<lang>/<style>/{studio-white,gallery-white,concrete-oak}.jpg   (6 styles × 6 langs)
├── song-poster/<lang>/<theme>/{studio-white,gallery-white,concrete-oak}.jpg           (8 themes × 6 langs)
├── contact-sheets/<product>-<lang>.png     (12 sheets: 2 products × 6 languages, studio-white tiles)
└── manifest/manifest.csv · manifest.json   (every mockup → source artwork, variant, orientation, language)
```

`<lang>` ∈ `en · fr · ar · es · ru · zh-CN`.

## Source

Artwork is the existing customer-ready library
(`customer-artwork-library-v2/<product>/<lang>/…`), untouched. Scenes are built
in code (Pillow) — no image-generation / 3D engine is available in this
environment, so these are clean **stylised** minimalist renders, not
photographs. For true photoreal, generate the rooms with blank frames via an
image model (or use PSD templates) and reuse the same compositing.

## Regenerate / validate

```
# full 252-mockup, six-language set (LANGS is set to all six in the script)
python mockup-exploration-v1/scripts/build_library.py
# per-language contact sheets (12)
python mockup-exploration-v1/scripts/build_contact_sheets.py
# manifest.json reports source_unchanged: true for every row (252/252)
```
