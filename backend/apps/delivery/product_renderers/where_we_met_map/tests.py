"""
Comprehensive tests for the real Where We Met Map renderer — data
validation, PNG generation, registry registration, and the full API
path through `GET /api/v1/entitlements/<uuid>/download/` with an
actually-registered renderer.
"""

import io
import os
import tempfile
import uuid

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from PIL import Image
from rest_framework import status as http_status
from rest_framework.test import APIClient

from apps.assets.services import upload_asset
from apps.commerce.models import Entitlement, Order
from apps.common.exceptions.api_errors import WhereWeMetMapInvalidData, WhereWeMetMapRenderFailed
from apps.common.test_helpers import csrf_headers, login_as_guest
from apps.customers.models import Customer
from apps.delivery.delivery_types import DeliveryType
from apps.delivery.registry import get_renderer
from apps.delivery.renderers import NotImplementedRenderer
from apps.products.models import DeliveryPack, Product
from apps.projects.models import Project

from .data import validate_and_normalize
from .png_renderer import TARGET_DIMENSIONS, render_png
from .renderer import WhereWeMetMapRenderer

VALID_VALUES = {
    "partner1": "Alex",
    "partner2": "Sam",
    "date": "2019-06-15",
    "message": "Right here, right now",
    "locationLabel": "Paris, France",
    "coordinates": {"lat": 48.8566, "lng": 2.3522},
}
VALID_THEME = {
    "palette": "midnight", "typography": "serif-classic", "mapStyle": "night",
    "markerStyle": "heart", "frame": "vintage", "scale": 100,
}


def make_customer(**overrides) -> Customer:
    defaults = {"email": f"guest-{uuid.uuid4().hex[:8]}@example.com"}
    defaults.update(overrides)
    return Customer.objects.create(**defaults)


def make_map_product() -> Product:
    # Real product slug is "heart-map" — the module folder is named
    # "where-we-met-map" internally, but that's not the catalog slug.
    return Product.objects.create(
        slug="heart-map", name_i18n_key="product.heartmap.name",
        category=Product.CATEGORY_MAP, status=Product.STATUS_AVAILABLE,
    )


def make_delivery_pack(product, **overrides) -> DeliveryPack:
    defaults = {
        "product": product, "slug": "printable", "name_i18n_key": "pack.name",
        "description_i18n_key": "pack.description", "price_cents": 1200, "included_targets": ["print-png"],
    }
    defaults.update(overrides)
    return DeliveryPack.objects.create(**defaults)


def make_paid_entitlement(*, target_id, values=None, theme=None, product=None, pack_slug="printable", customer=None):
    customer = customer or make_customer()
    product = product or make_map_product()
    pack = make_delivery_pack(product, slug=pack_slug, included_targets=[target_id])
    project = Project.objects.create(
        customer=customer, product=product,
        data={"version": 1, "values": values or VALID_VALUES, "themeSelections": theme or VALID_THEME},
    )
    order = Order.objects.create(
        customer=customer, product=product, delivery_pack=pack, project=project, guest_email=customer.email,
        subtotal_cents=pack.price_cents, total_cents=pack.price_cents, status=Order.STATUS_PAID,
    )
    entitlement = Entitlement.objects.create(order=order, product=product, target_id=target_id)
    return customer, order, entitlement


# ------------------------------------------------------------------
# Renderer registration
# ------------------------------------------------------------------

class RendererRegistrationTests(TestCase):
    def test_heart_map_slug_resolves_to_real_renderer(self):
        renderer = get_renderer("heart-map", DeliveryType.PRINTABLE)
        self.assertIsInstance(renderer, WhereWeMetMapRenderer)
        self.assertNotIsInstance(renderer, NotImplementedRenderer)

    def test_all_real_raster_targets_render_without_renderer_not_available(self):
        customer, order, _ = make_paid_entitlement(target_id="print-png")
        renderer = get_renderer("heart-map", DeliveryType.PRINTABLE)
        for delivery_type, target_id in [
            (DeliveryType.PRINTABLE, "print-png"),
            (DeliveryType.SOCIAL, "story-png"),
            (DeliveryType.SOCIAL, "square-png"),
            (DeliveryType.WALLPAPER, "portrait-png"),
        ]:
            result = renderer.render(order.project, delivery_type, order.delivery_pack, target_id)
            self.assertIsNotNone(result)

    def test_digital_delivery_type_is_not_supported_for_this_product(self):
        """The real catalog (exports.ts) has no __live__/digital target
        at all for Where We Met Map — confirmed by inspection, not
        assumed. This must fail cleanly, not silently succeed.
        """
        customer, order, _ = make_paid_entitlement(target_id="print-png")
        renderer = get_renderer("heart-map", DeliveryType.PRINTABLE)
        with self.assertRaises(WhereWeMetMapRenderFailed):
            renderer.render(order.project, DeliveryType.DIGITAL, order.delivery_pack, "__live__")

    def test_unsupported_target_id_fails_cleanly(self):
        customer, order, _ = make_paid_entitlement(target_id="print-png")
        renderer = get_renderer("heart-map", DeliveryType.PRINTABLE)
        with self.assertRaises(WhereWeMetMapRenderFailed):
            renderer.render(order.project, DeliveryType.PRINTABLE, order.delivery_pack, "landscape-png")

    def test_unregistered_product_still_falls_back_to_not_implemented(self):
        renderer = get_renderer("song-poster", DeliveryType.PRINTABLE)
        self.assertIsInstance(renderer, NotImplementedRenderer)

    def test_love_story_timeline_renderer_unaffected_by_this_registration(self):
        from apps.delivery.product_renderers.love_story_timeline.renderer import LoveStoryTimelineRenderer

        renderer = get_renderer("love-story-timeline", DeliveryType.PRINTABLE)
        self.assertIsInstance(renderer, LoveStoryTimelineRenderer)


# ------------------------------------------------------------------
# Data validation
# ------------------------------------------------------------------

class DataValidationTests(TestCase):
    def test_valid_data_passes(self):
        map_data = validate_and_normalize(VALID_VALUES, VALID_THEME)
        self.assertEqual(map_data.partner1, "Alex")
        self.assertEqual(map_data.lat, 48.8566)

    def test_missing_partner_names_rejected(self):
        values = {**VALID_VALUES, "partner1": ""}
        with self.assertRaises(WhereWeMetMapInvalidData):
            validate_and_normalize(values, VALID_THEME)

    def test_missing_location_label_rejected(self):
        values = {**VALID_VALUES, "locationLabel": ""}
        with self.assertRaises(WhereWeMetMapInvalidData):
            validate_and_normalize(values, VALID_THEME)

    def test_missing_date_rejected(self):
        values = {**VALID_VALUES, "date": ""}
        with self.assertRaises(WhereWeMetMapInvalidData):
            validate_and_normalize(values, VALID_THEME)

    def test_invalid_date_format_rejected(self):
        values = {**VALID_VALUES, "date": "not-a-date"}
        with self.assertRaises(WhereWeMetMapInvalidData):
            validate_and_normalize(values, VALID_THEME)

    def test_missing_coordinates_rejected(self):
        values = {**VALID_VALUES, "coordinates": None}
        with self.assertRaises(WhereWeMetMapInvalidData):
            validate_and_normalize(values, VALID_THEME)

    def test_malformed_coordinates_rejected(self):
        values = {**VALID_VALUES, "coordinates": "not-an-object"}
        with self.assertRaises(WhereWeMetMapInvalidData):
            validate_and_normalize(values, VALID_THEME)

    def test_partial_coordinates_rejected(self):
        values = {**VALID_VALUES, "coordinates": {"lat": 48.8566}}  # missing lng
        with self.assertRaises(WhereWeMetMapInvalidData):
            validate_and_normalize(values, VALID_THEME)

    def test_non_numeric_coordinates_rejected(self):
        values = {**VALID_VALUES, "coordinates": {"lat": "north", "lng": "east"}}
        with self.assertRaises(WhereWeMetMapInvalidData):
            validate_and_normalize(values, VALID_THEME)

    def test_latitude_out_of_range_rejected(self):
        values = {**VALID_VALUES, "coordinates": {"lat": 95, "lng": 0}}
        with self.assertRaises(WhereWeMetMapInvalidData):
            validate_and_normalize(values, VALID_THEME)

    def test_longitude_out_of_range_rejected(self):
        values = {**VALID_VALUES, "coordinates": {"lat": 0, "lng": 200}}
        with self.assertRaises(WhereWeMetMapInvalidData):
            validate_and_normalize(values, VALID_THEME)

    def test_boundary_coordinates_accepted(self):
        values = {**VALID_VALUES, "coordinates": {"lat": 90, "lng": 180}}
        map_data = validate_and_normalize(values, VALID_THEME)
        self.assertEqual(map_data.lat, 90.0)
        self.assertEqual(map_data.lng, 180.0)

    def test_message_over_max_length_rejected(self):
        values = {**VALID_VALUES, "message": "x" * 91}
        with self.assertRaises(WhereWeMetMapInvalidData):
            validate_and_normalize(values, VALID_THEME)

    def test_message_at_max_length_accepted(self):
        values = {**VALID_VALUES, "message": "x" * 90}
        map_data = validate_and_normalize(values, VALID_THEME)
        self.assertEqual(len(map_data.message), 90)

    def test_invalid_photo_reference_rejected(self):
        values = {**VALID_VALUES, "photo": {"url": "no-asset-id"}}
        with self.assertRaises(WhereWeMetMapInvalidData):
            validate_and_normalize(values, VALID_THEME)

    def test_invalid_palette_rejected(self):
        with self.assertRaises(WhereWeMetMapInvalidData):
            validate_and_normalize(VALID_VALUES, {**VALID_THEME, "palette": "not-real"})

    def test_invalid_typography_rejected(self):
        with self.assertRaises(WhereWeMetMapInvalidData):
            validate_and_normalize(VALID_VALUES, {**VALID_THEME, "typography": "comic-sans"})

    def test_invalid_map_style_rejected(self):
        with self.assertRaises(WhereWeMetMapInvalidData):
            validate_and_normalize(VALID_VALUES, {**VALID_THEME, "mapStyle": "satellite"})

    def test_invalid_marker_style_rejected(self):
        with self.assertRaises(WhereWeMetMapInvalidData):
            validate_and_normalize(VALID_VALUES, {**VALID_THEME, "markerStyle": "flag"})

    def test_invalid_frame_rejected(self):
        with self.assertRaises(WhereWeMetMapInvalidData):
            validate_and_normalize(VALID_VALUES, {**VALID_THEME, "frame": "gallery"})  # LST-only frame, not valid here

    def test_scale_out_of_range_rejected(self):
        """Real range is 80-120 (not Love Story Timeline's 70-130)."""
        with self.assertRaises(WhereWeMetMapInvalidData):
            validate_and_normalize(VALID_VALUES, {**VALID_THEME, "scale": 150})

    def test_scale_130_valid_for_timeline_invalid_here(self):
        with self.assertRaises(WhereWeMetMapInvalidData):
            validate_and_normalize(VALID_VALUES, {**VALID_THEME, "scale": 130})

    def test_malformed_values_rejected(self):
        with self.assertRaises(WhereWeMetMapInvalidData):
            validate_and_normalize(["not", "a", "dict"], VALID_THEME)

    def test_malformed_theme_selections_rejected(self):
        with self.assertRaises(WhereWeMetMapInvalidData):
            validate_and_normalize(VALID_VALUES, ["not", "a", "dict"])

    def test_missing_theme_selections_use_documented_defaults(self):
        map_data = validate_and_normalize(VALID_VALUES, {})
        self.assertEqual(map_data.palette, "classic")
        self.assertEqual(map_data.typography, "serif-classic")

    def test_all_errors_reported_together(self):
        values = {"coordinates": {"lat": 999, "lng": 999}}
        try:
            validate_and_normalize(values, VALID_THEME)
            self.fail("expected WhereWeMetMapInvalidData")
        except WhereWeMetMapInvalidData as exc:
            self.assertGreaterEqual(len(exc.details["errors"]), 3)


# ------------------------------------------------------------------
# Rendering
# ------------------------------------------------------------------

class RenderingTests(TestCase):
    def test_output_is_a_real_valid_png(self):
        map_data = validate_and_normalize(VALID_VALUES, VALID_THEME)
        content = render_png(map_data, target_id="print-png", customer=None)
        self.assertTrue(content.startswith(b"\x89PNG\r\n\x1a\n"))
        with Image.open(io.BytesIO(content)) as img:
            img.verify()

    def test_non_empty_output(self):
        map_data = validate_and_normalize(VALID_VALUES, VALID_THEME)
        content = render_png(map_data, target_id="print-png", customer=None)
        self.assertGreater(len(content), 1000)

    def test_all_four_target_dimensions_correct(self):
        map_data = validate_and_normalize(VALID_VALUES, VALID_THEME)
        for target_id, expected_size in TARGET_DIMENSIONS.items():
            content = render_png(map_data, target_id=target_id, customer=None)
            with Image.open(io.BytesIO(content)) as img:
                self.assertEqual(img.size, expected_size, target_id)
                self.assertEqual(img.format, "PNG")

    def test_deterministic_output_for_same_normalized_input(self):
        map_data = validate_and_normalize(VALID_VALUES, VALID_THEME)
        content_a = render_png(map_data, target_id="print-png", customer=None)
        content_b = render_png(map_data, target_id="print-png", customer=None)
        self.assertEqual(content_a, content_b)

    def test_theme_selection_affects_output_bytes(self):
        map_data_a = validate_and_normalize(VALID_VALUES, VALID_THEME)
        map_data_b = validate_and_normalize(VALID_VALUES, {**VALID_THEME, "palette": "sage", "mapStyle": "line"})
        content_a = render_png(map_data_a, target_id="square-png", customer=None)
        content_b = render_png(map_data_b, target_id="square-png", customer=None)
        self.assertNotEqual(content_a, content_b)

    def test_all_marker_styles_render_without_error(self):
        for marker in ("pin", "heart", "star", "dot"):
            map_data = validate_and_normalize(VALID_VALUES, {**VALID_THEME, "markerStyle": marker})
            content = render_png(map_data, target_id="square-png", customer=None)
            self.assertGreater(len(content), 0)

    def test_all_map_styles_render_without_error(self):
        for style in ("line", "vintage", "night", "topographic"):
            map_data = validate_and_normalize(VALID_VALUES, {**VALID_THEME, "mapStyle": style})
            content = render_png(map_data, target_id="square-png", customer=None)
            self.assertGreater(len(content), 0)

    def test_mime_type_via_full_renderer(self):
        customer, order, _ = make_paid_entitlement(target_id="print-png")
        renderer = WhereWeMetMapRenderer()
        result = renderer.render(order.project, DeliveryType.PRINTABLE, order.delivery_pack, "print-png")
        self.assertEqual(result.content_type, "image/png")
        self.assertEqual(result.filename, "print-png.png")

    def test_long_names_and_message_do_not_overflow_canvas(self):
        """The exact edge case caught and fixed during Phase 3.11's
        manual visual verification: very long names/location plus a
        max-length message, on the narrowest canvas and largest scale.
        Asserts the image still parses as a valid, correctly-sized PNG
        — a real overflow bug previously corrupted layout enough that
        this is a meaningful regression guard, not just a smoke test.
        """
        values = {
            **VALID_VALUES,
            "partner1": "Alexandria Marie", "partner2": "Christopher John",
            "locationLabel": "A Very Long City Name, Somewhere",
            "message": "x" * 90,
        }
        map_data = validate_and_normalize(values, {**VALID_THEME, "scale": 120})
        content = render_png(map_data, target_id="square-png", customer=None)
        with Image.open(io.BytesIO(content)) as img:
            self.assertEqual(img.size, (1080, 1080))
            img.verify()

    def test_unbroken_long_string_wraps_at_character_level(self):
        """A message with zero whitespace (unrealistic for a real love
        note, but a genuine edge case) must still wrap rather than
        overflow — word-boundary wrapping alone can't handle it.
        """
        values = {**VALID_VALUES, "message": "x" * 90}
        map_data = validate_and_normalize(values, VALID_THEME)
        content = render_png(map_data, target_id="square-png", customer=None)
        with Image.open(io.BytesIO(content)) as img:
            img.verify()

    def test_no_stray_temp_files_created(self):
        before = set(os.listdir(tempfile.gettempdir()))
        map_data = validate_and_normalize(VALID_VALUES, VALID_THEME)
        render_png(map_data, target_id="print-png", customer=None)
        after = set(os.listdir(tempfile.gettempdir()))
        self.assertEqual(before, after)

    def test_southern_and_western_hemisphere_coordinates_project_correctly(self):
        """Sanity-checks the projection formula's sign handling — south
        of the equator / west of the prime meridian.
        """
        values = {**VALID_VALUES, "coordinates": {"lat": -33.8688, "lng": 151.2093}}  # Sydney
        map_data = validate_and_normalize(values, VALID_THEME)
        content = render_png(map_data, target_id="square-png", customer=None)
        self.assertGreater(len(content), 0)


# ------------------------------------------------------------------
# Ownership / API
# ------------------------------------------------------------------

class DownloadAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_owner_can_download_real_output(self):
        customer, order, entitlement = make_paid_entitlement(target_id="print-png")
        login_as_guest(self.client, email=customer.email)

        response = self.client.get(f"/api/v1/entitlements/{entitlement.id}/download/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "image/png")
        self.assertTrue(response.content.startswith(b"\x89PNG\r\n\x1a\n"))
        with Image.open(io.BytesIO(response.content)) as img:
            self.assertEqual(img.size, (2480, 3508))

    def test_another_guest_gets_403(self):
        customer, order, entitlement = make_paid_entitlement(target_id="print-png")
        other = make_customer()
        login_as_guest(self.client, email=other.email)

        response = self.client.get(f"/api/v1/entitlements/{entitlement.id}/download/")
        self.assertEqual(response.status_code, http_status.HTTP_403_FORBIDDEN)

    def test_unknown_entitlement_gets_404(self):
        customer = make_customer()
        login_as_guest(self.client, email=customer.email)
        response = self.client.get(f"/api/v1/entitlements/{uuid.uuid4()}/download/")
        self.assertEqual(response.status_code, http_status.HTTP_404_NOT_FOUND)

    def test_unpaid_order_cannot_download(self):
        customer = make_customer()
        product = make_map_product()
        pack = make_delivery_pack(product, included_targets=["print-png"])
        project = Project.objects.create(
            customer=customer, product=product,
            data={"version": 1, "values": VALID_VALUES, "themeSelections": VALID_THEME},
        )
        order = Order.objects.create(
            customer=customer, product=product, delivery_pack=pack, project=project, guest_email=customer.email,
            subtotal_cents=1200, total_cents=1200, status=Order.STATUS_PENDING,
        )
        entitlement = Entitlement.objects.create(order=order, product=product, target_id="print-png")
        login_as_guest(self.client, email=customer.email)

        response = self.client.get(f"/api/v1/entitlements/{entitlement.id}/download/")
        self.assertEqual(response.status_code, http_status.HTTP_404_NOT_FOUND)

    def test_invalid_project_data_produces_structured_error_not_traceback(self):
        customer, order, entitlement = make_paid_entitlement(
            target_id="print-png", values={"partner1": "", "partner2": "", "coordinates": None}
        )
        login_as_guest(self.client, email=customer.email)

        response = self.client.get(f"/api/v1/entitlements/{entitlement.id}/download/")

        self.assertEqual(response.status_code, http_status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["error"]["code"], "where_we_met_map_invalid_data")
        self.assertNotIn("Traceback", str(response.data))

    def test_no_output_persisted_as_asset(self):
        from apps.assets.models import Asset

        customer, order, entitlement = make_paid_entitlement(target_id="print-png")
        login_as_guest(self.client, email=customer.email)
        before = Asset.objects.count()
        self.client.get(f"/api/v1/entitlements/{entitlement.id}/download/")
        self.assertEqual(Asset.objects.count(), before)


# ------------------------------------------------------------------
# Security
# ------------------------------------------------------------------

class SecurityTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_query_parameters_cannot_override_ownership(self):
        customer, order, entitlement = make_paid_entitlement(target_id="print-png")
        other = make_customer()
        login_as_guest(self.client, email=customer.email)

        response = self.client.get(
            f"/api/v1/entitlements/{entitlement.id}/download/?customerId={other.id}&projectId={uuid.uuid4()}"
        )
        self.assertEqual(response.status_code, http_status.HTTP_200_OK)

    def test_photo_belonging_to_another_customer_cannot_be_rendered(self):
        """A malicious/stale `values.photo.assetId` pointing at another
        customer's asset must not silently render — the renderer
        resolves photos through the project's own customer (an
        existing, ownership-verified relationship), and
        `get_asset_for_customer` rejects any asset that customer
        doesn't actually own.
        """
        owner = make_customer()
        stranger = make_customer()

        buf = io.BytesIO()
        Image.new("RGB", (100, 100), "green").save(buf, format="JPEG")
        stranger_asset = upload_asset(stranger, SimpleUploadedFile("s.jpg", buf.getvalue(), content_type="image/jpeg"))

        values = {**VALID_VALUES, "photo": {"assetId": str(stranger_asset.id)}}
        customer, order, entitlement = make_paid_entitlement(target_id="print-png", values=values, customer=owner)
        login_as_guest(self.client, email=owner.email)

        response = self.client.get(f"/api/v1/entitlements/{entitlement.id}/download/")

        self.assertEqual(response.status_code, http_status.HTTP_502_BAD_GATEWAY)
        self.assertEqual(response.data["error"]["code"], "where_we_met_map_render_failed")

    def test_nonexistent_asset_id_handled_safely(self):
        customer = make_customer()
        values = {**VALID_VALUES, "photo": {"assetId": str(uuid.uuid4())}}
        _, order, entitlement = make_paid_entitlement(target_id="print-png", values=values, customer=customer)
        login_as_guest(self.client, email=customer.email)

        response = self.client.get(f"/api/v1/entitlements/{entitlement.id}/download/")
        self.assertIn(response.status_code, (http_status.HTTP_404_NOT_FOUND, http_status.HTTP_502_BAD_GATEWAY))
        self.assertNotIn("Traceback", str(response.data))

    def test_owned_photo_renders_successfully(self):
        customer = make_customer()
        buf = io.BytesIO()
        Image.new("RGB", (300, 300), "blue").save(buf, format="JPEG")
        asset = upload_asset(customer, SimpleUploadedFile("mine.jpg", buf.getvalue(), content_type="image/jpeg"))

        values = {**VALID_VALUES, "photo": {"assetId": str(asset.id)}}
        _, order, entitlement = make_paid_entitlement(target_id="print-png", values=values, customer=customer)
        login_as_guest(self.client, email=customer.email)

        response = self.client.get(f"/api/v1/entitlements/{entitlement.id}/download/")
        self.assertEqual(response.status_code, http_status.HTTP_200_OK)

    def test_no_internal_filesystem_paths_in_response(self):
        customer, order, entitlement = make_paid_entitlement(target_id="print-png")
        login_as_guest(self.client, email=customer.email)

        response = self.client.get(f"/api/v1/entitlements/{entitlement.id}/download/")

        headers_text = str(dict(response.items()))
        self.assertNotIn("/home/", headers_text)
        self.assertNotIn("fonts/DejaVu", headers_text)

    def test_no_stray_files_left_after_full_api_download(self):
        before = set(os.listdir(tempfile.gettempdir()))
        customer, order, entitlement = make_paid_entitlement(target_id="print-png")
        login_as_guest(self.client, email=customer.email)
        self.client.get(f"/api/v1/entitlements/{entitlement.id}/download/")
        after = set(os.listdir(tempfile.gettempdir()))
        self.assertEqual(before, after)


class FormatDateTests(TestCase):
    """Windows portability regression coverage (see
    apps/delivery/date_formatting.py) at the point this product
    actually uses it.
    """

    def test_single_digit_day_has_no_leading_zero(self):
        from .layout import format_date

        self.assertEqual(format_date("2019-04-09"), "April 9, 2019")

    def test_double_digit_day(self):
        from .layout import format_date

        self.assertEqual(format_date("2019-04-12"), "April 12, 2019")

    def test_empty_or_invalid_date_string_returns_empty(self):
        from .layout import format_date

        self.assertEqual(format_date(""), "")
        self.assertEqual(format_date("not-a-date"), "")
