"""Sales reporting aggregations (§7a).

§7a is explicit that the data already exists — Orders, Payments, Products,
Packs — and that the work is the right queries plus somewhere to read them.
So this file contains no new sources of truth: every figure here is derived
from rows the checkout already writes.

TWO RULES THAT SHAPE EVERYTHING BELOW
--------------------------------------
**Only paid orders count as revenue.** A pending order is not money; it is
an intention that may still fail. Every revenue and average figure filters
to `STATUS_PAID`, and the one place unpaid orders do appear — the failure
rate — says so in its own name.

**Aggregation happens in the database, not in Python.** These run over the
full order history, and pulling every row into memory to sum it would work
today with a handful of orders and stop working quietly later. The cost of
doing it properly now is a few `annotate` calls.

WHAT IS DELIBERATELY NOT HERE
-----------------------------
No caching layer. This is a desktop report read occasionally by one person,
not a customer-facing page; a stale number in a revenue report is worse than
a slow one.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from django.db.models import Avg, Count, Min, Q, Sum
from django.db.models.functions import TruncMonth, TruncWeek, TruncYear

from .models import Order

#: `TruncWeek`/`TruncMonth`/`TruncYear` do the bucketing in Postgres.
PERIODS = {
    "weekly": TruncWeek,
    "monthly": TruncMonth,
    "yearly": TruncYear,
}


@dataclass
class PeriodPoint:
    period: date
    orders: int
    revenue_cents: int


@dataclass
class BreakdownRow:
    label: str
    orders: int
    revenue_cents: int


def _paid():
    return Order.objects.filter(status=Order.STATUS_PAID)


def revenue_trend(period: str = "monthly") -> list[PeriodPoint]:
    """Revenue and order count per week, month or year (§7a).

    Buckets by `created_at`, the moment the order was placed, rather than by
    when it was paid: an order created on the last day of a month and paid
    on the first of the next belongs to the month the customer decided to
    buy. Payment confirmation can lag by minutes or, if a webhook is retried,
    longer — bucketing on it would move revenue between periods for reasons
    that have nothing to do with the business.
    """
    trunc = PERIODS.get(period, TruncMonth)
    rows = (
        _paid()
        .annotate(bucket=trunc("created_at"))
        .values("bucket")
        .annotate(orders=Count("id"), revenue=Sum("total_cents"))
        .order_by("bucket")
    )
    return [
        PeriodPoint(period=row["bucket"].date() if hasattr(row["bucket"], "date") else row["bucket"],
                    orders=row["orders"],
                    revenue_cents=row["revenue"] or 0)
        for row in rows
    ]


def breakdown_by_category() -> list[BreakdownRow]:
    return _breakdown("product__category")


def breakdown_by_product() -> list[BreakdownRow]:
    return _breakdown("product__slug")


def breakdown_by_pack() -> list[BreakdownRow]:
    """Per pack, labelled `product/pack`.

    Pack slugs repeat across products — every product has a `printable` —
    so a bare pack slug would silently merge two different products' sales
    into one row.
    """
    rows = (
        _paid()
        .values("product__slug", "delivery_pack__slug")
        .annotate(orders=Count("id"), revenue=Sum("total_cents"))
        .order_by("-revenue")
    )
    return [
        BreakdownRow(
            label=f"{row['product__slug']}/{row['delivery_pack__slug']}",
            orders=row["orders"],
            revenue_cents=row["revenue"] or 0,
        )
        for row in rows
    ]


def breakdown_by_country() -> list[BreakdownRow]:
    """Buyer country, from Paddle's record (§7a).

    Orders with no country are reported as "Unknown" rather than excluded.
    Paddle does not send an address on every webhook, and a breakdown whose
    rows do not add up to the total sitting above it is worse than one
    admitting a gap.
    """
    rows = (
        _paid()
        .values("buyer_country")
        .annotate(orders=Count("id"), revenue=Sum("total_cents"))
        .order_by("-revenue")
    )
    return [
        BreakdownRow(
            label=row["buyer_country"] or "Unknown",
            orders=row["orders"],
            revenue_cents=row["revenue"] or 0,
        )
        for row in rows
    ]


def _breakdown(field: str) -> list[BreakdownRow]:
    rows = (
        _paid()
        .values(field)
        .annotate(orders=Count("id"), revenue=Sum("total_cents"))
        .order_by("-revenue")
    )
    return [
        BreakdownRow(label=row[field] or "Unknown", orders=row["orders"], revenue_cents=row["revenue"] or 0)
        for row in rows
    ]


def average_order_value_cents() -> int:
    return int(_paid().aggregate(v=Avg("total_cents"))["v"] or 0)


def new_vs_returning() -> dict[str, int]:
    """Customers who have bought once versus more than once (§7a).

    Joined on `guest_email`, which §7a names as the closest thing to
    identity here — there are no accounts. Case-insensitive, because the
    column is a `CIEmailField` and the same person typing `Anna@` once and
    `anna@` the next time is one customer, not two.

    Counts CUSTOMERS, not orders: someone who has bought four times is one
    returning customer, and reporting them as four would make repeat
    business look like new business.
    """
    counts = (
        _paid()
        .values("guest_email")
        .annotate(order_count=Count("id"))
    )
    new = sum(1 for row in counts if row["order_count"] == 1)
    returning = sum(1 for row in counts if row["order_count"] > 1)
    return {"new": new, "returning": returning}


def payment_failure_rate() -> dict[str, float | int]:
    """How often an order never becomes a paid one (§7a).

    Counts orders, not payment attempts. An order that failed twice and then
    succeeded is a success — the customer got their keepsake — and counting
    attempts would report a healthy checkout as broken.

    `pending` is grouped with failures on purpose: an order that never
    reached paid is lost revenue regardless of whether Paddle called it
    failed, the customer abandoned the tab, or a webhook never arrived.
    §7a asks for "failed/abandoned", which is exactly that union.
    """
    totals = Order.objects.aggregate(
        total=Count("id"),
        paid=Count("id", filter=Q(status=Order.STATUS_PAID)),
    )
    total = totals["total"] or 0
    paid = totals["paid"] or 0
    unpaid = total - paid
    return {
        "total_orders": total,
        "paid_orders": paid,
        "unpaid_orders": unpaid,
        "failure_rate": round(unpaid / total * 100, 1) if total else 0.0,
    }


@dataclass
class PeriodSummary:
    """§9 — what a Telegram digest needs, none of which `build_report`
    already provides: that function is an ALL-TIME snapshot (its
    "period" argument only groups the trend chart into buckets), so its
    revenue total barely moves day to day and is useless as "how did
    today go". This is the same underlying data, scoped to one window,
    which is a genuinely different query, not the same one filtered.
    """

    label: str
    orders: int
    revenue_cents: int
    average_order_value_cents: int
    top_pack: str | None
    top_country: str | None
    new_customers: int
    returning_customers: int
    unpaid_orders: int
    feedback_count: int
    feedback_average: float | None
    #: Same figures for the immediately preceding window of equal length,
    #: so the digest can say "up" or "down" rather than a number with no
    #: context. `None` when there is nothing to compare against yet — a
    #: brand-new store's first daily digest has no "yesterday".
    previous_revenue_cents: int | None


def period_summary(start, end, *, previous_start=None) -> PeriodSummary:
    """Everything a scheduled digest needs, for orders placed in
    `[start, end)`.

    Bucketed on `created_at`, the same choice and the same reasoning as
    `revenue_trend` above: the day someone decided to buy, not the moment
    a webhook happened to land.
    """
    from apps.feedback.models import Feedback

    window = _paid().filter(created_at__gte=start, created_at__lt=end)

    totals = window.aggregate(orders=Count("id"), revenue=Sum("total_cents"), aov=Avg("total_cents"))
    orders = totals["orders"] or 0
    revenue_cents = totals["revenue"] or 0

    top_pack_row = (
        window.values("delivery_pack__slug")
        .annotate(revenue=Sum("total_cents"))
        .order_by("-revenue")
        .first()
    )
    top_country_row = (
        window.exclude(buyer_country="")
        .values("buyer_country")
        .annotate(revenue=Sum("total_cents"))
        .order_by("-revenue")
        .first()
    )

    # A customer is NEW here if this window contains their first-ever
    # paid order — not merely their first order IN the window, which
    # would call a loyal customer's second purchase "new" the moment it
    # happened to be their first one this week.
    emails_in_window = set(window.values_list("guest_email", flat=True))
    first_orders = dict(
        _paid()
        .filter(guest_email__in=emails_in_window)
        .values("guest_email")
        .annotate(first_order=Min("created_at"))
        .values_list("guest_email", "first_order")
    )
    new_customers = sum(1 for email in emails_in_window if first_orders.get(email, start) >= start)
    returning_customers = len(emails_in_window) - new_customers

    unpaid_orders = Order.objects.filter(
        created_at__gte=start, created_at__lt=end
    ).exclude(status=Order.STATUS_PAID).count()

    feedback_window = Feedback.objects.filter(created_at__gte=start, created_at__lt=end)
    feedback_ratings = list(feedback_window.exclude(rating=None).values_list("rating", flat=True))

    previous_revenue_cents = None
    if previous_start is not None:
        previous_revenue_cents = (
            _paid()
            .filter(created_at__gte=previous_start, created_at__lt=start)
            .aggregate(v=Sum("total_cents"))["v"]
            or 0
        )

    return PeriodSummary(
        label="",
        orders=orders,
        revenue_cents=revenue_cents,
        average_order_value_cents=int(totals["aov"] or 0),
        top_pack=top_pack_row["delivery_pack__slug"] if top_pack_row else None,
        top_country=top_country_row["buyer_country"] if top_country_row else None,
        new_customers=new_customers,
        returning_customers=returning_customers,
        unpaid_orders=unpaid_orders,
        feedback_count=feedback_window.count(),
        feedback_average=round(sum(feedback_ratings) / len(feedback_ratings), 1) if feedback_ratings else None,
        previous_revenue_cents=previous_revenue_cents,
    )


def build_report(period: str = "monthly") -> dict:
    """Everything §7a lists, in one call."""
    return {
        "period": period if period in PERIODS else "monthly",
        "trend": revenue_trend(period),
        "by_category": breakdown_by_category(),
        "by_product": breakdown_by_product(),
        "by_pack": breakdown_by_pack(),
        "by_country": breakdown_by_country(),
        "average_order_value_cents": average_order_value_cents(),
        "customers": new_vs_returning(),
        "payments": payment_failure_rate(),
    }
