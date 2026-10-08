"""Scheduled health check with Telegram alerting (§7b, §9).

Run on a schedule (cron, or any external scheduler hitting a worker):

    python manage.py check_services

Deliberately a management command rather than a background thread or a hook
on an HTTP request. Health checks make outbound network calls; tying them to
a web request would make a customer wait on Paddle's API responding, and
tying them to a thread inside the web process would make them stop the
moment the process is recycled.
"""

from django.core.management.base import BaseCommand

from apps.common.service_health import overall_status, run_all_checks
from apps.common.telegram import alert_service_transitions, is_configured


class Command(BaseCommand):
    help = "Runs every service health check and alerts on any change of state."

    def add_arguments(self, parser):
        parser.add_argument(
            "--no-alerts",
            action="store_true",
            help="Run the checks and print them without sending anything.",
        )

    def handle(self, *args, **options):
        results = run_all_checks()

        for result in results:
            self.stdout.write(f"{result.status:8} {result.label}: {result.detail[:80]}")
        self.stdout.write(f"\noverall: {overall_status(results)}")

        if options["no_alerts"]:
            self.stdout.write("alerts suppressed (--no-alerts)")
            return

        if not is_configured():
            # Said out loud rather than passing quietly: a scheduled job that
            # silently never alerts looks identical to one where nothing has
            # gone wrong.
            self.stdout.write(self.style.WARNING("Telegram is not configured — no alerts sent."))
            return

        sent = alert_service_transitions(results)
        self.stdout.write(f"alerts sent: {len(sent)}")
