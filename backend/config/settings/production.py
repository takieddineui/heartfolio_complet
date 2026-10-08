from .base import *  # noqa: F401,F403
from .base import env

DEBUG = False

# ------------------------------------------------------------------
# Static files (Django admin only)
# ------------------------------------------------------------
# This is an API-only backend with no business-facing static content —
# the sole consumer of static files is Django admin's own CSS/JS, which
# is now load-bearing because the product catalog is entered through the
# admin. With DEBUG=False Django serves no static files whatsoever, so
# without WhiteNoise the admin renders as unstyled HTML.
#
# WhiteNoise is inserted directly after SecurityMiddleware, which is
# where its documentation requires it (it must see the request before
# anything that could redirect or rewrite it, but after the security
# headers are applied). `MIDDLEWARE` is otherwise untouched — same
# order, same members.
MIDDLEWARE = [  # noqa: F405
    *MIDDLEWARE[:1],  # noqa: F405
    "whitenoise.middleware.WhiteNoiseMiddleware",
    *MIDDLEWARE[1:],  # noqa: F405
]

# Compressed + hashed filenames, so admin assets are cacheable and a
# stale cached copy can never be served after an upgrade.
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

# Fail loudly rather than silently serving on an unrestricted host list
# or with no allowed CORS origin in production.
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS")
CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS")

# Standard production hardening. Values are conservative defaults, not
# secrets, so they're fine to keep in source rather than environment
# variables.
SECURE_SSL_REDIRECT = env.bool("DJANGO_SECURE_SSL_REDIRECT", default=True)
# Required alongside SECURE_SSL_REDIRECT for any deployment behind a
# reverse proxy that terminates TLS externally and forwards to this
# app over plain HTTP internally — every PaaS works this way, and so
# will the planned VPS (a proxy such as nginx or Caddy in front of the
# container). Without this, Django's
# `request.is_secure()` only looks at the actual (proxy-to-app) TCP
# connection, which is always HTTP from Django's point of view, so
# SECURE_SSL_REDIRECT would redirect every single request — including
# ones that already arrived over HTTPS at the edge — producing an
# infinite redirect loop and making the deployed app entirely
# unreachable. Safe to trust ONLY while the proxy in front is the sole
# path to this container AND overwrites any client-supplied
# X-Forwarded-Proto — a PaaS edge did that for us; on a VPS it is a
# requirement on the proxy's configuration, which this file cannot
# enforce. If the container were ever reachable directly, an end user
# could forge this header.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = env.int("DJANGO_SECURE_HSTS_SECONDS", default=60 * 60 * 24 * 30)
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"

# Production must use real R2 — "mock" (the base.py default, intended
# for local dev/tests only) is not a valid production backend, and
# there is deliberately no local-filesystem fallback. Fail at
# settings-load time (before the app ever serves a request) rather than
# discovering missing R2 config only when the first upload fails.
ASSET_STORAGE_BACKEND = env("ASSET_STORAGE_BACKEND", default="r2")
if ASSET_STORAGE_BACKEND == "r2":
    _required_r2_settings = {
        "R2_ACCESS_KEY_ID": R2_ACCESS_KEY_ID,  # noqa: F405
        "R2_SECRET_ACCESS_KEY": R2_SECRET_ACCESS_KEY,  # noqa: F405
        "R2_BUCKET_NAME": R2_BUCKET_NAME,  # noqa: F405
        "R2_ENDPOINT_URL": R2_ENDPOINT_URL,  # noqa: F405
    }
    _missing_r2_settings = [name for name, value in _required_r2_settings.items() if not value]
    if _missing_r2_settings:
        from django.core.exceptions import ImproperlyConfigured

        raise ImproperlyConfigured(
            "Production requires R2 storage configuration; missing: " + ", ".join(_missing_r2_settings)
        )
elif ASSET_STORAGE_BACKEND == "mock":
    from django.core.exceptions import ImproperlyConfigured

    raise ImproperlyConfigured(
        "ASSET_STORAGE_BACKEND=mock is not permitted in production — set ASSET_STORAGE_BACKEND=r2 "
        "with the required R2_* environment variables instead."
    )

# Same reasoning as ASSET_STORAGE_BACKEND above: "mock" (Phase 3.4's
# MockPaymentProvider) is for local dev/tests only. Production must use
# real Paddle and must fail at settings-load time, not at the first
# checkout attempt, if required configuration is missing.
PAYMENT_PROVIDER = env("PAYMENT_PROVIDER", default="paddle")
if PAYMENT_PROVIDER == "paddle":
    _required_paddle_settings = {
        "PADDLE_API_KEY": PADDLE_API_KEY,  # noqa: F405
        "PADDLE_CLIENT_TOKEN": PADDLE_CLIENT_TOKEN,  # noqa: F405
        "PADDLE_WEBHOOK_SECRET": PADDLE_WEBHOOK_SECRET,  # noqa: F405
    }
    _missing_paddle_settings = [name for name, value in _required_paddle_settings.items() if not value]
    if _missing_paddle_settings:
        from django.core.exceptions import ImproperlyConfigured

        raise ImproperlyConfigured(
            "Production requires Paddle payment configuration; missing: " + ", ".join(_missing_paddle_settings)
        )
elif PAYMENT_PROVIDER == "fastspring":
    # Mirrors the Paddle branch above exactly. Paddle remains the live
    # default (PAYMENT_PROVIDER's own default is "paddle") — this branch
    # only matters once PAYMENT_PROVIDER=fastspring is deliberately set,
    # and it closes the same gap the Paddle branch closes: required
    # config missing at settings-load time, not discovered at the first
    # real checkout attempt.
    _required_fastspring_settings = {
        "FASTSPRING_API_USERNAME": FASTSPRING_API_USERNAME,  # noqa: F405
        "FASTSPRING_API_PASSWORD": FASTSPRING_API_PASSWORD,  # noqa: F405
        "FASTSPRING_ACCESS_KEY": FASTSPRING_ACCESS_KEY,  # noqa: F405
        "FASTSPRING_WEBHOOK_SECRET": FASTSPRING_WEBHOOK_SECRET,  # noqa: F405
        "FASTSPRING_STORE_ID": FASTSPRING_STORE_ID,  # noqa: F405
        "FASTSPRING_CHECKOUT_ID": FASTSPRING_CHECKOUT_ID,  # noqa: F405
    }
    _missing_fastspring_settings = [name for name, value in _required_fastspring_settings.items() if not value]
    if _missing_fastspring_settings:
        from django.core.exceptions import ImproperlyConfigured

        raise ImproperlyConfigured(
            "Production requires FastSpring payment configuration; missing: "
            + ", ".join(_missing_fastspring_settings)
        )
elif PAYMENT_PROVIDER == "mock":
    from django.core.exceptions import ImproperlyConfigured

    raise ImproperlyConfigured(
        "PAYMENT_PROVIDER=mock is not permitted in production — set PAYMENT_PROVIDER=paddle "
        "with the required PADDLE_* environment variables instead."
    )
else:
    # Anything that isn't "paddle", "fastspring", or "mock" — a typo, or a
    # provider name set before its code exists — used to match neither
    # branch above and skip validation entirely, then reach
    # `get_payment_provider()` at request time, which (before its own
    # matching fix) silently returned `MockPaymentProvider` — a free,
    # successful checkout for a real customer. Failing here, at
    # settings-load time, is the same discipline every other branch in
    # this block already applies to a misconfigured *recognized* value.
    from django.core.exceptions import ImproperlyConfigured

    raise ImproperlyConfigured(
        f"Unrecognized PAYMENT_PROVIDER: {PAYMENT_PROVIDER!r}. "
        "Production requires PAYMENT_PROVIDER=paddle or PAYMENT_PROVIDER=fastspring."
    )

# Freemius is orthogonal to PAYMENT_PROVIDER (see base.py's own comment) and
# is still only PROVISIONALLY accepted pending Freemius's review — this must
# never go live by omission. FREEMIUS_ENABLED alone is not enough to run
# real traffic in production; FREEMIUS_LIVE_CONFIRMED must ALSO be set,
# deliberately, once Freemius actually confirms the account. There is no
# separate sandbox-credential setting to check for absence here (see
# base.py — the sandbox object is computed live, not stored), so the
# equivalent guard lives in FreemiusStagingSerializer.get_sandbox, which
# refuses to compute/return one at all once FREEMIUS_LIVE_CONFIRMED is true.
FREEMIUS_ENABLED = env.bool("FREEMIUS_ENABLED", default=False)  # noqa: F405
if FREEMIUS_ENABLED:
    from django.core.exceptions import ImproperlyConfigured

    FREEMIUS_LIVE_CONFIRMED = env.bool("FREEMIUS_LIVE_CONFIRMED", default=False)  # noqa: F405
    if not FREEMIUS_LIVE_CONFIRMED:
        raise ImproperlyConfigured(
            "FREEMIUS_ENABLED=true in production but FREEMIUS_LIVE_CONFIRMED is not set — "
            "Freemius has only provisionally accepted this account pending review. Set "
            "FREEMIUS_LIVE_CONFIRMED=true only once that review is actually confirmed."
        )
    _required_freemius_settings = {
        "FREEMIUS_PRODUCT_ID": FREEMIUS_PRODUCT_ID,  # noqa: F405
        "FREEMIUS_API_TOKEN": FREEMIUS_API_TOKEN,  # noqa: F405
        "FREEMIUS_SECRET_KEY": FREEMIUS_SECRET_KEY,  # noqa: F405
        "FREEMIUS_PUBLIC_KEY": FREEMIUS_PUBLIC_KEY,  # noqa: F405
    }
    _missing_freemius_settings = [name for name, value in _required_freemius_settings.items() if not value]
    if _missing_freemius_settings:
        raise ImproperlyConfigured(
            "Production requires Freemius payment configuration; missing: "
            + ", ".join(_missing_freemius_settings)
        )

# Tighten the generous dev/test defaults from base.py to real
# production values. Each remains independently overridable via
# environment variable — these are sane conservative defaults, not
# secrets, so they're fine to keep in source.
REST_FRAMEWORK = {
    **REST_FRAMEWORK,  # noqa: F405
    "DEFAULT_THROTTLE_RATES": {
        # MERGED ONTO THE BASE RATES, NOT REPLACING THEM. This dict used to
        # be written fresh, which silently dropped every scope base.py
        # defined but this block didn't restate — `feedback_create`,
        # `ar_access`, `ar_target_upload`. DRF raises
        # ImproperlyConfigured("No default throttle rate set for ...") the
        # first time a view with a missing scope is called, so the failure
        # surfaced in production as a 500 on the feedback form rather than
        # at startup. Spreading the base rates first means a scope added
        # there can never again vanish by omission here.
        **REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"],  # noqa: F405
        "guest_identity": env("THROTTLE_RATE_GUEST_IDENTITY", default="20/min"),
        "asset_upload": env("THROTTLE_RATE_ASSET_UPLOAD", default="30/min"),
        "order_create": env("THROTTLE_RATE_ORDER_CREATE", default="20/min"),
        "delivery_download": env("THROTTLE_RATE_DELIVERY_DOWNLOAD", default="60/min"),
    },
}
