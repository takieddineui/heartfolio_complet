"""Order lookup for the phone-first support screen (§9).

§9 asks for a quick lookup by customer email or order ID giving instant
paid/unpaid/error status. This is what someone opens when a customer emails
saying they paid and received nothing — usually on a phone, usually not at a
desk.

WHAT "STATUS" HAS TO MEAN HERE
------------------------------
`Order.status == "paid"` is not the answer to the question being asked. The
complaint is "I paid and got nothing", and the shape of that is an order
marked paid with **no entitlements granted** — payment confirmed, delivery
never provisioned. An order marked paid looks fine in the admin and the
customer still has nothing.

So each result carries a derived `condition` that names the actual situation
rather than echoing a column. `paid_no_entitlements` exists specifically
because it is the failure this screen is for; without it, the screen would
show a reassuring "paid" next to a customer who is complaining, and the
person reading would have to know to go and check the entitlement count
themselves.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from django.db.models import Count, Q

from .models import Order

#: More than this and the query was too vague to be useful on a phone.
MAX_RESULTS = 25


@dataclass
class LookupResult:
    order_id: str
    email: str
    product: str
    pack: str
    total: str
    currency: str
    status: str
    condition: str
    condition_label: str
    entitlement_count: int
    payment_count: int
    created_at: str

    @property
    def needs_attention(self) -> bool:
        return self.condition in {"paid_no_entitlements", "failed", "pending"}


def _condition(order, entitlement_count: int) -> tuple[str, str]:
    if order.status == Order.STATUS_PAID and entitlement_count == 0:
        # The reason this screen exists. Paid, and the customer has nothing.
        return "paid_no_entitlements", "PAID — but nothing was delivered"
    if order.status == Order.STATUS_PAID:
        return "delivered", "Paid and delivered"
    if order.status == Order.STATUS_FAILED:
        return "failed", "Payment failed"
    if order.status == Order.STATUS_CANCELLED:
        return "cancelled", "Cancelled"
    return "pending", "Never completed payment"


def lookup_orders(query: str) -> list[LookupResult]:
    """Finds orders by email or order id.

    Accepts a partial order id, because the realistic input is a fragment
    pasted from a customer's email on a phone — requiring a full UUID would
    make the screen useless in exactly the situation it was built for.
    Matching is done on the text form of the id rather than by casting the
    query to a UUID, so a partial paste is a prefix search instead of an
    error.

    Email matching is case-insensitive: `guest_email` is a `CIEmailField`,
    and someone reading a support email will not reproduce the casing.
    """
    query = (query or "").strip()
    if not query:
        return []

    filters = Q(guest_email__iexact=query)

    try:
        # An exact id, when one was pasted whole.
        filters |= Q(id=uuid.UUID(query))
    except (ValueError, AttributeError, TypeError):
        # Not a UUID — treat it as a prefix, or as a partial email.
        if len(query) >= 4:
            filters |= Q(id__startswith=query) | Q(guest_email__icontains=query)

    orders = (
        Order.objects.filter(filters)
        .select_related("product", "delivery_pack")
        .annotate(
            entitlement_total=Count("entitlements", distinct=True),
            payment_total=Count("payments", distinct=True),
        )
        .order_by("-created_at")[:MAX_RESULTS]
    )

    results = []
    for order in orders:
        condition, label = _condition(order, order.entitlement_total)
        results.append(
            LookupResult(
                order_id=str(order.id),
                email=order.guest_email,
                product=order.product.slug if order.product else "—",
                pack=order.delivery_pack.slug if order.delivery_pack else "—",
                # Formatted here, not in the template: `total_cents` is minor
                # units and dividing it in a template filter is how a figure
                # ends up wrong by a factor of a hundred.
                total=f"{order.total_cents / 100:,.2f}",
                currency=order.currency,
                status=order.status,
                condition=condition,
                condition_label=label,
                entitlement_count=order.entitlement_total,
                payment_count=order.payment_total,
                created_at=order.created_at.strftime("%d %b %Y, %H:%M"),
            )
        )
    return results
