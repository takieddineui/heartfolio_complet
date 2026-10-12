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

**`FREEMIUS_PLAN_MAPPING` covers only `love-story-timeline`**
(`apps/commerce/freemius_integration.py`). `heart-map` and `song-poster` have
no plan, so `stage_freemius_checkout` raises `FreemiusPlanNotConfigured` for
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
cannot be saved or seeded until both know about it.

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
settings fail with the wrong error.

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
