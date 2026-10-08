"""
All Paddle-specific code lives in this module (and
`apps/commerce/payment_provider.py`, which wraps it behind the
provider-agnostic `PaymentProvider` interface). Nothing else in the
codebase imports `paddle_billing` directly.

Uses the official `paddle-python-sdk` (`paddle_billing` package) for
the two capabilities it covers cleanly: transaction creation and
webhook signature verification (`paddle_billing.Notifications.Verifier`,
which implements Paddle's documented `ts=...;h1=...` HMAC-SHA256
scheme plus timestamp-drift replay protection — see
`verify_webhook_signature` below). Webhook *payload* parsing is done
with plain `dict` access instead of the SDK's full typed notification
entity graph (`paddle_billing.Notifications.Entities.Transaction`,
etc.) — that graph is comprehensive but heavier than this MVP needs
(one event, four fields), and narrow manual parsing is easier to audit
and less brittle against fields the SDK's dataclasses don't yet model.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

from django.conf import settings

from paddle_billing import Client, Environment, Options
from paddle_billing.Entities.Shared.CurrencyCode import CurrencyCode
from paddle_billing.Entities.Shared.CustomData import CustomData
from paddle_billing.Entities.Shared.Money import Money
from paddle_billing.Entities.Shared.PriceQuantity import PriceQuantity
from paddle_billing.Entities.Shared.TaxCategory import TaxCategory
from paddle_billing.Notifications import Secret, Verifier
from paddle_billing.Resources.Transactions.Operations.CreateTransaction import CreateTransaction
from paddle_billing.Resources.Transactions.Operations.Create.TransactionCreateItemWithPrice import (
    TransactionCreateItemWithPrice,
)
from paddle_billing.Resources.Transactions.Operations.Price.TransactionNonCatalogPriceWithProduct import (
    TransactionNonCatalogPriceWithProduct,
)
from paddle_billing.Resources.Transactions.Operations.Price.TransactionNonCatalogProduct import (
    TransactionNonCatalogProduct,
)

logger = logging.getLogger("heartfolio")

# The one event this MVP acts on: Paddle's documented signal that a
# transaction's status has actually become "paid" (server-confirmed —
# distinct from `transaction.completed`, which fires later once Paddle
# has fully processed the transaction, and distinct from the browser
# merely completing Paddle.js checkout). This is deliberately the only
# event this integration treats as authoritative for granting
# entitlements.
TRANSACTION_PAID_EVENT = "transaction.paid"


class PaddleConfigurationError(Exception):
    """Paddle was selected as the active provider but required
    configuration is missing. In development this just means
    `get_payment_provider()` falls back to Mock (see
    payment_provider.py); in production,
    config/settings/production.py's settings-load-time check prevents
    the app from starting at all with this misconfiguration, so this
    exception should never actually surface there.
    """


class PaddleTransactionCreationFailed(Exception):
    """Wraps any Paddle SDK/network failure while creating a
    transaction, so callers don't need to know about
    `paddle_billing.Exceptions.ApiError` specifically.
    """


def get_paddle_client() -> Client:
    if not settings.PADDLE_API_KEY:
        raise PaddleConfigurationError("PADDLE_API_KEY is not configured.")
    environment = Environment.SANDBOX if settings.PADDLE_ENVIRONMENT == "sandbox" else Environment.PRODUCTION
    return Client(settings.PADDLE_API_KEY, options=Options(environment))


@dataclass(frozen=True)
class PaddleCheckoutResult:
    transaction_id: str
    status: str


#: What the customer reads in the Paddle overlay, and later on their card
#: statement and Paddle receipt. This used to send
#: `product.name_i18n_key`, so the checkout literally said
#: "loveStoryTimeline" — a frontend translation key, shown to a paying
#: customer at the least reassuring possible moment.
#:
#: The name lives here rather than in the database because Django has no
#: human-readable product name at all: `Product` stores only a slug and an
#: i18n key, and every display name resolves in the frontend messages
#: files. Adding a column for two rows would be a migration for data that
#: is not otherwise needed server-side.
#:
#: Deliberately NOT localised. Paddle records one product name per
#: transaction, which then appears on receipts and in reconciliation and
#: analytics — a name that varied by the buyer's locale would make the
#: same product look like several different ones.
_PRODUCT_DISPLAY_NAMES = {
    "love-story-timeline": "Love Story Timeline",
    # The slug and the public name deliberately differ for this one — see
    # `toBackendProductId()` on the frontend. Deriving the name from the
    # slug would bill it as "Heart Map", which is not a name the customer
    # ever saw.
    "heart-map": "Where We Met",
}


def _paddle_product_name(product_slug: str) -> str:
    """`Heartfolio — <product>`, falling back to a readable form of the
    slug so a newly seeded product can never reintroduce a raw key.
    """
    display = _PRODUCT_DISPLAY_NAMES.get(product_slug)
    if display is None:
        display = product_slug.replace("-", " ").replace("_", " ").title()
    return f"Heartfolio — {display}"


def create_transaction(order) -> PaddleCheckoutResult:
    """Creates a Paddle transaction for a **non-catalog** item — Paddle
    Billing's documented capability for charging an amount without a
    pre-existing catalog Product/Price
    (developer.paddle.com/build/transactions/bill-create-custom-items-prices-products).
    Heartfolio's database (`DeliveryPack.price_cents`) remains the sole
    source of the amount; nothing here reads from or writes to a Paddle
    catalog, and no Paddle catalog id is persisted anywhere.

    The Heartfolio order id is carried in `custom_data.orderId` — a
    stable identifier the webhook uses to resolve the transaction back
    to an `Order` deterministically (never inferred from email, amount,
    or product name).
    """
    client = get_paddle_client()

    price = TransactionNonCatalogPriceWithProduct(
        # LOCKED TO EXACTLY ONE. Paddle's overlay checkout lets customers
        # change item quantities by default, so the order screen showed a
        # "Quantity 1" stepper — and nothing stopped someone setting it to
        # 3. A keepsake is built from one specific project; three of them
        # is not a product we sell, and Paddle would have charged for it
        # while Django granted entitlements for a single order.
        #
        # Paddle's documented way to remove the control is quantity limits
        # on the price, which is why this lives here rather than in a
        # dashboard setting: the price is created per order, in code.
        quantity=PriceQuantity(minimum=1, maximum=1),
        description=f"Heartfolio order {order.id}",
        unit_price=Money(str(order.total_cents), CurrencyCode(order.currency)),
        product=TransactionNonCatalogProduct(
            name=_paddle_product_name(order.product.slug),
            # `digital-goods`, not `standard`. This decides how VAT is
            # applied in every country where Paddle acts as Merchant of
            # Record, so it is a tax decision rather than a code one — and
            # it is the seller's to make, not this file's. Recorded here
            # because a future reader will otherwise assume `standard` was
            # simply never revisited.
            #
            # IF CHECKOUT SUDDENLY FAILS TO CREATE TRANSACTIONS, look here
            # first: Paddle approves accounts for specific tax categories,
            # and a category the account is not approved for is rejected at
            # transaction-creation time, not at deploy time. The error
            # surfaces as `paddle_transaction_create_failed` in the logs.
            tax_category=TaxCategory.DigitalGoods,
        ),
    )
    operation = CreateTransaction(
        items=[TransactionCreateItemWithPrice(price=price, quantity=1)],
        custom_data=CustomData({"orderId": str(order.id)}),
    )

    try:
        transaction = client.transactions.create(operation)
    except Exception as exc:  # paddle_billing.Exceptions.ApiError, or a network failure
        # Never log exc's str() unfiltered — ApiError messages don't
        # carry secrets, but this keeps the boundary explicit rather
        # than assuming that will always hold.
        logger.error("paddle_transaction_create_failed", extra={"order_id": str(order.id)})
        raise PaddleTransactionCreationFailed() from exc

    return PaddleCheckoutResult(transaction_id=transaction.id, status=str(transaction.status))


class _DjangoWebhookRequest:
    """Adapts a Django `HttpRequest` to the small `Protocol` the Paddle
    SDK's `Verifier.verify()` expects (`body: bytes`, `headers` with a
    `.get()` method) — Django's own request object already satisfies
    both, so this is just an explicit, minimal wrapper rather than
    passing the request through untyped.
    """

    def __init__(self, django_request):
        self.body = django_request.body
        self.headers = django_request.headers


def verify_webhook_signature(django_request, raw_body: bytes) -> bool:
    """Verifies the `Paddle-Signature` header against `raw_body` using
    the documented algorithm (`ts=<unix_ts>;h1=<hmac_sha256>`, signed
    payload `f"{ts}:{raw_body}"`, timing-safe comparison) via the
    official SDK's `Verifier`, which also enforces the default 5-second
    timestamp-drift tolerance (replay protection) unless disabled.

    Must be called with the untouched raw body — see the module
    docstring in `apps/commerce/webhook_views.py` for why this can
    never be `json.dumps(json.loads(raw_body))` or any other
    re-serialized form.
    """
    if not settings.PADDLE_WEBHOOK_SECRET:
        raise PaddleConfigurationError("PADDLE_WEBHOOK_SECRET is not configured.")

    request_adapter = _DjangoWebhookRequest(django_request)
    request_adapter.body = raw_body  # explicit, in case django_request.body was already consumed elsewhere

    try:
        return Verifier().verify(request_adapter, Secret(settings.PADDLE_WEBHOOK_SECRET))
    except (ValueError, ConnectionRefusedError):
        # ValueError: malformed/missing Paddle-Signature header.
        # ConnectionRefusedError: the SDK's own signal for "signature
        # present but did not match" when given a single Secret.
        return False


@dataclass(frozen=True)
class PaddleWebhookEvent:
    event_type: str
    transaction_id: str | None
    transaction_status: str | None
    currency_code: str | None
    total_cents: str | None  # Paddle sends totals as a string of minor units, e.g. "1200"
    order_id: str | None  # from custom_data.orderId — the one stable Heartfolio reference
    #: Two-letter buyer country, from Paddle's own record (§7a).
    #:
    #: Heartfolio has never asked a customer for their country — nothing is
    #: shipped — but Paddle captures it on every transaction for tax and VAT
    #: compliance. Reading it here is reading Paddle's data, not adding a
    #: checkout field.
    #:
    #: Optional, and treated as such everywhere downstream. Paddle does not
    #: guarantee an address on every webhook, so this is None often enough
    #: that reports must show an "Unknown" bucket rather than pretending
    #: coverage is complete.
    country_code: str | None


def parse_webhook_payload(raw_body: bytes) -> PaddleWebhookEvent:
    """Parses the verified webhook body. Only called *after*
    `verify_webhook_signature` succeeds — see webhook_views.py.
    """
    try:
        payload: dict[str, Any] = json.loads(raw_body)
    except json.JSONDecodeError as exc:
        raise ValueError("Webhook payload is not valid JSON.") from exc

    data = payload.get("data") or {}
    custom_data = data.get("custom_data") or {}
    totals = (data.get("details") or {}).get("totals") or {}
    # Defensive: Paddle includes an address on transaction events when one
    # exists, but does not promise it. Every level is optional.
    address = data.get("address") or {}

    return PaddleWebhookEvent(
        event_type=payload.get("event_type", ""),
        transaction_id=data.get("id"),
        transaction_status=data.get("status"),
        currency_code=data.get("currency_code"),
        total_cents=totals.get("total"),
        order_id=custom_data.get("orderId"),
        country_code=(address.get("country_code") or None),
    )
