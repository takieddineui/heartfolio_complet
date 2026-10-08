# Environment Variables

Both apps ship a real `.env.example` (`frontend-heartfolio/.env.example`,
`backend/.env.example`) — those are the literal source of truth
for names and defaults. This file explains *why* each one exists and what
breaks without it, which the example files intentionally keep brief.

## Backend (Django) — `backend/.env`

### Core
| Variable | Required? | Notes |
|---|---|---|
| `DJANGO_SECRET_KEY` | Yes | Random value in production. The dev default (`change-me-to-a-random-value`) must never ship |
| `DJANGO_SETTINGS_MODULE` | Yes | `config.settings.development` locally, `config.settings.production` in deploy |
| `DJANGO_ALLOWED_HOSTS` | Yes | **The 502 on the former Railway host was adjacent to this** — see `PROJECT-STATE.md`. If unset in production, Django raises `ImproperlyConfigured` at startup (workers fail to boot, not a 400 per-request) |
| `DATABASE_URL` | Yes | Standard `postgres://` connection string |
| `CORS_ALLOWED_ORIGINS` | Yes | Must include the actual Next.js origin |

### Asset storage (Cloudflare R2)
| Variable | Required? | Notes |
|---|---|---|
| `ASSET_STORAGE_BACKEND` | Yes | `mock` (in-memory, default, used for all local dev and the entire test suite) or `r2` (required in production — refuses to start if any `R2_*` below is missing) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | In production | |
| `R2_ENDPOINT_URL` | No | Derived from `R2_ACCOUNT_ID` if blank |
| `R2_PUBLIC_BASE_URL` | No | Only set if the bucket is intentionally public. Leave blank for short-lived presigned URLs — the normal path |
| **`X-Content-Type-Options: nosniff`** | — | **Not an env var — a bucket-level header that must be set directly on R2, outside Django.** Still not configured as of this handoff |

### Media limits and retention
| Variable | Default | Notes |
|---|---|---|
| `MAX_ASSET_SIZE_MB` | 10 | Images |
| `MAX_MEDIA_SIZE_MB` | 50 | Milestone video/voice notes — separate, larger ceiling |
| `MEDIA_REENCODE_TIMEOUT_SECONDS` | 60 | |
| `MEDIA_PROVISIONAL_RETENTION_DAYS` | 7 | How long an unpurchased video/audio upload survives before `expire_provisional_assets` deletes it. **The entire cost-control point of the deferred-media-storage design does nothing if the scheduled job isn't actually configured to run** |
| `MAX_PROJECT_DATA_KB` | 256 | Ceiling on a project's serialized JSON |

### Email and magic links
| Variable | Notes |
|---|---|
| `RESEND_API_KEY` | Blank = sending is skipped with a warning, never attempted — safe for local/CI |
| `RESEND_FROM_EMAIL` | |
| `FRONTEND_URL` | Where emailed magic links point |
| `ORDER_ACCESS_TOKEN_MAX_AGE_DAYS` | Default 30. This token now travels as a URL **path segment**, not `?token=` — see `PROJECT-STATE.md` |

### Payments
| Variable | Notes |
|---|---|
| `PAYMENT_PROVIDER` | `mock` (default, no credentials needed, used for all local dev and tests) or `paddle` (required in production — refuses to start if any `PADDLE_*` below is missing, and refuses to start with `mock` in production) |
| `PADDLE_ENVIRONMENT` | `sandbox` or `production` |
| `PADDLE_API_KEY` | **Secret**, backend-only |
| `PADDLE_CLIENT_TOKEN` | Public by Paddle's own design — safe in frontend code |
| `PADDLE_WEBHOOK_SECRET` | **Secret** — verifies the HMAC signature on incoming webhooks. This is the ONLY thing that marks an order paid |

### Alerts
| Variable | Notes |
|---|---|
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Blank disables alerting entirely. Powers `check_services` (§9 ops health check) |

---

## Frontend (Next.js) — `frontend-heartfolio/.env.local`

| Variable | Required? | Notes |
|---|---|---|
| `BACKEND_API_ORIGIN` | **Yes** | Server-side only, deliberately NOT `NEXT_PUBLIC_` — the browser never talks to Django directly, only through a same-origin rewrite (`next.config.ts`) that keeps the guest session cookie first-party. There is no default: unset or empty stops `next dev`/`next build` with an error naming this variable, and the catalog and live-page fetches throw the same. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | For the waitlist route | Service-role key is server-side only — bypasses Row Level Security, never expose to the client |
| `NEXT_PUBLIC_PADDLE_ENVIRONMENT` | No | Defaults to `sandbox` deliberately — a missing value must never point a test at live payments. The Paddle client token itself is NOT set here; it arrives from `POST /orders/{id}/pay/` |
| `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` | **For the location field to work at all** | Client-side by design (Mapbox geocoding tokens are meant to be public — the actual security boundary is a URL/referrer restriction set in the Mapbox dashboard, not secrecy). **Without this, the location field degrades to a disabled state rather than firing requests that would 401** — it doesn't crash, it just doesn't work. **Never actually tested against a live Mapbox response** — see `TESTING-RUNBOOK.md` §6 |
| `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`, `NEXT_PUBLIC_GA_ID` | No | Analytics — still unset as of this handoff |

`NEXT_PUBLIC_*` variables are build-time, not runtime — a hot reload will
not pick up a change; restart the dev server.
