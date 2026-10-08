"""
Tests for the Phase 3.8 delivery/renderer architecture: entitlement
ownership, delivery-type classification, the renderer registry, the
opaque project passthrough, and the download API's security/response
contract.

Every real download in this test suite goes through test-double
renderers registered directly into `apps.delivery.registry._REGISTRY`
(patched per-test) — no product has a real renderer yet, matching the
actual state of the codebase; these doubles exist purely to prove the
delivery *pipeline* (ownership -> classification -> registry ->
render -> response) works correctly end-to-end.
"""

import base64
import io
import re
import threading
import uuid
import zipfile
from unittest.mock import MagicMock, patch

from django.db import connection, connections
from django.http import StreamingHttpResponse
from django.test import SimpleTestCase, TestCase, TransactionTestCase, override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework import status as http_status
from rest_framework.test import APIClient

from apps.assets.models import Asset
from apps.commerce.models import Entitlement, Order
from apps.common.test_helpers import csrf_headers, login_as_guest
from apps.customers.models import Customer
from apps.products.models import DeliveryPack, Product
from apps.projects.models import Project

from .bonuses import _qr_caption_for_order
from .delivery_types import LIVE_TARGET_SENTINEL, DeliveryType, infer_delivery_type
from .models import PublicExperience
from .registry import get_renderer
from .renderers import DigitalDeliveryResult, NotImplementedRenderer, TemporaryFileResult
from .services import get_delivery_for_entitlement, get_entitlement_for_customer
from .views import _safe_filename


# ------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------

def make_customer(**overrides) -> Customer:
    defaults = {"email": f"guest-{uuid.uuid4().hex[:8]}@example.com"}
    defaults.update(overrides)
    return Customer.objects.create(**defaults)


def make_asset(**overrides) -> Asset:
    """Bypasses `upload_asset()`'s decode/re-encode pipeline (which needs
    real, ffmpeg-decodable bytes for audio/video) entirely: these tests are
    about the payload's ownership-checked URL resolution, not the upload
    pipeline, which `apps/assets/tests.py` already covers in full. A bare
    `Asset` row with a `storage_key` is all `get_asset_for_customer` +
    `generate_asset_access_url` need.
    """
    defaults = {
        "storage_key": f"assets/{uuid.uuid4().hex}.m4a",
        "mime_type": "audio/mp4",
    }
    defaults.update(overrides)
    return Asset.objects.create(**defaults)


def make_product(**overrides) -> Product:
    defaults = {
        "slug": f"product-{uuid.uuid4().hex[:8]}",
        "name_i18n_key": "product.name",
        "category": Product.CATEGORY_OTHER,
        "status": Product.STATUS_AVAILABLE,
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


def make_paid_order_with_entitlements(*, target_ids, product=None, delivery_pack=None, customer=None, with_project=True):
    """Builds a fully paid order (bypassing checkout — these are
    delivery-layer tests, not payment-flow tests, which are already
    covered in apps/commerce/tests.py) with one Entitlement per target,
    matching exactly how `grant_entitlements` would have created them.
    """
    customer = customer or make_customer()
    product = product or make_product()
    delivery_pack = delivery_pack or make_delivery_pack(product=product, included_targets=target_ids)

    project = None
    if with_project:
        project = Project.objects.create(
            customer=customer,
            product=product,
            data={"version": 1, "values": {"title": "Our Story"}, "themeSelections": {"palette": "warm"}},
        )

    order = Order.objects.create(
        customer=customer,
        product=product,
        delivery_pack=delivery_pack,
        project=project,
        guest_email=customer.email,
        subtotal_cents=delivery_pack.price_cents,
        discount_cents=0,
        total_cents=delivery_pack.price_cents,
        status=Order.STATUS_PAID,
    )
    entitlements = [
        Entitlement.objects.create(order=order, product=product, target_id=target_id) for target_id in target_ids
    ]

    # `grant_entitlements` provisions a PublicExperience for every live
    # entitlement, and delivery for `__live__` now resolves to that hosted
    # page rather than a downloadable file — so a fixture without one makes
    # the download raise `RendererNotAvailable` and the test fail on its
    # own setup rather than on the behaviour it is checking.
    for entitlement in entitlements:
        if entitlement.target_id == LIVE_TARGET_SENTINEL:
            PublicExperience.objects.create(
                entitlement=entitlement,
                kind=PublicExperience.KIND_LIVE,
                status=PublicExperience.STATUS_ACTIVE,
            )

    return customer, order, entitlements


class _CapturingRenderer:
    """Records exactly what it was called with — proves the delivery
    layer passes the project/delivery_type through unchanged.
    """

    def __init__(self, result=None):
        self.received_project = "UNSET"
        self.received_delivery_type = None
        self.received_delivery_pack = None
        self.received_target_id = None
        self.received_locale = None
        self._result = result or TemporaryFileResult(content=b"fake", content_type="application/octet-stream", filename="out.bin")

    def render(self, project, delivery_type, delivery_pack, target_id, locale="en"):
        # `locale` was added to the ProductRenderer interface (it is the
        # language the order was placed in, recorded on Order.locale at
        # checkout) and this double was never updated, so every test that
        # reached a renderer died with "takes 5 positional arguments but 6
        # were given" — about twenty of them. Captured rather than ignored:
        # this class exists to assert what the renderer is handed.
        self.received_project = project
        self.received_delivery_type = delivery_type
        self.received_delivery_pack = delivery_pack
        self.received_target_id = target_id
        self.received_locale = locale
        return self._result

    def preview(self, project):
        raise NotImplementedError


# ------------------------------------------------------------------
# Delivery type classification
# ------------------------------------------------------------------

class DeliveryTypeInferenceTests(TestCase):
    def test_live_sentinel_is_always_digital(self):
        self.assertEqual(infer_delivery_type(target_id="__live__", delivery_pack_slug="complete"), DeliveryType.DIGITAL)
        self.assertEqual(infer_delivery_type(target_id="__live__", delivery_pack_slug=None), DeliveryType.DIGITAL)

    def test_pack_slug_takes_priority_over_target_naming(self):
        """The exact real-catalog case: "story-png" is classified as
        WALLPAPER when purchased through the "wallpaper" pack, even
        though the bare target name alone would suggest SOCIAL.
        """
        self.assertEqual(
            infer_delivery_type(target_id="story-png", delivery_pack_slug="wallpaper"), DeliveryType.WALLPAPER
        )
        self.assertEqual(
            infer_delivery_type(target_id="story-png", delivery_pack_slug="social"), DeliveryType.SOCIAL
        )

    def test_printable_pack_slug(self):
        self.assertEqual(infer_delivery_type(target_id="print-png", delivery_pack_slug="printable"), DeliveryType.PRINTABLE)

    def test_bundle_pack_falls_back_to_target_naming(self):
        """"complete" doesn't map to a single type — falls back to the
        bare target id's own naming convention.
        """
        self.assertEqual(infer_delivery_type(target_id="print-png", delivery_pack_slug="complete"), DeliveryType.PRINTABLE)
        self.assertEqual(infer_delivery_type(target_id="story-png", delivery_pack_slug="complete"), DeliveryType.SOCIAL)
        self.assertEqual(infer_delivery_type(target_id="landscape-png", delivery_pack_slug="complete"), DeliveryType.WALLPAPER)
        self.assertEqual(infer_delivery_type(target_id="__live__", delivery_pack_slug="complete"), DeliveryType.DIGITAL)

    def test_unrecognized_pack_slug_falls_back_to_target_naming(self):
        self.assertEqual(infer_delivery_type(target_id="print-png", delivery_pack_slug="some-future-pack"), DeliveryType.PRINTABLE)

    def test_no_pack_slug_falls_back_to_target_naming(self):
        self.assertEqual(infer_delivery_type(target_id="square-png", delivery_pack_slug=None), DeliveryType.SOCIAL)
        self.assertEqual(infer_delivery_type(target_id="portrait-png", delivery_pack_slug=None), DeliveryType.WALLPAPER)

    def test_unclassifiable_target_raises_structured_error(self):
        from apps.common.exceptions.api_errors import UnsupportedDeliveryType

        with self.assertRaises(UnsupportedDeliveryType):
            infer_delivery_type(target_id="totally-unknown-format", delivery_pack_slug=None)


# ------------------------------------------------------------------
# Renderer registry
# ------------------------------------------------------------------

class RendererRegistryTests(TestCase):
    def test_unregistered_product_returns_not_implemented_renderer(self):
        renderer = get_renderer("some-unregistered-product", DeliveryType.PRINTABLE)
        self.assertIsInstance(renderer, NotImplementedRenderer)

    def test_not_implemented_renderer_raises_structured_error_on_render(self):
        from apps.common.exceptions.api_errors import RendererNotAvailable

        # A genuinely unregistered product — "love-story-timeline" and
        # "heart-map" both have real renderers as of Phase 3.9/3.11, so
        # neither is a valid example of "nothing registered" anymore
        # (see the registered-renderer tests below, and each product's
        # own test suite, which cover those cases for real).
        renderer = get_renderer("song-poster", DeliveryType.PRINTABLE)
        with self.assertRaises(RendererNotAvailable):
            renderer.render(project=None, delivery_type=DeliveryType.PRINTABLE, delivery_pack=None, target_id="print-png")

    def test_registered_renderer_is_selected_correctly(self):
        fake = _CapturingRenderer()
        with patch.dict("apps.delivery.registry._REGISTRY", {"love-story-timeline": fake}):
            renderer = get_renderer("love-story-timeline", DeliveryType.PRINTABLE)
        self.assertIs(renderer, fake)

    def test_unsupported_delivery_type_on_a_registered_renderer_is_the_renderers_own_concern(self):
        """The registry itself only dispatches by product; a renderer
        that doesn't support a given delivery_type is expected to raise
        its own structured error from `render()` — the registry has no
        opinion here, matching "unsupported delivery type fails
        cleanly" without the registry needing to know per-product
        capabilities.
        """
        from apps.common.exceptions.api_errors import RendererNotAvailable

        class _OnlyPrintableRenderer:
            def render(self, project, delivery_type, delivery_pack, target_id, locale="en"):
                if delivery_type != DeliveryType.PRINTABLE:
                    raise RendererNotAvailable(f"{delivery_type} not supported by this product yet.")
                return TemporaryFileResult(content=b"x", content_type="image/png", filename="x.png")

            def preview(self, project):
                raise NotImplementedError

        with patch.dict("apps.delivery.registry._REGISTRY", {"love-story-timeline": _OnlyPrintableRenderer()}):
            renderer = get_renderer("love-story-timeline", DeliveryType.SOCIAL)
            with self.assertRaises(RendererNotAvailable):
                renderer.render(project=None, delivery_type=DeliveryType.SOCIAL, delivery_pack=None, target_id="story-png")


# ------------------------------------------------------------------
# Ownership (service layer)
# ------------------------------------------------------------------

class EntitlementOwnershipServiceTests(TestCase):
    def test_owner_can_resolve_entitlement(self):
        customer, order, entitlements = make_paid_order_with_entitlements(target_ids=["print-png"])
        resolved = get_entitlement_for_customer(customer, entitlements[0].id)
        self.assertEqual(resolved.id, entitlements[0].id)

    def test_another_guest_cannot_resolve_entitlement(self):
        from apps.common.exceptions.api_errors import EntitlementAccessDenied

        _, order, entitlements = make_paid_order_with_entitlements(target_ids=["print-png"])
        other_customer = make_customer()
        with self.assertRaises(EntitlementAccessDenied):
            get_entitlement_for_customer(other_customer, entitlements[0].id)

    def test_unknown_entitlement_id_raises_not_found(self):
        from apps.common.exceptions.api_errors import EntitlementNotFound

        customer = make_customer()
        with self.assertRaises(EntitlementNotFound):
            get_entitlement_for_customer(customer, uuid.uuid4())

    def test_unpaid_order_entitlement_raises_not_found(self):
        """Defensive check: even if an Entitlement row somehow exists
        for a non-paid order (unreachable through the real
        grant_entitlements flow, but checked explicitly rather than
        assumed — see services.py's docstring), it must not resolve as
        deliverable.
        """
        from apps.common.exceptions.api_errors import EntitlementNotFound

        customer = make_customer()
        product = make_product()
        pack = make_delivery_pack(product=product, included_targets=["print-png"])
        order = Order.objects.create(
            customer=customer, product=product, delivery_pack=pack, guest_email=customer.email,
            subtotal_cents=1200, total_cents=1200, status=Order.STATUS_PENDING,
        )
        entitlement = Entitlement.objects.create(order=order, product=product, target_id="print-png")

        with self.assertRaises(EntitlementNotFound):
            get_entitlement_for_customer(customer, entitlement.id)


# ------------------------------------------------------------------
# Project passthrough
# ------------------------------------------------------------------

class ProjectPassthroughTests(TestCase):
    def test_renderer_receives_the_orders_project_unchanged(self):
        customer, order, entitlements = make_paid_order_with_entitlements(target_ids=["print-png"])
        fake = _CapturingRenderer()

        with patch.dict("apps.delivery.registry._REGISTRY", {order.product.slug: fake}):
            get_delivery_for_entitlement(entitlements[0])

        self.assertEqual(fake.received_project.id, order.project.id)
        self.assertEqual(fake.received_project.data, {"version": 1, "values": {"title": "Our Story"}, "themeSelections": {"palette": "warm"}})

    def test_generic_delivery_code_does_not_mutate_project_data(self):
        customer, order, entitlements = make_paid_order_with_entitlements(target_ids=["print-png"])
        original_data = dict(order.project.data)
        fake = _CapturingRenderer()

        with patch.dict("apps.delivery.registry._REGISTRY", {order.product.slug: fake}):
            get_delivery_for_entitlement(entitlements[0])

        order.project.refresh_from_db()
        self.assertEqual(order.project.data, original_data)

    def test_renderer_receives_none_when_order_has_no_project(self):
        customer, order, entitlements = make_paid_order_with_entitlements(target_ids=["print-png"], with_project=False)
        fake = _CapturingRenderer()

        with patch.dict("apps.delivery.registry._REGISTRY", {order.product.slug: fake}):
            get_delivery_for_entitlement(entitlements[0])

        self.assertIsNone(fake.received_project)

    def test_renderer_receives_the_correct_delivery_type(self):
        customer, order, entitlements = make_paid_order_with_entitlements(
            target_ids=["print-png"], delivery_pack=None
        )
        fake = _CapturingRenderer()
        with patch.dict("apps.delivery.registry._REGISTRY", {order.product.slug: fake}):
            get_delivery_for_entitlement(entitlements[0])
        self.assertEqual(fake.received_delivery_type, DeliveryType.PRINTABLE)


# ------------------------------------------------------------------
# API — ownership, security, response contract
# ------------------------------------------------------------------

class EntitlementDownloadAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _login_as(self, customer):
        login_as_guest(self.client, email=customer.email)

    def test_owner_can_download_printable_output(self):
        customer, order, entitlements = make_paid_order_with_entitlements(target_ids=["print-png"])
        fake = _CapturingRenderer(TemporaryFileResult(content=b"fake-png-bytes", content_type="image/png", filename="timeline.png"))
        self._login_as(customer)

        with patch.dict("apps.delivery.registry._REGISTRY", {order.product.slug: fake}):
            response = self.client.get(f"/api/v1/entitlements/{entitlements[0].id}/download/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response.content, b"fake-png-bytes")
        self.assertEqual(response["Content-Type"], "image/png")
        self.assertIn("timeline.png", response["Content-Disposition"])

    def test_digital_delivery_returns_url_json(self):
        customer, order, entitlements = make_paid_order_with_entitlements(target_ids=["__live__"])
        fake = _CapturingRenderer(DigitalDeliveryResult(url="https://theheartfolio.com/g/abc123"))
        self._login_as(customer)

        with patch.dict("apps.delivery.registry._REGISTRY", {order.product.slug: fake}):
            response = self.client.get(f"/api/v1/entitlements/{entitlements[0].id}/download/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response.data, {"url": "https://theheartfolio.com/g/abc123"})

    def test_unimplemented_renderer_returns_structured_501(self):
        customer, order, entitlements = make_paid_order_with_entitlements(target_ids=["print-png"])
        self._login_as(customer)

        response = self.client.get(f"/api/v1/entitlements/{entitlements[0].id}/download/")

        self.assertEqual(response.status_code, http_status.HTTP_501_NOT_IMPLEMENTED)
        self.assertEqual(response.data["error"]["code"], "renderer_not_available")

    def test_another_guest_cannot_download(self):
        customer, order, entitlements = make_paid_order_with_entitlements(target_ids=["print-png"])
        other_customer = make_customer()
        self._login_as(other_customer)

        response = self.client.get(f"/api/v1/entitlements/{entitlements[0].id}/download/")

        self.assertEqual(response.status_code, http_status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["error"]["code"], "entitlement_access_denied")

    def test_unknown_entitlement_returns_404(self):
        customer = make_customer()
        self._login_as(customer)
        response = self.client.get(f"/api/v1/entitlements/{uuid.uuid4()}/download/")
        self.assertEqual(response.status_code, http_status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.data["error"]["code"], "entitlement_not_found")

    def test_no_session_rejected(self):
        response = self.client.get(f"/api/v1/entitlements/{uuid.uuid4()}/download/")
        self.assertEqual(response.status_code, http_status.HTTP_401_UNAUTHORIZED)

    def test_pending_order_entitlement_not_accessible(self):
        customer = make_customer()
        product = make_product()
        pack = make_delivery_pack(product=product, included_targets=["print-png"])
        order = Order.objects.create(
            customer=customer, product=product, delivery_pack=pack, guest_email=customer.email,
            subtotal_cents=1200, total_cents=1200, status=Order.STATUS_PENDING,
        )
        entitlement = Entitlement.objects.create(order=order, product=product, target_id="print-png")
        self._login_as(customer)

        response = self.client.get(f"/api/v1/entitlements/{entitlement.id}/download/")
        self.assertEqual(response.status_code, http_status.HTTP_404_NOT_FOUND)

    def test_query_parameters_cannot_influence_which_project_or_customer_is_used(self):
        """A client attempting to smuggle a different project/customer
        via query string has no effect — the view never reads any
        query parameters at all.
        """
        customer, order, entitlements = make_paid_order_with_entitlements(target_ids=["print-png"])
        other_customer, other_order, other_entitlements = make_paid_order_with_entitlements(target_ids=["print-png"])
        fake = _CapturingRenderer()
        self._login_as(customer)

        with patch.dict("apps.delivery.registry._REGISTRY", {order.product.slug: fake}):
            response = self.client.get(
                f"/api/v1/entitlements/{entitlements[0].id}/download/"
                f"?customerId={other_customer.id}&projectId={other_order.project.id}"
            )

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        # Still resolved the *owning* customer's own project, not the
        # one named in the query string.
        self.assertEqual(fake.received_project.id, order.project.id)

    def test_response_never_exposes_storage_key_or_internal_details(self):
        customer, order, entitlements = make_paid_order_with_entitlements(target_ids=["print-png"])
        fake = _CapturingRenderer(TemporaryFileResult(content=b"x", content_type="image/png", filename="x.png"))
        self._login_as(customer)

        with patch.dict("apps.delivery.registry._REGISTRY", {order.product.slug: fake}):
            response = self.client.get(f"/api/v1/entitlements/{entitlements[0].id}/download/")

        headers_text = str(dict(response.items()))
        self.assertNotIn("storage_key", headers_text.lower())
        self.assertNotIn("r2_", headers_text.lower())


# ------------------------------------------------------------------
# Temporary output — no generated output is ever persisted
# ------------------------------------------------------------------

class TemporaryOutputTests(TestCase):
    def test_no_generated_output_is_persisted_as_an_asset(self):
        from apps.assets.models import Asset

        customer, order, entitlements = make_paid_order_with_entitlements(target_ids=["print-png"])
        fake = _CapturingRenderer(TemporaryFileResult(content=b"fake-png-bytes", content_type="image/png", filename="x.png"))

        assets_before = Asset.objects.count()
        with patch.dict("apps.delivery.registry._REGISTRY", {order.product.slug: fake}):
            get_delivery_for_entitlement(entitlements[0])
        assets_after = Asset.objects.count()

        self.assertEqual(assets_before, assets_after)

    def test_repeated_delivery_requests_are_safe(self):
        """Downloading the same entitlement twice doesn't create any
        new database rows or duplicate anything — delivery is a pure
        read (render-on-demand), never a mutation.
        """
        customer, order, entitlements = make_paid_order_with_entitlements(target_ids=["print-png"])
        fake = _CapturingRenderer()

        with patch.dict("apps.delivery.registry._REGISTRY", {order.product.slug: fake}):
            get_delivery_for_entitlement(entitlements[0])
            get_delivery_for_entitlement(entitlements[0])

        self.assertEqual(Entitlement.objects.filter(order=order).count(), 1)


# ------------------------------------------------------------------
# Phase 3.13 — Cache-Control, filename safety, query budget,
# concurrency, and the R2 input/output boundary, exercised through
# the real HTTP endpoint with the real registered renderers (Love
# Story Timeline / Where We Met Map) rather than test doubles, since
# these are properties of the actual response the client receives.
# ------------------------------------------------------------------

class CacheControlTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_binary_download_is_never_cacheable(self):
        from .product_renderers.love_story_timeline.tests import make_paid_entitlement

        customer, order, entitlement = make_paid_entitlement(target_id="print-png")
        login_as_guest(self.client, email=customer.email)

        response = self.client.get(f"/api/v1/entitlements/{entitlement.id}/download/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response["Cache-Control"], "private, no-store")

    def test_digital_json_response_is_never_cacheable(self):
        customer, order, entitlements = make_paid_order_with_entitlements(target_ids=["__live__"])
        fake = _CapturingRenderer(DigitalDeliveryResult(url="https://theheartfolio.com/g/abc123"))
        login_as_guest(self.client, email=customer.email)

        with patch.dict("apps.delivery.registry._REGISTRY", {order.product.slug: fake}):
            response = self.client.get(f"/api/v1/entitlements/{entitlements[0].id}/download/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response["Cache-Control"], "private, no-store")


class FilenameSafetyTests(TestCase):
    """`_safe_filename` is defense-in-depth — `target_id` (the only
    thing that currently feeds a delivered filename) is server/admin
    data, never client input at request time — but the view still
    guards the `Content-Disposition` header explicitly, since a raw
    f-string into an HTTP header is exactly the kind of thing that
    should never depend on an upstream value staying well-behaved.
    """

    def test_strips_path_separators(self):
        # Path separators are stripped, and any resulting leading dots
        # (e.g. from "../..") are also stripped by the hidden-file
        # guard — so this collapses all the way to "etcpasswd", not
        # just to a separator-free "..etcpasswd".
        self.assertEqual(_safe_filename("../../etc/passwd"), "etcpasswd")
        self.assertNotIn("/", _safe_filename("a/b/c"))
        self.assertNotIn("\\", _safe_filename("a\\b\\c"))

    def test_strips_header_injection_characters(self):
        malicious = 'evil.png"\r\nSet-Cookie: hacked=1'
        cleaned = _safe_filename(malicious)
        self.assertNotIn("\r", cleaned)
        self.assertNotIn("\n", cleaned)
        self.assertNotIn('"', cleaned)
        self.assertNotIn(":", cleaned)
        self.assertNotIn(" ", cleaned)

    def test_no_leading_dot_hidden_file(self):
        self.assertFalse(_safe_filename("...bashrc").startswith("."))

    def test_empty_or_fully_stripped_input_falls_back(self):
        self.assertEqual(_safe_filename(""), "download")
        self.assertEqual(_safe_filename("///\\\\\r\n"), "download")

    def test_ordinary_filenames_pass_through_unchanged(self):
        self.assertEqual(_safe_filename("print-png.png"), "print-png.png")
        self.assertEqual(_safe_filename("gift.html"), "gift.html")

    def test_malicious_renderer_filename_is_sanitized_in_actual_response_header(self):
        """End-to-end: even if a future/misbehaving renderer returned
        an unsafe filename, the HTTP response header is still safe.
        """
        client = APIClient()
        customer, order, entitlements = make_paid_order_with_entitlements(target_ids=["print-png"])
        malicious_result = TemporaryFileResult(
            content=b"x", content_type="image/png", filename='../../x.png"\r\nX-Injected: 1'
        )
        fake = _CapturingRenderer(malicious_result)
        login_as_guest(client, email=customer.email)

        with patch.dict("apps.delivery.registry._REGISTRY", {order.product.slug: fake}):
            response = client.get(f"/api/v1/entitlements/{entitlements[0].id}/download/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        disposition = response["Content-Disposition"]
        # The actual security property: none of the header-injection
        # syntax survives. `-` is a legitimate, allowed filename
        # character (real targets are named e.g. "print-png"), so the
        # bare word "Injected" surviving as plain text is fine — what
        # must never survive is anything that could start a new header
        # line or a new attribute within this one.
        self.assertNotIn("\r", disposition)
        self.assertNotIn("\n", disposition)
        self.assertNotIn("..", disposition)
        self.assertNotIn(":", disposition)
        self.assertNotIn(" ", disposition.split('filename="')[1])


class DeliveryQueryBudgetTests(TestCase):
    """Locks in the query count for a full real-renderer download so a
    future regression (e.g. losing a `select_related` chain) is caught
    by a failing test rather than discovered as a slow endpoint later.
    Exactly 3 queries: session lookup, customer lookup (session
    resolution), and the entitlement fetch itself — which, via
    `select_related` all the way through `order__project__customer`,
    is the only query that touches Order/Product/DeliveryPack/Project/
    that Project's Customer. No renderer in this codebase currently
    issues additional queries of its own for the fixtures used here.
    """

    def test_full_download_query_count_is_flat_regardless_of_target_count(self):
        from .product_renderers.love_story_timeline.tests import make_paid_entitlement

        customer, order, entitlement = make_paid_entitlement(target_id="print-png")
        client = APIClient()
        login_as_guest(client, email=customer.email)

        with CaptureQueriesContext(connection) as ctx:
            response = client.get(f"/api/v1/entitlements/{entitlement.id}/download/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertLessEqual(
            len(ctx.captured_queries), 3,
            f"Expected at most 3 queries, got {len(ctx.captured_queries)}: "
            f"{[q['sql'][:120] for q in ctx.captured_queries]}",
        )


class GeneratedOutputNeverReachesR2Tests(TestCase):
    """Structural proof of the R2 boundary (section 9): a full delivery
    request that *does* pull an input photo from R2 (proving the read
    path is genuinely exercised, not just absent because nothing
    needed a photo) never calls `AssetStorage.upload` — the only write
    path into R2 — at any point during rendering or response
    construction.
    """

    def test_upload_is_never_called_during_a_delivery_that_reads_an_input_photo(self):
        import io

        from django.core.files.uploadedfile import SimpleUploadedFile
        from PIL import Image

        from apps.assets.services import upload_asset
        from apps.assets.storage import MockAssetStorage
        from .product_renderers.love_story_timeline.tests import VALID_VALUES, VALID_THEME, make_customer as make_lst_customer
        from .product_renderers.love_story_timeline.tests import make_lst_product, make_delivery_pack as make_lst_pack

        customer = make_lst_customer()
        buf = io.BytesIO()
        Image.new("RGB", (100, 100), "blue").save(buf, format="JPEG")
        buf.seek(0)
        asset = upload_asset(customer, SimpleUploadedFile("photo.jpg", buf.getvalue(), content_type="image/jpeg"))

        values = {
            **VALID_VALUES,
            "events": [{"date": "2020-01-01", "title": "X", "photo": {"assetId": str(asset.id)}}],
        }
        product = make_lst_product()
        pack = make_lst_pack(product, included_targets=["print-png"])
        project = Project.objects.create(
            customer=customer, product=product, data={"version": 1, "values": values, "themeSelections": VALID_THEME},
        )
        order = Order.objects.create(
            customer=customer, product=product, delivery_pack=pack, project=project, guest_email=customer.email,
            subtotal_cents=pack.price_cents, total_cents=pack.price_cents, status=Order.STATUS_PAID,
        )
        entitlement = Entitlement.objects.create(order=order, product=product, target_id="print-png")

        client = APIClient()
        login_as_guest(client, email=customer.email)

        with patch.object(MockAssetStorage, "upload", wraps=MockAssetStorage.upload, autospec=True) as spy_upload:
            response = client.get(f"/api/v1/entitlements/{entitlement.id}/download/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        # The photo was genuinely read (proves this test isn't vacuous)...
        self.assertIn(b"\x89PNG\r\n\x1a\n", response.content[:8])
        # ...but nothing was ever uploaded back to R2 during delivery.
        spy_upload.assert_not_called()


class ConcurrentDownloadTests(TransactionTestCase):
    """Real commits across real separate DB connections (like the
    commerce app's `ConcurrentPaymentConfirmationTests`), so N
    concurrent HTTP requests for the same entitlement genuinely race
    against each other rather than serializing inside one wrapping
    test transaction.
    """

    def tearDown(self):
        # Belt-and-suspenders alongside the per-thread `connection.close()`
        # in `attempt()` below: also closes whatever connection *this*
        # (main) thread opened during setup/assertions, promptly rather
        # than leaving it for Django's own teardown machinery to get to
        # later — part of the same investigation as the stuck-thread
        # check below (see that comment for the actual root cause).
        connections.close_all()

    def test_concurrent_downloads_of_the_same_entitlement_all_succeed_safely(self):
        from .product_renderers.love_story_timeline.tests import make_paid_entitlement

        customer, order, entitlement = make_paid_entitlement(target_id="print-png")

        # Establish one real session, then reuse its session cookie
        # across N independent APIClient instances/threads/connections
        # — the same guest, N concurrent requests.
        login_client = APIClient()
        login_as_guest(login_client, email=customer.email)
        session_cookie = login_client.cookies["sessionid"].value

        results = []
        errors = []

        def attempt():
            try:
                thread_client = APIClient()
                thread_client.cookies["sessionid"] = session_cookie
                response = thread_client.get(f"/api/v1/entitlements/{entitlement.id}/download/")
                results.append((response.status_code, response.content))
            except Exception as exc:  # pragma: no cover - only on genuine failure
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=attempt) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)

        # A thread still running after the join timeout means its
        # `finally: connection.close()` hasn't executed yet — that
        # connection stays open (visible to PostgreSQL as an active
        # session) for as long as the thread keeps running, which can
        # outlive this test method's return and surface much later as
        # "database is being accessed by other users" when the test
        # database is finally dropped. Silently ignoring a timed-out
        # join was the actual leak here, not `connection.close()`
        # itself (which is correct) — fail loudly instead of masking
        # a genuinely slow/stuck thread as if it were a clean run.
        stuck = [t.name for t in threads if t.is_alive()]
        self.assertEqual(stuck, [], f"{len(stuck)} thread(s) did not finish within the join timeout")

        self.assertEqual(errors, [])
        self.assertEqual(len(results), 5)
        for status_code, content in results:
            self.assertEqual(status_code, http_status.HTTP_200_OK)
            self.assertTrue(content.startswith(b"\x89PNG\r\n\x1a\n"))

        # No duplication, no corruption, no persisted output, no
        # commerce-state mutation — delivery is a pure read.
        self.assertEqual(Entitlement.objects.filter(order=order).count(), 1)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_PAID)


class OrderPackDownloadAPITests(TestCase):
    """`GET /api/v1/orders/<uuid>/download/` — the whole purchased pack
    as one archive.

    Heartfolio sells packs, so a customer who bought the Complete Pack
    gets their keepsake in one action. These tests exist to prove the
    convenience route grants exactly what the per-file route grants and
    nothing more: same ownership rule, same paid rule, same renderers.
    """

    def setUp(self):
        self.client = APIClient()

    def _login_as(self, customer):
        login_as_guest(self.client, email=customer.email)

    @staticmethod
    def _streamed_content(response) -> bytes:
        """`OrderPackDownloadView` returns a `StreamingHttpResponse` now
        (see views.py's `_iter_pack_archive`), which has no `.content` —
        Django raises rather than silently buffering it, so tests read
        the generator explicitly instead.
        """
        return b"".join(response.streaming_content)

    @staticmethod
    def _multi_renderer():
        """Returns distinct bytes per target so the archive's contents
        can be attributed to the right entitlement."""

        class _PerTargetRenderer:
            def render(self, project, delivery_type, delivery_pack, target_id, locale="en"):
                return TemporaryFileResult(
                    content=f"bytes-for-{target_id}".encode(),
                    content_type="image/png",
                    filename=f"{target_id}.png",
                )

        return _PerTargetRenderer()

    def test_owner_downloads_every_file_in_the_purchased_pack(self):
        customer, order, _ = make_paid_order_with_entitlements(target_ids=["story-png", "portrait-png"])
        self._login_as(customer)

        with patch.dict("apps.delivery.registry._REGISTRY", {order.product.slug: self._multi_renderer()}):
            response = self.client.get(f"/api/v1/orders/{order.id}/download/")
            # Rendering is lazy now (see `_iter_pack_archive`) — it only
            # actually happens once something reads `streaming_content`,
            # so that read has to stay inside the patched registry too.
            content = self._streamed_content(response)

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "application/zip")

        archive = zipfile.ZipFile(io.BytesIO(content))
        self.assertEqual(sorted(archive.namelist()), ["portrait-png.png", "story-png.png"])
        self.assertEqual(archive.read("story-png.png"), b"bytes-for-story-png")

    def test_archive_contains_only_the_purchased_pack_not_every_target(self):
        # The renderer could produce other sizes; the archive must
        # contain exactly what was bought.
        customer, order, _ = make_paid_order_with_entitlements(target_ids=["story-png"])
        self._login_as(customer)

        with patch.dict("apps.delivery.registry._REGISTRY", {order.product.slug: self._multi_renderer()}):
            response = self.client.get(f"/api/v1/orders/{order.id}/download/")
            content = self._streamed_content(response)

        archive = zipfile.ZipFile(io.BytesIO(content))
        self.assertEqual(archive.namelist(), ["story-png.png"])

    def test_unpaid_order_is_denied(self):
        customer, order, _ = make_paid_order_with_entitlements(target_ids=["print-png"])
        order.status = Order.STATUS_PENDING
        order.save(update_fields=["status"])
        self._login_as(customer)

        response = self.client.get(f"/api/v1/orders/{order.id}/download/")

        # Reported as not-found, never "exists but unpaid" — this
        # endpoint must not reveal which orders have been paid.
        self.assertEqual(response.status_code, http_status.HTTP_404_NOT_FOUND)

    def test_cancelled_order_is_denied(self):
        customer, order, _ = make_paid_order_with_entitlements(target_ids=["print-png"])
        order.status = Order.STATUS_CANCELLED
        order.save(update_fields=["status"])
        self._login_as(customer)

        response = self.client.get(f"/api/v1/orders/{order.id}/download/")
        self.assertEqual(response.status_code, http_status.HTTP_404_NOT_FOUND)

    def test_another_customer_cannot_download_the_pack(self):
        customer, order, _ = make_paid_order_with_entitlements(target_ids=["print-png"])
        other_customer, _, _ = make_paid_order_with_entitlements(target_ids=["print-png"])
        self._login_as(other_customer)

        with patch.dict("apps.delivery.registry._REGISTRY", {order.product.slug: self._multi_renderer()}):
            response = self.client.get(f"/api/v1/orders/{order.id}/download/")

        self.assertEqual(response.status_code, http_status.HTTP_403_FORBIDDEN)

    def test_anonymous_visitor_is_denied(self):
        _, order, _ = make_paid_order_with_entitlements(target_ids=["print-png"])

        response = self.client.get(f"/api/v1/orders/{order.id}/download/")

        self.assertEqual(response.status_code, http_status.HTTP_401_UNAUTHORIZED)

    def test_nonexistent_order_is_denied(self):
        customer, _, _ = make_paid_order_with_entitlements(target_ids=["print-png"])
        self._login_as(customer)

        response = self.client.get("/api/v1/orders/00000000-0000-0000-0000-000000000000/download/")
        self.assertEqual(response.status_code, http_status.HTTP_404_NOT_FOUND)

    def test_paid_order_with_no_entitlements_is_denied(self):
        customer, order, entitlements = make_paid_order_with_entitlements(target_ids=["print-png"])
        Entitlement.objects.filter(order=order).delete()
        self._login_as(customer)

        response = self.client.get(f"/api/v1/orders/{order.id}/download/")
        self.assertEqual(response.status_code, http_status.HTTP_404_NOT_FOUND)

    def test_digital_only_pack_reports_nothing_archivable(self):
        # A `__live__` entitlement resolves to a URL, which cannot be a
        # file inside a zip. Better to say so than to return an empty
        # archive the customer would have to puzzle over.
        customer, order, _ = make_paid_order_with_entitlements(target_ids=["__live__"])
        fake = _CapturingRenderer(DigitalDeliveryResult(url="https://example.test/live/abc"))
        self._login_as(customer)

        with patch.dict("apps.delivery.registry._REGISTRY", {order.product.slug: fake}):
            response = self.client.get(f"/api/v1/orders/{order.id}/download/")

        self.assertEqual(response.status_code, http_status.HTTP_501_NOT_IMPLEMENTED)

    def test_digital_only_pack_is_rejected_before_any_streaming_starts(self):
        # `_iter_pack_archive` is a generator: once a StreamingHttpResponse
        # has yielded even one chunk, its 200 status is already committed
        # and "nothing archivable" can no longer become a clean 501 (see
        # `pack_has_archivable_entitlements` in services.py). This proves
        # the check runs — and rejects — BEFORE that commitment, not as
        # part of the stream.
        #
        # Deliberately does NOT patch the registry with a fake renderer,
        # unlike the sibling test above: `make_product()` gives the order
        # an unregistered slug, so `get_renderer` would resolve to
        # `NotImplementedRenderer`, which always raises. If the pre-check
        # were missing or broken and this fell through to rendering, the
        # test would see a broken/mid-stream failure instead of a clean
        # synchronous 501 — that's the failure mode this guards against.
        customer, order, _ = make_paid_order_with_entitlements(target_ids=["__live__"])
        self._login_as(customer)

        response = self.client.get(f"/api/v1/orders/{order.id}/download/")

        self.assertEqual(response.status_code, http_status.HTTP_501_NOT_IMPLEMENTED)
        self.assertNotIsInstance(response, StreamingHttpResponse)

    def test_repeated_downloads_are_allowed_and_identical(self):
        # Delivery is render-on-demand, so a customer re-downloading
        # their keepsake must keep working indefinitely.
        customer, order, _ = make_paid_order_with_entitlements(target_ids=["story-png"])
        self._login_as(customer)

        with patch.dict("apps.delivery.registry._REGISTRY", {order.product.slug: self._multi_renderer()}):
            first = self.client.get(f"/api/v1/orders/{order.id}/download/")
            first_content = self._streamed_content(first)
            second = self.client.get(f"/api/v1/orders/{order.id}/download/")
            second_content = self._streamed_content(second)

        self.assertEqual(first.status_code, http_status.HTTP_200_OK)
        self.assertEqual(second.status_code, http_status.HTTP_200_OK)
        self.assertEqual(
            zipfile.ZipFile(io.BytesIO(first_content)).read("story-png.png"),
            zipfile.ZipFile(io.BytesIO(second_content)).read("story-png.png"),
        )

    def test_response_is_never_cached_and_exposes_no_storage_key(self):
        customer, order, _ = make_paid_order_with_entitlements(target_ids=["story-png"])
        self._login_as(customer)

        with patch.dict("apps.delivery.registry._REGISTRY", {order.product.slug: self._multi_renderer()}):
            response = self.client.get(f"/api/v1/orders/{order.id}/download/")
            content = self._streamed_content(response)

        self.assertEqual(response["Cache-Control"], "private, no-store")
        # The archive is bytes; no R2 key, bucket or signed URL is ever
        # handed to the browser.
        for leak in [b"r2", b"amazonaws", b"storage_key", b"X-Amz"]:
            self.assertNotIn(leak, content)

    def test_response_has_no_content_length_declared_upfront(self):
        # The archive's final size depends on how well each entry
        # compresses, which isn't known until every entry is written —
        # a StreamingHttpResponse correctly never sets Content-Length,
        # and the frontend's fetch()+blob() must not depend on one
        # being present (see lib/api/delivery.ts).
        customer, order, _ = make_paid_order_with_entitlements(target_ids=["story-png"])
        self._login_as(customer)

        with patch.dict("apps.delivery.registry._REGISTRY", {order.product.slug: self._multi_renderer()}):
            response = self.client.get(f"/api/v1/orders/{order.id}/download/")
            self.assertIsInstance(response, StreamingHttpResponse)
            self.assertFalse(response.has_header("Content-Length"))
            # The archive is still fully readable end to end.
            content = self._streamed_content(response)

        archive = zipfile.ZipFile(io.BytesIO(content))
        self.assertIn("story-png.png", archive.namelist())

    def test_render_failure_after_bytes_already_sent_aborts_without_a_valid_archive(self):
        # A render failure on the SECOND of two purchased targets, once
        # the first has already been written and yielded: the old
        # (buffered) view would have failed before any bytes reached the
        # client, and streaming must reproduce the same "the customer
        # gets nothing usable" outcome rather than silently handing back
        # a zip with one file missing and a valid-looking table of
        # contents.
        customer, order, _ = make_paid_order_with_entitlements(target_ids=["story-png", "portrait-png"])
        self._login_as(customer)

        class _FailsOnSecondRender:
            def __init__(self):
                self.calls = 0

            def render(self, project, delivery_type, delivery_pack, target_id, locale="en"):
                self.calls += 1
                if self.calls > 1:
                    raise RuntimeError("renderer exploded")
                return TemporaryFileResult(
                    content=b"bytes-for-first", content_type="image/png", filename="first.png"
                )

        with patch.dict("apps.delivery.registry._REGISTRY", {order.product.slug: _FailsOnSecondRender()}):
            response = self.client.get(f"/api/v1/orders/{order.id}/download/")
            # Status/headers are already committed to a 200 by the time
            # the view returns — there is no HTTP-level signal left to
            # flip to an error, which is exactly why this must abort
            # instead of finishing cleanly.
            self.assertEqual(response.status_code, http_status.HTTP_200_OK)

            with self.assertRaises(RuntimeError):
                b"".join(response.streaming_content)


class PrintSizeAndMountingTests(SimpleTestCase):
    """§2/§3 — the sizing model and the frame-safe margin.

    These numbers are duplicated in `src/lib/studio/print-sizes.ts`. That
    duplication is deliberate (the renderer cannot import TypeScript), which
    is exactly why both sides assert them: a change to one without the other
    fails here or in the frontend suite rather than producing files whose
    dimensions disagree with what the storefront promised.
    """

    def test_every_size_is_offered_in_both_mountings(self):
        from apps.delivery.print_sizes import MOUNTINGS, PRINT_SIZES, all_print_target_ids

        ids = all_print_target_ids()
        self.assertEqual(len(ids), len(PRINT_SIZES) * len(MOUNTINGS))
        for size_id in PRINT_SIZES:
            for mounting in MOUNTINGS:
                self.assertIn(f"print-{size_id}-{mounting}", ids)

    def test_sizes_match_their_stated_ratios(self):
        from apps.delivery.print_sizes import PRINT_SIZES

        ratios = {size: h / w for size, (w, h) in PRINT_SIZES.items()}
        self.assertAlmostEqual(ratios["a4"], 1.414, places=2)      # 1:root-2
        self.assertAlmostEqual(ratios["classic"], 1.25, places=2)  # 4:5, 8x10
        self.assertAlmostEqual(ratios["poster"], 1.5, places=2)    # 2:3, 12x18

    def test_safe_margin_clears_a_standard_frame_lip(self):
        from apps.delivery.print_sizes import PRINT_DPI, edged_margin_px

        # A standard frame rabbet covers about 1/4 inch. The margin must be
        # comfortably more than that, or the whole point is lost.
        quarter_inch = PRINT_DPI // 4
        self.assertGreaterEqual(edged_margin_px(), quarter_inch * 2)

    def test_print_targets_keep_the_prefix_delivery_typing_relies_on(self):
        from apps.delivery.print_sizes import all_print_target_ids
        from apps.delivery.delivery_types import DeliveryType, infer_delivery_type

        for target_id in all_print_target_ids():
            self.assertTrue(target_id.startswith("print-"))
            # Classified correctly even through a bundle pack, which has no
            # delivery type of its own and falls back to the prefix.
            self.assertEqual(
                infer_delivery_type(target_id=target_id, delivery_pack_slug="complete"),
                DeliveryType.PRINTABLE,
            )

    def test_parse_rejects_legacy_and_unknown_ids(self):
        from apps.delivery.print_sizes import parse_print_target

        self.assertEqual(parse_print_target("print-a4-edged"), ("a4", "edged"))
        self.assertEqual(parse_print_target("print-poster-frameless"), ("poster", "frameless"))
        self.assertIsNone(parse_print_target("print-png"))
        self.assertIsNone(parse_print_target("__live__"))
        self.assertIsNone(parse_print_target("print-a2-holographic"))

    def test_legacy_targets_still_render(self):
        from apps.delivery.product_renderers.love_story_timeline.png_renderer import TARGET_DIMENSIONS

        # Entitlements from orders placed before this model name these.
        for legacy in ("print-png", "story-png", "square-png", "landscape-png", "portrait-png"):
            self.assertIn(legacy, TARGET_DIMENSIONS)

    def test_new_targets_have_dimensions(self):
        from apps.delivery.print_sizes import all_print_target_ids
        from apps.delivery.product_renderers.love_story_timeline.png_renderer import TARGET_DIMENSIONS

        for target_id in all_print_target_ids():
            self.assertIn(target_id, TARGET_DIMENSIONS)


class LiveExperienceDispatchTests(TestCase):
    """`LiveExperienceView`'s product dispatch, added when Song Poster's
    own digital keepsake was built — `_load_paid_experience` extracted
    from `ar_views._load_experience` so this and the AR endpoint share
    one security-checked lookup, `_build_ar_payload` extracted as Love
    Story Timeline's own unchanged payload shape, `_build_song_poster_
    live_payload` new.

    THE UNPAID/INACCESSIBLE/UNKNOWN-ID CASES ARE THE ONES THAT MATTER
    MOST HERE — this endpoint has no session, so the URL itself is the
    only access control, and every one of those must return the exact
    same generic 404 an unknown id does (§21f). The refactor this class
    exists to prove correct moved code across three functions instead
    of one; these are the cases where a mistake would be a real access
    control bug, not a cosmetic one.
    """

    def setUp(self):
        self.client = APIClient()

    def _make_live_experience(self, *, product_slug: str, project_data: dict, order_status=Order.STATUS_PAID):
        customer, order, entitlements = make_paid_order_with_entitlements(
            target_ids=[LIVE_TARGET_SENTINEL],
            product=make_product(slug=product_slug),
        )
        order.project.data = project_data
        order.project.save(update_fields=["data"])
        if order_status != Order.STATUS_PAID:
            order.status = order_status
            order.save(update_fields=["status"])
        experience = PublicExperience.objects.get(entitlement__order=order, kind=PublicExperience.KIND_LIVE)
        return customer, order, experience

    def test_song_poster_order_gets_the_song_poster_shaped_payload(self):
        _, _, experience = self._make_live_experience(
            product_slug="song-poster",
            project_data={
                "values": {
                    "track": "Halfway Home",
                    "artist": "The Landing",
                    "dedication": "For every long drive.",
                    "photo": {"assetId": "asset-does-not-need-to-resolve-for-this-assertion"},
                    "youtubeUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                    "youtubeVideoId": "dQw4w9WgXcQ",
                },
                # A print theme IS selected, deliberately, to prove it
                # does not leak into the response — Song Poster's own
                # digital keepsake is independent of it.
                "themeSelections": {"theme": "ledger"},
            },
        )

        response = self.client.get(f"/api/v1/live/{experience.id}/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response.data["values"]["track"], "Halfway Home")
        self.assertEqual(response.data["values"]["youtubeVideoId"], "dQw4w9WgXcQ")
        # The AR-shaped fields (`scene`, `level`, `targetUrl`) must be
        # ABSENT, not merely null — their presence would mean the
        # dispatch silently fell through to the AR/LST payload builder.
        self.assertNotIn("scene", response.data)
        self.assertNotIn("level", response.data)
        self.assertNotIn("targetUrl", response.data)
        self.assertNotIn("theme", response.data["values"])

    def test_love_story_timeline_order_still_gets_the_original_ar_shaped_payload(self):
        """The regression check for the refactor itself: an LST order's
        live page must be BYTE-IDENTICAL in shape to before
        `_load_experience` was split into three functions."""
        _, _, experience = self._make_live_experience(
            product_slug="love-story-timeline",
            project_data={"values": {"title": "Our Story"}, "themeSelections": {"palette": "warm"}},
        )

        response = self.client.get(f"/api/v1/live/{experience.id}/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertIn("scene", response.data)
        self.assertIn("level", response.data)
        self.assertIn("targetUrl", response.data)
        self.assertIn("media", response.data)

    def test_unpaid_order_returns_the_same_generic_404_as_an_unknown_id(self):
        _, _, experience = self._make_live_experience(
            product_slug="song-poster",
            project_data={"values": {"track": "T", "artist": "A"}, "themeSelections": {}},
            order_status=Order.STATUS_PENDING,
        )

        response = self.client.get(f"/api/v1/live/{experience.id}/")
        unknown_response = self.client.get(f"/api/v1/live/{uuid.uuid4()}/")

        self.assertEqual(response.status_code, http_status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.data, unknown_response.data)

    def test_an_ar_id_used_on_the_live_route_is_indistinguishable_from_unknown(self):
        """§21f's own requirement, re-checked against the refactored
        code specifically: the `kind` filter must still be enforced at
        the query level, not after, or a wrong-kind id would produce
        different behaviour from a truly unknown one."""
        customer, order, entitlements = make_paid_order_with_entitlements(
            target_ids=["ar-card"], product=make_product(slug="love-story-timeline")
        )
        ar_experience = PublicExperience.objects.create(
            entitlement=entitlements[0], kind=PublicExperience.KIND_AR, status=PublicExperience.STATUS_ACTIVE
        )

        response = self.client.get(f"/api/v1/live/{ar_experience.id}/")
        unknown_response = self.client.get(f"/api/v1/live/{uuid.uuid4()}/")

        self.assertEqual(response.status_code, http_status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.data, unknown_response.data)


class MilestoneMediaResolutionTests(TestCase):
    """A milestone's recorded voice note (and video) must actually be
    loadable on the live keepsake page, not merely present in the payload
    as an opaque id.

    `_build_ar_payload` used to hand back `event.audio_asset_id`/
    `event.video_asset_id` verbatim, on the promise that "the client
    resolves those through the same ownership-checked path as everything
    else" — no such client-side path ever existed anywhere in either repo:
    `live-keepsake.tsx` and `ar-scene.tsx` both assigned the bare id
    straight to a media element's `src`, which a browser cannot load
    anything from. A customer's recorded voice note reached this payload
    correctly and then had nowhere to play from. These pin the fix: the
    payload must carry an actual, ownership-checked, freshly-generated
    URL — the same `get_asset_for_customer` + `generate_asset_access_url`
    pattern `_build_song_poster_live_payload` already used for its own
    photo.
    """

    def setUp(self):
        self.client = APIClient()

    def _make_lst_live_experience(self, *, customer, events):
        _, order, _ = make_paid_order_with_entitlements(
            target_ids=[LIVE_TARGET_SENTINEL],
            product=make_product(slug="love-story-timeline"),
            customer=customer,
        )
        order.project.data = {
            "version": 1,
            "values": {
                "storyType": "couple",
                "people": [{"name": "Alex"}, {"name": "Sam"}],
                "events": events,
            },
            "themeSelections": {},
        }
        order.project.save(update_fields=["data"])
        return PublicExperience.objects.get(entitlement__order=order, kind=PublicExperience.KIND_LIVE)

    #: §4 — `_validate_events` rejects anything outside 3-8 items, so every
    #: fixture below needs three, even though only one carries the media
    #: under test.
    def _events(self, middle: dict) -> list[dict]:
        return [
            {"date": "2019-04-12", "title": "We met", "photo": {"assetId": "photo-0"}},
            middle,
            {"date": "2022-09-03", "title": "He proposed", "photo": {"assetId": "photo-2"}},
        ]

    def test_milestone_audio_resolves_to_a_loadable_url_not_the_bare_id(self):
        customer = make_customer()
        audio_asset = make_asset(customer=customer, mime_type="audio/mp4")
        experience = self._make_lst_live_experience(
            customer=customer,
            events=self._events(
                {
                    "date": "2020-06-20",
                    "title": "First trip together",
                    "photo": {"assetId": "photo-1"},
                    "audio": {"assetId": str(audio_asset.id)},
                }
            ),
        )

        response = self.client.get(f"/api/v1/live/{experience.id}/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        resolved = response.data["media"]["milestones"][1]["audio"]
        self.assertIsNotNone(resolved)
        # Not the bare id any more — an id is what browsers COULDN'T load.
        self.assertNotEqual(resolved, str(audio_asset.id))
        # And it is genuinely the mock backend's access URL for THIS
        # asset's own storage key, not merely some other string.
        self.assertIn(audio_asset.storage_key, resolved)

    def test_milestone_video_resolves_the_same_way(self):
        customer = make_customer()
        video_asset = make_asset(customer=customer, mime_type="video/mp4")
        experience = self._make_lst_live_experience(
            customer=customer,
            events=self._events(
                {
                    "date": "2020-06-20",
                    "title": "First trip together",
                    "photo": {"assetId": "photo-1"},
                    "video": {"assetId": str(video_asset.id)},
                }
            ),
        )

        response = self.client.get(f"/api/v1/live/{experience.id}/")

        resolved = response.data["media"]["milestones"][1]["video"]
        self.assertIsNotNone(resolved)
        self.assertNotEqual(resolved, str(video_asset.id))
        self.assertIn(video_asset.storage_key, resolved)

    def test_a_milestone_with_no_audio_stays_null_rather_than_erroring(self):
        customer = make_customer()
        experience = self._make_lst_live_experience(
            customer=customer,
            events=self._events(
                {"date": "2020-06-20", "title": "First trip together", "photo": {"assetId": "photo-1"}}
            ),
        )

        response = self.client.get(f"/api/v1/live/{experience.id}/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertIsNone(response.data["media"]["milestones"][1]["audio"])

    def test_an_asset_owned_by_another_customer_resolves_to_null_not_a_leak(self):
        """Ownership is still enforced through the resolution: a stale or
        tampered asset reference must not hand back a stranger's file, the
        same guarantee `get_asset_for_customer` gives every other caller.
        """
        owner = make_customer()
        stranger_asset = make_asset(customer=make_customer(), mime_type="audio/mp4")
        experience = self._make_lst_live_experience(
            customer=owner,
            events=self._events(
                {
                    "date": "2020-06-20",
                    "title": "First trip together",
                    "photo": {"assetId": "photo-1"},
                    "audio": {"assetId": str(stranger_asset.id)},
                }
            ),
        )

        response = self.client.get(f"/api/v1/live/{experience.id}/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertIsNone(response.data["media"]["milestones"][1]["audio"])

    def test_the_ar_route_resolves_the_same_media_the_live_route_does(self):
        """`_build_ar_payload` is shared by both routes — this is the
        dispatch the AR page itself hits, not just the Live page's own
        reuse of it."""
        customer = make_customer()
        audio_asset = make_asset(customer=customer, mime_type="audio/mp4")
        _, order, _ = make_paid_order_with_entitlements(
            target_ids=["ar-card"],
            product=make_product(slug="love-story-timeline"),
            customer=customer,
        )
        order.project.data = {
            "version": 1,
            "values": {
                "storyType": "couple",
                "people": [{"name": "Alex"}, {"name": "Sam"}],
                "events": self._events(
                    {
                        "date": "2020-06-20",
                        "title": "First trip together",
                        "photo": {"assetId": "photo-1"},
                        "audio": {"assetId": str(audio_asset.id)},
                    }
                ),
            },
            "themeSelections": {},
        }
        order.project.save(update_fields=["data"])
        entitlement = order.entitlements.get(target_id="ar-card")
        ar_experience = PublicExperience.objects.create(
            entitlement=entitlement, kind=PublicExperience.KIND_AR, status=PublicExperience.STATUS_ACTIVE
        )

        response = self.client.get(f"/api/v1/ar/{ar_experience.id}/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        resolved = response.data["media"]["milestones"][1]["audio"]
        self.assertNotEqual(resolved, str(audio_asset.id))
        self.assertIn(audio_asset.storage_key, resolved)

    #: §10/§14 regression — a milestone's PHOTO must get the same
    #: fresh-URL treatment the four tests above already pin for
    #: video/audio. `_build_ar_payload` used to hand `values` back
    #: byte-for-byte from `project.data`, trusting whatever `photo.url`
    #: was last persisted there. `lib/studio/media-values.ts`'s own
    #: documented lifecycle (`UPLOADED`: `{url: blob:…, mimeType,
    #: filename, assetId}`, written as an immediate local preview while
    #: the real upload is still in flight) means that stored value can
    #: be a `blob:` URL — scoped to the browser tab that created it, and
    #: never valid for anyone else, from the moment it is saved, not
    #: merely stale the way an expired presigned URL is. Found via a
    #: real sandbox order whose live page served exactly this: photos
    #: that failed to load for every visitor because the payload handed
    #: back a `blob:` string no browser but the one that made it could
    #: ever resolve.
    def test_milestone_photo_resolves_to_a_fresh_url_not_the_stale_stored_one(self):
        customer = make_customer()
        photo_asset = make_asset(
            customer=customer, mime_type="image/webp", storage_key=f"assets/{uuid.uuid4().hex}.webp"
        )
        stale_blob_url = "blob:http://localhost:3000/stale-preview-id"
        experience = self._make_lst_live_experience(
            customer=customer,
            events=self._events(
                {
                    "date": "2020-06-20",
                    "title": "First trip together",
                    "photo": {
                        "assetId": str(photo_asset.id),
                        "url": stale_blob_url,
                        "filename": "preview.webp",
                        "mimeType": "image/webp",
                    },
                }
            ),
        )

        response = self.client.get(f"/api/v1/live/{experience.id}/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        resolved = response.data["values"]["events"][1]["photo"]["url"]
        # Not the stale stored value — a `blob:` URL from one browser's tab
        # can never be valid for another visitor at all, unlike a merely
        # expired presigned URL, so this is the sharpest possible proof the
        # stored value is never trusted.
        self.assertNotEqual(resolved, stale_blob_url)
        self.assertIn(photo_asset.storage_key, resolved)

    def test_a_milestone_with_an_unresolvable_photo_asset_id_has_no_photo_rather_than_erroring(self):
        # `photo.assetId` is a REQUIRED field per event (§7's own validation
        # — unlike audio/video, Love Story Timeline has no "milestone with
        # no photo at all" shape), so this uses a placeholder, non-UUID
        # value — the same shape the `_events` fixture already uses for
        # its two non-middle events (`"photo-0"`/`"photo-2"`) — rather than
        # omitting `photo` entirely, which fails validation before this
        # code path is even reached.
        customer = make_customer()
        experience = self._make_lst_live_experience(
            customer=customer,
            events=self._events(
                {"date": "2020-06-20", "title": "First trip together", "photo": {"assetId": "not-a-real-asset"}}
            ),
        )

        response = self.client.get(f"/api/v1/live/{experience.id}/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertNotIn("photo", response.data["values"]["events"][1])

    def test_a_photo_owned_by_another_customer_resolves_to_no_photo_not_a_leak(self):
        """Same guarantee `test_an_asset_owned_by_another_customer_resolves_to_null_not_a_leak`
        already pins for audio: ownership is still enforced through
        resolution, so a stale or tampered asset reference cannot hand back
        a stranger's file."""
        owner = make_customer()
        stranger_asset = make_asset(customer=make_customer(), mime_type="image/webp")
        experience = self._make_lst_live_experience(
            customer=owner,
            events=self._events(
                {
                    "date": "2020-06-20",
                    "title": "First trip together",
                    "photo": {"assetId": str(stranger_asset.id), "url": "blob:http://localhost:3000/stale"},
                }
            ),
        )

        response = self.client.get(f"/api/v1/live/{experience.id}/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertNotIn("photo", response.data["values"]["events"][1])

    def test_the_ar_route_resolves_photos_the_same_way_the_live_route_does(self):
        """`_build_ar_payload` is shared by both routes — this is the
        dispatch the AR page itself hits, not just the Live page's own
        reuse of it, mirroring `test_the_ar_route_resolves_the_same_media_the_live_route_does`
        above for photo instead of audio."""
        customer = make_customer()
        photo_asset = make_asset(customer=customer, mime_type="image/webp")
        stale_blob_url = "blob:http://localhost:3000/stale"
        _, order, _ = make_paid_order_with_entitlements(
            target_ids=["ar-card"],
            product=make_product(slug="love-story-timeline"),
            customer=customer,
        )
        order.project.data = {
            "version": 1,
            "values": {
                "storyType": "couple",
                "people": [{"name": "Alex"}, {"name": "Sam"}],
                "events": self._events(
                    {
                        "date": "2020-06-20",
                        "title": "First trip together",
                        "photo": {"assetId": str(photo_asset.id), "url": stale_blob_url},
                    }
                ),
            },
            "themeSelections": {},
        }
        order.project.save(update_fields=["data"])
        entitlement = order.entitlements.get(target_id="ar-card")
        ar_experience = PublicExperience.objects.create(
            entitlement=entitlement, kind=PublicExperience.KIND_AR, status=PublicExperience.STATUS_ACTIVE
        )

        response = self.client.get(f"/api/v1/ar/{ar_experience.id}/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        resolved = response.data["values"]["events"][1]["photo"]["url"]
        self.assertNotEqual(resolved, stale_blob_url)
        self.assertIn(photo_asset.storage_key, resolved)


#: Copied from `product_renderers/song_poster/tests.py`'s own `VALID_VALUES`
#: rather than imported — that module's fixture is private to its own test
#: file, and duplicating one small literal dict is cheaper than reaching
#: across test modules for it.
_VALID_SONG_POSTER_VALUES = {
    "track": "Halfway Home",
    "artist": "The Landing",
    "dedication": "For every long drive that led back to you.",
    "photo": {"assetId": "asset-1"},
    "youtubeUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "youtubeVideoId": "dQw4w9WgXcQ",
}


class RecipientQrCardTests(TestCase):
    """§18d's second card — a RECIPIENT-facing QR pointing at the live
    keepsake instead of the order page, plus the per-order caption
    (names/title) layered onto both the buyer's and the recipient's card.

    `OrderQrCardView`/`OrderLiveCardsDownloadView` (the buyer's card) are
    not re-tested here — they are unchanged in behaviour, only in which
    private helper they call, and the full suite running clean is already
    that proof.
    """

    def setUp(self):
        self.client = APIClient()

    def _lst_order(self, *, with_project=True):
        customer, order, _ = make_paid_order_with_entitlements(
            target_ids=[LIVE_TARGET_SENTINEL],
            product=make_product(slug="love-story-timeline"),
            with_project=with_project,
        )
        login_as_guest(self.client, email=customer.email)
        return order

    def _set_lst_data(self, order, *, people=None, poster_title=""):
        order.project.data = {
            "version": 1,
            "values": {
                "storyType": "couple",
                "people": [{"name": n} for n in (people or [])],
                "posterTitle": poster_title,
                "events": [
                    {"date": "2019-04-12", "title": "We met", "photo": {"assetId": "photo-0"}},
                    {"date": "2020-06-20", "title": "Trip", "photo": {"assetId": "photo-1"}},
                    {"date": "2022-09-03", "title": "Proposal", "photo": {"assetId": "photo-2"}},
                ],
            },
            "themeSelections": {},
        }
        order.project.save(update_fields=["data"])
        order.refresh_from_db()

    # ---- URL resolution -------------------------------------------------

    def test_recipient_and_buyer_cards_encode_genuinely_different_urls(self):
        """The one property that makes this a separate card at all: the
        recipient's QR must open the live page, never the order page, and
        vice versa."""
        from apps.delivery.bonuses import _order_access_url, _recipient_live_url

        order = self._lst_order()
        self._set_lst_data(order, people=["Emma", "James"])

        buyer_url = _order_access_url(order)
        recipient_url = _recipient_live_url(order)

        self.assertIn(f"/orders/{order.id}/", buyer_url)
        self.assertNotIn("/live/", buyer_url)
        self.assertIn("/live/", recipient_url)
        self.assertNotIn("/orders/", recipient_url)

    def test_recipient_qr_route_serves_a_png(self):
        order = self._lst_order()
        self._set_lst_data(order, people=["Emma", "James"])

        response = self.client.get(f"/api/v1/orders/{order.id}/qr/recipient/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "image/png")
        self.assertTrue(response.content.startswith(b"\x89PNG\r\n\x1a\n"))

    def test_recipient_qr_route_404s_without_a_live_entitlement(self):
        customer, order, _ = make_paid_order_with_entitlements(
            target_ids=["print-a4-edged"], product=make_product(slug="love-story-timeline")
        )
        login_as_guest(self.client, email=customer.email)

        response = self.client.get(f"/api/v1/orders/{order.id}/qr/recipient/")

        self.assertEqual(response.status_code, http_status.HTTP_404_NOT_FOUND)

    def test_the_live_cards_zip_carries_both_the_buyers_and_the_recipients_cards(self):
        """One zip, both audiences: the buyer's three designs and the
        recipient's three (there is no separate recipient zip any more)."""
        order = self._lst_order()
        self._set_lst_data(order, people=["Emma", "James"])

        response = self.client.get(f"/api/v1/orders/{order.id}/download/live-cards/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        archive = zipfile.ZipFile(io.BytesIO(response.content))
        self.assertEqual(
            sorted(archive.namelist()),
            [
                "live-page-qr-cream.png",
                "live-page-qr-recipient-cream.png",
                "live-page-qr-recipient-tag.png",
                "live-page-qr-recipient.png",
                "live-page-qr-tag.png",
                "live-page-qr.png",
            ],
        )
        # Two genuinely different cards, not the same card under two names.
        self.assertNotEqual(archive.read("live-page-qr.png"), archive.read("live-page-qr-recipient.png"))

    # ---- caption customization -------------------------------------------

    def test_caption_is_the_couples_joined_names_when_there_is_no_poster_title(self):
        order = self._lst_order()
        self._set_lst_data(order, people=["Emma", "James"])

        self.assertEqual(_qr_caption_for_order(order), "Emma & James")

    def test_caption_prefers_the_poster_title_when_the_buyer_set_one(self):
        order = self._lst_order()
        self._set_lst_data(order, people=["Emma", "James"], poster_title="Our Love Story")

        self.assertEqual(_qr_caption_for_order(order), "Our Love Story")

    def test_caption_for_song_poster_combines_artist_and_track(self):
        customer, order, _ = make_paid_order_with_entitlements(
            target_ids=[LIVE_TARGET_SENTINEL], product=make_product(slug="song-poster")
        )
        order.project.data = {"version": 1, "values": _VALID_SONG_POSTER_VALUES, "themeSelections": {}}
        order.project.save(update_fields=["data"])
        order.refresh_from_db()

        self.assertEqual(_qr_caption_for_order(order), "The Landing — Halfway Home")

    def test_caption_falls_back_to_none_without_a_project(self):
        order = self._lst_order(with_project=False)

        self.assertIsNone(_qr_caption_for_order(order))

    def test_caption_falls_back_to_none_when_the_project_data_fails_validation(self):
        order = self._lst_order()
        # No `events` at all — fails Love Story Timeline's own MIN_EVENTS
        # check. The caption helper must degrade to the generic default
        # rather than raising and breaking the whole card download.
        order.project.data = {
            "version": 1,
            "values": {"storyType": "couple", "people": [{"name": "Emma"}]},
            "themeSelections": {},
        }
        order.project.save(update_fields=["data"])
        order.refresh_from_db()

        self.assertIsNone(_qr_caption_for_order(order))

    def test_caption_falls_back_to_none_for_a_product_with_no_branch(self):
        order = self._lst_order(with_project=False)
        order.product = make_product(slug="heart-map")
        order.save(update_fields=["product"])

        self.assertIsNone(_qr_caption_for_order(order))


class DeliveryUrlRoutingTests(SimpleTestCase):
    """§12 — same token-to-path-segment change as commerce/urls.py, on the
    entitlement and order-pack download routes. These two didn't have the
    literal-word-collision risk commerce/urls.py did (both routes share a
    required "download/" prefix before the optional token, so there's no
    ambiguous shorter literal segment for the token pattern to swallow) —
    still worth a direct check rather than assumed safe by resemblance."""

    def test_a_bare_entitlement_download_resolves_with_no_token(self):
        from django.urls import resolve

        entitlement_id = uuid.uuid4()
        match = resolve(f"/api/v1/entitlements/{entitlement_id}/download/")
        self.assertEqual(match.view_name, "delivery:entitlement-download")
        self.assertEqual(match.kwargs.get("token"), None)

    def test_an_entitlement_download_with_a_token_resolves_correctly(self):
        from django.urls import resolve

        entitlement_id = uuid.uuid4()
        match = resolve(f"/api/v1/entitlements/{entitlement_id}/download/sometoken123/")
        self.assertEqual(match.view_name, "delivery:entitlement-download-token")
        self.assertEqual(match.kwargs.get("token"), "sometoken123")

    def test_a_bare_order_pack_download_resolves_with_no_token(self):
        from django.urls import resolve

        order_id = uuid.uuid4()
        match = resolve(f"/api/v1/orders/{order_id}/download/")
        self.assertEqual(match.view_name, "delivery:order-pack-download")
        self.assertEqual(match.kwargs.get("token"), None)

    def test_an_order_pack_download_with_a_token_resolves_correctly(self):
        from django.urls import resolve

        order_id = uuid.uuid4()
        match = resolve(f"/api/v1/orders/{order_id}/download/anothertoken456/")
        self.assertEqual(match.view_name, "delivery:order-pack-download-token")
        self.assertEqual(match.kwargs.get("token"), "anothertoken456")

    # §14 regression — unlike entitlement-download vs order-pack-download
    # above, these four DO share the collision risk this class's docstring
    # describes: each category route is "download/" plus its own literal
    # word ("bonuses", "live-cards", "printable", "wallpapers"), which is
    # exactly the shape `orders/<uuid:order_id>/download/<str:token>/`
    # (the whole-pack download's own token route) also matches. Listing
    # that generic route before these four meant every category download
    # resolved to `OrderPackDownloadView` with the category name bound as
    # `token`, which then failed signature verification and raised
    # `order_not_found` — a 404 reporting the wrong problem, for every
    # provider's paid orders alike, not just Freemius's. Caught only by a
    # real browser hitting these buttons; no prior test resolved the
    # literal path for any of the four. One case per route, bare and
    # tokened, so a future reordering regresses a specific assertion
    # instead of a vague "downloads broke somewhere."
    def test_a_bare_printable_download_resolves_to_the_printable_view(self):
        from django.urls import resolve

        order_id = uuid.uuid4()
        match = resolve(f"/api/v1/orders/{order_id}/download/printable/")
        self.assertEqual(match.view_name, "delivery:order-download-printable")
        self.assertEqual(match.kwargs.get("token"), None)

    def test_a_tokened_printable_download_resolves_correctly(self):
        from django.urls import resolve

        order_id = uuid.uuid4()
        match = resolve(f"/api/v1/orders/{order_id}/download/printable/sometoken/")
        self.assertEqual(match.view_name, "delivery:order-download-printable-token")
        self.assertEqual(match.kwargs.get("token"), "sometoken")

    def test_a_bare_wallpapers_download_resolves_to_the_wallpapers_view(self):
        from django.urls import resolve

        order_id = uuid.uuid4()
        match = resolve(f"/api/v1/orders/{order_id}/download/wallpapers/")
        self.assertEqual(match.view_name, "delivery:order-download-wallpapers")
        self.assertEqual(match.kwargs.get("token"), None)

    def test_a_tokened_wallpapers_download_resolves_correctly(self):
        from django.urls import resolve

        order_id = uuid.uuid4()
        match = resolve(f"/api/v1/orders/{order_id}/download/wallpapers/sometoken/")
        self.assertEqual(match.view_name, "delivery:order-download-wallpapers-token")
        self.assertEqual(match.kwargs.get("token"), "sometoken")

    def test_a_bare_live_cards_download_resolves_to_the_live_cards_view(self):
        from django.urls import resolve

        order_id = uuid.uuid4()
        match = resolve(f"/api/v1/orders/{order_id}/download/live-cards/")
        self.assertEqual(match.view_name, "delivery:order-download-live-cards")
        self.assertEqual(match.kwargs.get("token"), None)

    def test_a_tokened_live_cards_download_resolves_correctly(self):
        from django.urls import resolve

        order_id = uuid.uuid4()
        match = resolve(f"/api/v1/orders/{order_id}/download/live-cards/sometoken/")
        self.assertEqual(match.view_name, "delivery:order-download-live-cards-token")
        self.assertEqual(match.kwargs.get("token"), "sometoken")

    def test_a_bare_bonuses_download_resolves_to_the_bonuses_view(self):
        from django.urls import resolve

        order_id = uuid.uuid4()
        match = resolve(f"/api/v1/orders/{order_id}/download/bonuses/")
        self.assertEqual(match.view_name, "delivery:order-download-bonuses")
        self.assertEqual(match.kwargs.get("token"), None)

    def test_a_tokened_bonuses_download_resolves_correctly(self):
        from django.urls import resolve

        order_id = uuid.uuid4()
        match = resolve(f"/api/v1/orders/{order_id}/download/bonuses/sometoken/")
        self.assertEqual(match.view_name, "delivery:order-download-bonuses-token")
        self.assertEqual(match.kwargs.get("token"), "sometoken")

    # The recipient QR image route repeats the exact same literal-segment-vs-
    # `<str:token>` collision risk the tests above already pin —
    # `qr/recipient/` sits at the same depth as `qr/<str:token>/`. Same
    # reasoning, new route.
    def test_a_bare_recipient_qr_resolves_to_the_recipient_qr_view(self):
        from django.urls import resolve

        order_id = uuid.uuid4()
        match = resolve(f"/api/v1/orders/{order_id}/qr/recipient/")
        self.assertEqual(match.view_name, "delivery:order-qr-recipient")
        self.assertEqual(match.kwargs.get("token"), None)

    def test_a_tokened_recipient_qr_resolves_correctly(self):
        from django.urls import resolve

        order_id = uuid.uuid4()
        match = resolve(f"/api/v1/orders/{order_id}/qr/recipient/sometoken/")
        self.assertEqual(match.view_name, "delivery:order-qr-recipient-token")
        self.assertEqual(match.kwargs.get("token"), "sometoken")

    def test_the_bare_qr_token_route_still_resolves_and_is_not_swallowed(self):
        """Confirms adding `qr/recipient/` ahead of `qr/<str:token>/`
        didn't break the route it now sits in front of."""
        from django.urls import resolve

        order_id = uuid.uuid4()
        match = resolve(f"/api/v1/orders/{order_id}/qr/anothertoken/")
        self.assertEqual(match.view_name, "delivery:order-qr-token")
        self.assertEqual(match.kwargs.get("token"), "anothertoken")

    def test_the_retired_recipient_zip_route_no_longer_has_a_view_of_its_own(self):
        """The recipient's cards moved into the `live-cards` zip. An old link
        to `download/live-cards-recipient/` now falls through to the generic
        `<str:token>` route, where it is rejected as a bad token (404) — it
        must not resolve to a download view of its own, or to a 200."""
        from django.urls import resolve

        order_id = uuid.uuid4()
        match = resolve(f"/api/v1/orders/{order_id}/download/live-cards-recipient/")
        self.assertEqual(match.view_name, "delivery:order-pack-download-token")


@override_settings(RESEND_API_KEY="key", FRONTEND_URL="https://example.test")
class ReceiptEmailGiftQrTests(TestCase):
    """The receipt email's QR, end to end with REAL orders and the REAL
    renderers (the mocked unit tests live in `OrderEmailTests`): the inline
    image and the attachment are both the recipient's card, and a live
    experience that is not active removes the QR section instead of leaving a
    broken image box.
    """

    def setUp(self):
        self.product = make_product(slug="love-story-timeline")

    def _order(self):
        _, order, _ = make_paid_order_with_entitlements(target_ids=[LIVE_TARGET_SENTINEL], product=self.product)
        return order

    @staticmethod
    def _send(order):
        from apps.commerce.emails import send_order_confirmation

        response = MagicMock(status_code=200, text="{}")
        with patch("apps.commerce.emails.requests.post", return_value=response) as post:
            ok = send_order_confirmation(order)
        return ok, post.call_args.kwargs["json"]

    @staticmethod
    def _inline_src(payload):
        return re.search(r'<img src="([^"]+)"', payload["html"]).group(1)

    @staticmethod
    def _as_backend_path(src):
        # The email points at the frontend's same-origin proxy, which Next
        # rewrites to the API: `/api/backend/...` -> `/api/v1/...`.
        return src.split("https://example.test", 1)[1].replace("/api/backend/", "/api/v1/", 1)

    def test_inline_image_and_attachment_are_both_the_real_recipient_card(self):
        from apps.delivery.bonuses import render_live_qr_card, render_recipient_qr_card

        order = self._order()
        ok, payload = self._send(order)
        self.assertTrue(ok)

        [attachment] = payload["attachments"]
        self.assertEqual(attachment["filename"], "heartfolio-gift-qr.png")
        attached_png = base64.b64decode(attachment["content"])
        self.assertTrue(attached_png.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertEqual(attached_png, render_recipient_qr_card(order))
        # Genuinely different from the buyer's card (it encodes another URL).
        self.assertNotEqual(attached_png, render_live_qr_card(order))

        # Following the email's own inline image URL — with no session, only
        # the token in the path — serves that same card.
        response = APIClient().get(self._as_backend_path(self._inline_src(payload)))
        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "image/png")
        self.assertEqual(response.content, attached_png)

    def test_a_revoked_experience_removes_the_qr_section_from_the_email(self):
        order = self._order()
        experience = PublicExperience.objects.get(entitlement__order=order)
        experience.status = PublicExperience.STATUS_REVOKED
        experience.save(update_fields=["status"])

        self._assert_receipt_has_no_qr(order)

    def test_a_missing_experience_removes_the_qr_section_from_the_email(self):
        order = self._order()
        PublicExperience.objects.get(entitlement__order=order).delete()

        self._assert_receipt_has_no_qr(order)

    def _assert_receipt_has_no_qr(self, order):
        from apps.commerce.order_access import generate_order_access_token

        # WHY the section is omitted: this is what the recipient-card URL does
        # when the experience is not active — JSON, not an image. Left in the
        # email it would be a broken image box beside copy promising an
        # attachment that could not be made either.
        token = generate_order_access_token(order.id)
        broken = APIClient().get(f"/api/v1/orders/{order.id}/qr/recipient/{token}/")
        self.assertEqual(broken.status_code, http_status.HTTP_501_NOT_IMPLEMENTED)
        self.assertNotEqual(broken["Content-Type"], "image/png")

        ok, payload = self._send(order)

        self.assertTrue(ok, "the receipt must still be sent")
        self.assertNotIn("attachments", payload)
        self.assertNotIn("<img", payload["html"])
        self.assertNotIn("attached", payload["html"])
        self.assertNotIn("attached", payload["text"])
        self.assertNotIn("QR", payload["html"])
        self.assertNotIn("QR", payload["text"])
        self.assertIn("Open your order", payload["html"])
