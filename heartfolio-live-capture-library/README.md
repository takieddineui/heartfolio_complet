# Heartfolio — Live Pack Visual Capture Library

An internal visual archive of the **real** Heartfolio Live experiences —
authentic Playwright captures of the actual product pages (mobile full-page,
meaningful interaction states, and desktop), **not** redesigned artwork, AI UI,
marketing mockups, or simulated screenshots.

Separate from the printable-artwork libraries (`lst-asset-library-v2/`,
`customer-artwork-library-v2/`); no existing assets were modified.

## Live experiences (see `audit/audit-report.md`)

Four experiences exist, are integrated and functional, and were captured:

| Product | Status | Captured |
|---|---|---|
| Love Story Timeline | integrated-functional | ✅ |
| Song Poster | integrated-functional | ✅ (YouTube playback not exercisable offline) |
| Reasons I Love You | integrated-functional (live-only) | ✅ |
| Graduation Keepsake | integrated-functional (live-only) | ✅ (discovered; journey = inner scroller) |

Not captured, with reasons: **Where We Met** (withdrawn, print-only — no live
page); **Wedding Invitation** ("wedding"/"wedding-gifts" are gift-intent
*categories*, not a Live pack); **Interactive Love Letter, Birthday Invitation,
Open When…, Relationship Time Counter** (absent — no product, route, component
or payload builder). Nothing was invented to fill a gap.

## How the captures were produced (authentic, no fabricated UI)

1. The project's **own backend builders** (`render_marketing_samples`, the same
   code a paid order uses) produced each experience's live payload for the
   fictional sample keepsakes, against a **local throwaway PostgreSQL 16** with
   **mock asset storage** — no Supabase, no R2, no production records.
2. Those payloads + photos were unpacked into the frontend's dev-only capture
   location (`.captures-work/`, git-ignored).
3. The Next.js dev server (`HEARTFOLIO_CAPTURE=1`) rendered them through the
   **same `LivePayloadView` as `/live/<id>`** at `/[locale]/capture/[product]`.
4. **Playwright** captured the real pages: consent pre-denied and the Next
   dev-tools overlay hidden (so neither appears), web fonts awaited, images
   loaded, pages scrolled to trigger lazy content, reduced-motion for a stable
   settled state, then full-page + interaction-state + desktop screenshots.

No production code, routing, checkout or customer content was changed.

## Structure

```
heartfolio-live-capture-library/
├── README.md
├── audit/audit-report.md
├── <product>/scenario-01/<en|fr|ar>/
│      mobile-full-page.png          full vertical page (390 CSS px wide, @2x)
│      mobile-state-01-*.png         initial / top
│      mobile-state-02-*.png         an interaction (lightbox / reason / journey)
│      mobile-state-03-*.png         a reveal (finale / ending)   [where it exists]
│      desktop-full-page.png         full page at 1440 CSS px wide
├── contact-sheets/<product>.png     states × languages grid, per product
├── manifest/manifest.csv · manifest.json
└── scripts/
       capture.mjs            Playwright capture (per-product interactions)
       build_manifest_qa.py   validation + manifest + contact sheets
       probe.mjs              structure probe used during development
```

**Viewports:** mobile = 390×844 CSS px at deviceScaleFactor 2 (images 780 px
wide); desktop = 1440×900 CSS px. Full-page images are tall master references
(e.g. LST mobile ≈ 780×7500) and are intentionally not optimised for posting.

**Per-product states captured**

- **Love Story Timeline:** mobile-full-page (the whole scrolling timeline),
  state-01-top (opening), state-02-photo-lightbox (a milestone photo opened),
  desktop-full-page.
- **Song Poster:** mobile-full-page, state-01-poster (poster + player controls,
  pre-play), desktop-full-page. *(Video playback can't run offline — see below.)*
- **Reasons I Love You:** state-01-initial (the jar), state-02-reason (a reason
  revealed), state-03-finale (all reasons + the letter), mobile-full-page,
  desktop-full-page.
- **Graduation Keepsake:** state-01-start (boarding pass), state-02-journey
  (the postcards), state-03-ending (ready for take-off), mobile-full-page
  (start screen — see below), desktop-full-page.

## QA results

`scripts/build_manifest_qa.py`: **51 / 51 captures pass** — each file opens,
has non-zero dimensions, and is not a blank/flat image. Every file maps to a
product, scenario, language, viewport and state in the manifest. Visually
reviewed across all four products and all three languages: real design, fonts
and images loaded, **no cookie banner, no Next.js dev overlay, no skeletons,
error pages or debug panels**, no clipped content, and **Arabic RTL / shaping
correct** (mirrored layout, joined script) in every experience.

## Known limitations

- **Song Poster — YouTube playback not exercisable.** No network path to
  YouTube here (`ERR_TUNNEL_CONNECTION_FAILED`), so captures show the authentic
  poster + pre-play controls, not the playing video.
- **Graduation Keepsake — journey is an inner scroller.** The journey scrolls
  inside its own element, so the mobile full-page shows the **start screen**;
  the journey is captured as states (start → journey → ending) rather than
  stitched into one tall image (stitching would duplicate sticky elements).
- **Languages = en, fr, ar only** — the languages the live experiences actually
  support (`CAPTURE_LOCALES`). No other language is implied to be live.
- **One sample scenario per product** (the committed sample set). A second
  scenario would require authoring additional backend sample data.

## Regenerate

Requires: local PostgreSQL + the backend venv (Django etc.) + the frontend
`node_modules` + the pre-installed Playwright.

```
# 1) build the live payloads from the real backend (throwaway DB, mock storage)
DATABASE_URL=postgres://heartfolio:heartfolio@localhost:5432/heartfolio \
ASSET_STORAGE_BACKEND=mock python manage.py render_marketing_samples --output /tmp/bundle.zip
#    then unzip payloads/* assets/* into frontend-heartfolio/.captures-work/
# 2) run the dev server in capture mode
HEARTFOLIO_CAPTURE=1 BACKEND_API_ORIGIN=http://localhost:8000 next dev -p 3000
# 3) capture + validate
node scripts/capture.mjs
python scripts/build_manifest_qa.py
```
