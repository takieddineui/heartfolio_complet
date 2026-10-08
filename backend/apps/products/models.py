"""
`products` app owns `Product` and `DeliveryPack` — a delivery pack
belongs to a product, not a separate domain (per the approved app
boundaries).

Field-level CHECK constraints expressible through Django's ORM (numeric
comparisons, `IN` lists) are declared here via `Meta.constraints`. The
JSONB-specific constraints the approved schema also requires
(`jsonb_typeof(tags) = 'array'`, same for `included_targets`) can't be
expressed through Django's constraint API and are added via raw SQL in
the migration instead — see `apps/products/migrations/0001_initial.py`.
"""

import uuid

from django.db import models

from apps.common.fields import FixedCharField


class Product(models.Model):
    CATEGORY_SKY = "sky"
    CATEGORY_MAP = "map"
    CATEGORY_MUSIC = "music"
    CATEGORY_TIMELINE = "timeline"
    CATEGORY_PORTRAIT = "portrait"
    CATEGORY_MEMORIAL = "memorial"
    CATEGORY_OTHER = "other"
    CATEGORY_CHOICES = [
        (CATEGORY_SKY, "Sky"),
        (CATEGORY_MAP, "Map"),
        (CATEGORY_MUSIC, "Music"),
        (CATEGORY_TIMELINE, "Timeline"),
        (CATEGORY_PORTRAIT, "Portrait"),
        (CATEGORY_MEMORIAL, "Memorial"),
        (CATEGORY_OTHER, "Other"),
    ]

    STATUS_AVAILABLE = "available"
    STATUS_WAITLIST = "waitlist"
    STATUS_COMING_SOON = "coming_soon"
    STATUS_DISABLED = "disabled"
    STATUS_CHOICES = [
        (STATUS_AVAILABLE, "Available"),
        (STATUS_WAITLIST, "Waitlist"),
        (STATUS_COMING_SOON, "Coming soon"),
        (STATUS_DISABLED, "Disabled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slug = models.CharField(max_length=100, unique=True)
    name_i18n_key = models.CharField(max_length=150)
    category = models.CharField(max_length=30, choices=CATEGORY_CHOICES)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_COMING_SOON)
    starting_price_cents = models.IntegerField(default=0)
    order = models.IntegerField(default=0)
    tags = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "products"
        # `slug` is unique, which already creates its own index in
        # PostgreSQL — no separate idx_products_slug is added.
        indexes = [
            models.Index(fields=["status"], name="idx_products_status"),
            models.Index(fields=["order"], name="idx_products_order"),
        ]
        constraints = [
            models.CheckConstraint(
                check=models.Q(starting_price_cents__gte=0),
                name="ck_products_starting_price_cents_gte_0",
            ),
            models.CheckConstraint(
                check=models.Q(category__in=["sky", "map", "music", "timeline", "portrait", "memorial", "other"]),
                name="ck_products_category_valid",
            ),
            models.CheckConstraint(
                check=models.Q(status__in=["available", "waitlist", "coming_soon", "disabled"]),
                name="ck_products_status_valid",
            ),
        ]

    def __str__(self) -> str:
        return self.slug


class DeliveryPack(models.Model):
    STATUS_ACTIVE = "active"
    STATUS_DISABLED = "disabled"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_DISABLED, "Disabled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product = models.ForeignKey(
        Product,
        on_delete=models.RESTRICT,
        related_name="delivery_packs",
        db_index=False,  # explicit named index below instead of Django's default FK index
    )
    slug = models.CharField(max_length=50)
    name_i18n_key = models.CharField(max_length=150)
    description_i18n_key = models.CharField(max_length=150)
    price_cents = models.IntegerField()
    currency = FixedCharField(max_length=3, default="USD")
    # Flat array of format-id strings (or the "__live__" sentinel) —
    # deliberately NOT {targetGroup, formatId} objects; that structure
    # was explicitly considered and rejected/deferred. See models.py
    # docstring and Phase 3 schema review.
    included_targets = models.JSONField(default=list)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "delivery_packs"
        indexes = [
            models.Index(fields=["product"], name="idx_delivery_packs_product_id"),
            models.Index(fields=["status"], name="idx_delivery_packs_status"),
        ]
        constraints = [
            models.UniqueConstraint(fields=["product", "slug"], name="uq_delivery_packs_product_slug"),
            models.CheckConstraint(
                check=models.Q(price_cents__gte=0),
                name="ck_delivery_packs_price_cents_gte_0",
            ),
            models.CheckConstraint(
                check=models.Q(status__in=["active", "disabled"]),
                name="ck_delivery_packs_status_valid",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.product_id}:{self.slug}"


# §7d — Occasion and PrintSize live in `catalog_entities.py` and are
# re-exported here so Django's app loading finds them and so importers see
# one models module, as everywhere else in this project.
from .catalog_entities import Occasion, PrintSize  # noqa: E402,F401
