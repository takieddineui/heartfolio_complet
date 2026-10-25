"""
Base settings shared by every environment.

`development.py` and `production.py` both import from this module and
only override what genuinely differs per environment. Nothing
environment-specific (debug flags, allowed hosts, secret values) lives
here — it's all read from the environment via `django-environ`.
"""

from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env()
# .env is optional — production environments are expected to inject real
# environment variables directly rather than shipping a file.
environ.Env.read_env(str(BASE_DIR / ".env"))

SECRET_KEY = env("DJANGO_SECRET_KEY")

DEBUG = env.bool("DJANGO_DEBUG", default=False)

ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=[])


# ------------------------------------------------------------------
# Applications
# ------------------------------------------------------------------

DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    "corsheaders",
]

# Domain apps. Deliberately no `customers.models` etc. exist yet (Phase
# 3.1 is foundation-only) — these are registered now so app discovery,
# settings, and future `startapp`-equivalent scaffolding has a stable
# home from day one, per the approved domain boundaries:
# customers / products / projects / assets / commerce / common.
LOCAL_APPS = [
    "apps.customers",
    "apps.products",
    "apps.projects",
    "apps.assets",
    "apps.commerce",
    "apps.delivery",
    "apps.feedback",
    "apps.common",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS


MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# Tests never reach the outside world, whatever the environment holds: no real
# emails or Telegram alerts, and any other non-local connection fails the run.
TEST_RUNNER = "config.test_runner.HermeticTestRunner"
ASGI_APPLICATION = "config.asgi.application"


# ------------------------------------------------------------------
# Database
# ------------------------------------------------------------------
# Configured entirely from DATABASE_URL. No business models/migrations
# exist yet (Phase 3.1) — this only needs to be a valid, connectable
# configuration, not a populated schema.

DATABASES = {
    "default": env.db("DATABASE_URL", default="postgres://postgres:postgres@localhost:5432/heartfolio"),
}
# See config/db_backends/postgresql_patient/creation.py — retries the
# final `DROP DATABASE` step of `manage.py test` teardown instead of
# failing immediately, since this project's database connection goes
# through Supabase's Supavisor pooler (session mode), which can lag
# briefly in releasing a just-closed connection's backend session.
# Behaviorally identical to `django.db.backends.postgresql` for every
# other code path — request handling, migrations, `manage.py check` —
# since only test teardown is overridden.
DATABASES["default"]["ENGINE"] = "config.db_backends.postgresql_patient"


# ------------------------------------------------------------------
# Password validation
# ------------------------------------------------------------
# Kept at Django defaults. Heartfolio's MVP is guest-based (no accounts),
# so this has no current effect, but leaving `django.contrib.auth`
# installed (required by `django.contrib.contenttypes`/admin conventions)
# means the validator setting should still be sane rather than absent.

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]


# ------------------------------------------------------------------
# Internationalization
# ------------------------------------------------------------
# Matches the frontend's supported locales (en/fr/ar) for consistency,
# though the backend does not perform translation itself.

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True


# ------------------------------------------------------------------
# Static files
# ------------------------------------------------------------------

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# ------------------------------------------------------------------
# Django REST Framework
# ------------------------------------------------------------
# Infrastructure only — no resource endpoints exist yet. Sensible
# defaults for an API-first backend: JSON-only rendering in production,
# a structured exception envelope, and no implicit permissive access.

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "EXCEPTION_HANDLER": "apps.common.exceptions.custom_exception_handler",
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 20,
    # Phase 3.14: rate limiting for the handful of publicly-reachable,
    # genuinely abuse-prone endpoints (guest/customer creation, asset
    # upload, order creation, rendering-on-download) — see the specific
    # views that set `throttle_scope` for which endpoints this actually
    # applies to. `ScopedRateThrottle` is a no-op for any view that
    # doesn't set `throttle_scope` (DRF returns "allow" unconditionally
    # in that case), so this is deliberately opt-in per view rather than
    # a blanket global throttle — the Paddle webhook view in particular
    # must never be IP-rate-limited (Paddle's own delivery IPs would be
    # the ones penalized), and simply never sets a `throttle_scope`.
    #
    # Backed by Django's default local-memory cache (no Redis
    # dependency, matching the "no large infrastructure addition"
    # instruction) — see the README's Phase 3.14 section for the
    # known limitation this implies (per-process, not distributed
    # across multiple app-server workers/instances).
    #
    # Generous by default so local development and the test suite are
    # never accidentally throttled; production.py tightens these to
    # real production values. Every rate is still independently
    # overridable via environment variable in any environment.
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.ScopedRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "guest_identity": env("THROTTLE_RATE_GUEST_IDENTITY", default="1000/min"),
        "asset_upload": env("THROTTLE_RATE_ASSET_UPLOAD", default="1000/min"),
        "order_create": env("THROTTLE_RATE_ORDER_CREATE", default="1000/min"),
        "delivery_download": env("THROTTLE_RATE_DELIVERY_DOWNLOAD", default="1000/min"),
        # §7c — the general mode takes submissions with no auth at all,
        # which is the point of it and also an open door for noise.
        "feedback_create": env("THROTTLE_RATE_FEEDBACK_CREATE", default="1000/min"),
        # §21f — a bearer-token endpoint with no session is the one place
        # brute force is even theoretically worth attempting.
        "ar_access": env("THROTTLE_RATE_AR_ACCESS", default="1000/min"),
        # §21i — a write endpoint, so tighter than the read ones.
        "ar_target_upload": env("THROTTLE_RATE_AR_TARGET_UPLOAD", default="60/min"),
        # Song Poster's YouTube embeddability check — an outbound call to
        # Google on every hit, tighter than the read-only endpoints for
        # the same reason `ar_target_upload` is: nothing here should be
        # cheap enough to hammer.
        "youtube_validate": env("THROTTLE_RATE_YOUTUBE_VALIDATE", default="30/min"),
    },
}


# ------------------------------------------------------------------
# CORS
# ------------------------------------------------------------
# The Next.js Studio is the only intended browser client. Origins are
# environment-driven — never hardcoded — so each environment (local dev,
# staging, production) controls its own allow-list. No wildcard default.

CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[])
CORS_ALLOW_CREDENTIALS = True  # required for the guest-session cookie to be sent cross-origin


# ------------------------------------------------------------------
# Guest session / CSRF
# ------------------------------------------------------------
# The guest identity mechanism (apps/customers) is Django's own
# session framework — an opaque, server-side session key in an
# HttpOnly cookie — rather than a bespoke token or JWT. No new table is
# introduced for this: `django.contrib.sessions` (already installed)
# owns its own `django_session` table, framework infrastructure rather
# than one of the eight approved business tables.
#
# `SameSite` note: the Studio frontend and this API are expected to sit
# on the same registrable domain (e.g. app.heartfolio.com /
# api.heartfolio.com, or localhost:3000 / localhost:8000 in dev — same
# "site" for SameSite purposes even across ports), so `Lax` is the
# correct default: it's sent on normal cross-subdomain fetches while
# still refusing the cross-site-POST pattern SameSite exists to stop.
# If frontend and backend are ever deployed on genuinely unrelated
# domains, override both to `None` via the environment — `None`
# requires `Secure`, which is already forced on in production.py.
SESSION_COOKIE_SAMESITE = env("DJANGO_SESSION_COOKIE_SAMESITE", default="Lax")
CSRF_COOKIE_SAMESITE = env("DJANGO_CSRF_COOKIE_SAMESITE", default="Lax")

# HttpOnly by default (Django default is already True) — the session
# cookie carries only an opaque key, never the customer's email or any
# other identifying value, so there is nothing in it worth reading from
# JS in the first place.
SESSION_COOKIE_HTTPONLY = True

# The CSRF cookie is the one deliberate exception: it must be readable
# by frontend JS so it can be echoed back as the `X-CSRFToken` header on
# state-changing requests (the standard Django SPA pattern). This does
# not weaken CSRF protection — it's how the protection is satisfied
# without server-rendered forms; CsrfViewMiddleware remains enabled
# project-wide and is not bypassed anywhere.
CSRF_COOKIE_HTTPONLY = False

# Guest sessions persist across browser restarts for up to 30 days by
# default (configurable) rather than expiring at browser close, since a
# guest may reasonably return to finish a project days later without an
# account to log back into.
SESSION_COOKIE_AGE = env.int("DJANGO_SESSION_COOKIE_AGE", default=60 * 60 * 24 * 30)
SESSION_EXPIRE_AT_BROWSER_CLOSE = False
SESSION_SAVE_EVERY_REQUEST = False

# Origins allowed to make unsafe (state-changing) cross-site requests
# that carry Django's CSRF cookie. Defaults to the same list as CORS —
# a second, independent origin allow-list would just be the same set of
# trusted frontends typed twice — but stays independently overridable.
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=CORS_ALLOWED_ORIGINS)


# ------------------------------------------------------------------
# Asset storage (Cloudflare R2)
# ------------------------------------------------------------
# R2 exposes an S3-compatible API, so `boto3`'s S3 client talks to it
# directly (see apps/assets/storage.py) — no separate Cloudflare SDK.
#
# `ASSET_STORAGE_BACKEND` selects the implementation:
#   "r2"   - real Cloudflare R2 (requires the R2_* variables below)
#   "mock" - in-memory storage; the default here, for local development
#            without R2 credentials and for the test suite. Production
#            requires "r2" explicitly — see production.py, which fails
#            at settings-load time if required R2 config is missing
#            rather than silently falling back to this mode or to local
#            filesystem storage.
#
# No credentials are hardcoded anywhere — every value below is read
# from the environment, and R2_ENDPOINT_URL is derived from
# R2_ACCOUNT_ID only if not given explicitly.

ASSET_STORAGE_BACKEND = env("ASSET_STORAGE_BACKEND", default="mock")

R2_ACCOUNT_ID = env("R2_ACCOUNT_ID", default="")
R2_ACCESS_KEY_ID = env("R2_ACCESS_KEY_ID", default="")
R2_SECRET_ACCESS_KEY = env("R2_SECRET_ACCESS_KEY", default="")
R2_BUCKET_NAME = env("R2_BUCKET_NAME", default="")
R2_ENDPOINT_URL = env("R2_ENDPOINT_URL", default="") or (
    f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com" if R2_ACCOUNT_ID else ""
)
# Only set if the architecture intentionally wants public read access to
# the bucket (e.g. served through a custom domain/CDN in front of R2).
# Left blank, the app uses short-lived presigned GET URLs instead — see
# apps/assets/storage.py. The bucket itself is never made public just to
# simplify development.
R2_PUBLIC_BASE_URL = env("R2_PUBLIC_BASE_URL", default="")
R2_PRESIGNED_URL_EXPIRY_SECONDS = env.int("R2_PRESIGNED_URL_EXPIRY_SECONDS", default=300)

# Server-side reads of an asset's bytes (renderers pasting a customer's photo
# into a poster) used to run on boto's defaults: a 60s socket timeout and no
# overall deadline. Measured against a real paid order, a single 0.6MB photo
# read occasionally took 17-87s and ~90% of a pack's render time was spent
# waiting on R2 — enough to run into gunicorn's 120s worker timeout. See
# apps/assets/storage.py `R2Storage.download` for how each is applied.
#
#   CONNECT / READ  — botocore's socket timeouts. READ is an IDLE timeout
#                     (no bytes for this long), not a total.
#   DEADLINE        — total wall time for ONE download attempt, checked
#                     between chunks, which is what catches a read that
#                     trickles instead of stalling.
#   ATTEMPTS        — total tries per download (a timeout is usually a
#                     one-off; the retry is typically fast).
R2_CONNECT_TIMEOUT_SECONDS = env.int("R2_CONNECT_TIMEOUT_SECONDS", default=5)
R2_READ_TIMEOUT_SECONDS = env.int("R2_READ_TIMEOUT_SECONDS", default=15)
R2_DOWNLOAD_DEADLINE_SECONDS = env.int("R2_DOWNLOAD_DEADLINE_SECONDS", default=45)
R2_DOWNLOAD_ATTEMPTS = env.int("R2_DOWNLOAD_ATTEMPTS", default=3)

# Per-request ceiling for the photo-bytes cache in apps/assets/services.py
# (`asset_bytes_cache`). Bounded because the API runs in a 512MB container
# and a single photo may be up to MAX_ASSET_SIZE_MB.
ASSET_BYTES_CACHE_MAX_MB = env.int("ASSET_BYTES_CACHE_MAX_MB", default=64)

# A pack download warms that cache up front by fetching an order's photos
# CONCURRENTLY (apps/assets/services.py `prefetch_asset_bytes`), so the
# render waits on the slowest single photo rather than the sum of all of
# them. Measured against real R2, one 0.6MB read occasionally took 28s; three
# of those in sequence were the remaining bottleneck after de-duplication.
#   WORKERS — concurrent R2 reads (only network I/O runs in threads; every
#             database access stays on the request thread).
#   BUDGET  — how long the request waits for the warm-up before carrying on
#             regardless. Anything not warmed is simply read on demand, as it
#             always was.
# One request's TOTAL time for reading photos from storage, shared by every
# read in the request (all photos, all retries; see storage.read_budget).
# It must stay comfortably under gunicorn's 120s worker timeout (backend
# Dockerfile) — a read that overruns is a clean error, a worker kill is a
# truncated download plus every other request on that single worker lost.
# 90 leaves ~30s for rendering and zipping; a stuck read may overshoot by up
# to R2_READ_TIMEOUT_SECONDS before it can be abandoned.
ASSET_READ_BUDGET_SECONDS = env.int("ASSET_READ_BUDGET_SECONDS", default=90)
ASSET_PREFETCH_WORKERS = env.int("ASSET_PREFETCH_WORKERS", default=6)
ASSET_PREFETCH_BUDGET_SECONDS = env.int("ASSET_PREFETCH_BUDGET_SECONDS", default=50)


# ------------------------------------------------------------------
# Asset upload validation
# ------------------------------------------------------------
# R2 stores user-uploaded *input* assets only (source photos, etc.) —
# never generated/exported output, which stays entirely client-side in
# this MVP. See apps/assets/services.py.

# The locales the storefront publishes. Kept in step with
# `src/i18n/routing.ts` on the frontend — a locale accepted here that the
# frontend does not serve would produce a keepsake declaring a language its
# own copy was never written in.
# Magic-link order access (§12).
#
# 30 days: long enough that a customer who files the receipt away and returns
# weeks later still gets their files, short enough that a link in an abandoned
# inbox does not stay live indefinitely. Expiry is not a dead end — the order
# still exists and a fresh link can be issued.
ORDER_ACCESS_TOKEN_MAX_AGE_DAYS = env.int("ORDER_ACCESS_TOKEN_MAX_AGE_DAYS", default=30)

# Telegram alerts (§9). A free bot created once via @BotFather.
#
# Blank in development and CI: sending is skipped and logged rather than
# erroring, so nothing needs stubbing and no local run messages a real phone.
TELEGRAM_BOT_TOKEN = env("TELEGRAM_BOT_TOKEN", default="")
TELEGRAM_CHAT_ID = env("TELEGRAM_CHAT_ID", default="")

# Resend, for transactional email (§12). Sending is skipped with a warning
# when no API key is configured, so local and CI runs never attempt a real
# send and never fail an order because of it.
RESEND_API_KEY = env("RESEND_API_KEY", default="")
RESEND_FROM_EMAIL = env("RESEND_FROM_EMAIL", default="orders@theheartfolio.com")
# Where a reply to the receipt goes. The receipt tells customers to reply if
# their link stops working, so this is the support inbox (the address the
# site shows, `SUPPORT_EMAIL` in the frontend's site-config.ts), not the
# sending address. Empty sends no reply-to.
RESEND_REPLY_TO_EMAIL = env("RESEND_REPLY_TO_EMAIL", default="support@theheartfolio.com")
FRONTEND_URL = env("FRONTEND_URL", default="https://www.theheartfolio.com")

# §9 — where the Telegram digest's "Reports"/"Status" buttons point.
# These pages are Django-served (`/api/v1/ops/...`), not the Next.js
# frontend, and this app's own public address is not otherwise known to
# itself — whatever hosts it (a PaaS, or the VPS's own domain) knows its
# own address, this settings module does not. Empty by default rather
# than guessing a specific platform's domain scheme, since the project has
# changed host more than once; the digest simply omits the buttons when
# this is unset rather than sending a broken link.
BACKEND_PUBLIC_URL = env("BACKEND_PUBLIC_URL", default="")

SUPPORTED_LOCALES = env.list("SUPPORTED_LOCALES", default=["en", "fr", "ar"])
DEFAULT_LOCALE = env("DEFAULT_LOCALE", default="en")

MAX_ASSET_SIZE_MB = env.int("MAX_ASSET_SIZE_MB", default=10)

# §5 — media is a separate, much larger ceiling. Applying the image limit
# to video would reject three seconds of phone footage; applying the media
# limit to images would let someone store 50MB of PNG per milestone.
MAX_MEDIA_SIZE_MB = env.int("MAX_MEDIA_SIZE_MB", default=50)

# Audio is re-encoded inline (see apps/assets/media.py). The timeout is what
# stops a crafted file holding a request worker open indefinitely — a denial
# of service that needs no exploit.
MEDIA_REENCODE_TIMEOUT_SECONDS = env.int("MEDIA_REENCODE_TIMEOUT_SECONDS", default=60)

# §7 — how long a video/audio upload survives before the expiry sweep
# deletes it, if no paid order needed it. Long enough that a customer who
# steps away for a few days and comes back still finds their voice note;
# short enough that storage cost from abandoned drafts stays bounded
# rather than accumulating forever. Photos are never subject to this —
# see the `expires_at` field docstring on the `Asset` model.
MEDIA_PROVISIONAL_RETENTION = timedelta(days=env.int("MEDIA_PROVISIONAL_RETENTION_DAYS", default=7))

# Ceiling on a project's serialized `data` payload (§22b).
#
# `Project.data` is deliberately opaque to the backend — it never inspects or
# reshapes product-module state — which meant nothing bounded it either.
# Django's own request limits (DATA_UPLOAD_MAX_MEMORY_SIZE, 2.5MB) applied by
# accident rather than by decision, and would let a single draft carry
# megabytes of text into every subsequent read, render and order.
#
# 256KB is generous for the real shape of this data — a timeline is a few
# dozen short strings and some theme ids; the largest realistic project is
# well under 20KB — while still stopping the payload being used as storage.
# A blunt, structure-agnostic ceiling on the whole document, not a per-field
# rule: per-field limits would require the backend to understand
# product-specific shapes, which is exactly what it must not do.
MAX_PROJECT_DATA_KB = env.int("MAX_PROJECT_DATA_KB", default=256)
# SVG is deliberately excluded by default — it can embed script content
# and isn't needed by any current product. Configurable, not hardcoded,
# so a real product requirement can extend this without a code change.
ALLOWED_ASSET_MIME_TYPES = env.list(
    "ALLOWED_ASSET_MIME_TYPES",
    default=[
        "image/jpeg", "image/png", "image/webp",
        # §5 — optional milestone media. Deliberately few: every container
        # is another parser reachable by an untrusted file.
        "video/mp4", "video/quicktime", "video/webm",
        "audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "audio/webm",
        # Voice messages received from other people (Graduation Keepsake);
        # see AUDIO_MIME_TYPES in apps/assets/media.py.
        "audio/ogg", "audio/opus", "audio/x-m4a", "audio/mp3", "audio/x-wav",
    ]
)


# ------------------------------------------------------------------
# Payments (Paddle Billing)
# ------------------------------------------------------------
# Mirrors the ASSET_STORAGE_BACKEND pattern from Phase 3.5 exactly:
# `PAYMENT_PROVIDER` selects the implementation, defaulting to "mock"
# so local dev/tests work with zero Paddle credentials. Production
# defaults to "freemius" (Freemius only, owner's decision 25 Oct 2026: no
# provider behind this abstraction; see payment_provider.py) and still
# accepts "paddle" or "fastspring", each validated at settings-load time —
# see production.py, which also refuses PAYMENT_PROVIDER=mock.
#
# Paddle distinguishes three credential types, used in different
# places (never mixed):
#   PADDLE_API_KEY        - backend-only, secret. Used to call the
#                            Paddle API (create transactions). Never
#                            sent to the frontend, never logged.
#   PADDLE_CLIENT_TOKEN    - public, client-side. Safe to embed in the
#                            frontend for Paddle.js to open Checkout.
#                            Not a secret by Paddle's own design.
#   PADDLE_WEBHOOK_SECRET  - backend-only, secret. Used only to verify
#                            the HMAC signature on incoming webhooks.

PAYMENT_PROVIDER = env("PAYMENT_PROVIDER", default="mock")
PADDLE_ENVIRONMENT = env("PADDLE_ENVIRONMENT", default="sandbox")
PADDLE_API_KEY = env("PADDLE_API_KEY", default="")
PADDLE_CLIENT_TOKEN = env("PADDLE_CLIENT_TOKEN", default="")
PADDLE_WEBHOOK_SECRET = env("PADDLE_WEBHOOK_SECRET", default="")

# ------------------------------------------------------------------
# Payments (FastSpring) — sandbox integration; Paddle remains the live
# default (PAYMENT_PROVIDER above). Same PAYMENT_PROVIDER switch selects
# "fastspring" as an alternative to "paddle"/"mock" — see
# apps/commerce/payment_provider.py's get_payment_provider(). production.py
# fails at settings-load time if required FASTSPRING_* config is missing
# whenever PAYMENT_PROVIDER=fastspring, the same way it already does for
# "paddle".
#
# Credential types, mirroring the Paddle split above:
#   FASTSPRING_API_USERNAME/PASSWORD - backend-only, secret. HTTP Basic
#                            Auth for the Sessions API (create sessions).
#                            Never sent to the frontend, never logged.
#   FASTSPRING_ACCESS_KEY   - public, client-side. Safe to embed in the
#                            frontend for the Store Builder Library to
#                            open checkout. Not a secret by FastSpring's
#                            own design.
#   FASTSPRING_WEBHOOK_SECRET - backend-only, secret. Used only to verify
#                            the HMAC signature on incoming webhooks.
#
# Unlike Paddle, FastSpring is confirmed to run ONE store with a single
# API credential pair serving both test and live mode — there is no
# separate sandbox account/keys to plan around. FASTSPRING_ENVIRONMENT
# still exists, for naming symmetry with PADDLE_ENVIRONMENT and to drive
# the webhook handler's own `event.live` reconciliation (see
# fastspring_integration.py) — it is not selecting a different set of
# credentials the way PADDLE_ENVIRONMENT effectively does.
FASTSPRING_ENVIRONMENT = env("FASTSPRING_ENVIRONMENT", default="sandbox")
FASTSPRING_API_USERNAME = env("FASTSPRING_API_USERNAME", default="")
FASTSPRING_API_PASSWORD = env("FASTSPRING_API_PASSWORD", default="")
FASTSPRING_ACCESS_KEY = env("FASTSPRING_ACCESS_KEY", default="")
FASTSPRING_WEBHOOK_SECRET = env("FASTSPRING_WEBHOOK_SECRET", default="")
# Confirmed account values — see apps/commerce/fastspring_integration.py's
# create_session() for how these build the Sessions API's checkout path.
FASTSPRING_STORE_ID = env("FASTSPRING_STORE_ID", default="heartfolio")
FASTSPRING_CHECKOUT_ID = env("FASTSPRING_CHECKOUT_ID", default="popup-heartfolio")

# ------------------------------------------------------------------
# Payments (Freemius) — orthogonal to PAYMENT_PROVIDER above, on purpose
# ------------------------------------------------------------------
# Freemius is being trialled for a Merchant-of-Record review (provisionally
# accepted, not yet confirmed) and cannot slot into the existing
# PAYMENT_PROVIDER switch: that abstraction's start_checkout(order) takes an
# ALREADY-CREATED Order, and Freemius's checkout has no passthrough field to
# resolve a webhook back to one — see freemius_integration.py's module
# docstring and apps/commerce/models.py::FreemiusCheckoutStaging for why the
# Order is created only after payment is verified, for this provider only.
# So FREEMIUS_ENABLED is a separate, independently-flippable switch — it can
# be on while PAYMENT_PROVIDER stays "mock"/"paddle"/"fastspring" for
# everything else, and vice versa.
#
# Credential types (Settings -> API & Keys in the Freemius Developer
# Dashboard):
#   FREEMIUS_API_TOKEN     - backend-only, secret. Bearer token for the
#                            REST API (fetching a license/payment to
#                            verify a purchase). Never sent to the
#                            frontend, never logged.
#   FREEMIUS_SECRET_KEY    - backend-only, secret. A DIFFERENT credential
#                            from the API token — used only to compute
#                            the HMAC-SHA256 signature on incoming
#                            webhooks (x-signature header).
#   FREEMIUS_PRODUCT_ID    - the Freemius product id every API path is
#                            scoped under (/products/{id}/...).
#   FREEMIUS_PUBLIC_KEY    - NOT secret; goes straight into the browser's
#                            `FS.Checkout({product_id, plan_id,
#                            public_key, ...})` call (see the dashboard's
#                            own generated buy-button snippet). Also an
#                            input to the sandbox-token hash below — it
#                            is genuinely required, contrary to what an
#                            earlier read of Freemius's generic parameter
#                            reference doc suggested.
#
# There is deliberately no FREEMIUS_SANDBOX_TOKEN/CTX setting. Freemius's
# own `@freemius/sdk` (`Checkout.getSandboxParams()`, read directly from
# its published source) makes no REST call at all — it's a pure,
# time-sensitive local computation: `ctx` = current Unix timestamp,
# `token` = md5(ctx + product_id + secret_key + public_key + "checkout").
# A static, once-copied value would eventually look stale to whatever
# freshness Freemius's checkout backend expects, so this is computed
# fresh per request instead — see
# `freemius_integration.get_sandbox_params()` and
# `FreemiusStagingSerializer.get_sandbox`, which also enforces that it's
# never computed/returned once FREEMIUS_LIVE_CONFIRMED is true.
FREEMIUS_ENABLED = env.bool("FREEMIUS_ENABLED", default=False)
FREEMIUS_PRODUCT_ID = env("FREEMIUS_PRODUCT_ID", default="")
FREEMIUS_API_TOKEN = env("FREEMIUS_API_TOKEN", default="")
FREEMIUS_SECRET_KEY = env("FREEMIUS_SECRET_KEY", default="")
FREEMIUS_PUBLIC_KEY = env("FREEMIUS_PUBLIC_KEY", default="")
# Freemius has only PROVISIONALLY accepted the account pending review —
# this must never flip to real/live traffic by omission. See
# production.py: booting in production with FREEMIUS_ENABLED=true hard-
# fails unless this is ALSO explicitly set, a deliberate second switch.
FREEMIUS_LIVE_CONFIRMED = env.bool("FREEMIUS_LIVE_CONFIRMED", default=False)


# ------------------------------------------------------------------
# Logging
# ------------------------------------------------------------
# Three loggers as required: `django` (framework), `django.request`
# (request-level errors), and `heartfolio` (application/domain code).
# Console-only for now — shipping logs to an aggregator is an
# infrastructure decision for a later phase, not part of the foundation.
# No handler here is given request bodies/payloads to log by default,
# which keeps this configuration incapable of accidentally logging
# passwords, tokens, or payment data without a call site deliberately
# passing that data to `logger.info(...)`.

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "[{asctime}] {levelname} {name}: {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "verbose",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": "INFO",
    },
    "loggers": {
        "django": {
            "handlers": ["console"],
            "level": env("DJANGO_LOG_LEVEL", default="INFO"),
            "propagate": False,
        },
        "django.request": {
            "handlers": ["console"],
            "level": "ERROR",
            "propagate": False,
        },
        "heartfolio": {
            "handlers": ["console"],
            "level": env("HEARTFOLIO_LOG_LEVEL", default="INFO"),
            "propagate": False,
        },
    },
}
