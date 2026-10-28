# Heartfolio — Minimalist Mockup Library (printable products)

The approved **modern-minimalist** mockup set, generated across the full
printable library: every **Love Story Timeline** style and every **Song Poster**
theme, each in **three variants**, in its native orientation.

- **42 mockups** = (6 LST styles + 8 Song Poster themes) × 3 variants.
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
  proportionally only; every source was **sha256-verified unchanged** (42/42).

## Language

Generated in **English** (one mockup per design × 3 variants = 42), which covers
every printable design. The generator is language-parameterised: set
`LANGS = ["en","fr","ar","es","ru","zh-CN"]` in `scripts/build_library.py` for
localized mockups (output then nests under `<product>/<lang>/<design>/`), which
would produce 252 mockups.

## Structure

```
heartfolio-mockup-library/
├── README.md
├── love-story-timeline/<style>/{studio-white,gallery-white,concrete-oak}.jpg   (6 styles)
├── song-poster/<theme>/{studio-white,gallery-white,concrete-oak}.jpg           (8 themes)
├── contact-sheets/love-story-timeline.png · song-poster.png
└── manifest/manifest.csv · manifest.json     (every mockup → source artwork, variant, orientation)
```

## Source

Artwork is the existing customer-ready library
(`customer-artwork-library-v2/<product>/en/…`), untouched. Scenes are built in
code (Pillow) — no image-generation / 3D engine is available in this
environment, so these are clean **stylised** minimalist renders, not
photographs. For true photoreal, generate the rooms with blank frames via an
image model (or use PSD templates) and reuse the same compositing.

## Regenerate / validate

```
python mockup-exploration-v1/scripts/build_library.py   # 42 mockups (set LANGS for all languages)
# manifest.json reports source_unchanged: true for every row
```
