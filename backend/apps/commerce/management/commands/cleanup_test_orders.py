"""Delete test orders chosen by `list_test_orders`. DRY RUN unless --execute.

    docker compose exec api python manage.py cleanup_test_orders --ids-file /tmp/test-order-ids.txt
    docker compose exec api python manage.py cleanup_test_orders --ids-file /tmp/test-order-ids.txt --check-freemius --execute --confirm 31

Deletes only the ids in the file, and only after classifying each one again
the same way the listing did: if any id is no longer a test order (a live
Freemius licence, an order whose licence cannot be read, a Freemius order not
re-checked), nothing at all is deleted. `--confirm` must equal the number of
orders about to be deleted. One transaction: all or nothing.

Deleting an order deletes its payments, entitlements and live/AR links.
Feedback and Freemius checkout rows lose their link to it and are kept.
Projects, customers and uploaded photos are not touched.
"""

from collections import Counter

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.commerce.models import Entitlement, Payment
from apps.commerce.test_orders import NEVER_SELECTED, TEST_CATEGORIES, classify, orders_with_payments
from apps.delivery.models import PublicExperience


class Command(BaseCommand):
    help = "Delete the test orders listed in --ids-file (dry run unless --execute)."

    def add_arguments(self, parser):
        parser.add_argument("--ids-file", required=True, help="Order ids, one per line (from list_test_orders --ids-out).")
        parser.add_argument("--check-freemius", action="store_true", help="Re-check Freemius licences (needed for Freemius orders).")
        parser.add_argument("--execute", action="store_true", help="Actually delete. Without it, nothing changes.")
        parser.add_argument("--confirm", type=int, help="With --execute: the number of orders you expect to delete.")

    def handle(self, *args, **options):
        with open(options["ids_file"], encoding="utf-8") as handle:
            ids = [line.strip() for line in handle if line.strip()]
        if not ids:
            raise CommandError("The ids file is empty.")

        with transaction.atomic():
            orders = list(orders_with_payments(ids).select_for_update(of=("self",)))
            missing = sorted(set(ids) - {str(order.id) for order in orders})
            rows = [classify(order, check_freemius=options["check_freemius"]) for order in orders]
            refused = [row for row in rows if row.category not in TEST_CATEGORIES or row.category in NEVER_SELECTED]

            for row in rows:
                self.stdout.write(f"{row.order.id}  {row.category}  {row.order.total_cents / 100:.2f} {row.order.currency}  {row.note}")
            if missing:
                self.stdout.write(f"{len(missing)} ids are not in the database (already deleted?): " + ", ".join(missing[:5]))
            if refused:
                raise CommandError(
                    f"{len(refused)} of these are not test orders now ("
                    + ", ".join(f"{row.order.id}: {row.category}" for row in refused[:5])
                    + "). Nothing was deleted."
                )

            order_ids = [row.order.id for row in rows]
            effects = {
                "orders": len(order_ids),
                "payments": Payment.objects.filter(order_id__in=order_ids).count(),
                "entitlements": Entitlement.objects.filter(order_id__in=order_ids).count(),
                "live/AR links": PublicExperience.objects.filter(entitlement__order_id__in=order_ids).count(),
            }
            counts = Counter(row.category for row in rows)
            self.stdout.write("By category: " + ", ".join(f"{name} {count}" for name, count in sorted(counts.items())))
            self.stdout.write("Would delete: " + ", ".join(f"{count} {name}" for name, count in effects.items()))

            if not options["execute"]:
                self.stdout.write("DRY RUN: nothing was deleted. Add --execute --confirm N to delete.")
                return
            if options["confirm"] != len(order_ids):
                raise CommandError(f"--confirm must be {len(order_ids)}, the number of orders to delete. Nothing was deleted.")

            for row in rows:
                row.order.delete()
            self.stdout.write(self.style.SUCCESS(f"Deleted {len(order_ids)} test orders."))
