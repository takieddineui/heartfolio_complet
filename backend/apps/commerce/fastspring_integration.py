"""
All FastSpring-specific code lives in this module (and
`apps/commerce/payment_provider.py`, which wraps it behind the
provider-agnostic `PaymentProvider` interface, exactly like Paddle).
Nothing else in the codebase imports `requests` for FastSpring, or
knows a FastSpring product path exists.

FastSpring has no official Python SDK — unlike `paddle_integration.py`,
which delegates to `paddle_billing`, this module talks to FastSpring's
REST API directly over `requests` (see `requirements/base.txt` for why
that's now an explicit dependency rather than an accidental transitive
one).

---------------------------------------------------------------------
CATALOG PRODUCTS, DJANGO PRICES — THE SAME TENSION PADDLE NEVER HAD
---------------------------------------------------------------------
Paddle's integration is deliberately non-catalog: `create_transaction`
builds a price from `order.total_cents` alone, so Paddle's own catalog
never enters the picture and can never disagree with Django. FastSpring
is the opposite shape by design — the ten SKUs in `PACK_SLUG_TO_PRODUCT_PATH`
below are real, already-created dashboard products, each with its own
configured price, which is a second, independent source of truth for
"what does this cost" that didn't exist before.

`create_session` closes that gap the same way Paddle's non-catalog price
closes its own: every session carries a `pricing` override
(`cart.lineItems[].pricing.price`) set to `order.total_cents`, in
addition to the real product path. The product path is FastSpring's
identity for the SKU (reporting, tax categorization, the dashboard);
the override is what FastSpring actually charges. A stale dashboard
price becomes a cosmetic mismatch a human might notice in FastSpring's
own UI, never a customer charged the wrong amount — Django's price
still wins outright, exactly as it already does for Paddle.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

import requests
from django.conf import settings

logger = logging.getLogger("heartfolio")

FASTSPRING_API_BASE = "https://api.fastspring.com"
REQUEST_TIMEOUT_SECONDS = 15

# The one event this integration acts on: FastSpring's documented signal
# that an order was successfully processed — the direct analog of Paddle's
# TRANSACTION_PAID_EVENT ("transaction.paid"). `order.failed` and
# `order.canceled` are real, documented events too; they are logged and
# ignored the same way any non-transaction.paid Paddle event is today (see
# webhook_views.py).
ORDER_COMPLETED_EVENT = "order.completed"
ORDER_FAILED_EVENT = "order.failed"
ORDER_CANCELED_EVENT = "order.canceled"


class FastSpringConfigurationError(Exception):
    """FastSpring was selected as the active provider but required
    configuration is missing, or a pack has no FastSpring product path
    mapped. In development this only matters if PAYMENT_PROVIDER=fastspring
    is actually set; in production,
    config/settings/production.py's settings-load-time check prevents the
    app from starting at all with missing credentials, so the credential
    half of this exception should never actually surface there — the
    missing-product-path half can still fire at checkout time if a new
    pack is seeded without updating PACK_SLUG_TO_PRODUCT_PATH, which is
    exactly what the "every active DeliveryPack has a mapping" test
    exists to catch before that ever happens for real.
    """


class FastSpringSessionCreationFailed(Exception):
    """Wraps any FastSpring Sessions API/network failure while creating a
    session, so callers don't need to know about `requests.RequestException`
    specifically — mirrors `PaddleTransactionCreationFailed`.
    """


@dataclass(frozen=True)
class FastSpringCheckoutResult:
    session_id: str
    #: `checkoutUrls.webcheckoutUrl` from the Sessions API response — a
    #: redirect fallback. The primary path is the Store Builder Library
    #: popup, opened client-side with `session_id` (frontend follow-up
    #: task); this is kept for whichever the frontend ends up using, or
    #: both.
    checkout_url: str | None


#: ---------------------------------------------------------------------
#: WHICH FASTSPRING PRODUCT PATH A DELIVERY PACK CHECKS OUT AS
#: ---------------------------------------------------------------------
#: Ten real, already-created FastSpring dashboard products — confirmed
#: directly (not derived), one per sellable DeliveryPack across Love Story
#: Timeline and Song Poster's five-tier pricing.
#:
#: A DICT, DELIBERATELY, NOT A DeliveryPack.external_product_path COLUMN —
#: the same reasoning `_PRODUCT_DISPLAY_NAMES` already uses in
#: paddle_integration.py, extended: this is a small, fixed, rarely-changing
#: table (ten entries, all confirmed today), not something that grows per
#: order or per customer, and `apps/products/models.py`'s own docstring
#: treats the current schema as "approved" — adding a column here is a
#: schema-governance question, not just an engineering one. The real risk
#: a hardcoded dict carries — a new pack shipping with no matching entry,
#: exactly the `supported_targets` incident CLAUDE.md already documents
#: for a different pair of hardcoded maps — is closed with a test
#: (`test_every_active_delivery_pack_has_a_fastspring_product_path` in
#: tests.py), not a migration: seeding a new pack without updating this
#: dict now fails a test before it ever reaches a real checkout, the same
#: guarantee a NOT NULL column would give, without the schema change.
#:
#: The STANDALONE `wallpaper` pack (still active for Song Poster) has NO
#: entry here, deliberately — it is not one of FastSpring's ten products
#: ("wallpapers are add-ons, not standalone products," confirmed
#: directly), the same "hidden from discovery, not disabled" treatment
#: already applied to the product page and the Merchant Center feed. Its
#: Django `status` is untouched by this file; a pack with no entry here
#: simply cannot be sold through FastSpring, which is correct — it was
#: never meant to be.
PACK_SLUG_TO_PRODUCT_PATH: dict[tuple[str, str], str] = {
    ("love-story-timeline", "live"): "love-story-timeline-digital",
    ("love-story-timeline", "digital-plus-wallpaper"): "love-story-timeline-digital-wallpapers",
    ("love-story-timeline", "printable"): "love-story-timeline-printable",
    ("love-story-timeline", "printable-plus-wallpaper"): "love-story-timeline-printable-wallpapers",
    ("love-story-timeline", "complete"): "love-story-timeline-complete",
    ("song-poster", "live"): "song-poster-digital",
    ("song-poster", "digital-plus-wallpaper"): "song-poster-digital-wallpapers",
    ("song-poster", "printable"): "song-poster-printable",
    ("song-poster", "printable-plus-wallpaper"): "song-poster-printable-wallpapers",
    ("song-poster", "complete"): "song-poster-complete",
}


def _product_path_for(product_slug: str, pack_slug: str) -> str:
    path = PACK_SLUG_TO_PRODUCT_PATH.get((product_slug, pack_slug))
    if path is None:
        raise FastSpringConfigurationError(
            f"No FastSpring product path mapped for product={product_slug!r} pack={pack_slug!r}. "
            "Add an entry to PACK_SLUG_TO_PRODUCT_PATH before this pack can be sold via FastSpring."
        )
    return path


def _require_fastspring_credentials() -> tuple[str, str]:
    username = settings.FASTSPRING_API_USERNAME
    password = settings.FASTSPRING_API_PASSWORD
    if not username or not password:
        raise FastSpringConfigurationError(
            "FASTSPRING_API_USERNAME/FASTSPRING_API_PASSWORD are not configured."
        )
    return username, password


def _price_string(total_cents: int) -> str:
    """`1599` -> `"15.99"`. Decimal, not float division — a float
    quotient of cents/100 can print as "15.990000000000002" for some
    amounts, which FastSpring's Sessions API has no documented tolerance
    for. Always two decimal places, even for a whole-dollar amount
    ("39.00", not "39"), since the Sessions API's own documented example
    quotes prices that way.
    """
    return str((Decimal(total_cents) / 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def create_session(order) -> FastSpringCheckoutResult:
    """Creates a FastSpring Sessions API session for one order —
    FastSpring's asynchronous counterpart to `paddle_integration.create_transaction`.
    `start_checkout` only creates the session and returns its id; it does
    not (and cannot) know whether the customer will actually complete
    payment. Final confirmation happens only via a verified
    `order.completed` webhook (`apps/commerce/webhook_views.py`), which is
    the sole path that marks an order paid and grants entitlements — same
    rule as Paddle, enforced the same way.

    The Heartfolio order id is carried in `orderTags.orderId` — FastSpring's
    documented mechanism for attaching custom key/value data to a session,
    the direct analog of Paddle's `custom_data.orderId`. The webhook
    resolves the order from this tag alone, never from FastSpring's own
    order id/reference, email, amount, or product name — matching
    `confirm_paddle_webhook_payment`'s existing discipline exactly.
    """
    username, password = _require_fastspring_credentials()
    product_path = _product_path_for(order.product.slug, order.delivery_pack.slug)

    url = f"{FASTSPRING_API_BASE}/v2/checkouts/{settings.FASTSPRING_STORE_ID}/{settings.FASTSPRING_CHECKOUT_ID}/sessions"
    body = {
        "orderTags": {"orderId": str(order.id)},
        "cart": {
            "lineItems": [
                {
                    "productPath": product_path,
                    "quantity": 1,
                    # THE STRUCTURAL PRICE-SAFETY MECHANISM — see the module
                    # docstring. Django's price wins regardless of whatever
                    # is currently configured on the FastSpring product.
                    "pricing": {"price": {order.currency: _price_string(order.total_cents)}},
                }
            ]
        },
    }

    try:
        response = requests.post(
            url,
            json=body,
            auth=(username, password),
            headers={"Accept": "application/json"},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        data = response.json()
    except (requests.RequestException, ValueError) as exc:  # ValueError: response.json() on a non-JSON body
        # Never log exc's str() unfiltered — matches paddle_integration.py's
        # own rule; a request/response body could in principle echo back
        # something sensitive even if FastSpring's own errors don't carry
        # secrets by design.
        logger.error("fastspring_session_create_failed", extra={"order_id": str(order.id)})
        raise FastSpringSessionCreationFailed() from exc

    session_id = data.get("id")
    if not session_id:
        logger.error("fastspring_session_create_missing_id", extra={"order_id": str(order.id)})
        raise FastSpringSessionCreationFailed()

    checkout_url = (data.get("checkoutUrls") or {}).get("webcheckoutUrl")
    return FastSpringCheckoutResult(session_id=session_id, checkout_url=checkout_url)


def verify_webhook_signature(django_request, raw_body: bytes) -> bool:
    """Verifies the `X-FS-Signature` header against `raw_body`: HMAC-SHA256
    keyed on `FASTSPRING_WEBHOOK_SECRET`, base64-encoded, timing-safe
    compared. Same raw-bytes discipline `paddle_integration.py`'s own
    `verify_webhook_signature` enforces — must be called with the
    untouched raw body; see this module's `webhook_views.py` counterpart
    for why it can never be a re-serialized form.

    FastSpring's own documentation notes the HEADER NAME's case can vary
    ("might be sent with varying case, all lowercase or mixed case") —
    that is about `X-FS-Signature` vs `x-fs-signature` as a header name,
    which `django_request.headers` (a case-insensitive mapping) already
    handles for free. It is NOT license to compare the signature VALUE
    case-insensitively — a base64-encoded digest is case-sensitive data,
    and loosening that comparison would accept signatures FastSpring never
    actually sent. Only `.strip()` (whitespace), never `.lower()`.

    Unlike Paddle's SDK, FastSpring's documented scheme has no
    timestamp/replay-window component to verify — there is no `ts=...`
    field to check. The backstop against a replayed valid signature is the
    same one `confirm_fastspring_webhook_payment` already provides for
    Paddle: idempotent no-op on an already-paid order.
    """
    if not settings.FASTSPRING_WEBHOOK_SECRET:
        raise FastSpringConfigurationError("FASTSPRING_WEBHOOK_SECRET is not configured.")

    signature = django_request.headers.get("X-FS-Signature")
    if not signature:
        return False

    expected = base64.b64encode(
        hmac.new(settings.FASTSPRING_WEBHOOK_SECRET.encode("utf-8"), raw_body, hashlib.sha256).digest()
    ).decode("ascii")

    return hmac.compare_digest(expected, signature.strip())


@dataclass(frozen=True)
class FastSpringWebhookEvent:
    event_id: str
    event_type: str
    #: FastSpring's own live/test flag, carried on every event — reconciled
    #: against `settings.FASTSPRING_ENVIRONMENT` by the caller before this
    #: event is trusted. See `confirm_fastspring_webhook_payment`.
    live: bool
    #: From `data.tags.orderId` — the one stable Heartfolio reference, set
    #: at session-creation time in `create_session` above. `None` if this
    #: event's data carries no tags at all (e.g. a malformed/unexpected
    #: payload), in which case the order can never be resolved and the
    #: event is rejected rather than guessed at.
    order_id: str | None
    #: FastSpring's own order id/reference, used as `Payment.provider_reference`.
    fastspring_reference: str | None
    currency_code: str | None
    #: FastSpring's OWN UNIT — a decimal dollar string ("15.99"), per the
    #: Sessions API's own documented pricing shape. Deliberately NOT named
    #: total_cents: unlike Paddle, which sends totals as a string of minor
    #: units ("1200"), nothing confirms FastSpring's webhook sends cents —
    #: converted to cents explicitly in confirm_fastspring_webhook_payment,
    #: never assumed here.
    total: str | None


def parse_webhook_payload(raw_body: bytes) -> list[FastSpringWebhookEvent]:
    """Parses the verified webhook body. Only called *after*
    `verify_webhook_signature` succeeds — see webhook_views.py.

    Returns a LIST: FastSpring documents that a single delivery can batch
    multiple events (`{"events": [...]}`) — unlike Paddle, which this
    codebase has only ever seen deliver one event per request. The caller
    iterates and reconciles each `order.completed` event independently;
    a batch containing an unrelated event alongside a real one must not
    cause the real one to be skipped or double-processed.

    ⚠️ FIELD NAMES BELOW ARE UNCONFIRMED AGAINST A REAL DELIVERY.
    `event.id`/`.type`/`.live`/`.data` match FastSpring's documented
    webhook envelope. `data.tags` matches the documented session-tag
    mechanism. `data.id`/`.total`/`.currency` are FastSpring's general
    order-object field names as documented for the Sessions/Orders API —
    no actual `order.completed` payload has been received and inspected
    in a sandbox yet. If any of these are wrong, parsing degrades to a
    field reading `None`, which `confirm_fastspring_webhook_payment`
    then rejects loudly (unparseable total, or no order_id to resolve)
    rather than silently recording a wrong amount. CONFIRM AGAINST A REAL
    SANDBOX `order.completed` DELIVERY before trusting this in production.
    """
    try:
        payload: dict[str, Any] = json.loads(raw_body)
    except json.JSONDecodeError as exc:
        raise ValueError("Webhook payload is not valid JSON.") from exc

    events = payload.get("events")
    if not isinstance(events, list):
        raise ValueError("Webhook payload has no 'events' array.")

    return [_parse_event(event) for event in events]


def _parse_event(event: dict[str, Any]) -> FastSpringWebhookEvent:
    data = event.get("data") or {}
    tags = data.get("tags") or {}

    return FastSpringWebhookEvent(
        event_id=str(event.get("id", "")),
        event_type=event.get("type", ""),
        live=bool(event.get("live", False)),
        order_id=tags.get("orderId"),
        fastspring_reference=data.get("id"),
        currency_code=data.get("currency"),
        total=data.get("total"),
    )
