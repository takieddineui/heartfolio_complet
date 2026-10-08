from .base import *  # noqa: F401,F403
from .base import env

DEBUG = env.bool("DJANGO_DEBUG", default=True)

ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

# Local development only: lets a locally-run Next.js dev server call the
# API without requiring CORS_ALLOWED_ORIGINS to be set explicitly every
# time. Production must always set CORS_ALLOWED_ORIGINS itself — see
# production.py, which does not define this fallback.
if not CORS_ALLOWED_ORIGINS:  # noqa: F405
    CORS_ALLOWED_ORIGINS = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

# Same reasoning as CORS above — the guest-session POST is a
# state-changing cross-origin request from the local Next.js dev server,
# so it needs to be a trusted CSRF origin too, or every local POST would
# 403 until CSRF_TRUSTED_ORIGINS was set by hand.
if not CSRF_TRUSTED_ORIGINS:  # noqa: F405
    CSRF_TRUSTED_ORIGINS = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
