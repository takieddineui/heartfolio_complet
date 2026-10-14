"""
Model/database-layer tests for `Order`, `Payment`, `Entitlement`.
"""

import base64
import hashlib
import hmac
import json
import threading
import time
import uuid
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import IntegrityError, connection, connections, transaction
from django.conf import settings
from django.core.signing import TimestampSigner
from django.test import SimpleTestCase, TestCase, TransactionTestCase, override_settings
from django.utils import timezone

from .emails import build_order_link, send_order_confirmation
from .paddle_integration import parse_webhook_payload
from .analytics import (
    average_order_value_cents,
    breakdown_by_country,
    breakdown_by_pack,
    new_vs_returning,
    payment_failure_rate,
    revenue_trend,
)
from .order_access import generate_order_access_token, verify_order_access_token
from rest_framework import status as http_status
from rest_framework.test import APIClient

from apps.common.exceptions.api_errors import (
    DeliveryPackDisabled,
    DeliveryPackNotFound,
    FreemiusNotEnabled,
    FreemiusPlanNotConfigured,
    FreemiusStagingAccessDenied,
    FreemiusStagingExpired,
    FreemiusStagingNotFound,
    FreemiusVerificationFailed,
    LoveStoryTimelineInvalidData,
    OrderAccessDenied,
    PaymentVerificationFailed,
    ProjectProductMismatch,
)
from apps.common.test_helpers import csrf_headers, login_as_guest
from apps.customers.models import Customer
from apps.products.models import DeliveryPack, Product
from apps.projects.models import Project

from .models import Entitlement, Order, Payment
from .fastspring_integration import (
    ORDER_CANCELED_EVENT,
    ORDER_COMPLETED_EVENT,
    ORDER_FAILED_EVENT,
    PACK_SLUG_TO_PRODUCT_PATH,
    FastSpringCheckoutResult,
    FastSpringConfigurationError,
    FastSpringSessionCreationFailed,
    FastSpringWebhookEvent,
    create_session,
    parse_webhook_payload as parse_fastspring_webhook_payload,
    verify_webhook_signature as verify_fastspring_webhook_signature,
)
from .paddle_integration import PaddleWebhookEvent, create_transaction, parse_webhook_payload, verify_webhook_signature
from .payment_provider import PaymentProvider, PaymentResult, get_payment_provider
from .services import confirm_fastspring_webhook_payment, confirm_paddle_webhook_payment, confirm_payment, create_order, grant_entitlements
from . import freemius_integration
from .freemius_integration import FreemiusLicense, FreemiusWebhookEvent
from .models import FreemiusCheckoutStaging
from .services import (
    complete_freemius_checkout,
    confirm_freemius_webhook_payment,
    get_freemius_staging_for_customer,
    stage_freemius_checkout,
)


def make_customer(**overrides) -> Customer:
    defaults = {"email": f"guest-{uuid.uuid4().hex[:8]}@example.com"}
    defaults.update(overrides)
    return Customer.objects.create(**defaults)


def make_product(**overrides) -> Product:
    defaults = {
        "slug": f"product-{uuid.uuid4().hex[:8]}",
        "name_i18n_key": "product.name",
        "category": Product.CATEGORY_OTHER,
    }
    defaults.update(overrides)
    return Product.objects.create(**defaults)


def make_delivery_pack(product=None, **overrides) -> DeliveryPack:
    product = product or make_product()
    defaults = {
        "product": product,
        "slug": "printable",
        "name_i18n_key": "pack.name",
        "description_i18n_key": "pack.description",
        "price_cents": 1200,
        "included_targets": ["print-png"],
    }
    defaults.update(overrides)
    return DeliveryPack.objects.create(**defaults)


def make_order(**overrides):
    customer = overrides.pop("customer", None) or make_customer()
    product = overrides.pop("product", None) or make_product()
    delivery_pack = overrides.pop("delivery_pack", None) or make_delivery_pack(product=product)
    defaults = {
        "customer": customer,
        "product": product,
        "delivery_pack": delivery_pack,
        "guest_email": customer.email,
        "subtotal_cents": 1200,
        "discount_cents": 0,
        "total_cents": 1200,
    }
    defaults.update(overrides)
    return Order.objects.create(**defaults)


class OrderModelTests(TestCase):
    def test_order_references_exactly_one_delivery_pack(self):
        order = make_order()
        self.assertIsNotNone(order.delivery_pack_id)
        # There is no order_items relation/table at all in this schema.
        self.assertFalse(hasattr(order, "items"))
        self.assertFalse(hasattr(order, "order_items"))

    def test_customer_relationship(self):
        customer = make_customer()
        order = make_order(customer=customer)
        self.assertIn(order, customer.orders.all())

    def test_project_is_nullable(self):
        order = make_order(project=None)
        self.assertIsNone(order.project_id)

    def test_default_status_is_pending(self):
        order = make_order()
        self.assertEqual(order.status, Order.STATUS_PENDING)

    def test_invalid_status_rejected_at_db_level(self):
        order = make_order()
        order.status = "not-a-real-status"
        with transaction.atomic(), self.assertRaises(IntegrityError):
            order.save()

    def test_negative_amounts_rejected_at_db_level(self):
        with transaction.atomic(), self.assertRaises(IntegrityError):
            make_order(subtotal_cents=-1, discount_cents=0, total_cents=-1)

    def test_total_must_equal_subtotal_minus_discount(self):
        with transaction.atomic(), self.assertRaises(IntegrityError):
            make_order(subtotal_cents=1000, discount_cents=100, total_cents=1000)  # should be 900

    def test_deleting_customer_with_orders_is_restricted(self):
        customer = make_customer()
        make_order(customer=customer)
        with self.assertRaises(Exception):
            customer.delete()

    def test_deleting_project_sets_order_project_to_null_at_db_level(self):
        customer = make_customer()
        product = make_product()
        project = Project.objects.create(customer=customer, product=product)
        order = make_order(customer=customer, product=product, project=project)

        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM projects WHERE id = %s", [str(project.id)])

        order.refresh_from_db()
        self.assertIsNone(order.project_id)


class PaymentModelTests(TestCase):
    def test_multiple_payments_can_belong_to_one_order(self):
        order = make_order()
        Payment.objects.create(order=order, provider="mock", amount_cents=1200, status=Payment.STATUS_FAILED)
        Payment.objects.create(order=order, provider="mock", amount_cents=1200, status=Payment.STATUS_SUCCESS)
        self.assertEqual(order.payments.count(), 2)

    def test_provider_reference_uniqueness_enforced_at_db_level(self):
        order = make_order()
        Payment.objects.create(order=order, provider="mock", provider_reference="ref-1", amount_cents=1200)
        with transaction.atomic(), self.assertRaises(IntegrityError):
            Payment.objects.create(order=order, provider="mock", provider_reference="ref-1", amount_cents=1200)

    def test_null_provider_references_can_repeat(self):
        order = make_order()
        # Should not raise — the unique constraint is partial
        # (WHERE provider_reference IS NOT NULL).
        Payment.objects.create(order=order, provider="mock", provider_reference=None, amount_cents=1200)
        Payment.objects.create(order=order, provider="mock", provider_reference=None, amount_cents=1200)
        self.assertEqual(order.payments.count(), 2)

    def test_negative_amount_rejected_at_db_level(self):
        order = make_order()
        payment = Payment(order=order, provider="mock", amount_cents=-1)
        with transaction.atomic(), self.assertRaises(IntegrityError):
            payment.save()

    def test_invalid_status_rejected_at_db_level(self):
        order = make_order()
        payment = Payment(order=order, provider="mock", amount_cents=1200, status="not-a-real-status")
        with transaction.atomic(), self.assertRaises(IntegrityError):
            payment.save()

    def test_deleting_order_cascades_to_payments_at_db_level(self):
        order = make_order()
        payment = Payment.objects.create(order=order, provider="mock", amount_cents=1200)

        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM orders WHERE id = %s", [str(order.id)])

        self.assertFalse(Payment.objects.filter(id=payment.id).exists())


class EntitlementModelTests(TestCase):
    def test_order_and_product_relationships(self):
        order = make_order()
        entitlement = Entitlement.objects.create(order=order, product=order.product, target_id="print-png")
        self.assertIn(entitlement, order.entitlements.all())
        self.assertIn(entitlement, order.product.entitlements.all())

    def test_order_and_target_uniqueness_enforced_at_db_level(self):
        order = make_order()
        Entitlement.objects.create(order=order, product=order.product, target_id="print-png")
        with transaction.atomic(), self.assertRaises(IntegrityError):
            Entitlement.objects.create(order=order, product=order.product, target_id="print-png")

    def test_live_sentinel_target_id_allowed(self):
        order = make_order()
        entitlement = Entitlement.objects.create(order=order, product=order.product, target_id="__live__")
        self.assertEqual(entitlement.target_id, "__live__")

    def test_deleting_order_cascades_to_entitlements_at_db_level(self):
        order = make_order()
        entitlement = Entitlement.objects.create(order=order, product=order.product, target_id="print-png")

        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM orders WHERE id = %s", [str(order.id)])

        self.assertFalse(Entitlement.objects.filter(id=entitlement.id).exists())


class _AlwaysFailingProvider(PaymentProvider):
    """Test double — deterministic failure, so payment-failure paths can
    be exercised without any real provider. Deliberately not part of
    production code (see payment_provider.py's note on why the default
    mock provider doesn't have a configurable failure mode).
    """

    id = "mock-failing"

    def pay(self, order):
        return PaymentResult(status="failed", reference="mock-fail-ref")


class CreateOrderServiceTests(TestCase):
    """Direct service-layer tests for `create_order` — precise,
    fast checks of the pricing/consistency rules without HTTP overhead.
    """

    def test_valid_order_created_with_server_calculated_price(self):
        product = make_product()
        pack = make_delivery_pack(product=product, price_cents=1500)
        customer = make_customer()

        order = create_order(customer, product_slug=product.slug, delivery_pack_slug=pack.slug)

        self.assertEqual(order.subtotal_cents, 1500)
        self.assertEqual(order.discount_cents, 0)
        self.assertEqual(order.total_cents, 1500)
        self.assertEqual(order.currency, pack.currency)
        self.assertEqual(order.status, Order.STATUS_PENDING)

    def test_invalid_delivery_pack_slug_rejected(self):
        product = make_product()
        customer = make_customer()
        with self.assertRaises(DeliveryPackNotFound):
            create_order(customer, product_slug=product.slug, delivery_pack_slug="does-not-exist")

    def test_pack_belonging_to_different_product_rejected(self):
        """A delivery pack slug that's real, but belongs to a different
        product than `productId` — must fail, not silently resolve to
        the wrong product's pack. Enforced structurally by scoping the
        DeliveryPack lookup to (product, slug); see services.py.
        """
        product_a = make_product()
        product_b = make_product()
        pack_for_b = make_delivery_pack(product=product_b, slug="printable")
        customer = make_customer()

        with self.assertRaises(DeliveryPackNotFound):
            create_order(customer, product_slug=product_a.slug, delivery_pack_slug=pack_for_b.slug)

    def test_disabled_delivery_pack_rejected(self):
        product = make_product()
        pack = make_delivery_pack(product=product, status=DeliveryPack.STATUS_DISABLED)
        customer = make_customer()
        with self.assertRaises(DeliveryPackDisabled):
            create_order(customer, product_slug=product.slug, delivery_pack_slug=pack.slug)

    def test_project_belonging_to_different_product_rejected(self):
        product_a = make_product()
        product_b = make_product()
        pack = make_delivery_pack(product=product_a)
        customer = make_customer()
        project_for_b = Project.objects.create(customer=customer, product=product_b)

        with self.assertRaises(ProjectProductMismatch):
            create_order(
                customer,
                product_slug=product_a.slug,
                delivery_pack_slug=pack.slug,
                project_id=project_for_b.id,
            )

    def test_project_ownership_enforced(self):
        product = make_product()
        pack = make_delivery_pack(product=product)
        owner = make_customer()
        other_customer = make_customer()
        project = Project.objects.create(customer=owner, product=product)

        with self.assertRaises(Exception):  # ProjectAccessDenied, raised via projects.services
            create_order(
                other_customer, product_slug=product.slug, delivery_pack_slug=pack.slug, project_id=project.id
            )

    def test_project_reference_is_optional(self):
        product = make_product()
        pack = make_delivery_pack(product=product)
        customer = make_customer()
        order = create_order(customer, product_slug=product.slug, delivery_pack_slug=pack.slug)
        self.assertIsNone(order.project_id)

    # --- Paid-but-undeliverable: reject a project the renderer would ---
    # --- reject, before any payment step exists for it. --------------

    def _love_story_timeline_product(self, **overrides):
        defaults = {
            "slug": "love-story-timeline",
            "name_i18n_key": "x",
            "category": Product.CATEGORY_TIMELINE,
            "status": Product.STATUS_AVAILABLE,
        }
        defaults.update(overrides)
        return Product.objects.create(**defaults)

    def _timeline_events(self, *, with_asset_ids: bool) -> list:
        # Three is `MIN_EVENTS` — see love_story_timeline/data.py. Every
        # other required field (date, title) is present so a rejection in
        # these tests is unambiguously about the photo, not anything else.
        return [
            {
                "date": d,
                "title": t,
                "photo": (
                    {"assetId": f"asset-{i}"}
                    if with_asset_ids
                    # Exactly what a picked-but-never-uploaded photo looks
                    # like on the wire: the shape `uploadPendingMedia`
                    # returns unchanged before its own fix — see
                    # frontend-heartfolio/src/lib/studio/media-values.ts.
                    else {"url": f"blob:{i}", "mimeType": "image/jpeg", "filename": f"{i}.jpg"}
                ),
            }
            for i, (d, t) in enumerate(
                [("2019-04-12", "We met"), ("2020-06-01", "First trip"), ("2022-09-03", "We moved in")], start=1
            )
        ]

    def test_project_missing_photo_asset_ids_rejected_before_payment(self):
        """The exact bug this defends against: a Love Story Timeline
        project reaching order creation with milestone photos that were
        never actually uploaded (no `assetId`) — previously invisible to
        `create_order`, only ever caught at download time, after the
        customer had already paid.
        """
        product = self._love_story_timeline_product()
        pack = make_delivery_pack(product=product)
        customer = make_customer()
        project = Project.objects.create(
            customer=customer,
            product=product,
            data={
                "version": 1,
                "values": {
                    "storyType": "couple",
                    "people": [{"name": "Alex"}, {"name": "Sam"}],
                    "events": self._timeline_events(with_asset_ids=False),
                },
                "themeSelections": {"palette": "midnight", "typography": "script", "layout": "neat-stack", "scale": 100},
            },
        )

        with self.assertRaises(LoveStoryTimelineInvalidData):
            create_order(customer, product_slug=product.slug, delivery_pack_slug=pack.slug, project_id=project.id)

        # Nothing was created for the rejected attempt — no half-charged,
        # half-undeliverable order left behind.
        self.assertEqual(Order.objects.filter(project=project).count(), 0)

    def test_complete_project_still_orders_normally(self):
        """The other half of the same guarantee: this check must not
        reject a project that genuinely is renderable.
        """
        product = self._love_story_timeline_product()
        pack = make_delivery_pack(product=product)
        customer = make_customer()
        project = Project.objects.create(
            customer=customer,
            product=product,
            data={
                "version": 1,
                "values": {
                    "storyType": "couple",
                    "people": [{"name": "Alex"}, {"name": "Sam"}],
                    "events": self._timeline_events(with_asset_ids=True),
                },
                "themeSelections": {"palette": "midnight", "typography": "script", "layout": "neat-stack", "scale": 100},
            },
        )

        order = create_order(customer, product_slug=product.slug, delivery_pack_slug=pack.slug, project_id=project.id)

        self.assertEqual(order.project_id, project.id)
        self.assertEqual(order.status, Order.STATUS_PENDING)

    def test_product_with_no_registered_renderer_is_not_checked(self):
        """Star Map (or any future product without a real renderer)
        isn't covered by this check — see `NotImplementedRenderer`'s own
        docstring in apps/delivery/renderers.py for why: an order for it
        is already unconditionally undeliverable regardless of project
        content, so there is nothing this check could add.
        """
        product = make_product()  # a random, unregistered slug
        pack = make_delivery_pack(product=product)
        customer = make_customer()
        project = Project.objects.create(customer=customer, product=product)  # default (empty) data

        order = create_order(customer, product_slug=product.slug, delivery_pack_slug=pack.slug, project_id=project.id)
        self.assertEqual(order.project_id, project.id)


class OrderAPITests(TestCase):
    """`POST/GET /api/v1/orders/...` — session-owned; price always
    server-calculated regardless of what the client sends.
    """

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)

    def _available_product(self, slug="love-story-timeline"):
        return Product.objects.create(
            slug=slug, name_i18n_key="x", category=Product.CATEGORY_TIMELINE, status=Product.STATUS_AVAILABLE
        )

    def test_create_order(self):
        product = self._available_product()
        pack = make_delivery_pack(product=product, slug="printable", price_cents=1200)
        login_as_guest(self.client)

        response = self.client.post(
            "/api/v1/orders/",
            {"productId": product.slug, "deliveryPackId": pack.slug},
            format="json",
            **csrf_headers(self.client),
        )

        self.assertEqual(response.status_code, http_status.HTTP_201_CREATED)
        self.assertEqual(response.data["productId"], product.slug)
        self.assertEqual(response.data["deliveryPackId"], pack.slug)
        self.assertEqual(response.data["totalCents"], 1200)
        self.assertEqual(response.data["status"], "pending")

    def test_incomplete_project_stopped_before_payment_with_a_usable_error(self):
        """End-to-end through the real HTTP endpoints (not the service
        function directly, unlike `CreateOrderServiceTests` above): a
        project missing a milestone photo's `assetId` is rejected at
        `POST /orders/`, before `POST /orders/<id>/pay/` is ever reachable
        — no Order row is left behind for the frontend to try to pay.
        """
        product = self._available_product()
        pack = make_delivery_pack(product=product, slug="printable", price_cents=1200)
        login_as_guest(self.client)

        project_response = self.client.post(
            "/api/v1/projects/",
            {
                "productId": product.slug,
                "data": {
                    "version": 1,
                    "values": {
                        "storyType": "couple",
                        "people": [{"name": "Alex"}, {"name": "Sam"}],
                        "events": [
                            {
                                "date": d,
                                "title": t,
                                # A picked-but-never-uploaded photo — the exact
                                # shape `uploadPendingMedia` used to return
                                # unchanged before its own fix (see
                                # frontend-heartfolio/src/lib/studio/media-values.ts).
                                "photo": {"url": f"blob:{i}", "mimeType": "image/jpeg", "filename": f"{i}.jpg"},
                            }
                            for i, (d, t) in enumerate(
                                [("2019-04-12", "We met"), ("2020-06-01", "First trip"), ("2022-09-03", "Moved in")],
                                start=1,
                            )
                        ],
                    },
                    "themeSelections": {
                        "palette": "midnight", "typography": "script", "layout": "neat-stack", "scale": 100,
                    },
                },
            },
            format="json",
            **csrf_headers(self.client),
        )
        project_id = project_response.data["id"]

        response = self.client.post(
            "/api/v1/orders/",
            {"productId": product.slug, "deliveryPackId": pack.slug, "projectId": project_id},
            format="json",
            **csrf_headers(self.client),
        )

        self.assertEqual(response.status_code, http_status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["error"]["code"], "love_story_timeline_invalid_data")
        self.assertEqual(Order.objects.filter(project_id=project_id).count(), 0)

    def test_complete_project_orders_and_pays_end_to_end_with_mock_provider(self):
        """The other half: the same check must not stand in the way of a
        project that genuinely is complete, all the way through to a paid
        order with entitlements granted. Byte-level render correctness for
        a complete project is covered separately and in more depth by
        `apps.delivery.product_renderers.love_story_timeline.tests
        .RendererTests` — unaffected by, and unrelated to, this check.
        """
        product = self._available_product()
        pack = make_delivery_pack(product=product, slug="printable", price_cents=1200, included_targets=["print-png"])
        login_as_guest(self.client)

        project_response = self.client.post(
            "/api/v1/projects/",
            {
                "productId": product.slug,
                "data": {
                    "version": 1,
                    "values": {
                        "storyType": "couple",
                        "people": [{"name": "Alex"}, {"name": "Sam"}],
                        "events": [
                            {"date": d, "title": t, "photo": {"assetId": f"asset-{i}"}}
                            for i, (d, t) in enumerate(
                                [("2019-04-12", "We met"), ("2020-06-01", "First trip"), ("2022-09-03", "Moved in")],
                                start=1,
                            )
                        ],
                    },
                    "themeSelections": {
                        "palette": "midnight", "typography": "script", "layout": "neat-stack", "scale": 100,
                    },
                },
            },
            format="json",
            **csrf_headers(self.client),
        )
        project_id = project_response.data["id"]

        order_response = self.client.post(
            "/api/v1/orders/",
            {"productId": product.slug, "deliveryPackId": pack.slug, "projectId": project_id},
            format="json",
            **csrf_headers(self.client),
        )
        self.assertEqual(order_response.status_code, http_status.HTTP_201_CREATED)
        order_id = order_response.data["id"]

        pay_response = self.client.post(f"/api/v1/orders/{order_id}/pay/", **csrf_headers(self.client))
        self.assertEqual(pay_response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(pay_response.data["order"]["status"], "paid")
        self.assertTrue(Entitlement.objects.filter(order_id=order_id).exists())

    def test_second_checkout_for_a_project_with_a_paid_order_still_works(self):
        """`checkout-engine.ts`'s `prepareOrder` re-saves the project on
        EVERY checkout attempt, unconditionally — including buying a
        second pack for a project that already has a paid order, an
        entirely ordinary flow. Follows the exact real sequence: identify
        -> (upload, skipped here — every photo already has an assetId
        from the first purchase) -> save project -> create order -> pay.
        Both an unchanged re-save and a genuine, still-valid edit must
        both go through — see `apps.projects.tests.ProjectAPITests` for
        the equivalent coverage directly against `update_project`.
        """
        product = self._available_product()
        printable = make_delivery_pack(product=product, slug="printable", price_cents=1200, included_targets=["print-png"])
        digital = make_delivery_pack(product=product, slug="digital", price_cents=999, included_targets=["__live__"])
        login_as_guest(self.client)

        complete_values = {
            "storyType": "couple",
            "people": [{"name": "Alex"}, {"name": "Sam"}],
            "events": [
                {"date": d, "title": t, "photo": {"assetId": f"asset-{i}"}}
                for i, (d, t) in enumerate(
                    [("2019-04-12", "We met"), ("2020-06-01", "First trip"), ("2022-09-03", "Moved in")], start=1
                )
            ],
        }
        theme = {"palette": "midnight", "typography": "script", "layout": "neat-stack", "scale": 100}
        project_response = self.client.post(
            "/api/v1/projects/",
            {"productId": product.slug, "data": {"version": 1, "values": complete_values, "themeSelections": theme}},
            format="json",
            **csrf_headers(self.client),
        )
        project_id = project_response.data["id"]

        # First purchase, all the way to paid.
        order1 = self.client.post(
            "/api/v1/orders/",
            {"productId": product.slug, "deliveryPackId": printable.slug, "projectId": project_id},
            format="json",
            **csrf_headers(self.client),
        )
        self.assertEqual(order1.status_code, http_status.HTTP_201_CREATED)
        self.client.post(f"/api/v1/orders/{order1.data['id']}/pay/", **csrf_headers(self.client))

        # (a) Second checkout, UNCHANGED data — exactly what
        # `prepareOrder`'s unconditional re-save produces when nothing was
        # edited between the two purchases.
        resave = self.client.patch(
            f"/api/v1/projects/{project_id}/",
            {"data": {"version": 1, "values": complete_values, "themeSelections": theme}},
            format="json",
            **csrf_headers(self.client),
        )
        self.assertEqual(resave.status_code, http_status.HTTP_200_OK)

        order2 = self.client.post(
            "/api/v1/orders/",
            {"productId": product.slug, "deliveryPackId": digital.slug, "projectId": project_id},
            format="json",
            **csrf_headers(self.client),
        )
        self.assertEqual(order2.status_code, http_status.HTTP_201_CREATED)
        pay2 = self.client.post(f"/api/v1/orders/{order2.data['id']}/pay/", **csrf_headers(self.client))
        self.assertEqual(pay2.status_code, http_status.HTTP_200_OK)
        self.assertEqual(pay2.data["order"]["status"], "paid")

        # (b) A genuine edit in between, e.g. correcting a typo — still
        # valid, so it must not block a third purchase either.
        edited_values = {**complete_values, "dedication": "Fixed a typo"}
        edit_response = self.client.patch(
            f"/api/v1/projects/{project_id}/",
            {"data": {"version": 1, "values": edited_values, "themeSelections": theme}},
            format="json",
            **csrf_headers(self.client),
        )
        self.assertEqual(edit_response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(edit_response.data["data"]["values"]["dedication"], "Fixed a typo")

    def test_frontend_cannot_manipulate_price(self):
        """Even if the client sends subtotal/discount/total fields, the
        order create serializer doesn't accept them at all — the price
        actually stored always comes from delivery_packs.price_cents.
        """
        product = self._available_product()
        pack = make_delivery_pack(product=product, slug="printable", price_cents=1200)
        login_as_guest(self.client)

        response = self.client.post(
            "/api/v1/orders/",
            {
                "productId": product.slug,
                "deliveryPackId": pack.slug,
                "subtotalCents": 1,
                "discountCents": 0,
                "totalCents": 1,
            },
            format="json",
            **csrf_headers(self.client),
        )

        self.assertEqual(response.status_code, http_status.HTTP_201_CREATED)
        self.assertEqual(response.data["totalCents"], 1200)  # not 1 — server price wins

    def test_order_ownership_enforced(self):
        product = self._available_product()
        pack = make_delivery_pack(product=product)

        client_a = APIClient(enforce_csrf_checks=True)
        login_as_guest(client_a)
        create_response = client_a.post(
            "/api/v1/orders/",
            {"productId": product.slug, "deliveryPackId": pack.slug},
            format="json",
            **csrf_headers(client_a),
        )
        order_id = create_response.data["id"]

        client_b = APIClient(enforce_csrf_checks=True)
        login_as_guest(client_b)
        response = client_b.get(f"/api/v1/orders/{order_id}/")

        self.assertEqual(response.status_code, http_status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["error"]["code"], "order_access_denied")

    def test_no_session_rejected(self):
        # Establish a CSRF cookie (as any real client would via GET
        # /api/v1/guest/) without logging in, so this actually isolates
        # the identity check (401) rather than tripping CSRF (403) first.
        self.client.get("/api/v1/guest/")
        response = self.client.post(
            "/api/v1/orders/",
            {"productId": "x", "deliveryPackId": "y"},
            format="json",
            **csrf_headers(self.client),
        )
        self.assertEqual(response.status_code, http_status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(response.data["error"]["code"], "customer_identity_required")


class PaymentFlowAPITests(TestCase):
    """`POST /api/v1/orders/<id>/pay/` — the full create-order-then-pay
    flow, against the real mock provider (success) and a failing test
    double.
    """

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)

    def _create_order_via_api(self, client, product_slug="love-story-timeline", pack_slug="printable"):
        product = Product.objects.create(
            slug=product_slug, name_i18n_key="x", category=Product.CATEGORY_TIMELINE, status=Product.STATUS_AVAILABLE
        )
        pack = make_delivery_pack(
            product=product, slug=pack_slug, price_cents=1200, included_targets=["print-png", "story-png"]
        )
        response = client.post(
            "/api/v1/orders/",
            {"productId": product.slug, "deliveryPackId": pack.slug},
            format="json",
            **csrf_headers(client),
        )
        return response.data["id"]

    def test_successful_mock_payment_marks_order_paid_and_grants_entitlements(self):
        login_as_guest(self.client)
        order_id = self._create_order_via_api(self.client)

        response = self.client.post(f"/api/v1/orders/{order_id}/pay/", **csrf_headers(self.client))

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response.data["order"]["status"], "paid")
        self.assertEqual(response.data["payment"]["status"], "success")

        order = Order.objects.get(id=order_id)
        self.assertEqual(order.status, Order.STATUS_PAID)
        self.assertEqual(Payment.objects.filter(order=order, status=Payment.STATUS_SUCCESS).count(), 1)
        self.assertEqual(
            set(Entitlement.objects.filter(order=order).values_list("target_id", flat=True)),
            {"print-png", "story-png"},
        )

    def test_no_entitlements_before_payment(self):
        login_as_guest(self.client)
        order_id = self._create_order_via_api(self.client)
        self.assertEqual(Entitlement.objects.filter(order_id=order_id).count(), 0)

    def test_another_customer_cannot_pay_someone_elses_order(self):
        login_as_guest(self.client)
        order_id = self._create_order_via_api(self.client)

        other_client = APIClient(enforce_csrf_checks=True)
        login_as_guest(other_client)
        response = other_client.post(f"/api/v1/orders/{order_id}/pay/", **csrf_headers(other_client))

        self.assertEqual(response.status_code, http_status.HTTP_403_FORBIDDEN)
        self.assertEqual(Order.objects.get(id=order_id).status, Order.STATUS_PENDING)

    def test_duplicate_payment_confirmation_is_idempotent(self):
        login_as_guest(self.client)
        order_id = self._create_order_via_api(self.client)

        first = self.client.post(f"/api/v1/orders/{order_id}/pay/", **csrf_headers(self.client))
        second = self.client.post(f"/api/v1/orders/{order_id}/pay/", **csrf_headers(self.client))

        self.assertEqual(first.status_code, http_status.HTTP_200_OK)
        self.assertEqual(second.status_code, http_status.HTTP_200_OK)
        self.assertEqual(second.data["payment"]["id"], first.data["payment"]["id"])

        order = Order.objects.get(id=order_id)
        self.assertEqual(Payment.objects.filter(order=order, status=Payment.STATUS_SUCCESS).count(), 1)
        self.assertEqual(Entitlement.objects.filter(order=order).count(), 2)  # not duplicated

    def test_failed_payment_does_not_mark_order_paid(self):
        customer = make_customer()
        product = make_product(status=Product.STATUS_AVAILABLE)
        pack = make_delivery_pack(product=product, included_targets=["print-png"])
        order = make_order(customer=customer, product=product, delivery_pack=pack)

        with self.assertRaises(Exception):  # PaymentFailed
            confirm_payment(customer, order.id, provider=_AlwaysFailingProvider())

        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_PENDING)  # not paid, not auto-"failed" either — retryable

    def test_failed_payment_record_is_still_persisted(self):
        """The Payment row for a failed attempt is committed even though
        confirm_payment raises — see the transactional design note in
        services.py.
        """
        customer = make_customer()
        product = make_product()
        pack = make_delivery_pack(product=product)
        order = make_order(customer=customer, product=product, delivery_pack=pack)

        with self.assertRaises(Exception):
            confirm_payment(customer, order.id, provider=_AlwaysFailingProvider())

        payments = Payment.objects.filter(order=order)
        self.assertEqual(payments.count(), 1)
        self.assertEqual(payments.first().status, Payment.STATUS_FAILED)

    def test_no_entitlements_for_failed_payment(self):
        customer = make_customer()
        product = make_product()
        pack = make_delivery_pack(product=product, included_targets=["print-png"])
        order = make_order(customer=customer, product=product, delivery_pack=pack)

        with self.assertRaises(Exception):
            confirm_payment(customer, order.id, provider=_AlwaysFailingProvider())

        self.assertEqual(Entitlement.objects.filter(order=order).count(), 0)

    def test_failed_payment_can_be_retried_and_succeed(self):
        customer = make_customer()
        product = make_product()
        pack = make_delivery_pack(product=product, included_targets=["print-png"])
        order = make_order(customer=customer, product=product, delivery_pack=pack)

        with self.assertRaises(Exception):
            confirm_payment(customer, order.id, provider=_AlwaysFailingProvider())

        order, payment = confirm_payment(customer, order.id)  # default (succeeding) mock provider

        self.assertEqual(payment.status, Payment.STATUS_SUCCESS)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_PAID)


class EntitlementsAPITests(TestCase):
    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)

    def test_entitlements_endpoint_returns_only_this_customers_order(self):
        product = Product.objects.create(
            slug="heart-map", name_i18n_key="x", category=Product.CATEGORY_MAP, status=Product.STATUS_AVAILABLE
        )
        pack = make_delivery_pack(product=product, slug="printable", included_targets=["print-png", "__live__"])

        login_as_guest(self.client)
        create_response = self.client.post(
            "/api/v1/orders/",
            {"productId": product.slug, "deliveryPackId": pack.slug},
            format="json",
            **csrf_headers(self.client),
        )
        order_id = create_response.data["id"]
        self.client.post(f"/api/v1/orders/{order_id}/pay/", **csrf_headers(self.client))

        response = self.client.get(f"/api/v1/orders/{order_id}/entitlements/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response.data["productId"], "heart-map")
        target_ids = {e["targetId"] for e in response.data["entitlements"]}
        self.assertEqual(target_ids, {"print-png", "__live__"})

    def test_another_customer_cannot_read_entitlements(self):
        product = Product.objects.create(
            slug="song-poster", name_i18n_key="x", category=Product.CATEGORY_MUSIC, status=Product.STATUS_AVAILABLE
        )
        pack = make_delivery_pack(product=product, slug="printable")

        login_as_guest(self.client)
        create_response = self.client.post(
            "/api/v1/orders/",
            {"productId": product.slug, "deliveryPackId": pack.slug},
            format="json",
            **csrf_headers(self.client),
        )
        order_id = create_response.data["id"]
        self.client.post(f"/api/v1/orders/{order_id}/pay/", **csrf_headers(self.client))

        other_client = APIClient(enforce_csrf_checks=True)
        login_as_guest(other_client)
        response = other_client.get(f"/api/v1/orders/{order_id}/entitlements/")

        self.assertEqual(response.status_code, http_status.HTTP_403_FORBIDDEN)


class GrantEntitlementsServiceTests(TestCase):
    def test_one_entitlement_per_included_target(self):
        order = make_order(
            delivery_pack=make_delivery_pack(included_targets=["print-png", "story-png", "square-png"])
        )
        grant_entitlements(order)
        self.assertEqual(Entitlement.objects.filter(order=order).count(), 3)

    def test_grant_entitlements_is_idempotent(self):
        order = make_order(delivery_pack=make_delivery_pack(included_targets=["print-png", "__live__"]))
        grant_entitlements(order)
        grant_entitlements(order)  # calling twice must not duplicate or raise
        self.assertEqual(Entitlement.objects.filter(order=order).count(), 2)


class TransactionSafetyTests(TestCase):
    def test_entitlement_failure_rolls_back_payment_and_order_status(self):
        """If entitlement generation raises mid-transaction, the whole
        confirm_payment transaction — including the just-created
        successful Payment row and the order's paid status — rolls
        back. An order must never end up "paid" without its
        entitlements.
        """
        customer = make_customer()
        product = make_product()
        pack = make_delivery_pack(product=product, included_targets=["print-png"])
        order = make_order(customer=customer, product=product, delivery_pack=pack)

        with patch("apps.commerce.services.grant_entitlements", side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError):
                confirm_payment(customer, order.id)

        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_PENDING)
        self.assertEqual(Payment.objects.filter(order=order).count(), 0)
        self.assertEqual(Entitlement.objects.filter(order=order).count(), 0)


class OrderPaymentContractTests(TestCase):
    """Phase 3.6 — field naming checked directly against the frontend's
    real `Order`/`Entitlement` TypeScript interfaces
    (src/types/commerce.ts), which the Phase 3.4 serializers were
    missing several fields from.
    """

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)

    def _create_order(self):
        product = Product.objects.create(
            slug="love-story-timeline", name_i18n_key="x", category=Product.CATEGORY_TIMELINE, status="available"
        )
        pack = make_delivery_pack(product=product, slug="printable", price_cents=1200, included_targets=["print-png"])
        login_as_guest(self.client, email="contract-test@example.com")
        response = self.client.post(
            "/api/v1/orders/",
            {"productId": product.slug, "deliveryPackId": pack.slug},
            format="json",
            **csrf_headers(self.client),
        )
        return response.data["id"]

    def test_order_response_includes_order_id_alias(self):
        order_id = self._create_order()
        response = self.client.get(f"/api/v1/orders/{order_id}/")
        self.assertEqual(response.data["orderId"], order_id)
        self.assertEqual(response.data["id"], order_id)

    def test_order_response_includes_guest_email(self):
        order_id = self._create_order()
        response = self.client.get(f"/api/v1/orders/{order_id}/")
        self.assertEqual(response.data["guestEmail"], "contract-test@example.com")

    def test_pending_order_has_sensible_payment_defaults_not_null(self):
        """The frontend types paymentProvider/paymentStatus as required
        (non-optional) strings — an order with no payment attempt yet
        must not return null for either.
        """
        order_id = self._create_order()
        response = self.client.get(f"/api/v1/orders/{order_id}/")
        self.assertEqual(response.data["paymentStatus"], "pending")
        self.assertIsNotNone(response.data["paymentProvider"])

    def test_paid_order_reflects_actual_payment_provider_and_status(self):
        order_id = self._create_order()
        self.client.post(f"/api/v1/orders/{order_id}/pay/", **csrf_headers(self.client))

        response = self.client.get(f"/api/v1/orders/{order_id}/")
        self.assertEqual(response.data["paymentStatus"], "success")
        self.assertEqual(response.data["paymentProvider"], "mock")

    def test_entitlement_items_include_order_id_and_product_id(self):
        order_id = self._create_order()
        self.client.post(f"/api/v1/orders/{order_id}/pay/", **csrf_headers(self.client))

        response = self.client.get(f"/api/v1/orders/{order_id}/entitlements/")
        entitlement = response.data["entitlements"][0]
        self.assertEqual(entitlement["orderId"], order_id)
        self.assertEqual(entitlement["productId"], "love-story-timeline")
        self.assertEqual(entitlement["targetId"], "print-png")

    def test_delivery_pack_slug_scoped_to_product_cannot_be_reused_cross_product(self):
        """Rule 3: a pack slug that's real, but belongs to a different
        product, must not be purchasable by simply reusing the slug
        string against a different productId.
        """
        product_a = Product.objects.create(
            slug="heart-map", name_i18n_key="x", category=Product.CATEGORY_MAP, status="available"
        )
        product_b = Product.objects.create(
            slug="song-poster", name_i18n_key="x", category=Product.CATEGORY_MUSIC, status="available"
        )
        make_delivery_pack(product=product_a, slug="printable")

        login_as_guest(self.client)
        response = self.client.post(
            "/api/v1/orders/",
            {"productId": product_b.slug, "deliveryPackId": "printable"},
            format="json",
            **csrf_headers(self.client),
        )
        self.assertEqual(response.status_code, http_status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.data["error"]["code"], "delivery_pack_not_found")


class ConcurrentPaymentConfirmationTests(TransactionTestCase):
    """Uses TransactionTestCase (real commits, not the default
    TestCase's single wrapping transaction) so that concurrent threads
    with separate DB connections genuinely race against
    `select_for_update()`, the same way two simultaneous requests would
    in production.
    """

    def tearDown(self):
        connections.close_all()

    def test_concurrent_confirmation_does_not_duplicate_payment_or_entitlements(self):
        customer = make_customer()
        product = make_product()
        pack = make_delivery_pack(product=product, included_targets=["print-png", "story-png"])
        order = make_order(customer=customer, product=product, delivery_pack=pack)

        errors = []

        def attempt():
            try:
                confirm_payment(customer, order.id)
            except Exception as exc:  # pragma: no cover - only on genuine failure
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=attempt) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)

        # See apps/delivery/tests.py's ConcurrentDownloadTests for why
        # this check matters: a thread still alive after the join
        # timeout means its connection hasn't been closed yet, and
        # that's the actual mechanism behind "database is being
        # accessed by other users" at final test-database teardown —
        # not a bug in `connection.close()` itself.
        stuck = [t.name for t in threads if t.is_alive()]
        self.assertEqual(stuck, [], f"{len(stuck)} thread(s) did not finish within the join timeout")

        self.assertEqual(errors, [])

        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_PAID)
        self.assertEqual(Payment.objects.filter(order=order, status=Payment.STATUS_SUCCESS).count(), 1)
        self.assertEqual(Entitlement.objects.filter(order=order).count(), 2)


# ------------------------------------------------------------------
# Phase 3.7 — Paddle payment integration
# ------------------------------------------------------------
# All Paddle API calls are mocked (no real credentials/network calls).
# Webhook signature tests use real HMAC-SHA256 signatures computed
# against a test secret, exercising the actual cryptographic
# verification code path — not a stub that always returns True.

TEST_WEBHOOK_SECRET = "test_webhook_secret_for_phase_3_7"


def make_paddle_signature_header(secret: str, raw_body: bytes, *, timestamp: int | None = None) -> str:
    ts = timestamp if timestamp is not None else int(time.time())
    signed_payload = f"{ts}:{raw_body.decode()}".encode()
    signature = hmac.new(secret.encode(), signed_payload, hashlib.sha256).hexdigest()
    return f"ts={ts};h1={signature}"


def make_transaction_paid_payload(*, transaction_id: str, order_id, total_cents: int, currency: str = "USD") -> bytes:
    payload = {
        "event_type": "transaction.paid",
        "data": {
            "id": transaction_id,
            "status": "paid",
            "currency_code": currency,
            "custom_data": {"orderId": str(order_id)},
            "details": {"totals": {"subtotal": str(total_cents), "discount": "0", "tax": "0", "total": str(total_cents)}},
        },
    }
    return json.dumps(payload).encode()


@override_settings(PADDLE_API_KEY="test_api_key", PADDLE_ENVIRONMENT="sandbox")
class PaddleProviderTests(TestCase):
    """`create_transaction` against a mocked Paddle SDK client — no
    real network calls, no real credentials.
    """

    def _make_order(self):
        product = make_product(slug="love-story-timeline")
        pack = make_delivery_pack(product=product, price_cents=1200)
        customer = make_customer()
        return make_order(customer=customer, product=product, delivery_pack=pack, subtotal_cents=1200, total_cents=1200)

    def test_create_transaction_uses_order_amount_and_currency(self):
        order = self._make_order()
        fake_response = SimpleNamespace(id="txn_abc123", status="draft")

        with patch("apps.commerce.paddle_integration.Client") as MockClient:
            MockClient.return_value.transactions.create.return_value = fake_response
            result = create_transaction(order)

        operation = MockClient.return_value.transactions.create.call_args[0][0]
        item = operation.items[0]
        self.assertEqual(item.price.unit_price.amount, str(order.total_cents))
        self.assertEqual(item.price.unit_price.currency_code.value, order.currency)
        self.assertEqual(result.transaction_id, "txn_abc123")

    def test_create_transaction_includes_order_id_in_custom_data(self):
        order = self._make_order()
        fake_response = SimpleNamespace(id="txn_xyz", status="draft")

        with patch("apps.commerce.paddle_integration.Client") as MockClient:
            MockClient.return_value.transactions.create.return_value = fake_response
            create_transaction(order)

        operation = MockClient.return_value.transactions.create.call_args[0][0]
        self.assertEqual(operation.custom_data.data, {"orderId": str(order.id)})

    def test_create_transaction_uses_sandbox_environment_and_api_key(self):
        order = self._make_order()
        fake_response = SimpleNamespace(id="txn_1", status="draft")

        with patch("apps.commerce.paddle_integration.Client") as MockClient:
            MockClient.return_value.transactions.create.return_value = fake_response
            create_transaction(order)

        args, kwargs = MockClient.call_args
        self.assertEqual(args[0], "test_api_key")
        # Options(Environment.SANDBOX) was passed — Environment.SANDBOX's
        # value is "sandbox".
        self.assertEqual(str(kwargs["options"].environment.value), "sandbox")

    def test_create_transaction_provider_reference_extraction(self):
        order = self._make_order()
        fake_response = SimpleNamespace(id="txn_reference_check", status="ready")

        with patch("apps.commerce.paddle_integration.Client") as MockClient:
            MockClient.return_value.transactions.create.return_value = fake_response
            result = create_transaction(order)

        self.assertEqual(result.transaction_id, "txn_reference_check")
        self.assertEqual(result.status, "ready")

    def test_create_transaction_failure_raises_wrapped_exception(self):
        from .paddle_integration import PaddleTransactionCreationFailed

        order = self._make_order()
        with patch("apps.commerce.paddle_integration.Client") as MockClient:
            MockClient.return_value.transactions.create.side_effect = RuntimeError("simulated Paddle API failure")
            with self.assertRaises(PaddleTransactionCreationFailed):
                create_transaction(order)

    @override_settings(PAYMENT_PROVIDER="paddle")
    def test_get_payment_provider_returns_paddle_when_configured(self):
        provider = get_payment_provider()
        self.assertEqual(provider.id, "paddle")
        self.assertFalse(provider.synchronous)

    def test_get_payment_provider_returns_mock_by_default(self):
        provider = get_payment_provider()
        self.assertEqual(provider.id, "mock")
        self.assertTrue(provider.synchronous)

    @override_settings(PAYMENT_PROVIDER="stripe")
    def test_get_payment_provider_raises_on_an_unrecognized_provider_name(self):
        # The exact incident this guards against: a provider name set
        # before its code exists (or a typo) must never silently fall
        # through to Mock, which would grant entitlements without
        # charging anyone anything. "fastspring" is no longer usable as
        # this example — it is now a recognized, validated value (see
        # the fastspring tests just below in this same class) — so a
        # genuinely unrecognized name is used instead.
        from .payment_provider import UnrecognizedPaymentProvider

        with self.assertRaises(UnrecognizedPaymentProvider):
            get_payment_provider()

    @override_settings(PAYMENT_PROVIDER="")
    def test_get_payment_provider_raises_on_an_empty_provider_name(self):
        from .payment_provider import UnrecognizedPaymentProvider

        with self.assertRaises(UnrecognizedPaymentProvider):
            get_payment_provider()

    @override_settings(
        PAYMENT_PROVIDER="fastspring",
        FASTSPRING_API_USERNAME="test_user",
        FASTSPRING_API_PASSWORD="test_pass",
    )
    def test_get_payment_provider_returns_fastspring_when_configured(self):
        provider = get_payment_provider()
        self.assertEqual(provider.id, "fastspring")
        self.assertFalse(provider.synchronous)

    @override_settings(PAYMENT_PROVIDER="fastspring", FASTSPRING_API_USERNAME="", FASTSPRING_API_PASSWORD="")
    def test_get_payment_provider_raises_when_fastspring_credentials_missing(self):
        with self.assertRaises(FastSpringConfigurationError):
            get_payment_provider()


class PaddleWebhookSignatureTests(TestCase):
    """Real HMAC-SHA256 signatures against a test secret — exercises
    the actual verification algorithm, not a stub.
    """

    def setUp(self):
        self.client = APIClient()
        self.body = make_transaction_paid_payload(transaction_id="txn_1", order_id=uuid.uuid4(), total_cents=1200)

    @override_settings(PADDLE_WEBHOOK_SECRET=TEST_WEBHOOK_SECRET, PAYMENT_PROVIDER="paddle")
    def test_valid_signature_accepted(self):
        header = make_paddle_signature_header(TEST_WEBHOOK_SECRET, self.body)
        response = self.client.generic(
            "POST", "/api/v1/webhooks/paddle/", data=self.body, content_type="application/json",
            HTTP_PADDLE_SIGNATURE=header,
        )
        # Accepted through signature verification (may still 404 on the
        # order itself, since it's a random uuid — that's a separate
        # concern from signature validity).
        self.assertNotEqual(response.status_code, http_status.HTTP_401_UNAUTHORIZED)

    @override_settings(PADDLE_WEBHOOK_SECRET=TEST_WEBHOOK_SECRET, PAYMENT_PROVIDER="paddle")
    def test_invalid_signature_rejected(self):
        header = make_paddle_signature_header("a-completely-different-secret", self.body)
        response = self.client.generic(
            "POST", "/api/v1/webhooks/paddle/", data=self.body, content_type="application/json",
            HTTP_PADDLE_SIGNATURE=header,
        )
        self.assertEqual(response.status_code, http_status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(response.data["error"]["code"], "paddle_webhook_signature_invalid")

    @override_settings(PADDLE_WEBHOOK_SECRET=TEST_WEBHOOK_SECRET, PAYMENT_PROVIDER="paddle")
    def test_missing_signature_rejected(self):
        response = self.client.generic(
            "POST", "/api/v1/webhooks/paddle/", data=self.body, content_type="application/json",
        )
        self.assertEqual(response.status_code, http_status.HTTP_401_UNAUTHORIZED)

    @override_settings(PADDLE_WEBHOOK_SECRET=TEST_WEBHOOK_SECRET, PAYMENT_PROVIDER="paddle")
    def test_malformed_signature_header_rejected(self):
        response = self.client.generic(
            "POST", "/api/v1/webhooks/paddle/", data=self.body, content_type="application/json",
            HTTP_PADDLE_SIGNATURE="not-a-valid-header-format",
        )
        self.assertEqual(response.status_code, http_status.HTTP_401_UNAUTHORIZED)

    @override_settings(PADDLE_WEBHOOK_SECRET=TEST_WEBHOOK_SECRET, PAYMENT_PROVIDER="paddle")
    def test_stale_timestamp_rejected(self):
        stale_header = make_paddle_signature_header(TEST_WEBHOOK_SECRET, self.body, timestamp=int(time.time()) - 3600)
        response = self.client.generic(
            "POST", "/api/v1/webhooks/paddle/", data=self.body, content_type="application/json",
            HTTP_PADDLE_SIGNATURE=stale_header,
        )
        self.assertEqual(response.status_code, http_status.HTTP_401_UNAUTHORIZED)

    def test_verify_webhook_signature_function_directly(self):
        """Direct unit test of the verification function, independent
        of the HTTP layer.
        """
        with override_settings(PADDLE_WEBHOOK_SECRET=TEST_WEBHOOK_SECRET):
            from django.test import RequestFactory

            header = make_paddle_signature_header(TEST_WEBHOOK_SECRET, self.body)
            django_request = RequestFactory().post(
                "/api/v1/webhooks/paddle/", data=self.body, content_type="application/json",
                HTTP_PADDLE_SIGNATURE=header,
            )
            self.assertTrue(verify_webhook_signature(django_request, self.body))

            wrong_header = make_paddle_signature_header("wrong-secret", self.body)
            django_request_bad = RequestFactory().post(
                "/api/v1/webhooks/paddle/", data=self.body, content_type="application/json",
                HTTP_PADDLE_SIGNATURE=wrong_header,
            )
            self.assertFalse(verify_webhook_signature(django_request_bad, self.body))


@override_settings(PADDLE_WEBHOOK_SECRET=TEST_WEBHOOK_SECRET, PAYMENT_PROVIDER="paddle")
class PaddleWebhookEventHandlingTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _post_webhook(self, body: bytes):
        header = make_paddle_signature_header(TEST_WEBHOOK_SECRET, body)
        return self.client.generic(
            "POST", "/api/v1/webhooks/paddle/", data=body, content_type="application/json",
            HTTP_PADDLE_SIGNATURE=header,
        )

    def _make_pending_order(self, total_cents=1200, currency="USD"):
        product = make_product(slug="heart-map")
        pack = make_delivery_pack(product=product, price_cents=total_cents, currency=currency, included_targets=["print-png", "__live__"])
        customer = make_customer()
        return make_order(
            customer=customer, product=product, delivery_pack=pack,
            subtotal_cents=total_cents, total_cents=total_cents, currency=currency,
        )

    def test_successful_payment_event_marks_order_paid(self):
        order = self._make_pending_order()
        body = make_transaction_paid_payload(transaction_id="txn_success", order_id=order.id, total_cents=order.total_cents)

        response = self._post_webhook(body)

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_PAID)

    def test_successful_payment_event_creates_entitlements(self):
        order = self._make_pending_order()
        body = make_transaction_paid_payload(transaction_id="txn_ent", order_id=order.id, total_cents=order.total_cents)

        self._post_webhook(body)

        target_ids = set(Entitlement.objects.filter(order=order).values_list("target_id", flat=True))
        self.assertEqual(target_ids, {"print-png", "__live__"})

    def test_payment_creates_payment_row_with_paddle_provider(self):
        order = self._make_pending_order()
        body = make_transaction_paid_payload(transaction_id="txn_payment_row", order_id=order.id, total_cents=order.total_cents)

        self._post_webhook(body)

        payment = Payment.objects.get(order=order)
        self.assertEqual(payment.provider, "paddle")
        self.assertEqual(payment.provider_reference, "txn_payment_row")
        self.assertEqual(payment.status, Payment.STATUS_SUCCESS)

    def test_unrelated_event_does_not_grant_entitlements(self):
        order = self._make_pending_order()
        body = json.dumps({
            "event_type": "transaction.created",
            "data": {"id": "txn_x", "status": "draft", "currency_code": "USD",
                      "custom_data": {"orderId": str(order.id)},
                      "details": {"totals": {"subtotal": "1200", "discount": "0", "tax": "0", "total": "1200"}}},
        }).encode()

        response = self._post_webhook(body)

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "ignored")
        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_PENDING)
        self.assertEqual(Entitlement.objects.filter(order=order).count(), 0)

    def test_unknown_event_type_does_not_crash(self):
        body = json.dumps({"event_type": "some.future.event.type", "data": {}}).encode()
        response = self._post_webhook(body)
        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "ignored")


@override_settings(PADDLE_WEBHOOK_SECRET=TEST_WEBHOOK_SECRET, PAYMENT_PROVIDER="paddle")
class PaddleWebhookSecurityTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_webhook_does_not_require_guest_session(self):
        """No login_as_guest() call anywhere in this test — proves the
        endpoint works for a completely anonymous client.
        """
        order = Order.objects.none()  # no order needed for this assertion
        body = json.dumps({"event_type": "transaction.created", "data": {"id": "x"}}).encode()
        header = make_paddle_signature_header(TEST_WEBHOOK_SECRET, body)
        response = self.client.generic(
            "POST", "/api/v1/webhooks/paddle/", data=body, content_type="application/json",
            HTTP_PADDLE_SIGNATURE=header,
        )
        self.assertEqual(response.status_code, http_status.HTTP_200_OK)

    def test_webhook_does_not_require_csrf_token(self):
        """CSRF-enforcing client, no X-CSRFToken header anywhere — a
        real Paddle server obviously can't carry a Django CSRF token.
        """
        strict_client = APIClient(enforce_csrf_checks=True)
        body = json.dumps({"event_type": "transaction.created", "data": {"id": "x"}}).encode()
        header = make_paddle_signature_header(TEST_WEBHOOK_SECRET, body)
        response = strict_client.generic(
            "POST", "/api/v1/webhooks/paddle/", data=body, content_type="application/json",
            HTTP_PADDLE_SIGNATURE=header,
        )
        self.assertNotEqual(response.status_code, http_status.HTTP_403_FORBIDDEN)

    def test_invalid_signature_cannot_mutate_database(self):
        product = make_product(slug="song-poster")
        pack = make_delivery_pack(product=product, price_cents=1200)
        customer = make_customer()
        order = make_order(customer=customer, product=product, delivery_pack=pack, subtotal_cents=1200, total_cents=1200)

        body = make_transaction_paid_payload(transaction_id="txn_attack", order_id=order.id, total_cents=1200)
        bad_header = make_paddle_signature_header("wrong-secret", body)

        self.client.generic(
            "POST", "/api/v1/webhooks/paddle/", data=body, content_type="application/json",
            HTTP_PADDLE_SIGNATURE=bad_header,
        )

        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_PENDING)
        self.assertEqual(Payment.objects.filter(order=order).count(), 0)
        self.assertEqual(Entitlement.objects.filter(order=order).count(), 0)

    def test_webhook_cannot_select_arbitrary_order_without_valid_custom_data(self):
        body = json.dumps({
            "event_type": "transaction.paid",
            "data": {"id": "txn_no_order", "status": "paid", "currency_code": "USD",
                      "custom_data": {},  # no orderId at all
                      "details": {"totals": {"subtotal": "1200", "discount": "0", "tax": "0", "total": "1200"}}},
        }).encode()
        header = make_paddle_signature_header(TEST_WEBHOOK_SECRET, body)

        response = self.client.generic(
            "POST", "/api/v1/webhooks/paddle/", data=body, content_type="application/json",
            HTTP_PADDLE_SIGNATURE=header,
        )
        self.assertEqual(response.status_code, http_status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.data["error"]["code"], "payment_transaction_not_found")


@override_settings(PADDLE_WEBHOOK_SECRET=TEST_WEBHOOK_SECRET, PAYMENT_PROVIDER="paddle")
class PaddleWebhookIdempotencyTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_duplicate_webhook_delivery_is_safe(self):
        product = make_product(slug="star-map")
        pack = make_delivery_pack(product=product, price_cents=1200, included_targets=["print-png", "story-png"])
        customer = make_customer()
        order = make_order(customer=customer, product=product, delivery_pack=pack, subtotal_cents=1200, total_cents=1200)

        body = make_transaction_paid_payload(transaction_id="txn_dup", order_id=order.id, total_cents=1200)
        header = make_paddle_signature_header(TEST_WEBHOOK_SECRET, body)

        first = self.client.generic(
            "POST", "/api/v1/webhooks/paddle/", data=body, content_type="application/json",
            HTTP_PADDLE_SIGNATURE=header,
        )
        second = self.client.generic(
            "POST", "/api/v1/webhooks/paddle/", data=body, content_type="application/json",
            HTTP_PADDLE_SIGNATURE=header,
        )

        self.assertEqual(first.status_code, http_status.HTTP_200_OK)
        self.assertEqual(second.status_code, http_status.HTTP_200_OK)

        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_PAID)
        self.assertEqual(Payment.objects.filter(order=order, status=Payment.STATUS_SUCCESS).count(), 1)
        self.assertEqual(Entitlement.objects.filter(order=order).count(), 2)


@override_settings(PADDLE_WEBHOOK_SECRET=TEST_WEBHOOK_SECRET, PAYMENT_PROVIDER="paddle")
class PaddleAmountReconciliationTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_amount_mismatch_does_not_mark_order_paid_or_grant_entitlements(self):
        product = make_product(slug="love-story-timeline")
        pack = make_delivery_pack(product=product, price_cents=1200, included_targets=["print-png"])
        customer = make_customer()
        order = make_order(customer=customer, product=product, delivery_pack=pack, subtotal_cents=1200, total_cents=1200)

        # Webhook claims only 1 cent was paid — must not be trusted.
        body = make_transaction_paid_payload(transaction_id="txn_mismatch", order_id=order.id, total_cents=1)
        header = make_paddle_signature_header(TEST_WEBHOOK_SECRET, body)

        response = self.client.generic(
            "POST", "/api/v1/webhooks/paddle/", data=body, content_type="application/json",
            HTTP_PADDLE_SIGNATURE=header,
        )

        self.assertEqual(response.status_code, http_status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["error"]["code"], "payment_amount_mismatch")

        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_PENDING)
        self.assertEqual(Payment.objects.filter(order=order).count(), 0)
        self.assertEqual(Entitlement.objects.filter(order=order).count(), 0)

    def test_currency_mismatch_does_not_mark_order_paid(self):
        product = make_product(slug="song-poster")
        pack = make_delivery_pack(product=product, price_cents=1200, currency="USD", included_targets=["print-png"])
        customer = make_customer()
        order = make_order(customer=customer, product=product, delivery_pack=pack, subtotal_cents=1200, total_cents=1200, currency="USD")

        body = make_transaction_paid_payload(transaction_id="txn_currency", order_id=order.id, total_cents=1200, currency="EUR")
        header = make_paddle_signature_header(TEST_WEBHOOK_SECRET, body)

        response = self.client.generic(
            "POST", "/api/v1/webhooks/paddle/", data=body, content_type="application/json",
            HTTP_PADDLE_SIGNATURE=header,
        )

        self.assertEqual(response.status_code, http_status.HTTP_400_BAD_REQUEST)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_PENDING)

    def test_provider_reference_already_bound_to_a_different_order_is_rejected(self):
        """`Payment.objects.get_or_create(provider=..., provider_reference=...)`
        matches only on those two fields — it does not, by itself, verify
        the found row belongs to the order `custom_data.orderId` resolved
        to. A Paddle transaction id already associated with order A must
        never be reusable to mark an unrelated order B paid; that would
        leave the real Payment row pointing at A while B is (incorrectly)
        paid and entitled. Reject safely instead of silently reconciling.
        """
        product = make_product(slug="love-story-timeline")
        pack = make_delivery_pack(product=product, price_cents=1200, included_targets=["print-png"])
        customer_a = make_customer()
        customer_b = make_customer()
        order_a = make_order(
            customer=customer_a, product=product, delivery_pack=pack, subtotal_cents=1200, total_cents=1200
        )
        order_b = make_order(
            customer=customer_b, product=product, delivery_pack=pack, subtotal_cents=1200, total_cents=1200
        )

        shared_transaction_id = "txn_reused_reference"
        Payment.objects.create(
            order=order_a,
            provider="paddle",
            provider_reference=shared_transaction_id,
            amount_cents=order_a.total_cents,
            currency=order_a.currency,
            status=Payment.STATUS_PENDING,
        )

        # A webhook delivery names order_b via custom_data.orderId but
        # reuses the transaction id already bound to order_a.
        body = make_transaction_paid_payload(
            transaction_id=shared_transaction_id, order_id=order_b.id, total_cents=1200
        )
        header = make_paddle_signature_header(TEST_WEBHOOK_SECRET, body)

        response = self.client.generic(
            "POST", "/api/v1/webhooks/paddle/", data=body, content_type="application/json",
            HTTP_PADDLE_SIGNATURE=header,
        )

        self.assertEqual(response.status_code, http_status.HTTP_400_BAD_REQUEST)

        order_a.refresh_from_db()
        order_b.refresh_from_db()
        payment = Payment.objects.get(provider="paddle", provider_reference=shared_transaction_id)

        # Neither order was mutated, and the pre-existing Payment row
        # still belongs to the order it was actually created for.
        self.assertEqual(order_a.status, Order.STATUS_PENDING)
        self.assertEqual(order_b.status, Order.STATUS_PENDING)
        self.assertEqual(payment.order_id, order_a.id)
        self.assertEqual(payment.status, Payment.STATUS_PENDING)
        self.assertEqual(Entitlement.objects.filter(order=order_a).count(), 0)
        self.assertEqual(Entitlement.objects.filter(order=order_b).count(), 0)


@override_settings(PADDLE_WEBHOOK_SECRET=TEST_WEBHOOK_SECRET, PAYMENT_PROVIDER="paddle")
class PaddleWebhookTransactionSafetyTests(TestCase):
    def test_entitlement_failure_rolls_back_payment_and_order_status(self):
        product = make_product(slug="heart-map")
        pack = make_delivery_pack(product=product, price_cents=1200, included_targets=["print-png"])
        customer = make_customer()
        order = make_order(customer=customer, product=product, delivery_pack=pack, subtotal_cents=1200, total_cents=1200)

        event = PaddleWebhookEvent(
            event_type="transaction.paid", transaction_id="txn_rollback", transaction_status="paid",
            currency_code="USD", total_cents="1200", order_id=str(order.id),
            # §7a added `country_code` to the dataclass and this call was
            # never updated. None is the realistic value as well as the
            # compiling one: Paddle does not guarantee an address on every
            # webhook, which is why reports carry an "Unknown" bucket.
            country_code=None,
        )

        with patch("apps.commerce.services.grant_entitlements", side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError):
                confirm_paddle_webhook_payment(event)

        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_PENDING)
        self.assertEqual(Payment.objects.filter(order=order).count(), 0)
        self.assertEqual(Entitlement.objects.filter(order=order).count(), 0)


class PaddleWebhookConcurrencyTests(TransactionTestCase):
    """Multiple webhook deliveries racing for the same order — mirrors
    the Phase 3.4 concurrent-payment test pattern exactly, using
    `TransactionTestCase` so separate threads/connections genuinely
    race against `select_for_update()`.
    """

    def tearDown(self):
        connections.close_all()

    @override_settings(PADDLE_WEBHOOK_SECRET=TEST_WEBHOOK_SECRET, PAYMENT_PROVIDER="paddle")
    def test_concurrent_webhook_deliveries_do_not_duplicate_payment_or_entitlements(self):
        product = make_product(slug="love-story-timeline")
        pack = make_delivery_pack(product=product, price_cents=1200, included_targets=["print-png", "story-png"])
        customer = make_customer()
        order = make_order(customer=customer, product=product, delivery_pack=pack, subtotal_cents=1200, total_cents=1200)

        body = make_transaction_paid_payload(transaction_id="txn_concurrent", order_id=order.id, total_cents=1200)
        header = make_paddle_signature_header(TEST_WEBHOOK_SECRET, body)

        errors = []

        def deliver():
            try:
                client = APIClient()
                client.generic(
                    "POST", "/api/v1/webhooks/paddle/", data=body, content_type="application/json",
                    HTTP_PADDLE_SIGNATURE=header,
                )
            except Exception as exc:  # pragma: no cover - only on genuine failure
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=deliver) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)

        # See apps/delivery/tests.py's ConcurrentDownloadTests for why
        # this check matters: a thread still alive after the join
        # timeout means its connection hasn't been closed yet, and
        # that's the actual mechanism behind "database is being
        # accessed by other users" at final test-database teardown —
        # not a bug in `connection.close()` itself.
        stuck = [t.name for t in threads if t.is_alive()]
        self.assertEqual(stuck, [], f"{len(stuck)} thread(s) did not finish within the join timeout")

        self.assertEqual(errors, [])

        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_PAID)
        self.assertEqual(Payment.objects.filter(order=order, status=Payment.STATUS_SUCCESS).count(), 1)
        self.assertEqual(Entitlement.objects.filter(order=order).count(), 2)


@override_settings(PAYMENT_PROVIDER="paddle", PADDLE_API_KEY="test_api_key")
class PaddleCheckoutStartTests(TestCase):
    """`POST /api/v1/orders/<id>/pay/` when Paddle is the active
    provider — asynchronous path: creates a checkout, does not mark the
    order paid.
    """

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)

    def _create_order(self):
        product = Product.objects.create(
            slug="love-story-timeline", name_i18n_key="x", category=Product.CATEGORY_TIMELINE, status="available"
        )
        pack = make_delivery_pack(product=product, slug="printable", price_cents=1200)
        login_as_guest(self.client, email="paddle-checkout@example.com")
        response = self.client.post(
            "/api/v1/orders/", {"productId": product.slug, "deliveryPackId": pack.slug},
            format="json", **csrf_headers(self.client),
        )
        return response.data["id"]

    def test_pay_creates_paddle_transaction_and_leaves_order_pending(self):
        order_id = self._create_order()
        fake_response = SimpleNamespace(id="txn_checkout_1", status="draft")

        with patch("apps.commerce.paddle_integration.Client") as MockClient:
            MockClient.return_value.transactions.create.return_value = fake_response
            response = self.client.post(f"/api/v1/orders/{order_id}/pay/", **csrf_headers(self.client))

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response.data["order"]["status"], "pending")  # NOT paid — webhook confirms later
        self.assertEqual(response.data["checkout"]["transactionId"], "txn_checkout_1")
        self.assertEqual(response.data["checkout"]["provider"], "paddle")

        payment = Payment.objects.get(order_id=order_id)
        self.assertEqual(payment.status, Payment.STATUS_PENDING)
        self.assertEqual(payment.provider_reference, "txn_checkout_1")

    def test_repeated_checkout_open_reuses_existing_pending_transaction(self):
        order_id = self._create_order()
        fake_response = SimpleNamespace(id="txn_checkout_2", status="draft")

        with patch("apps.commerce.paddle_integration.Client") as MockClient:
            MockClient.return_value.transactions.create.return_value = fake_response
            first = self.client.post(f"/api/v1/orders/{order_id}/pay/", **csrf_headers(self.client))
            second = self.client.post(f"/api/v1/orders/{order_id}/pay/", **csrf_headers(self.client))

        self.assertEqual(first.data["checkout"]["transactionId"], second.data["checkout"]["transactionId"])
        self.assertEqual(MockClient.return_value.transactions.create.call_count, 1)  # not called twice
        self.assertEqual(Payment.objects.filter(order_id=order_id).count(), 1)

    def test_no_paddle_secrets_in_checkout_response(self):
        order_id = self._create_order()
        fake_response = SimpleNamespace(id="txn_checkout_3", status="draft")

        with patch("apps.commerce.paddle_integration.Client") as MockClient:
            MockClient.return_value.transactions.create.return_value = fake_response
            response = self.client.post(f"/api/v1/orders/{order_id}/pay/", **csrf_headers(self.client))

        response_text = json.dumps(response.data)
        self.assertNotIn("test_api_key", response_text)
        self.assertNotIn("PADDLE_API_KEY", response_text)
        self.assertNotIn("PADDLE_WEBHOOK_SECRET", response_text)

    def test_paying_already_paid_order_does_not_create_new_transaction(self):
        order_id = self._create_order()
        product_order = Order.objects.get(id=order_id)
        # Simulate a prior successful webhook confirmation directly.
        Payment.objects.create(
            order=product_order, provider="paddle", provider_reference="txn_already_paid",
            amount_cents=1200, currency="USD", status=Payment.STATUS_SUCCESS,
        )
        product_order.status = Order.STATUS_PAID
        product_order.save(update_fields=["status"])

        with patch("apps.commerce.paddle_integration.Client") as MockClient:
            response = self.client.post(f"/api/v1/orders/{order_id}/pay/", **csrf_headers(self.client))

        self.assertEqual(response.data["order"]["status"], "paid")
        self.assertEqual(response.data["payment"]["providerReference"], "txn_already_paid")
        MockClient.return_value.transactions.create.assert_not_called()


# ------------------------------------------------------------------
# FastSpring payment integration (sandbox; Paddle remains the live
# default). All FastSpring HTTP calls are mocked (no real credentials/
# network calls). Webhook signature tests use real HMAC-SHA256 signatures
# computed against a test secret — same discipline as the Paddle section
# above, adapted for FastSpring's simpler (no timestamp) scheme.
# ------------------------------------------------------------------

FASTSPRING_TEST_WEBHOOK_SECRET = "test_fastspring_webhook_secret"


def make_fastspring_signature_header(secret: str, raw_body: bytes) -> str:
    digest = hmac.new(secret.encode(), raw_body, hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


def make_fastspring_order_event(
    *,
    event_id: str = "evt_1",
    event_type: str = ORDER_COMPLETED_EVENT,
    fastspring_reference: str = "fs_order_1",
    order_id,
    total: str,
    currency: str = "USD",
    live: bool = False,
) -> dict:
    return {
        "id": event_id,
        "live": live,
        "processed": True,
        "type": event_type,
        "created": 1234567890,
        "data": {
            "id": fastspring_reference,
            "currency": currency,
            "total": total,
            "tags": {"orderId": str(order_id)},
        },
    }


def make_fastspring_webhook_payload(*events: dict) -> bytes:
    return json.dumps({"events": list(events)}).encode()


class FastSpringProductPathMappingTests(TestCase):
    """The direct guard against the `supported_targets` incident
    CLAUDE.md documents for a different pair of hardcoded maps: a pack
    that exists in Django with no matching `PACK_SLUG_TO_PRODUCT_PATH`
    entry must fail a test, not silently misbehave at the first real
    FastSpring checkout.
    """

    #: The five real, sellable, per-product pack slugs — see
    #: backend/seed_catalog.py's own CATALOG entries for Love Story
    #: Timeline and Song Poster.
    REAL_PACK_SLUGS = ("printable", "live", "complete", "printable-plus-wallpaper", "digital-plus-wallpaper")

    def test_every_active_delivery_pack_has_a_fastspring_product_path(self):
        for product_slug in ("love-story-timeline", "song-poster"):
            product = make_product(slug=product_slug)
            for slug in self.REAL_PACK_SLUGS:
                make_delivery_pack(product=product, slug=slug, price_cents=1000)
            # The standalone wallpaper pack — deliberately NOT one of
            # FastSpring's ten products ("wallpapers are add-ons, not
            # standalone products", confirmed directly). Created here so
            # its absence from the mapping is proven to be a deliberate,
            # accounted-for exclusion, not something this test simply
            # never looked at.
            make_delivery_pack(product=product, slug="wallpaper", price_cents=800)

        for pack in DeliveryPack.objects.filter(status=DeliveryPack.STATUS_ACTIVE):
            key = (pack.product.slug, pack.slug)
            if pack.slug == "wallpaper":
                self.assertNotIn(key, PACK_SLUG_TO_PRODUCT_PATH)
                continue
            self.assertIn(
                key,
                PACK_SLUG_TO_PRODUCT_PATH,
                f"No FastSpring product path mapped for {key} — add one to "
                "PACK_SLUG_TO_PRODUCT_PATH before this pack can be sold via FastSpring.",
            )

    def test_the_mapping_has_exactly_the_ten_confirmed_product_paths(self):
        # Pins the mapping to the exact confirmed set — catches an entry
        # silently added, removed, or renamed, not just a gap.
        self.assertEqual(len(PACK_SLUG_TO_PRODUCT_PATH), 10)
        self.assertEqual(
            set(PACK_SLUG_TO_PRODUCT_PATH.values()),
            {
                "love-story-timeline-digital",
                "love-story-timeline-digital-wallpapers",
                "love-story-timeline-printable",
                "love-story-timeline-printable-wallpapers",
                "love-story-timeline-complete",
                "song-poster-digital",
                "song-poster-digital-wallpapers",
                "song-poster-printable",
                "song-poster-printable-wallpapers",
                "song-poster-complete",
            },
        )


@override_settings(FASTSPRING_API_USERNAME="test_user", FASTSPRING_API_PASSWORD="test_pass")
class FastSpringSessionCreationTests(TestCase):
    def _make_order(self, total_cents=1599, currency="USD", pack_slug="live", product_slug="love-story-timeline"):
        product = make_product(slug=product_slug)
        pack = make_delivery_pack(product=product, slug=pack_slug, price_cents=total_cents, currency=currency)
        customer = make_customer()
        return make_order(
            customer=customer, product=product, delivery_pack=pack,
            subtotal_cents=total_cents, total_cents=total_cents, currency=currency,
        )

    def test_create_session_posts_the_mapped_product_path_and_price_override(self):
        order = self._make_order(total_cents=1599)
        fake_response = MagicMock()
        fake_response.json.return_value = {
            "id": "OS_test_1",
            "checkoutUrls": {"webcheckoutUrl": "https://heartfolio.test.onfastspring.com/session/OS_test_1"},
        }

        with patch("apps.commerce.fastspring_integration.requests.post", return_value=fake_response) as mock_post:
            result = create_session(order)

        self.assertEqual(result.session_id, "OS_test_1")
        self.assertEqual(result.checkout_url, "https://heartfolio.test.onfastspring.com/session/OS_test_1")

        _args, kwargs = mock_post.call_args
        self.assertTrue(mock_post.call_args[0][0].endswith("/v2/checkouts/heartfolio/popup-heartfolio/sessions"))
        body = kwargs["json"]
        self.assertEqual(body["orderTags"], {"orderId": str(order.id)})
        line_item = body["cart"]["lineItems"][0]
        self.assertEqual(line_item["productPath"], "love-story-timeline-digital")
        self.assertEqual(line_item["quantity"], 1)
        # THE STRUCTURAL PRICE-SAFETY MECHANISM: Django's price, not
        # whatever FastSpring's dashboard has configured for this path.
        self.assertEqual(line_item["pricing"]["price"], {"USD": "15.99"})
        self.assertEqual(kwargs["auth"], ("test_user", "test_pass"))

    def test_create_session_formats_a_whole_dollar_amount_with_two_decimals(self):
        order = self._make_order(total_cents=3900, pack_slug="complete")
        fake_response = MagicMock()
        fake_response.json.return_value = {"id": "OS_test_2", "checkoutUrls": {}}

        with patch("apps.commerce.fastspring_integration.requests.post", return_value=fake_response) as mock_post:
            create_session(order)

        line_item = mock_post.call_args.kwargs["json"]["cart"]["lineItems"][0]
        self.assertEqual(line_item["pricing"]["price"], {"USD": "39.00"})

    def test_create_session_raises_for_an_unmapped_pack(self):
        order = self._make_order(pack_slug="social")  # not in PACK_SLUG_TO_PRODUCT_PATH
        with self.assertRaises(FastSpringConfigurationError):
            create_session(order)

    @override_settings(FASTSPRING_API_USERNAME="", FASTSPRING_API_PASSWORD="")
    def test_create_session_raises_when_credentials_missing(self):
        order = self._make_order()
        with self.assertRaises(FastSpringConfigurationError):
            create_session(order)

    def test_create_session_wraps_a_request_failure(self):
        import requests as requests_module

        order = self._make_order()
        with patch(
            "apps.commerce.fastspring_integration.requests.post",
            side_effect=requests_module.ConnectionError("boom"),
        ):
            with self.assertRaises(FastSpringSessionCreationFailed):
                create_session(order)

    def test_create_session_wraps_an_http_error_status(self):
        import requests as requests_module

        order = self._make_order()
        fake_response = MagicMock()
        fake_response.raise_for_status.side_effect = requests_module.HTTPError("400 Client Error")

        with patch("apps.commerce.fastspring_integration.requests.post", return_value=fake_response):
            with self.assertRaises(FastSpringSessionCreationFailed):
                create_session(order)

    def test_create_session_raises_when_response_has_no_session_id(self):
        order = self._make_order()
        fake_response = MagicMock()
        fake_response.json.return_value = {"checkoutUrls": {}}

        with patch("apps.commerce.fastspring_integration.requests.post", return_value=fake_response):
            with self.assertRaises(FastSpringSessionCreationFailed):
                create_session(order)


class FastSpringWebhookSignatureTests(TestCase):
    """Real HMAC-SHA256 signatures against a test secret — exercises the
    actual verification algorithm, not a stub. Mirrors
    PaddleWebhookSignatureTests, minus the timestamp/replay-window
    scenarios Paddle's scheme has and FastSpring's documented one does
    not (see verify_webhook_signature's own docstring).
    """

    def setUp(self):
        self.body = make_fastspring_webhook_payload(
            make_fastspring_order_event(order_id=uuid.uuid4(), total="15.99")
        )

    def test_valid_signature_accepted(self):
        with override_settings(FASTSPRING_WEBHOOK_SECRET=FASTSPRING_TEST_WEBHOOK_SECRET):
            from django.test import RequestFactory

            header = make_fastspring_signature_header(FASTSPRING_TEST_WEBHOOK_SECRET, self.body)
            django_request = RequestFactory().post(
                "/api/v1/webhooks/fastspring/", data=self.body, content_type="application/json",
                HTTP_X_FS_SIGNATURE=header,
            )
            self.assertTrue(verify_fastspring_webhook_signature(django_request, self.body))

    def test_invalid_signature_rejected(self):
        with override_settings(FASTSPRING_WEBHOOK_SECRET=FASTSPRING_TEST_WEBHOOK_SECRET):
            from django.test import RequestFactory

            wrong_header = make_fastspring_signature_header("a-completely-different-secret", self.body)
            django_request = RequestFactory().post(
                "/api/v1/webhooks/fastspring/", data=self.body, content_type="application/json",
                HTTP_X_FS_SIGNATURE=wrong_header,
            )
            self.assertFalse(verify_fastspring_webhook_signature(django_request, self.body))

    def test_missing_signature_header_rejected(self):
        with override_settings(FASTSPRING_WEBHOOK_SECRET=FASTSPRING_TEST_WEBHOOK_SECRET):
            from django.test import RequestFactory

            django_request = RequestFactory().post(
                "/api/v1/webhooks/fastspring/", data=self.body, content_type="application/json",
            )
            self.assertFalse(verify_fastspring_webhook_signature(django_request, self.body))

    def test_a_tampered_body_is_rejected_even_with_a_header_from_the_original(self):
        with override_settings(FASTSPRING_WEBHOOK_SECRET=FASTSPRING_TEST_WEBHOOK_SECRET):
            from django.test import RequestFactory

            header = make_fastspring_signature_header(FASTSPRING_TEST_WEBHOOK_SECRET, self.body)
            tampered = self.body.replace(b"15.99", b"01.99")
            django_request = RequestFactory().post(
                "/api/v1/webhooks/fastspring/", data=tampered, content_type="application/json",
                HTTP_X_FS_SIGNATURE=header,
            )
            self.assertFalse(verify_fastspring_webhook_signature(django_request, tampered))

    @override_settings(FASTSPRING_WEBHOOK_SECRET="")
    def test_raises_when_webhook_secret_not_configured(self):
        from django.test import RequestFactory

        django_request = RequestFactory().post(
            "/api/v1/webhooks/fastspring/", data=self.body, content_type="application/json",
        )
        with self.assertRaises(FastSpringConfigurationError):
            verify_fastspring_webhook_signature(django_request, self.body)


class FastSpringWebhookPayloadParsingTests(TestCase):
    def test_parses_a_single_event(self):
        order_id = uuid.uuid4()
        body = make_fastspring_webhook_payload(
            make_fastspring_order_event(order_id=order_id, total="15.99", fastspring_reference="fs_1")
        )
        events = parse_fastspring_webhook_payload(body)

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].event_type, ORDER_COMPLETED_EVENT)
        self.assertEqual(events[0].order_id, str(order_id))
        self.assertEqual(events[0].fastspring_reference, "fs_1")
        self.assertEqual(events[0].currency_code, "USD")
        self.assertEqual(events[0].total, "15.99")
        self.assertFalse(events[0].live)

    def test_parses_multiple_events_in_one_delivery_without_assuming_one(self):
        order_id_1, order_id_2 = uuid.uuid4(), uuid.uuid4()
        body = make_fastspring_webhook_payload(
            make_fastspring_order_event(event_id="evt_a", order_id=order_id_1, total="15.99"),
            make_fastspring_order_event(event_id="evt_b", order_id=order_id_2, total="22.99", event_type=ORDER_FAILED_EVENT),
        )
        events = parse_fastspring_webhook_payload(body)

        self.assertEqual(len(events), 2)
        self.assertEqual([e.event_id for e in events], ["evt_a", "evt_b"])
        self.assertEqual(events[0].event_type, ORDER_COMPLETED_EVENT)
        self.assertEqual(events[1].event_type, ORDER_FAILED_EVENT)

    def test_preserves_order_canceled_event_type(self):
        body = make_fastspring_webhook_payload(
            make_fastspring_order_event(order_id=uuid.uuid4(), total="15.99", event_type=ORDER_CANCELED_EVENT)
        )
        events = parse_fastspring_webhook_payload(body)
        self.assertEqual(events[0].event_type, ORDER_CANCELED_EVENT)

    def test_extracts_the_live_flag(self):
        body = make_fastspring_webhook_payload(
            make_fastspring_order_event(order_id=uuid.uuid4(), total="15.99", live=True)
        )
        events = parse_fastspring_webhook_payload(body)
        self.assertTrue(events[0].live)

    def test_missing_order_tag_yields_no_order_id_rather_than_guessing(self):
        payload = {
            "events": [
                {
                    "id": "evt_no_tag", "live": False, "processed": True, "type": ORDER_COMPLETED_EVENT,
                    "created": 1, "data": {"id": "fs_1", "currency": "USD", "total": "15.99", "tags": {}},
                }
            ]
        }
        events = parse_fastspring_webhook_payload(json.dumps(payload).encode())
        self.assertIsNone(events[0].order_id)

    def test_malformed_json_raises_value_error(self):
        with self.assertRaises(ValueError):
            parse_fastspring_webhook_payload(b"not json at all")

    def test_missing_events_array_raises_value_error(self):
        with self.assertRaises(ValueError):
            parse_fastspring_webhook_payload(json.dumps({"not_events": []}).encode())


@override_settings(FASTSPRING_WEBHOOK_SECRET=FASTSPRING_TEST_WEBHOOK_SECRET, PAYMENT_PROVIDER="fastspring")
class FastSpringWebhookEventHandlingTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _post_webhook(self, body: bytes):
        header = make_fastspring_signature_header(FASTSPRING_TEST_WEBHOOK_SECRET, body)
        return self.client.generic(
            "POST", "/api/v1/webhooks/fastspring/", data=body, content_type="application/json",
            HTTP_X_FS_SIGNATURE=header,
        )

    def _make_pending_order(self, total_cents=1599, currency="USD", product_slug=None):
        # Unique per call, not a fixed "heart-map" — a batch delivery test
        # below calls this twice in one test, and Product.slug is unique.
        product = make_product(slug=product_slug or f"heart-map-{uuid.uuid4().hex[:8]}")
        pack = make_delivery_pack(
            product=product, price_cents=total_cents, currency=currency, included_targets=["print-png", "__live__"]
        )
        customer = make_customer()
        return make_order(
            customer=customer, product=product, delivery_pack=pack,
            subtotal_cents=total_cents, total_cents=total_cents, currency=currency,
        )

    def test_successful_order_completed_event_marks_order_paid(self):
        order = self._make_pending_order()
        body = make_fastspring_webhook_payload(
            make_fastspring_order_event(fastspring_reference="fs_success", order_id=order.id, total="15.99")
        )

        response = self._post_webhook(body)

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_PAID)

    def test_successful_order_completed_event_creates_entitlements(self):
        order = self._make_pending_order()
        body = make_fastspring_webhook_payload(
            make_fastspring_order_event(fastspring_reference="fs_ent", order_id=order.id, total="15.99")
        )

        self._post_webhook(body)

        target_ids = set(Entitlement.objects.filter(order=order).values_list("target_id", flat=True))
        self.assertEqual(target_ids, {"print-png", "__live__"})

    def test_payment_row_uses_the_fastspring_provider_and_reference(self):
        order = self._make_pending_order()
        body = make_fastspring_webhook_payload(
            make_fastspring_order_event(fastspring_reference="fs_payment_row", order_id=order.id, total="15.99")
        )

        self._post_webhook(body)

        payment = Payment.objects.get(order=order)
        self.assertEqual(payment.provider, "fastspring")
        self.assertEqual(payment.provider_reference, "fs_payment_row")
        self.assertEqual(payment.status, Payment.STATUS_SUCCESS)

    def test_unrelated_event_type_does_not_grant_entitlements(self):
        order = self._make_pending_order()
        body = make_fastspring_webhook_payload(
            make_fastspring_order_event(order_id=order.id, total="15.99", event_type=ORDER_FAILED_EVENT)
        )

        response = self._post_webhook(body)

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_PENDING)
        self.assertEqual(Entitlement.objects.filter(order=order).count(), 0)

    def test_a_batch_processes_every_order_completed_event_it_contains(self):
        order_a = self._make_pending_order(total_cents=1599)
        order_b = self._make_pending_order(total_cents=2299)
        body = make_fastspring_webhook_payload(
            make_fastspring_order_event(event_id="evt_a", fastspring_reference="fs_a", order_id=order_a.id, total="15.99"),
            make_fastspring_order_event(event_id="evt_b", fastspring_reference="fs_b", order_id=order_b.id, total="22.99"),
        )

        response = self._post_webhook(body)

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        order_a.refresh_from_db()
        order_b.refresh_from_db()
        self.assertEqual(order_a.status, Order.STATUS_PAID)
        self.assertEqual(order_b.status, Order.STATUS_PAID)


@override_settings(PAYMENT_PROVIDER="fastspring", FASTSPRING_ENVIRONMENT="sandbox")
class FastSpringLiveFlagReconciliationTests(TestCase):
    def test_a_live_true_event_is_rejected_while_running_in_sandbox(self):
        product = make_product(slug="love-story-timeline")
        pack = make_delivery_pack(product=product, price_cents=1599)
        customer = make_customer()
        order = make_order(
            customer=customer, product=product, delivery_pack=pack, subtotal_cents=1599, total_cents=1599
        )

        event = FastSpringWebhookEvent(
            event_id="evt_live_mismatch", event_type=ORDER_COMPLETED_EVENT, live=True,
            order_id=str(order.id), fastspring_reference="fs_live_mismatch",
            currency_code="USD", total="15.99",
        )

        with self.assertRaises(PaymentVerificationFailed):
            confirm_fastspring_webhook_payment(event)

        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_PENDING)
        self.assertEqual(Payment.objects.filter(order=order).count(), 0)

    @override_settings(FASTSPRING_ENVIRONMENT="production")
    def test_a_live_false_event_is_rejected_while_configured_for_production(self):
        product = make_product(slug="love-story-timeline")
        pack = make_delivery_pack(product=product, price_cents=1599)
        customer = make_customer()
        order = make_order(
            customer=customer, product=product, delivery_pack=pack, subtotal_cents=1599, total_cents=1599
        )

        event = FastSpringWebhookEvent(
            event_id="evt_test_in_prod", event_type=ORDER_COMPLETED_EVENT, live=False,
            order_id=str(order.id), fastspring_reference="fs_test_in_prod",
            currency_code="USD", total="15.99",
        )

        with self.assertRaises(PaymentVerificationFailed):
            confirm_fastspring_webhook_payment(event)

        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_PENDING)


@override_settings(FASTSPRING_WEBHOOK_SECRET=FASTSPRING_TEST_WEBHOOK_SECRET, PAYMENT_PROVIDER="fastspring")
class FastSpringAmountReconciliationTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_amount_mismatch_does_not_mark_order_paid_or_grant_entitlements(self):
        product = make_product(slug="love-story-timeline")
        pack = make_delivery_pack(product=product, price_cents=1599, included_targets=["print-png"])
        customer = make_customer()
        order = make_order(customer=customer, product=product, delivery_pack=pack, subtotal_cents=1599, total_cents=1599)

        # Webhook claims only $0.01 was paid — must not be trusted.
        body = make_fastspring_webhook_payload(
            make_fastspring_order_event(fastspring_reference="fs_mismatch", order_id=order.id, total="0.01")
        )
        header = make_fastspring_signature_header(FASTSPRING_TEST_WEBHOOK_SECRET, body)

        response = self.client.generic(
            "POST", "/api/v1/webhooks/fastspring/", data=body, content_type="application/json",
            HTTP_X_FS_SIGNATURE=header,
        )

        self.assertEqual(response.status_code, http_status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["error"]["code"], "payment_amount_mismatch")

        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_PENDING)
        self.assertEqual(Payment.objects.filter(order=order).count(), 0)
        self.assertEqual(Entitlement.objects.filter(order=order).count(), 0)

    def test_currency_mismatch_does_not_mark_order_paid(self):
        product = make_product(slug="song-poster")
        pack = make_delivery_pack(product=product, price_cents=1599, currency="USD")
        customer = make_customer()
        order = make_order(customer=customer, product=product, delivery_pack=pack, subtotal_cents=1599, total_cents=1599, currency="USD")

        body = make_fastspring_webhook_payload(
            make_fastspring_order_event(fastspring_reference="fs_currency", order_id=order.id, total="15.99", currency="EUR")
        )
        header = make_fastspring_signature_header(FASTSPRING_TEST_WEBHOOK_SECRET, body)

        response = self.client.generic(
            "POST", "/api/v1/webhooks/fastspring/", data=body, content_type="application/json",
            HTTP_X_FS_SIGNATURE=header,
        )

        self.assertEqual(response.status_code, http_status.HTTP_400_BAD_REQUEST)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_PENDING)

    def test_malformed_total_does_not_mark_order_paid(self):
        product = make_product(slug="love-story-timeline")
        pack = make_delivery_pack(product=product, price_cents=1599)
        customer = make_customer()
        order = make_order(customer=customer, product=product, delivery_pack=pack, subtotal_cents=1599, total_cents=1599)

        body = make_fastspring_webhook_payload(
            make_fastspring_order_event(fastspring_reference="fs_malformed", order_id=order.id, total="not-a-number")
        )
        header = make_fastspring_signature_header(FASTSPRING_TEST_WEBHOOK_SECRET, body)

        response = self.client.generic(
            "POST", "/api/v1/webhooks/fastspring/", data=body, content_type="application/json",
            HTTP_X_FS_SIGNATURE=header,
        )

        self.assertEqual(response.status_code, http_status.HTTP_400_BAD_REQUEST)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_PENDING)


@override_settings(FASTSPRING_WEBHOOK_SECRET=FASTSPRING_TEST_WEBHOOK_SECRET, PAYMENT_PROVIDER="fastspring")
class FastSpringWebhookIdempotencyTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_duplicate_webhook_delivery_is_safe(self):
        product = make_product(slug="star-map")
        pack = make_delivery_pack(product=product, price_cents=1599, included_targets=["print-png", "story-png"])
        customer = make_customer()
        order = make_order(customer=customer, product=product, delivery_pack=pack, subtotal_cents=1599, total_cents=1599)

        body = make_fastspring_webhook_payload(
            make_fastspring_order_event(fastspring_reference="fs_dup", order_id=order.id, total="15.99")
        )
        header = make_fastspring_signature_header(FASTSPRING_TEST_WEBHOOK_SECRET, body)

        first = self.client.generic(
            "POST", "/api/v1/webhooks/fastspring/", data=body, content_type="application/json",
            HTTP_X_FS_SIGNATURE=header,
        )
        second = self.client.generic(
            "POST", "/api/v1/webhooks/fastspring/", data=body, content_type="application/json",
            HTTP_X_FS_SIGNATURE=header,
        )

        self.assertEqual(first.status_code, http_status.HTTP_200_OK)
        self.assertEqual(second.status_code, http_status.HTTP_200_OK)

        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_PAID)
        self.assertEqual(Payment.objects.filter(order=order, status=Payment.STATUS_SUCCESS).count(), 1)
        self.assertEqual(Entitlement.objects.filter(order=order).count(), 2)


@override_settings(FASTSPRING_WEBHOOK_SECRET=FASTSPRING_TEST_WEBHOOK_SECRET, PAYMENT_PROVIDER="fastspring")
class FastSpringWebhookTransactionSafetyTests(TestCase):
    def test_entitlement_failure_rolls_back_payment_and_order_status(self):
        product = make_product(slug="heart-map")
        pack = make_delivery_pack(product=product, price_cents=1599, included_targets=["print-png"])
        customer = make_customer()
        order = make_order(customer=customer, product=product, delivery_pack=pack, subtotal_cents=1599, total_cents=1599)

        event = FastSpringWebhookEvent(
            event_id="evt_rollback", event_type=ORDER_COMPLETED_EVENT, live=False,
            order_id=str(order.id), fastspring_reference="fs_rollback",
            currency_code="USD", total="15.99",
        )

        with patch("apps.commerce.services.grant_entitlements", side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError):
                confirm_fastspring_webhook_payment(event)

        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_PENDING)
        self.assertEqual(Payment.objects.filter(order=order).count(), 0)
        self.assertEqual(Entitlement.objects.filter(order=order).count(), 0)


@override_settings(PAYMENT_PROVIDER="fastspring", FASTSPRING_API_USERNAME="test_user", FASTSPRING_API_PASSWORD="test_pass")
class FastSpringCheckoutStartTests(TestCase):
    """`POST /api/v1/orders/<id>/pay/` when FastSpring is the active
    provider — asynchronous path: creates a session, does not mark the
    order paid. Mirrors PaddleCheckoutStartTests.
    """

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)

    def _create_order(self):
        product = Product.objects.create(
            slug="love-story-timeline", name_i18n_key="x", category=Product.CATEGORY_TIMELINE, status="available"
        )
        pack = make_delivery_pack(product=product, slug="live", price_cents=1599)
        login_as_guest(self.client, email="fastspring-checkout@example.com")
        response = self.client.post(
            "/api/v1/orders/", {"productId": product.slug, "deliveryPackId": pack.slug},
            format="json", **csrf_headers(self.client),
        )
        return response.data["id"]

    def _fake_session_response(self, session_id="OS_checkout_1"):
        fake_response = MagicMock()
        fake_response.json.return_value = {
            "id": session_id,
            "checkoutUrls": {"webcheckoutUrl": f"https://heartfolio.test.onfastspring.com/session/{session_id}"},
        }
        return fake_response

    def test_pay_creates_fastspring_session_and_leaves_order_pending(self):
        order_id = self._create_order()

        with patch("apps.commerce.fastspring_integration.requests.post", return_value=self._fake_session_response()):
            response = self.client.post(f"/api/v1/orders/{order_id}/pay/", **csrf_headers(self.client))

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response.data["order"]["status"], "pending")  # NOT paid — webhook confirms later
        self.assertEqual(response.data["checkout"]["provider"], "fastspring")
        self.assertEqual(response.data["checkout"]["sessionId"], "OS_checkout_1")
        self.assertEqual(
            response.data["checkout"]["checkoutUrl"],
            "https://heartfolio.test.onfastspring.com/session/OS_checkout_1",
        )

        payment = Payment.objects.get(order_id=order_id)
        self.assertEqual(payment.provider, "fastspring")
        self.assertEqual(payment.status, Payment.STATUS_PENDING)
        self.assertEqual(payment.provider_reference, "OS_checkout_1")

    @override_settings(FASTSPRING_ACCESS_KEY="test_access_key")
    def test_checkout_response_carries_the_public_access_key(self):
        order_id = self._create_order()

        with patch("apps.commerce.fastspring_integration.requests.post", return_value=self._fake_session_response()):
            response = self.client.post(f"/api/v1/orders/{order_id}/pay/", **csrf_headers(self.client))

        self.assertEqual(response.data["checkout"]["accessKey"], "test_access_key")

    def test_repeated_checkout_open_reuses_existing_pending_session(self):
        order_id = self._create_order()

        with patch(
            "apps.commerce.fastspring_integration.requests.post",
            return_value=self._fake_session_response("OS_checkout_2"),
        ) as mock_post:
            first = self.client.post(f"/api/v1/orders/{order_id}/pay/", **csrf_headers(self.client))
            second = self.client.post(f"/api/v1/orders/{order_id}/pay/", **csrf_headers(self.client))

        self.assertEqual(first.data["checkout"]["sessionId"], second.data["checkout"]["sessionId"])
        self.assertEqual(mock_post.call_count, 1)  # not called twice
        self.assertEqual(Payment.objects.filter(order_id=order_id).count(), 1)
        # The reused-session response carries no checkout URL — only the
        # session id is persisted between requests. See
        # services._checkout_result_from_payment's own docstring.
        self.assertIsNone(second.data["checkout"]["checkoutUrl"])

    def test_no_fastspring_secrets_in_checkout_response(self):
        order_id = self._create_order()

        with patch("apps.commerce.fastspring_integration.requests.post", return_value=self._fake_session_response()):
            response = self.client.post(f"/api/v1/orders/{order_id}/pay/", **csrf_headers(self.client))

        response_text = json.dumps(response.data)
        self.assertNotIn("test_user", response_text)
        self.assertNotIn("test_pass", response_text)
        self.assertNotIn("FASTSPRING_API_PASSWORD", response_text)
        self.assertNotIn("FASTSPRING_WEBHOOK_SECRET", response_text)

    def test_paying_already_paid_order_does_not_create_new_session(self):
        order_id = self._create_order()
        product_order = Order.objects.get(id=order_id)
        Payment.objects.create(
            order=product_order, provider="fastspring", provider_reference="OS_already_paid",
            amount_cents=1599, currency="USD", status=Payment.STATUS_SUCCESS,
        )
        product_order.status = Order.STATUS_PAID
        product_order.save(update_fields=["status"])

        with patch("apps.commerce.fastspring_integration.requests.post") as mock_post:
            response = self.client.post(f"/api/v1/orders/{order_id}/pay/", **csrf_headers(self.client))

        self.assertEqual(response.data["order"]["status"], "paid")
        self.assertEqual(response.data["payment"]["providerReference"], "OS_already_paid")
        mock_post.assert_not_called()


class OrderAccessTokenTests(SimpleTestCase):
    """§12 — the magic link's credential.

    This token is the only thing standing between a URL and someone's paid
    order, so the tests here are about what it must REFUSE rather than what
    it permits.
    """

    def test_a_freshly_minted_token_verifies_for_its_own_order(self):
        order_id = uuid.uuid4()
        token = generate_order_access_token(order_id)
        self.assertTrue(verify_order_access_token(token, order_id=order_id))

    def test_a_token_for_one_order_does_not_open_another(self):
        # The property that stops a forwarded receipt becoming a skeleton
        # key. A token authenticates an order, never a customer.
        token = generate_order_access_token(uuid.uuid4())
        self.assertFalse(verify_order_access_token(token, order_id=uuid.uuid4()))

    def test_a_tampered_token_is_rejected(self):
        order_id = uuid.uuid4()
        token = generate_order_access_token(order_id)
        # Swap the payload for a different order id, keeping the signature.
        _, _, signature = token.split(":", 2)
        forged = f"{uuid.uuid4()}:{signature}"
        self.assertFalse(verify_order_access_token(forged, order_id=order_id))

    def test_a_token_signed_with_a_different_salt_is_rejected(self):
        # Namespacing matters: a signed value minted elsewhere in this
        # project, with the same SECRET_KEY, must not be replayable here.
        order_id = uuid.uuid4()
        other = TimestampSigner(salt="something.else").sign(str(order_id))
        self.assertFalse(verify_order_access_token(other, order_id=order_id))

    def test_an_expired_token_is_rejected(self):
        order_id = uuid.uuid4()
        token = generate_order_access_token(order_id)
        beyond_expiry = (settings.ORDER_ACCESS_TOKEN_MAX_AGE_DAYS + 1) * 86400

        with patch("django.core.signing.time.time", return_value=time.time() + beyond_expiry):
            self.assertFalse(verify_order_access_token(token, order_id=order_id))

    def test_empty_and_garbage_tokens_are_rejected(self):
        order_id = uuid.uuid4()
        for value in ("", "   ", "not-a-token", "a:b:c"):
            self.assertFalse(verify_order_access_token(value, order_id=order_id))

    def test_uuid_and_string_order_ids_compare_equal(self):
        # `order_id` arrives as a UUID from the model and as a str from the
        # URL. `UUID("...") != "..."` is silently False in Python, which
        # would have made every real magic link fail.
        order_id = uuid.uuid4()
        token = generate_order_access_token(order_id)
        self.assertTrue(verify_order_access_token(token, order_id=str(order_id)))


class OrderEmailTests(SimpleTestCase):
    """§12 — the receipt itself."""

    def _order(self):
        order = MagicMock()
        order.id = uuid.uuid4()
        order.guest_email = "buyer@example.com"
        order.total_cents = 1800
        order.currency = "USD"
        order.locale = "ar"
        order.product.slug = "love-story-timeline"
        return order

    @override_settings(RESEND_API_KEY="", FRONTEND_URL="https://example.test")
    def test_sending_is_skipped_when_no_api_key_is_configured(self):
        # Local and CI runs must not attempt a real send, and must not fail.
        self.assertFalse(send_order_confirmation(self._order()))

    @override_settings(RESEND_API_KEY="key", FRONTEND_URL="https://example.test")
    def test_a_provider_outage_never_raises(self):
        # The load-bearing property: a customer who has paid must end up with
        # a paid order whether or not Resend is reachable. An exception here
        # would propagate into the webhook path.
        with patch("apps.commerce.emails.requests.post", side_effect=Exception("network down")):
            self.assertFalse(send_order_confirmation(self._order()))

    @override_settings(RESEND_API_KEY="key", FRONTEND_URL="https://example.test")
    def test_a_rejected_send_is_reported_not_raised(self):
        response = MagicMock(status_code=422, text="domain not verified")
        with patch("apps.commerce.emails.requests.post", return_value=response):
            self.assertFalse(send_order_confirmation(self._order()))

    @override_settings(RESEND_API_KEY="key", FRONTEND_URL="https://example.test")
    def test_the_email_carries_a_working_magic_link(self):
        order = self._order()
        response = MagicMock(status_code=200, text="{}")

        with patch("apps.commerce.emails.requests.post", return_value=response) as post:
            self.assertTrue(send_order_confirmation(order))

        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["to"], ["buyer@example.com"])

        # The link must contain a token that actually opens this order —
        # not merely look like one.
        link = build_order_link(order)
        # §12 MOVED THE TOKEN OUT OF THE QUERY STRING. The link is
        # `<frontend>/<locale>/orders/<order id>/<token>` — splitting on
        # "token=" found nothing and raised IndexError. The token is the
        # last path segment, and the order id is the one before it.
        token = link.rstrip("/").rsplit("/", 1)[1]
        self.assertTrue(verify_order_access_token(token, order_id=order.id))
        self.assertIn(str(order.id), link)

    @override_settings(RESEND_API_KEY="key", FRONTEND_URL="https://example.test")
    def test_the_first_version_is_english_regardless_of_order_locale(self):
        # `Order.locale` exists and is recorded, but the decision was to keep
        # v1 English-only. Asserted so that changing the template language
        # later is a deliberate act rather than an accident.
        order = self._order()  # locale is "ar"
        response = MagicMock(status_code=200, text="{}")

        with patch("apps.commerce.emails.requests.post", return_value=response) as post:
            send_order_confirmation(order)

        payload = post.call_args.kwargs["json"]
        self.assertIn('lang="en"', payload["html"])
        self.assertIn("Thank you", payload["text"])

    @override_settings(RESEND_API_KEY="key", FRONTEND_URL="https://example.test")
    def test_a_plain_text_alternative_is_always_included(self):
        # Some clients prefer text/plain; a receipt that arrives blank is
        # worse than a plain one.
        order = self._order()
        response = MagicMock(status_code=200, text="{}")

        with patch("apps.commerce.emails.requests.post", return_value=response) as post:
            send_order_confirmation(order)

        payload = post.call_args.kwargs["json"]
        self.assertTrue(payload["text"].strip())
        self.assertIn("https://example.test", payload["text"])


    # ---- §18d — the GIFT QR card in the receipt ------------------------------
    #
    # The email used to embed the BUYER's card (the order page behind a
    # 30-day signed token) while telling the buyer to "give it with the gift".
    # These pin that it is now the RECIPIENT's card, in both the inline image
    # and the attachment, with copy that matches. No test covered this branch
    # before: `_order()` above has no live page, so no QR was ever rendered.

    GIFT_FILENAME = "heartfolio-gift-qr.png"

    def _send_receipt(self, *, live_page=True, card=b"GIFTPNG", card_error=None):
        """Sends the receipt for a mock order, with the pack's live-page status
        and the card renderer controlled. The BUYER's renderer is wired to blow
        up, so any code path that still reaches for it fails loudly.

        Returns a dict: ok, payload, card_mock, buyer_mock, order.
        """
        from apps.delivery import bonuses

        order = self._order()
        response = MagicMock(status_code=200, text="{}")
        targets = [bonuses.BONUS_QR] if live_page else []
        with (
            patch("apps.delivery.bonuses.bonus_targets_for_order", return_value=targets),
            patch("apps.delivery.bonuses.render_recipient_qr_card", return_value=card, side_effect=card_error) as card_mock,
            patch(
                "apps.delivery.bonuses.render_live_qr_card",
                side_effect=AssertionError("the receipt must not use the buyer's QR card"),
            ) as buyer_mock,
            patch("apps.commerce.emails.requests.post", return_value=response) as post,
        ):
            ok = send_order_confirmation(order)
        return {
            "ok": ok,
            "payload": post.call_args.kwargs["json"],
            "card_mock": card_mock,
            "buyer_mock": buyer_mock,
            "order": order,
        }

    @staticmethod
    def _qr_paragraphs(payload):
        """The QR copy in each body: the HTML <p> right after the <img>, and the
        text paragraph that introduces the card."""
        import re

        html_match = re.search(r"<img[^>]*/>\s*</p>\s*<p[^>]*>(.*?)</p>", payload["html"], re.DOTALL)
        # Ends at the sentence, not the paragraph: the text body puts the order
        # reference on the very next line with no blank line between them.
        text_match = re.search(r"A QR card.*?as it is\.", payload["text"], re.DOTALL)
        return (
            " ".join(html_match.group(1).split()) if html_match else None,
            " ".join(text_match.group(0).split()) if text_match else None,
        )

    @override_settings(RESEND_API_KEY="key", FRONTEND_URL="https://example.test")
    def test_the_inline_qr_is_the_recipients_card_not_the_buyers(self):
        import re

        sent = self._send_receipt()
        order, html = sent["order"], sent["payload"]["html"]

        src = re.search(r'<img src="([^"]+)"', html).group(1)
        prefix = f"https://example.test/api/backend/orders/{order.id}/qr/recipient/"
        self.assertTrue(src.startswith(prefix), src)

        # The path carries a token that really opens this order's recipient
        # card route — and it is the recipient route, never the buyer's
        # `/qr/<token>/` (which would encode the order page).
        token = src[len(prefix):].rstrip("/")
        self.assertTrue(verify_order_access_token(token, order_id=order.id))
        self.assertNotRegex(html, rf"/orders/{order.id}/qr/(?!recipient/)")

    @override_settings(RESEND_API_KEY="key", FRONTEND_URL="https://example.test")
    def test_the_attachment_is_the_recipients_card_under_the_gift_filename(self):
        import base64

        sent = self._send_receipt(card=b"GIFTPNG")

        self.assertEqual(
            sent["payload"]["attachments"],
            [{"filename": self.GIFT_FILENAME, "content": base64.b64encode(b"GIFTPNG").decode("ascii")}],
        )
        sent["card_mock"].assert_called_once()
        sent["buyer_mock"].assert_not_called()
        self.assertTrue(sent["ok"])

    @override_settings(RESEND_API_KEY="key", FRONTEND_URL="https://example.test")
    def test_the_qr_copy_describes_opening_the_keepsake_and_never_mentions_an_order(self):
        payload = self._send_receipt()["payload"]
        html_copy, text_copy = self._qr_paragraphs(payload)

        self.assertEqual(
            html_copy,
            "This QR card is for the gift — scanning it opens the keepsake directly on a phone. "
            "Print it, show it on a screen, or simply forward it as it is. It is attached to this email too.",
        )
        self.assertEqual(
            text_copy,
            "A QR card for the gift is attached — scanning it opens the keepsake directly on a phone. "
            "Print it, show it on a screen, or simply forward it as it is.",
        )
        # Nothing about the buyer's order in the QR copy, and none of the old wording.
        for copy in (html_copy, text_copy):
            self.assertNotIn("order", copy.lower())
            self.assertNotIn("your keepsake", copy)
            self.assertNotIn("give it with the gift", copy)
        self.assertIn('alt="Scan to open the keepsake"', payload["html"])
        self.assertNotIn("Scan to open your keepsake", payload["html"])

    @override_settings(RESEND_API_KEY="key", FRONTEND_URL="https://example.test")
    def test_the_qr_copy_does_not_present_printing_as_the_only_use(self):
        # People forward the email or show the phone screen as often as they print.
        for copy in self._qr_paragraphs(self._send_receipt()["payload"]):
            lowered = copy.lower()
            self.assertIn("print it", lowered)
            self.assertIn("show it on a screen", lowered)
            self.assertIn("forward it", lowered)

    @override_settings(RESEND_API_KEY="key", FRONTEND_URL="https://example.test")
    def test_the_open_your_order_link_is_unchanged_alongside_the_gift_qr(self):
        sent = self._send_receipt()
        order, payload = sent["order"], sent["payload"]
        order_link_prefix = f"https://example.test/ar/orders/{order.id}/"

        self.assertIn("Open your order", payload["html"])
        self.assertIn(f'href="{order_link_prefix}', payload["html"])
        self.assertIn(f"Open your order: {order_link_prefix}", payload["text"])

    @override_settings(RESEND_API_KEY="key", FRONTEND_URL="https://example.test")
    def test_an_order_with_no_live_page_gets_no_qr_at_all(self):
        sent = self._send_receipt(live_page=False)
        payload = sent["payload"]

        self.assertTrue(sent["ok"])
        self.assertNotIn("attachments", payload)
        self.assertNotIn("<img", payload["html"])
        self.assertNotIn("QR", payload["html"])
        self.assertNotIn("QR", payload["text"])
        # Not rendered, not even attempted — and the order link is still there.
        sent["card_mock"].assert_not_called()
        sent["buyer_mock"].assert_not_called()
        self.assertIn("Open your order", payload["html"])

    @override_settings(RESEND_API_KEY="key", FRONTEND_URL="https://example.test")
    def test_a_card_that_cannot_render_removes_the_qr_section_instead_of_promising_it(self):
        # `RendererNotAvailable` is what the recipient's card raises when the
        # live experience is not active; the other is any unexpected failure.
        # Either way the receipt must still go out, and must not show a broken
        # image box or claim an attachment that is not there.
        from apps.common.exceptions.api_errors import RendererNotAvailable

        for error in (RendererNotAvailable("not active"), RuntimeError("boom")):
            with self.subTest(error=type(error).__name__):
                sent = self._send_receipt(card_error=error)
                payload = sent["payload"]

                self.assertTrue(sent["ok"])
                self.assertNotIn("attachments", payload)
                self.assertNotIn("<img", payload["html"])
                self.assertNotIn("attached", payload["html"])
                self.assertNotIn("attached", payload["text"])
                self.assertNotIn("QR", payload["html"])
                self.assertNotIn("QR", payload["text"])
                self.assertIn("Open your order", payload["html"])


class PaddleCountryCaptureTests(SimpleTestCase):
    """§7a — the buyer country comes from Paddle's own record.

    Heartfolio has never asked a customer for a country; Paddle captures it
    for tax compliance. These are database-free because they test the
    parser, which is where the value enters the system.
    """

    def _payload(self, **data):
        return json.dumps({"event_type": "transaction.completed", "data": data}).encode()

    def test_the_country_is_read_from_the_address(self):
        event = parse_webhook_payload(self._payload(id="txn_1", address={"country_code": "FR"}))
        self.assertEqual(event.country_code, "FR")

    def test_a_webhook_with_no_address_parses_without_a_country(self):
        # Paddle does not promise an address on every event. This must not
        # raise — it would reject a valid payment webhook over a report field.
        event = parse_webhook_payload(self._payload(id="txn_1"))
        self.assertIsNone(event.country_code)

    def test_an_empty_country_code_is_treated_as_absent(self):
        # "" would otherwise become a distinct country bucket alongside the
        # real ones and alongside Unknown.
        event = parse_webhook_payload(self._payload(id="txn_1", address={"country_code": ""}))
        self.assertIsNone(event.country_code)

    def test_a_null_address_does_not_crash_the_parser(self):
        event = parse_webhook_payload(self._payload(id="txn_1", address=None))
        self.assertIsNone(event.country_code)


class SalesAnalyticsTests(TestCase):
    """§7a aggregations.

    DATABASE-BACKED, and therefore NOT RUN in the environment these were
    written in — there is no Postgres available there. They are written to
    run on a machine that has one, and are listed in the status document as
    outstanding verification rather than claimed as passing.
    """

    def setUp(self):
        # THIS setUp DID NOT EXIST. `_order` has always referenced
        # `self.product` and `self.pack`, so every test in this class died
        # with AttributeError the first time the suite was actually run —
        # which, per the docstring above, is exactly what had never
        # happened. The revenue figures on the ops reports screen are
        # produced by the code these tests cover, so none of that maths was
        # being checked by anything.
        self.product = make_product()
        self.pack = make_delivery_pack(self.product)

    def _order(self, *, status, total_cents, email="a@example.com", country="", product=None, pack=None):
        customer, _ = Customer.objects.get_or_create(email=email)
        return Order.objects.create(
            customer=customer,
            guest_email=email,
            product=product or self.product,
            delivery_pack=pack or self.pack,
            status=status,
            subtotal_cents=total_cents,
            discount_cents=0,
            total_cents=total_cents,
            currency="USD",
            buyer_country=country,
        )

    def test_only_paid_orders_count_as_revenue(self):
        # A pending order is an intention, not money.
        self._order(status=Order.STATUS_PAID, total_cents=1800)
        self._order(status=Order.STATUS_PENDING, total_cents=9900)
        self.assertEqual(sum(p.revenue_cents for p in revenue_trend("monthly")), 1800)

    def test_average_order_value_ignores_unpaid_orders(self):
        self._order(status=Order.STATUS_PAID, total_cents=1000)
        self._order(status=Order.STATUS_PAID, total_cents=2000)
        self._order(status=Order.STATUS_FAILED, total_cents=100000)
        self.assertEqual(average_order_value_cents(), 1500)

    def test_returning_customers_are_counted_once_not_per_order(self):
        # Someone who bought four times is one returning customer; counting
        # orders would make repeat business look like new business.
        for _ in range(4):
            self._order(status=Order.STATUS_PAID, total_cents=1000, email="repeat@example.com")
        self._order(status=Order.STATUS_PAID, total_cents=1000, email="once@example.com")
        self.assertEqual(new_vs_returning(), {"new": 1, "returning": 1})

    def test_orders_without_a_country_appear_as_unknown(self):
        # Dropping them would make the breakdown disagree with the total
        # printed above it.
        self._order(status=Order.STATUS_PAID, total_cents=1000, country="FR")
        self._order(status=Order.STATUS_PAID, total_cents=1000, country="")
        labels = {row.label for row in breakdown_by_country()}
        self.assertIn("FR", labels)
        self.assertIn("Unknown", labels)

    def test_failure_rate_counts_orders_not_payment_attempts(self):
        # An order that failed twice then succeeded is a success.
        self._order(status=Order.STATUS_PAID, total_cents=1000)
        self._order(status=Order.STATUS_PENDING, total_cents=1000)
        stats = payment_failure_rate()
        self.assertEqual(stats["total_orders"], 2)
        self.assertEqual(stats["paid_orders"], 1)
        self.assertEqual(stats["failure_rate"], 50.0)

    def test_pack_rows_are_scoped_to_their_product(self):
        # Every product has a "printable" pack; a bare pack slug would merge
        # two products' sales into one row.
        for row in breakdown_by_pack():
            self.assertIn("/", row.label)


class MediaPromotionTests(SimpleTestCase):
    """§7 — deciding whether a paid order needs its video/audio promoted
    from provisional to permanent storage.

    Mocked rather than DB-backed, so these actually run in an environment
    with no Postgres (this sandbox) rather than joining the pile of
    DB-backed commerce tests that have never executed. `promote_media_
    assets_for_order`'s own `Asset.objects` call is patched out entirely —
    what is under test here is the DECISION logic, not the database write.
    """

    def _order(self, *, targets, project_data=None, customer_id="cust-1"):
        order = MagicMock()
        order.id = uuid.uuid4()
        order.customer = customer_id
        order.delivery_pack.included_targets = targets
        order.project.data = project_data or {}
        return order

    def test_printable_only_never_needs_media(self):
        from apps.commerce.media_promotion import _order_needs_media

        self.assertFalse(_order_needs_media(self._order(targets=["print-a4-edged", "print-a4-frameless"])))

    def test_wallpaper_alone_never_needs_media(self):
        # Wallpapers are static images, same as prints — neither reads
        # video, audio or backgroundMusic.
        from apps.commerce.media_promotion import _order_needs_media

        self.assertFalse(_order_needs_media(self._order(targets=["wallpaper-phone", "wallpaper-desktop"])))

    def test_live_needs_media(self):
        from apps.commerce.media_promotion import _order_needs_media

        self.assertTrue(_order_needs_media(self._order(targets=["__live__"])))

    def test_any_ar_target_needs_media(self):
        # Prefix match, not exact — must not require listing every current
        # and future AR target id by name.
        from apps.commerce.media_promotion import _order_needs_media

        self.assertTrue(_order_needs_media(self._order(targets=["ar-card"])))

    def test_a_combo_pack_is_read_by_its_targets_not_its_slug(self):
        """The wallpaper-combo packs are exactly this shape: two targets
        folded under a slug ("digital-plus-wallpaper") that matches
        neither source. Anything keyed on slug text would need updating
        every time a new combo pack is added; reading targets does not."""
        from apps.commerce.media_promotion import _order_needs_media

        self.assertTrue(_order_needs_media(self._order(targets=["__live__", "wallpaper-phone"])))

    def test_collects_video_and_audio_asset_ids(self):
        from apps.commerce.media_promotion import _media_asset_ids

        project = MagicMock()
        project.data = {
            "values": {
                "events": [
                    {"video": {"assetId": "vid-1"}, "audio": {"assetId": "aud-1"}, "photo": {"assetId": "photo-1"}},
                    {"video": {"assetId": "vid-2"}},
                ],
            }
        }
        ids = _media_asset_ids(project)
        self.assertCountEqual(ids, ["vid-1", "aud-1", "vid-2"])

    def test_never_collects_background_music(self):
        """§4 made background music a shipped preset id, not a customer
        upload — there is nothing in R2 for a paid order to promote, so
        this must never even look at the field, let alone collect it as
        an asset id."""
        from apps.commerce.media_promotion import _media_asset_ids

        project = MagicMock()
        project.data = {"values": {"backgroundMusic": "tender-piano", "events": []}}
        self.assertEqual(_media_asset_ids(project), [])

    def test_never_collects_a_photo_asset_id(self):
        # The whole point: photos are already permanent and must never be
        # touched by this path.
        from apps.commerce.media_promotion import _media_asset_ids

        project = MagicMock()
        project.data = {"values": {"events": [{"photo": {"assetId": "photo-1"}}]}}
        self.assertEqual(_media_asset_ids(project), [])

    def test_media_is_collected_per_product_through_the_registry(self):
        """A product whose media lives somewhere other than Love Story
        Timeline's `events[]` registers its own collector. Without one, its
        paid voice notes would be left provisional and deleted a week after
        purchase."""
        from apps.commerce import media_promotion

        project = MagicMock()
        project.data = {"values": {"voices": [{"assetId": "voice-1"}], "events": [{"audio": {"assetId": "aud-1"}}]}}
        collector = lambda values: [v["assetId"] for v in values["voices"]]  # noqa: E731
        with patch.dict(media_promotion._MEDIA_COLLECTORS, {"some-product": collector}):
            self.assertEqual(media_promotion._media_asset_ids(project, "some-product"), ["voice-1"])
            # Every other product is untouched by that entry.
            self.assertEqual(media_promotion._media_asset_ids(project, "love-story-timeline"), ["aud-1"])

    def test_love_story_timeline_is_registered_by_name_and_unlisted_products_keep_its_reader(self):
        from apps.commerce import media_promotion

        self.assertIs(media_promotion._MEDIA_COLLECTORS["love-story-timeline"], media_promotion._timeline_media_asset_ids)
        project = MagicMock()
        project.data = {"values": {"events": [{"video": {"assetId": "vid-1"}}]}}
        # Exactly the behaviour before the registry: a product with no entry
        # (or no product at all) reads `events[]`, and finds nothing in a
        # shape without it.
        self.assertEqual(media_promotion._media_asset_ids(project, "song-poster"), ["vid-1"])
        self.assertEqual(media_promotion._media_asset_ids(project, None), ["vid-1"])
        project.data = {"values": {"reasons": [{"photo": {"assetId": "photo-1"}}]}}
        self.assertEqual(media_promotion._media_asset_ids(project, "reasons-i-love-you"), [])

    def test_promotion_passes_the_orders_product_to_the_collector(self):
        from apps.commerce import media_promotion

        order = self._order(targets=["__live__"], project_data={"values": {"voices": [{"assetId": "voice-1"}]}})
        order.product_id = uuid.uuid4()
        order.product.slug = "some-product"
        collector = lambda values: [v["assetId"] for v in values["voices"]]  # noqa: E731
        with patch.dict(media_promotion._MEDIA_COLLECTORS, {"some-product": collector}), patch(
            "apps.assets.models.Asset"
        ) as mock_asset:
            media_promotion.promote_media_assets_for_order(order)
        self.assertEqual(mock_asset.objects.filter.call_args.kwargs["id__in"], ["voice-1"])

    def test_values_that_are_not_an_object_collect_nothing(self):
        from apps.commerce.media_promotion import _media_asset_ids

        project = MagicMock()
        project.data = {"values": ["not", "an", "object"]}
        self.assertEqual(_media_asset_ids(project, "love-story-timeline"), [])

    def test_a_malformed_project_does_not_raise(self):
        # Promotion is best-effort; a draft with a stale or broken shape
        # must not crash payment confirmation.
        from apps.commerce.media_promotion import _media_asset_ids

        project = MagicMock()
        project.data = {"values": {"events": ["not a dict", None, {"video": "not a dict either"}]}}
        self.assertEqual(_media_asset_ids(project), [])

    def test_promotion_is_skipped_entirely_for_a_non_media_order(self):
        # The cheap, common case: most orders never touch Asset.objects
        # at all.
        from apps.commerce.media_promotion import promote_media_assets_for_order

        with patch("apps.assets.models.Asset") as mock_asset:
            promote_media_assets_for_order(self._order(targets=["print-a4-edged"]))
            mock_asset.objects.filter.assert_not_called()

    def test_promotion_scopes_the_update_to_the_orders_own_customer(self):
        """Defence in depth: an asset id referenced in a project's JSON
        should already belong to that customer via the upload flow, but
        this filter means a tampered/malformed project cannot promote
        (and thus indefinitely retain) someone else's asset by guessing
        an id."""
        from apps.commerce.media_promotion import promote_media_assets_for_order

        order = self._order(
            targets=["__live__"],
            project_data={"values": {"events": [{"audio": {"assetId": "music-1"}}]}},
            customer_id="the-real-owner",
        )
        with patch("apps.assets.models.Asset") as mock_asset:
            mock_asset.objects.filter.return_value.update.return_value = 1
            promote_media_assets_for_order(order)
            _, kwargs = mock_asset.objects.filter.call_args
            self.assertEqual(kwargs.get("customer"), "the-real-owner")

    def test_a_promotion_failure_is_logged_not_raised(self):
        # Payment has already been taken by this point — a promotion bug
        # must not become a failed webhook.
        from apps.commerce.media_promotion import promote_media_assets_for_order

        order = self._order(targets=["__live__"], project_data={"values": {"events": [{"audio": {"assetId": "m1"}}]}})
        with patch("apps.assets.models.Asset") as mock_asset:
            mock_asset.objects.filter.side_effect = Exception("db blip")
            promote_media_assets_for_order(order)  # must not raise


class OrderUrlRoutingTests(SimpleTestCase):
    """§12 — the token moved from `?token=` to a path segment, via a SECOND
    url pattern per view rather than one "optional" segment (Django has no
    such converter).

    These test URL RESOLUTION specifically — `django.urls.resolve()` needs
    no database at all, which is exactly what would have caught the real
    bug found while making this change: Django matches patterns top to
    bottom, and a generic `<str:token>` pattern placed before the literal
    `/pay/`/`/entitlements/` routes would silently swallow "pay" and
    "entitlements" as if they were tokens, making OrderPayView and
    OrderEntitlementsView completely unreachable.
    """

    def test_a_bare_order_id_resolves_to_order_detail_with_no_token(self):
        from django.urls import resolve

        order_id = uuid.uuid4()
        match = resolve(f"/api/v1/orders/{order_id}/")
        self.assertEqual(match.view_name, "commerce:order-detail")
        self.assertEqual(match.kwargs.get("token"), None)

    def test_an_order_id_with_a_token_segment_resolves_with_the_token_captured(self):
        from django.urls import resolve

        order_id = uuid.uuid4()
        match = resolve(f"/api/v1/orders/{order_id}/abc123def456/")
        self.assertEqual(match.view_name, "commerce:order-detail-token")
        self.assertEqual(match.kwargs.get("token"), "abc123def456")

    def test_pay_is_never_swallowed_as_a_token(self):
        """The exact bug: a token-shaped catch-all placed before this
        literal route would match "pay" as a token and make real checkout
        payment confirmation completely unreachable."""
        from django.urls import resolve

        order_id = uuid.uuid4()
        match = resolve(f"/api/v1/orders/{order_id}/pay/")
        self.assertEqual(match.view_name, "commerce:order-pay")

    def test_entitlements_is_never_swallowed_as_a_token(self):
        from django.urls import resolve

        order_id = uuid.uuid4()
        match = resolve(f"/api/v1/orders/{order_id}/entitlements/")
        self.assertEqual(match.view_name, "commerce:order-entitlements")
        self.assertEqual(match.kwargs.get("token"), None)

    def test_entitlements_with_a_token_segment_resolves_correctly(self):
        from django.urls import resolve

        order_id = uuid.uuid4()
        match = resolve(f"/api/v1/orders/{order_id}/entitlements/xyz789/")
        self.assertEqual(match.view_name, "commerce:order-entitlements-token")
        self.assertEqual(match.kwargs.get("token"), "xyz789")

    def test_pay_has_no_token_variant_at_all(self):
        """Deliberate: paying is a live-checkout action, never something an
        emailed link to an existing order should be able to trigger."""
        from django.urls import Resolver404, resolve

        order_id = uuid.uuid4()
        with self.assertRaises(Resolver404):
            resolve(f"/api/v1/orders/{order_id}/pay/sometoken/")


# ------------------------------------------------------------------
# Freemius (sandbox review build) — staged checkout, no pre-existing Order
# ------------------------------------------------------------------

def _stage_ready_product_pack(plan_id="plan_1", pricing_id="pricing_1"):
    """A product/pack pair with a Freemius plan mapping configured, for
    tests that need staging to actually succeed. Returns
    (product, pack, mapping_key, plan_dict) — the caller patches
    `freemius_integration.FREEMIUS_PLAN_MAPPING` with `{mapping_key:
    plan_dict}` for the duration of the test.
    """
    product = make_product()
    pack = make_delivery_pack(product=product, price_cents=1599)
    return product, pack, f"{product.slug}:{pack.slug}", {"plan_id": plan_id, "pricing_id": pricing_id}


@override_settings(FREEMIUS_ENABLED=True)
class FreemiusStagingServiceTests(TestCase):
    def test_staging_requires_freemius_enabled(self):
        with override_settings(FREEMIUS_ENABLED=False):
            customer = make_customer()
            product, pack, key, plan = _stage_ready_product_pack()
            with patch.dict(freemius_integration.FREEMIUS_PLAN_MAPPING, {key: plan}):
                with self.assertRaises(FreemiusNotEnabled):
                    stage_freemius_checkout(customer, product_slug=product.slug, delivery_pack_slug=pack.slug)

    def test_staging_requires_a_configured_plan(self):
        """A pack with no Freemius plan mapping cannot be staged at all —
        rather than staging something that could never actually complete."""
        customer = make_customer()
        product, pack, _key, _plan = _stage_ready_product_pack()
        with self.assertRaises(FreemiusPlanNotConfigured):
            stage_freemius_checkout(customer, product_slug=product.slug, delivery_pack_slug=pack.slug)

    def test_staging_reuses_create_order_validation(self):
        """A disabled pack is rejected the same way create_order rejects
        it — same shared validation (_resolve_and_validate_order_inputs),
        not a second copy of the rule."""
        customer = make_customer()
        product, pack, key, plan = _stage_ready_product_pack()
        pack.status = DeliveryPack.STATUS_DISABLED
        pack.save(update_fields=["status"])
        with patch.dict(freemius_integration.FREEMIUS_PLAN_MAPPING, {key: plan}):
            with self.assertRaises(DeliveryPackDisabled):
                stage_freemius_checkout(customer, product_slug=product.slug, delivery_pack_slug=pack.slug)

    def test_staging_created_with_expected_total_and_expiry(self):
        customer = make_customer()
        product, pack, key, plan = _stage_ready_product_pack()
        with patch.dict(freemius_integration.FREEMIUS_PLAN_MAPPING, {key: plan}):
            staging = stage_freemius_checkout(customer, product_slug=product.slug, delivery_pack_slug=pack.slug)

        self.assertEqual(staging.status, FreemiusCheckoutStaging.STATUS_AWAITING_PAYMENT)
        self.assertEqual(staging.expected_total_cents, pack.price_cents)
        self.assertIsNone(staging.resulting_order)
        self.assertGreater(staging.expires_at, timezone.now())


@override_settings(FREEMIUS_ENABLED=True)
class FreemiusCompletionServiceTests(TestCase):
    """`_complete_freemius_purchase`, via its two real callers. No HTTP
    involved here — `freemius_integration.get_license` is mocked directly,
    since these tests are about the reconciliation logic, not the REST
    client (which has no dedicated test here, matching how paddle_billing's
    own SDK internals aren't re-tested by this codebase either).
    """

    def _staged(self):
        # The plan mapping patch has to stay active for the WHOLE test —
        # not just while staging is created — since completion re-checks
        # it too. `enterContext` (not a `with` block scoped to this one
        # helper call) is what makes that true.
        customer = make_customer()
        product, pack, key, plan = _stage_ready_product_pack()
        self.enterContext(patch.dict(freemius_integration.FREEMIUS_PLAN_MAPPING, {key: plan}))
        staging = stage_freemius_checkout(customer, product_slug=product.slug, delivery_pack_slug=pack.slug)
        return customer, staging, plan

    def test_complete_creates_a_paid_order_and_grants_entitlements(self):
        customer, staging, plan = self._staged()
        license_ = FreemiusLicense(
            id="lic_1", plan_id=plan["plan_id"], pricing_id=plan["pricing_id"], user_id="u1", is_cancelled=False
        )
        with patch.object(freemius_integration, "get_license", return_value=license_):
            order = complete_freemius_checkout(customer, staging.id, "lic_1")

        self.assertEqual(order.status, Order.STATUS_PAID)
        self.assertEqual(order.total_cents, staging.expected_total_cents)
        self.assertTrue(order.entitlements.exists())
        staging.refresh_from_db()
        self.assertEqual(staging.status, FreemiusCheckoutStaging.STATUS_COMPLETED)
        self.assertEqual(staging.resulting_order_id, order.id)

    def test_complete_is_idempotent_for_the_same_license_id(self):
        """The same license_id submitted twice — a retried frontend call,
        or the webhook safety net racing it — must never mint a second
        Order. Payment.order is NOT NULL, so (unlike Paddle/FastSpring's
        get_or_create-then-update) this path has to get the "already
        handled" check right on its own; this is what actually proves it
        does."""
        customer, staging, plan = self._staged()
        license_ = FreemiusLicense(
            id="lic_2", plan_id=plan["plan_id"], pricing_id=plan["pricing_id"], user_id="u1", is_cancelled=False
        )
        with patch.object(freemius_integration, "get_license", return_value=license_):
            order_first = complete_freemius_checkout(customer, staging.id, "lic_2")
            order_second = complete_freemius_checkout(customer, staging.id, "lic_2")

        self.assertEqual(order_first.id, order_second.id)
        self.assertEqual(Order.objects.filter(id=order_first.id).count(), 1)
        self.assertEqual(Payment.objects.filter(provider="freemius", provider_reference="lic_2").count(), 1)

    def test_complete_rejects_a_license_for_a_different_plan(self):
        """A real, previously-legitimate license_id must not be
        resubmittable against a staging row for a DIFFERENT pack and
        pass verification — this is the whole reason re-fetching the
        license checks plan_id/pricing_id rather than just "does this
        license_id exist and is it uncancelled."""
        customer, staging, plan = self._staged()
        wrong_license = FreemiusLicense(
            id="lic_3", plan_id="some-other-plan", pricing_id="some-other-pricing", user_id="u1", is_cancelled=False
        )
        with patch.object(freemius_integration, "get_license", return_value=wrong_license):
            with self.assertRaises(FreemiusVerificationFailed):
                complete_freemius_checkout(customer, staging.id, "lic_3")

        staging.refresh_from_db()
        self.assertEqual(staging.status, FreemiusCheckoutStaging.STATUS_AWAITING_PAYMENT)
        self.assertFalse(Payment.objects.filter(provider="freemius", provider_reference="lic_3").exists())

    def test_complete_rejects_a_cancelled_license(self):
        customer, staging, plan = self._staged()
        cancelled = FreemiusLicense(
            id="lic_4", plan_id=plan["plan_id"], pricing_id=plan["pricing_id"], user_id="u1", is_cancelled=True
        )
        with patch.object(freemius_integration, "get_license", return_value=cancelled):
            with self.assertRaises(FreemiusVerificationFailed):
                complete_freemius_checkout(customer, staging.id, "lic_4")

    def test_complete_rejects_another_customers_staging_row(self):
        customer, staging, plan = self._staged()
        stranger = make_customer()
        with self.assertRaises(FreemiusStagingAccessDenied):
            complete_freemius_checkout(stranger, staging.id, "lic_5")

    def test_complete_rejects_an_unknown_staging_id(self):
        customer = make_customer()
        with self.assertRaises(FreemiusStagingNotFound):
            complete_freemius_checkout(customer, uuid.uuid4(), "lic_6")

    def test_complete_rejects_an_expired_staging_row(self):
        """A very late completion attempt for an abandoned cart must not
        be resurrected — this is what the 1h expires_at window and the
        `expire_freemius_staging` management command exist to bound."""
        customer, staging, plan = self._staged()
        staging.expires_at = timezone.now() - timedelta(hours=1)
        staging.save(update_fields=["expires_at"])
        license_ = FreemiusLicense(
            id="lic_7", plan_id=plan["plan_id"], pricing_id=plan["pricing_id"], user_id="u1", is_cancelled=False
        )
        with patch.object(freemius_integration, "get_license", return_value=license_):
            with self.assertRaises(FreemiusStagingExpired):
                complete_freemius_checkout(customer, staging.id, "lic_7")

        staging.refresh_from_db()
        self.assertEqual(staging.status, FreemiusCheckoutStaging.STATUS_EXPIRED)


@override_settings(FREEMIUS_ENABLED=True)
class FreemiusWebhookBestEffortMatchTests(TestCase):
    """The safety net's bounded, non-guessing best-effort match — see
    `confirm_freemius_webhook_payment`'s own docstring for why this is
    the one place email-adjacent matching is used at all, and only for
    the case the frontend-driven path never ran."""

    def _staged(self, **customer_overrides):
        # Same reasoning as FreemiusCompletionServiceTests._staged: the
        # patch must outlive this helper call, since the webhook path
        # re-checks the plan mapping too.
        customer = make_customer(**customer_overrides)
        product, pack, key, plan = _stage_ready_product_pack()
        self.enterContext(patch.dict(freemius_integration.FREEMIUS_PLAN_MAPPING, {key: plan}))
        staging = stage_freemius_checkout(customer, product_slug=product.slug, delivery_pack_slug=pack.slug)
        return customer, staging, plan

    def test_exactly_one_candidate_completes_automatically(self):
        customer, staging, plan = self._staged()
        license_ = FreemiusLicense(
            id="lic_10", plan_id=plan["plan_id"], pricing_id=plan["pricing_id"], user_id="u1", is_cancelled=False
        )
        event = FreemiusWebhookEvent(
            event_type="payment.created", license_id="lic_10", payment_id="pay_10", user_email=customer.email
        )

        with patch.object(freemius_integration, "get_license", return_value=license_):
            with patch("apps.commerce.services.send_alert") as mock_alert:
                confirm_freemius_webhook_payment(event)

        # _complete_freemius_purchase itself sends the normal "PAID" alert
        # on any successful completion (matching Paddle/FastSpring's own
        # webhook confirmation) — what this test actually checks is that
        # the SEPARATE "could not be matched" reconciliation alert never
        # fires, since a real match was found.
        for call in mock_alert.call_args_list:
            self.assertNotIn("COULD NOT BE MATCHED", call.args[0])
        staging.refresh_from_db()
        self.assertEqual(staging.status, FreemiusCheckoutStaging.STATUS_COMPLETED)

    def test_zero_candidates_alerts_and_does_not_guess(self):
        event = FreemiusWebhookEvent(
            event_type="payment.created", license_id="lic_11", payment_id="pay_11", user_email="nobody@example.com"
        )
        with patch("apps.commerce.services.send_alert") as mock_alert:
            confirm_freemius_webhook_payment(event)

        mock_alert.assert_called_once()
        self.assertIn("0 candidate", mock_alert.call_args[0][0])
        self.assertFalse(Payment.objects.filter(provider="freemius", provider_reference="lic_11").exists())

    def test_multiple_candidates_alerts_and_does_not_guess(self):
        """Two simultaneously-pending staging rows under the same email —
        a real, legitimate scenario (two different gifts bought the same
        day) — must not be resolved by guessing between them."""
        shared_email = f"shared-{uuid.uuid4().hex[:8]}@example.com"
        customer = make_customer(email=shared_email)
        product, pack, key, plan = _stage_ready_product_pack()
        with patch.dict(freemius_integration.FREEMIUS_PLAN_MAPPING, {key: plan}):
            stage_freemius_checkout(customer, product_slug=product.slug, delivery_pack_slug=pack.slug)
            stage_freemius_checkout(customer, product_slug=product.slug, delivery_pack_slug=pack.slug)

        event = FreemiusWebhookEvent(
            event_type="payment.created", license_id="lic_12", payment_id="pay_12", user_email=shared_email
        )
        with patch("apps.commerce.services.send_alert") as mock_alert:
            confirm_freemius_webhook_payment(event)

        mock_alert.assert_called_once()
        self.assertIn("2 candidate", mock_alert.call_args[0][0])

    def test_a_redelivered_event_for_an_already_completed_staging_is_a_noop(self):
        """The license_id idempotency check inside
        _complete_freemius_purchase catches this before the best-effort
        matching logic ever runs — the common case (frontend path already
        completed it), not the rare one this class otherwise tests."""
        customer, staging, plan = self._staged()
        license_ = FreemiusLicense(
            id="lic_13", plan_id=plan["plan_id"], pricing_id=plan["pricing_id"], user_id="u1", is_cancelled=False
        )
        with patch.object(freemius_integration, "get_license", return_value=license_):
            complete_freemius_checkout(customer, staging.id, "lic_13")

            with patch("apps.commerce.services.send_alert") as mock_alert:
                event = FreemiusWebhookEvent(
                    event_type="payment.created", license_id="lic_13", payment_id="pay_13", user_email=customer.email
                )
                confirm_freemius_webhook_payment(event)

        mock_alert.assert_not_called()


@override_settings(FREEMIUS_ENABLED=True)
class FreemiusStagingViewTests(TestCase):
    """A thin HTTP-level check that the views wire up to the service
    layer correctly — the reconciliation logic itself is
    FreemiusCompletionServiceTests' job, not this class's."""

    def setUp(self):
        self.client = APIClient()

    def test_stage_endpoint_returns_checkout_options(self):
        product, pack, key, plan = _stage_ready_product_pack()
        login_as_guest(self.client, email="fs-view-test@example.com")

        with patch.dict(freemius_integration.FREEMIUS_PLAN_MAPPING, {key: plan}):
            response = self.client.post(
                "/api/v1/checkout/freemius/stage/",
                {"productId": product.slug, "deliveryPackId": pack.slug},
                format="json",
                **csrf_headers(self.client),
            )

        self.assertEqual(response.status_code, http_status.HTTP_201_CREATED)
        self.assertEqual(response.data["planId"], plan["plan_id"])
        self.assertEqual(response.data["pricingId"], plan["pricing_id"])
        self.assertEqual(response.data["status"], FreemiusCheckoutStaging.STATUS_AWAITING_PAYMENT)
        self.assertIsNone(response.data["orderId"])

    def test_staging_detail_is_owner_scoped(self):
        product, pack, key, plan = _stage_ready_product_pack()
        login_as_guest(self.client, email="fs-view-owner@example.com")

        with patch.dict(freemius_integration.FREEMIUS_PLAN_MAPPING, {key: plan}):
            create_response = self.client.post(
                "/api/v1/checkout/freemius/stage/",
                {"productId": product.slug, "deliveryPackId": pack.slug},
                format="json",
                **csrf_headers(self.client),
            )
        staging_id = create_response.data["stagingId"]

        other_client = APIClient()
        login_as_guest(other_client, email="fs-view-stranger@example.com")
        response = other_client.get(f"/api/v1/checkout/freemius/stage/{staging_id}/")

        self.assertEqual(response.status_code, http_status.HTTP_403_FORBIDDEN)


class FreemiusPlanMappingTests(SimpleTestCase):
    """The REAL, unpatched `FREEMIUS_PLAN_MAPPING` — every other Freemius test
    patches in its own plan, so a typo in the shipped table would otherwise
    only surface as a failed live checkout."""

    def test_love_story_timeline_packs_map_to_their_freemius_plans(self):
        self.assertEqual(freemius_integration.plan_for_pack("love-story-timeline", "live"), {"plan_id": "69404"})
        self.assertEqual(freemius_integration.plan_for_pack("love-story-timeline", "printable"), {"plan_id": "70517"})
        self.assertEqual(freemius_integration.plan_for_pack("love-story-timeline", "complete"), {"plan_id": "70518"})
        self.assertEqual(
            freemius_integration.plan_for_pack("love-story-timeline", "printable-plus-digital"), {"plan_id": "70543"}
        )

    def test_reasons_i_love_you_digital_pack_maps_to_its_own_plan(self):
        """Plan 71990 is Reasons I Love You's `live` pack and nothing else: a
        new plan under the same Freemius product, not a reused one (Love Story
        Timeline's Digital is 69404, the same price)."""
        self.assertEqual(freemius_integration.plan_for_pack("reasons-i-love-you", "live"), {"plan_id": "71990"})
        self.assertNotEqual(
            freemius_integration.plan_for_pack("reasons-i-love-you", "live"),
            freemius_integration.plan_for_pack("love-story-timeline", "live"),
        )

    def test_reasons_i_love_you_plan_is_for_the_pack_the_catalog_sells(self):
        """The mapped pack is the one `seed_catalog.py` creates for the product,
        at the $15.99 the plan was created with (completion cross-checks the
        plan, and the price must agree with it)."""
        import seed_catalog

        entry = next(e for e in seed_catalog.CATALOG if e["slug"] == "reasons-i-love-you")
        packs = {pack[0]: pack for pack in entry["packs"]}
        self.assertEqual(set(packs), {"live"})
        self.assertEqual(packs["live"][1], 1599)
        self.assertIsNotNone(freemius_integration.plan_for_pack("reasons-i-love-you", "live"))

    def test_printable_plus_digital_has_its_own_plan_not_the_retired_complete_one(self):
        """The combo was briefly set up by editing the Complete plan (70518)
        instead of creating a new one. Past Complete licenses are sold on
        70518, so the two packs must never share a plan."""
        combo = freemius_integration.plan_for_pack("love-story-timeline", "printable-plus-digital")
        complete = freemius_integration.plan_for_pack("love-story-timeline", "complete")
        self.assertIsNotNone(combo)
        self.assertNotEqual(combo["plan_id"], complete["plan_id"])

    def test_wallpaper_combo_packs_are_deliberately_unmapped(self):
        """`SHOW_WALLPAPER_ADDON` (frontend lib/feature-flags.ts) hides the only
        UI that selects these. If a plan is ever added for one, flip that flag
        deliberately — don't let this pass by accident of the other direction."""
        for slug in ("printable-plus-wallpaper", "digital-plus-wallpaper"):
            self.assertIsNone(freemius_integration.plan_for_pack("love-story-timeline", slug), slug)

    def test_no_two_packs_share_a_freemius_plan_id(self):
        """Completion trusts `plan_id` to identify WHICH pack was bought
        (`plan_matches`). Two packs sharing an id would let a license for the
        cheaper one complete the pricier one."""
        plan_ids = [plan["plan_id"] for plan in freemius_integration.FREEMIUS_PLAN_MAPPING.values()]
        self.assertEqual(len(plan_ids), len(set(plan_ids)))
        for plan_id in plan_ids:
            self.assertTrue(plan_id.isdigit(), plan_id)
