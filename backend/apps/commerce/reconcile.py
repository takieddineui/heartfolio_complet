"""Verify & Reconcile (§8).

THE RULE THIS EXISTS TO PRESERVE: nobody manually decides an order is paid.
§8 is explicit — there is no raw status override, and Paddle is always the
source of truth rather than a person's read of a balance screen.

HOW THAT IS ACHIEVED, AND WHY IT IS BARELY ANY CODE
----------------------------------------------------
§8 asks for "the exact verification logic the webhook already uses, just
triggered manually instead of pushed". Taken literally, that means this
module must not contain verification logic at all.

So it does not. It fetches the transaction from Paddle, packages it into the
same `PaddleWebhookEvent` the webhook handler receives, and calls
`confirm_paddle_webhook_payment` — the identical function, with its
identical currency check, amount check, transaction-belongs-to-this-order
check, locking and idempotency. A second implementation would be a second
thing to keep correct, and the one that drifted would be the one nobody
tests, because it only runs when something has already gone wrong.

THE ONE CHECK THIS PATH MUST ADD
---------------------------------
The webhook route only ever runs for a `transaction.paid` event, so the
event type itself is proof the payment succeeded. Fetching a transaction by
id proves nothing — Paddle returns failed, cancelled and draft transactions
just as readily. Reconciling one of those would mark an order paid that
never was, which is precisely the outcome §8's "no manual override" rule
exists to prevent, arrived at by a different route.

`is_completed` is therefore checked here, before anything is constructed.
"""

from __future__ import annotations

import logging

from .models import Order
from .paddle_integration import PaddleWebhookEvent
from .paddle_read import PaddleTransaction, PaddleUnavailable, fetch_transaction
from .services import confirm_paddle_webhook_payment

logger = logging.getLogger("heartfolio")


class ReconcileRefused(Exception):
    """Paddle did not confirm this transaction as a payment for this order."""


def reconcile_order_from_paddle(order: Order, transaction_id: str) -> str:
    """Marks an order paid ONLY if Paddle confirms it.

    Returns a short description of what happened, for display.

    Every refusal raises rather than returning a falsy value, so a caller
    cannot accidentally treat "not confirmed" as success by forgetting to
    check a return.
    """
    if order.status == Order.STATUS_PAID:
        return "This order was already paid — nothing to reconcile."

    try:
        transaction = fetch_transaction(transaction_id)
    except PaddleUnavailable as exc:
        # Deliberately not folded into "no match". Staff must never read an
        # outage as proof a payment does not exist — the conclusion they
        # would draw is the opposite of the truth.
        raise ReconcileRefused(f"Could not reach Paddle: {exc}")

    if transaction is None:
        raise ReconcileRefused("Paddle has no transaction with that ID.")

    if not transaction.is_completed:
        raise ReconcileRefused(
            f"Paddle reports this transaction as '{transaction.status}', not a completed payment."
        )

    if transaction.order_id and transaction.order_id != str(order.id):
        # Caught here as well as inside the shared verification, because the
        # message can be specific at this point and a staff member acting on
        # a support ticket deserves to know they have the wrong row rather
        # than a generic verification failure.
        raise ReconcileRefused("That Paddle transaction belongs to a different order.")

    event = _event_from(transaction, order)

    try:
        confirm_paddle_webhook_payment(event)
    except Exception as exc:
        # The shared verification refused: currency mismatch, amount
        # mismatch, or the transaction already attached elsewhere. Surfaced
        # verbatim — those messages are the reason to trust this at all.
        logger.warning(
            "reconcile_verification_failed",
            extra={"order_id": str(order.id), "transaction_id": transaction_id, "error": str(exc)},
        )
        raise ReconcileRefused(str(exc))

    logger.info(
        "order_reconciled_from_paddle",
        extra={"order_id": str(order.id), "transaction_id": transaction_id},
    )
    return "Paddle confirmed the payment. The order is now paid and its files have been granted."


def _event_from(transaction: PaddleTransaction, order: Order) -> PaddleWebhookEvent:
    """Packages a fetched transaction as the event the webhook would have
    delivered.

    `order_id` is taken from the transaction's own `custom_data` when Paddle
    has it, and only falls back to the order being reconciled when it does
    not. That ordering matters: preferring the order under the operator's
    cursor would let a mistyped search reconcile a real payment against the
    wrong order, with the shared verification none the wiser because the
    amounts might well match.
    """
    return PaddleWebhookEvent(
        event_type="transaction.paid",
        transaction_id=transaction.id,
        # Paddle's own reported status, passed through rather than asserted
        # as "paid". `is_completed` above has already refused anything that
        # is not a completed payment; forcing the string here would hide
        # what Paddle actually said from anything downstream that reads it.
        transaction_status=transaction.status,
        currency_code=transaction.currency,
        total_cents=transaction.total_cents,
        order_id=transaction.order_id or str(order.id),
        country_code=None,
    )
