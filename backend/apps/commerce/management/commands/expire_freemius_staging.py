"""Marks stale Freemius checkout-staging rows expired.

Run on a schedule (any scheduler; hourly is plenty given the 1-hour
window):

    python manage.py expire_freemius_staging

Mirrors `apps.assets.management.commands.expire_provisional_assets`'s
own shape — see that command's docstring for the same "half of a
deferred-creation design" reasoning. A `FreemiusCheckoutStaging` row
that is still `awaiting_payment` past its `expires_at` was abandoned
(the customer never paid, or paid so long after opening checkout that
treating it as the same attempt would be wrong) — marking it `expired`
means a very late or replayed webhook can no longer resurrect it (see
`services.py::_complete_freemius_purchase`, which raises
`FreemiusStagingExpired` for anything not `awaiting_payment`).

No storage/external cleanup needed here, unlike the asset command — a
staging row has nothing outside the database to clean up, so this is a
plain status update, not a two-phase delete.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.utils import timezone


class Command(BaseCommand):
    help = "Marks awaiting_payment FreemiusCheckoutStaging rows past their expiry as expired."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="List what would be expired without changing anything.",
        )

    def handle(self, *args, **options):
        from apps.commerce.models import FreemiusCheckoutStaging

        stale = FreemiusCheckoutStaging.objects.filter(
            status=FreemiusCheckoutStaging.STATUS_AWAITING_PAYMENT,
            expires_at__lte=timezone.now(),
        )

        count = stale.count()
        if count == 0:
            self.stdout.write("No Freemius checkout-staging rows are past their expiry window.")
            return

        if options["dry_run"]:
            for staging in stale:
                self.stdout.write(f"would expire {staging.id} (expired {staging.expires_at})")
            self.stdout.write(f"{count} row(s) would be expired. Re-run without --dry-run to expire them.")
            return

        updated = stale.update(status=FreemiusCheckoutStaging.STATUS_EXPIRED)
        self.stdout.write(f"Expired {updated} Freemius checkout-staging row(s).")
