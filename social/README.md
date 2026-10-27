# Heartfolio — Social media content pack

A ready‑to‑post pack built **entirely from Heartfolio's own real material** — no
AI imagery, no invented UI, no stock photos.

- **Posters (Series A)** are the *real* print renders: produced by the project's
  own Pillow print renderers (`backend/apps/delivery/product_renderers/…`) from
  the committed marketing sample content and licensed sample photos
  (`backend/apps/delivery/marketing_samples/`) — all **6 Love Story Timeline
  layouts** and all **8 Song Poster themes**, in each language.
- **Live pages (Series B)** reuse the *real* capture files in
  `frontend-heartfolio/public/captures/<lang>/` — the live‑page video loops, the
  phone stills, the QR cards and the Studio recordings.
- **Brand system** throughout: the real brand fonts (Fraunces, Inter, JetBrains
  Mono, Noto Kufi/Naskh Arabic from `public/fonts/`), the brand colours from
  `globals.css`, and the logo geometry from `public/assets/logo-full.svg`.
  Frames, phone bodies, backgrounds and cards are all drawn in code.
- **Arabic** is fully right‑to‑left with correct shaping and letter‑joining
  (Pillow + raqm), using the brand's own Arabic faces.

Everything is in **English (`en`), French (`fr`) and Arabic (`ar`)**.

## Honesty rules applied to every piece

- Keepsakes are **delivered instantly** as a **private link + QR card** — **no
  app, no account**.
- Love Story Timeline and Song Poster also include **print‑ready files**;
  **nothing is shipped or printed for you**.
- Song Poster's digital page **plays the track from YouTube** (we don't sell or
  host music); its soundwave is **designed per order, not extracted** from the
  recording.
- Example lines ("what you could write") come from our **sample content and
  published guides** and are always labelled **"Example message"** — never
  presented as customer testimonials. **No customer names, reviews, ratings or
  numbers are invented.**

---

## Folder structure

```
social/
├── README.md                      ← this file
├── posting-plan/
│   ├── two-week-schedule.md        suggested 14‑day order (alternates A/B)
│   ├── posting-plan-en.md          caption + hashtags per piece (English)
│   ├── posting-plan-fr.md          caption + hashtags per piece (Français)
│   └── posting-plan-ar.md          caption + hashtags per piece (العربية)
├── contact-sheets/
│   ├── contact-sheet-en.png  ·  reel-frames-en.png
│   ├── contact-sheet-fr.png  ·  reel-frames-fr.png
│   └── contact-sheet-ar.png  ·  reel-frames-ar.png
├── series-a-posters/<lang>/        PRINTABLE ARTWORK (no phones)
│   ├── posts/                      8 × square posts (1080×1080)
│   ├── carousel-six-styles/        6 slides (1080×1350) "One story, six styles"
│   ├── flats/                      14 clean flat prints (6 LST + 8 Song)
│   ├── framed/                     14 framed‑on‑wall mockups (6 LST + 8 Song)
│   └── reels/                      2 vertical reels (1080×1920)
├── series-b-live/<lang>/           THE DIGITAL EXPERIENCE (on a phone)
│   ├── posts/                      6 × square posts (1080×1080)
│   ├── carousel-how-it-works/      5 slides (1080×1350)
│   ├── carousel-reasons-examples/  6 slides EN/FR · 5 slides AR (1080×1350)
│   └── reels/                      4 vertical reels, one per product (1080×1920)
└── _build/                         the generator scripts (provenance; see below)
```

Per language: **59 static images** (EN/FR) / **58** (AR) + **6 reels**.
Totals across three languages: **176 images + 18 reels**.

---

## Series A — Posters (file list, per language)

**Posts (`posts/`, 1080×1080)**
- `a1-lst-hero.png` — "One story, six ways to tell it" (framed Neat Stack)
- `a2-lst-cascade.png` — style spotlight: Overlapping Cascade (framed)
- `a3-lst-dotted.png` — style spotlight: Dotted Branching (flat)
- `a4-song-hero.png` — "Your song, as artwork" (framed Player)
- `a5-song-mosaic.png` — theme spotlight: Mosaic (framed)
- `a6-song-ledger.png` — theme spotlight: Ledger (flat)
- `a7-printready.png` — honest claim: print‑ready, framed by you
- `a8-dedication-quote.png` — example dedication (clearly labelled)

**Carousel (`carousel-six-styles/`, 1080×1350, 6 slides)** — cover (Neat Stack)
then Alternating Tilt, Overlapping Cascade, Dotted Branching, Horizontal
Polaroids, Horizontal Circles. All six real layouts.

**Flats (`flats/`) & Framed (`framed/`)** — every real print, both ways:
`love-story-timeline-{neat-stack,alternating-tilt,overlapping-cascade,dotted-branching,horizontal-polaroid,horizontal-circles}.png`
and `song-poster-{player,ledger,ephemeris,contactsheet,label,award,sleeve,mosaic}.png`.

**Reels (`reels/`, 1080×1920, ~18 s)**
- `ra1-love-story-timeline-six-styles.mp4` — slow reveal of all 6 layouts
- `ra2-song-poster-eight-themes.mp4` — slow reveal of all 8 themes

## Series B — Live pages (file list, per language)

**Posts (`posts/`, 1080×1080)**
- `b1-scan.png` — real QR card + real phone still: "scan or tap"
- `b2-lst-live.png` — Love Story Timeline live page in a phone
- `b3-reasons-live.png` — Reasons live + an example reason (labelled)
- `b4-grad-live.png` — Graduation Keepsake live page
- `b5-song-live.png` — Song Poster digital page (plays from YouTube)
- `b6-noapp.png` — honest claim: no app, no account

**Carousel (`carousel-how-it-works/`, 5 slides)** — cover + 4 steps, using the
real Studio, QR‑card and live‑page captures.

**Carousel (`carousel-reasons-examples/`, 6 slides EN/FR, 5 slides AR)** —
example lines reused from the published *Reasons I Love You* guide (Arabic uses
the sample content, since the Arabic guide isn't published), grouped and clearly
marked as examples, ending on the product.

**Reels (`reels/`, 1080×1920, ~18 s)** — `rb-love-story-timeline.mp4`,
`rb-song-poster.mp4`, `rb-reasons-i-love-you.mp4`, `rb-graduation-keepsake.mp4`.
Each is a hook card → the **real** live‑page capture loop playing in a phone →
2 text beats → an end card (logo + theheartfolio.com).

---

## How it was built (`_build/`, provenance)

Reproducible, so anyone can confirm nothing was invented:

- `brandkit.py` — brand colours, the real fonts, RTL‑aware text, the logo
  lockup, frame/phone/card builders.
- `content.py` — all on‑image copy in en/fr/ar (claims, labels, example lines).
- `build_images.py` — composes every static image from the real prints/captures.
- `build_reels.py` — composes the reels (Pillow for all text → ffmpeg for
  motion/compositing, so Arabic shapes correctly).
- `build_contact.py` — the contact sheets.
- `render_prints.py` — drives the project's own Love Story Timeline and Song
  Poster **print renderers** with the committed sample content and photos to
  produce all 6 layouts and 8 themes in en/fr/ar (no database: photo resolution
  is stubbed to read the local sample photos). The live‑page material is the
  committed capture set, used as‑is.
```
# regenerate (needs the project's backend Python deps + Pillow[raqm] + ffmpeg):
python _build/render_prints.py <out_dir>   # the 42 real prints (6 LST + 8 Song)
python _build/build_images.py              # static images
python _build/build_reels.py               # reels
python _build/build_contact.py             # contact sheets
```
