"""List the orders that were never real purchases. READ-ONLY.

    docker compose exec api python manage.py list_test_orders --check-freemius --ids-out /tmp/test-order-ids.txt

Runs inside a READ ONLY database transaction, so it cannot write even by
mistake. `--check-freemius` asks Freemius (GET only) whether each Freemius
order's licence is sandbox or live; without it no Freemius order is
selected. `--ids-out` writes the selected order ids, one per line, for
`cleanup_test_orders`. See apps/commerce/test_orders.py.
"""

from collections import Counter

from django.core.management.base import BaseCommand
from django.db import connection, transaction

from apps.commerce.test_orders import NEVER_SELECTED, TEST_CATEGORIES, classify, masked_email, orders_with_payments


class Command(BaseCommand):
    help = "List test orders (mock, Paddle, FastSpring, Freemius sandbox, unpaid). Read-only."

    def add_arguments(self, parser):
        parser.add_argument("--check-freemius", action="store_true", help="Ask Freemius whether each licence is sandbox or live.")
        parser.add_argument(
            "--category",
            action="append",
            choices=TEST_CATEGORIES,
            help="Select only these categories (repeatable). Default: all of " + ", ".join(TEST_CATEGORIES),
        )
        parser.add_argument("--ids-out", help="Write the selected order ids to this file, one per line.")

    def handle(self, *args, **options):
        selected_categories = set(options["category"] or TEST_CATEGORIES)
        with transaction.atomic():
            if connection.vendor == "postgresql":
                with connection.cursor() as cursor:
                    cursor.execute("SET TRANSACTION READ ONLY")
            rows = [classify(order, check_freemius=options["check_freemius"]) for order in orders_with_payments()]

        self.stdout.write(f"{'order':36}  {'created':16}  {'status':9}  {'category':18}  {'total':>9}  product/pack  email  note")
        for row in rows:
            order = row.order
            mark = "*" if row.category in selected_categories else " "
            self.stdout.write(
                f"{order.id}  {order.created_at:%Y-%m-%d %H:%M}  {order.status:9}  {mark}{row.category:17}  "
                f"{order.total_cents / 100:>6.2f} {order.currency}  "
                f"{order.product.slug if order.product_id else '-'}/{order.delivery_pack.slug if order.delivery_pack_id else '-'}  "
                f"{masked_email(order.guest_email)}  {row.note}"
            )

        counts = Counter(row.category for row in rows)
        selected = [row for row in rows if row.category in selected_categories and row.category not in NEVER_SELECTED]
        self.stdout.write("")
        self.stdout.write(f"{len(rows)} orders: " + ", ".join(f"{name} {count}" for name, count in sorted(counts.items())))
        self.stdout.write(f"Selected (*): {len(selected)}")
        if counts.get("freemius-unchecked"):
            self.stdout.write("Freemius orders were not checked: run with --check-freemius to classify them.")
        if counts.get("freemius-live") or counts.get("freemius-unknown") or counts.get("other"):
            self.stdout.write("Live, unknown and other orders are never selected.")

        if options["ids_out"]:
            with open(options["ids_out"], "w", encoding="utf-8") as handle:
                handle.writelines(f"{row.order.id}\n" for row in selected)
            self.stdout.write(f"Wrote {len(selected)} ids to {options['ids_out']}")
