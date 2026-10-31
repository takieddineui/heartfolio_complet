# Deploying Heartfolio to the VPS

**Written:** 25 October 2026. This is the production guide.
`DEPLOYMENT-GUIDE-DOCKER.md` is the older Railway/Vercel record and local
Docker notes; where they disagree, this file wins.

Production is one VPS running `docker-compose.prod.yml`:

```
internet ──443/80──► caddy ──► web  (Next.js, port 3000)  ──► api (internal)
                          └──► api  (Django + gunicorn, port 8000)
                                 └──► Supabase (database), R2 (photos/audio),
                                      Freemius, Resend, Telegram
```

- **caddy** is the only container with published ports. It gets and renews
  Let's Encrypt certificates by itself, redirects HTTP to HTTPS, and proxies:
  - `SITE_HOST` (www.theheartfolio.com) to `web`;
  - `APEX_HOST` (theheartfolio.com), which only redirects to `SITE_HOST`;
  - `API_HOST` (api.theheartfolio.com) to `api`, for the Freemius webhook,
    Django admin and the ops screens.
- **web** reaches **api** over the internal Docker network
  (`http://api:8000`), both for the browser's `/api/backend/*` calls (rewritten
  by Next) and for its own server-side fetches.
- **api** runs production settings: DEBUG off, Freemius as the only payment
  provider, R2 storage required.

Who does what: every step below that touches the VPS, DNS, Freemius,
Supabase, Resend or real data is **yours**. Nothing here has been run
against real services; the stack was built and exercised locally against
the throwaway database (see the Phase 2 report).

---

## 1. One-time setup

1. **The VPS.** Ubuntu 24.04 or similar, at least 2 and preferably 4 vCPU,
   and 4 GB RAM (a heavy pack render has been measured above 512 MB per
   worker). Set `GUNICORN_WORKERS` to the core count (section 2), memory
   allowing: since 31 Oct 2026 every photo upload also makes three WebP web
   copies, and a checkout sends all its uploads at once. Graduation's worst
   case (15 photos, 5 drawings, 5 voice messages) took about 9 s of server
   time on 2 workers, against 4 s before the copies (measured locally, R2
   time not included). Install Docker Engine and the compose plugin.
   Firewall: allow only 22, 80 and 443.
2. **DNS.** Three `A` records (and `AAAA` if the VPS has IPv6) pointing at
   the VPS: `theheartfolio.com`, `www.theheartfolio.com`,
   `api.theheartfolio.com`. Caddy cannot get certificates until they resolve.
3. **The code.** Clone the repository to the VPS (for example
   `/opt/heartfolio`), with the `backend/` and `frontend-heartfolio/` folders
   side by side as in development.
4. **The environment.** `cp .env.production.example .env.production`, then
   fill it in (section 2). Never commit it; `.gitignore` already keeps it out.
5. **R2.** Set `X-Content-Type-Options: nosniff` on the bucket (see
   `DEPLOYMENT-GUIDE-DOCKER.md`, "Set X-Content-Type-Options").
6. **Legal pages.** In `frontend-heartfolio/src/lib/site-config.ts`, fill in
   `LEGAL_CONTROLLER` (legal name, postal address, country),
   `HOSTING_PROVIDER` and `LEGAL_LAST_UPDATED` (YYYY-MM-DD, the day the pages
   go live), then rebuild `web`. Until then the Terms, Refund and Privacy
   pages show bracketed placeholders.
7. **Freemius refund setting.** Set each product's refund policy in the
   Freemius dashboard to match the site's: no refunds after delivery except
   broken or not as described, requested within 14 days.
8. **Resend.** Verify `theheartfolio.com` in Resend (the DNS records its
   Domains page lists: SPF/MX on its `send` subdomain and the DKIM
   `resend._domainkey` TXT record; a DMARC record is recommended). Create the
   `support@theheartfolio.com` mailbox with your mail provider: receipts tell
   customers to reply, and replies go there.

## 2. Every variable

All in `.env.production`. "Build" means the value is baked into the `web`
image: changing it needs `up -d --build web`, not a restart.

### Hosts

| Variable | Set to | If wrong or unset |
|---|---|---|
| `SITE_HOST` | `www.theheartfolio.com` | Compose refuses to start |
| `APEX_HOST` | `theheartfolio.com` | Compose refuses to start |
| `API_HOST` | `api.theheartfolio.com` | Compose refuses to start |
| `ACME_EMAIL` | your address | Compose refuses to start; Let's Encrypt cannot warn you about certificates |
| `DJANGO_ALLOWED_HOSTS` | `api.theheartfolio.com,api` | `api` is the internal name the web container uses; without it every page that reads the catalog fails |
| `CORS_ALLOWED_ORIGINS` | `https://www.theheartfolio.com` | Settings refuse to load |
| `CSRF_TRUSTED_ORIGINS` | `https://www.theheartfolio.com,https://api.theheartfolio.com` | Defaults to the CORS list; the admin login on `API_HOST` then fails CSRF |
| `FRONTEND_URL` | `https://www.theheartfolio.com` | Defaults to that. **Every emailed link and printed QR code points here** |
| `BACKEND_PUBLIC_URL` | `https://api.theheartfolio.com` | The ops digest omits its links |

### Django

| Variable | Set to | Notes |
|---|---|---|
| `DJANGO_SECRET_KEY` | a long random string | Required |
| `DJANGO_SECURE_SSL_REDIRECT` | `false` | Caddy redirects public HTTP; Django's own redirect would bounce the web container's internal calls |
| `DJANGO_SECURE_HSTS_SECONDS` | unset (30 days) | HSTS is sent on HTTPS requests |
| `DJANGO_LOG_LEVEL` | `INFO` | |
| `DATABASE_URL` | Supabase **session-mode** pooler URL | Transaction mode is not supported (CLAUDE.md) |

### Payments: Freemius only

| Variable | Set to | Notes |
|---|---|---|
| `PAYMENT_PROVIDER` | unset | Defaults to `freemius` in production. `paddle` and `fastspring` still work if ever chosen, each requiring its own keys |
| `FREEMIUS_ENABLED` | `true` | With `PAYMENT_PROVIDER=freemius`, settings refuse to load without it |
| `FREEMIUS_LIVE_CONFIRMED` | `true` | Production settings refuse `FREEMIUS_ENABLED` without it. Live means: no sandbox mode offered at checkout, and sandbox licences refused |
| `FREEMIUS_PRODUCT_ID`, `FREEMIUS_API_TOKEN`, `FREEMIUS_SECRET_KEY`, `FREEMIUS_PUBLIC_KEY` | from Freemius, Settings → API & Keys | All four required |
| `NEXT_PUBLIC_FREEMIUS_ENABLED` (build) | `true` | The storefront opens the Freemius checkout |
| every `PADDLE_*`, `FASTSPRING_*` | unset | Their webhooks then reject every request |

### Storage, email, alerts

| Variable | Set to | Notes |
|---|---|---|
| `ASSET_STORAGE_BACKEND` | `r2` | `mock` is refused in production |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT_URL`, `R2_PUBLIC_BASE_URL` | from Cloudflare | The four credentials are checked at startup |
| `ASSET_BYTES_CACHE_MAX_MB` | `128` | Code default 64 overflowed at 8 photos |
| `RESEND_API_KEY` | from Resend | Unset: no receipts are sent (logged) |
| `RESEND_FROM_EMAIL` | `no-reply@theheartfolio.com` | The domain must be verified |
| `RESEND_REPLY_TO_EMAIL` | `support@theheartfolio.com` | Empty: no Reply-To |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | your bot and chat | Unset: no PAID or failure alerts |

### Frontend build args

| Variable | Set to | If unset |
|---|---|---|
| `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` | a Mapbox public token | Love Story Timeline's location search says it is unavailable |
| `NEXT_PUBLIC_GA_ID` | `G-…` | No Google Analytics. When set, GA loads only after a visitor accepts the cookie banner |
| `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | optional | Not loaded |

`docker-compose.prod.yml` fixes the rest of the web build:
`NEXT_PUBLIC_API_BASE_PATH=/api/backend` and `BACKEND_API_ORIGIN=http://api:8000`.

### Gunicorn and rate limits

| Variable | Default | Notes |
|---|---|---|
| `GUNICORN_WORKERS` | `2` | One per CPU core (2-4), and no more than about one per GB of free memory. Each sync worker serves one request at a time, and a photo upload is CPU work (upright, sRGB, three WebP copies: about 0.75 s for a 12 MP photo), so workers beyond the core count only queue |
| `GUNICORN_TIMEOUT` | `120` | Matches the web proxy's timeout, which is baked into the image. Raise both together or neither |
| `GUNICORN_MAX_REQUESTS` / `_JITTER` | `200` / `50` | Recycles workers so render caches cannot grow without bound |
| `THROTTLE_RATE_*` | production defaults | Listed, commented out, at the end of the example file. Browser requests are limited per visitor (Caddy's X-Forwarded-For, which a client cannot forge). The live page's first load is fetched by the Next server, which forwards the visitor's X-Forwarded-For since 26 Oct 2026 (before that, every recipient shared one identity). `THROTTLE_RATE_AR_ACCESS` stays at 1000/min until per-visitor identities are confirmed on this stack; size any tighter rate for many guests on one venue's Wi-Fi |

Development-only variables that must stay unset here:
`HEARTFOLIO_BACKEND_PATH`, `HEARTFOLIO_INTEGRATION_BASE`.

## 3. First deploy

```bash
cd /opt/heartfolio
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

The first build takes several minutes. Then, only if the database is new
(the existing Supabase database is already migrated and seeded):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec api python manage.py migrate
docker compose -f docker-compose.prod.yml --env-file .env.production exec api python manage.py createsuperuser
docker compose -f docker-compose.prod.yml --env-file .env.production exec api python seed_catalog.py
```

Migrations and seeding are never run automatically. Against an existing
database, run `migrate` after any release that adds migrations.

**Check it:**

```bash
curl -sI http://www.theheartfolio.com | head -3      # 308 to https://
curl -sI https://theheartfolio.com | head -3         # 301 to https://www.theheartfolio.com/
curl -s https://api.theheartfolio.com/api/v1/health/ready/   # {"status":"ok","database":"reachable"}
curl -s https://www.theheartfolio.com/api/backend/products | head -c 200
curl -s https://www.theheartfolio.com/robots.txt
```

Then open the storefront, a product page and a Studio in a browser, and
`https://api.theheartfolio.com/api/v1/ops/status/` with your staff login: it
says whether Supabase, R2 and the rest are reachable from the server.

**Verify the domain in Pinterest once theheartfolio.com is live.** Every page
already carries the verification tag (`<meta name="p:domain_verify">`, set by
the locale layout); check it with
`curl -s https://www.theheartfolio.com/en | grep -o 'p:domain_verify[^>]*'`,
then claim the site in Pinterest's settings.

## 4. Scheduled jobs

On the VPS host, `crontab -e` (adjust the path):

```
*/10 * * * *  cd /opt/heartfolio && docker compose -f docker-compose.prod.yml --env-file .env.production exec -T api python manage.py check_services
15 * * * *    cd /opt/heartfolio && docker compose -f docker-compose.prod.yml --env-file .env.production exec -T api python manage.py expire_freemius_staging
30 3 * * *    cd /opt/heartfolio && docker compose -f docker-compose.prod.yml --env-file .env.production exec -T api python manage.py expire_provisional_assets
0 8 * * *     cd /opt/heartfolio && docker compose -f docker-compose.prod.yml --env-file .env.production exec -T api python manage.py send_digest --period=daily
45 3 * * *    cd /opt/heartfolio && docker compose -f docker-compose.prod.yml --env-file .env.production exec -T api python manage.py cleanup_inactive_drafts --execute
```

`expire_provisional_assets` is the only thing that deletes unpaid voice
notes and videos; run it once with `--dry-run` first. `check_services` and
`send_digest` alert through Telegram.

`cleanup_inactive_drafts` keeps the privacy policy's promise: unbought drafts
not saved for 12 months are deleted, with their uploads (from R2 as well as
the database). Before adding the cron line, run it once by hand without
`--execute`: that is a dry run listing what would go.

- **It never touches** anything linked to an order (paid or not), a draft with
  an open or completed Freemius checkout, uploads another kept project uses,
  or uploads that belong to no project (it only counts those).
- **Safety caps.** It refuses a window shorter than 12 months. If more than
  200 drafts qualify at once, it deletes nothing and sends a Telegram alert
  (`--max-drafts` raises the cap after you have checked the dry run).
- **R2 failures.** An upload R2 cannot delete keeps its draft for the next run.

## 5. Freemius: sandbox to live

Until this section is done, sandbox checkouts are run on local Docker, never
on the VPS (production settings only run Freemius live).

Already done in the code (Phase 2):

- Production starts with Freemius alone; Paddle and FastSpring need no keys.
- The PAID alert names the licence's own environment ("live" or "sandbox"),
  instead of always saying "sandbox".
- With `FREEMIUS_LIVE_CONFIRMED=true`, order completion refuses any licence
  that Freemius does not mark as production (`environment` 0). This covers
  sandbox licences and licences that don't say. The same check covers the
  checkout and the webhook safety net.

Yours, in order:

1. **Freemius account.** Confirm in the dashboard that the account is
   approved for live payments (production settings call it "provisionally
   accepted pending review").
2. **Plans.** Plan ids belong to the product, and sandbox is a checkout mode
   of the same product, so the ids should not change. Confirm in the
   dashboard that each mapped plan exists, is one-off with a single price
   point, and has the price the seed sells:

   | Plan | Product : pack | Price |
   |---|---|---|
   | 70517 | love-story-timeline : printable | $22.99 |
   | 69404 | love-story-timeline : live | $15.99 |
   | 70543 | love-story-timeline : printable-plus-digital | $35.99 |
   | 70518 | love-story-timeline : complete (disabled; past orders only) | — |
   | 71990 | reasons-i-love-you : live | $15.99 |
   | 72194 | graduation-keepsake : live | $15.99 |
   | 73260 | song-poster : printable | $22.99 |
   | 73263 | song-poster : live | $15.99 |
   | 73264 | song-poster : printable-plus-digital | $35.99 |

3. **Keys.** Product id, public key, secret key and an API token into
   `.env.production`. Sandbox and live use the same keys.
4. **Webhook.** In Freemius, add
   `https://api.theheartfolio.com/api/v1/webhooks/freemius/` for the
   `payment.created` and `license.created` events. It is verified with the
   secret key.
5. **Environment.** `FREEMIUS_ENABLED=true`, `FREEMIUS_LIVE_CONFIRMED=true`,
   `NEXT_PUBLIC_FREEMIUS_ENABLED=true`, then
   `up -d --build web api`.
6. **One real purchase** of the cheapest pack, with your own card. Check:
   - the order page opens and downloads work;
   - the receipt arrives, and replying reaches support@;
   - the Telegram alert reads "PAID (Freemius, live)";
   - the api log has no `freemius_non_production_license_refused`. If it
     does, Freemius did not mark the licence as production: stop and tell me.
7. **Refund it** in the Freemius dashboard.
8. **Remove the test orders** (section 6).
9. **Move the uploads to the new storage layout** (section 7), once, from
   the VPS, after the development and production databases are separated.

## 6. Removing test orders

Before launch every order in the database is a test. Two commands, both
yours to run; Claude never runs them against Supabase.

```bash
# 1. List. Read-only (it runs in a READ ONLY transaction). Writes the
#    selected ids to a file inside the container.
docker compose -f docker-compose.prod.yml --env-file .env.production exec api \
  python manage.py list_test_orders --check-freemius --ids-out /tmp/test-order-ids.txt

# 2. Dry run: shows what would be deleted, deletes nothing.
docker compose -f docker-compose.prod.yml --env-file .env.production exec api \
  python manage.py cleanup_test_orders --ids-file /tmp/test-order-ids.txt --check-freemius

# 3. Delete, giving the count the dry run showed.
docker compose -f docker-compose.prod.yml --env-file .env.production exec api \
  python manage.py cleanup_test_orders --ids-file /tmp/test-order-ids.txt --check-freemius --execute --confirm <N>
```

- **What the listing selects:**
  - mock, Paddle and FastSpring orders (none ever ran live);
  - Freemius orders whose licence Freemius marks as sandbox;
  - orders never paid.
- **What is never selected:**
  - a live Freemius licence;
  - one that can't be read;
  - a Freemius order when `--check-freemius` is not given.
- **The cleanup re-checks every id.** If any one is no longer a test order,
  it deletes nothing.
- **What deleting an order removes:** its payments, entitlements and live/AR
  links. Feedback and checkout records stay, unlinked. Projects, customers
  and photos are not touched.
- **When to run it:** after the live test purchase in section 5 is refunded.
  Take a Supabase backup first.

## 7. Moving uploads to the new storage layout and making their web copies (once, before launch)

Uploads stored before 27 Oct 2026 sit at `assets/<id>/<customer's
filename>`, and every photo link a recipient's page loads carries that key,
so the filename shows. New uploads already go to
`uploads/<product>/<id>.<ext>`. `move_assets_to_new_layout` moves the old
ones, clears the stored filenames, and strips filenames from saved projects
(without touching their `updated_at`, which the 12-month draft cleanup
reads). Nothing that reads uploads changes: each file is served from its old
key until the moment its row points at the new one.

Right after it, `make_web_copies` gives every photo stored before 31 Oct 2026
the small WebP copies the live pages now download (480, 960 and 1600 px
wide, about 90 KB on a phone instead of the 3-4 MB photo). New uploads get
theirs at upload. Until it runs, those older photos are served whole, as
before; nothing breaks. It never rewrites a stored photo.

**Where:** on the VPS, against production, and only AFTER the development
and production databases are separated. Never from local Docker: there,
`docker compose exec api` reads `.env.docker`, and that has pointed at the
same Supabase database. Yours to run; Claude never runs it against real data.

In this order:

1. **Back up the database** (Supabase dashboard, or `pg_dump`). The R2
   bucket needs no backup: the move copies, never deletes, until step 7,
   and the web copies are new objects only.
2. **Apply the migrations** on `assets`: `0002` adds the move's bookkeeping
   (two nullable columns), `0003` a photo's size and the list of its web
   copies (`web_widths`, which has a database default, so the order of this
   step and a code deploy does not matter):

   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production exec api python manage.py migrate assets 0003
   ```

3. **Dry run.** Changes nothing; prints counts and asset ids, never a key or
   a filename:

   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production exec api python manage.py move_assets_to_new_layout
   ```

4. **Review it:** the files to move per product folder (`unknown` is a file
   no project references), the asset rows with a filename, the projects
   with filenames. A trial on a few files first is possible with
   `--execute --limit 5`.
5. **Execute:**

   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production exec api python manage.py move_assets_to_new_layout --execute
   ```

   Each file is copied, its size checked, and its row switched under a lock;
   a file deleted meanwhile is left alone and its copy removed. Warnings
   (a storage error, a row with no object) leave those files where they
   were; running it again retries them.
6. **Make the web copies**, right after step 5 (it only handles photos
   already under `uploads/`, and says how many it skipped if any are still
   under an old key). Dry run first, then execute:

   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production exec api python manage.py make_web_copies
   docker compose -f docker-compose.prod.yml --env-file .env.production exec api python manage.py make_web_copies --execute
   ```

   It reads each photo, writes its copies beside it and records them; a
   photo deleted meanwhile keeps none, and one whose copies could not all be
   stored is reported and retried by the next run. Safe to re-run; `--limit 5`
   for a trial. It reports "Made web copies for N photo(s)": N should equal
   the dry run's count.
7. **24 hours after step 5, execute the move again.** This deletes the old
   objects (kept that long for pages already open: their five-minute links
   point at the old keys). It reports "Deleted N old object(s)": N should
   equal the files moved in step 5. Run it again if it reports any it could
   not delete.

## 8. Updating and rolling back

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production exec api python manage.py migrate   # if the release adds migrations
```

Rebuild `web` whenever a `NEXT_PUBLIC_*` value changes. To roll back,
check out the previous commit and run the same `up -d --build`. Migrations in
this project are additive, so the previous image runs against the migrated
schema; do not roll the database back.

Logs: `docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api`
(also `web`, `caddy`). Each container keeps at most 5 × 10 MB of logs.
