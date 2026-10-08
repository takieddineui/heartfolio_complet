# Heartfolio     Backend

Django + Django REST Framework API backend for Heartfolio. This repository
is separate from the Next.js Studio frontend — the frontend never accesses
PostgreSQL directly; all data flows through this API.

```
Next.js Studio
      |
Django REST API   <- you are here
      |
Django services / domain logic
      |
PostgreSQL / Cloudflare R2 / PayPal
```

## Status: Phase 3.14 — Production / Launch Hardening

Audited the existing backend against a full production-readiness
checklist. Most of it was already correct (see below). Found and fixed
four real gaps: no rate limiting anywhere, no DB-connectivity
readiness check, no test that actually loads `config.settings.production`
(only inspected its source), and a documentation gap around deployment
requirements. 334/334 tests passing, zero migration drift, zero schema
changes. See "Phase 3.14" below for the full report.

## Status: Phase 3.13 — Generic Delivery API & On-Demand Download Flow

Verified the already-implemented generic delivery endpoint against the
full Phase 3.13 checklist. Four real gaps found and fixed (missing
`Cache-Control` header, unsanitized `Content-Disposition` filename, a
minor N+1 query, and missing concurrency/query-budget/R2-boundary test
coverage) — zero migrations, zero new files. 322/322 tests passing.
See "Phase 3.13" below for the full report.

## Status: Phase 3.12 — Paddle Verification & Production Hardening

Paddle payment integration (built in an earlier session) verified
against a real PostgreSQL database and current official Paddle
documentation. One genuine gap found and fixed — see "Phase 3.12 —
Paddle Verification & Production Hardening" below for the full
verification report. 311/311 tests passing.

## Status: Phase 3.11 — Second Real Product Renderer: Where We Met Map

Phases 3.1–3.11 are complete. This phase proves the Phase 3.8/3.9
rendering architecture generalizes to a second, fundamentally
different product: `WhereWeMetMapRenderer`, registered for the real
product slug `"heart-map"` (see "Where We Met Map Renderer" below for
why that differs from the module's `where-we-met-map` folder name).
**Zero schema changes.** No product-specific branching was added to
`apps/delivery/services.py`, `registry.py`, or any other shared file —
adding this second product required exactly the same pattern as the
first: one new package under `product_renderers/`, one new registry
entry.

## Status: Phase 3.10 — Shared Live Preview + Studio Rendering Architecture

Phases 3.1–3.10 are complete. **This phase made zero backend code
changes** — Phase 3.10's work was primarily in the Next.js frontend
repository, which turned out to already have the complete architecture
this phase asked for (shared Studio shell, product-module registry,
per-product `PreviewRenderer` components, zero product-specific
branching in shared code) built prior to the Django backend work in
this repo. The work here was inspection, 16 new frontend tests proving
the existing architecture holds (previously the frontend had zero test
coverage), and this documentation. See "Rendering Architecture" below.

## Project structure

```
backend/
├── manage.py
├── config/
│   ├── settings/
│   │   ├── base.py          # shared settings, env-driven
│   │   ├── development.py
│   │   └── production.py
│   ├── urls.py               # mounts /admin/ and /api/v1/
│   ├── asgi.py
│   └── wsgi.py
├── apps/
│   ├── customers/            # will own: Customer (guest identity)
│   ├── products/             # will own: Product, DeliveryPack
│   ├── projects/             # will own: Project
│   ├── assets/                # will own: Asset
│   ├── commerce/              # will own: Order, Payment, Entitlement
│   └── common/                 # shared infrastructure only
│       ├── exceptions/         # DRF exception handler -> {"error": {...}}
│       ├── urls.py             # /api/v1/health/
│       └── views.py
├── requirements/
│   ├── base.txt
│   ├── development.txt
│   └── production.txt
├── .env.example
└── .gitignore
```

Each domain app currently contains only `__init__.py` and `apps.py` — no
`models.py`. This mirrors the approved database schema's domain
boundaries (`customers`, `products`, `projects`, `assets`, `commerce`)
without pre-building any of the tables it describes.

## App boundaries

- **customers** — guest identity only, no authentication/accounts.
- **products** — will eventually own both `Product` and `DeliveryPack`
  (a delivery pack belongs to a product, not a separate domain).
- **projects** — generic, product-agnostic project state.
- **assets** — uploaded file metadata; binaries live in object storage.
- **commerce** — `Order`, `Payment`, `Entitlement` together, since they
  form one transactional flow.
- **common** — genuinely shared infrastructure (exception handling,
  health check) only. Not a dumping ground for business logic.

## Settings

Three-file split, all reading from environment variables via
`django-environ` (nothing environment-specific is hardcoded):

- `base.py` — everything shared: installed apps, middleware, DRF config,
  CORS, logging, database (from `DATABASE_URL`).
- `development.py` — `DEBUG` defaults to `True`; falls back to allowing
  `localhost:3000` for CORS if `CORS_ALLOWED_ORIGINS` isn't set, so a
  local Next.js dev server works without extra setup.
- `production.py` — `DEBUG` hardcoded `False`; `ALLOWED_HOSTS` and
  `CORS_ALLOWED_ORIGINS` are required (no fallback — fails loudly rather
  than silently under-restricting); standard security hardening
  (HSTS, secure cookies, SSL redirect).

`manage.py`/`wsgi.py`/`asgi.py` default `DJANGO_SETTINGS_MODULE` to
`config.settings.development`; a real deployment sets
`DJANGO_SETTINGS_MODULE=config.settings.production` explicitly.

## Environment variables

Copy `.env.example` to `.env` for local development:

```
DJANGO_SECRET_KEY
DJANGO_DEBUG
DJANGO_ALLOWED_HOSTS
DJANGO_LOG_LEVEL
HEARTFOLIO_LOG_LEVEL
DATABASE_URL
CORS_ALLOWED_ORIGINS
```

`.env` is git-ignored. Production environments should inject real
environment variables directly rather than shipping a file.

## API versioning

Everything is mounted under `/api/v1/`. Only one route exists today:

```
GET /api/v1/health/   -> {"status": "ok"}
```

This checks process liveness only — it does not touch the database or
any external service. Resource endpoints (`/api/v1/products/`,
`/api/v1/projects/`, etc.) are added in later phases as each domain app
gains real models and serializers.

## Error handling

`apps/common/exceptions/handlers.py` installs a DRF `EXCEPTION_HANDLER`
that reshapes every DRF-recognized exception into:

```json
{
  "error": {
    "code": "some_error_code",
    "message": "Human-readable message",
    "details": {}
  }
}
```

`code` is derived generically from the exception's class name — no
business-specific error codes are defined yet. Exceptions DRF doesn't
recognize (e.g. an unhandled Python exception) are left alone and fall
through to Django's normal 500 handling.

## Logging

Three loggers are configured, all console-only for now:

- `django` — framework-level logging.
- `django.request` — request-level errors.
- `heartfolio` — reserved for future domain/application code
  (`import logging; logging.getLogger("heartfolio")`).

No handler is fed request bodies or payloads by default, so nothing here
can accidentally log credentials, tokens, or payment data without a call
site deliberately doing so.

## Guest identity

Heartfolio's MVP is guest-based — no accounts, no passwords, no JWTs.
The mechanism is Django's own session framework: an opaque, HttpOnly
session cookie (`sessionid`) that the backend maps to a `Customer` row
once an email is known.

```
GET  /api/v1/guest/   -> {"customerId": null, "email": null}   (no identity yet)
POST /api/v1/guest/   {"email": "..."}
                       -> {"customerId": "<uuid>", "email": "..."}
GET  /api/v1/guest/   -> same identity, resolved from the session cookie
```

- **Before an email is known**, there is nothing to persist: no
  `Customer` row is created and no session is written just from a `GET`
  (the schema's `customers.email` is `NOT NULL`, so a customer literally
  cannot exist without one — see the Phase 3.2 report for the full
  reasoning). `GET` does still call `django.middleware.csrf.get_token()`
  so the frontend can bootstrap a CSRF cookie ahead of the `POST`.
- **`POST` with an email** resolves-or-creates the `Customer`
  (`apps/customers/services.py`, case-insensitive via the `citext`
  column) and stores its id in `request.session["customer_id"]`.
- **Every later request** is identified purely from the session cookie —
  no customer id is ever accepted as client-supplied input.
- **Expiration**: 30 days by default (`SESSION_COOKIE_AGE`, env-driven),
  surviving browser restarts (`SESSION_EXPIRE_AT_BROWSER_CLOSE = False`).

CSRF stays fully enforced: `apps/customers/authentication.py` defines
`CsrfEnforcedSessionAuthentication`, because DRF's stock
`SessionAuthentication` only checks CSRF for an authenticated Django
auth `user` — which guests never are. Without this override, CSRF
protection would have silently never engaged on the `POST`.

## Data layer

All eight approved MVP tables exist: `customers`, `products`, `projects`,
`assets`, `delivery_packs`, `orders`, `payments`, `entitlements`. Owned
by app per the approved boundaries: `customers` (Phase 3.2), `products`
(`Product`, `DeliveryPack`), `projects` (`Project`), `assets` (`Asset`),
`commerce` (`Order`, `Payment`, `Entitlement`).

Two things worth knowing if you're reading the migrations:

- **`ON DELETE` is enforced by PostgreSQL, not just Django.** Django's
  `on_delete=CASCADE/SET_NULL` is application-level only by default —
  the FK constraint it creates carries no `ON DELETE` clause. Every FK
  that needs `CASCADE`/`SET NULL` sets `db_constraint=False` and gets a
  hand-written `ALTER TABLE ... FOREIGN KEY ... ON DELETE ...`
  constraint in its migration instead, so the behavior holds even for a
  raw SQL delete that bypasses the ORM entirely (see the Phase 3.3
  report for how this was caught and verified).
- **`updated_at` is maintained by a shared PostgreSQL trigger**
  (`update_updated_at_column()`, defined once in
  `apps/common/migrations/0001_...`), attached to every table with an
  `updated_at` column — not just Django's `auto_now`. Verified by a raw
  SQL `UPDATE` outside the ORM.

## Application & commerce layer

**API endpoints** (all under `/api/v1/`):
```
GET    /health/
GET    /guest/                      POST /guest/
GET    /products/                   GET  /products/<slug>/
POST   /projects/                   GET/PATCH/DELETE /projects/<uuid>/
POST   /orders/                     GET  /orders/<uuid>/
POST   /orders/<uuid>/pay/
GET    /orders/<uuid>/entitlements/
```

**Layering**: views only resolve the session customer, validate input via
a serializer, call a service function, and serialize the result.
Business rules (pricing, ownership, consistency, entitlement generation,
transactional payment confirmation) live entirely in
`apps/products/services.py`, `apps/projects/services.py`, and
`apps/commerce/services.py`.

**Frontend contract**: the frontend only ever sends/receives slugs
(`productId: "love-story-timeline"`, `deliveryPackId: "printable"`) —
internal UUIDs are resolved server-side and never required as input.
JSON is camelCase; the database stays snake_case.

**Security**: every project/order is resolved through
`apps.customers.services.get_current_customer(request)`, which reads
only `request.session` — a client-supplied customer id is never
trusted, and ownership (`project_access_denied` / `order_access_denied`)
is enforced on every read/update/delete.

**Payment flow**: `apps/commerce/services.py::confirm_payment` locks the
order (`select_for_update`), calls the pluggable
`apps/commerce/payment_provider.py` abstraction (only `MockPaymentProvider`
exists so far — PayPal/Stripe can be added later without touching the
service), and — only on success, in the same transaction — marks the
order paid and grants entitlements. A failed attempt is persisted but
leaves the order retryable; entitlement generation is idempotent
(`get_or_create` on the approved `(order_id, target_id)` constraint), and
repeat `/pay/` calls on an already-paid order return the existing
payment rather than charging again.

**Errors**: `apps/common/exceptions/api_errors.py` defines named
exceptions (`ProductNotFound`, `ProjectAccessDenied`, ...) whose class
names — run through the Phase 3.1 exception handler's camelCase-to-
snake_case conversion — already produce the exact stable error codes
the API returns, with no separate code registry to keep in sync.

## Delivery & Export Architecture

### Core principle: inputs are persistent, outputs are derived

```
Project (persistent, source of truth)
  → Product Renderer          (product-specific — NOT built yet)
  → Delivery Renderer         (per delivery type — NOT built yet)
  → Temporary Artifact / Hosted Digital Experience   (derived, ephemeral)
```

The `Project` is never turned into a permanent "generated files"
record. Every real output is produced *on demand* from the project at
download time — there is no `generated_assets`/`export_files` table,
and this phase doesn't add one.

### CURRENTLY IMPLEMENTED (Phase 3.8 architecture)

- **`apps/delivery` app** (no models, zero migrations):
  `delivery_types.py`, `renderers.py`, `registry.py`, `services.py`,
  `views.py`, plus `product_renderers/` (Phase 3.9 — see below).
- **Four delivery types** (`apps/delivery/delivery_types.py`):
  `PRINTABLE`, `SOCIAL`, `WALLPAPER`, `DIGITAL`. Classified from
  existing data only — see "Delivery type classification" below for a
  genuine ambiguity this had to resolve.
- **Entitlement-based access** (`apps/delivery/services.py`,
  `get_entitlement_for_customer`): ownership resolved through
  `entitlement.order.customer` (Entitlement has no direct customer
  field), reusing the exact 404-vs-403 pattern established for
  projects/orders/assets in earlier phases. An entitlement whose order
  isn't `paid` is treated as not-found — checked explicitly, not
  assumed from "entitlements only exist after payment."
- **Renderer abstraction** (`apps/delivery/renderers.py`):
  `ProductRenderer` Protocol with `render(project, delivery_type,
  delivery_pack, target_id)` (used) and `preview(project)` (unused for
  delivery — reserved for Live Preview, see below).
  `TemporaryFileResult` (raw bytes, content-type, filename — never
  written to R2, the filesystem, or any table) and
  `DigitalDeliveryResult` (a shareable URL, not used by Love Story
  Timeline yet — see "Digital Product" below) are the two possible
  outcomes. **Phase 3.9 change**: `target_id` was added to `render()`
  — `delivery_type` alone can't distinguish `"story-png"`
  (1080x1920) from `"square-png"` (1080x1080), both `SOCIAL`. Additive,
  backward-compatible; every call site/test double was updated.
- **Renderer registry** (`apps/delivery/registry.py`): a single
  `get_renderer(product_slug, delivery_type)` factory. As of Phase 3.9,
  `"love-story-timeline"` resolves to a real
  `LoveStoryTimelineRenderer` (see below); every other product still
  resolves to `NotImplementedRenderer` (`renderer_not_available`, 501).
  No product-specific branch exists anywhere in generic delivery code.
- **Download API**: `GET /api/v1/entitlements/<uuid>/download/` —
  resolves the session customer, verifies entitlement ownership and
  payment status, classifies delivery type, dispatches to the
  registry, and returns either a file response or `{"url": ...}` JSON.
  No client input beyond the entitlement id in the URL has any effect
  — a probing `?customerId=`/`?projectId=` query string is simply
  never read.

### Delivery type classification (no schema change needed)

Inspecting the real frontend catalog
(`src/lib/studio/product-modules/love-story-timeline/{exports,delivery-packs}.ts`)
surfaced a genuine ambiguity: the same target id can mean different
things depending on which pack sold it — `"story-png"` (a 1080x1920
PNG) is an item in *both* the `"social"` pack (an Instagram Story) and
the `"wallpaper"` pack (a phone wallpaper). The export format is just a
pixel shape; "what this delivery is for" is a packaging decision made
at the `DeliveryPack` level.

Resolved using only existing data — no migration: `infer_delivery_type`
prefers the entitlement's originating `order.delivery_pack.slug`
(`"printable"`/`"social"`/`"wallpaper"`/`"live"` map directly to a
type) and only falls back to the bare target id's naming convention for
bundle packs (like `"complete"`) or unrecognized pack slugs — at which
point the ambiguity is genuinely unresolved from data alone, and the
fallback is a documented best-effort default, not a silent guess.
**Confirmed working correctly in Phase 3.9**: `"story-png"` purchased
through the `"wallpaper"` pack still renders at its real 1080x1920
dimensions (the renderer dispatches actual output size from
`target_id`, not the coarser `delivery_type` label) — tested directly.

## Phase 3.13 — Generic Delivery API & On-Demand Download Flow

The generic delivery endpoint described above
(`GET /api/v1/entitlements/<uuid>/download/`) was already fully built
and wired to both real product renderers (Love Story Timeline, Where
We Met Map) as of an earlier session. This phase verified the existing
implementation against the full Phase 3.13 checklist, found four real
gaps, fixed them, and added the test coverage the checklist requires
that didn't already exist (concurrency, query budget, and an explicit
R2-write-boundary proof) — no new files, no new models, zero
migrations.

**Findings and fixes**:
1. **Missing `Cache-Control` header.** Neither response branch of
   `EntitlementDownloadView` set any caching header. These are
   personalized, emotionally significant outputs tied to one
   customer's paid order — never appropriate for a shared/proxy cache.
   Fixed: every response (binary file and the Digital Product JSON
   branch) now sets `Cache-Control: private, no-store`.
2. **Unsanitized filename in `Content-Disposition`.** The header was
   built with a raw f-string around `result.filename`. In practice
   `filename` is always derived from `Entitlement.target_id`, which is
   never client input at request time (`DeliveryPack.included_targets`
   is admin/fixture data, not writable through any public endpoint) —
   so there was no live exploit path — but a raw value going straight
   into an HTTP header is exactly the kind of thing that shouldn't
   depend on an upstream value staying well-behaved. Fixed: added
   `_safe_filename()` (allow-list of filename-safe characters, strips
   path separators/CR/LF/quotes, strips leading dots, falls back to
   `"download"` if nothing survives) and proved with a test using a
   deliberately malicious test-double renderer that the sanitization
   applies regardless of what a (mis)behaving renderer returns.
3. **Minor N+1 query.** `get_entitlement_for_customer`'s
   `select_related` didn't chain through to `order__project__customer`,
   so any renderer reading `project.customer` (both real renderers do,
   for photo-ownership resolution) triggered one extra query. Fixed by
   extending the `select_related` chain; a full real-renderer download
   now takes 3 queries total (session lookup, customer lookup,
   entitlement fetch) regardless of how many raster targets a product
   has. Locked in with `DeliveryQueryBudgetTests`.
4. **Missing test coverage** for three checklist items that had no
   prior test at all: concurrent downloads of the same entitlement
   (`ConcurrentDownloadTests`, real HTTP requests from 5 threads with
   separate DB connections via `TransactionTestCase`, matching the
   existing Paddle webhook concurrency test's pattern), a query-count
   regression guard (`DeliveryQueryBudgetTests`), and an explicit
   structural proof that a delivery request reading a real input photo
   from R2 never calls `AssetStorage.upload` (`GeneratedOutputNeverReachesR2Tests`
   — spies on `MockAssetStorage.upload` with `wraps=`, so the test
   fails loudly if a future change ever tries to persist a generated
   output back to storage).

**Verified, unchanged**: entitlement-as-sole-authority (client cannot
override target/product/order/customer via query string — tested),
paid-state enforcement, the generic renderer registry (zero
product-specific branching outside `product_renderers/`), both real
renderers already delivering actual PNG bytes (verified via Pillow,
correct dimensions per target) and actual HTML through the real HTTP
endpoint, cross-guest 403/404 semantics, structured errors with no
filesystem-path/stack-trace leakage, no generated-output persistence
(`Asset` count unchanged after every download; the on-demand pipeline
never touches R2 for writes), and repeat-download safety (same
entitlement downloaded twice creates zero new rows).

**Supported launch products** (unchanged, no new renderer added):
Love Story Timeline (`print-png`, `story-png`, `square-png`,
`landscape-png`, `portrait-png`, plus digital HTML via the `"live"`
pack) and Where We Met Map / `heart-map` (`print-png`, `story-png`,
`square-png`, `portrait-png`).

**Output lifecycle** (explicit, per the architecture's core rule):
`INPUT ASSETS → R2` (read-only during delivery, via
`get_asset_bytes_for_customer`). `GENERATED OUTPUTS → rendered on
demand, held only in memory for the duration of one HTTP response,
never persisted in PostgreSQL or R2.` No output cache, no
`generated_assets`/`gift_pages`/`export_jobs` table — all explicitly
deferred, none added here.

**Tests**: 322/322 passing (311 baseline + 11 new) —
`customers`: 8, `products`: 27, `projects`: 24, `assets`: 34,
`commerce`: 82, `delivery`: 147 (30 core + 11 new Phase 3.13 + 50
Love Story Timeline + 56 Where We Met Map). `makemigrations --check
--dry-run` → no changes; this phase required and produced zero
migrations. Clean-slate `migrate` against an empty PostgreSQL database
verified: still exactly the same 8 approved business tables, no new
delivery-related table.

**Known limitations**: the query-budget test
(`DeliveryQueryBudgetTests`) covers the Love Story Timeline fixture
only; Where We Met Map was spot-checked manually (same 3-query result,
since it goes through the identical `get_entitlement_for_customer` /
`get_delivery_for_entitlement` path) but doesn't have its own locked-in
regression test — low risk, since both products share the same
generic service layer, but noted rather than silently assumed.

## Rendering Architecture (Phase 3.10)

This section documents how the **frontend** Studio/Live Preview
relates to the **backend** renderer described throughout this file.
This repository is the Django backend only — the architecture below
lives in the separate Next.js frontend repository
(`src/lib/studio/...`, `src/components/studio/...`); it's documented
here because the backend renderer (Phase 3.9) and the frontend live
preview are two implementations of the *same product contract*, and
that relationship needs to be explicit somewhere both teams read.

### 1. Shared Studio

`StudioShell` (frontend) is a single, product-agnostic editing shell —
generic form section, generic theme controls, generic asset upload,
generic pricing/checkout — driven entirely by whatever `ProductModuleConfig`
it's given. It contains **zero** product-specific code (no
`if (product.slug === "love-story-timeline")` anywhere in shared
Studio files) — confirmed by inspection and by a new test asserting
the renderer-kind registry only ever contains generic kind keys
(`"component"`, `"canvas"`, `"svg"`, ...), never a product slug.

### 2. Product Modules

Each product (`love-story-timeline`, `heart-map`, ...) provides its
own `ProductModuleConfig`: form schema, theme axes, initial state,
optional product-specific validation, pricing rules, delivery config,
i18n messages, and a `renderer` (a `PreviewRenderer` React component
plus its intrinsic-size function). Resolved generically by
`productModuleRegistry` (slug -> lazy loader) and `loadProductModule()`
— neither contains any per-product logic; adding a new product is
registering one new entry, confirmed by a test that registers a
throwaway mock product at runtime and shows it resolves through the
exact same code path with zero shared-file changes.

### 3. Live Preview (frontend)

Every product's `PreviewRenderer` is a plain React component
consuming `{values, tokens, themeSelections, locale, t}` — pure
props, no API call per keystroke. `LoveStoryTimelineRenderer` is the
reference implementation: it re-renders locally and immediately as
Studio state changes. It shares its core behavioral logic (event
sorting, "days together" duration, duplicate-date awareness) with — but
is not required to be pixel-identical to — the backend's PNG/HTML
renderer; both independently implement the same product contract for
their own medium (interactive DOM vs. deterministic raster/HTML file).

### 4. Backend Renderer (this repo, Phase 3.9)

`apps/delivery/product_renderers/love_story_timeline/` remains the
**sole authority** for final, deliverable output — PNG (printable/
social/wallpaper) and self-contained HTML (digital). It independently
validates and normalizes `project.data` (`data.py`) rather than
trusting anything the frontend preview computed; the frontend preview
exists for UX responsiveness, not as a source of truth for security,
pricing, or the final artifact. Nothing about Phase 3.10 changes this
boundary — it was already true since Phase 3.9 and remains true.

### 5. Input assets vs. generated outputs (unchanged, reaffirmed again)

Uploaded photos live in R2 (Phase 3.5); the frontend preview displays
them via the same safe URL the upload API already returns (a
browser-local object URL in the current mock `AssetManager`, a
presigned/mock URL from the real upload endpoint) — the browser never
constructs an R2 key or sees any credential. Generated outputs
(preview *or* final export) are never uploaded to R2, never persisted
in the `assets` table, and never given a permanent table of their own
— confirmed unchanged by the full Phase 3.9 temp-file/no-persistence
test suite, which still passes untouched.

### 6. Product registry -> next product

Adding a product (e.g. a future Where We Met Map *renderer* — the
product module itself already exists in the frontend) means adding a
`PreviewRenderer` to that product's own module folder and registering
it; it does not require modifying `StudioShell`, `preview-pane.tsx`,
`component-renderer.tsx`, `module-loader.ts`, or `registry.ts`. On the
backend side, it means adding a new package under
`apps/delivery/product_renderers/` and one line in
`apps/delivery/registry.py` — exactly what Phase 3.9 already
established as the pattern for Love Story Timeline.

### 7. What Phase 3.10 changed

**Nothing on the backend.** `manage.py check`, `makemigrations --check
--dry-run`, and the full 254-test suite were all re-verified
unchanged. On the frontend: added a minimal test framework (Vitest —
the frontend had none before) and 16 tests proving points 1–6 above
hold against the actual code, not just by inspection.

## Love Story Timeline Renderer (Phase 3.9)

The first real `ProductRenderer` — registered for
`"love-story-timeline"` in `apps/delivery/registry.py`, implemented in
`apps/delivery/product_renderers/love_story_timeline/`.

### Product Renderer

A **backend, product-specific** component that turns normalized
project data into requested delivery formats. It has no knowledge of
HTTP, sessions, or ownership (that's `apps/delivery/services.py`'s
job) — it only receives `project`, `delivery_type`, `delivery_pack`,
`target_id` and returns a `DeliveryResult`.

### Real data contract (read from the actual frontend, not guessed)

Discovered directly from `src/lib/studio/product-modules/love-story-
timeline/{schema,metadata,initial-state,themes,validation,exports,delivery-packs,renderer.tsx}.ts`:

- `values`: `partner1`/`partner2` (required, ≤20 chars),
  `posterTitle` (≤30), `quote` (≤90), `endingText` (≤40),
  `showDuration`/`autoSort` (bool), `premiumModule`
  (`none`/`spotify`/`coordinates`/`moon` — display-only flag, no
  linked data field exists yet), `events` (1–5 items; each:
  `date` ISO 8601 required+unique, `title` required ≤22 chars,
  `description` ≤55 chars, optional `photo.assetId`).
- `themeSelections`: `palette` (8 options, real hex values copied from
  `themes.ts`), `typography` (4 options), `layout` (5 options),
  `frame` (5 options), `scale` (70–130).
- Behavioral logic mirrored exactly from `renderer.tsx`: event sorting
  when `autoSort`, "N days together" computed from the *first and
  last* of the (possibly sorted) events array, duplicate-date
  rejection (matching `validation.ts`).
- **Output format**: confirmed directly from `exports.ts` — every
  Love Story Timeline export target (`story-png`, `square-png`,
  `landscape-png`, `portrait-png`, `print-png`) is **PNG**. No PDF
  anywhere in the real catalog, so none is implemented.
- `Project.data`'s top-level shape is untouched — `apps/delivery/
  product_renderers/love_story_timeline/data.py` is the *only* place
  that interprets `values`/`themeSelections`; generic delivery code
  never does.

### Rendering

- **Printable/Social/Wallpaper** (`png_renderer.py`): real Pillow
  rendering — correct dimensions per target (copied verbatim from
  `exports.ts`), real palette hex colors, real bundled fonts (DejaVu
  Serif/Sans/Sans Mono — see `fonts/LICENSE.txt`; chosen because they
  can be bundled and redistributed freely, unlike the frontend's
  actual CSS fonts Fraunces/Inter/JetBrains Mono, which aren't
  license-cleared or bundled here), word-wrapped text, and **real
  photo compositing** — an event's `photo.assetId` is resolved through
  the existing ownership-checked asset APIs (`project.customer`, an
  already-existing relationship — never a new trust boundary) and
  pasted into the output. Deterministic: identical normalized input
  produces byte-identical output.
- **Digital** (`html_renderer.py`): a real, self-contained HTML
  document — inline CSS using the actual theme token *names* from
  `themes.ts` (`--p-bg`, `--p-accent`, etc.) with real hex values,
  genuine CSS `@keyframes` animations (staggered timeline reveal), and
  any referenced photo embedded as a base64 `data:` URI (never an
  external link — there is no persistent public URL for an input
  asset, and this document itself is never uploaded anywhere).

### Scope limitations (honestly documented, not hidden)

- Only **one** structural layout algorithm is implemented for
  `standard`/`alternating`/`centered`/`journal` (a plain stacked
  list); `cards` is genuinely distinct (bordered per-event boxes).
  The frontend's CSS differentiates all five via positioning this
  renderer doesn't attempt to replicate pixel-for-pixel.
- `frame` renders as a real but simplified border (color/thickness per
  frame id), not the CSS's actual gallery-matting/wood-grain/vintage
  textures.
- Fonts are close substitutes (DejaVu), not the frontend's actual
  commercial/Google fonts.
- English-only date formatting and premium-module labels — no i18n
  integration (the backend has no locale/session-language concept).
- On a very cramped canvas (many events, no photos, short height —
  e.g. `landscape-png` with 4+ long events), the footer
  (`premiumModule` label / `endingText`) can be pushed below the
  visible canvas rather than overlapping event content. A real bug —
  event text *overlapping* other event text — was found and fixed
  during this phase (dynamic font-shrink + description truncation when
  content doesn't fit its slot); this remaining footer-clipping case
  is a documented, lower-severity edge case, not the same failure
  mode.

### Studio

A **future, frontend-only** shared editing shell (toolbar, controls,
sidebar, theme selection, live canvas, export). Not built in this or
any prior phase. It will not know how Love Story Timeline is visually
rendered — that stays entirely behind the renderer.

### Live Preview

A **future, frontend-only** real-time rendering experience every
product will have. `ProductRenderer.preview(project)` exists in the
interface (and `LoveStoryTimelineRenderer` even has a working
implementation, reusing the HTML renderer) specifically so a future
Live Preview can call the *same* registered renderer used for paid
delivery — but nothing in the backend or frontend calls `preview()`
yet, and no live preview UI exists.

### Input assets vs. generated outputs (reaffirmed)

**Input assets** (customer-uploaded photos) live in R2, unchanged
since Phase 3.5. **Generated outputs** (the PNGs/HTML this renderer
produces) are generated **on demand, in-memory** (`io.BytesIO`,
`str.encode()`) and returned directly in the HTTP response — **nothing
is ever written to R2, the filesystem, or any database table.**
Verified directly: a test snapshots the system temp directory
before/after rendering and asserts it's unchanged, for every delivery
type, including a full round-trip through the real API endpoint.

### Future caching

Explicitly deferred. Every request re-renders from scratch. No
generated-output cache, no `generated_assets` table, no CDN layer.

### FUTURE (explicitly not built in this or any prior phase)

Heartfolio Studio, Live Preview UI, any *other* product-specific
renderer (Moon Phase, Where We Met, Song Poster, Star Map, ...),
animated Digital Gift *hosting* (permanent public URLs — the HTML is
generated correctly but not hosted anywhere), music hosting, public
gift pages, QR codes, an export job queue, Celery, Redis, permanent
generated-output storage, any `generated_assets`/`export_jobs`/
`gift_pages` table, subscriptions, refunds, analytics, notifications.

## Where We Met Map Renderer (Phase 3.11)

The second real `ProductRenderer` — registered for the real product
slug **`"heart-map"`** (`apps/delivery/registry.py`), implemented in
`apps/delivery/product_renderers/where_we_met_map/`. Proves the
Phase 3.8/3.9 architecture generalizes: no shared file
(`apps/delivery/services.py`, `registry.py`, the `ProductRenderer`
Protocol) needed any product-specific change to add this second,
visually and structurally different product.

**Important naming note, confirmed by inspection, not assumed**: the
frontend module's own folder/internal naming is `where-we-met-map`,
but the actual catalog/database product slug — confirmed in
`src/lib/products/registry.ts` and `src/lib/studio/product-modules/
registry.ts` — is `"heart-map"`. The registry entry, all tests, and
this section use the real slug.

### Real data contract (read from the actual frontend, not guessed)

Discovered directly from `src/lib/studio/product-modules/where-we-met-map/
{schema,metadata,initial-state,themes,validation,exports,renderer.tsx,
renderer.module.css}.ts`:

- `values`: `partner1`/`partner2` (required, ≤20 chars), `date`
  (required, ISO 8601), `message` (≤90 chars — `mapMetadata.messageMaxLength`),
  `locationLabel` (required, ≤40 chars), `coordinates` (required object
  `{lat, lng}`, range-checked: lat ∈ [-90, 90], lng ∈ [-180, 180] —
  mirrors `validation.ts`'s one cross-field rule the generic schema
  validator can't express), optional `photo.assetId`.
- `themeSelections`: `palette` (4 options — this product's real theme
  surface is smaller than Love Story Timeline's 8, not an oversight),
  `typography` (2 options), `mapStyle` (`line`/`vintage`/`night`/
  `topographic`), `markerStyle` (`pin`/`heart`/`star`/`dot`), `frame`
  (3 options — no `gallery`/`wood`, unlike Love Story Timeline's 5),
  `scale` (**80–120**, a different real range than Love Story
  Timeline's 70–130 — confirmed from `themes.ts`, not assumed to
  match).
- **Output format**: confirmed from `exports.ts` — four PNG targets,
  **no digital/`__live__` target at all** for this product. `render()`
  therefore only ever dispatches to `render_png`; there is no
  `html_renderer.py` here, correctly scoped down rather than built
  speculatively.

### Map rendering strategy — no external provider, confirmed from the source

The frontend's own `renderer.tsx` comment states this directly: **no
map tiles, no Mapbox/Google Maps, no external API, no network access**
— "an art-directed static illustration... rather than literal
cartography." The backend replicates the *exact same* approach: a
deterministic equirectangular projection (`layout.py::project()`) and
a deterministic pseudo-random decorative dot scatter, using formulas
copied verbatim from the frontend's `project()`/`DecorativeMapBackdrop`
(same `(i * 9301 + 49297) % 233280` seed arithmetic) — given the same
coordinates, the backend places the marker at the same relative
position the frontend would. No credentials, no third-party service,
nothing that could fail due to network access or rate limits.

### A discovered, pre-existing frontend cosmetic gap (documented, not silently replicated)

`renderer.module.css` defines per-`mapStyle` stroke colors
(`.mapLine circle, .mapLine path { stroke: var(--p-line) }`, etc.),
but the actual grid backdrop renders `<line>` SVG elements — which
those selectors never match. In the current frontend, this makes the
per-style grid coloring effectively inert (grid lines render with no
stroke at all). This backend renderer implements the colors those CSS
rules clearly *intended* (real, named, per-style tokens) rather than
bug-for-bug replicating a rendering gap — judged the correct call for
"the authoritative final output," and flagged explicitly here rather
than silently diverging from the frontend without comment.

### Rendering

`png_renderer.py`: real Pillow rendering, reusing Love Story
Timeline's bundled DejaVu fonts directly (fonts are a generic,
product-agnostic asset — not duplicated as a second ~3MB copy).
Correct dimensions per target (`story-png` 1080x1920, `square-png`
1080x1080, `portrait-png` 1080x1350, `print-png` 2480x3508, copied
verbatim from `exports.ts`), real palette hex colors, a graticule grid
+ deterministic dot scatter backdrop, a marker (pin/heart/star/dot,
genuinely distinct Pillow-drawn shapes) placed via the real projection
formula, and — when `values.photo.assetId` is present — a real,
ownership-checked composited photo (same `apps.assets.services`
pattern as Love Story Timeline: resolved through `project.customer`,
never a client-supplied storage key).

### Two real bugs found and fixed during manual visual verification

Following the exact discipline that caught the Phase 3.9 Love Story
Timeline overlap bug — generated images were actually opened and
inspected, not just asserted non-empty:
1. **Footer text overflow**: long names/location/message on a narrow
   canvas ran off both edges uncontained. Fixed with a dynamic
   font-shrink-to-fit for single-line text (names, location) and
   word-wrapped, ellipsis-truncated multi-line text for the message.
   Re-verified visually after the fix.
2. **Unbroken-string wrap failure**: a message with zero whitespace
   (e.g. `"x" * 90`) defeated word-boundary wrapping entirely (nothing
   to break on). Fixed with a character-level fallback split for any
   "word" wider than the available width on its own.

### Security

Identical pattern to every other renderer: ownership resolved via
`get_entitlement_for_customer` (404 vs. 403, order-must-be-paid
check), photo assets resolved via `project.customer` (never a
client-supplied id or storage key). Verified directly, not just
asserted: a photo `assetId` belonging to a different customer fails
safely (502, structured error, no data leaked) rather than rendering;
a real live HTTP smoke test confirmed a second guest gets a genuine
`403` for the first guest's entitlement.

### Temporary output / R2 (reaffirmed, unchanged)

Fully in-memory (`io.BytesIO`) — nothing written to R2, the
filesystem, or any database table. Verified directly: tests snapshot
the system temp directory before/after every render, including a full
live HTTP round-trip, and assert it's unchanged.

### Known limitations

Marker shapes are Pillow-drawn approximations of the frontend's SVG
paths (same visual intent — pin/heart/star/dot — not pixel-identical
geometry). Map-style grid coloring implements CSS *intent* rather than
the frontend's current (buggy) rendering, as documented above. English-
only date formatting, same as Love Story Timeline. Fonts are the same
DejaVu substitutes, not the frontend's actual commercial fonts.

## Paddle Payment Integration

**Provider abstraction** (`apps/commerce/payment_provider.py`):
`PaymentProvider` now has two capabilities, split by whether the
provider is synchronous:
- `pay(order) -> PaymentResult` — **`MockPaymentProvider`** only,
  byte-for-byte unchanged since Phase 3.4. Completes a (fake) charge
  immediately.
- `start_checkout(order) -> PaddleCheckoutResult` — **`PaddlePaymentProvider`**
  only. Only *begins* a payment — final confirmation arrives later via
  the webhook, never from this call.

`get_payment_provider()` selects between them from
`settings.PAYMENT_PROVIDER` (`"mock"` | `"paddle"`) — nothing else in
the codebase branches on which provider is active. All Paddle-specific
code (the official `paddle-python-sdk`, transaction creation, webhook
verification/parsing) is isolated in `apps/commerce/paddle_integration.py`;
nothing else imports `paddle_billing` directly.

**Flow**:
```
POST /api/v1/orders/                    -> pending Order, server-priced from DeliveryPack.price_cents
POST /api/v1/orders/{id}/pay/           -> Paddle: creates/reuses a Paddle transaction (non-catalog item,
                                            priced from order.total_cents — no Paddle catalog Product/Price
                                            involved, see "Why non-catalog items" below), persists a
                                            `pending` Payment, returns {transactionId, clientToken} for
                                            Paddle.js. Order stays "pending" in this response.
Paddle.js checkout, customer pays
POST /api/v1/webhooks/paddle/           -> verifies signature, reconciles amount/currency, locks the
                                            order, marks it paid, grants entitlements — all atomically.
                                            This is the ONLY path that ever marks a Paddle order paid.
```

**Why non-catalog items**: Paddle Billing supports creating a
transaction from an inline `price`/`product` object instead of a
pre-existing catalog Price ID (documented at
developer.paddle.com/build/transactions/bill-create-custom-items-prices-products).
Heartfolio's database (`DeliveryPack.price_cents`) stays the sole
source of truth for price — no Paddle catalog id is stored anywhere,
and the approved schema needed no changes.

**Order id -> Paddle transaction mapping**: carried in the transaction's
`custom_data.orderId` (a stable Heartfolio UUID), never inferred from
email, amount, or product name. The webhook resolves
`custom_data.orderId -> Order` deterministically.

**Webhook security** (`apps/commerce/webhook_views.py`,
`POST /api/v1/webhooks/paddle/`): public — no guest session, no CSRF —
but every request must carry a valid `Paddle-Signature` header or it's
rejected (401) before touching the database. Verification uses the
official SDK's `Verifier` against the documented algorithm
(`ts=<unix>;h1=<hmac-sha256>`, signed payload `f"{ts}:{raw_body}"`,
timing-safe comparison, default 5-second replay-protection window).
**The raw request body is read and verified before any JSON parsing**
— `parser_classes = []` on the view prevents DRF from touching it
first, since re-serializing the body in any way (even whitespace)
invalidates Paddle's signature.

**Amount reconciliation**: before marking anything paid, the webhook
compares Paddle's reported `currency_code` and `details.totals.total`
against the order's own `currency`/`total_cents`. Any mismatch raises
`payment_amount_mismatch` (400) and neither the order nor any Payment
row is touched.

**Idempotency**: relies entirely on existing constraints —
`UNIQUE(order_id, target_id)` for entitlements, `UNIQUE(provider,
provider_reference)` for payments, plus `select_for_update()` locking
— no `payment_webhooks` table was added (still deferred). A duplicate
`transaction.paid` delivery, or several racing simultaneously, produce
exactly one successful Payment, one paid Order, and one Entitlement
per target — verified with a real concurrent-thread test
(`TransactionTestCase`, 5 threads), mirroring the Phase 3.4 pattern.

**Payment/Order status mapping** (existing enums, unchanged — no
`processing`/`refunded`/`authorized` states added):
| Paddle | Heartfolio `Payment.status` | Heartfolio `Order.status` |
|---|---|---|
| Transaction created, checkout started | `pending` | stays `pending` |
| `transaction.paid` (verified) | `success` | `paid` |
| Amount/currency mismatch | *(no Payment row created)* | stays `pending` |

**Retry behavior**: already-paid orders return the existing successful
payment (idempotent, no new transaction). A pending order with an
existing Paddle transaction reference reuses it as-is on repeated
checkout opens (no extra Paddle API call to re-verify it's still
open — if it has actually expired, Checkout fails client-side and a
retry lands back on the same code path). Cancelled orders reject
payment (`order_not_payable`).

**Credentials** — three distinct types, used in different places, per
Paddle's own architecture:
- `PADDLE_API_KEY` — secret, backend-only, never sent to the frontend or logged.
- `PADDLE_CLIENT_TOKEN` — public by design, safe to embed in frontend code.
- `PADDLE_WEBHOOK_SECRET` — secret, backend-only, used only for signature verification.

**Environment variables** (see `.env.example`): `PAYMENT_PROVIDER`,
`PADDLE_ENVIRONMENT`, `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`,
`PADDLE_WEBHOOK_SECRET`.

**Mock provider**: `PAYMENT_PROVIDER=mock` (the default) needs zero
Paddle configuration — every existing test and local dev workflow from
Phases 3.4–3.6 is untouched.

**Production**: `config/settings/production.py` refuses to start with
`PAYMENT_PROVIDER=mock`, and refuses to start with
`PAYMENT_PROVIDER=paddle` if any of the three `PADDLE_*` variables is
missing — mirrors the identical R2 pattern from Phase 3.5 exactly.

**Deferred** (unchanged from earlier phases, explicitly not touched by
this one): refunds, subscriptions, `payment_webhooks` table, generated-
output storage in R2, exports, analytics, notifications.

## Phase 3.12 — Paddle Verification & Production Hardening

This phase did not rebuild the Paddle integration above (it was already
complete as of an earlier session) — it verified it against a real
PostgreSQL database and current official Paddle documentation, and
fixed the one genuine gap that verification found.

**Verified against current official Paddle docs**
([developer.paddle.com](https://developer.paddle.com)):
- Webhook signature verification exactly matches the documented Python
  SDK usage (`Verifier().verify(request, Secret(...))`), HMAC-SHA256
  over `f"{ts}:{raw_body}"`, and the 5-second replay-protection default
  — see [Verify webhook signatures](https://developer.paddle.com/webhooks/about/signature-verification/).
- `transaction.paid` is confirmed as a current, correctly-scoped Paddle
  event — see [transaction.paid](https://developer.paddle.com/webhooks/transactions/transaction-paid/):
  "Transactions are paid when payment has been captured successfully,
  but Paddle hasn't yet fully processed the transaction internally,"
  distinct from `transaction.completed` (full internal processing) —
  exactly the distinction `paddle_integration.py`'s module docstring
  already documented.
- Non-catalog transaction creation with `custom_data` is a current,
  documented capability — see
  [Bill for non-catalog items](https://developer.paddle.com/build/transactions/bill-create-custom-items-prices-products/)
  and [Work with custom data](https://developer.paddle.com/build/transactions/custom-data/).
- `paddle-python-sdk` (imported as `paddle_billing`) is confirmed as
  the correct, current, non-deprecated official package — see
  [Python SDK](https://developer.paddle.com/sdks/libraries/python/)
  (latest documented release 1.14.1; this repo pins `>=1.15,<2.0`).

**Finding and fix — cross-order transaction reference reuse (Medium)**:
`confirm_paddle_webhook_payment`'s
`Payment.objects.get_or_create(provider="paddle", provider_reference=...)`
matched only on those two fields. It never checked that the found
`Payment.order_id` matched the order resolved from the webhook event's
`custom_data.orderId`. Reproduced concretely: a transaction reference
already bound to Order A could silently mark an unrelated Order B paid
and grant it entitlements, while the actual `Payment` row stayed
attached to Order A — a data-integrity break, not merely cosmetic. Not
exploitable by an attacker without a valid Paddle signature, but a real
correctness gap. **Fixed** by adding an explicit ownership check
(`payment.order_id != order.id`) that raises `PaymentVerificationFailed`
(400) and rolls back atomically before anything is mutated, plus
`select_for_update()` on the `Payment` row itself (in addition to the
existing `Order` lock) for consistency under concurrent delivery. Regression
test: `PaddleAmountReconciliationTests.test_provider_reference_already_bound_to_a_different_order_is_rejected`.

**Verified, unchanged**: everything else in the Paddle integration
described above — provider abstraction, non-catalog transaction
creation, raw-body-first signature verification, amount/currency
reconciliation, idempotent webhook processing, atomic fulfillment,
production configuration hardening, and the mock-provider development
path — was inspected against this phase's checklist and found correct
as-is. No other code changes were made.

**Test suite**: 311/311 passing (310 pre-existing + 1 new regression
test) against a real PostgreSQL 16 database — `customers`: 8,
`products`: 27, `projects`: 24, `assets`: 34, `commerce`: 82 (81 +
1 new), `delivery` (including both product-renderer submodules): 136.
Concurrency tests (`ConcurrentPaymentConfirmationTests`,
`PaddleWebhookConcurrencyTests`) re-run 3x with no flakiness.

**Migration/schema**: `makemigrations --check --dry-run` → no changes
detected. Clean-slate `migrate` against an empty database succeeds.
Actual PostgreSQL schema inspected directly (`\dt`, `\d`): exactly the
8 approved business tables plus Django framework tables — no
`payment_webhooks`, `generated_assets`, or `gift_pages` table exists.
`uq_payments_provider_reference` and `uq_entitlements_order_target`
confirmed present with correct `ON DELETE CASCADE`/`SET NULL` behavior.
This phase required **zero migrations** — the fix was service-layer
logic only.

**Live HTTP verification**: performed with `MockPaymentProvider` and
with real signed webhook fixtures via Django's test client (HMAC
computed the same way Paddle computes it, against a test secret) —
this is what the existing and new Paddle test classes already do. No
real Paddle sandbox credentials were available in this environment, so
no live sandbox transaction was performed; that remains **UNVERIFIED**
against Paddle's actual servers specifically (see Known limitations).

## Phase 3.6 contract fixes

Found by reading the frontend's actual TypeScript interfaces, not by
guessing:

| Serializer | Was | Now | Why |
|---|---|---|---|
| `ProductSerializer` | `nameI18nKey` | `i18nKey` | matches `ProductEntry.i18nKey` exactly |
| `DeliveryPackSerializer` | `nameI18nKey`/`descriptionI18nKey` | `nameKey`/`descriptionKey` | matches `DeliveryPack.nameKey`/`.descriptionKey` |
| `DeliveryPackSerializer` | (missing) | `productId` | matches `DeliveryPack.productId` |
| `OrderSerializer` | (missing) | `orderId`, `guestEmail`, `paymentProvider`, `paymentStatus` | matches `Order` exactly; the latter two are derived from the order's most recent `Payment` — no schema change, since `orders` deliberately has no such columns (that's `Payment`'s job) |
| `EntitlementSerializer` | (missing per-item) | `orderId`, `productId` on each entitlement | matches `Entitlement` exactly (previously only present once, at the wrapping response's top level) |
| `ProjectSerializer` | (missing) | `projectId` | consistency with the alias pattern above; matches `ProjectEngine.save()`'s `{projectId}` return shape |

**Deliberately not changed** (documented, not silently "fixed" to match):
- `ProductSerializer.startingPriceCents` stays a raw integer, not `ProductEntry.startingPrice`'s pre-formatted display string (`"$12"`) — formatting currency is a locale/presentation concern with no context available server-side, and the approved schema stores cents, not a string.
- `ProductEntry.thumbnail` / `.icon` / `.featured` / `.badgeKey` are **not exposed** — no corresponding column exists in the approved 8-table schema, and adding one would be a schema change this phase must not make. The frontend type file's own header ("mirrored from the Marketing App") suggests these are presentational/CMS fields outside this backend's transactional-catalog responsibility, not an oversight.

## Asset storage (R2)

**R2 stores user-uploaded *input* assets only** — source photos and
other media a product needs. **Generated/exported output (PNGs, PDFs,
posters, invitations, ...) is never stored server-side in this MVP** —
export remains entirely client-side, downloaded directly by the
browser, exactly as before this phase.

**API** (all under `/api/v1/`, session-owned via `get_current_customer`):
```
POST   /assets/            multipart/form-data, field name "file"
GET    /assets/<uuid>/     metadata + a fresh access URL
DELETE /assets/<uuid>/
```
Response shape matches the frontend's existing `AssetManager.upload`
contract plus `id` (same value as `assetId`, for consistency with every
other Phase 3.4 serializer):
```json
{"id": "...", "assetId": "...", "url": "...", "mimeType": "image/jpeg", "filename": "photo.jpg"}
```

**Ownership**: identical pattern to projects/orders — resolved solely
from `request.session` via `get_current_customer`, never trusted from
the client. `asset_access_denied` (403) for another guest's asset,
`asset_not_found` (404) for one that doesn't exist or was already
deleted.

**Storage key**: server-generated, never client-chosen —
`assets/<asset-uuid>/<sanitized-filename>`. The UUID (not the filename)
is what's collision-resistant and used for lookup/deletion; the
filename is sanitized (`os.path.basename` + a strict safe-character
allowlist) purely for readability in the R2 console — path traversal
(`../../etc/passwd`, `C:\...`) is stripped regardless of OS-style
separators.

**Upload flow**: create `Asset` (status `pending`, real key already
assigned) → upload to storage → mark `uploaded`. If the storage upload
fails, the row is marked `failed` (never left as `uploaded` without a
real object behind it) and `asset_upload_failed` is returned.

**Delete flow**: ownership check → delete the R2 object → soft-delete
the row (`status="deleted"`, matching the `deleted` status this table
already had defined). If the R2 delete fails, the row is left
completely untouched (`uploaded`, safely retryable) rather than risking
an orphaned-looking record. The one accepted, documented gap: if R2
delete succeeds but the following DB update fails, the row could
briefly claim otherwise — this MVP does not implement a distributed
transaction or reconciliation job for that narrow window.

**Access URLs are never persisted** — `storage_key` is the only thing
the database stores; a GET computes a fresh presigned URL (or, only if
`R2_PUBLIC_BASE_URL` is deliberately configured, a public URL) on every
request.

**Validation**: MIME type allowlist and max size are both
environment-configurable (`ALLOWED_ASSET_MIME_TYPES`, `MAX_ASSET_SIZE_MB`)
— defaults are `image/jpeg`, `image/png`, `image/webp` and 10MB. SVG is
deliberately excluded by default (script-embeddable, no current product
need).

**Backend selection** (`ASSET_STORAGE_BACKEND`): `"mock"` (default,
in-memory, no credentials needed) for local dev and the entire test
suite; `"r2"` for real Cloudflare R2. Production
(`config/settings/production.py`) refuses to start with `"mock"`, and
refuses to start with `"r2"` if any required `R2_*` variable is missing
— it never silently falls back to local filesystem storage.

**Environment variables** (see `.env.example`):
```
ASSET_STORAGE_BACKEND=mock            # "mock" | "r2"
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_ENDPOINT_URL=                      # derived from R2_ACCOUNT_ID if left blank
R2_PUBLIC_BASE_URL=                   # only set if the bucket is intentionally public
R2_PRESIGNED_URL_EXPIRY_SECONDS=300
MAX_ASSET_SIZE_MB=10
ALLOWED_ASSET_MIME_TYPES=image/jpeg,image/png,image/webp
```

**Not implemented in this phase** (see the phase brief): asset
ownership validation of `assetId` references nested inside
`project.data.values` — doing so would require parsing supposedly-
opaque, product-module-owned JSON, which the existing project service
deliberately never does. `project.data`'s top-level structure remains
exactly `{version, values, themeSelections}` — no new key was added.

## Running locally

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements/development.txt
cp .env.example .env   # then edit DATABASE_URL etc. as needed
python manage.py check
python manage.py runserver
curl http://localhost:8000/api/v1/health/
```

A running PostgreSQL instance is only required for commands that touch
the database (`migrate`, `runserver` handling a DB-backed request,
etc.) — `manage.py check` and `makemigrations --check` both succeed
without one, since there are no models yet.

## Phase 3.14 — Production / Launch Hardening

A hardening pass, not a feature phase: audited the existing backend
against a full production-readiness checklist first, then fixed only
the concrete gaps that audit actually found. No new models, no schema
changes, no new product scope.

### Already correct (verified, not modified)

- **Settings hardening**: `DEBUG = False` is a plain hardcoded
  assignment in `production.py` (not `env.bool(...)`) — a stray
  `DJANGO_DEBUG=True` in the production environment can never
  re-enable it; proven with a real subprocess test, not just read by
  inspection. `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`,
  `SECURE_SSL_REDIRECT`, HSTS (with subdomains + preload),
  `SECURE_CONTENT_TYPE_NOSNIFF`, and `X_FRAME_OPTIONS = "DENY"` were
  all already set correctly. `ALLOWED_HOSTS`/`CORS_ALLOWED_ORIGINS`
  already have no default in production — missing either fails at
  settings-load time.
- **Referrer/cross-origin-opener policy**: Django 5.2's own defaults
  (`SECURE_REFERRER_POLICY = "same-origin"`,
  `SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"`) are already
  correct for this application — confirmed directly against Django's
  `global_settings`, not assumed. No explicit override needed.
- **R2/storage security**: storage keys are always server-generated
  (`assets/<uuid>/<sanitized-filename>`) — a client never supplies or
  influences a storage key. Every read/write is ownership-checked
  through `get_asset_for_customer` first. No path-traversal surface
  exists because the key is never built from unsanitized client input.
- **SSRF surface**: none exists — the only outbound HTTP calls in the
  entire codebase are the Paddle SDK talking to Paddle's own fixed,
  non-configurable-by-request endpoint. No feature fetches a
  client-supplied URL anywhere.
- **Secrets in logs**: audited every `logger.*` call site in the
  codebase. All of them log fixed event-name strings plus structured
  `extra` dicts containing only IDs (order/transaction/storage-key) —
  never raw webhook bodies, signatures, credentials, or payment
  details. The webhook signature-verification failure path
  deliberately logs only a fixed event name, not `str(exception)`,
  precisely so an unexpected SDK-internal error message can never
  leak anything unexpected into logs.
- **Secrets in the repository**: no hardcoded API keys, tokens, or
  credentials anywhere (grepped for common secret patterns and for
  direct `SECRET_KEY =`/`_SECRET =`/`PASSWORD =`-style hardcoding
  outside settings/test files — none found). `.env.example` contains
  variable names and placeholders only. `.env` is gitignored. (This
  deliverable has no `.git` history to additionally scan — noted
  rather than glossed over.)
- **Error handling**: the shared exception handler already returns a
  consistent `{"error": {...}}` envelope for every known exception
  type and safely falls through to Django's own generic (traceback-free,
  since `DEBUG=False`) 500 response for anything unhandled.

### Fixed during Phase 3.14

1. **No rate limiting anywhere.** Added DRF `ScopedRateThrottle`,
   applied via `throttle_scope` to exactly the endpoints identified as
   genuinely abuse-prone: guest/customer creation (`guest_identity`),
   asset upload (`asset_upload`, real R2 write + cost per request),
   order creation (`order_create`), and entitlement download
   (`delivery_download`, real CPU cost — image rendering). Backed by
   Django's default in-memory cache — no Redis added, per the
   "smallest appropriate protection" instruction.
   - Deliberately **not** applied to the Paddle webhook endpoint or
     the health/readiness endpoints (`ScopedRateThrottle` is a no-op
     for any view with no `throttle_scope` set — proven by test, not
     just left unset and assumed safe).
   - Dev/test defaults are generous (`1000/min`) so the test suite is
     never accidentally throttled; `production.py` tightens every
     rate to a real value, independently overridable via environment
     variable (`THROTTLE_RATE_GUEST_IDENTITY`, `THROTTLE_RATE_ASSET_UPLOAD`,
     `THROTTLE_RATE_ORDER_CREATE`, `THROTTLE_RATE_DELIVERY_DOWNLOAD`).
   - **Known limitation, stated plainly**: this is per-process
     (Django's local-memory cache isn't shared across multiple
     gunicorn workers or app-server instances), not a distributed rate
     limiter. That's an intentional, honestly-labeled first layer, not
     a claim of complete abuse protection — a Redis-backed distributed
     limiter is a reasonable future infra phase, not added here per
     the explicit "no Redis" instruction.
2. **No DB-connectivity readiness check.** The existing `/health/` is
   correctly a pure liveness check (deliberately touches nothing).
   Added `GET /api/v1/health/ready/`, which does a real
   `connection.ensure_connection()` and returns 503 if the database is
   unreachable. Deliberately does *not* also probe R2 or Paddle on
   every request — both already fail loudly at process startup if
   misconfigured (see `production.py`), so a live per-request network
   round-trip to either would only add latency/cost without catching
   anything the startup check doesn't already catch.
3. **`config.settings.production` had never actually been loaded by a
   test** — only read by inspection. Added 7 tests that spawn a real
   subprocess and actually import it under controlled environment
   variables, proving (not asserting) that it: fails loudly with a
   missing `DJANGO_ALLOWED_HOSTS`; refuses `PAYMENT_PROVIDER=mock` and
   `ASSET_STORAGE_BACKEND=mock`; fails loudly when `paddle`/`r2` are
   selected but required credentials are missing; loads successfully
   when everything required is genuinely present; and that `DEBUG`
   stays `False` even with `DJANGO_DEBUG=True` set in the environment.
4. **No deployment documentation.** This repository has no
   Dockerfile/Procfile/hosting-platform config — the actual deployment
   architecture is "gunicorn + WSGI + Postgres + R2 + Paddle,"
   deployable on any conventional host, which is what's documented
   below rather than inventing a specific platform choice.

### Deployment checklist

```
pip install -r requirements/production.txt
export DJANGO_SETTINGS_MODULE=config.settings.production
export DJANGO_SECRET_KEY=...            # required, no default
export DJANGO_ALLOWED_HOSTS=...         # required, no default
export CORS_ALLOWED_ORIGINS=...         # required, no default
export DATABASE_URL=...
export ASSET_STORAGE_BACKEND=r2         # + all R2_* variables
export PAYMENT_PROVIDER=paddle          # + all PADDLE_* variables
python manage.py migrate --noinput
python manage.py check --deploy        # optional extra Django self-audit
gunicorn config.wsgi:application
```
- **Health checks**: point liveness at `/api/v1/health/`, readiness
  (post-deploy / load-balancer target-health) at
  `/api/v1/health/ready/`.
- **Static files**: only Django admin's own assets currently need
  `STATIC_ROOT`/`collectstatic` — no business-facing static content
  exists (this is an API-only backend). Low priority; noted as a
  known limitation below rather than solved with an unrequested
  dependency (e.g. whitenoise).
- **Migrations**: run `migrate` before the app starts serving traffic,
  not as part of app-server boot — same as any Django deployment.
- **Failure behavior**: production refuses to *start* (fails at
  settings-load time, before serving a single request) if R2 or
  Paddle configuration is incomplete, or if either is set to its
  `mock` development value — see "Production settings loading" tests.
- **Behind a TLS-terminating reverse proxy** (any PaaS edge, and the
  nginx/Caddy a VPS would use): `SECURE_PROXY_SSL_HEADER` is set so
  `SECURE_SSL_REDIRECT` doesn't infinite-loop — the proxy terminates
  HTTPS and forwards to this app over plain HTTP internally, so
  without this Django would see every request as insecure and
  redirect it, including ones that already arrived over HTTPS at the
  edge. Verified live against a real gunicorn process (301 without
  the header, 200 with it, calling the app exactly as the proxy
  would). Trusting that header is only safe while the proxy is the sole
  path to the container and overwrites any client-supplied
  `X-Forwarded-Proto`; on a VPS that is a requirement on the proxy's
  configuration, not something this repo enforces.

**Railway (former host — no longer used; kept as a record)**: the root of
this repo has `requirements.txt` (`-r requirements/production.txt` —
Railpack's Python detection requires a *root-level*
`requirements.txt`/`pyproject.toml`/`Pipfile`; the existing
`requirements/` subdirectory alone isn't enough for Railpack to
recognize the project; the Dockerfile uses this same file, so it stays)
and `railpack.json`, which only Railway reads and which nothing in the
Docker build or the planned VPS uses. It pins the
exact start command (`python manage.py migrate --noinput && gunicorn
config.wsgi:application --bind 0.0.0.0:${PORT:-8000}`) rather than
relying on Railpack's own Django auto-detection. `config/wsgi.py` and
`config/asgi.py` now default `DJANGO_SETTINGS_MODULE` to
`config.settings.production` (not `development`) if the environment
variable is ever missing — `manage.py` still defaults to
`development`, correctly, since that's the local-developer-convenience
entrypoint, not the deployed one.

### Tests

334/334 passing (327 baseline + 7 new
`ProductionSettingsLoadingTests`) — `customers`: 8, `products`: 27,
`projects`: 24, `assets`: 34, `commerce`: 82, `common`: 12 (2 health +
3 rate-limiting + 7 production-settings), `delivery`: 147.
`makemigrations --check --dry-run` → no changes; this phase required
and produced zero migrations. Clean-slate `migrate` against an empty
PostgreSQL database re-verified: still exactly the same 8 approved
business tables.

### Known limitations

- Rate limiting is per-process (local-memory cache), not distributed
  across multiple app-server workers/instances — stated above, not
  hidden.
- Static file serving for Django admin assets isn't hardened with a
  dedicated static-file server/CDN — low priority for an API-only
  backend with no business-facing static content, not a launch
  blocker.
- Real Paddle Sandbox E2E remains explicitly deferred, per scope —
  this phase only audited the existing Paddle integration for
  production readiness (signature verification, idempotency, amount/
  currency reconciliation, order-locking, fail-closed behavior — all
  already verified correct in Phase 3.12/3.13) and did not attempt any
  new external validation.

## What's intentionally not here (Phase 3.1 boundary)

- Django models / migrations
- DRF serializers
- Business/resource API endpoints
- Authentication or guest sessions
- Object storage / upload handling
- Export job processing
- PayPal / payment integration

These are later phases, built against the already-approved database
schema (`customers`, `products`, `projects`, `assets`, `delivery_packs`,
`orders`, `payments`, `entitlements`).
