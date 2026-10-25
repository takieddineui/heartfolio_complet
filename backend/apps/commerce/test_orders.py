"""Finding the orders that were never real purchases, before launch.

Until the store goes live, every order in the database is a test: mock
payments (local development), Paddle and FastSpring (both only ever ran in
their sandboxes), Freemius sandbox purchases, and orders that were created
and never paid. `list_test_orders` reports them (read-only) and
`cleanup_test_orders` deletes the ones a listing selected. Both are the
OWNER's to run against the real database; Claude never does.

A Freemius order is a test only if Freemius itself says its licence belongs
to the sandbox (`environment` = 1). Without asking Freemius (no
`--check-freemius`), a Freemius order is reported as "freemius-unchecked" and
is never selected for deletion.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.db.models import Prefetch

from . import freemius_integration
from .models import Order, Payment

#: Categories a listing selects by default: purchases that moved no money.
TEST_CATEGORIES = ("mock", "paddle", "fastspring", "freemius-sandbox", "unpaid")

#: Never selected, whatever is asked: a live Freemius purchase is a real
#: customer, and an unchecked or unreadable one might be.
NEVER_SELECTED = ("freemius-live", "freemius-unchecked", "freemius-unknown", "other")


@dataclass(frozen=True)
class ClassifiedOrder:
    order: Order
    category: str
    provider: str
    note: str = ""


def _latest_payment(order: Order) -> Payment | None:
    payments = list(order.payments.all())
    return max(payments, key=lambda p: p.created_at) if payments else None


def classify(order: Order, *, check_freemius: bool) -> ClassifiedOrder:
    payment = _latest_payment(order)
    if payment is None:
        return ClassifiedOrder(order, "unpaid" if order.status != Order.STATUS_PAID else "other", "none")
    provider = payment.provider
    if provider in ("mock", "paddle", "fastspring"):
        return ClassifiedOrder(order, provider, provider)
    if provider == "freemius":
        if not check_freemius:
            return ClassifiedOrder(order, "freemius-unchecked", provider)
        try:
            license_ = freemius_integration.get_license(payment.provider_reference or "")
        except Exception as exc:  # network, configuration, unknown licence
            return ClassifiedOrder(order, "freemius-unknown", provider, f"lookup failed: {type(exc).__name__}")
        if license_.environment == freemius_integration.ENVIRONMENT_SANDBOX:
            return ClassifiedOrder(order, "freemius-sandbox", provider)
        if license_.environment == freemius_integration.ENVIRONMENT_PRODUCTION:
            return ClassifiedOrder(order, "freemius-live", provider)
        return ClassifiedOrder(order, "freemius-unknown", provider, "licence has no environment")
    return ClassifiedOrder(order, "other", provider)


def orders_with_payments(order_ids=None):
    queryset = Order.objects.select_related("product", "delivery_pack").prefetch_related(
        Prefetch("payments", queryset=Payment.objects.order_by("created_at"))
    )
    if order_ids is not None:
        queryset = queryset.filter(id__in=list(order_ids))
    return queryset.order_by("created_at")


def masked_email(email: str) -> str:
    """Enough to recognise your own test addresses, not to read a customer's."""
    local, _, domain = (email or "").partition("@")
    return f"{local[:1]}***@{domain}" if domain else "***"
