"""Published reviews — the read side of §7c.

NOTHING HERE CAN PUBLISH ANYTHING. Every query filters `is_published=True`,
a flag only staff can set in Django admin. That separation is the whole
safety property: the submission path cannot make something public, and this
path cannot change what is public.

WHY `AggregateRating` IS CONDITIONAL
------------------------------------
Google treats an aggregate rating with no reviews behind it as a
structured-data violation, and the penalty lands on the domain rather than
the page. Emitting `"ratingCount": 0` — or worse, a default 5.0 — to make
the markup "complete" is exactly the failure. So the summary returns None
when nothing is published, and the callers omit the block entirely rather
than emitting an empty one.

The same rule applies to the visible section: no reviews means no heading,
for the same reason §10's other-products strip and §11's occasion cards
render nothing rather than an empty container.

RATINGS ARE COUNTED, NOT INVENTED. The average is computed from the actual
published rows. A review published without a rating — possible, since
general feedback allows a note alone — is excluded from the average but
still shown, because it is still something a customer said.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.db.models import Avg, Count, Q

from .models import Feedback


@dataclass
class PublishedReview:
    id: str
    rating: int | None
    message: str
    display_name: str
    created_at: str


@dataclass
class RatingSummary:
    average: float
    count: int


def published_reviews(product_slug: str | None = None, limit: int = 12) -> list[PublishedReview]:
    """Published reviews, newest first.

    `product_slug` scopes to one product; omitting it returns reviews across
    everything, which is what the homepage shows.

    Reviews with no words are excluded here even when published: a bare
    star with a name under it fills space without telling a reader anything,
    and it still counts toward the average below where it does carry
    meaning.
    """
    queryset = Feedback.objects.filter(is_published=True).exclude(message="")
    if product_slug:
        queryset = queryset.filter(product__slug=product_slug)

    return [
        PublishedReview(
            id=str(row.id),
            rating=row.rating,
            message=row.message,
            # Falls back rather than showing an empty byline. `display_name`
            # was only collected from the point it was added to the form, so
            # earlier reviews genuinely have none.
            display_name=row.display_name or "A Heartfolio customer",
            created_at=row.created_at.strftime("%B %Y"),
        )
        for row in queryset.select_related("product").order_by("-created_at")[:limit]
    ]


def rating_summary(product_slug: str | None = None) -> RatingSummary | None:
    """The aggregate, or None when there is nothing to aggregate.

    None is the important return value: it is what stops an empty
    `AggregateRating` reaching Google. Callers must treat it as "omit the
    block", never as "show zero".
    """
    queryset = Feedback.objects.filter(is_published=True, rating__isnull=False)
    if product_slug:
        queryset = queryset.filter(product__slug=product_slug)

    stats = queryset.aggregate(average=Avg("rating"), count=Count("id", filter=Q(rating__isnull=False)))
    count = stats["count"] or 0
    if count == 0:
        return None

    return RatingSummary(average=round(stats["average"] or 0, 1), count=count)
