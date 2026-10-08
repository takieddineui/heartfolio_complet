"""Telegram alerts (§9).

§9's reasoning: being told beats remembering to check. A free bot created
once via @BotFather pushes a message to a phone the moment something serious
happens.

TRANSITIONS, NOT STATES — THE DECISION EVERYTHING ELSE FOLLOWS FROM
--------------------------------------------------------------------
The health checks are meant to run on a schedule. If each run alerted on
whatever it found, a service down overnight would send a message every
polling interval until morning. The predictable result is that the alerts
get muted, and the one that mattered arrives silenced.

So an alert fires when a service CHANGES state: working to failing, or
failing back to working. A service that has been down for six hours sends
one message, not seventy-two. Recovery is alerted too, because "is it back?"
is the question immediately after "is it down?", and answering it without
being asked is most of the value.

State lives in a table rather than memory or a file: a redeployed
container starts with a fresh filesystem, so anything else would forget
every deploy and re-alert on everything.

FAILURE TO ALERT IS NEVER FATAL
-------------------------------
`send_alert` swallows everything. This runs from a scheduled command and
from the payment webhook path; an exception escaping into the latter would
turn a Telegram outage into a failed payment confirmation, which inverts the
priority completely — the alert exists to protect the order, not the reverse.

UNCONFIGURED IS NORMAL, NOT BROKEN
----------------------------------
No token in development or CI. Sending is skipped and logged rather than
erroring, so nothing has to be stubbed in tests and no local run tries to
message a real phone.
"""

from __future__ import annotations

import logging

import requests
from django.conf import settings

logger = logging.getLogger("heartfolio")

TELEGRAM_API = "https://api.telegram.org"
_TIMEOUT_SECONDS = 10


def is_configured() -> bool:
    return bool(settings.TELEGRAM_BOT_TOKEN and settings.TELEGRAM_CHAT_ID)


def send_alert(message: str, *, buttons: list[tuple[str, str]] | None = None) -> bool:
    """Pushes a message. Returns True if Telegram accepted it.

    `buttons` is an ordered list of (label, url) pairs, rendered as
    Telegram inline URL buttons under the message — one row per button,
    which reads better on a phone than several buttons crowded onto one
    row. Optional and rarely needed: most alerts here are told, not
    browsed to, and a button on every routine alert would train the
    reader to ignore them the same way a false-positive alert would.

    THESE URLS OPEN WHATEVER THE PHONE'S BROWSER SESSION ALREADY IS. The
    ops pages are `@staff_member_required` — Django admin session auth,
    not a token this function can carry. A button pointing at
    `/api/v1/ops/reports/` opens the real report ONLY if that browser is
    already logged into `/admin/`; otherwise it lands on the login page,
    same as typing the URL in by hand would. Nothing about adding a
    button changes that — it is a shortcut to the address, not a
    credential, and it is not meant to be one.

    Never raises — see the module docstring.
    """
    if not is_configured():
        # NOT `extra={"message": ...}`: `message` is a reserved LogRecord
        # attribute and logging raises KeyError on the collision. That would
        # have crashed on every skipped alert in an unconfigured environment
        # — which is every run in development and CI.
        logger.info("telegram_alert_skipped_unconfigured", extra={"alert_text": message[:200]})
        return False

    payload = {
        "chat_id": settings.TELEGRAM_CHAT_ID,
        "text": message,
        # Plain text on purpose. Markdown parsing fails on unescaped
        # underscores and brackets, which appear in target ids, order
        # UUIDs and error strings — exactly the content of an alert.
        # A rejected alert is worse than an unformatted one.
        "disable_web_page_preview": True,
    }
    if buttons:
        payload["reply_markup"] = {
            "inline_keyboard": [[{"text": label, "url": url}] for label, url in buttons]
        }

    try:
        response = requests.post(
            f"{TELEGRAM_API}/bot{settings.TELEGRAM_BOT_TOKEN}/sendMessage",
            json=payload,
            timeout=_TIMEOUT_SECONDS,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("telegram_alert_failed", extra={"error": str(exc)})
        return False

    if response.status_code >= 400:
        logger.error(
            "telegram_alert_rejected",
            # Body included: Telegram returns the actual reason (bad chat id,
            # bot blocked), and without it a silent alerting failure is
            # unactionable — and an alerting system that fails silently is
            # worse than none, because it is trusted.
            extra={"status_code": response.status_code, "body": response.text[:300]},
        )
        return False

    return True


def alert_service_transitions(results) -> list[str]:
    """Alerts only on services whose state has changed since the last run.

    Returns the messages actually sent, so a scheduled run can log what it
    did without re-deriving it.

    `unknown` is treated as "no information", not as a state to alert on: an
    unconfigured service in staging is not an outage, and alerting on it
    would train the reader to ignore the channel — the same reasoning that
    keeps `unknown` from turning the status page headline red.
    """
    from .models import ServiceAlertState

    sent: list[str] = []

    for result in results:
        if result.status == "unknown":
            continue

        state, _ = ServiceAlertState.objects.get_or_create(
            service_key=result.key, defaults={"last_status": ""}
        )
        if state.last_status == result.status:
            continue

        # First ever observation of a healthy service is not news.
        if state.last_status == "" and result.status == "ok":
            state.last_status = result.status
            state.save(update_fields=["last_status", "updated_at"])
            continue

        if result.status == "ok":
            message = f"RECOVERED — {result.label} is working again."
        else:
            message = f"DOWN — {result.label}\n{result.detail}"

        if send_alert(message):
            sent.append(message)

        # Saved regardless of whether the send succeeded. Otherwise a
        # Telegram outage during an incident would re-alert on every
        # subsequent run once it came back, which is the storm this whole
        # mechanism exists to prevent.
        state.last_status = result.status
        state.save(update_fields=["last_status", "updated_at"])

    return sent
