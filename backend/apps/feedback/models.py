"""`feedback` app — customer notes, ideas and ratings (§7c).

TWO MODES, ONE TABLE
--------------------
§7c confirms both: feedback tied to a specific order, and general site
feedback tied to nothing. That difference is a single nullable `order`
column rather than two models, because everything else about them — rating,
message, timestamps, moderation state, the admin view that reads them — is
identical. Splitting would double every query and every admin surface to
express one boolean.

PRIVATE NOW, PUBLISHABLE LATER
------------------------------
The decision was a private inbox, built so public display stays possible.
That shapes the schema in three ways that would be painful to retrofit:

  `is_published` exists from the start and defaults to False. Nothing is
  ever public by accident, and turning one public later is a flag flip
  rather than a migration on a table that by then holds real customer
  writing.

  `display_name` exists but is not collected yet. If these ever appear on a
  product page they need a name to attribute them to, and back-filling that
  means going back to customers and asking — which is far harder than
  having somewhere to put it.

  `product` is denormalized rather than always read through `order`. A
  public review has to be listed per product, and general feedback has no
  order to reach a product through. Storing it directly means that query
  stays simple in both modes.

NOT PUBLISHED MEANS NOT PUBLISHED. No API in this app returns unpublished
rows, and nothing renders `AggregateRating` anywhere. §29 requires structured
data to match visible content, so publishing ratings is a deliberate future
act with its own moderation and removal policy — not something that follows
automatically from this table existing.
"""

import uuid

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.commerce.models import Order
from apps.products.models import Product

RATING_MIN = 1
RATING_MAX = 5


class Feedback(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    #: Null for general site feedback. Present means this is about a
    #: specific purchase, and ownership was proved before it was accepted.
    order = models.ForeignKey(
        Order, null=True, blank=True, on_delete=models.SET_NULL, related_name="feedback"
    )
    #: Denormalized from `order` on save, or null for general feedback.
    #: SET_NULL rather than CASCADE throughout: losing a product row should
    #: not silently delete what a customer took the trouble to write.
    product = models.ForeignKey(
        Product, null=True, blank=True, on_delete=models.SET_NULL, related_name="feedback"
    )

    #: NULLABLE, and the two modes differ (§7c).
    #:
    #: An order-tied submission always carries a rating — the customer has
    #: the thing in front of them and rating it is the whole ask. General
    #: site feedback does not: someone reporting a broken link or suggesting
    #: a product has nothing to award stars to, and forcing a number would
    #: either lose the submission or produce a meaningless one that then
    #: pollutes any future average.
    #:
    #: The serializer enforces "rating required for order-tied, and at least
    #: one of rating or message otherwise", because that rule depends on
    #: which mode a submission is in and a column constraint cannot see
    #: that. A row with neither is meaningless, and nothing should be able
    #: to create one.
    rating = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(RATING_MIN), MaxValueValidator(RATING_MAX)],
    )
    #: Optional. A rating alone is a complete submission — requiring words
    #: would lose the quick five-star tap that most people actually give.
    message = models.TextField(blank=True, default="")

    #: Optional, general feedback only. Collected so a reply is possible,
    #: never required, because demanding an address is the fastest way to
    #: stop someone submitting at all.
    email = models.EmailField(blank=True, default="")

    #: Moderation state. See the module docstring — default False, always.
    is_published = models.BooleanField(default=False)
    #: Reserved for public display attribution. Not collected yet.
    display_name = models.CharField(max_length=80, blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "feedback"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["-created_at"], name="idx_feedback_created_at"),
            # The inbox is read newest-first and filtered by whether it has
            # been dealt with; published lookups are the future public path.
            models.Index(fields=["is_published", "-created_at"], name="idx_feedback_published"),
        ]

    def __str__(self) -> str:
        target = self.product.slug if self.product else "general"
        stars = f"{self.rating}★" if self.rating else "note"
        return f"{stars} {target} ({self.created_at:%Y-%m-%d})"

    @property
    def is_order_tied(self) -> bool:
        return self.order_id is not None
