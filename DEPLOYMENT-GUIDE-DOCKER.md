# Deploying and updating Heartfolio

> **Hosting status (updated):** Railway and Vercel are **no longer used**.
> Development is local Docker (§2). Production is planned as a **VPS running
> this same Docker setup**; the database for the VPS is still undecided.
>
> This guide was written on 3 September 2026 for the Railway/Vercel
> deployment. §3 and §4 are kept as a **record of what each deploy needed**
> (environment variables, migration order, seeding, verification), not as
> instructions for the VPS — that procedure has not been written yet and
> should be derived from them, not copy-pasted. Everything else is
> host-independent except where it names a host.

**Written:** 3 September 2026
**Read alongside:** `docs/DEPLOYMENT-GUIDE.md`, which covers the original
Railway/Vercel setup (that hosting is gone — see the status note above; its
environment-variable and settings guidance still applies). This document adds Docker (which
did not exist), and covers everything that changed during this work —
new environment variables, new migrations, new dependencies, a scheduled
job, and one API response shape change that affects deploy order.

**I could not execute any of this.** No credentials, no network access to
the hosts it was written against (then Railway and Vercel), Cloudflare or
Paddle, and no Postgres. Every command below
is written from the code; the execution is yours.

---

## 0. The two things that will bite you

**`DJANGO_SETTINGS_MODULE=config.settings.production` in production.** This
is from the existing guide and has not changed. `wsgi.py` defaults to
production while `manage.py` defaults to development, so without it
`collectstatic` and gunicorn disagree about static storage and *every Django
admin page returns 500* — which is where you enter the catalog. The
Dockerfile sets it, so a Docker deployment (local, or the planned VPS)
already has it; a source-based PaaS deploy would need it set manually.

**Deploy the backend before the frontend, this once.** `GET /products/`
changed from returning a bare array to an object carrying occasions and
print sizes (§7d). The frontend accepts **both** shapes deliberately, so
either order works — but backend-first means the new fields are live the
moment the frontend can use them. That tolerance can be removed later; it is
marked in `src/lib/products/catalog-server.ts`.

---

## 1. What changed since the last deploy

### New migrations — 6 of them

```
commerce/0003_order_locale          §12  Order.locale
commerce/0004_order_buyer_country   §7a  Order.buyer_country
products/0002_occasion_printsize    §7d  Occasion, PrintSize
delivery/0001_initial               §21  ARExperience
feedback/0001_initial               §7c  Feedback
feedback/0002_alter_feedback_rating §7c  rating made nullable
common/0002_initial                 §9   ServiceAlertState
```

All additive. Nothing drops a column or rewrites data, so a rollback to the
previous image works against the migrated schema.

### New dependencies

`reportlab` and `qrcode[pil]`, both in `requirements/base.txt` with the
reasoning inline. A Docker build picks them up from the same file.

### New environment variables

None are required — every one has a default and the system runs without
them. What each does when unset:

| Variable | Default | Unset behaviour |
|---|---|---|
| `RESEND_API_KEY` | `""` | **No receipt emails are sent.** Logged, not silent. |
| `RESEND_FROM_EMAIL` | `orders@theheartfolio.com` | Used as-is |
| `RESEND_REPLY_TO_EMAIL` | `support@theheartfolio.com` | Where replies to the receipt go (the support inbox the site shows) |
| `FRONTEND_URL` | production URL | Magic links and QR codes point here — **wrong value means broken links in printed material** |
| `TELEGRAM_BOT_TOKEN` / `_CHAT_ID` | `""` | No alerts. The scheduled job says so out loud. |
| `ORDER_ACCESS_TOKEN_MAX_AGE_DAYS` | `30` | Emailed order links expire after this |
| `SUPPORTED_LOCALES` | `en,fr,ar` | Constrains what `Order.locale` accepts |
| `DEFAULT_LOCALE` | `en` | |
| `MAX_PROJECT_DATA_KB` | `256` | Ceiling on a saved project |
| `THROTTLE_RATE_FEEDBACK_CREATE` | `1000/min` | **Tighten in production** — unauthenticated endpoint |
| `THROTTLE_RATE_AR_ACCESS` | `1000/min` | **Tighten in production** |

`FRONTEND_URL` is the one to get right first. It is baked into every emailed
link and every QR code, and a QR printed with the wrong host cannot be
recalled.

### New frontend environment variables

| Variable | Purpose | Unset behaviour |
|---|---|---|
| `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | Cookieless analytics, e.g. `theheartfolio.com` | Not loaded — no analytics at all |
| `NEXT_PUBLIC_GA_ID` | GA4, e.g. `G-XXXXXXX` | Not loaded, and the consent banner still appears |

Both are `NEXT_PUBLIC_*`, so they are **inlined at build time**. Setting them
requires a rebuild to take effect, not just a restart.

GA4 loads only after a visitor explicitly accepts. Plausible loads always,
because it sets no cookies and identifies nobody.

### ffmpeg is now a system dependency (§5)

Video and audio uploads need `ffprobe` to validate and `ffmpeg` to re-encode
audio. The backend Dockerfile installs it. **A source-based PaaS deploy does
not include it by default** — if you ever deploy from source rather than from
the Dockerfile, it has to be added to the build, or every media upload fails with "Media
uploads are not available on this server."

### ⚠️ Set `X-Content-Type-Options: nosniff` on the asset bucket

**This is a deployment step, not something the code can do.**

Video is stored as the customer uploaded it (probe-only, by decision), so
unlike images the bytes are not rewritten. The mitigation that matters is
stopping a browser second-guessing the stored content type and deciding a
file we serve as `video/mp4` is really HTML — content sniffing is exactly
how a stored file becomes a script on someone else's device.

The header must be set on the R2 bucket or the CDN in front of it. It cannot
be set from Django: assets are fetched directly from the bucket's public
URL, and S3-style custom metadata is returned as `x-amz-meta-*`, which no
browser reads as a security header.

Assets are already served from R2's own domain rather than the app's, which
is the other half of this — a malicious file cannot reach anything of yours.

### ⚠️ The shared AR target must be compiled once, by hand

`frontend-heartfolio/public/ar/targets/heartfolio-card.mind` **does not
exist in the repository.** Until it does, a shared-target AR card loads the
scene and never finds anything to track — it fails quietly, which is the
worst way for it to fail.

It is a one-time build step, not something the server does: the shared
card's artwork is identical for every customer, so compiling it per request
would repeat the same work forever. `tools/compile-shared-target/README.md`
has the three commands.

It needs Cairo and Pango to build `node-canvas`, which is why it is a local
step rather than part of the Docker image — adding Node, node-canvas and
TensorFlow.js to a Python image would be roughly half a gigabyte and a
second runtime for a file that never changes.

**Re-run it whenever `generic_card.py` changes.** A target compiled from an
older design will not track the card that is actually printed.

Per-order cards are unaffected: their targets are compiled in the buyer's
browser at checkout and stored against the experience.

### New scheduled job

```
python manage.py check_services
```

Runs the health checks and sends a Telegram alert when a service *changes*
state. Every 5–15 minutes is sensible. `--no-alerts` runs the checks and
prints without sending — use that first.

### Another new scheduled job — §7's media expiry sweep

```
python manage.py expire_provisional_assets
```

Deletes video/audio uploads that were never promoted by a paid order past
`MEDIA_PROVISIONAL_RETENTION_DAYS` (default 7). **This is the entire
enforcement mechanism for §7's deferred-media-storage design** — without
this running, provisional assets simply accumulate forever and the whole
cost-control reasoning behind the design does nothing. Once daily is
plenty, given a multi-day window. Run with `--dry-run` first to see what
it would delete without deleting anything.

Photos are never affected — they have no `expires_at` to begin with.

---

## 2. Docker, step by step

Docker is how you run the whole system locally and, as planned, how
production will run on a VPS (Railway and Vercel are no longer used). The
reason running it locally matters is that several things have never been
executed: the database-backed tests, the seed
script, §8 reconciliation, and the AR flow.

### 2.1 One-time setup

```bash
cd /path/to/heartfolio          # the parent holding backend/ and frontend-heartfolio/
cp .env.docker.example .env.docker
```

Edit `.env.docker`. For local work the minimum is:

```bash
DJANGO_SECRET_KEY=any-long-random-string-for-local-use
FRONTEND_URL=http://localhost:3000
PADDLE_ENVIRONMENT=sandbox
PADDLE_API_KEY=              # fill in to exercise §8
RESEND_API_KEY=              # leave blank; emails are skipped and logged
TELEGRAM_BOT_TOKEN=          # leave blank; alerts are skipped
```

`DATABASE_URL` is set by compose and should not be in this file.

### 2.2 Build and start

```bash
docker compose up --build
```

First build takes a few minutes — Pillow and reportlab compile. Postgres
starts first and the API waits for its healthcheck, because Postgres accepts
connections several seconds after the process starts and migrating too early
fails confusingly.

### 2.3 Create the schema and a login

```bash
docker compose exec api python manage.py migrate
docker compose exec api python manage.py createsuperuser
```

### 2.4 Seed the catalog

```bash
docker compose exec api python seed_catalog.py
```

**This has never been run.** It creates products, packs, occasions and print
sizes, and validates that every target in every pack is one a renderer can
actually produce. Read its output — a validation failure there is a real
finding, not noise.

It will **not** overwrite prices on a re-run. To push the prices in the file
into the database deliberately:

```bash
docker compose exec api python seed_catalog.py --update-prices
```

### 2.5 Run the tests that have never run

This is the highest-value thing in this document.

```bash
docker compose exec api python manage.py test
```

Roughly 40 database-backed tests have never executed, including §7a's
analytics aggregations — the ones that would catch a wrong `Sum` or a bad
join in the revenue figures you would otherwise trust.

### 2.6 Reach it

- Storefront — http://localhost:3000
- Django admin — http://localhost:8000/admin/
- Ops screens — http://localhost:8000/api/v1/ops/status/

### 2.7 Rebuilding after a change

```bash
docker compose up --build api      # backend change
docker compose up --build web      # frontend change
```

The frontend genuinely needs a rebuild rather than a restart:
`NEXT_PUBLIC_*` values are inlined into the client bundle at build time.

---

## 3. Updating the backend

> **Record, not instructions.** This was the Railway procedure. The VPS
> equivalent is not written yet; the order of operations below is what it
> must preserve. Anything that writes to a database writes to whichever
> `DATABASE_URL` the api container holds — with the real `.env.docker` that is
> the real Supabase database, so treat it as a production write.

The update is:

1. **Get the new image running.** On Railway this meant pushing to the branch
   it watched. How the VPS gets a new build (pull and
   `docker compose up --build api`, or CI) is not decided.
2. **Set any new environment variables** from §1 *before* the deploy that
   needs them, so the deploy needs only one restart.
3. **Run the migrations.** The Dockerfile does not run them on boot. Run:
   ```bash
   docker compose exec api python manage.py migrate
   ```
4. **Seed the new catalog entities** — occasions and print sizes are new
   tables and start empty:
   ```bash
   docker compose exec api python seed_catalog.py
   ```
   Without this the storefront shows no occasions, because §11 correctly
   renders nothing rather than inventing them.
5. **Add the scheduled job** for `check_services` if you want §9's alerts.

**Verify after deploying**, in this order:

```bash
curl -s https://<your-api>/api/v1/health/ready/          # should be 200
curl -s https://<your-api>/api/v1/products/ | head -c 300   # object, not array
```

Then open `/api/v1/ops/status/` in a browser — it needs a staff login and
tells you in one glance whether Supabase, R2, Paddle and the frontend are
reachable *from the backend*, which is a different question from whether
they are reachable from your laptop.

---

## 4. Updating the frontend

> **Record, not instructions.** This was the Vercel procedure; the VPS
> equivalent is not written yet.

1. **Get the new build running.** On Vercel this meant pushing to the branch
   it watched; for the VPS, rebuild the `web` image
   (`docker compose up --build web`).
2. **Check `NEXT_PUBLIC_API_BASE_URL`** points at the backend API including
   `/api/v1`.
3. Nothing else changed on the frontend side. No new frontend dependencies, no
   new build settings — `output: "standalone"` is gated behind
   `DOCKER_BUILD=1` specifically so a non-Docker build (Vercel's) is
   unchanged; Docker builds set it.

**Verify after deploying:**

```bash
curl -s https://<your-site>/sitemap.xml | grep -c "<url>"
curl -s https://<your-site>/robots.txt
curl -s https://<your-site>/en/product-feed.xml | head -c 300
```

The sitemap should list only `love-story-timeline` among products, plus
`/gifts/printable-gifts`. `robots.txt` should disallow `/create`, `/studio`,
`/project` and `/orders` across all three locales.

---

## 5. After deploying — things only you can do

In rough dependency order:

1. **Run the database-backed tests** (§2.5). Nothing else on this list is
   worth doing if those fail.
2. **Run the seed script** and read its validation output.
3. **Set prices.** Two packs grew during this work without their numbers
   moving: Printable went from 1 file to 6, Complete from 6 to 10.
4. **Create the AR pack** if you want §21 sellable — a pack on Love Story
   Timeline containing `ar-card` and/or `ar-screen`. The admin will accept
   them now; it would have refused before.
5. **Get the 108 French and Arabic strings reviewed**
   (`TRANSLATION-REVIEW-FR-AR.md`).
6. **Produce `ogImage`** — the Merchant Center feed cannot pass review
   without real product imagery, and the OG card is a branded graphic which
   their policy rejects.
7. **Test the wallpaper safe zones on a real phone.** The numbers are
   reasoned, not measured.
8. **Design the §18a thank-you card** and the AR card artwork. The AR scene
   cannot track anything until a `.mind` target exists, which is compiled
   from that artwork.
9. **Add a Paddle sandbox key** and run one real reconciliation through
   `/api/v1/ops/reconcile/`.
10. **Tighten the two throttle rates** before real traffic.

---

## 6. Rolling back

Every migration in this release is additive, so the previous image runs
against the migrated schema without complaint. Roll back the deploy; do not
roll back the database.

The one exception to watch: if you have already created an AR pack, rolling
back to an image without §21 leaves orders whose `included_targets` name
`ar-card`, which the older code will not recognise at download time. Remove
the pack before rolling back, not after.
