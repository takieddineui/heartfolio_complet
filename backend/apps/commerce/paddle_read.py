"""Reading Paddle's own records, for manual reconciliation (§8).

Read-only. Nothing here creates, updates or refunds anything in Paddle — the
whole point of §8 is that Paddle is the source of truth and Heartfolio asks
it questions, never the other way round.

WHAT PADDLE'S API CAN AND CANNOT BE ASKED, which shapes everything below:

  * `GET /transactions?id=` — direct lookup by transaction id.
  * `GET /customers?email=` — exact match. `?search=` is fuzzy across id,
    name and email.
  * `GET /transactions?customer_id=` — that customer's transactions.
  * **There is NO way to filter transactions by `custom_data`.**

That last one decides the design. Heartfolio's `orderId` lives in
`custom_data`, so "find the Paddle transaction for this order" cannot be a
query. For orders that received a webhook it does not need to be — the
transaction id is already stored on the `Payment` row. But §8 exists for the
orders that never received one, and those have no stored id.

So the path for the case that matters is: order → its customer email →
Paddle customer → that customer's transactions → match `custom_data.orderId`
in Python. It works because the order always carries the buyer's email, and
it is the only route Paddle's filtering actually allows.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import requests
from django.conf import settings

logger = logging.getLogger("heartfolio")

_TIMEOUT_SECONDS = 15
#: Enough to cover any realistic buyer's history without paging. A customer
#: with more transactions than this is not the support case §8 is for.
_PAGE_SIZE = 50


class PaddleUnavailable(Exception):
    """Paddle could not be reached or refused the request.

    Distinct from "no match found": staff must never read an outage as
    proof that a payment does not exist, because the conclusion they would
    draw from that is the opposite of the truth.
    """


@dataclass
class PaddleTransaction:
    id: str
    status: str
    currency: str
    total_cents: str | None
    order_id: str | None
    customer_email: str | None
    created_at: str

    @property
    def is_completed(self) -> bool:
        """Paddle's terminal success states for a one-off purchase.

        Checked explicitly because the manual path does NOT get this for
        free. The webhook route only ever runs for a `transaction.paid`
        event, so the event type itself proves success. Fetching a
        transaction by id proves nothing — it returns failed, cancelled and
        draft transactions just as readily, and reconciling one of those
        would mark an order paid that never was.
        """
        return self.status in {"completed", "paid", "billed"}


def _base_url() -> str:
    return (
        "https://sandbox-api.paddle.com"
        if settings.PADDLE_ENVIRONMENT == "sandbox"
        else "https://api.paddle.com"
    )


def _get(path: str, params: dict | None = None) -> dict:
    if not settings.PADDLE_API_KEY:
        raise PaddleUnavailable("No Paddle API key is configured in this environment.")

    try:
        response = requests.get(
            f"{_base_url()}{path}",
            headers={"Authorization": f"Bearer {settings.PADDLE_API_KEY}"},
            params=params or {},
            timeout=_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise PaddleUnavailable(str(exc))

    if response.status_code == 404:
        return {"data": []}
    if response.status_code >= 400:
        logger.error(
            "paddle_read_failed",
            extra={"path": path, "status_code": response.status_code, "body": response.text[:300]},
        )
        raise PaddleUnavailable(f"Paddle returned HTTP {response.status_code}.")

    return response.json()


def _to_transaction(raw: dict) -> PaddleTransaction:
    details = raw.get("details") or {}
    totals = details.get("totals") or {}
    custom = raw.get("custom_data") or {}
    customer = raw.get("customer") or {}

    return PaddleTransaction(
        id=raw.get("id", ""),
        status=raw.get("status", ""),
        currency=totals.get("currency_code") or raw.get("currency_code") or "",
        total_cents=totals.get("total"),
        order_id=custom.get("orderId"),
        customer_email=customer.get("email"),
        created_at=raw.get("created_at", ""),
    )


def fetch_transaction(transaction_id: str) -> PaddleTransaction | None:
    """One transaction by its Paddle id — the path when staff can read the
    id off Paddle's own dashboard."""
    payload = _get("/transactions", {"id": transaction_id, "include": "customer"})
    rows = payload.get("data") or []
    return _to_transaction(rows[0]) if rows else None


def find_transactions_for_email(email: str) -> list[PaddleTransaction]:
    """Every transaction belonging to the customer with this email.

    Two calls, because Paddle has no transaction-by-email filter. The exact
    `email` parameter is used rather than `search`: a fuzzy match across id,
    name and email could return a *different* customer whose details merely
    resemble the query, and presenting someone else's transactions as
    candidates for reconciliation is the worst possible failure here.
    """
    customers = (_get("/customers", {"email": email}).get("data") or [])
    if not customers:
        return []

    transactions: list[PaddleTransaction] = []
    for customer in customers:
        payload = _get(
            "/transactions",
            {"customer_id": customer.get("id"), "per_page": _PAGE_SIZE, "include": "customer"},
        )
        transactions.extend(_to_transaction(row) for row in payload.get("data") or [])
    return transactions


def find_transactions_for_order(order) -> list[PaddleTransaction]:
    """Candidates for one Heartfolio order.

    Tries the stored transaction id first — present whenever checkout got as
    far as creating a `Payment`, which is most of the time even when the
    webhook never arrived.

    Falls back to the customer's email, then matches `custom_data.orderId`
    in Python because Paddle cannot filter on it. Transactions that name a
    DIFFERENT order are dropped rather than shown: the whole risk of a
    candidate list is someone confirming the wrong row, and a transaction
    explicitly stamped with another order is not a candidate for this one.
    Transactions with no `orderId` at all are kept, since those are exactly
    the malformed cases worth a human's eyes.
    """
    stored_ids = [
        payment.provider_reference
        for payment in order.payments.all()
        if payment.provider == "paddle" and payment.provider_reference
    ]

    found: dict[str, PaddleTransaction] = {}
    for transaction_id in stored_ids:
        transaction = fetch_transaction(transaction_id)
        if transaction:
            found[transaction.id] = transaction

    for transaction in find_transactions_for_email(order.guest_email):
        if transaction.order_id and transaction.order_id != str(order.id):
            continue
        found.setdefault(transaction.id, transaction)

    return sorted(found.values(), key=lambda t: t.created_at, reverse=True)
