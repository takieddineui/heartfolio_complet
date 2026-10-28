# Heartfolio — First Mockup Design Exploration

A small first batch of **12 mockups** (3 directions × 4 artworks) to choose a
visual direction **before** generating the full mockup library. Design
exploration only — not the full library.

The real **customer-ready artwork is composited UNCHANGED** (pixel-faithful):
opened read-only, placed into each scene scaled proportionally to the frame
opening — never cropped, stretched, recoloured or redrawn — and sha256-verified
unchanged after the run (`source artwork unchanged: True`). Nothing in
production or in the artwork libraries was modified.

## Three directions

- **A · Luxury Editorial** — warm ivory/cream wall, natural walnut frame,
  generous ivory mat, soft upper-left daylight, subtle contact shadow. Calm,
  timeless, premium editorial.
- **B · Modern Minimalist** — cool neutral wall, slim matte-black frame,
  minimal mat, crisp directional light, generous negative space with the
  artwork as the focal point.
- **C · Romantic Lifestyle** — warm cream wall, oak frame, an intimate warm
  light pool and a soft console surface below. Refined and warm, **no** hearts,
  roses, glitter or pink clichés.

## Source artwork used (existing, from `customer-artwork-library-v2/`)

| Key | Product | Source file | Orientation |
|---|---|---|---|
| `lst-a-neat-stack` | Love Story Timeline | `customer-artwork-library-v2/love-story-timeline/en/s1-new-love-neat-stack.png` | portrait |
| `lst-b-dotted-branching` | Love Story Timeline | `customer-artwork-library-v2/love-story-timeline/en/s4-engaged-wedding-dotted-branching.png` | portrait |
| `song-a-player` | Song Poster | `customer-artwork-library-v2/song-poster/en/sp1-first-dance-player.png` | portrait |
| `song-b-award` | Song Poster | `customer-artwork-library-v2/song-poster/en/sp6-milestone-award.png` | landscape |

Two LST (two different styles + stories), one portrait Song Poster, one
landscape Song Poster (the Award theme renders landscape). Each appears in all
three directions so the **presentation** — not the artwork — is what you compare.

## Composition method

Built in code with **Pillow** (already a project dependency) — no
image-generation model is used (none is available in this environment, and the
brief does not require one). Each scene is a procedural interior: a wall
gradient, a soft radial daylight pool, a framed piece (moulding with bevel +
mat), a blurred contact shadow, and a gentle vignette; the romantic direction
adds a soft foreground surface. The real artwork PNG is the only "photographic"
content and is placed as a separate, unchanged layer. Reproducible via
`scripts/build_mockups.py`.

## Output

```
mockup-exploration-v1/
├── README.md
├── luxury-editorial/    lst-a-neat-stack.jpg · lst-b-dotted-branching.jpg · song-a-player.jpg · song-b-award.jpg
├── modern-minimalist/   (same four)
├── romantic-lifestyle/  (same four)
├── contact-sheets/all-12.png     (rows = direction, columns = artwork)
├── manifest/manifest.csv · manifest.json   (each output → source artwork + direction)
└── scripts/build_mockups.py
```

All mockups are **1280×1600** (4:5, vertical — product-page / Pinterest friendly).

## Quality notes & limitations

- **Scenes are procedurally composited, not AI room photography.** No
  image-generation tool is available here; if you want photoreal AI rooms, that
  is a separate pass (generate the room with a blank frame, then composite the
  same real artwork in — the brief's permitted method).
- Artwork is **not photorealistic-claimed**: it is the genuine print file
  placed into a built scene. Verified pixel-faithful at full resolution
  (a full-res crop shows the original text/photos crisp and unaltered).
- The embedded artwork is downscaled to fit the mockup (the master files in
  `customer-artwork-library-v2/` remain the full-resolution originals).
- **Modern Minimalist** deliberately uses more negative space, so the artwork
  reads smaller there — that is the direction's intent, not a defect.
- Props are kept abstract/subtle (light, surface, shadow) rather than faked
  photographic objects, to avoid a cheap "dropshipping" look.

## How to compare & request revisions

- Open `contact-sheets/all-12.png` to compare the three directions side by side
  (each column is the same artwork across the three directions).
- Then open individual files at full resolution for detail.
- To request changes, tell me per direction: frame colour/width, mat size,
  wall tone, light warmth/position, artwork size-in-frame, canvas ratio
  (e.g. 2:3 vs 4:5), or whether to add a subtle real prop. I can also swap the
  sample artwork for other existing files.

**Next step:** once you pick a direction (or a refined version), I will generate
mockups for the rest of the printable artwork — not before.

---

---

## Minimalist set (`minimalist/`) — the kept direction

Per your review we kept only the **modern-minimalist** direction (dropped the
wood luxury and romantic scenes) and built **three cohesive variants** of it,
all sharp / in-focus at **2560×3200**, flat front-on, zoomed so the artwork
reads large. Grounding: frame wall cast shadow + contact line, inner-mat
shadow, soft contact shadows under shelf objects, subtle glass glare. Artwork
composited **unchanged** (source sha256-verified).

| File | Wall | Frame | Shelf | Source artwork |
|---|---|---|---|---|
| `minimalist/v1-studio-white.jpg` | soft off-white plaster | slim black | floating oak shelf | song-poster · player |
| `minimalist/v2-gallery-white.jpg` | bright gallery white | slim black | none (negative space) | love-story-timeline · neat-stack |
| `minimalist/v3-concrete-oak.jpg` | cool light-grey concrete | slim natural oak | floating shelf | love-story-timeline · dotted-branching |

`scripts/build_minimalist.py` · `manifest/minimalist_manifest.json`.
Still procedural (Pillow) renders, not photographs — see the limitation note above.
