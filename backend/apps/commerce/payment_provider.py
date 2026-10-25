"""
Payment provider abstraction.

`PaymentProvider.pay(order) -> PaymentResult` (unchanged since Phase
3.4) is for **synchronous** providers, where calling it already
reflects final success/failure — `MockPaymentProvider` is untouched
from Phase 3.4, byte-for-byte, so every existing test that exercises it
(concurrency, idempotency, rollback) keeps working exactly as before.

`PaymentProvider.start_checkout(order) -> PaddleCheckoutResult` (new in
Phase 3.7) is for **asynchronous** providers, where calling it only
*begins* a payment flow — final confirmation arrives later through a
separate mechanism (Paddle's webhook). `PaddlePaymentProvider`
implements this and not `pay()`; `MockPaymentProvider` implements
`pay()` and not `start_checkout()`. The `synchronous` class attribute
is the explicit discriminator `apps/commerce/services.py` branches on —
see `start_checkout_for_order()` / the existing `confirm_payment()`,
which is completely unmodified.

`apps/commerce/services.py` depends only on this module's interface,
never on `paddle_billing` directly — see `paddle_integration.py` for
all Paddle-specific code.

`settings.PAYMENT_PROVIDER` has four recognized values: "paddle",
"fastspring", "mock" and "freemius". "freemius" (the production default
since 25 Oct 2026, the owner's decision: Freemius only) means no provider
behind this abstraction at all: Freemius has its own flow
(`stage_freemius_checkout` / `_complete_freemius_purchase`), so
`get_payment_provider()` refuses with `OrderPaymentNotOffered` and
`payment_provider_id()` names it. Anything
else — unset-but-somehow-not-defaulted, a typo, a provider name set
before its code exists — raises `UnrecognizedPaymentProvider` rather than
silently falling through to `MockPaymentProvider`. That fallback used to
be the `else` branch of a plain `if`, which meant a misconfigured
`PAYMENT_PROVIDER` in production served real customers a free, successful
mock checkout with nobody charged — see `config/settings/production.py`'s
matching validation, which closes the same gap at settings-load time
instead of at the first checkout attempt.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from django.conf import settings

from apps.common.exceptions.api_errors import OrderPaymentNotOffered

from .fastspring_integration import (
    FastSpringCheckoutResult,
    FastSpringConfigurationError,
    create_session,
)
from .paddle_integration import PaddleCheckoutResult, PaddleConfigurationError, create_transaction


#: `PAYMENT_PROVIDER` value for a deployment that takes payment through
#: Freemius only (its own checkout flow, not this abstraction).
FREEMIUS_ONLY = "freemius"


class UnrecognizedPaymentProvider(Exception):
    """`settings.PAYMENT_PROVIDER` is set to a value `get_payment_provider()`
    does not explicitly recognize. Deliberately a hard failure rather than
    a fallback — see the module docstring for the incident this prevents.
    """


@dataclass(frozen=True)
class PaymentResult:
    status: str  # "success" or "failed"
    reference: str


class PaymentProvider:
    id = "base"
    synchronous = True

    def pay(self, order) -> PaymentResult:
        raise NotImplementedError

    def start_checkout(self, order) -> PaddleCheckoutResult | FastSpringCheckoutResult:
        raise NotImplementedError


class MockPaymentProvider(PaymentProvider):
    """Deterministic success, matching the existing frontend mock
    provider's default path. This intentionally does not implement
    configurable failure/cancellation modes — that belongs to whatever
    exercises this in development (the frontend's own mock, or a
    dedicated test double), not to the provider `commerce/services.py`
    depends on by default.
    """

    id = "mock"
    synchronous = True

    def pay(self, order) -> PaymentResult:
        return PaymentResult(status="success", reference=f"mock_{uuid.uuid4().hex}")


class PaddlePaymentProvider(PaymentProvider):
    """Real Paddle Billing integration. Asynchronous: `start_checkout`
    only creates a Paddle transaction and returns its id — it does not
    (and cannot) know whether the customer will actually complete
    payment. Final confirmation happens only via a verified
    `transaction.paid` webhook (`apps/commerce/webhook_views.py`),
    which is the sole path that marks an order paid and grants
    entitlements.
    """

    id = "paddle"
    synchronous = False

    def start_checkout(self, order) -> PaddleCheckoutResult:
        return create_transaction(order)


class FastSpringPaymentProvider(PaymentProvider):
    """Real FastSpring Sessions API integration. Asynchronous, same shape
    as Paddle: `start_checkout` only creates a FastSpring session and
    returns its id/checkout URL — it does not (and cannot) know whether
    the customer will actually complete payment. Final confirmation
    happens only via a verified `order.completed` webhook
    (`apps/commerce/webhook_views.py`), which is the sole path that marks
    an order paid and grants entitlements.
    """

    id = "fastspring"
    synchronous = False

    def start_checkout(self, order) -> FastSpringCheckoutResult:
        return create_session(order)


def get_payment_provider() -> PaymentProvider:
    """Centralized provider selection, driven entirely by
    `settings.PAYMENT_PROVIDER` — nothing outside this function
    branches on which provider is active (see the module docstring).
    Mirrors the identical `ASSET_STORAGE_BACKEND` pattern from Phase
    3.5.

    Every recognized value is an explicit branch; there is no trailing
    `else` that returns Mock. An unrecognized value raises
    `UnrecognizedPaymentProvider` — see the module docstring.
    """
    if settings.PAYMENT_PROVIDER == "paddle":
        if not settings.PADDLE_API_KEY:
            raise PaddleConfigurationError(
                "PAYMENT_PROVIDER=paddle but PADDLE_API_KEY is not configured."
            )
        return PaddlePaymentProvider()
    if settings.PAYMENT_PROVIDER == "fastspring":
        if not settings.FASTSPRING_API_USERNAME or not settings.FASTSPRING_API_PASSWORD:
            raise FastSpringConfigurationError(
                "PAYMENT_PROVIDER=fastspring but FASTSPRING_API_USERNAME/FASTSPRING_API_PASSWORD "
                "are not configured."
            )
        return FastSpringPaymentProvider()
    if settings.PAYMENT_PROVIDER == "mock":
        return MockPaymentProvider()
    if settings.PAYMENT_PROVIDER == FREEMIUS_ONLY:
        raise OrderPaymentNotOffered()
    raise UnrecognizedPaymentProvider(
        f"Unrecognized PAYMENT_PROVIDER: {settings.PAYMENT_PROVIDER!r}. "
        "Expected 'paddle', 'fastspring', 'mock' or 'freemius'."
    )


def payment_provider_id() -> str:
    """The active provider's id, for display (an order with no payment yet),
    without instantiating it, so it works with PAYMENT_PROVIDER=freemius."""
    if settings.PAYMENT_PROVIDER == FREEMIUS_ONLY:
        return FREEMIUS_ONLY
    return get_payment_provider().id
