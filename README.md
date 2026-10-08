# Heartfolio

A personalized digital-keepsake platform. A customer builds a "story" —
names, milestones, photos, an optional video or voice note per milestone —
in a browser-based editor (the "Studio"), then buys a delivery pack that
determines what they actually receive: a print-ready file, phone/desktop
wallpapers, an interactive digital page, or a bundle of all three.

**Live product:** Love Story Timeline — a relationship's milestones,
rendered as one continuous visual story. This is the only product with a
finished renderer, a finished commerce flow, and real pricing. A second
product, "Where We Met" (`heart-map`), exists in the catalog with a working
renderer but has had none of the later UX/architecture passes applied to
it — treat it as present-but-unmaintained unless told otherwise.

## Stack

- **Frontend:** Next.js 15 (App Router)
- **Backend:** Django 5 + Django REST Framework
- **Hosting:** local Docker for development; production is planned as a VPS
  running the same Docker setup. Railway and Vercel are no longer used.
- **Database:** PostgreSQL (Supabase today; the database for the VPS is undecided)
- **File storage:** Cloudflare R2 (customer uploads and rendered outputs)
- **Payments:** Paddle Billing (mock provider available for local dev)
- **Email:** Resend (transactional order emails)
- **Location search:** Mapbox Geocoding API (client-side)
- **No accounts.** Identity is a guest session cookie plus an optional
  emailed magic-link token for cross-device order access.

## Read the docs in this order

0. **`CLAUDE.md`** — the traps. Things that are true about this project but
   not visible from any single file: the two-repo layout, the Supabase
   pooler, and a handful of mistakes that have
   each cost hours. Claude Code reads it automatically; read it yourself
   before touching deployment, the order token, or the test suite.

1. **`PROJECT-STATE.md`** — what's built, what's tested, what's explicitly
   NOT done, and every open item that needs something only a human can
   supply (a database, a browser, a phone, an account, a decision).
   **Start here.** This supersedes the old `IMPLEMENTATION-STATUS.md`,
   which was last updated August 31st and is stale against nearly
   everything below.
2. **`PRODUCT-CATALOG.md`** — the Love Story Timeline product itself:
   every input field, the six visual compositions, the five sellable
   packs and exactly what each includes, and the commerce architecture
   (one order, one pack, no line items).
3. **`ENVIRONMENT-VARIABLES.md`** — every environment variable across both
   apps, what it does, and what breaks if it's missing.
4. **`ADMIN-AND-DASHBOARD.md`** — the Django admin and the staff-only ops
   screens (order lookup, Paddle reconciliation, revenue reports).
5. **`DATABASE-SEEDING.md`** — how to bring a database, fresh or existing,
   to the correct catalog state.
6. **`TESTING-RUNBOOK.md`** — manual verification checklist, organized by
   feature, written for someone with zero context on this conversation.
7. **`DEPLOYMENT-GUIDE-DOCKER.md`** — running the whole stack locally with
   Docker, and what differs in production.
8. **`AR-VR-SCOPING.md`** — the AR feature's research and open questions.
   AR is deliberately unbuilt beyond this — no `DeliveryPack` row for it
   exists, and it should not be treated as close to shippable.

## Non-negotiable architecture rules

These have held throughout the whole build and should not be relaxed
without a very good reason:

- **Only the Paddle webhook marks an order paid.** No endpoint lets a
  client mark an order paid or supply a price — the amount is always
  computed server-side from `DeliveryPack.price_cents`.
- **One `Order` has exactly one `DeliveryPack`.** There is no line-item
  concept. A checkbox that looks like "add wallpapers" actually swaps
  which pack is selected, never adds a second one.
- **The database is the only source of truth for prices.** Nothing is
  hardcoded in frontend or backend application code.
- **Deliverables are rendered on demand, never persisted** (except
  provisional video/audio uploads, which are deliberately temporary —
  see `PROJECT-STATE.md` §7).
- **Guest identity, not accounts.** A session cookie plus, for order
  status/downloads from a different device, a signed, order-scoped,
  time-limited token that travels as a URL path segment (not a query
  string — see `PROJECT-STATE.md` for why that changed).

## Code layout

```
backend/                  Django API          (repo: heartfolio-backend)
frontend-heartfolio/      Next.js storefront  (separate repo)
tools/                    One-time build scripts (the shared AR target)
docker-compose.yml        Postgres + API + web, for local development
.env.docker.example       Template for the local stack
```

**These are two separate git repositories**, cloned side by side under one
parent directory. The layout above is what `docker-compose.yml` resolves
its build contexts against, and what the renderer parity test expects when
it reaches across into the Python renderer.

This used to be documented as `backend/backend/` and `frontend/heartfolio/`
— a nested monorepo that no longer exists. That stale description was not
harmless: it broke `docker compose up` (wrong build contexts), it broke the
composition-parity test (it read a path two levels too high and failed with
ENOENT before a single assertion ran), and it cost real time on both. If
your checkout differs, set `HEARTFOLIO_BACKEND_PATH` for the parity test
rather than editing paths.
