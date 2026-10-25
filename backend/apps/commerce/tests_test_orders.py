"""`list_test_orders` and `cleanup_test_orders` (25 Oct 2026), the owner's
pre-launch tools for removing test orders from the real database. These run
only against the throwaway test database; the commands themselves are the
owner's to run against Supabase."""

import io
import os
import tempfile
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection, transaction
from django.test import TestCase

from apps.delivery.models import PublicExperience
from apps.delivery.tests import make_paid_order_with_entitlements
from apps.feedback.models import Feedback

from . import freemius_integration
from .freemius_integration import FreemiusLicense
from .models import Entitlement, Order, Payment
from .test_orders import classify


def _order(provider: str | None, reference: str | None = None, *, paid: bool = True, live_page: bool = False) -> Order:
    _, order, _ = make_paid_order_with_entitlements(target_ids=["print-png", *(["__live__"] if live_page else [])])
    if not paid:
        order.status = Order.STATUS_PENDING
        order.save(update_fields=["status"])
    if provider:
        Payment.objects.create(
            order=order,
            provider=provider,
            provider_reference=reference or f"ref-{order.id}",
            amount_cents=order.total_cents,
            currency=order.currency,
            status=Payment.STATUS_SUCCESS,
        )
    return order


def _license(environment):
    def get_license(license_id):
        return FreemiusLicense(
            id=license_id, plan_id="1", pricing_id=None, user_id="u", is_cancelled=False, environment=environment[license_id]
        )

    return get_license


class TestOrderClassificationTests(TestCase):
    def setUp(self):
        self.mock = _order("mock")
        self.paddle = _order("paddle")
        self.fastspring = _order("fastspring")
        self.sandbox = _order("freemius", "lic-sandbox")
        self.live = _order("freemius", "lic-live")
        self.unreadable = _order("freemius", "lic-gone")
        self.unpaid = _order(None, paid=False)
        self.environment = {"lic-sandbox": 1, "lic-live": 0}

    def _get_license(self, license_id):
        if license_id not in self.environment:
            raise freemius_integration.FreemiusApiError()
        return _license(self.environment)(license_id)

    def test_each_kind_of_order_gets_its_category(self):
        with patch.object(freemius_integration, "get_license", side_effect=self._get_license):
            got = {row.order.id: row.category for row in map(lambda o: classify(o, check_freemius=True), Order.objects.all())}
        self.assertEqual(got[self.mock.id], "mock")
        self.assertEqual(got[self.paddle.id], "paddle")
        self.assertEqual(got[self.fastspring.id], "fastspring")
        self.assertEqual(got[self.sandbox.id], "freemius-sandbox")
        self.assertEqual(got[self.live.id], "freemius-live")
        self.assertEqual(got[self.unreadable.id], "freemius-unknown")
        self.assertEqual(got[self.unpaid.id], "unpaid")

    def test_without_asking_freemius_no_freemius_order_is_selected(self):
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as folder:
            ids_path = os.path.join(folder, "ids.txt")
            call_command("list_test_orders", ids_out=ids_path, stdout=out)
            with open(ids_path, encoding="utf-8") as handle:
                ids = {line.strip() for line in handle}
        self.assertEqual(ids, {str(o.id) for o in (self.mock, self.paddle, self.fastspring, self.unpaid)})
        self.assertIn("freemius-unchecked", out.getvalue())

    def test_the_listing_selects_sandbox_never_live_or_unreadable(self):
        with tempfile.TemporaryDirectory() as folder:
            ids_path = os.path.join(folder, "ids.txt")
            with patch.object(freemius_integration, "get_license", side_effect=self._get_license):
                call_command("list_test_orders", check_freemius=True, ids_out=ids_path, stdout=io.StringIO())
            with open(ids_path, encoding="utf-8") as handle:
                ids = {line.strip() for line in handle}
        self.assertIn(str(self.sandbox.id), ids)
        self.assertNotIn(str(self.live.id), ids)
        self.assertNotIn(str(self.unreadable.id), ids)

    def test_the_listing_runs_in_a_read_only_transaction(self):
        """It cannot write even by mistake: a write inside its transaction
        fails in Postgres."""
        if connection.vendor != "postgresql":
            self.skipTest("read-only transactions are a Postgres guarantee")
        from apps.commerce.management.commands import list_test_orders

        def write_during_listing(order, *, check_freemius):
            Order.objects.filter(id=order.id).update(currency="EUR")

        with patch.object(list_test_orders, "classify", side_effect=write_during_listing):
            with self.assertRaises(Exception) as caught, transaction.atomic():
                call_command("list_test_orders", stdout=io.StringIO())
        self.assertIn("read-only", str(caught.exception).lower())


class TestOrderCleanupTests(TestCase):
    def setUp(self):
        self.mock = _order("mock", live_page=True)
        self.paddle = _order("paddle")
        self.keep = _order("mock")
        Feedback.objects.create(order=self.mock, rating=5, message="test")
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)

    def _ids_file(self, *orders) -> str:
        path = os.path.join(self.folder.name, "ids.txt")
        with open(path, "w", encoding="utf-8") as handle:
            handle.writelines(f"{order.id}\n" for order in orders)
        return path

    def test_a_dry_run_changes_nothing(self):
        out = io.StringIO()
        call_command("cleanup_test_orders", ids_file=self._ids_file(self.mock, self.paddle), stdout=out)
        self.assertIn("DRY RUN", out.getvalue())
        self.assertIn("Would delete: 2 orders, 2 payments, 3 entitlements, 1 live/AR links", out.getvalue())
        self.assertEqual(Order.objects.count(), 3)

    def test_execute_deletes_exactly_the_listed_orders_and_what_hangs_off_them(self):
        call_command(
            "cleanup_test_orders", ids_file=self._ids_file(self.mock, self.paddle), execute=True, confirm=2, stdout=io.StringIO()
        )
        self.assertEqual(list(Order.objects.values_list("id", flat=True)), [self.keep.id])
        self.assertFalse(Payment.objects.filter(order_id__in=[self.mock.id, self.paddle.id]).exists())
        self.assertFalse(Entitlement.objects.filter(order_id__in=[self.mock.id, self.paddle.id]).exists())
        self.assertFalse(PublicExperience.objects.filter(entitlement__order_id=self.mock.id).exists())
        # Feedback is kept, unlinked.
        self.assertTrue(Feedback.objects.filter(message="test", order__isnull=True).exists())
        self.assertTrue(Payment.objects.filter(order=self.keep).exists())

    def test_a_wrong_confirm_count_deletes_nothing(self):
        with self.assertRaises(CommandError):
            call_command(
                "cleanup_test_orders", ids_file=self._ids_file(self.mock, self.paddle), execute=True, confirm=1, stdout=io.StringIO()
            )
        self.assertEqual(Order.objects.count(), 3)

    def test_one_live_order_in_the_file_stops_the_whole_cleanup(self):
        live = _order("freemius", "lic-live")
        with patch.object(freemius_integration, "get_license", side_effect=_license({"lic-live": 0})):
            with self.assertRaises(CommandError) as caught:
                call_command(
                    "cleanup_test_orders",
                    ids_file=self._ids_file(self.mock, live),
                    check_freemius=True,
                    execute=True,
                    confirm=2,
                    stdout=io.StringIO(),
                )
        self.assertIn("Nothing was deleted", str(caught.exception))
        self.assertTrue(Order.objects.filter(id=self.mock.id).exists())
        self.assertTrue(Order.objects.filter(id=live.id).exists())

    def test_a_freemius_order_not_rechecked_is_refused(self):
        sandbox = _order("freemius", "lic-sandbox")
        with self.assertRaises(CommandError):
            call_command("cleanup_test_orders", ids_file=self._ids_file(sandbox), execute=True, confirm=1, stdout=io.StringIO())
        self.assertTrue(Order.objects.filter(id=sandbox.id).exists())
