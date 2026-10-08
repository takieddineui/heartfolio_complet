"""Tests for Verify & Reconcile (§8).

§8's rule is that nobody manually decides an order is paid. Almost every
test here is a refusal — the ways this screen must decline to mark an order
paid, because the one thing it must never do is become a status toggle by
another name.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, override_settings

from apps.commerce import paddle_read, reconcile
from apps.commerce.paddle_read import PaddleTransaction, PaddleUnavailable
from apps.commerce.reconcile import ReconcileRefused, reconcile_order_from_paddle


def transaction(**overrides):
    data = {
        "id": "txn_1",
        "status": "completed",
        "currency": "USD",
        "total_cents": "1800",
        "order_id": None,
        "customer_email": "a@example.com",
        "created_at": "2026-08-31T00:00:00Z",
    }
    data.update(overrides)
    return PaddleTransaction(**data)


def order(status="pending", total_cents=1800):
    return SimpleNamespace(
        id=uuid.uuid4(), status=status, total_cents=total_cents, currency="USD",
        guest_email="a@example.com", payments=SimpleNamespace(all=lambda: []),
    )


class ReconcileRefusalTests(SimpleTestCase):
    def test_a_transaction_paddle_does_not_call_completed_is_refused(self):
        """The check the manual path must add for itself.

        The webhook route only runs for a `transaction.paid` event, so the
        event type proves success. Fetching by id proves nothing — Paddle
        returns failed, cancelled and draft transactions just as readily,
        and reconciling one would mark an order paid that never was.
        """
        for status in ("draft", "ready", "canceled", "past_due"):
            with patch.object(reconcile, "fetch_transaction", return_value=transaction(status=status)):
                with self.assertRaises(ReconcileRefused) as ctx:
                    reconcile_order_from_paddle(order(), "txn_1")
                self.assertIn(status, str(ctx.exception))

    def test_a_transaction_stamped_with_another_order_is_refused(self):
        other = str(uuid.uuid4())
        with patch.object(reconcile, "fetch_transaction", return_value=transaction(order_id=other)):
            with self.assertRaises(ReconcileRefused) as ctx:
                reconcile_order_from_paddle(order(), "txn_1")
            self.assertIn("different order", str(ctx.exception))

    def test_an_unknown_transaction_is_refused(self):
        with patch.object(reconcile, "fetch_transaction", return_value=None):
            with self.assertRaises(ReconcileRefused):
                reconcile_order_from_paddle(order(), "txn_nope")

    def test_an_outage_is_never_reported_as_absence(self):
        """Staff must not read "Paddle is down" as "no payment exists" — the
        conclusion they would draw is the opposite of the truth."""
        with patch.object(reconcile, "fetch_transaction", side_effect=PaddleUnavailable("timeout")):
            with self.assertRaises(ReconcileRefused) as ctx:
                reconcile_order_from_paddle(order(), "txn_1")
            self.assertIn("Could not reach Paddle", str(ctx.exception))

    def test_an_already_paid_order_is_a_no_op_not_a_second_payment(self):
        result = reconcile_order_from_paddle(order(status="paid"), "txn_1")
        self.assertIn("already paid", result)


class ReconcileVerificationReuseTests(SimpleTestCase):
    """§8: "the exact verification logic the webhook already uses"."""

    def test_it_calls_the_webhook_confirmation_rather_than_its_own_checks(self):
        # A second implementation would be a second thing to keep correct,
        # and the one that drifted would be the one nobody tests — it only
        # runs when something has already gone wrong.
        with patch.object(reconcile, "fetch_transaction", return_value=transaction()):
            with patch.object(reconcile, "confirm_paddle_webhook_payment") as confirm:
                reconcile_order_from_paddle(order(), "txn_1")
        confirm.assert_called_once()

    def test_a_refusal_from_the_shared_verification_is_surfaced_verbatim(self):
        # Those messages — currency mismatch, amount mismatch — are the
        # reason to trust this screen. "Verification failed" would tell
        # staff nothing about whether to escalate.
        with patch.object(reconcile, "fetch_transaction", return_value=transaction()):
            with patch.object(
                reconcile, "confirm_paddle_webhook_payment",
                side_effect=Exception("Webhook amount does not match the order's total."),
            ):
                with self.assertRaises(ReconcileRefused) as ctx:
                    reconcile_order_from_paddle(order(), "txn_1")
        self.assertIn("amount does not match", str(ctx.exception))

    def test_the_event_prefers_paddles_own_order_id_over_the_one_on_screen(self):
        """Preferring the order under the operator's cursor would let a
        mistyped search reconcile a real payment against the wrong order,
        with the shared verification none the wiser if the amounts match."""
        target = order()
        stamped = str(target.id)
        with patch.object(reconcile, "fetch_transaction", return_value=transaction(order_id=stamped)):
            with patch.object(reconcile, "confirm_paddle_webhook_payment") as confirm:
                reconcile_order_from_paddle(target, "txn_1")
        self.assertEqual(confirm.call_args.args[0].order_id, stamped)


class PaddleReadTests(SimpleTestCase):
    @override_settings(PADDLE_API_KEY="", PADDLE_ENVIRONMENT="sandbox")
    def test_no_api_key_is_an_outage_not_an_empty_result(self):
        with self.assertRaises(PaddleUnavailable):
            paddle_read.fetch_transaction("txn_1")

    @override_settings(PADDLE_API_KEY="k", PADDLE_ENVIRONMENT="sandbox")
    def test_sandbox_and_production_use_different_hosts(self):
        with patch.object(paddle_read.requests, "get", return_value=MagicMock(status_code=200, json=lambda: {"data": []})) as get:
            paddle_read.fetch_transaction("txn_1")
        self.assertIn("sandbox-api.paddle.com", get.call_args.args[0])

    @override_settings(PADDLE_API_KEY="k", PADDLE_ENVIRONMENT="production")
    def test_production_uses_the_live_host(self):
        with patch.object(paddle_read.requests, "get", return_value=MagicMock(status_code=200, json=lambda: {"data": []})) as get:
            paddle_read.fetch_transaction("txn_1")
        self.assertIn("//api.paddle.com", get.call_args.args[0])

    @override_settings(PADDLE_API_KEY="k", PADDLE_ENVIRONMENT="sandbox")
    def test_customer_lookup_uses_exact_email_not_fuzzy_search(self):
        """`search` is fuzzy across id, name and email and could return a
        DIFFERENT customer whose details merely resemble the query.
        Presenting someone else's transactions as reconciliation candidates
        is the worst failure available here."""
        with patch.object(paddle_read.requests, "get", return_value=MagicMock(status_code=200, json=lambda: {"data": []})) as get:
            paddle_read.find_transactions_for_email("a@example.com")
        params = get.call_args.kwargs["params"]
        self.assertEqual(params.get("email"), "a@example.com")
        self.assertNotIn("search", params)

    @override_settings(PADDLE_API_KEY="k", PADDLE_ENVIRONMENT="sandbox")
    def test_a_paddle_error_raises_rather_than_returning_nothing(self):
        with patch.object(paddle_read.requests, "get", return_value=MagicMock(status_code=500, text="boom")):
            with self.assertRaises(PaddleUnavailable):
                paddle_read.fetch_transaction("txn_1")
