# CLAUDE.md

Read automatically at the start of every Claude Code session. It records
what cost real time to discover — the things that are true about this
project but not visible from any one file.

The nine `*.md` docs beside this one describe the product and the
architecture. They were written as a snapshot and have drifted before;
several corrections are noted below. **Confirm against the code before
relying on any of them.**

**Adding, changing or withdrawing a product? Follow `ADDING-A-PRODUCT.md`
step by step** (rewritten 27 Oct 2026: catalog and Freemius plans, Studio
labels, copy within the SEO limits, live-page languages, fonts, captures,
guides, and what must never be deleted on withdrawal).
`src/lib/products/product-checklist.test.ts` checks the steps that can be
checked, for every visible and withdrawn product.

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
| Production | **Not deployed yet.** A **VPS running `docker-compose.prod.yml`** (25 Oct 2026): Caddy (HTTPS, the only published ports) in front of `web` and `api`, production settings, no source mount, its own compose project `heartfolio-prod`. **`DEPLOYMENT-VPS.md` is the guide**, with every env var and build arg (`.env.production.example`) | **Railway and Vercel are no longer used** — both were past hosts, not the plan. Anything still describing a Railway deploy window, a Railway-managed backend or a push-to-deploy Vercel frontend is stale. `DJANGO_SECURE_SSL_REDIRECT=false` there on purpose: Caddy redirects public HTTP, and Django's redirect would bounce `web`'s internal calls to `http://api:8000` |
| Database | **Supabase** | Session-mode Supavisor pooler. Not changed by the move off Railway/Vercel; which database the VPS uses is not settled by this note |
| Payments | **Three providers exist in code — Paddle, FastSpring, Freemius.** Freemius is the only one wired into checkout, and is still **sandbox** | `FREEMIUS_ENABLED` / `isFreemiusCheckoutActive()` pick it. **Production is Freemius only** (owner, 25 Oct 2026): `PAYMENT_PROVIDER` defaults to `freemius` there, which needs no Paddle/FastSpring keys and makes the generic pay endpoint refuse (409). Production also runs Freemius LIVE only (`FREEMIUS_LIVE_CONFIRMED` required), and completion then refuses any licence Freemius does not mark `environment` 0 (production). Sandbox checkouts run on local Docker. Paddle and FastSpring are complete code paths left in place, switched off |

**`FREEMIUS_PLAN_MAPPING` covers four products: `love-story-timeline`,
`reasons-i-love-you` (plan 71990, its `live` pack), `graduation-keepsake`
(plan 72194, its `live` pack) and `song-poster` (plans 73260 `printable`,
73263 `live`, 73264 `printable-plus-digital`, mapped 19 Oct 2026)**
(`apps/commerce/freemius_integration.py`). There is ONE Freemius product
(`FREEMIUS_PRODUCT_ID`, one public key, one secret key for webhooks): a new
product is new PLANS under it, never a second Freemius product, whose webhooks
would fail the signature check. `heart-map` has no plan, so
`stage_freemius_checkout` raises `FreemiusPlanNotConfigured` for it: **it cannot
be bought through Freemius yet.** Freemius has no custom
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

**Rate limits see the Next SERVER as one client.** Measured on the production
stack (25 Oct 2026): browser requests, direct or through the `/api/backend`
rewrite, reach Django with the visitor's address in `X-Forwarded-For` (Caddy
sets it and drops a client-supplied one; Next passes it on), so DRF throttles
per visitor. But the Next server's OWN fetches send no `X-Forwarded-For` unless they
pass it on: `catalog-server.ts` does not, so DRF sees the web container for
every customer there. The live page's payload fetch FORWARDS the visitor's
header since 26 Oct 2026 (`live/[liveId]/page.tsx`, pinned by its test).
Its `ar_access` throttle STAYS 1000/min for launch (owner, 26 Oct 2026).
**Revisit after real traffic:** confirm per-visitor identities on the
production stack, look at real per-address request rates, and size the rate
for shared addresses (a venue's Wi-Fi full of guests scanning one QR card).

**`projects.updated_at` is set by a database trigger** (`set_updated_at_projects`)
on every UPDATE, whatever Django sends. That is what makes it "last activity"
for `cleanup_inactive_drafts` (the privacy policy's 12-month deletion of
unbought drafts and their uploads, 25 Oct 2026). A test that backdates a
project must disable the trigger for that update, after `SET CONSTRAINTS ALL
IMMEDIATE` (see `apps/projects/tests_draft_cleanup.py`).

**reportlab cannot join Arabic letters** (no shaping, and no reshaper library
is installed). The bonus PDFs (`bonuses._text_pdf`, translated 25 Oct 2026)
draw each Arabic line with Pillow/raqm in the print renderer's faces
(`MixedScriptFont`, Noto Naskh + DejaVu) and place it as a ~290 DPI image,
right-aligned; English and French stay vector Helvetica. The receipt email,
the PDFs and the QR card's default caption follow `order.locale`
(`apps/commerce/email_copy.py`, `apps/delivery/bonus_copy.py`).

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

**Regenerate `package-lock.json` ONLY with the image's own npm, never the
host's (27 Oct 2026).** The `web` image broke: `npm ci` refused the lockfile
("Missing: @swc/helpers@0.5.23 from lock file"), because the lock had been
written by the host's npm (11.19 on Node 26), which leaves out an optional
peer (next-intl's nested `@swc/core` wants `@swc/helpers >=0.5.17`) that the
image's npm (10.8 on `node:20-slim`) required. Two npms, one lockfile.
Production builds from the same Dockerfile, so it blocked the deploy too. The
image is `node:24-slim` in every stage (Node 24.22.1, npm 11.19.1 when
moved; it was `node:20-slim`, below what @supabase/* and jsdom declare);
`engines` (`^24.15.0 || >=26.0.0`, jsdom's own range, since the host runs the
tests on 26) and `.nvmrc` say the same. To add, remove or re-resolve a dependency, run npm INSIDE that
image on a copy of the two files and take the lock back, e.g. from
`frontend-heartfolio/`:
`MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)":/src:ro node:24-slim sh -c 'mkdir /w && cp /src/package.json /src/package-lock.json /w && cd /w && npm install --package-lock-only --ignore-scripts --no-audit --no-fund >&2 && cat package-lock.json' > package-lock.json.new`
then diff and move it into place (for a new package, edit `package.json`
first or pass it to `npm install`). Check with `npm ci` in the same image:
it must succeed with no `EBADENGINE`. When the Node image changes, bump all
three stages, `engines` and `.nvmrc` together and regenerate the lock.

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

**The storefront's product captures are recordings of the REAL live pages
(26 Oct 2026).** `scripts/captures/record.mjs` (its header has the stages
and what each needs): the Studio's own samples plus licensed photos
(`backend/apps/delivery/marketing_samples/`, `PHOTOS.md`) go through
`render_marketing_samples`, which builds the real live payloads, one print
and the gift QR card (pointing at the product page) on the THROWAWAY
database with mock storage, in one transaction it always rolls back; the
dev-only page `/<locale>/capture/<product>` (a 404 unless the dev server
runs with `HEARTFOLIO_CAPTURE=1`, never in production; `launch.json` has
`frontend-capture`) renders them through `LivePayloadView`, the live
page's own dispatch. Recording freezes the page's clock and every web
animation and advances both 1/30 s per screenshot, so loops are smooth and
repeatable. Traps found building it: Playwright's `click()` waits for
"stable" frames that never come under a frozen clock (click the bounding
box); an animation held paused never resolves `finished`, which the
Reasons scenes wait on (finish it at its end time); lazy images below the
fold never load (do not wait for them); and in Git Bash, `docker compose
exec ... /tmp/...` needs `MSYS_NO_PATHCONV=1`. Regenerate only when a
product changes (owner's decision); the files are committed.
**Where they are used (26 Oct 2026):** collection cards (loop on hover or
focus), the product page's hero (loop while on screen, with a pause button)
and formats section (phone still, framed print, both), the three share cards
(`og.tsx`), the merchant feed's `image_link` and the Product JSON-LD `image`
(`lib/captures/manifest.ts`). `components/captures/capture-media.tsx` creates
no `<video>` until it should play and never before the window's load event,
nor at all under reduced motion or data saver; videos are muted and
`playsInline`. **The home page (27 Oct 2026)** uses them throughout: the
hero's phone cycles the four loops (`capture-showcase.tsx`: one video at a
time, each to its end, product dots and a pause button), "How it works"
shows the REAL Studio (`studio-edit` loop, `studio-preview` still; recorded
by the `studio` stage, which opens the Studio and so must run against the
throwaway backend, `launch.json`'s `frontend-capture-throwaway` on 3006 with
CLAUDE.md's one-off `api` on 8001, never Supabase), and "The moment they
open it" and "By occasion" reuse the product stills and QR cards.
`KeepsakeVisual` is deleted. The proxy
must let `/<locale>/products/opengraph-image` through: its unpublished-product
rule took it for a product slug and made the collection's share card a 404
from 25 to 26 Oct 2026.

**Technical SEO is pinned (27 Oct 2026, after a crawl of every page on the
production image).** Things that are not visible from any one file:
- **A loading skeleton decides the status code.** A `loading.tsx` streams
  before its page runs, so a later `notFound()` or error can no longer turn
  the committed 200 into a 404 or 500. The home skeleton therefore lives in
  `app/[locale]/(home)/`, NOT at `[locale]` (where it wrapped every page and
  made an unknown `/live/<id>` a 200). Routes that keep a skeleton (products,
  gifts, create) get their 404s from the PROXY instead: unpublished products,
  unknown `/gifts/<slug>`, and a non-UUID id on `/live`, `/ar`, `/orders`,
  `/project`. A well-formed unknown order or project id stays 200 + noindex:
  those pages load in the browser with the link's token or the visitor's
  session, so the server cannot know.
- **Setting `openGraph` on a page REPLACES the layout's whole block** (the
  image and locale vanished on `/gifts/printable-gifts`). Use the helpers in
  `lib/seo.ts`: `pageShareMetadata` (own title and `og:url`, the site's
  card), `noindexMetadata` (crawlable, noindex, own canonical, no hreflang:
  the Studio, `/create`, `/project`, live, order, AR), and
  `neutralShareMetadata` (gift and order links share `share-card/<kind>`,
  never the keepsake). robots.txt blocks only `/api/` and `/orders`: a
  blocked page's noindex is never read.
- **Share-image alt text comes from `generateImageMetadata` and the message
  files read WITHOUT a request (`lib/og-alt.ts`)**: Next calls it at build
  time, where `getTranslations` reaches for headers and fails the build. It
  puts each card at `opengraph-image/card`.
- **`CONTENT_UPDATED` in `app/sitemap.ts` is hand-kept: update a page's date
  when its CONTENT changes.** The legal pages use `LEGAL_LAST_UPDATED` (no
  `lastmod` until it is set).
- **The return policy in Product markup is the `/refunds` link ONLY** (owner):
  Google's categories ("free return", "damaged item") describe physical goods.
- **Printable products carry the `printable` tag**, pinned to the seed's
  active Printable packs (`gift-intents.test.ts`, `test/seed-printable.ts`).

**`backend/.dockerignore` strips `tests_*.py` and `**/tests.py`**, so
`manage.py test` inside the built image finds 5 tests instead of 649. The
compose file mounts `./backend` over `/app` to work around this.

---

## Running the tests

**WHICH TESTS TO RUN: the owner's standing policy (18 Oct 2026), for every
task.**
- **Default, every change:** run the new tests, the test modules covering the
  files changed, and the modules that import the changed code. Mutation checks
  run against those same fast, targeted tests, never against slow full
  classes. Frontend: always run `typecheck` and `lint` (they are fast).
- **Full backend and/or frontend suites only when:**
  - (a) the change touches shared infrastructure used by more than one
    product (e.g. `apps/delivery/mixed_script.py`, the Studio form engine, the
    test runner, payment/checkout code, settings); say why in one line when
    choosing a full run for this reason;
  - (b) the owner explicitly asks;
  - (c) before a VPS deploy.
- **Every report states which tests ran and why that set is sufficient**, so
  narrow coverage is visible.
- **Plus the repo-wide GUARD tests for the kind of change (owner's addition,
  19 Oct 2026).** Some tests scan files across the repo for forbidden patterns
  or pin one file against another (often frontend against backend). They live
  outside the folders a change touches, so a targeted run skips them: 470c79c
  put `text-align: left` in eight poster stylesheets and broke
  `src/components/studio/rtl.test.ts` unnoticed until a later change ran it.
  Run every row that matches the change, in addition to the targeted tests,
  and name them in the report. To find guards not listed here:
  `grep -rlE "readdirSync|readFileSync|backendRoot" src --include="*.test.*"`
  (frontend) and `grep -rln "read_text\|frontend-heartfolio" --include="*.py"`
  (backend); add new ones to this table.

| Change touches | Run (frontend paths under `frontend-heartfolio/`; backend as `manage.py test` labels) | Guards |
|---|---|---|
| Any CSS, or component/renderer markup (Studio chrome, product modules, live pages) | `src/components/studio/rtl.test.ts` | No physical left/right: Studio `className`s and every `*.css` under `src/lib/studio/product-modules` |
| Copy: `src/messages/*.json`, module `messages.ts`, or `t()`/`useTranslations` call sites; product names; the backend's `email_copy.py` | `src/messages/messages.test.ts`, `src/messages/rendered-copy.test.tsx`, `src/messages/email-product-names.test.ts`, `src/lib/studio/product-modules/pack-labels.test.ts`, `src/lib/studio/export-labels.test.ts`, `src/components/product/product-view.test.tsx` | Same keys in every locale; no price written into copy; no templated key called without values; every seeded pack named and described; every visible product's page and the four legal pages render in en/fr/ar with no next-intl error (a key missing from EVERY file, or a template rendered without its values, both print the key) |
| A route or page that fetches the catalog, or a loading state | `src/components/ui/skeleton.test.ts` | Every catalog-fetching route has a skeleton |
| JSON-LD, `dangerouslySetInnerHTML`, the AR scene | `src/lib/json-ld.test.ts` | No raw `JSON.stringify` into `dangerouslySetInnerHTML`, anywhere |
| Fonts: `@font-face`, `public/fonts/`, font tokens (`themes.ts`), the font stacks in `globals.css`, a print's font files | Frontend: `src/lib/studio/product-modules/love-story-timeline/typography-fonts.test.ts`, `.../love-story-timeline/lst-arabic-print-parity.test.ts`, `.../song-poster/song-poster-print-parity.test.ts`, `.../song-poster/poster-locale.test.ts`, `src/components/live/live-theme.test.tsx`, `src/components/live-graduation/graduation-fonts.test.ts`, `src/components/live-reasons/reasons-fonts.test.ts`. Backend: `apps.delivery.product_renderers.song_poster.tests.PrintFontTests`, `apps.delivery.product_renderers.love_story_timeline.tests.ArabicPrintTests`, `apps.delivery.tests_mixed_script` | Every named family registered and its file present, with its licence; preview and print agree on serif/sans/mono, weight, slant and the Arabic faces; the print's font files byte-identical to `public/fonts` |
| Anything in `src/app/globals.css` | The fonts row, plus `rtl.test.ts` | |
| Preview CSS or print layout numbers, either side, of a product with a print | `src/lib/studio/product-modules/love-story-timeline/composition-parity.test.ts`, `.../song-poster/song-poster-print-parity.test.ts`, `.../song-poster/player-print-parity.test.ts`, `.../love-story-timeline/lst-arabic-print-parity.test.ts` | These read the Python renderer; a value changed on one side only fails here |
| Live pages (`src/components/live*`) | `src/components/live/live-motion.test.tsx`, `src/components/live/live-keepsake.test.ts`, `src/components/live/live-theme.test.tsx`, `src/components/live/live-copy.test.ts` and `live-duration.test.ts` (Love Story Timeline's page words and its duration line follow the order's language; the duration line was "3y 4m 22d" in every language until 27 Oct 2026), and the product's own keepsake test (`graduation-keepsake.test.tsx`, `reasons-keepsake.test.tsx` scan their whole folder) | Motion values named once; no window scroll listener; palettes and fonts from the Studio's tokens |
| `seed_catalog.py`, packs or prices | Frontend: `src/lib/studio/product-modules/pack-labels.test.ts`, `src/messages/rendered-copy.test.tsx`. Backend: `tests_seed_catalog`, `apps.products` (incl. `CatalogTargetMapParityTests`, the admin's target map), `apps.commerce.tests.FreemiusPlanMappingTests`, `apps.commerce.tests.FastSpringProductPathMappingTests` | Labels for every seeded pack; seed and admin target maps agree; every sellable pack has its plan at its price |
| A live product's limits (`limits.ts` or its backend `data.py`), or upload/media limits | `src/lib/studio/product-modules/reasons-i-love-you/reasons-module.test.ts`, `.../graduation-keepsake/graduation-module.test.ts`, `src/lib/studio/media-values.test.ts` | Frontend limits equal the backend's `data.py` and `base.py` |
| Settings, environment or `.env.example` files, the test runner | `apps.common.tests.ProductionSettingsLoadingTests`, `apps.common.tests.HermeticTestRunnerTests`, `apps.assets.tests.EnvExampleUploadTypesTests` | Production settings load (throttle rates merged); tests reach no outside host; `.env.example` sets no upload type list |
| The Node version or dependencies: `Dockerfile` `FROM` lines, `.nvmrc`, `engines`, `package.json` dependencies, `package-lock.json` | `src/lib/node-version.test.ts`, then `npm ci` in the image (see "Regenerate `package-lock.json`" above) | Every Dockerfile stage on one even (LTS) Node line, named by `.nvmrc` and `engines`; the lockfile regenerated after `engines` changed |
| Page metadata (titles, descriptions, canonicals, robots, share cards, JSON-LD), `proxy.ts`, `robots.ts`, `sitemap.ts`, a loading skeleton, a new public page | `src/lib/seo-lengths.test.ts`, `src/lib/seo-status.test.ts`, `src/proxy.test.ts`, `src/lib/products/gift-intents.test.ts` | Every sitemap page's rendered title <= 60 and description <= 160 in en/fr/ar; no loading boundary at `[locale]`; private pages noindex with their own canonical; robots.txt blocks only `/api/` and `/orders`; share alt text per language; sitemap x-default and real dates; return policy link-only; unknown addresses 404 |
| A product added, changed or withdrawn (registry, seed, Freemius map, captures, guides) | `src/lib/products/product-checklist.test.ts`, plus the rows for each kind of file touched (`ADDING-A-PRODUCT.md`, step 21) | Every visible product: Studio module, copy in en/fr/ar, active packs each with a Freemius plan, `printable` tag = seed, captures in every language, live-page dispatch, sitemap, a guide or a stated reason; every withdrawn product: no active pack, in no sitemap, guide or recording |
| Guides (`src/content/guides/`, `lib/guides/`, `app/[locale]/guides/`) | `src/lib/guides/guides.test.ts`, `src/lib/products/product-checklist.test.ts`, `src/lib/seo-status.test.ts` | Lengths, slugs and dates per translation; every product shown and visible; no price in the text; drafts never in production; hreflang only between published translations; sitemap dated by `updated`; real 404s; footer language list = published guides |
| A print renderer's PNG saving | `apps.delivery.tests_png_encoding` | No `optimize=True` on the full-screen save paths |
| Dates or counts a print or preview writes (`date_formatting.py`, `formatDate`/`formatCount` in the Love Story Timeline renderer, the live page's dates) | Frontend: `src/lib/studio/product-modules/love-story-timeline/locale-format-parity.test.ts`, `src/components/studio/preview/moment-wallpaper.test.tsx`. Backend: `apps.delivery.test_date_formatting` | Preview and print write the same strings in the order's language (`backend/apps/delivery/locale_format_cases.json`, generated from the browser's `Intl`); a calendar day never shifts by time zone |
| Storefront captures: a product's live page, its Studio sample (`initial-state.ts`), `marketing_samples/`, `scripts/captures/`, `public/captures/`, the Studio (it is captured for the home page), or a page showing them | Frontend: `src/lib/captures/captures.test.ts`, `src/lib/captures/capture-lock.test.ts`, `src/components/captures/capture-media.test.tsx`, `src/components/captures/capture-showcase.test.tsx`, `src/proxy.test.ts`. Backend: `apps.delivery.tests_marketing_samples` | Every visible product captured in en/fr/ar within budget, no stray files; the capture page and its photo route locked; every sample valid for the real live page, every photo present and licensed. A VISIBLE change to a live page means re-recording: `node scripts/captures/record.mjs all`; to the Studio, `record.mjs studio --base http://localhost:3006` (throwaway backend only) |

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
- **Pre-launch decisions (owner, 25 Oct 2026):**
  - Production takes payments through **Freemius only**. Paddle and FastSpring
    stay in the code but are off, and production settings must not require
    their configuration.
  - Refunds: none once the keepsake is delivered, except when it is broken or
    not as described, and the customer contacts support@theheartfolio.com
    within 14 days. Freemius is named as the payment provider.
  - Google Analytics stays, consent-based through the cookie banner, and the
    privacy page says so.
  - The receipt email (subject included), the thank-you and how-to-print PDFs
    and the gift QR card's text are translated into fr and ar, chosen by the
    order's `locale`.
  - The order page and the receipt email carry a copyable gift link (the
    `/live/<id>` URL) beside the QR.

---

## Still open

- **THE AR PAGE NEVER LOADS: FIX BEFORE AR IS EVER SOLD (found 27 Oct 2026,
  owner's task).** `app/[locale]/ar/[arId]/page.tsx` fetches its payload with
  `apiFetch`, which builds a RELATIVE URL for the browser and throws on the
  server (see "Server components cannot use `apiFetch`" above); its `catch`
  calls `notFound()`, so EVERY AR link, valid or not, shows "not found" (a
  404 since the SEO fixes, a 200 before). AR is not sold today, so no
  customer is affected. Fix as the live page does: `getBackendOrigin()`
  outside the `try`, then a server `fetch` (forwarding `X-Forwarded-For`),
  and a test that a valid id renders the scene.
- **CONTENT SECTION (`/guides`): SET UP 27 Oct 2026; the first guide is a
  DRAFT awaiting the owner's review.** Plan (owner, 27 Oct 2026): English and
  French first (of 42 paid Love Story Timeline orders, 25 were French, 17
  English, none Arabic); Arabic only with a native reviewer. Author: "The
  Heartfolio team". First batch, each written natively per language, not
  translated: anniversary/Valentine's ideas that aren't objects (DRAFTED in
  English: `src/content/guides/anniversary-ideas/`), reasons I love you with
  examples, how to build a relationship timeline, last-minute gifts that still
  feel personal, graduation gifts from everyone (Graduation Keepsake is in
  `GUIDE_COVERAGE_PENDING` until then). Search volumes are unverified
  hypotheses: check them in Keyword Planner/Search Console first. Timing: the
  love guides live by early December for Valentine's, graduation by March.
  **How it works:** a guide is `src/content/guides/<id>/` (an `index.ts` with
  its products, one file per language with its own slug, dates and typed
  blocks; no Markdown parser), listed in `lib/guides/registry.ts`. A `draft`
  is shown ONLY on a development server (`next dev`), for review: never in a
  production build, the sitemap, the index or a link. **To publish:** set
  `status: "published"`, then add the language to `GUIDE_INDEX_LOCALES`
  (`lib/guides/published-locales.ts`, a separate list because the footer is a
  client component; `guides.test.ts` fails if they disagree). Pages:
  `/[locale]/guides` (a 404 in a language with no guide) and
  `/[locale]/guides/[slug]` (a real 404 for an unknown or other-language
  slug), Article + BreadcrumbList JSON-LD, a share card per guide, hreflang
  only between published translations (x-default English), sitemap dated by
  each translation's `updated`, product cards linking to product pages (never
  the Studio), "Ideas and guides" on the product pages, a footer link in
  languages with guides.
- **Reasons I Love You (`reasons-i-love-you`) is LIVE on the storefront (14 Oct
  2026), the first LIVE-ONLY product: no print, no renderer output, one `live`
  pack at $15.99 granting `__live__`.** How a print-less product fits (registry
  entry for the pre-payment check only, `_LIVE_PAYLOAD_BUILDERS`, `renderer:
  { kind: "live" }`, hosted delivery) is in `ADDING-A-PRODUCT.md`. Freemius plan
  **71990** ($15.99, one-off, single price point, under the existing Freemius
  product) is mapped as `reasons-i-love-you:live` and pinned by
  `FreemiusPlanMappingTests`. The real seed ran on 14 Oct 2026 (product and
  `live` pack created in Supabase; 4 products / 17 packs) and `hidden` is now
  `false`. **The owner's sandbox checkout is DONE (confirmed 25 Oct 2026).**
  v1 leaves out, by
  decision and without stubs: the recipient's reply, any open/read tracking,
  the own-song upload, a scheduled send, drag to reorder, edits after
  purchase; the branding line is always shown, as on the other live pages.
  The prototype (`reasons-i-love-you.html`) is the design reference; its
  daisy scattered its petals (`transform-box: fill-box` on the petal group),
  fixed in the port. The fonts are self-hosted in `public/fonts/reasons/` with
  their licences. **The jar's note is Mali, not Gaegu (26 Oct 2026):** Gaegu's
  files held only ASCII, so every French accent fell back to the interface face
  and read as a capital ("faÇon"); `reasons-fonts.test.ts` now reads every
  face's own character map (`test/font-cmap.ts`, TTF and WOFF2) and fails on a
  missing French letter; Merienda, Limelight and Marcellus reserve their names, so
  they are the original files, not subsets (bigger: Merienda is 226KB). Arabic
  falls through to the site's Kufi (display) and Naskh (text); an Arabic
  signature is revealed whole, never letter by letter (that breaks joining).
  Lengths are named in `limits.ts` and `data.py` and pinned equal by a test;
  the letter paragraph cap (500) has no precedent. The French and Arabic copy
  has not had a native review. Live-page photos load lazily, so their 300s
  presigned links can expire before a reason is opened; the page refetches its
  payload once (20s cooldown) when a photo fails.
- **Song Poster (`song-poster`) is VISIBLE (15 Oct 2026) and its Freemius plans
  are MAPPED (19 Oct 2026), and the real seed HAS RUN (confirmed 25 Oct
  2026).**
  Plans 73260 (`printable`, $22.99), 73263 (`live`, $15.99) and 73264
  (`printable-plus-digital`, $35.99), one-off, single price point each, its
  own (not Love Story Timeline's same-priced 69404 / 70517 / 70543); pinned by
  `FreemiusPlanMappingTests` (each id, none reused, exactly the seed's active
  packs at the plans' prices, the retired packs unmapped) and staged through
  the real table by `FreemiusStagingTests` (song_poster tests). The owner's
  real seed run added the combo and disabled `complete` and the wallpaper
  combos (latest run: 5 products / 19 packs, matching `seed_catalog.py`).
  **Still to do, the owner's: one sandbox checkout** (rebuild `web` first).
  Its standalone `wallpaper` pack is `disabled` too (as Love Story
  Timeline's); the
  wallpaper add-on checkbox was already hidden for every product
  (`SHOW_WALLPAPER_ADDON`). **Packs DECIDED (19 Oct 2026): Love Story
  Timeline's combo model, without its wallpaper combos.** Sellable:
  `printable` $22.99, `live` (Digital) $15.99, `printable-plus-digital`
  $35.99 (new); `complete` and both wallpaper combos are disabled, never
  deleted (`SongPosterCatalogStateTests`, `SongPosterComboSeedTests`). The
  checkout's Printable/Digital toggle needs no code: `unitSelectionModel`
  shows it for any product whose active packs include the combo
  (`pack-labels.test.ts` builds Song Poster's from the seed). FastSpring's map is not
  extended, as for every new pack. An investigation of
  its Studio, preview and print (15 Oct 2026) found real problems, not yet
  fixed. **Its player speaks the page's language and runs left to right (26 Oct
  2026):** Play/Pause/Seek and the player's errors come from `player-copy.ts`
  (the order's language on the Digital page, the Studio's in the preview; the
  hook reports an error code), and the soundwave and time row are `dir="ltr"`
  on every page, as on the print (on /ar the times were mirrored).
  **The YouTube blocker is FIXED (15 Oct 2026):** nothing in the Studio
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
  designed. **Raw labels and the false waveform claim FIXED (19 Oct 2026).**
  Song Poster's messages had no `exports.*` or `packs.*` keys, so its Studio
  export list and checkout pack cards showed raw keys. The 9 shared print and
  wallpaper labels now live once in `lib/studio/export-labels.ts`
  (`SHARED_EXPORT_LABELS`, Love Story Timeline's wording moved unchanged;
  both modules spread it, and LST's resolved dictionary was diffed identical
  in all three locales), and Song Poster names and describes all six seeded
  packs in en/fr/ar. `pack-labels.test.ts` reads the pack slugs from
  `seed_catalog.py` and fails if any product's pack has no English name or
  description (all five pass), or Song Poster's lacks any locale's own. The
  product page claimed "the actual waveform of the track you choose"; the
  waveform is seeded per order (`waveform.ts`), so the copy now says "a
  soundwave designed for your order" (positive phrasing in the marketing
  copy, by the owner's decision) and only the FAQ says plainly it is "not
  taken from the recording". The FAQ also said any track "you can identify
  by title and artist"; it now says a YouTube link is needed.
  `song-poster-labels.test.ts` pins both. French and Arabic are plain
  translations, not native-reviewed.
  **Player's placeholder code is FIXED (18 Oct 2026):** every Player print used
  to end with a fake 5x5 "code" (the prototype's `codeSVG`, which nothing
  could scan) and the designer's label "CODE POSITION — LINKS TO YOUR PAGE",
  which the preview never showed. Both are gone, as is the preview's unused
  English label. The dedication now sits where the preview puts it: named
  `PLAYER_*` constants in `png_renderer.py`, read against the CSS by
  `player-print-parity.test.ts`. The renders for every other theme, and
  Player's wallpapers, are byte-identical (264 of 288 hashed; the 24 changed
  are Player's print sizes). **Frameless prints FIT, never cut (18 Oct 2026):** `render_png` scaled
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
  out of scope.
  **The artist line FIXED (19 Oct 2026).** Worse than the audit saw: EVERY
  Ledger print overlapped the artist with the title (1.1-2.7 design units
  in, even "The Beatles"), because the print steps down by the title's ink
  HEIGHT, not to its ink bottom; Sleeve's artist sat under a second title
  line's descenders (6 in); nothing limited the artist's width, so a long one
  ran under Mosaic's heart and past its card, off the page in 7 themes (60
  "W"s) and into every footer's HEARTFOLIO. Now (`png_renderer.py`):
  - `_below_title`: the artist never comes closer than
    `ARTIST_TITLE_CLEARANCE` (2 units, Ephemeris's old Arabic floor, now one
    constant) to the title's LAST line's ink. A floor, not a new spacing
    (owner's choice): measured with the floor off, the previews leave 6.3-20.8
    units (Ledger about 0) and the print 3-5, so matching the preview would
    have moved every theme. Mosaic naturally sits only 0.7-1.6 under its
    title, so its Latin prints move too (by at most 1.3 units).
  - `_fit_line`: the artist, under the title and in every footer (Award's
    plaque line with its " · HEARTFOLIO"), stays on ONE line in its column:
    full size if it fits, else shrinking to `TITLE_MIN_SCALE` (80%, the
    titles' floor, owner's refinement) and only then "…". Columns
    (`ARTIST_COLUMN`) are the preview's, measured in the browser; footers stop
    `FOOT_GAP` (16) before HEARTFOLIO, and a shrunk footer artist keeps the
    wordmark's baseline. Wallpapers fit theirs to the title's 84%.
  - Previews (owner's decision (a)): all eight show the artist on one line
    with "…" (six used to wrap it), every footer artist too, with
    `gap: 16px` (pinned against `FOOT_GAP` by the parity test); Award's plaque
    line keeps " · HEARTFOLIO" whole and cuts the artist. The preview's letter
    spacing (0.12-0.34em, not drawn by the print) means it cuts sooner than
    the print, which shows at least as much.
  Renders: 196 of 576 changed (8 themes x 9 targets x 8 text cases): every
  Ledger render, Mosaic's Latin prints, Sleeve's two-line and long-artist
  cases, 2 Award, wallpapers whose artist is wider than 84%, and every
  60-"W" render; Player, Ephemeris, Contact Sheet and Label are otherwise
  byte-identical. Pinned by `ArtistFitTests` (one render pass, about 35s) and
  `song-poster-preview-layout.test.ts`.
  **The Studio preview fits its screen (19 Oct 2026).** Three layout bugs, all
  a fixed size stretching its container:
  - The shared preview column (`components/studio/preview/preview-pane.tsx`,
    EVERY product) was a flex item with the default `min-width: auto`, so a
    canvas wider than the pane stretched it and `ScaleToFit` measured the
    canvas, not the pane: Award and Sleeve (1200px) ran 238px off screen at
    1280 and were still off at 1440, and ON A PHONE every product's Studio
    was wider than the screen (Song Poster 833px, Love Story Timeline 572px
    on a 375px phone). `min-w-0` fixes it. LST at 1280/1440/1920 is unchanged
    to the pixel (same scale and position, measured before and after).
  - Player's and Mosaic's title and artist sat in an unclassed flex item, so
    the one-line title stretched it and the row ran off the poster (Player 506
    design units at 60+60 characters, Mosaic 163; the heart pushed out). Now
    `.titleBlock { flex: 1; min-width: 0 }`; the title ends "…", and the
    artist is one line ending "…" too (owner's choice, as the print draws it).
  - Player's waveform `<svg>` kept its viewBox width (800) in a 680 row: a
    replaced element ignores `inset-inline: 0` for its width. `width: 100%`.
    The print already drew 680; it does not change.
  jsdom has no layout, so `preview-pane-layout.test.ts` and
  `song-poster-preview-layout.test.ts` pin the CSS rules (8 of 8 mutants
  caught); the proof is a scripted browser measurement (every element past
  the canvas edge, scale, sideways scroll) at 1280, 1440, 1920 and phone width.
  **Measuring trap:** in a hidden pane `ResizeObserver` does not fire until a
  frame renders, so a scale read right after a resize or theme switch can be
  STALE (1920 first read 0.779, the 1440 value; 0.959 after a screenshot woke
  the pane). Take a screenshot before every measurement.
  **The print's font folder now holds what the themes ask for (18 Oct 2026).**
  Arabic printed as EMPTY BOXES in Ephemeris's title and dedication and
  Player's dedication: DejaVu Serif (all three files) and every DejaVu
  oblique have no Arabic glyphs. And four themes printed their italic
  dedications upright: the code asked for `DejaVuSans-Italic.ttf` and
  `DejaVuSansMono-Italic.ttf`, names DejaVu never shipped (its sans italics
  are "Oblique"), behind a silent `.exists()` fallback. Now:
  - Arabic is drawn in the PREVIEW'S OWN FILES, copied byte for byte into
    `love_story_timeline/fonts/`: Noto Kufi Arabic where the preview sets a
    serif (Ephemeris), Noto Naskh Arabic where it sets a sans, at the slot's
    CSS weight clamped as the browser does (`ARABIC_WEIGHT_RANGE`; titles' 800
    draws at 700, Ephemeris's 300 at 300). Mono slots keep DejaVu Sans Mono,
    which has Arabic (the preview's mono font has none). Arabic is always
    upright.
  - FACES ARE CHOSEN PER CHARACTER, as the browser's `unicode-range` does:
    code points in `ARABIC_UNICODE_RANGE` (the CSS's Arabic range less the
    punctuation it shares with Latin) from the Arabic face, everything else
    (spaces, digits, "…", "·", Latin) from the slot's DejaVu face, and a
    character its face lacks from the other face if that one has it. This is
    REQUIRED, not polish: the site's Noto files are subsets with every Arabic
    letter but NO Latin-1 and none of `– — ‘ ’ “ ” … • ·`, so a first version
    that drew whole Arabic strings in Noto silently dropped Award's footer
    "·" and would drop the "…" of a cut Arabic title. The runs are ordered by
    the Unicode bidi algorithm (one paragraph, implicit levels, from
    `unicodedata`) and each is shaped by raqm in its own direction. All of it
    is `apps/delivery/mixed_script.py`'s `MixedScriptFont`, a `FreeTypeFont`
    whose `getlength`/`getbbox`/`getmask2` (the only ways Pillow measures and
    draws) lay out the runs, so wrapping, fitting and drawing agree. Text
    with no Arabic takes Pillow's own path, byte for byte. A one-face run is
    placed exactly as Pillow places it (anchors rounded in 26.6 as Pillow
    does; `tests_mixed_script.py` compares bboxes and mask bytes). Only the
    anchors `l/m/r` x `a/m/s/d` are supported; another raises. Love Story
    Timeline's Arabic fix is meant to reuse it.
  - Real italics: `DejaVuSans-Oblique.ttf` (official 2.37 release) and
    `DejaVuSansMono-Oblique.ttf` (Debian's 2.37 build, from the container),
    named in `DEDICATION_LAYOUT`'s new font column. Player's dedication is
    now sans oblique (it was serif italic; its preview is sans). The bundled
    DejaVu files are 2.37 but NOT byte-identical to the official release
    (another build; checked by version string).
  - Licences: `LICENSE-dejavu.txt` is the 2.37 release's own file.
    `LICENSE-noto-arabic.txt` (backend and `public/fonts/`) is each Noto
    file's embedded copyright line plus the standard OFL 1.1 text, identical
    to the repo's other OFL files: the Google Fonts builds carry no licence
    string, and the site never shipped one.
  - Ephemeris's flow advances by the title's ink HEIGHT, not its ink bottom,
    which leaves Latin titles only 3-5 design units clear of the artist; Kufi
    reaches lower, so Arabic descenders came down into the artist's line. The
    artist now starts at least `ARTIST_TITLE_CLEARANCE` (2) below the
    title's ink, a floor Latin never reaches (byte-identical).
  Pinned by `PrintFontTests` (every named font is in the folder and no
  `.exists()` fallback; no printed CHARACTER, Arabic or not, is the empty
  box, on prints and wallpapers; each Arabic letter's face per slot, and
  upright; Award's footer keeps its "·"; CSS weights; Arabic layout overlaps
  nothing), `tests_mixed_script.py` (bidi order, faces per character, ink
  where `getbbox` says, nothing dropped, Pillow-exact single runs) and
  `song-poster-print-parity.test.ts` (weights, serif/sans/mono and italic per
  slot against the CSS; the Arabic files, range and weight range against
  `globals.css`; the files byte-identical to `public/fonts`). 108 of 288
  renders changed: the 5 themes with an italic dedication (Latin), and every
  print with Arabic; Ledger, Ephemeris and Sleeve's Latin renders, every
  render without a dedication, and all wallpapers are byte-identical.
  **Still open from this fix:** wallpapers and Sleeve's ring draw Arabic in
  plain DejaVu Sans (no boxes; joined and readable in the ring), not Naskh.
  **The two Arabic preview items FIXED (19 Oct 2026), preview only:**
  - TITLES WERE CUT IN EVERY PREVIEW, not only Ephemeris: each `.title` is
    one line (Sleeve's two) in an `overflow: hidden` box about a line tall.
    Measured in the browser, an Arabic title's ink ran 3.8-9.4 units above and
    7.4-24.4 below it in all eight themes, and LATIN descenders were cut too
    (1.7-9; Ledger's "Gypsy" visibly). Every `.title` now has
    `padding-block: 0.16em 0.4em` given back by its `margin-block`: nothing
    on the poster moves (Latin /en positions identical, measured), and all
    ink is inside. Sleeve's two-line title paints its hidden third line, so a
    CUT Sleeve title (3+ lines, `useTitleClamped` counts the laid-out lines;
    `scrollHeight` reads two Arabic lines as cut) keeps the old bottom edge.
    Left as it was: in a cut Sleeve title the "…" line still loses 4 units of
    Latin descender or 14 of Arabic dots, and an Arabic third line's alef
    peeks 1.6 units: at `line-height: 1.04` Arabic lines overlap, in the print
    too.
  - ON /ar EVERY PREVIEW MIRRORED (photo, footer, heart, Sleeve's column)
    while the print never does. Each theme's root is now `dir="ltr"`,
    `text-align: start`, with `poster-root.module.css`, and every line of the
    customer's text has an explicit `dir` from `lineDirection()`
    (`line-direction.ts`): its first strong letter's, the print's rule. A
    right-to-left line is aligned `end` (`[dir="rtl"]` in the root
    stylesheet), so it starts at the poster's left as printed.
    **Two traps, found 19 Oct 2026:** the first version used `text-align:
    left`, which `rtl.test.ts` forbids in renderer CSS (it failed outside the
    folders that change ran, fixed the same day); and `dir="auto"` cannot be
    styled here, because the CSS build (Lightning CSS) rewrites `:dir(rtl)`
    into `:lang(ar)`-style checks of the PAGE's language (so on /ar it matched
    Latin lines too), and Chromium has no `text-align: match-parent`.
    On /ar globals.css also swapped
    the font stacks (`.font-arabic`), set `line-height: 1.9` on body and
    `:lang(ar) p` (a descendant selector: `lang` on the poster cannot stop
    it), and the mono stack's Arabic fell back to a font picked by page
    language; the root class undoes all of it (default stacks pinned to
    globals.css by `poster-locale.test.ts`; mono Arabic now Noto Naskh via
    "Heartfolio Sans", the print's is DejaVu Sans Mono). Measured: every
    element of all eight themes at the same position on /en and /ar, Latin
    and Arabic.
  - MIXED ARABIC/LATIN ORDER, the old open question, answered: every
    single-line text (title, artist, footer, Award's plaque line) now follows
    the same rule in preview and print, so they agree; Award's plaque line
    with an Arabic artist now reads "HEARTFOLIO · artist" in the preview too.
    One difference remains, by construction: a WRAPPED dedication takes one
    direction for the whole paragraph in the browser, while the print decides
    each line by its own first letter, so a wrapped Arabic dedication whose
    later line starts with a Latin word orders that line differently. Making
    the print use the paragraph's direction would close it (a backend change).
- **Song Poster's Studio sidebar matches Love Story Timeline's (19 Oct 2026):**
  Content, Appearance, Files, in that order, in en, fr and ar. It also had an
  "Export" panel listing every print and wallpaper size (wallpapers it no
  longer sells included), because Love Story Timeline opts out of that list in
  its module config (`hideCustomerFacingList`, §15) and Song Poster never did.
  Now it does too (`export-list.test.ts` pins both). Nothing else reads the
  list: the checkout and delivery use each pack's `includedTargets` from the
  backend. Reasons and Graduation are hosted products and show a one-line
  hosted card instead. Where We Met still shows the list (withdrawn, untouched).
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
  **New evidence (18 Oct 2026), pointing at the BROWSER PANE, not the app:** it
  happened again right after the pane's viewport emulation was resized
  (1280 to 1440) in the Song Poster Studio. The page now showing was the
  tab's ORIGINAL first history entry: its document was created when the
  preview server started (`performance.timeOrigin`, 4 minutes earlier, before
  the Studio was opened), it had no referrer, and it had gone through exactly
  one redirect (`/` to `/en`, the locale redirect of the preview's start
  URL). A navigation by the app's own code would leave the Studio as the
  referrer, and `src` has no `history.back`/`go`, `router.back` or `location`
  assignment at all. A second resize did not reproduce it. Most likely the
  pane traversed its history when its emulated viewport changed; if so, a
  real customer would never see it. Not yet proven: a deliberate
  reproduction is the next step if it matters.
  **Stronger evidence (19 Oct 2026):** it happened on /ar and landed on `/ar`:
  a fresh document whose request went to `/` and was redirected once (the
  locale proxy sends the bare root to the saved locale cookie, then `ar`).
  Nothing in `src` navigates to `/`; the preview pane was opened at
  `http://localhost:3001`, the root. So the pane reloads its own start URL,
  not the app; a customer never loads the bare root by accident.
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
  `graduation-module.test.ts` and the visible-list tests). The real seed HAS
  RUN (confirmed 25 Oct 2026; latest run 5 products / 19 packs, with Song
  Poster's combo). **Still to do, the owner's: one sandbox checkout** (rebuild
  `web` first). Decided, and not stubbed: no reply or reactions, no report back to
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
- **Printable + Digital is seeded, mapped and exercised: the owner's sandbox
  checkout of the combo is DONE (confirmed 25 Oct 2026).** Freemius plan
  **70543**, $35.99, mapped as `love-story-timeline:printable-plus-digital`;
  the pack is active and `complete` is disabled in the real database.
  Checkouts against Supabase are always the owner's, never Claude's.
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
- **Flaky QR email tests FIXED (26 Oct 2026).** Three tests asserted that
  "QR" never appears in the receipt, but the magic link's random signed token
  now and then contains "QR" (`…dgQRp3I`, about 1% a subtest). They now check
  the email with its links removed (`_without_links` in
  `apps/commerce/tests.py` and `apps/delivery/tests.py`), so a word "QR" in
  the copy still fails them.
- Deploy and test backend zips 24, 26, 32 — these were queued behind the
  Railway deploy window, which no longer exists; they now wait on the VPS
  deploy (or can be tried on local Docker)
- Re-run the backend suite after those land
- Paddle: "Quantity 1" in the overlay, and confirming the right tax
  category before leaving sandbox
- Ten `TODO(HEARTFOLIO-PREDEPLOY)` markers in the frontend — mostly
  placeholder artwork; the two commercial ones are Merchant-of-Record
  readiness and final pricing
- Music presets resolve to `/audio/presets/<id>.mp3`, and all four files exist
  (checked 25 Oct 2026; an older note here said none did). Only
  `tender-piano` has a licence certificate beside it (Pixabay); the owner is to
  file certificates for `evening-glow`, `quiet-strings` and `still-waters`
- Where We Met (`heart-map`) is WITHDRAWN: hidden on the storefront, and
  since 26 Oct 2026 `disabled` in `seed_catalog.py` with its three packs
  disabled (never deleted). It had been seeded `available` with active packs
  and no Freemius plan, so the public API listed it. The real database keeps
  the old state until the owner's next seed run. It has never been opened in
  a browser. `SellableMeansMappedTests` (`tests_seed_catalog.py`) now fails
  if any active pack of an available product has no Freemius plan, with no
  exceptions: Love Story Timeline's two wallpaper combos
  (`printable-plus-wallpaper`, `digital-plus-wallpaper`), active and
  unmapped, were disabled by the owner the same day (never deleted). Both
  changes reach the real database on the owner's next seed run
- **Love Story Timeline: Arabic in the print, PHASE 1 (18 Oct 2026).** No
  DejaVu Serif face has an Arabic glyph, so Serif Classic (the DEFAULT) printed
  every Arabic slot as empty boxes and Romantic Italic its headings (names,
  poster title, moment-wallpaper title). On /ar the generated duration line
  ("1,240 يومًا معًا") boxed in Serif Classic even for Latin-only customers.
  Read-only count of the real database the same day: 42 paid LST orders, NONE
  on /ar and none with Arabic text (25 fr, 17 en; 41 Serif Classic), so no past
  order was affected. Romantic Italic had no wrong file name: it asks for
  `DejaVuSerif-Italic.ttf`, which exists, with no silent fallback.
  `_font()` now returns `apps.delivery.mixed_script.MixedScriptFont` (the
  module Song Poster uses), drawing Arabic in the face the STUDIO PREVIEW gives
  each role (`ARABIC_FONT_ROLES`, from `themes.ts`): Serif Classic and Romantic
  Italic headings in Noto Kufi, their body in Noto Naskh; Modern both in Naskh
  (a deliberate visible change: Modern's Arabic used to print in DejaVu Sans);
  Typewriter stays on DejaVu Sans Mono. Arabic is always upright. The weight
  follows the print's own (Bold file 700, else 400), not the preview's:
  the preview's names are regular and its poster title uses the BODY face,
  part of the deferred weight/font drift. Faces are per character, so digits,
  dates and Latin stay in DejaVu. The print reaches fonts by FILE, so the
  roles become a map by file, and a file two typographies would draw in two
  Arabic faces stops the import. Pinned by `ArabicPrintTests` and
  `lst-arabic-print-parity.test.ts` (roles against `themes.ts`; files, range
  and weights against `globals.css`).
  **Verified:** every Latin render is byte-identical (656 of 656 across every
  layout, typography and output, in en and fr at maximum length); Typewriter
  never changes; Latin on /ar changes only where the duration line prints.
  **PERFORMANCE TRAP, fixed:** LST's fit search measures about 25,000 lines a
  render, and `MixedScriptFont` turned each into several FreeType layouts, so
  an Arabic print took 5-16x longer (Cascade 8x10: 4s to 64s). Per-instance
  caches of run, line and anchor measurements brought it back (1.5-4.5s, as
  today); Latin was unaffected (5.6s). The caches change no pixel (1628 LST
  and 288 Song Poster renders hashed identical).
  **PHASE 2, Arabic lines spaced by their ink (18 Oct 2026, approved after
  before/after renders).** Kufi and Naskh stand taller than DejaVu (tall alefs
  1.14-1.29em above the baseline, tails 0.44-0.47em below) while the print
  spaced lines at `font.size` x 1.25-1.5, so phase 1 left 52 pairs of texts
  whose LETTERS TOUCHED at maximum length (443 overlapping boxes): Serif
  Classic's poster title over the subtitle on every layout, milestone titles
  over descriptions, and two places phase 1's harness never looked: the AR
  card's poster title over the names, and the moment wallpaper's title over
  its date (up to 61px). `_line_pitch(font, pitch, text)` returns the print's
  pitch unchanged unless the text has Arabic in it, and then at least the
  Arabic face's ink (tallest and deepest probe, `_ARABIC_TALL_AND_DEEP`) plus
  `ARABIC_LINE_CLEARANCE` (0.10em): Kufi 1.81-1.85em, Naskh 1.63-1.69em. It is
  applied centrally in `_draw_wrapped`/`_draw_centered_wrapped`, MIRRORED in
  every estimator the fit trusts (Neat Stack, Cascade, Alternating, Dotted,
  both horizontal plans), and in the hand-placed advances (poster title,
  duration, the AR card's names, the moment wallpaper's date, whose caption
  rises by the extra so its foot stays put). Result: 0 overlapping boxes and 0
  touching letters on prints, polaroid cards, wallpapers and the AR card;
  every Latin render byte-identical (972 of 972, en, fr at maximum length and
  Latin on /ar); Typewriter untouched. **The cost, at maximum length only:** the
  fit shrinks to make room. The names heading on the 8x10 edged print at 130%
  (Neat Stack and Cascade 135-140 to 88px), milestone text 13-19% where it was
  tight (landing at the French control's sizes), and in Neat Stack and Cascade
  descriptions drop from two lines to one in 4 of 6 print/scale cases.
  Realistic Arabic content is unchanged. **PERFORMANCE TRAP, fixed:** the
  taller lines make the fit walk more steps, each with new fonts and cold
  measurement caches: Arabic 8x10 went from 1.5s to 39s. `_font` is now
  `lru_cache`d FOR ONE RENDER (`render_png` clears it), so caches carry across
  the steps: cold Arabic renders 0.8-1.85s, French unchanged (5.3s). Cached
  for the whole process instead, 512 fonts held 107MB.
  Pinned by `ArabicPrintTests`: zero overlaps and zero touching letters on
  every print, card, wallpaper and the AR card; and, separately, EVERY
  ESTIMATOR equals what `_draw_wrapped` advances through for Arabic: dropping
  `_line_pitch` from one estimator went unnoticed by the full-page tests (the
  slack between milestones absorbs it at these sizes), so that test is the one
  that catches it. Mutation-checked 12 of 14; the other two (the duration's
  1.8 and the AR card names' 2.2 advances) are equivalent today, both factors
  being above every Naskh floor, and are kept as guards.
  **FOUND AFTER COMMITTING, fixed with the QR caption (18 Oct 2026): the probe
  under-reached full vowel marks.** A kasra under a deep tail reaches 0.68em in
  Kufi against the probe's 0.47 (fully voweled text spans up to 1.96em against
  a 1.85em floor), so voweled lines could still touch. The floor is now the
  larger of the probe's and the TEXT'S OWN ink span; every line is part of the
  text, so none can reach further. Unvoweled text keeps its floor: all 1628
  hashed LST renders are unchanged. `test_fully_voweled_arabic_*` pin it.
  **One known exception, older than both phases:** Typewriter keeps DejaVu
  Sans Mono for Arabic (decision), and on Horizontal Polaroid its wrapped
  Arabic captions overlap as BOXES on their card (no letters touch;
  `TYPEWRITER_KNOWN`). Spacing Mono by its ink was tried and is worse: its
  Arabic stands 1.9-2.0em tall, the fit runs past its floor and letters then
  touch across Typewriter's milestones.
- **QR card caption FIXED (18 Oct 2026), every product, the emailed gift card
  included.** The caption (names, poster title, "artist — track", Reasons names,
  the graduate) was ONE line at a fixed size in DejaVu Serif: long LATIN
  captions ran off both edges (24+24-character names 117% of the card; Song
  Poster's 60+60 up to 283%), on real orders, and Arabic printed as boxes. Now
  (`_caption_layout`, `bonuses.py`): DejaVu Serif with Arabic in Noto Kufi
  (`MixedScriptFont`), wrapped to `CAPTION_WIDTH` (84%) in at most 2 lines,
  shrinking in 5% steps to `CAPTION_MIN_SCALE` (70%) until it and the wordmark
  fit above `CAPTION_BOTTOM_MARGIN` (3%), then "…" at that floor; "HEARTFOLIO"
  follows the last line. A caption that fits one line at full size is drawn
  exactly as before: every short caption, on all 6 cards, is byte-identical
  (LST's 40-character poster title, 93% of the card, is over 84% and now
  wraps). `QrCaptionTests` (`tests_bonuses.py`, fast) pin the approved limits
  as literals; `_card_font`'s bitmap fallback stays (a bonus beats none) and a
  test keeps the files present.
- **FLAGGED, not changed: the live page draws Modern's Arabic HEADINGS in
  Kufi** (its Arabic-only alias face leads every heading stack), where the
  Studio preview, and now the print, use Naskh.
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
