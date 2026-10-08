"""Scheduled Telegram business digest (§9).

Run on a schedule — one scheduler entry per period (daily, weekly, monthly).
The three entries are not yet defined for the planned VPS deployment; see
DEPLOYMENT-GUIDE-DOCKER.md for the status of that guide:

    python manage.py send_digest --period=daily
    python manage.py send_digest --period=weekly
    python manage.py send_digest --period=monthly

A management command, not an in-process scheduler inside gunicorn, for
the same reason `check_services` is one: this container has no
background thread that survives a deploy or a restart, and a digest that
silently stops after the next redeploy is worse than one that never
existed — nobody would notice it stopped.

WHY THIS EXISTS ALONGSIDE THE EVENT ALERTS IN `apps/common/telegram.py`.
Those fire on a single thing happening — one order paid, one render
failed. This answers a different question: not "did something happen"
but "how is the business doing", which needs the whole window summed up,
compared against the window before it. Neither replaces the other.
"""

from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.commerce.analytics import period_summary
from apps.common.telegram import is_configured, send_alert
from django.conf import settings

_WINDOWS = {
    "daily": timedelta(days=1),
    "weekly": timedelta(days=7),
    "monthly": timedelta(days=30),
}

_LABELS = {"daily": "Daily", "weekly": "Weekly", "monthly": "Monthly"}


class Command(BaseCommand):
    help = "Builds and sends the daily/weekly/monthly Telegram business digest."

    def add_arguments(self, parser):
        parser.add_argument(
            "--period",
            choices=sorted(_WINDOWS),
            required=True,
            help="Which window to summarise.",
        )
        parser.add_argument(
            "--no-alert",
            action="store_true",
            help="Build and print the digest without sending it.",
        )

    def handle(self, *args, **options):
        period = options["period"]
        window = _WINDOWS[period]

        # `end` is "now" at the moment this runs, not midnight — a cron
        # job does not fire at the exact second the boundary was
        # intended, and anchoring to "now" means the window is always
        # exactly `window` wide regardless of a few minutes of scheduler
        # jitter (schedulers generally do not fire at the exact second
        # either).
        end = timezone.now()
        start = end - window
        previous_start = start - window

        summary = period_summary(start, end, previous_start=previous_start)
        message = _format_digest(_LABELS[period], summary)

        self.stdout.write(message)

        if options["no_alert"]:
            self.stdout.write(self.style.WARNING("\n--no-alert: not sent."))
            return

        if not is_configured():
            self.stdout.write(self.style.WARNING("\nTelegram is not configured — nothing sent."))
            return

        buttons = _report_buttons()
        sent = send_alert(message, buttons=buttons)
        self.stdout.write(f"\nsent: {sent}")


def _report_buttons() -> list[tuple[str, str]] | None:
    """The "Reports"/"Status" buttons under the digest.

    Per `send_alert`'s own note: these open whatever session the phone's
    browser already has, not a credential this carries. Omitted entirely
    — not sent with a broken link — when `BACKEND_PUBLIC_URL` is unset,
    which is the honest default until it is configured for whichever
    host is currently live.
    """
    if not settings.BACKEND_PUBLIC_URL:
        return None
    base = settings.BACKEND_PUBLIC_URL.rstrip("/")
    return [
        ("Open Reports", f"{base}/api/v1/ops/reports/"),
        ("Open Status", f"{base}/api/v1/ops/status/"),
    ]


def _money(cents: int) -> str:
    return f"${cents / 100:,.2f}"


def _trend(current: int, previous: int | None) -> str:
    """"+12%" / "−4%" / "" — omitted entirely rather than shown as "+0%"
    when there is nothing to compare against yet, or the previous window
    was itself zero (a percentage change from zero is not a number)."""
    if previous is None or previous == 0:
        return ""
    change = (current - previous) / previous * 100
    arrow = "▲" if change >= 0 else "▼"
    return f" ({arrow}{abs(change):.0f}% vs previous)"


def _format_digest(label: str, s) -> str:
    """Plain text, matching every other Telegram message in this
    project — `send_alert`'s own docstring on why Markdown is refused
    (order ids and target ids contain characters that break it)."""
    lines = [f"{label.upper()} DIGEST"]
    lines.append(f"revenue: {_money(s.revenue_cents)}{_trend(s.revenue_cents, s.previous_revenue_cents)}")
    lines.append(f"orders: {s.orders} paid, {s.unpaid_orders} unpaid/abandoned")
    lines.append(f"avg order: {_money(s.average_order_value_cents)}")
    lines.append(f"customers: {s.new_customers} new, {s.returning_customers} returning")

    if s.top_pack:
        lines.append(f"top pack: {s.top_pack}")
    if s.top_country:
        lines.append(f"top country: {s.top_country}")

    if s.feedback_count:
        rating = f", avg {s.feedback_average}/5" if s.feedback_average is not None else ""
        lines.append(f"feedback: {s.feedback_count} received{rating}")
    else:
        lines.append("feedback: none")

    return "\n".join(lines)
