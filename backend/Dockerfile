# Heartfolio backend — Django + gunicorn.
#
# Multi-stage so the runtime image carries no build toolchain. Pillow and
# reportlab need compilers to install; they do not need them to run.
FROM python:3.12-slim AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

# Build deps for Pillow (image rendering) and psycopg (Postgres).
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential libpq-dev libjpeg-dev zlib1g-dev libfreetype6-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements/ requirements/
COPY requirements.txt .
RUN pip install --prefix=/install -r requirements.txt gunicorn


FROM python:3.12-slim

# Runtime libraries only — the -dev headers above are not needed here.
# ffmpeg (§5) brings ffprobe, which validates uploaded video and audio, and
# ffmpeg itself, which re-encodes audio. Without it every media upload is
# refused — deliberately, rather than silently storing unvalidated files.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 libjpeg62-turbo zlib1g libfreetype6 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /install /usr/local

# Never run as root. The app writes nothing to disk except collected static
# files, which are gathered at build time below.
RUN useradd --create-home --uid 10001 heartfolio
WORKDIR /app
COPY --chown=heartfolio:heartfolio . .
# `COPY --chown` sets ownership on the copied FILES, but /app itself was
# created by WORKDIR and is still owned by root. collectstatic below runs
# as `heartfolio` and creates STATIC_ROOT (`/app/staticfiles`, see
# base.py), which means creating a directory inside a root-owned one —
# PermissionError. Creating it here, owned by the app user, is what lets
# the build stay non-root rather than collecting as root and chowning
# afterwards.
RUN mkdir -p /app/staticfiles && chown heartfolio:heartfolio /app /app/staticfiles
USER heartfolio

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    # THE variable that breaks deploys if unset — see DEPLOYMENT-GUIDE.md §0.
    # `wsgi.py` defaults to production while `manage.py` defaults to
    # development, so collectstatic and gunicorn would disagree about
    # static file storage and every admin page would 500.
    DJANGO_SETTINGS_MODULE=config.settings.production

# Collected at build time, not on boot: it is deterministic, it needs no
# database, and doing it per container start would add seconds to every
# restart and roll the manifest under a running process.
RUN DJANGO_SECRET_KEY=build-time-only \
    DATABASE_URL=postgres://u:p@localhost/db \
    R2_ACCOUNT_ID=build R2_ACCESS_KEY_ID=build R2_SECRET_ACCESS_KEY=build \
    R2_BUCKET_NAME=build R2_ENDPOINT_URL=https://build.invalid \
    R2_PUBLIC_BASE_URL=https://build.invalid \
    FREEMIUS_ENABLED=true FREEMIUS_LIVE_CONFIRMED=true FREEMIUS_PRODUCT_ID=build \
    FREEMIUS_API_TOKEN=build FREEMIUS_SECRET_KEY=build FREEMIUS_PUBLIC_KEY=build \
    DJANGO_ALLOWED_HOSTS=build.invalid \
    CORS_ALLOWED_ORIGINS=https://build.invalid \
    python manage.py collectstatic --noinput

EXPOSE 8000

# Migrations are NOT run here. See DEPLOYMENT-GUIDE-DOCKER.md — running them
# on container start means every replica races to migrate, and a rollback
# leaves a schema the old image cannot read.
#
# BINDS TO $PORT, NOT A HARDCODED 8000. A PaaS host assigns a port at
# runtime through the PORT environment variable and routes its proxy to
# whatever that value is — it does not necessarily match the port the
# container happens to listen on. A hardcoded bind means gunicorn starts,
# logs clean, and never crashes (exactly what a healthy-looking startup
# log shows), while the host's proxy is reaching for a different port
# entirely — every request 502s with no application-level error at all,
# because the request never reaches the application. That is what
# happened on Railway, the former host. Local Docker and the planned VPS
# leave PORT unset, so this falls back to 8000, matching EXPOSE above.
#
# CMD's exec form does not perform shell expansion, so ${PORT:-8000} is
# wrapped in `sh -c` deliberately — without it, gunicorn would receive the
# literal string "${PORT:-8000}" as its bind argument.
# WORKER COUNT IS AN ENV VAR, DEFAULTING TO 1. It was a hardcoded 3, which
# is a reasonable production figure and the wrong one on a 0.5 GB free
# plan: each worker is a full Django process holding its own copy of the
# app, its own database connection and its own Pillow buffers, and memory
# was ~99% of the hosting bill. One worker removes two of those copies.
#
# THE COST IS CONCURRENCY. A sync worker handles exactly one request at a
# time, so with `--workers 1` a slow render blocks every other request
# until it finishes — including Paddle webhooks. That is acceptable for a
# test deployment with one person clicking, and NOT acceptable under real
# traffic. Raise it by setting GUNICORN_WORKERS (3 is the usual starting
# point) rather than editing this file, so the change is a dashboard
# variable and not a redeploy.
#
# `--timeout` defaults to 120: a poster render legitimately takes tens of
# seconds, and with a single worker a timeout kills the only one there is.
# It matches the frontend proxy's `proxyTimeout` (next.config.ts), which is
# baked in at build time; raise both together or neither.
#
# The production compose file (docker-compose.prod.yml) sets the workers
# (2), the timeout and `--max-requests`, which recycles a worker after that
# many requests so the per-render font and image caches cannot grow without
# bound. 0 (the default here) never recycles.
#
# The build-time collectstatic above passes dummy FREEMIUS_* values because
# production settings take payment through Freemius by default
# (PAYMENT_PROVIDER=freemius) and refuse to load without its configuration.
CMD ["sh", "-c", "gunicorn config.wsgi:application \
     --bind 0.0.0.0:${PORT:-8000} \
     --workers ${GUNICORN_WORKERS:-1} \
     --timeout ${GUNICORN_TIMEOUT:-120} \
     --graceful-timeout 30 \
     --max-requests ${GUNICORN_MAX_REQUESTS:-0} \
     --max-requests-jitter ${GUNICORN_MAX_REQUESTS_JITTER:-0} \
     --access-logfile - \
     --error-logfile -"]
