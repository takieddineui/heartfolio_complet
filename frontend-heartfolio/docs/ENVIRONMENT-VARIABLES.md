# Environment Variables

Generated from source: backend variables were enumerated from
`config/settings/*.py`; frontend from `.env.example` and `process.env` usage.
**No real values appear anywhere in this repository.**

> **Hosting note (updated):** Railway and Vercel are no longer used; development is
> local Docker and production is planned as a VPS running the same setup (database
> undecided). The variable names, required/secret flags and meanings below still
> apply; only the platform-specific values and "injected by" remarks are history.

## Frontend

| Variable | Service | Required | Secret | Public | Example format | Purpose |
|---|---|---|---|---|---|---|
| `BACKEND_API_ORIGIN` | Frontend | Yes | No | **No** | `https://<backend-host>` | Rewrite target. Server-side only — the browser must never call the backend directly. There is no default: unset or empty is an error (build and server-side fetches) |
| `NEXT_PUBLIC_PADDLE_ENVIRONMENT` | Frontend | Recommended | No | Yes | `sandbox` | Paddle SDK environment. Defaults to `sandbox` if unset |
| `NEXT_PUBLIC_API_BASE_PATH` | Frontend | No | No | Yes | `/api/backend` | Same-origin path. Default is correct |
| `SUPABASE_URL` | Frontend | Yes (waitlist) | No | No | `https://<ref>.supabase.co` | Waitlist storage |
| `SUPABASE_SERVICE_ROLE_KEY` | Frontend | Yes (waitlist) | **Yes** | No | opaque | Waitlist writes. Never `NEXT_PUBLIC_` |

There is **no** Paddle client-token variable on the frontend: it arrives in
the `POST /orders/<id>/pay/` response.

## Backend

### Required

| Variable | Required | Secret | Example format | Purpose |
|---|---|---|---|---|
| `DJANGO_SETTINGS_MODULE` | **Yes** | No | `config.settings.production` | **Critical** — `manage.py` defaults to *development*, so migrate/collectstatic run under the wrong settings without it |
| `DJANGO_SECRET_KEY` | **Yes** | **Yes** | ≥50 random chars | Signing. The only variable with no default |
| `DATABASE_URL` | Yes | **Yes** | `postgres://…` | Railway injected it automatically; on the VPS it must be set explicitly (which database is undecided) |
| `DJANGO_ALLOWED_HOSTS` | Yes | No | `<backend-host>` | Host header allowlist |
| `CORS_ALLOWED_ORIGINS` | Yes | No | `https://<frontend-host>` | Comma-separated |
| `CSRF_TRUSTED_ORIGINS` | Yes | No | `https://<frontend-host>` | Needed even behind the proxy |
| `ASSET_STORAGE_BACKEND` | Yes | No | `r2` | `mock` raises in production |
| `R2_ACCESS_KEY_ID` | Yes | **Yes** | opaque | |
| `R2_SECRET_ACCESS_KEY` | Yes | **Yes** | opaque | |
| `R2_BUCKET_NAME` | Yes | No | `heartfolio-assets` | |
| `R2_ENDPOINT_URL` | Yes | No | `https://<acct>.r2.cloudflarestorage.com` | |
| `PAYMENT_PROVIDER` | Yes | No | `paddle` | `mock` raises in production |
| `PADDLE_API_KEY` | Yes | **Yes** | opaque | Server-side only |
| `PADDLE_CLIENT_TOKEN` | Yes | No (public) | opaque | Reaches the browser only via `/pay/` |
| `PADDLE_WEBHOOK_SECRET` | Yes | **Yes** | opaque | **Per webhook destination** |
| `PADDLE_ENVIRONMENT` | Yes | No | `sandbox` | |

### Optional (defaults in code)

`R2_ACCOUNT_ID`, `R2_PUBLIC_BASE_URL`, `R2_PRESIGNED_URL_EXPIRY_SECONDS`
(300), `MAX_ASSET_SIZE_MB` (10), `DJANGO_DEBUG` (False),
`DJANGO_LOG_LEVEL`, `HEARTFOLIO_LOG_LEVEL`, `DJANGO_SESSION_COOKIE_AGE`,
`DJANGO_SESSION_COOKIE_SAMESITE`, `DJANGO_CSRF_COOKIE_SAMESITE`,
`DJANGO_SECURE_SSL_REDIRECT`, `DJANGO_SECURE_HSTS_SECONDS`,
`THROTTLE_RATE_GUEST_IDENTITY`, `THROTTLE_RATE_ORDER_CREATE`,
`THROTTLE_RATE_ASSET_UPLOAD`, `THROTTLE_RATE_DELIVERY_DOWNLOAD`.

**Do not set `DJANGO_SESSION_COOKIE_SAMESITE=None`.** The same-origin proxy
makes the session cookie first-party; `Lax` is correct and stronger.

Production **fails at settings load** if R2 or Paddle configuration is
missing or set to `mock` — it will not boot half-configured.
