# CLAUDE.md

Read automatically at the start of every Claude Code session. It records
what cost real time to discover — the things that are true about this
project but not visible from any one file.

The nine `*.md` docs beside this one describe the product and the
architecture. They were written as a snapshot and have drifted before;
several corrections are noted below. **Confirm against the code before
relying on any of them.**

---

## Layout: two repos, side by side

```
heartfolio/
├── backend/                  Django   (repo: heartfolio-backend)
├── frontend-heartfolio/      Next.js  (separate repo)
├── docker-compose.yml
└── .env.docker.example
```

Older docs said `backend/backend/` and `frontend/heartfolio/`. That
monorepo no longer exists, and the stale description broke both
`docker compose up` and the parity test.

---

## Hosting

| Piece | Where | Notes |
|---|---|---|
| Development | **Local Docker** — `docker-compose.yml` runs `api`, `web` and a throwaway `db` | Where all development and testing happens now |
| Production | **Not deployed yet.** Will be a **VPS running this same Docker setup** | **Railway and Vercel are no longer used** — both were past hosts, not the plan. Anything still describing a Railway deploy window, a Railway-managed backend or a push-to-deploy Vercel frontend is stale |
| Database | **Supabase** | Session-mode Supavisor pooler. Not changed by the move off Railway/Vercel; which database the VPS uses is not settled by this note |
| Payments | **Three providers exist in code — Paddle, FastSpring, Freemius.** Freemius is the only one wired into checkout, and is still **sandbox** | `FREEMIUS_ENABLED` / `isFreemiusCheckoutActive()` pick it. Paddle and FastSpring are complete code paths left in place, untouched |

**`FREEMIUS_PLAN_MAPPING` covers only `love-story-timeline`,
`reasons-i-love-you` (plan 71990, its `live` pack) and `graduation-keepsake`
(plan 72194, its `live` pack)**
(`apps/commerce/freemius_integration.py`). There is ONE Freemius product
(`FREEMIUS_PRODUCT_ID`, one public key, one secret key for webhooks): a new
product is new PLANS under it, never a second Freemius product, whose webhooks
would fail the signature check. `heart-map` and `song-poster` (VISIBLE since 15 Oct 2026, for testing only) have no plan, so `stage_freemius_checkout` raises `FreemiusPlanNotConfigured` for
them: **they cannot be bought through Freemius yet.** Freemius has no custom
amount and sells one plan per checkout, so every purchasable pack needs its
own plan, mapped by `"product:pack"` — adding a product's packs means creating
plans in the Freemius dashboard first. FastSpring's map
(`PACK_SLUG_TO_PRODUCT_PATH`) is separate and is not extended for new packs.

`config/db_backends/postgresql_patient` was written for the **session-mode**
pooler. Transaction-mode is a different port and would need
`DISABLE_SERVER_SIDE_CURSORS`, which this project does not set.

---

## Traps that have already cost hours

**The Studio preview and the downloaded print are two separate renderers.**
CSS (`renderer.module.css`) and Pillow (`png_renderer.py`) implement the same
design with no shared source except a few numbers in `compositions.py`.
Anything not pinned there drifts silently: the print never drew the subtitle,
and still drops locations on three layouts. **Read `PRINT-RENDERER-GUIDE.md`
before touching any Love Story Timeline style or building a new product's
print.** It has the method for reading the preview's real values, the bugs
every style should be checked for (the shared text-size estimate undercounts
by 21-25%; card sizing; unwrapped text; ellipsis cuts; missing fields), and
the done-checklist. Restart `api` after renderer changes, because gunicorn
does not reload.

**Server components cannot use `apiFetch`.** It builds a *relative* URL
(`/api/backend/...`) for the browser. On the server there is no origin, so
`fetch` throws immediately — and a `catch` that calls `notFound()` turns it
into a silent 404 with no request in the network tab. Go to
`BACKEND_API_ORIGIN` directly, as `catalog-server.ts` and the live page do.

**Never percent-encode the order token.** `withToken` appends it raw. The
Next rewrite encodes once more, so an encoded `:` arrives at Django as
`%253A`, decodes to a literal `%3A`, and the signature is rejected. Every
magic link fails.

**`production.py` must MERGE throttle rates, never rebuild them.** Writing
the dict fresh silently drops every scope `base.py` defines but the block
does not restate. DRF then raises `ImproperlyConfigured` the first time a
view with a missing scope is hit — surfacing as a 500 on an unrelated
endpoint, not at startup.

**Two hardcoded `supported_targets` maps must stay in sync**, in
`apps/products/admin.py` and `seed_catalog.py`. A new product's packs
cannot be saved or seeded until both know about it. They drifted once
(`song-poster` was missing from the admin's, so the admin validated nothing
for its packs; fixed 14 Oct 2026), and `CatalogTargetMapParityTests`
(`apps/products/tests.py`) now fails if any seeded product differs between
the two (the admin adds AR targets on top).

**Paid audio/video is kept per product.** `apps/commerce/media_promotion.py`
clears the expiry only on the asset ids its `_MEDIA_COLLECTORS` entry finds;
a product with no entry gets Love Story Timeline's `events[]` reader. A new
product with audio or video anywhere else must register a collector, or
`expire_provisional_assets` deletes its media a week after the customer paid.
Photos never expire and need nothing.

**`backend/.env.example` must not set `ALLOWED_ASSET_MIME_TYPES`.** It used
to set the three image types, which would refuse every voice note and video at
the server (a test now fails if it comes back). Checked 14 Oct 2026: the
running `api` container does not set it, so the full default applies.

**Every `_choice_field` default must be a member of its own choices.** The
`layout` default was `"centered"`, which §7 removed from `LAYOUTS` — so any
project without an explicit layout failed validation *after payment*. Check
all five if you touch that file.

**Docker build-time env vars.** `collectstatic` runs during the image build
and imports production settings, so `DJANGO_ALLOWED_HOSTS` and
`CORS_ALLOWED_ORIGINS` must be present in the `RUN` line even though
nothing uses their values. `/app` is root-owned by `WORKDIR`, so
`staticfiles` is created and chowned before `USER heartfolio`.

**Migrations and seeding are deliberately manual.** No deploy runs them.

**Tests never reach the outside world: `config/test_runner.py`, the
`TEST_RUNNER` for every settings module (18 Oct 2026).** Until then
`docker compose exec api python manage.py test` inherited `.env.docker`'s real
keys. A survey of the full suite with every outbound lookup blocked and
recorded found three hosts:
- `api.telegram.org`: 22 tests (the payment webhooks and completion, the
  amount-reconciliation tests, two Paddle signature/security tests, a
  pack-download failure test). By the logs, about 13 to 22 real "PAID" and
  "mismatch" alerts with fake order data reached the owner's alert chat on
  every full run (Telegram logs only failures, so the rest were accepted).
- `api.resend.com`: 14 tests. Every real send in the six runs checked (14-15
  Oct) was rejected by Resend or failed to connect; none was delivered.
- The real R2 bucket: `tests_service_health`'s registry test probed it.

The runner now does three things:
- It blanks `RESEND_API_KEY`, `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`
  for the whole run.
- It refuses every non-local name lookup (loopback, the database host and
  `testserver` stay allowed), as `OutboundNetworkBlocked`, a
  `socket.gaierror`, so code sees "network down".
- It FAILS the run, listing each blocked host and the test that asked for
  it.

A test that needs a key sets a fake one with `override_settings` and stubs
the call. Not covered: `--parallel` workers (not used here), and psycopg,
which resolves the database host in C (the database only).
`HermeticTestRunnerTests` pins it (mutation-checked, 9 of 9).

**`backend/.dockerignore` strips `tests_*.py` and `**/tests.py`**, so
`manage.py test` inside the built image finds 5 tests instead of 649. The
compose file mounts `./backend` over `/app` to work around this.

---

## Running the tests

Backend — **always** redirect to the throwaway Postgres, never Supabase:

```
docker compose exec -e DATABASE_URL=postgres://heartfolio:heartfolio@db:5432/heartfolio \
  -e ASSET_STORAGE_BACKEND=mock api python manage.py test
```

Without those two overrides, `.env.docker` leaks in: `r2` storage breaks
the mock-storage assertions, and `PAYMENT_PROVIDER=mock` makes production
settings fail with the wrong error. Email and Telegram need no override: the
test runner blanks their keys and blocks every outside host itself (see
"Tests never reach the outside world" above). A run that lists `BLOCKED`
hosts at the end has a test using the network: stub it.

Frontend — run on the host, not in the `web` container (it is a production
build with no dev dependencies):

```
cd frontend-heartfolio && npm run typecheck && npm run lint && npm run test
```

`composition-parity.test.ts` reaches into the Python renderer. It resolves
`HEARTFOLIO_BACKEND_PATH`, then `../backend`, then the old monorepo path,
and **throws** if none match. Do not make it skip: it is the only thing
keeping the CSS preview and the Pillow renderer in agreement, and a
skipped parity test reports drift as green.

---

## The first real test run

The suite had never been executed. 649 tests, 54 failures — almost all
stale fixtures, not broken code:

- test doubles missing the `locale` parameter added to `ProductRenderer.render()`
- `SalesAnalyticsTests`, `ARLifecycleTests`, `LookupQueryTests` had **no `setUp` at all**
- fixtures using `"asset-1"`, which is not a UUID, so real render paths refused them
- assertions on `partner1`/`partner2`, replaced by `people` in §16
- catalog tests iterating `response.data` as a list when it is an object

Two were genuine product bugs: the `layout` default above, and
`ProductListView` referencing an undefined `product` (every call to
`/api/v1/products/` returned 500).

---

## Decisions worth not relitigating

- **Combos, not a bundle.** The fixed Complete bundle is retired. Customers
  buy base units (Printable, Digital) singly or together; **each purchasable
  combination is its own `DeliveryPack`**, with its own price and its own
  Freemius plan. `Order.delivery_pack` stays a single FK — a combination order
  is an order for the pack that *is* that combination, so there is no
  `OrderItem` and no migration. Plan count for n units is 2ⁿ−1 (3 today; 7
  with AR), so only sell the combinations worth selling. `complete` is
  **disabled, never deleted** (`Order.delivery_pack` is RESTRICT, and delivery
  does not check pack status, so past orders keep downloading).
  `printable-plus-digital` is $35.99: the bases ($22.99 + $15.99 = $38.98) less
  a flat discount, rounded to a clean price — flat, not a percentage, by
  decision. Freemius Bundles were considered and deliberately not pursued.
- **`BACKEND_API_ORIGIN` is required — no fallback.** The frontend used to
  default to a hardcoded Railway URL; that silently pointed an unset
  environment at a dead host (and froze it into `.next/routes-manifest.json` in
  Docker builds). `getBackendOrigin()` (`src/lib/backend-origin.ts`) now throws,
  and an empty value counts as unset. It is resolved *outside* the
  graceful-degradation `try/catch` in `catalog-server.ts` and the live page, so
  it surfaces as a configuration error rather than a silently empty storefront
  or a 404 for every keepsake. `docker-compose.yml` sets it for both the build
  arg and the runtime environment; vitest sets a test value in `vitest.config.mts`.
- **The receipt email's QR is the GIFT card (the recipient's), never the
  buyer's.** The buyer's card encodes the order page behind a signed token that
  expires after `ORDER_ACCESS_TOKEN_MAX_AGE_DAYS` (30), so it must not be
  handed to a recipient. The email carries it inline and as
  `heartfolio-gift-qr.png`, with copy that does not say "print it" is the only
  use. The card is rendered *before* the body is built, so if the live
  experience is not active the QR section is omitted entirely rather than
  leaving a broken image beside an "attached" claim. The buyer's order access
  is the "Open your order" button; the order page shows only the recipient's
  card too. The QR zip still contains the buyer's card designs — undecided.
- **Downloads: the success screen is a summary, the order page is full.**
  `OrderDownloads` (`components/commerce/order-downloads.tsx`) takes
  `variant="summary" | "full"` (default full). Summary — the success screen —
  is the whole-pack archive plus the gift QR card (with a "Download gift QR"
  link to the single recipient PNG); a Digital-only order has no archive, so
  there the gift card is the primary action. Full — the order page — adds every
  individual zip under "Download individual files" (printable, bonuses, QR
  cards), because the whole pack is the heaviest render in the system and the
  small zips are the fallback when it fails. The whole pack already contains
  every file the individual zips do (measured: Printable + Digital = 12 print
  files + `bonus/` thank-you, how-to-print and 6 QR PNGs).
- **The checkout shows a unit toggle only where the combo exists.**
  `unitSelectionModel` (`lib/commerce/pack-presentation.ts`) returns null for a
  product with no combo pack, which then keeps the plain pack cards. The
  set→slug tables there are explicit: Digital's DB slug is `live`, its combo is
  `printable-plus-digital`.

- **Location search stores the customer's typed text**, not Mapbox's name.
  Mapbox supplies coordinates only. `language` on Search Box is the
  RESPONSE language, not the search language, and French cannot be told
  from English by a one-word place name — so no parameter can honour "answer
  in whatever language the query was written in".
- **No `types` filter on `/suggest`.** Filtering excluded streets,
  districts and regions.
- **The Digital keepsake is a hosted page**, not a downloadable
  `gift.html`. Delivery short-circuits `__live__` to the live URL.
- **Downloads offer the pack archive only**, plus one row for the digital
  entitlement, which has no bytes to zip.
- **The ops screens stay separate** with a shared tab bar. Lookup is
  read-only by design; actions belong on screens that say what they do.
- **No accounts.** Recovery is `/api/v1/ops/resend/`, which re-sends a
  fresh 30-day link. Photos never expire and artwork renders on demand, so
  a paid order stays deliverable indefinitely.

---

## Still open

- **Reasons I Love You (`reasons-i-love-you`) is LIVE on the storefront (14 Oct
  2026), the first LIVE-ONLY product: no print, no renderer output, one `live`
  pack at $15.99 granting `__live__`.** How a print-less product fits (registry
  entry for the pre-payment check only, `_LIVE_PAYLOAD_BUILDERS`, `renderer:
  { kind: "live" }`, hosted delivery) is in `ADDING-A-PRODUCT.md`. Freemius plan
  **71990** ($15.99, one-off, single price point, under the existing Freemius
  product) is mapped as `reasons-i-love-you:live` and pinned by
  `FreemiusPlanMappingTests`. The real seed ran on 14 Oct 2026 (product and
  `live` pack created in Supabase; 4 products / 17 packs) and `hidden` is now
  `false`. **Still to do: one sandbox checkout by the owner** (rebuild `web`
  first: `docker compose up --build web`). v1 leaves out, by
  decision and without stubs: the recipient's reply, any open/read tracking,
  the own-song upload, a scheduled send, drag to reorder, edits after
  purchase; the branding line is always shown, as on the other live pages.
  The prototype (`reasons-i-love-you.html`) is the design reference; its
  daisy scattered its petals (`transform-box: fill-box` on the petal group),
  fixed in the port. The fonts are self-hosted in `public/fonts/reasons/` with
  their licences; Merienda, Limelight and Marcellus reserve their names, so
  they are the original files, not subsets (bigger: Merienda is 226KB). Arabic
  falls through to the site's Kufi (display) and Naskh (text); an Arabic
  signature is revealed whole, never letter by letter (that breaks joining).
  Lengths are named in `limits.ts` and `data.py` and pinned equal by a test;
  the letter paragraph cap (500) has no precedent. The French and Arabic copy
  has not had a native review. Live-page photos load lazily, so their 300s
  presigned links can expire before a reason is opened; the page refetches its
  payload once (20s cooldown) when a photo fails.
- **Song Poster (`song-poster`) is VISIBLE but NOT SELLABLE (15 Oct 2026).**
  `hidden` was flipped to `false` so the owner can open its real Studio and
  test it; it has NO Freemius plan, so a customer reaching checkout uploads
  their media and is then refused (`FreemiusPlanNotConfigured`, shown as the
  raw English backend sentence). Map plans or set `hidden: true` again before
  the VPS goes live. Its standalone `wallpaper` pack is now `disabled` in the
  seed (as Love Story Timeline's; the owner's real seed run applies it); the
  wallpaper add-on checkbox was already hidden for every product
  (`SHOW_WALLPAPER_ADDON`). Its `complete` pack is still the old
  print + wallpaper + digital bundle, predating "combos, not a bundle"; whether
  it gets the combo treatment is the owner's open decision. An investigation of
  its Studio, preview and print (15 Oct 2026) found real problems, not yet
  fixed. **The YouTube blocker is FIXED (15 Oct 2026):** nothing in the Studio
  called `YouTubeValidateView`, so `youtubeVideoId` was never set and no
  customer could reach checkout. The link is now a `youtube` field
  (`components/studio/generic-form/youtube-field-input.tsx`): it checks a
  recognised link once the typing pauses (500ms), once per video id, writes the
  confirmed id beside the link, clears it in the same edit that changes the
  video, and ignores an answer for a link that has since changed. The endpoint
  answers with a `code` the Studio translates (`unavailable` for oEmbed's
  400/401/403/404, `checkFailed` for anything that means "could not check",
  which offers a retry). Verified through a real checkout on the throwaway
  database both ways: the Freemius path now stops at
  `freemius_plan_not_configured` (after the server accepted the project), and
  the mock-payment path completed a paid order, its downloads and a live page
  that plays the song. YouTube's oEmbed is intermittently unreachable from the
  company network (timeouts), which shows as "couldn't check" plus retry, as
  designed. Still open, found during that checkout: the pack cards show raw
  keys (`packs.live.name`), because Song Poster's messages define no pack
  names, the same family as its raw `exports.*` labels.
  **Player's placeholder code is FIXED (18 Oct 2026):** every Player print used
  to end with a fake 5x5 "code" (the prototype's `codeSVG`, which nothing
  could scan) and the designer's label "CODE POSITION — LINKS TO YOUR PAGE",
  which the preview never showed. Both are gone, as is the preview's unused
  English label. The dedication now sits where the preview puts it: named
  `PLAYER_*` constants in `png_renderer.py`, read against the CSS by
  `player-print-parity.test.ts`. The renders for every other theme, and
  Player's wallpapers, are byte-identical (264 of 288 hashed; the 24 changed
  are Player's print sizes). Still open from the audit: print fonts, Arabic
  tofu in DejaVu Serif, raw `exports.*`/`packs.*` keys, and the product page's
  false "actual waveform" claim. **Frameless prints FIT, never cut (18 Oct 2026):** `render_png` scaled
  frameless prints with `max`, cutting off whatever did not fit when the
  paper's shape differs from the design's (Award's "ARDED FOR ONE RECORDING"
  on 8x10; 66.7 design units each side of every portrait theme on the 12x18
  poster). It now uses `min`, centred. The spare paper is the theme's
  background (Sleeve repaints the whole canvas in its palette), so there are
  bands of plain paper: 1.5in top and bottom on the 12x18 poster for portrait
  themes, 0.68in on A4, 0.67in on 8x10 for Award and Sleeve, 0.24in on A4.
  Whether the poster bands need a dedicated poster layout is the owner's call,
  not built. Exactly the 64 frameless renders whose shapes differ changed
  (16 per text case); 224 are byte-identical. `FramelessFitTests` checks
  that no design pixel touches a page edge and that the composition is whole
  and centred.
  **Dedications wrap and titles fit in the print (18 Oct 2026):** the print
  cut every dedication to one line with "…" (a 180-character one lost about
  half) and cut titles the preview showed whole. Dedications now wrap in full
  in all seven themes that write one, at the preview's width, size and line
  height (`DEDICATION_LAYOUT`; Ledger, Ephemeris and Label's `56ch` was
  measured in the browser as 528.3/544.7/475.5 design units and must be
  re-measured if their CSS or font changes). Where extra lines go: Player and
  Award grow UPWARD (Player's last line keeps its place above the bar, Award's
  plaque is anchored at the bottom), Mosaic's card grows to hold them, the
  others flow downward. A first line is placed exactly as before, so a
  one-line dedication prints identically. Titles (`TITLE_LAYOUT`) shrink to
  `TITLE_MIN_SCALE` (80%) before falling back to "…" at that floor, so the
  print shows at least what the preview shows; Sleeve's title has two lines,
  as its preview does (`SLEEVE_TITLE_LINE_HEIGHT` 1.04). Found and fixed on
  the way: `_mosaic_card_height` mixed pixels and design units, so the card
  was shorter than its own text and the footer ran under the hearts. Pinned
  by `DedicationWrapTests` and `TitleFitTests` (the whole dedication printed,
  nothing leaves the page, overlaps other text or crosses a rule or box) and
  `song-poster-print-parity.test.ts` (both tables against the CSS). 102 of
  288 renders changed: every theme at maximum length, and only Ledger, Sleeve
  and Mosaic otherwise; wallpapers are byte-identical. Sleeve's ring text is
  out of scope. **Still open, seen in these renders and not fixed:** a long
  artist touches the title in Ledger and Sleeve; Mosaic's long artist runs
  into the heart and the wordmark; Award, Label and Mosaic's dedications and
  Contact Sheet's caption print upright where the preview is italic, because
  `DejaVuSans-Italic.ttf` is not in the font folder.
- **UNEXPLAINED NAVIGATION TO THE HOME PAGE: a real, currently unreproduced
  bug (15 Oct 2026).** Three times during browser testing the page jumped to
  `/en` on its own: twice in the Song Poster Studio (once after switching the
  style to Mosaic, once on clicking Continue), and once on a paid order's live
  page a few seconds after it loaded. The owner confirms nobody else was using
  the browser pane. Each time the dev server logged a plain full-page
  `GET /en`, with no error in the console or the server log. No code in
  `frontend-heartfolio/src` navigates there: the only scripted navigations are
  the locale switcher (same path, other locale), `window.open` for the live URL
  and the order page's `router.push`. It was not caused by the YouTube fix: the
  first occurrence came before that work started. It could not be reproduced on
  demand; with a real click, Continue opened the checkout normally. When the
  Studio jumped, the customer's unsaved draft (text and photo) was lost.
  Flagged for whoever investigates next, outside any fix so far.
- **Graduation Keepsake (`graduation-keepsake`) is VISIBLE on the storefront (15
  Oct 2026), the second live-only product: one `live` pack at $15.99, one story
  told as one of five journeys** (Next Chapter Airways, Mission: Graduation,
  Level Complete, The Retrospective, The Summit; `journeys.ts`), all five built.
  Backend `product_renderers/graduation_keepsake/` (`data.py`, `renderer.py`,
  `live_payload.py`), Studio module `lib/studio/product-modules/graduation-keepsake/`,
  experience `components/live-graduation/`. Freemius plan **72194** ($15.99,
  one-off, single price point, under the existing Freemius product, created 15
  Oct 2026) is mapped as `graduation-keepsake:live` and pinned by
  `FreemiusPlanMappingTests`. `hidden` is `false` (pinned by
  `graduation-module.test.ts` and the visible-list tests). **Still to do, the
  owner's:** the real seed (rehearsed on the throwaway database: it creates the
  product and its `live` pack, ending at 5 products / 18 packs), then one sandbox
  checkout (rebuild `web` first). Until the seed has run, the product page has
  no pack to sell. Decided, and not stubbed: no reply or reactions, no report back to
  the creator, no collection link, no scheduled send, chapters in a fixed order,
  captions untimed, no edits after purchase, branding always shown, sound
  effects only (no music; the prototype has none either). **Limits approved 14
  Oct 2026** (`limits.ts` = `data.py`, pinned by `graduation-module.test.ts`):
  stops 1-12, achievements 1-10 (26/40/16), groups 1-3, people 1-12, message
  300, and **5 voice messages and 5 drawings per KEEPSAKE** (across every
  person), so the worst case is 25 uploads at checkout against production's
  `asset_upload` 30 a minute. Airline-only fields (codes, places, the boarding
  pass) are hidden, unvalidated and dropped on the other journeys, front and
  back. The prototype's 13 bugs plus a 14th (the airline start screen clipped
  on a 375x550 phone even with the example data) are fixed and each has a
  test; found while building and fixed: postcards cut a 300-character message,
  hidden stamps widened the page sideways, a long voice caption pushed its row
  past the phone, the arcade's hidden banner peeked in at the top, a hero photo
  that failed before hydration never asked for a fresh link. **Still to verify
  on real devices (not possible here):** what type iPhone and Android browsers
  declare for a received voice file (`.m4a`, WhatsApp `.opus`), playback of
  the re-encoded AAC on iOS Safari, and that iOS lets the museum's audio guide
  start from the tap that opens it (it plays inside that tap, which is what iOS
  requires; Chromium verified). The French and Arabic are plain translations,
  not native-reviewed. Press Start 2P has the French capitals (checked in its
  character map), but its pixel "É" looks small beside the other capitals.
- **THE FIRST SCROLL LISTENER ON A LIVE PAGE (Graduation Keepsake, decided 14
  Oct 2026).** Love Story Timeline's live page forbids scroll listeners (an
  observer triggers its motion, and tests enforce it). Graduation's summit
  journey shows a LIVE altimeter, a number that changes with every pixel
  scrolled, and the plane rides down the path; an observer only reports
  thresholds, so it cannot drive either. Kept cheap: ONE listener, on the
  keepsake's OWN scroller (never the window, so the Studio's page is
  untouched), `passive: true`, and the handler only schedules a
  `requestAnimationFrame`, so it does at most one update per frame and reads
  layout only there. Under reduced motion the plane stays still and the
  altimeter still reads correctly. Tests: no window scroll listener, exactly
  one passive listener on the scroller, the handler only schedules. Measured
  in the browser: the altimeter reads half the summit (2,404 m) at half the
  page. Not yet measured on a mid-range phone.
- **Audio uploads: one minute, more file types (14 Oct 2026, for Graduation's
  voice messages).** `MAX_AUDIO_SECONDS = 60` for every product (the upload
  endpoint does not know the product and an `Asset` keeps no duration); video
  stays 30. Love Story Timeline's voice note keeps 30 seconds through its own
  recorder (`maxSeconds: 30`, Studio only). Accepted now: `audio/ogg`,
  `audio/opus`, `audio/x-m4a`, `audio/mp3`, `audio/x-wav`; the probe decides
  what a file really is and `reencode_audio` rewrites every audio file to AAC
  (cut to 60 seconds of samples). A received file the browser left untyped
  gets a type from its extension (`withInferredAudioType`).
- **Printable + Digital is seeded and mapped (4 Oct 2026) but not yet
  exercised end to end.** Freemius plan **70543**, $35.99, mapped as
  `love-story-timeline:printable-plus-digital`; the pack is active and `complete`
  is disabled in the real database. Still to do: one sandbox checkout of the
  combo, run by the user (never by Claude — it writes to Supabase). Rebuild the
  `web` image (`docker compose up --build web`) to get the unit toggle; the
  running `web` container predates it.
- **Plan 70518 is Complete and must stay Complete.** The real database has **7
  paid orders on `complete`** (of 31 paid overall). The combo was briefly set up
  by editing 70518 in the Freemius dashboard instead of creating a new plan; it
  was reverted. Never rename or retarget a plan that has licenses — create a new
  one. The mapping tests pin 70518 to `complete` and 70543 to the combo.

- **The live page now honours all 8 palettes and the typography axis (12 Oct
  2026, `components/live/live-theme.ts`).** It had its own CSS palette list that
  styled 4 of 8 (Terracotta, Gilded and Forest Night fell back to cream) and
  ignored typography entirely. It now takes colours and fonts from the Studio's
  tokens in `themes.ts`, so there is one list; `live-theme.test.tsx` pins every
  palette against the print's table in `data.py`. Arabic headings keep Kufi via
  an Arabic-only alias face (it leads each heading stack, so even Modern Sans'
  Naskh does not win). The text-scale axis is still ignored on the live page. The
  live selector (A/B/C scopes) is undecided, pending the owner seeing this fix
  live.
- **The typography tokens now name real fonts (13 Oct 2026).** They used to
  name `'Fraunces'`, `'Inter'` and `'JetBrains Mono'`, none of which was a
  registered `@font-face` family, so every browser drew its own fallback (Georgia,
  system sans, Comic Sans-like cursive, monospace) and the preview and live page
  varied by device. Now: Serif Classic = Heartfolio Serif (Fraunces) headings +
  Heartfolio Sans (Inter) body; Modern Sans = Inter; Romantic Italic = Fraunces
  SLANTED (`--poster-heading-style`, because the print draws DejaVu Serif Italic;
  renamed from "Romantic Script" on 13 Oct 2026 because it promised a cursive face
  that was never built; label only, the option id stays `script` since saved
  projects store it). French and Arabic had NO typography labels at all (the
  heading and all four options fell back to English inside a localized Studio);
  they now have their own, pinned by `typography-fonts.test.ts`, which checks each
  locale's own dictionary and not the English fallback. The Arabic names are a
  plain translation that has not had a native speaker's review. The whole
  Appearance section is now translated (typography, the eight palette names, which
  are the swatches' tooltips, and "Text Scale"), pinned by
  `appearance-labels.test.ts` for every axis. **Still English in fr and ar** (the
  module dictionary's `en` has them, `fr` and `ar` do not, found by diffing the
  keys 13 Oct 2026): the milestone field labels (date, title, description,
  photo), the ending-text and poster-title labels and placeholders, the help text
  of "show duration" and "auto sort", and most pack descriptions
  (`packs.*.description`); the legacy layout option keys and `renderer.premium.*`
  have no other users in the source and are probably dead. Not fixed (out of the
  requested scope); Typewriter =
  JetBrains Mono (`public/fonts/jetbrains-mono-latin.woff2`, ~40KB, OFL text beside
  it). `typography-fonts.test.ts` fails if a token names an unregistered family or
  its file is missing, and pins each option's kind (serif/sans/mono, slant) to the
  print's `FONT_FILES`. **Accepted, logged:** the print still draws DejaVu for
  everything, so preview and print typography differ (known); and Serif Classic's
  BODY is sans in the preview and live page but serif in the print
  (`KNOWN_BODY_KIND_GAPS` in that test fails if it changes either way). Where We
  Met has the same token-naming bug and is NOT fixed, by decision.
  **Preview/print LINE-SPACING drift, found twice then audited across every
  layout (13 Oct 2026), fixed with the print's own values.** The preview
  inherited the page's 1.5 (the description had its own 1.45) where the print
  sets 1.35: Dotted title/location (`DottedGeometry.text_line_height`), and
  Neat Stack, Cascade and Alternating Tilt title/description/location
  (`text_line_height`, with `date_line_height` 1.5, 1.5 and 1.6 on the three;
  the preview's Alternating date was 1.5). Every layout's header names are 1.4
  (`HEADER_NAMES_LINE_HEIGHT`). The horizontals already matched (caption 1.25,
  label and dates 1.5). All pinned in `composition-parity.test.ts`; the print is
  byte-identical (192 renders hashed across all six layouts before and after each
  step). Measured at maximum content (24+24-character names, 40/140-character
  milestones), 130% text, 5 milestones, percent of the row at the 0.55 floor
  (original / now): Neat Stack 107->106 Serif, 133->133 Typewriter; Cascade
  111->129, 140->138; Horizontal Circles Typewriter 110->111; nothing that fit
  before overflows (Dotted + Typewriter, newly 6% over after the font change, is
  closed). Realistic content fits everywhere. **Known, measured, DEFERRED by the
  owner's decision (13 Oct 2026; a visual-design trade-off, not a correctness
  bug):** the preview puts fixed 2/3/2px margins above each title,
  description and location that the print does not draw (it advances by line
  spacing alone); zeroing them was measured to bring Neat Stack Serif at 130%
  to 99% and Typewriter to 119%, Cascade to 117% and 123%, so they are the lever
  for Cascade Serif's remaining overflow if it is ever needed, but they change
  the preview's visual rhythm for every customer and were left alone.
  Horizontal Circles' own overflow is geometric (the circle is a fixed 78% of its
  column in the preview and the print), not spacing.
- **The live page's motion (13 Oct 2026).** A milestone now fades, rises and
  scales in as it is reached (opacity 0.25, 16px down, scale 0.985 -> rest, 700ms
  on the brand ease), its photograph settles from 1.04 inside a clipping frame
  (1100ms, 120ms behind), and ONE spark, the brand's own shape, catches at its node
  the first time the reader reaches it (`milestone-spark.tsx`; once per milestone,
  never a loop or a burst, no overshoot). Every value is named once in
  `components/live/live-motion.ts`, handed to the page as `--live-*` custom
  properties and read in the CSS with identical fallbacks, so a future live-style
  selector can pass another set to the same markup (`live-motion.test.tsx` fails
  if they drift). **The spark is a scripted effect and has its own reduced-motion
  check** (`useReducedMotion() === false`, so an unknown preference never sparks)
  plus a CSS guard; the global reduced-motion rule only shortens CSS and cannot
  stop script. It is triggered by the existing `IntersectionObserver`, never a
  scroll listener (an existing test forbids one), is centred by flex so it is
  correct right-to-left (verified on `/ar`: node and spark share a centre), and
  the Studio's Live tab shows it too. **Deliberately deferred by decision:** photo
  parallax, ambient particles, an animating accent colour (it would undo the
  8-palette fix), cursor-follow and photo tilt, time-of-day mood.
- **FLAGGED, pre-existing, its own task BEFORE any future photo-motion work: the
  live page's photographs are delivered unsized.** Each milestone's `<img>` has no
  `loading="lazy"`, no `decoding="async"`, no width/height and no `srcset`; there
  are no resized variants anywhere. Uploads are re-encoded at quality 92 at FULL
  resolution (`apps/assets/services.py`; no downscale on the server and none in the
  Studio), so the live page fetches whatever the customer uploaded, up to the 10MB
  `MAX_ASSET_SIZE_MB`. A 12-megapixel photo decodes to about 48MB of memory
  (4000 x 3000 x 4 bytes) whatever its file size, so five of them is roughly 240MB
  on a phone before any effect is added (arithmetic, not measured; no real order's
  photos have been measured, and the one customer surveyed had small ones). The
  lightbox loads the same full-size URL, and so does the opening's first-photo
  glimpse. Transforming these images (parallax, tilt, scale) multiplies the risk on
  an older phone, which is where this page is mostly opened. Do first: lazy loading,
  async decoding, intrinsic sizes, and resized variants for the live page (made at
  upload or on demand), then measure on a mid-range phone.
- **Dev trap: the Studio never finishes loading in a hidden browser pane.**
  Something in its load path waits on `requestAnimationFrame`, which never fires in
  a hidden tab, so it sits on "Loading Heartfolio" (any screenshot wakes the pane;
  only then do IntersectionObserver and CSS animations advance either). A way to
  verify the Studio when the real backend is too slow to load it (see the flagged
  item below): run a one-off backend on the throwaway database (`docker compose
  run -d --rm --no-deps --name lst-verify-api -p 8001:8001 -e
  DATABASE_URL=postgres://heartfolio:heartfolio@db:5432/heartfolio -e
  ASSET_STORAGE_BACKEND=mock api python manage.py runserver 0.0.0.0:8001`) and
  start the dev server with `BACKEND_API_ORIGIN=http://localhost:8001`.
- **FLAGGED, NOT INVESTIGATED, a possible customer-facing production risk: the
  Studio's catalog fetch has an 8s client timeout and the real backend has been
  answering in 5-14s.** `catalog-server.ts` (`REQUEST_TIMEOUT_MS = 8000`,
  `AbortSignal.timeout`) is the server-side fetch that loads the product catalog
  for the Studio; when it timed out, the Studio did not load. Observed 13 Oct 2026
  in local development against the real backend (Supabase over the company
  network, which is known to be bad, see the R2 item below), where responses took
  5-14s, so some loads exceeded 8s. **That this is the network and not the code is
  an assumption, not a finding**: nobody has measured where the time goes (the
  query, the pooler, cold connections, the network) or what the response time is
  from the planned VPS. If the production backend is routinely this slow, customers
  may hit the same intermittent failure to open the Studio at all (whether any
  fallback exists was not checked). Worth its own investigation before go-live: real backend response time
  for the catalog endpoint measured from the VPS (many requests, not one), what
  dominates it, and whether the timeout, a cache or a degraded-but-usable fallback
  is the right answer. Separate from the live-page motion work, which it merely
  got in the way of.
- **Real-R2 pack timing at 8 milestones is UNVERIFIED (12 Oct 2026).** The one
  attempt failed because the company fiber network stalls large HTTPS
  downloads from every host (Cloudflare, Hetzner and OVH too), so it says nothing
  about R2 or the code. Re-run `backend/scripts/time_pack_download.py`
  (`MODE=probe`, then the 3- and 8-milestone runs; read-only) from a network that
  passes `backend/scripts/net_probe.py` (phone tethering), and again on the VPS
  before go-live; the VPS number is the one that counts. Isolated CPU numbers and
  the photo-cache finding are in `PRINT-RENDERER-GUIDE.md` section 8. Set
  `ASSET_BYTES_CACHE_MAX_MB=128` in the VPS environment (code default 64; at
  8 photos totalling 73MB the cache overflowed and photos were read 97 times).
- **Flaky test, not yet fixed (found 18 Oct 2026):**
  `OrderEmailTests.test_a_card_that_cannot_render_removes_the_qr_section_instead_of_promising_it`
  asserts that "QR" never appears in the email HTML. But the HTML carries the
  random signed magic-link token, which now and then contains "QR"
  (`…dgQRp3I`), about 1% a subtest. The fix is to check the QR section's own
  markup, not the two letters. It passed 5 of 5 on rerun.
- Deploy and test backend zips 24, 26, 32 — these were queued behind the
  Railway deploy window, which no longer exists; they now wait on the VPS
  deploy (or can be tried on local Docker)
- Re-run the backend suite after those land
- Paddle: "Quantity 1" in the overlay, and confirming the right tax
  category before leaving sandbox
- Ten `TODO(HEARTFOLIO-PREDEPLOY)` markers in the frontend — mostly
  placeholder artwork; the two commercial ones are Merchant-of-Record
  readiness and final pricing
- Music presets resolve to `/audio/presets/<id>.mp3` and **no audio files
  exist**. Deliberate, per that file's comment; four tracks need sourcing
- Where We Met (`heart-map`) is `status: available` and fully registered on
  both sides, but has never been opened in a browser
- **Love Story Timeline print: Neat Stack closed (6 Oct 2026).** Layout
  correctness holds across the realistic range, and the print now matches the
  preview's centred header and footer, card tilt (-2deg/+1.6deg) and shadow.
  The subtitle is printed on every layout; it had never been drawn. Per-style
  status, the known bugs waiting in the other five styles, and the
  done-checklist are in `PRINT-RENDERER-GUIDE.md` (section 6). Open:
  - **Neat Stack's preview fixed (7 Oct 2026).** It had hidden milestones
    at 5 and 8, the same bug as Alternating Tilt; Neat Stack is now closed
    on both sides. The shared fit is `FittedTimeline`
    (`timeline-text-fit.tsx`). **The Studio milestone cap is 5** (`maxEvents`
    in `metadata.ts`): raised from 3 to 8 on 12 Oct 2026, after all six styles
    were verified at 8 in preview and print and the other surfaces were
    checked (guide section 8), then dialled back to 5 the same day as a
    **product decision**, not a limit. That check found the AR scene
    overlapping its photographs from 5 milestones, fixed in
    `ar-timeline-layout.ts`. **The backend `MAX_EVENTS` stays 8 on purpose** so
    saved projects and paid orders with 6 to 8 milestones keep rendering
    (`milestone-cap.test.ts` pins it); never lower it with the Studio cap. A
    pack renders up to 24 moment wallpapers at 8 (3 devices x 8), 15 at 5, and
    is slower at 8 (about 20s against 7s in memory). No per-layout cap, by
    decision.
  - **Horizontal Polaroids and Horizontal Circles closed (12 Oct 2026)**,
    preview and print, with all their styling items; both were broken (70 and
    66 of 108 prints, text) and Circles' preview axis was at the top of the
    timeline. See `PRINT-RENDERER-GUIDE.md` §11. `_horizontal_plan` measures
    and wraps their text; `FittedTimeline` has `fitTo="box"`. **All six styles
    are now closed.**
  - **Dotted Branching closed (12 Oct 2026)**, preview and print, with all
    its styling items. It was 106 of 108 broken, and its preview cut off
    content at 3 milestones. See `PRINT-RENDERER-GUIDE.md` §10. The date chip
    is now the first line of each milestone, starting on the spine.
    `_cascade_layout` became `_overlapping_stack_layout(layout_id, ...)`.
  - **Overlapping Cascade closed (7 Oct 2026)**, preview and print, with
    all its styling items. It was 108 of 108 broken, and its preview cut off
    content at 3 milestones. See `PRINT-RENDERER-GUIDE.md` §9. The names
    shrink now applies to Cascade too (`_names_font_for_milestones`).
    `FittedTimeline` now measures text extent, not `scrollHeight`.
  - **Alternating Tilt closed (7 Oct 2026)**, preview and print. The Studio
    preview had been hiding milestones 4-8: its rows grew with fixed-size
    cards. Rows are now equal, and cards and text fit them. See
    `PRINT-RENDERER-GUIDE.md` §7. **Rebuild `web` to get the preview fix**
    (`docker compose up --build web`); the print side is live after
    `docker compose restart api`.
  - Locations now print on Cascade, Alternating Tilt and Dotted Branching,
    and a dedication is never cut (both fixed 6 Oct). Printing the locations
    exposed those layouts' unreviewed crowding and card overflow (27 and 28
    of 108 renders on Cascade and Alternating Tilt); both since fixed.
  - **Accepted known limit (decided 6 Oct 2026):** Neat Stack's worst case
    crowds: 8 milestones + 60-character subtitle + 180-character dedication +
    text scale 130 on the 8x10 edged print, 26-42px short per milestone with
    the names at their floor. Four fields at their maximum at once, so it is
    accepted rather than shrinking the subtitle or dedication.
  - Alternating Tilt and Dotted Branching omit milestone descriptions **by
    design, on both sides** ("photo-led": `shows_description = False`, a CSS
    rule hiding them in the preview, and a parity test, all from 12 Sep
    2026). Not a bug. An earlier note here said the previews showed them;
    that came from reading the JSX without the CSS, and it was wrong.
  - Legacy `*-png` targets keep the layout improvements, by decision
    (6 Oct 2026). The names shrink does not apply to them.
  - Deliberately deferred styling drift: fonts, weights, title colour and
    case, the divider line, and the polaroid border thickness (preview
    3.4%/11% of the photo, print 6%/19%). Descriptions cut to one line with
    an ellipsis when space is tight is also deferred.
