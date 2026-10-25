"""
Field naming checked directly against the frontend's real TypeScript
contracts (Phase 3.6, src/types/commerce.ts):

- `Order.orderId` (not just `id`), `Order.guestEmail`,
  `Order.paymentProvider`, `Order.paymentStatus` were all missing.
  Added below. `paymentProvider`/`paymentStatus` are derived from the
  most recent `Payment` for the order (no schema change — `orders` has
  no such columns, by design; that data lives on `Payment`, a
  deliberate normalization over the frontend's original mock `Order`
  type). For an order with no payment attempt yet, they default to
  `"pending"` / the configured default provider's id (currently always
  `"mock"`) rather than `null`, since the frontend types both as
  required non-optional strings.
- `Entitlement.orderId` / `.productId` were missing from each item
  (previously only present once at the wrapping response's top level).
  Added below, alongside the existing `id`/`createdAt` extras.
"""

from django.conf import settings
from rest_framework import serializers

from apps.commerce.payment_provider import payment_provider_id

from . import freemius_integration
from .models import Entitlement, FreemiusCheckoutStaging, Order, Payment


class OrderCreateInputSerializer(serializers.Serializer):
    productId = serializers.CharField()
    deliveryPackId = serializers.CharField()
    projectId = serializers.UUIDField(required=False, allow_null=True)
    # The site language the customer is checking out in. Sent by the client
    # rather than asked for, and constrained to the locales the site actually
    # publishes — an arbitrary string here would end up in a delivered
    # keepsake's `lang` attribute and in an email template lookup.
    locale = serializers.ChoiceField(
        choices=settings.SUPPORTED_LOCALES,
        required=False,
        default=settings.DEFAULT_LOCALE,
    )


class OrderSerializer(serializers.ModelSerializer):
    orderId = serializers.CharField(source="id", read_only=True)
    productId = serializers.CharField(source="product.slug", read_only=True)
    deliveryPackId = serializers.CharField(source="delivery_pack.slug", read_only=True)
    projectId = serializers.SerializerMethodField()
    guestEmail = serializers.CharField(source="guest_email", read_only=True)
    subtotalCents = serializers.IntegerField(source="subtotal_cents", read_only=True)
    discountCents = serializers.IntegerField(source="discount_cents", read_only=True)
    totalCents = serializers.IntegerField(source="total_cents", read_only=True)
    paymentProvider = serializers.SerializerMethodField()
    paymentStatus = serializers.SerializerMethodField()
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)
    updatedAt = serializers.DateTimeField(source="updated_at", read_only=True)

    class Meta:
        model = Order
        fields = [
            "id",
            "orderId",
            "productId",
            "deliveryPackId",
            "projectId",
            "guestEmail",
            "currency",
            "subtotalCents",
            "discountCents",
            "totalCents",
            "status",
            "paymentProvider",
            "paymentStatus",
            "createdAt",
            "updatedAt",
        ]
        read_only_fields = fields

    def get_projectId(self, obj):
        return str(obj.project_id) if obj.project_id else None

    def _latest_payment(self, obj) -> Payment | None:
        # `.all()` transparently uses the prefetch cache when the
        # queryset was built with `.prefetch_related("payments")` (see
        # get_order_for_customer/create_order) — no special-casing
        # needed here either way.
        payments = list(obj.payments.all())
        return max(payments, key=lambda p: p.created_at, default=None) if payments else None

    def get_paymentProvider(self, obj):
        latest = self._latest_payment(obj)
        return latest.provider if latest else payment_provider_id()

    def get_paymentStatus(self, obj):
        latest = self._latest_payment(obj)
        return latest.status if latest else Payment.STATUS_PENDING


class PaymentSerializer(serializers.ModelSerializer):
    orderId = serializers.CharField(source="order_id", read_only=True)
    providerReference = serializers.CharField(source="provider_reference", read_only=True)
    amountCents = serializers.IntegerField(source="amount_cents", read_only=True)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = Payment
        fields = ["id", "orderId", "provider", "providerReference", "amountCents", "currency", "status", "createdAt"]
        read_only_fields = fields


class FreemiusStageInputSerializer(serializers.Serializer):
    """Mirrors `OrderCreateInputSerializer` exactly — same fields, same
    meaning — since staging validates the same "is this a valid thing to
    buy" question `create_order` does (see
    `services.py::_resolve_and_validate_order_inputs`).
    """

    productId = serializers.CharField()
    deliveryPackId = serializers.CharField()
    projectId = serializers.UUIDField(required=False, allow_null=True)
    locale = serializers.ChoiceField(
        choices=settings.SUPPORTED_LOCALES,
        required=False,
        default=settings.DEFAULT_LOCALE,
    )


class FreemiusStagingSerializer(serializers.ModelSerializer):
    """The `/stage/` and `/stage/{id}/` response — enough for the
    frontend to open the checkout overlay (plan/pricing id, sandbox
    object) and, later, to poll for completion.
    """

    stagingId = serializers.CharField(source="id", read_only=True)
    productId = serializers.CharField(source="product.slug", read_only=True)
    deliveryPackId = serializers.CharField(source="delivery_pack.slug", read_only=True)
    expectedTotalCents = serializers.IntegerField(source="expected_total_cents", read_only=True)
    orderId = serializers.SerializerMethodField()
    freemiusProductId = serializers.SerializerMethodField()
    publicKey = serializers.SerializerMethodField()
    planId = serializers.SerializerMethodField()
    pricingId = serializers.SerializerMethodField()
    sandbox = serializers.SerializerMethodField()

    class Meta:
        model = FreemiusCheckoutStaging
        fields = [
            "stagingId",
            "productId",
            "deliveryPackId",
            "currency",
            "expectedTotalCents",
            "status",
            "orderId",
            "freemiusProductId",
            "publicKey",
            "planId",
            "pricingId",
            "sandbox",
        ]
        read_only_fields = fields

    def get_orderId(self, obj):
        return str(obj.resulting_order_id) if obj.resulting_order_id else None

    def get_freemiusProductId(self, obj):
        return settings.FREEMIUS_PRODUCT_ID

    def get_publicKey(self, obj):
        # Not secret — goes straight into the browser's `FS.Checkout(...)`
        # constructor unconditionally (sandbox and live checkouts alike),
        # per Freemius's own generated buy-button snippet.
        return settings.FREEMIUS_PUBLIC_KEY

    def _plan(self, obj):
        return freemius_integration.plan_for_pack(obj.product.slug, obj.delivery_pack.slug)

    def get_planId(self, obj):
        plan = self._plan(obj)
        return plan["plan_id"] if plan else None

    def get_pricingId(self, obj):
        plan = self._plan(obj)
        return plan.get("pricing_id") if plan else None

    def get_sandbox(self, obj):
        # Computed fresh per request (see freemius_integration.get_sandbox_params
        # — no REST call, but genuinely time-sensitive, so never cached or
        # stored). Absent entirely once FREEMIUS_LIVE_CONFIRMED — this is
        # the enforcement point for "never reaches a real production
        # build", since there's no separate sandbox setting for
        # config/settings/production.py to check for absence.
        if settings.FREEMIUS_LIVE_CONFIRMED:
            return None
        if not (settings.FREEMIUS_PRODUCT_ID and settings.FREEMIUS_SECRET_KEY and settings.FREEMIUS_PUBLIC_KEY):
            return None
        return freemius_integration.get_sandbox_params(
            settings.FREEMIUS_PRODUCT_ID, settings.FREEMIUS_SECRET_KEY, settings.FREEMIUS_PUBLIC_KEY
        )


class FreemiusCompleteInputSerializer(serializers.Serializer):
    stagingId = serializers.UUIDField()
    licenseId = serializers.CharField()


class EntitlementSerializer(serializers.ModelSerializer):
    orderId = serializers.CharField(source="order_id", read_only=True)
    productId = serializers.CharField(source="product.slug", read_only=True)
    targetId = serializers.CharField(source="target_id", read_only=True)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = Entitlement
        fields = ["id", "orderId", "productId", "targetId", "createdAt"]
        read_only_fields = fields
