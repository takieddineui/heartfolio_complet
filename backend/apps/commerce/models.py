"""
`commerce` app owns `Order`, `Payment`, and `Entitlement` together,
since they form one transactional flow. No business services
(`create_order`, `process_payment`, `grant_entitlements`, ...) are
implemented in this phase — model/database layer only.

One order = exactly one delivery pack. There is no `OrderItem`.
"""

import uuid

from django.db import models

from apps.common.fields import CIEmailField, FixedCharField
from apps.customers.models import Customer
from apps.products.models import Product
from apps.products.models import DeliveryPack
from apps.projects.models import Project


class Order(models.Model):
    STATUS_PENDING = "pending"
    STATUS_PAID = "paid"
    STATUS_FAILED = "failed"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_PAID, "Paid"),
        (STATUS_FAILED, "Failed"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    customer = models.ForeignKey(
        Customer,
        on_delete=models.RESTRICT,
        related_name="orders",
        db_index=False,  # explicit named index below
    )
    project = models.ForeignKey(
        Project,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="orders",
        db_index=False,  # explicit named index below
        # See apps/assets/models.py: Django's on_delete is
        # application-level only. DB-level ON DELETE SET NULL added via
        # RunSQL in this app's migration instead.
        db_constraint=False,
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.RESTRICT,
        related_name="orders",
        # No index specified for orders.product_id in the approved
        # schema (idx_orders_* covers customer/project/delivery_pack/
        # status/created_at only) — left un-indexed deliberately, not
        # an oversight.
        db_index=False,
    )
    delivery_pack = models.ForeignKey(
        DeliveryPack,
        on_delete=models.RESTRICT,
        related_name="orders",
        db_index=False,  # explicit named index below
    )
    guest_email = CIEmailField()
    # The language this order was placed in.
    #
    # Lives on the order rather than the customer or the project because
    # both things that need it descend from an order: the transactional
    # email is *about* the order, and the delivered keepsake is produced
    # through an order's entitlement. One field feeds both with no lookup.
    #
    # On the customer it would be wrong for someone buying one gift for a
    # French recipient and another for an Arabic one — a real case for a
    # gifting product. On the project it would leave the email reaching
    # through to a project that may not exist, since a project is optional
    # here (`project` is nullable above).
    #
    # Captured automatically from the site language at checkout, not asked
    # for. Defaults to "en" so existing rows and any future caller that
    # omits it stay valid — a wrong-but-present language degrades better
    # than a null that every consumer has to branch on.
    locale = models.CharField(max_length=10, default="en")

    #: Buyer country, two-letter, from Paddle's transaction record (§7a).
    #:
    #: Recorded at payment confirmation rather than fetched when a report
    #: runs: a report that calls Paddle once per order would be slow, would
    #: need live credentials to produce a historical number, and would give
    #: a different answer if Paddle ever changed the record. Storing what
    #: the webhook said makes the figure reproducible.
    #:
    #: Blank when Paddle sent no address. Reports show that as "Unknown"
    #: rather than dropping the order, because a country breakdown that
    #: silently omits rows misstates the totals it sits next to.
    buyer_country = models.CharField(max_length=2, blank=True, default="")
    currency = FixedCharField(max_length=3, default="USD")
    subtotal_cents = models.IntegerField()
    discount_cents = models.IntegerField(default=0)
    total_cents = models.IntegerField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "orders"
        indexes = [
            models.Index(fields=["customer"], name="idx_orders_customer_id"),
            models.Index(fields=["project"], name="idx_orders_project_id"),
            models.Index(fields=["delivery_pack"], name="idx_orders_delivery_pack_id"),
            models.Index(fields=["status"], name="idx_orders_status"),
            models.Index(fields=["created_at"], name="idx_orders_created_at"),
        ]
        constraints = [
            models.CheckConstraint(check=models.Q(subtotal_cents__gte=0), name="ck_orders_subtotal_cents_gte_0"),
            models.CheckConstraint(check=models.Q(discount_cents__gte=0), name="ck_orders_discount_cents_gte_0"),
            models.CheckConstraint(check=models.Q(total_cents__gte=0), name="ck_orders_total_cents_gte_0"),
            models.CheckConstraint(
                check=models.Q(total_cents=models.F("subtotal_cents") - models.F("discount_cents")),
                name="ck_orders_total_equals_subtotal_minus_discount",
            ),
            models.CheckConstraint(
                check=models.Q(status__in=["pending", "paid", "failed", "cancelled"]),
                name="ck_orders_status_valid",
            ),
        ]

    def __str__(self) -> str:
        return str(self.id)


class Payment(models.Model):
    STATUS_PENDING = "pending"
    STATUS_SUCCESS = "success"
    STATUS_FAILED = "failed"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_SUCCESS, "Success"),
        (STATUS_FAILED, "Failed"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(
        Order,
        on_delete=models.CASCADE,
        related_name="payments",
        db_index=False,  # explicit named index below
        # See apps/assets/models.py: Django's on_delete is
        # application-level only. DB-level ON DELETE CASCADE added via
        # RunSQL in this app's migration instead.
        db_constraint=False,
    )
    provider = models.CharField(max_length=50)
    provider_reference = models.CharField(max_length=255, null=True, blank=True)
    amount_cents = models.IntegerField()
    currency = FixedCharField(max_length=3, default="USD")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "payments"
        # NOTE: the Phase 3.3 spec's Payment section does not list any
        # named indexes, but the originally-approved schema review (the
        # document this phase claims to implement) explicitly specified
        # idx_payments_order_id and idx_payments_status. Leaving a
        # financial table's FK to `orders` completely unindexed looked
        # like an unintentional omission rather than a deliberate
        # decision (unlike orders.product_id, which both versions of
        # the schema agree has no index). Implemented per the original
        # approved schema; flagged explicitly in the Phase 3.3 report
        # for confirmation rather than silently dropped or silently
        # added without mention.
        indexes = [
            models.Index(fields=["order"], name="idx_payments_order_id"),
            models.Index(fields=["status"], name="idx_payments_status"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["provider", "provider_reference"],
                condition=models.Q(provider_reference__isnull=False),
                name="uq_payments_provider_reference",
            ),
            models.CheckConstraint(check=models.Q(amount_cents__gte=0), name="ck_payments_amount_cents_gte_0"),
            models.CheckConstraint(
                check=models.Q(status__in=["pending", "success", "failed", "cancelled"]),
                name="ck_payments_status_valid",
            ),
        ]

    def __str__(self) -> str:
        return str(self.id)


class FreemiusCheckoutStaging(models.Model):
    """Everything `create_order()` would otherwise apply immediately,
    held instead — because Freemius's checkout has no passthrough field
    (see `freemius_integration.py`'s module docstring), there is nothing
    to resolve a webhook back to a pending `Order` by, so no `Order` is
    created until a real payment is verified. This row is what exists in
    the meantime: the browser holds this row's id in memory for the
    length of one checkout attempt (never persisted client-side, never
    sent to Freemius — purely local bookkeeping) and presents it back,
    alongside a Freemius `license_id`, to `/checkout/freemius/complete/`
    once the checkout overlay reports success.

    Deliberately NOT a Order subtype/variant — kept structurally
    separate so `Order`'s own meaning ("a confirmed, billable purchase")
    never blurs with "someone opened checkout."
    """

    STATUS_AWAITING_PAYMENT = "awaiting_payment"
    STATUS_COMPLETED = "completed"
    STATUS_EXPIRED = "expired"
    STATUS_FAILED = "failed"
    STATUS_CHOICES = [
        (STATUS_AWAITING_PAYMENT, "Awaiting payment"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_EXPIRED, "Expired"),
        (STATUS_FAILED, "Failed"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    customer = models.ForeignKey(
        Customer,
        on_delete=models.CASCADE,
        related_name="freemius_checkout_stagings",
        db_index=False,
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="freemius_checkout_stagings",
        db_index=False,
    )
    delivery_pack = models.ForeignKey(
        DeliveryPack,
        on_delete=models.CASCADE,
        related_name="freemius_checkout_stagings",
        db_index=False,
    )
    # Nullable/SET_NULL like Order.project — see that field's own
    # comment. A staging row whose project later vanishes should not
    # itself vanish; it just can no longer ever complete successfully
    # (create_order's own validation already prevents this in practice
    # by requiring a project up front, but the FK shouldn't assume it).
    project = models.ForeignKey(
        Project,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="freemius_checkout_stagings",
        db_index=False,
    )
    guest_email = CIEmailField()
    locale = models.CharField(max_length=10)
    currency = FixedCharField(max_length=3, default="USD")
    expected_total_cents = models.IntegerField()

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_AWAITING_PAYMENT)
    # Set once, by whichever path (the frontend-driven /complete/ call, or
    # the webhook safety net) completes this row first — the Order this
    # resolves to, for the frontend's fallback poll to read off.
    resulting_order = models.ForeignKey(
        Order,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="freemius_checkout_staging",
        db_index=False,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    # created_at + 1h — matches the existing cart-abandonment-ish window
    # elsewhere in this codebase (§7's provisional-media default is 7
    # days for a different reason; this is much shorter on purpose: an
    # `awaiting_payment` row past this point should never be resurrected
    # by a very late or replayed webhook long after the customer moved on).
    expires_at = models.DateTimeField()

    class Meta:
        db_table = "freemius_checkout_stagings"
        indexes = [
            models.Index(fields=["customer"], name="idx_fs_staging_customer_id"),
            models.Index(fields=["status"], name="idx_fs_staging_status"),
            models.Index(fields=["expires_at"], name="idx_fs_staging_expires_at"),
        ]
        constraints = [
            models.CheckConstraint(
                check=models.Q(status__in=["awaiting_payment", "completed", "expired", "failed"]),
                name="ck_fs_staging_status_valid",
            ),
            models.CheckConstraint(
                check=models.Q(expected_total_cents__gte=0),
                name="ck_fs_staging_expected_total_cents_gte_0",
            ),
        ]

    def __str__(self) -> str:
        return str(self.id)


class Entitlement(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(
        Order,
        on_delete=models.CASCADE,
        related_name="entitlements",
        db_index=False,  # explicit named index below
        # See apps/assets/models.py: Django's on_delete is
        # application-level only. DB-level ON DELETE CASCADE added via
        # RunSQL in this app's migration instead.
        db_constraint=False,
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.RESTRICT,
        related_name="entitlements",
        db_index=False,  # explicit named index below
    )
    # Export-format id (e.g. "print-png") or the literal sentinel
    # "__live__". No ExportTarget model/table — target definitions
    # remain Product Module-owned on the frontend.
    target_id = models.CharField(max_length=50)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "entitlements"
        indexes = [
            models.Index(fields=["order"], name="idx_entitlements_order_id"),
            models.Index(fields=["product"], name="idx_entitlements_product_id"),
        ]
        constraints = [
            models.UniqueConstraint(fields=["order", "target_id"], name="uq_entitlements_order_target"),
        ]

    def __str__(self) -> str:
        return f"{self.order_id}:{self.target_id}"
