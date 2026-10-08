"""Per-service health checks for the ops status page (§7b, §9).

WHAT THIS IS, AND WHAT IT IS NOT
--------------------------------
§7b asks for one place showing whether Supabase, the frontend host, the backend host,
Paddle and Cloudflare are OK, and flags honestly that a *unified log viewer*
across all five is a much larger project — the frontend host's deeper logs
needed paid Log Drains (Vercel, when this was written),
R2 emits no app-level logs without a separate paid setup, Supabase's are
locked to their dashboard. The recommendation was to start with green/red.

This is the green/red. It answers "is it up", never "what happened".

WHY NOT EXTEND `readiness_check`
--------------------------------
That endpoint is polled continuously by the platform orchestrator, and its
docstring says plainly why it does not probe R2 or Paddle: a live network
round-trip on every poll adds latency and cost without catching anything the
startup-time configuration check misses. That reasoning still holds. These
checks are deliberately a *separate*, human-triggered surface — someone opens
the status page, five requests go out, nobody's request path is affected.

EVERY CHECK IS INDEPDENDENT AND CANNOT BRING DOWN THE PAGE
----------------------------------------------------------
Each returns a result rather than raising, and a failure in one says nothing
about the others. A status page that itself 500s when a service is down is
worse than no status page — that is precisely the moment it is being looked
at.

"NOT CONFIGURED" IS ITS OWN STATE, NOT A FAILURE
-------------------------------------------------
Paddle has no API key in development, R2 has no bucket locally. Reporting
those as red would train the reader to ignore red. They report as unknown,
which is the truth: this deployment cannot say.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import requests
from django.conf import settings
from django.db import connection
from django.db.utils import Error as DatabaseError

#: Kept short on purpose. This runs while someone waits on a phone, five
#: times over; a hanging service should read as slow, not freeze the page.
_TIMEOUT_SECONDS = 5

OK = "ok"
FAILING = "failing"
UNKNOWN = "unknown"


@dataclass
class ServiceStatus:
    key: str
    label: str
    status: str
    detail: str
    latency_ms: int | None = None

    @property
    def is_ok(self) -> bool:
        return self.status == OK


def _timed(fn) -> tuple[object, int]:
    started = time.monotonic()
    result = fn()
    return result, int((time.monotonic() - started) * 1000)


def check_database() -> ServiceStatus:
    """Supabase — this project's Postgres. Also the only dependency every
    single request needs, so it is the one whose failure is total."""
    try:
        def probe():
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                return cursor.fetchone()

        _, ms = _timed(probe)
        return ServiceStatus("database", "Supabase (database)", OK, "Query succeeded", ms)
    except DatabaseError as exc:
        return ServiceStatus("database", "Supabase (database)", FAILING, str(exc)[:200])
    except Exception as exc:  # noqa: BLE001 - a status page must never 500
        return ServiceStatus("database", "Supabase (database)", FAILING, str(exc)[:200])


def check_storage() -> ServiceStatus:
    """Cloudflare R2 — where every delivered file lives.

    Probes the bucket rather than the endpoint hostname: a reachable R2 with
    the wrong bucket name or revoked keys is exactly the failure worth
    catching, and a DNS-level check would call that healthy.
    """
    if not (settings.R2_BUCKET_NAME and settings.R2_ACCESS_KEY_ID):
        return ServiceStatus("storage", "Cloudflare R2", UNKNOWN, "Not configured in this environment")

    try:
        import boto3

        def probe():
            client = boto3.client(
                "s3",
                endpoint_url=settings.R2_ENDPOINT_URL,
                aws_access_key_id=settings.R2_ACCESS_KEY_ID,
                aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
                region_name="auto",
            )
            return client.head_bucket(Bucket=settings.R2_BUCKET_NAME)

        _, ms = _timed(probe)
        return ServiceStatus("storage", "Cloudflare R2", OK, "Bucket reachable", ms)
    except Exception as exc:  # noqa: BLE001
        return ServiceStatus("storage", "Cloudflare R2", FAILING, str(exc)[:200])


def check_payments() -> ServiceStatus:
    """Paddle — an authenticated call, not a ping.

    `GET /event-types` is read-only, cheap, and requires a valid key, so it
    fails when the key is revoked or wrong. Hitting Paddle's marketing site
    instead would report healthy while checkout was refusing every payment.
    """
    if not settings.PADDLE_API_KEY:
        return ServiceStatus("payments", "Paddle", UNKNOWN, "No API key in this environment")

    base = (
        "https://sandbox-api.paddle.com"
        if settings.PADDLE_ENVIRONMENT == "sandbox"
        else "https://api.paddle.com"
    )
    try:
        def probe():
            return requests.get(
                f"{base}/event-types",
                headers={"Authorization": f"Bearer {settings.PADDLE_API_KEY}"},
                timeout=_TIMEOUT_SECONDS,
            )

        response, ms = _timed(probe)
        if response.status_code == 403 or response.status_code == 401:
            return ServiceStatus("payments", "Paddle", FAILING, "API key rejected", ms)
        if response.status_code >= 400:
            return ServiceStatus("payments", "Paddle", FAILING, f"HTTP {response.status_code}", ms)
        return ServiceStatus(
            "payments", "Paddle", OK, f"Authenticated ({settings.PADDLE_ENVIRONMENT})", ms
        )
    except Exception as exc:  # noqa: BLE001
        return ServiceStatus("payments", "Paddle", FAILING, str(exc)[:200])


def check_frontend() -> ServiceStatus:
    """The frontend host — the storefront.

    Checked from the backend's side of the network on purpose. The customer
    reaches the frontend directly, so this cannot prove they can; what it does
    prove is that the site is serving, which is the question being asked.
    """
    if not settings.FRONTEND_URL:
        return ServiceStatus("frontend", "Frontend (storefront)", UNKNOWN, "No frontend URL configured")

    try:
        def probe():
            return requests.get(settings.FRONTEND_URL, timeout=_TIMEOUT_SECONDS, allow_redirects=True)

        response, ms = _timed(probe)
        if response.status_code >= 400:
            return ServiceStatus("frontend", "Frontend (storefront)", FAILING, f"HTTP {response.status_code}", ms)
        return ServiceStatus("frontend", "Frontend (storefront)", OK, "Serving", ms)
    except Exception as exc:  # noqa: BLE001
        return ServiceStatus("frontend", "Frontend (storefront)", FAILING, str(exc)[:200])


def check_backend() -> ServiceStatus:
    """The backend host — this application.

    Trivially OK: if this code is running, the answer is yes. Listed anyway
    rather than omitted, because a status page missing a service reads as an
    oversight, and someone will wonder whether it was forgotten.
    """
    return ServiceStatus("backend", "Backend (API)", OK, "Responding — you are reading its output")


CHECKS = (check_backend, check_database, check_storage, check_payments, check_frontend)


def run_all_checks() -> list[ServiceStatus]:
    """Runs every check. Sequential, not parallel: five checks at a 5s
    timeout is a worst case nobody will hit, and threads here would buy a
    second or two at the cost of a failure mode in the thing whose entire
    job is to be trustworthy when everything else is broken."""
    results = []
    for check in CHECKS:
        try:
            results.append(check())
        except Exception as exc:  # noqa: BLE001
            # A check that raises is itself a bug, but the page still renders.
            results.append(
                ServiceStatus(check.__name__, check.__name__, FAILING, f"Check crashed: {exc}"[:200])
            )
    return results


def overall_status(results: list[ServiceStatus]) -> str:
    """The one-glance answer.

    `unknown` never turns the headline red — an unconfigured service in a
    staging environment is not an outage, and a headline that cries wolf
    stops being read.
    """
    if any(r.status == FAILING for r in results):
        return FAILING
    if any(r.status == UNKNOWN for r in results):
        return UNKNOWN
    return OK
