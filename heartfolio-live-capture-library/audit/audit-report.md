# Live experiences — audit report

Produced before capturing, by inspecting the actual codebase (product
registry, routes, live-page components, the live-payload builders, and the
capture harness). Captures were generated **only** for experiences that
actually exist and render.

## Method / evidence

- **Live route:** a single dispatching page `src/app/[locale]/live/[liveId]/page.tsx`.
- **Live experience components:** `src/components/live` (Love Story Timeline),
  `src/components/live-song` (Song Poster), `src/components/live-reasons`
  (Reasons I Love You), `src/components/live-graduation` (Graduation Keepsake).
- **Backend live payloads:** `backend/apps/delivery/live_views.py`
  `_LIVE_PAYLOAD_BUILDERS` — keys: `love-story-timeline`, `song-poster`,
  `reasons-i-love-you`, `graduation-keepsake`.
- **Capture harness (the project's own):** `src/lib/captures/capture-mode.ts`
  declares `CAPTURE_PRODUCTS` = exactly those four, and `CAPTURE_LOCALES` =
  `en, fr, ar`. These four, in those three languages, are what the product can
  actually render, so they are what was captured.

## Classification

| Product | Status | Live component / evidence | Captured? |
|---|---|---|---|
| **Love Story Timeline** | **Integrated & functional** | `components/live`, builder `love-story-timeline` | ✅ yes |
| **Song Poster** | **Integrated & functional** | `components/live-song`, builder `song-poster` | ✅ yes (see limitation) |
| **Reasons I Love You** | **Integrated & functional** (live-only product) | `components/live-reasons`, builder `reasons-i-love-you` | ✅ yes |
| **Graduation Keepsake** | **Integrated & functional** (live-only product) | `components/live-graduation`, builder `graduation-keepsake` | ✅ yes (discovered — not on the initial list) |
| **Where We Met** (`heart-map` / `where-we-met`) | **Withdrawn / print-only** | In the registry but `disabled`; a map *print*, no live-page component; excluded from `CAPTURE_PRODUCTS`; "never opened in a browser" (CLAUDE.md) | ❌ no live experience exists |
| **Wedding Invitation** | **Absent as a product** | "wedding" / "wedding-gifts" are **gift-intent categories** (gift collection pages `/gifts/<slug>` and tags), not a Live product or pack | ❌ not a product |
| **Interactive Love Letter** | **Absent** | No product, route, component or builder (0 source references) | ❌ |
| **Birthday Invitation** | **Absent** | No product/route/component; "birthday" appears only incidentally in copy | ❌ |
| **Open When…** | **Absent** | No product, route, component or builder (0 references) | ❌ |
| **Relationship Time Counter** | **Absent** | No product, route, component or builder (0 references) | ❌ |

**Four Live experiences exist and were captured; four of the suggested
products do not exist in this codebase, one is a withdrawn print-only product,
and "wedding" is a gift category, not a Live pack.** No missing page was
invented, and no prototype was represented as integrated.

## How the real pages were rendered (no fabricated UI)

The real backend builders (`render_marketing_samples`, the same code a paid
order uses) produced the live payloads for the fictional sample keepsakes
against a **local throwaway PostgreSQL 16** database with **mock asset
storage** (no Supabase, no R2, no production records). Those payloads + photos
were unpacked into the frontend's own dev-only capture location
(`.captures-work/`), and the Next.js dev server rendered them through the very
same `LivePayloadView` as `/live/<id>` at `/[locale]/capture/[product]`
(`HEARTFOLIO_CAPTURE=1`). Playwright then captured those real pages. Nothing in
production was modified.

## Known limitations

- **Song Poster — YouTube playback not exercisable here.** The digital page
  plays the track from YouTube in an embedded player; this environment has no
  network path to YouTube (`ERR_TUNNEL_CONNECTION_FAILED`), so captures show
  the authentic **poster + player controls (pre-play)** state, not video
  playback. This is an environment limitation, not a product defect.
- **Graduation Keepsake — journey is an inner scroller.** The journey scrolls
  inside the keepsake's own element (window height stays one viewport), so the
  mobile "full-page" shows the **start screen**; the journey itself is captured
  as interaction states (start → journey → ending). Documented, not stitched.
- **Languages:** only `en, fr, ar` are captured, because those are the
  languages the live experiences actually support (`CAPTURE_LOCALES`). No other
  language is represented as live-supported.
- **One sample scenario per product** (the project's committed sample set). A
  second scenario would require authoring additional backend sample data.
