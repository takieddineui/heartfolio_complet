# Step 12B — Deployment & External Configuration Spec

> **Hosting status (updated):** this spec was written for Railway (backend) and
> Vercel (frontend), **neither of which is used any more**. Development is local
> Docker; production is planned as a **VPS running the same Docker setup**, and
> the database for the VPS is undecided. The variable names, required values and
> verification checks below still apply to any host; the Railway/Vercel-specific
> parts (URLs, `railway run`, "injected automatically", dashboard references)
> are kept as a record and must be translated for the VPS. See
> `DEPLOYMENT-GUIDE-DOCKER.md` for the Docker side.

Everything here is derived from the current code, not from the earlier
runbook. Where the two disagree, this document is correct.

**I could not execute any of this.** No credentials, no network egress to
the hosts it was written against (then Railway and Vercel), Cloudflare or Paddle. This is the specification and the
verification commands; the execution is yours.

---

## 0. THE ONE THING THAT WILL BREAK THE DEPLOY

**Set `DJANGO_SETTINGS_MODULE=config.settings.production` in production.**

This is not a nicety. I reproduced the failure locally:

- `config/wsgi.py` defaults to **production** — so gunicorn serves production settings.
- `manage.py` defaults to **development** — and the start command is
  `python manage.py migrate && python manage.py collectstatic && gunicorn …`

So without that variable, `collectstatic` runs under *development* settings
and writes plain static files with **no manifest**, while gunicorn serves
under *production*, which uses `CompressedManifestStaticFilesStorage` and
**requires** that manifest. Result:

```
ValueError: Missing staticfiles manifest entry for 'admin/css/base.css'
```

Every Django admin page returns 500 — which is exactly how you were going to
enter the catalog. With the variable set, `collectstatic` post-processes 777
files, writes `staticfiles.json`, and the admin resolves
`/static/admin/css/base.96c479cedf7a.css` correctly. Verified both ways.

`migrate` has the same settings split; it reads `DATABASE_URL` from the
environment either way, so it is less dangerous, but it should run under
production settings for the same reason.

**Fix is configuration only. No code change needed.**

---

## 1. Backend environment

Production **hard-fails at settings load** if R2 or Paddle config is missing
or set to `mock` — it will not boot half-configured. That is intended.

### Required

| Variable | Value | Notes |
|---|---|---|
| `DJANGO_SETTINGS_MODULE` | `config.settings.production` | **See §0** |
| `DJANGO_SECRET_KEY` | long random ≥50 chars | The only variable with no default at all. `check --deploy` warns if short |
| `DATABASE_URL` | A Postgres URL | Railway injected it automatically; on the VPS set it explicitly (database undecided) |
| `DJANGO_ALLOWED_HOSTS` | the backend's public hostname (was `heartfolio-backend-production.up.railway.app`) | Plus any custom domain |
| `CORS_ALLOWED_ORIGINS` | the frontend's origin(s) | Comma-separated, scheme included, no trailing slash |
| `CSRF_TRUSTED_ORIGINS` | same as above | Needed even behind the proxy — the browser's `Origin` is forwarded |
| `ASSET_STORAGE_BACKEND` | `r2` | `mock` raises in production |
| `R2_ACCESS_KEY_ID` | secret | |
| `R2_SECRET_ACCESS_KEY` | secret | |
| `R2_BUCKET_NAME` | bucket | |
| `R2_ENDPOINT_URL` | `https://<account>.r2.cloudflarestorage.com` | Enforced present |
| `PAYMENT_PROVIDER` | `paddle` | `mock` raises in production |
| `PADDLE_API_KEY` | secret | Server-side only |
| `PADDLE_CLIENT_TOKEN` | public token | Reaches the browser only via `/pay/` |
| `PADDLE_WEBHOOK_SECRET` | secret | Per-destination — see §5 |
| `PADDLE_ENVIRONMENT` | `sandbox` | |

### Optional (sane defaults in code)

`R2_ACCOUNT_ID`, `R2_PUBLIC_BASE_URL`, `R2_PRESIGNED_URL_EXPIRY_SECONDS`
(300), `MAX_ASSET_SIZE_MB` (10), `DJANGO_LOG_LEVEL`, `HEARTFOLIO_LOG_LEVEL`,
`DJANGO_SESSION_COOKIE_AGE`, `DJANGO_SESSION_COOKIE_SAMESITE`,
`DJANGO_CSRF_COOKIE_SAMESITE`, `DJANGO_SECURE_SSL_REDIRECT`,
`DJANGO_SECURE_HSTS_SECONDS`, `THROTTLE_RATE_*` (4).

**Do not** set `DJANGO_SESSION_COOKIE_SAMESITE=None`. The same-origin proxy
makes the cookie first-party; `Lax` is correct and stronger.

### Verify after deploy

```
curl https://<backend-host>/api/v1/health/
curl https://<backend-host>/api/v1/health/ready/
```

Then confirm `/admin/` renders **styled**. Unstyled or 500 means §0.

---

## 2. Database & catalog

Migrations are clean — `makemigrations --check` reports no changes, and the
Step 12 delivery endpoint added none.

Enter the **9 rows** from `CATALOG-data-sheet.md` — 2 products, 7 packs.
Nothing in this step invents prices; the sheet is the source.

Verify:

```
curl https://…/api/v1/products/
curl https://…/api/v1/products/love-story-timeline/
curl https://…/api/v1/products/heart-map/
```

- Both products `available`
- Love Story Timeline: printable $18, wallpaper $8, live $12, complete $30
- Where We Met: printable $18, wallpaper $8, complete $24
- **No** `live` pack and **no** `landscape-png` on Where We Met
- Star Map and Song Poster absent entirely — they have no rows, which is
  what keeps them inert

Pricing stays server-authoritative: the order endpoint accepts no price
field, so the catalog is the only place an amount can come from.

---

## 3. R2

Run the probe (also in the status doc):

```
docker compose exec api python manage.py shell -c "
from apps.assets.storage import get_asset_storage
from django.conf import settings
import io
s = get_asset_storage()
print('backend:', type(s).__name__, '| bucket:', settings.R2_BUCKET_NAME)
s.upload('assets/_verify/probe.txt', io.BytesIO(b'heartfolio-r2-probe'), content_type='text/plain')
print('download:', s.download('assets/_verify/probe.txt'))
print('url:', s.generate_access_url('assets/_verify/probe.txt')[:80])
s.delete('assets/_verify/probe.txt'); print('deleted OK')
"
```

Must print `R2Storage`. Printing `MockAssetStorage` is impossible in
production (settings raise), so a failure here means credentials or bucket.

**Architecture unchanged and must stay unchanged:** R2 holds customer input
photos only. Rendered deliverables are produced on demand and streamed;
neither the PNGs nor the ZIP are written to R2.

---

## 4. Frontend

| Variable | Value | Notes |
|---|---|---|
| `BACKEND_API_ORIGIN` | `https://<backend-host>` | **Server-side only.** Not `NEXT_PUBLIC_` — the browser must never call the backend directly |
| `NEXT_PUBLIC_PADDLE_ENVIRONMENT` | `sandbox` | Defaults to sandbox if unset |
| `SUPABASE_URL` | waitlist | Server-side |
| `SUPABASE_SERVICE_ROLE_KEY` | waitlist | Server-side. **Rotate** — it shipped in the original ZIP |

Do **not** set `NEXT_PUBLIC_MAPBOX_TOKEN` — dead config, and rotate that
token too.

There is no Paddle client token variable on the frontend: it arrives in the
`/pay/` response, which is why sandbox→production is a backend switch.

### The check that matters most

On the deployed site, open DevTools → Application → Cookies after touching
the Studio. `sessionid` and `csrftoken` must be on **the frontend's domain**,
not the backend's. If they appear on the backend's domain, the proxy is not in
use and guest identity will fail silently for Safari and Firefox users while
working in Chrome.

---

## 5. Paddle Sandbox

- Destination URL:
  `https://<backend-host>/api/v1/webhooks/paddle/`
  **The trailing slash matters.**
- Subscribe to **`transaction.paid`**. Others may be subscribed; only this
  one grants fulfilment.
- Copy the secret **from this destination** — Paddle issues a different one
  per destination, and a mismatched secret is the most common cause of
  signature rejection.
- Do **not** configure `successUrl`. Nothing in the code sets it, and a
  redirect would let arrival at a URL stand in for payment.

### Non-destructive reachability check (no purchase)

```
curl -i -X POST https://…/api/v1/webhooks/paddle/ \
  -H "Content-Type: application/json" \
  -H "Paddle-Signature: ts=1700000000;h1=deadbeef" -d '{}'
```

Expect **401** with `paddle_webhook_signature_invalid`. That proves the URL
routes to the handler and verification is live. A 404 or 502 means routing;
a 200 would mean verification is not running and should be treated as
serious.

---

## 6. Smoke checks (no payment)

| # | Check | Expected |
|---|---|---|
| S1 | `/api/v1/health/` | `{"status":"ok"}` |
| S2 | `/admin/` | styled login page |
| S3 | `/api/v1/products/` | both products, correct prices |
| S4 | Frontend `/en`, `/fr`, `/ar` | load; `dir="rtl"` on `/ar` |
| S5 | `/en/products/where-we-met` | 3 offering cards, no Digital |
| S6 | `/en/studio/love-story-timeline` | Studio loads and edits |
| S7 | Photo upload | succeeds after email entered; 401 before |
| S8 | Create order, don't pay | order `pending` |
| S9 | `GET /api/v1/orders/<pending>/download/` | **404** |
| S10 | Same for another guest's order | **403** |
| S11 | Paddle overlay opens (then close it) | opens with correct amount, prefilled email |
| S12 | Cookies on your domain | `sessionid` first-party |

S9 and S10 are the ones worth doing carefully — they prove delivery is
gated by payment and ownership rather than by the UI.

---

## 7. What must NOT change during 12B

No code. No migrations. No `successUrl`. No transactional email. No stored
deliverables in R2. No deferred products. Payment authority stays with the
`transaction.paid` webhook.
