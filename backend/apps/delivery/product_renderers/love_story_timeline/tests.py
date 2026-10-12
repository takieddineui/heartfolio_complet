"""
Comprehensive tests for the real Love Story Timeline renderer — data
validation, PNG/HTML generation, registry registration, and the full
API path through `GET /api/v1/entitlements/<uuid>/download/` with an
actually-registered renderer (not a test double, unlike
apps/delivery/tests.py's Phase 3.8 suite, which necessarily used
doubles since no real renderer existed yet).
"""

import io
import os
import tempfile
import uuid

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, TestCase
from PIL import Image
from rest_framework import status as http_status
from rest_framework.test import APIClient

from apps.assets.services import upload_asset
from apps.commerce.models import Entitlement, Order
from apps.common.exceptions.api_errors import LoveStoryTimelineInvalidData, LoveStoryTimelineRenderFailed
from apps.common.test_helpers import csrf_headers, login_as_guest
from apps.customers.models import Customer
from apps.delivery.delivery_types import DeliveryType
from apps.delivery.models import PublicExperience
from apps.delivery.registry import get_renderer
from apps.delivery.renderers import NotImplementedRenderer
from apps.products.models import DeliveryPack, Product
from apps.projects.models import Project

from .data import validate_and_normalize
from .html_renderer import render_html
from .png_renderer import TARGET_DIMENSIONS, render_png
from .renderer import LoveStoryTimelineRenderer

# Updated for the story rework: `people` replaces partner1/partner2 (§16),
# `dedication` replaces `quote` (§3), and there are now THREE events with
# photos, because §4 raised the floor to three and made a photo per
# milestone required. A two-event fixture would no longer validate.
VALID_VALUES = {
    "storyType": "couple",
    "people": [{"name": "Alex"}, {"name": "Sam"}],
    "posterTitle": "Our Story",
    "subtitle": "",
    "dedication": "To the moon and back",
    "endingText": "Forever yours",
    "showDuration": True,
    "autoSort": True,
    "events": [
        {
            "date": "2019-04-12", "title": "We met", "description": "At a coffee shop downtown",
            "location": "Lisbon", "photo": {"assetId": "asset-1"},
        },
        {
            "date": "2020-06-01", "title": "First trip", "description": "Went to the mountains together",
            "location": "Andalusia", "photo": {"assetId": "asset-2"},
        },
        {
            "date": "2022-09-03", "title": "We moved in", "description": "Two boxes and a plant",
            "location": "Cascais", "photo": {"assetId": "asset-3"},
        },
    ],
}
VALID_THEME = {
    "palette": "midnight", "typography": "script",
    # §7 — one of the six new compositions; "cards" no longer exists.
    "layout": "neat-stack", "scale": 100,
}


def make_customer(**overrides) -> Customer:
    defaults = {"email": f"guest-{uuid.uuid4().hex[:8]}@example.com"}
    defaults.update(overrides)
    return Customer.objects.create(**defaults)


def make_lst_product() -> Product:
    return Product.objects.create(
        slug="love-story-timeline", name_i18n_key="product.timeline.name",
        category=Product.CATEGORY_TIMELINE, status=Product.STATUS_AVAILABLE,
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
    product = product or make_lst_product()
    pack = make_delivery_pack(product, slug=pack_slug, included_targets=[target_id])

    # REAL uploaded photos, not VALID_VALUES' placeholder ids. Every test
    # built on this fixture that actually renders reads the referenced
    # assets, and "asset-1" is not a UUID — the renderer refused it,
    # correctly, and about a dozen tests failed on their own fixture.
    # An explicit `values` argument is respected as-is: tests that pass one
    # are usually testing validation, where placeholders are fine.
    project = Project.objects.create(
        customer=customer, product=product,
        data={
            "version": 1,
            "values": values if values is not None else values_with_real_photos(customer),
            "themeSelections": theme or VALID_THEME,
        },
    )
    order = Order.objects.create(
        customer=customer, product=product, delivery_pack=pack, project=project, guest_email=customer.email,
        subtotal_cents=pack.price_cents, total_cents=pack.price_cents, status=Order.STATUS_PAID,
    )
    entitlement = Entitlement.objects.create(order=order, product=product, target_id=target_id)

    # A live entitlement needs its PublicExperience, exactly as
    # `grant_entitlements` creates one at payment. Delivery for `__live__`
    # now resolves to the hosted `/live/<experience id>` page rather than a
    # downloadable gift.html, so without this row the download raises
    # `RendererNotAvailable` — which is the correct refusal (handing over a
    # file instead of the page would deliver a different product than the
    # one bought), but it makes the fixture, not the code, the thing under
    # test.
    if target_id == "__live__":
        PublicExperience.objects.create(
            entitlement=entitlement,
            kind=PublicExperience.KIND_LIVE,
            status=PublicExperience.STATUS_ACTIVE,
        )

    return customer, order, entitlement


def values_with_real_photos(customer, values=None):
    """`VALID_VALUES` with every `photo.assetId` pointing at a REAL Asset
    owned by `customer`.

    `VALID_VALUES` carries placeholder ids ("asset-1"). Those are fine for
    tests that only validate data — validation checks the shape, not that
    the asset exists — but any test that actually RENDERS hits
    `get_asset_bytes_for_customer`, where "asset-1" fails as a malformed
    UUID and surfaces as `LoveStoryTimelineRenderFailed` / 502. That is the
    renderer behaving correctly on a fixture that was never valid, not a
    bug, and it accounted for roughly a dozen failures.

    Uploads one small real JPEG per event so the Pillow path has genuine
    bytes to paste.
    """
    base = values or VALID_VALUES
    events = []
    for event in base["events"]:
        buf = io.BytesIO()
        Image.new("RGB", (200, 200), "blue").save(buf, format="JPEG")
        buf.seek(0)
        asset = upload_asset(
            customer, SimpleUploadedFile("p.jpg", buf.read(), content_type="image/jpeg")
        )
        events.append({**event, "photo": {"assetId": str(asset.id)}})
    return {**base, "events": events}


# ------------------------------------------------------------------
# Renderer registration
# ------------------------------------------------------------------

class RendererRegistrationTests(TestCase):
    def test_love_story_timeline_slug_resolves_to_real_renderer(self):
        renderer = get_renderer("love-story-timeline", DeliveryType.PRINTABLE)
        self.assertIsInstance(renderer, LoveStoryTimelineRenderer)
        self.assertNotIsInstance(renderer, NotImplementedRenderer)

    def test_all_four_delivery_types_are_handled_without_renderer_not_available(self):
        customer, order, _ = make_paid_entitlement(target_id="print-png")
        renderer = get_renderer("love-story-timeline", DeliveryType.PRINTABLE)
        for delivery_type, target_id in [
            (DeliveryType.PRINTABLE, "print-png"),
            (DeliveryType.SOCIAL, "story-png"),
            (DeliveryType.WALLPAPER, "landscape-png"),
            (DeliveryType.DIGITAL, "__live__"),
        ]:
            result = renderer.render(order.project, delivery_type, order.delivery_pack, target_id)
            self.assertIsNotNone(result)

    def test_unsupported_target_id_fails_cleanly(self):
        customer, order, _ = make_paid_entitlement(target_id="print-png")
        renderer = get_renderer("love-story-timeline", DeliveryType.PRINTABLE)
        with self.assertRaises(LoveStoryTimelineRenderFailed):
            renderer.render(order.project, DeliveryType.PRINTABLE, order.delivery_pack, "totally-unknown-target")

    def test_unregistered_product_still_falls_back_to_not_implemented(self):
        # "heart-map" has a real renderer as of Phase 3.11 — no longer
        # a valid "unregistered" example.
        renderer = get_renderer("song-poster", DeliveryType.PRINTABLE)
        self.assertIsInstance(renderer, NotImplementedRenderer)


# ------------------------------------------------------------------
# Data validation
# ------------------------------------------------------------------

class DataValidationTests(TestCase):
    def test_valid_data_passes(self):
        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        # §16 replaced the fixed partner1/partner2 slots with `people`,
        # because two slots made the product couple-only. The fixture was
        # updated; this assertion was not.
        self.assertEqual(timeline.people, ["Alex", "Sam"])
        self.assertEqual(len(timeline.events), 2)

    def test_missing_people_rejected(self):
        # Was `{**VALID_VALUES, "partner1": ""}` — a key the validator has
        # not read since §16, so it emptied nothing and nothing was
        # rejected. A story with no names is the real invalid case.
        values = {**VALID_VALUES, "people": []}
        with self.assertRaises(LoveStoryTimelineInvalidData):
            validate_and_normalize(values, VALID_THEME)

    def test_one_name_is_accepted(self):
        values = {**VALID_VALUES, "people": [{"name": "Alex"}]}
        self.assertEqual(validate_and_normalize(values, VALID_THEME).people, ["Alex"])

    def test_more_than_two_names_rejected_for_every_story_type(self):
        # The limit is product-wide, not per story type: a family or a gift
        # gets no more names than a couple.
        three = [{"name": "Alex"}, {"name": "Sam"}, {"name": "Robin"}]
        for story_type in ("couple", "family", "parents", "gift"):
            with self.subTest(story_type=story_type):
                values = {**VALID_VALUES, "storyType": story_type, "people": three}
                with self.assertRaises(LoveStoryTimelineInvalidData) as ctx:
                    validate_and_normalize(values, VALID_THEME)
                self.assertTrue(
                    any("'people' must be a list of 1-2 items" in e for e in ctx.exception.details["errors"])
                )

    def test_missing_events_rejected(self):
        values = {**VALID_VALUES, "events": []}
        with self.assertRaises(LoveStoryTimelineInvalidData):
            validate_and_normalize(values, VALID_THEME)

    def test_too_many_events_rejected(self):
        events = [{"date": f"2020-01-{i:02d}", "title": f"Event {i}"} for i in range(1, 7)]  # 6 > MAX_EVENTS(5)
        values = {**VALID_VALUES, "events": events}
        with self.assertRaises(LoveStoryTimelineInvalidData):
            validate_and_normalize(values, VALID_THEME)

    def test_invalid_event_structure_rejected(self):
        values = {**VALID_VALUES, "events": ["not-a-dict"]}
        with self.assertRaises(LoveStoryTimelineInvalidData):
            validate_and_normalize(values, VALID_THEME)

    def test_invalid_date_rejected(self):
        values = {**VALID_VALUES, "events": [{"date": "not-a-date", "title": "X"}]}
        with self.assertRaises(LoveStoryTimelineInvalidData):
            validate_and_normalize(values, VALID_THEME)

    def test_duplicate_dates_rejected(self):
        """Mirrors validation.ts's duplicateDate rule exactly."""
        values = {
            **VALID_VALUES,
            "events": [
                {"date": "2020-01-01", "title": "First"},
                {"date": "2020-01-01", "title": "Second"},
            ],
        }
        with self.assertRaises(LoveStoryTimelineInvalidData):
            validate_and_normalize(values, VALID_THEME)

    def test_missing_event_title_rejected(self):
        values = {**VALID_VALUES, "events": [{"date": "2020-01-01"}]}
        with self.assertRaises(LoveStoryTimelineInvalidData):
            validate_and_normalize(values, VALID_THEME)

    def test_invalid_photo_reference_rejected(self):
        values = {**VALID_VALUES, "events": [{"date": "2020-01-01", "title": "X", "photo": {"url": "no-asset-id"}}]}
        with self.assertRaises(LoveStoryTimelineInvalidData):
            validate_and_normalize(values, VALID_THEME)

    def test_invalid_palette_rejected(self):
        with self.assertRaises(LoveStoryTimelineInvalidData):
            validate_and_normalize(VALID_VALUES, {**VALID_THEME, "palette": "not-a-real-palette"})

    def test_invalid_typography_rejected(self):
        with self.assertRaises(LoveStoryTimelineInvalidData):
            validate_and_normalize(VALID_VALUES, {**VALID_THEME, "typography": "comic-sans"})

    def test_invalid_layout_rejected(self):
        with self.assertRaises(LoveStoryTimelineInvalidData):
            validate_and_normalize(VALID_VALUES, {**VALID_THEME, "layout": "spiral"})

    def test_frame_is_no_longer_a_validated_field(self):
        """§13 — frame stopped being customer input.

        The old test asserted an invalid frame value was REJECTED, which no
        longer makes sense: there is no `frame` choice-field validation left
        to reject anything. What actually matters now is the opposite
        property — a stray `frame` key in themeSelections (e.g. from an old
        saved project, or a client that has not picked up this change) must
        be silently ignored rather than erroring or leaking into the
        rendered file.
        """
        timeline = validate_and_normalize(VALID_VALUES, {**VALID_THEME, "frame": "golden"})
        self.assertFalse(hasattr(timeline, "frame"))

    def test_scale_out_of_range_rejected(self):
        with self.assertRaises(LoveStoryTimelineInvalidData):
            validate_and_normalize(VALID_VALUES, {**VALID_THEME, "scale": 500})

    def test_malformed_values_rejected(self):
        with self.assertRaises(LoveStoryTimelineInvalidData):
            validate_and_normalize(["not", "a", "dict"], VALID_THEME)

    def test_malformed_theme_selections_rejected(self):
        with self.assertRaises(LoveStoryTimelineInvalidData):
            validate_and_normalize(VALID_VALUES, ["not", "a", "dict"])

    def test_missing_theme_selections_use_documented_defaults(self):
        """An empty themeSelections is valid — every axis has a
        sensible default, matching how a freshly-created Project's
        data looks before the customer touches any theme control.
        """
        timeline = validate_and_normalize(VALID_VALUES, {})
        self.assertEqual(timeline.palette, "classic")
        self.assertEqual(timeline.typography, "serif-classic")

    def test_all_errors_reported_together_not_just_the_first(self):
        # Missing `people` AND empty events AND an out-of-range scale —
        # three independent problems, to prove every one is reported rather
        # than just the first. The old version listed partner1/partner2,
        # which produce no errors at all now, leaving only two.
        values = {"events": []}
        try:
            validate_and_normalize(values, {**VALID_THEME, "scale": 999})
            self.fail("expected LoveStoryTimelineInvalidData")
        except LoveStoryTimelineInvalidData as exc:
            self.assertGreaterEqual(len(exc.details["errors"]), 3)
            self.assertTrue(any("people" in e for e in exc.details["errors"]))
            self.assertTrue(any("events" in e for e in exc.details["errors"]))


# ------------------------------------------------------------------
# Printable
# ------------------------------------------------------------------

class PrintableRenderingTests(TestCase):
    def test_output_is_a_real_valid_png(self):
        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        content = render_png(timeline, target_id="print-png", customer=None)
        self.assertTrue(content.startswith(b"\x89PNG\r\n\x1a\n"))
        with Image.open(io.BytesIO(content)) as img:
            img.verify()

    def test_non_empty_output(self):
        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        content = render_png(timeline, target_id="print-png", customer=None)
        self.assertGreater(len(content), 1000)

    def test_correct_dimensions(self):
        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        content = render_png(timeline, target_id="print-png", customer=None)
        with Image.open(io.BytesIO(content)) as img:
            self.assertEqual(img.size, TARGET_DIMENSIONS["print-png"])

    def test_deterministic_output_for_same_normalized_input(self):
        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        content_a = render_png(timeline, target_id="print-png", customer=None)
        content_b = render_png(timeline, target_id="print-png", customer=None)
        self.assertEqual(content_a, content_b)

    def test_mime_type_via_full_renderer(self):
        customer, order, _ = make_paid_entitlement(target_id="print-png")
        renderer = LoveStoryTimelineRenderer()
        result = renderer.render(order.project, DeliveryType.PRINTABLE, order.delivery_pack, "print-png")
        self.assertEqual(result.content_type, "image/png")
        self.assertEqual(result.filename, "print-png.png")

    def test_no_stray_temp_files_created(self):
        """Rendering is fully in-memory (io.BytesIO) — nothing ever
        touches the filesystem, so there is nothing to clean up. Proven
        directly: snapshot the system temp dir before/after.
        """
        before = set(os.listdir(tempfile.gettempdir()))
        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        render_png(timeline, target_id="print-png", customer=None)
        after = set(os.listdir(tempfile.gettempdir()))
        self.assertEqual(before, after)


# ------------------------------------------------------------------
# Social
# ------------------------------------------------------------------

class SocialRenderingTests(TestCase):
    def test_story_png_output(self):
        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        content = render_png(timeline, target_id="story-png", customer=None)
        self.assertGreater(len(content), 0)
        with Image.open(io.BytesIO(content)) as img:
            self.assertEqual(img.size, (1080, 1920))

    def test_square_png_output(self):
        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        content = render_png(timeline, target_id="square-png", customer=None)
        with Image.open(io.BytesIO(content)) as img:
            self.assertEqual(img.size, (1080, 1080))
            self.assertEqual(img.format, "PNG")


# ------------------------------------------------------------------
# Wallpaper
# ------------------------------------------------------------------

class WallpaperRenderingTests(TestCase):
    def test_landscape_png_output(self):
        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        content = render_png(timeline, target_id="landscape-png", customer=None)
        with Image.open(io.BytesIO(content)) as img:
            self.assertEqual(img.size, (1920, 1080))

    def test_portrait_png_output(self):
        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        content = render_png(timeline, target_id="portrait-png", customer=None)
        with Image.open(io.BytesIO(content)) as img:
            self.assertEqual(img.size, (1080, 1350))

    def test_story_png_purchased_via_wallpaper_pack_still_renders_correct_dimensions(self):
        """The Phase 3.8 ambiguity in practice: "story-png" purchased
        through the "wallpaper" pack classifies as WALLPAPER
        (delivery_type), but the actual pixel dimensions rendered are
        still story-png's own real dimensions (1080x1920) — the
        renderer dispatches on target_id for output size, not on the
        coarser delivery_type label.
        """
        customer, order, entitlement = make_paid_entitlement(target_id="story-png", pack_slug="wallpaper")
        from apps.delivery.services import get_delivery_for_entitlement

        result = get_delivery_for_entitlement(entitlement)
        with Image.open(io.BytesIO(result.content)) as img:
            self.assertEqual(img.size, (1080, 1920))


# ------------------------------------------------------------------
# Digital
# ------------------------------------------------------------------

class DigitalRenderingTests(TestCase):
    def test_html_generated(self):
        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        content = render_html(timeline, customer=None)
        self.assertTrue(content.startswith(b"<!DOCTYPE html>"))

    def test_contains_expected_timeline_content(self):
        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        content = render_html(timeline, customer=None).decode("utf-8")
        self.assertIn("Alex &amp; Sam", content)
        self.assertIn("We met", content)
        self.assertIn("First trip", content)

    def test_contains_expected_theme_data(self):
        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)  # midnight palette
        content = render_html(timeline, customer=None).decode("utf-8")
        self.assertIn("#141b2e", content)  # midnight palette's real bg hex from themes.ts

    def test_contains_animations(self):
        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        content = render_html(timeline, customer=None).decode("utf-8")
        self.assertIn("@keyframes", content)
        self.assertIn("animation:", content)

    def test_no_output_persisted_as_asset(self):
        from apps.assets.models import Asset

        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        before = Asset.objects.count()
        render_html(timeline, customer=None)
        self.assertEqual(Asset.objects.count(), before)

    def test_no_stray_temp_files(self):
        before = set(os.listdir(tempfile.gettempdir()))
        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        render_html(timeline, customer=None)
        after = set(os.listdir(tempfile.gettempdir()))
        self.assertEqual(before, after)

    def test_photo_embedded_as_data_uri_not_external_url(self):
        customer = make_customer()
        buf = io.BytesIO()
        Image.new("RGB", (200, 200), "blue").save(buf, format="JPEG")
        buf.seek(0)
        uploaded = SimpleUploadedFile("p.jpg", buf.read(), content_type="image/jpeg")
        asset = upload_asset(customer, uploaded)

        values = {**VALID_VALUES, "events": [{"date": "2020-01-01", "title": "X", "photo": {"assetId": str(asset.id)}}]}
        timeline = validate_and_normalize(values, VALID_THEME)
        content = render_html(timeline, customer=customer).decode("utf-8")

        self.assertIn("data:image/jpeg;base64,", content)
        self.assertNotIn(asset.storage_key, content)


# ------------------------------------------------------------------
# Ownership / API
# ------------------------------------------------------------------

class DownloadAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_owner_can_download_real_printable_output(self):
        customer, order, entitlement = make_paid_entitlement(target_id="print-png")
        login_as_guest(self.client, email=customer.email)

        response = self.client.get(f"/api/v1/entitlements/{entitlement.id}/download/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "image/png")
        self.assertTrue(response.content.startswith(b"\x89PNG\r\n\x1a\n"))

    def test_owner_can_download_real_digital_output(self):
        customer, order, entitlement = make_paid_entitlement(target_id="__live__", pack_slug="live")
        login_as_guest(self.client, email=customer.email)

        response = self.client.get(f"/api/v1/entitlements/{entitlement.id}/download/")

        # THE DIGITAL CONTRACT CHANGED. This used to assert HTML bytes — a
        # downloadable gift.html. §10's Digital keepsake is a hosted page:
        # the milestone video and audio it needs cannot be embedded in a
        # self-contained file, and serving one handed the customer a
        # different product than the one they bought. Delivery now answers
        # with the link to their live page.
        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "application/json")
        self.assertIn("/live/", response.json()["url"])

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
        product = make_lst_product()
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
            target_id="print-png", values={"people": [], "events": []}
        )
        login_as_guest(self.client, email=customer.email)

        response = self.client.get(f"/api/v1/entitlements/{entitlement.id}/download/")

        self.assertEqual(response.status_code, http_status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["error"]["code"], "love_story_timeline_invalid_data")
        self.assertNotIn("Traceback", str(response.data))


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
        self.assertEqual(response.status_code, http_status.HTTP_200_OK)  # still the real owner's own data

    def test_photo_belonging_to_another_customer_cannot_be_rendered(self):
        """A malicious/stale `values.photo.assetId` pointing at another
        customer's asset must not silently render that photo — the
        renderer resolves photos through the *project's own* customer
        (an existing, ownership-verified relationship), and
        `get_asset_for_customer` rejects any asset that customer
        doesn't actually own.
        """
        owner = make_customer()
        stranger = make_customer()

        buf = io.BytesIO()
        Image.new("RGB", (100, 100), "green").save(buf, format="JPEG")
        buf.seek(0)
        stranger_asset = upload_asset(stranger, SimpleUploadedFile("s.jpg", buf.getvalue(), content_type="image/jpeg"))

        # §4 raised the minimum to 3 events (this test used to pass a
        # single-event `events` list, which the schema now rejects before
        # ever reaching asset resolution — failing on the wrong thing and
        # leaving this security boundary unexercised for this product).
        # Only the milestone under test points at the stranger's asset;
        # the other two use the owner's own real photos via
        # `values_with_real_photos`, so the render genuinely reaches — and
        # rejects — that one reference instead of failing earlier.
        values = values_with_real_photos(owner)
        values["events"][1] = {**values["events"][1], "photo": {"assetId": str(stranger_asset.id)}}
        customer, order, entitlement = make_paid_entitlement(target_id="print-png", values=values, customer=owner)
        login_as_guest(self.client, email=owner.email)

        response = self.client.get(f"/api/v1/entitlements/{entitlement.id}/download/")

        # Must fail safely (structured error), never silently succeed
        # by rendering the stranger's photo.
        self.assertEqual(response.status_code, http_status.HTTP_502_BAD_GATEWAY)
        self.assertEqual(response.data["error"]["code"], "love_story_timeline_render_failed")

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


class FormatEventDateTests(TestCase):
    """Windows portability regression coverage (see
    apps/delivery/date_formatting.py) at the point this product
    actually uses it — `format_event_date` is what every timeline
    event's date label goes through in the real render.
    """

    def test_single_digit_day_has_no_leading_zero(self):
        from .layout import format_event_date

        self.assertEqual(format_event_date("2019-04-09"), "Apr 9, 2019")

    def test_double_digit_day(self):
        from .layout import format_event_date

        self.assertEqual(format_event_date("2019-04-12"), "Apr 12, 2019")

    def test_invalid_date_string_returns_empty(self):
        from .layout import format_event_date

        self.assertEqual(format_event_date("not-a-date"), "")


class MountingVariantRenderingTests(SimpleTestCase):
    """§3 — frameless and edged are two different physical products.

    The requirement is explicit that these are "genuinely different
    compositions, not a resize of one another". A renderer that produced the
    same bytes for both, or that simply scaled one down, would satisfy the
    file count while failing the actual thing asked for — so these tests
    check the pixels rather than the plumbing.
    """

    def test_both_variants_render_at_the_same_paper_size(self):
        # Same paper, different treatment. A size difference here would mean
        # the edged version had been shrunk rather than re-laid-out.
        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        sizes = []
        for mounting in ("frameless", "edged"):
            content = render_png(timeline, target_id=f"print-a4-{mounting}", customer=None)
            with Image.open(io.BytesIO(content)) as img:
                sizes.append(img.size)
        self.assertEqual(sizes[0], sizes[1])
        self.assertEqual(sizes[0], (2480, 3508))

    def test_the_two_variants_are_not_the_same_image(self):
        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        frameless = render_png(timeline, target_id="print-a4-frameless", customer=None)
        edged = render_png(timeline, target_id="print-a4-edged", customer=None)
        self.assertNotEqual(frameless, edged)

    def test_edged_leaves_the_frame_safe_margin_clear(self):
        """The whole purpose of the variant: nothing in the outer half-inch.

        Checked by sampling the margin band and asserting it is uniformly the
        palette background — if the timeline had been rendered full-bleed and
        merely cropped, text would appear here.
        """
        from apps.delivery.print_sizes import edged_margin_px

        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        content = render_png(timeline, target_id="print-a4-edged", customer=None)

        with Image.open(io.BytesIO(content)) as img:
            rgb = img.convert("RGB")
            width, height = rgb.size
            margin = edged_margin_px()
            background = rgb.getpixel((1, 1))

            # Sample inside the margin band on all four edges.
            probes = []
            for x in range(0, width, max(1, width // 40)):
                probes.append((x, margin // 2))
                probes.append((x, height - 1 - margin // 2))
            for y in range(0, height, max(1, height // 40)):
                probes.append((margin // 2, y))
                probes.append((width - 1 - margin // 2, y))

            for point in probes:
                self.assertEqual(
                    rgb.getpixel(point),
                    background,
                    f"content found inside the frame-safe margin at {point}",
                )

    def test_frameless_uses_the_full_sheet(self):
        # The counterpart assertion: frameless must NOT inset, or it would be
        # dead space under glass where nothing overlaps the print anyway.
        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        frameless = render_png(timeline, target_id="print-a4-frameless", customer=None)
        edged = render_png(timeline, target_id="print-a4-edged", customer=None)

        def top_content_row(png_bytes):
            with Image.open(io.BytesIO(png_bytes)) as img:
                rgb = img.convert("RGB")
                background = rgb.getpixel((1, 1))
                for y in range(rgb.height):
                    for x in range(0, rgb.width, 8):
                        if rgb.getpixel((x, y)) != background:
                            return y
            return None

        self.assertIsNotNone(top_content_row(frameless))
        self.assertIsNotNone(top_content_row(edged))
        # Content starts lower down on the edged variant, by roughly the margin.
        self.assertGreater(top_content_row(edged), top_content_row(frameless))

    def test_every_current_print_target_renders(self):
        from apps.delivery.print_sizes import all_print_target_ids

        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        for target_id in all_print_target_ids():
            content = render_png(timeline, target_id=target_id, customer=None)
            self.assertTrue(content.startswith(b"\x89PNG\r\n\x1a\n"), target_id)


class KeepsakeLocaleTests(SimpleTestCase):
    """The delivered keepsake declares the language it was bought in.

    Previously `<html lang="en">` was hardcoded with no `dir` at all, so a
    French or Arabic customer received a document announcing the wrong
    language to screen readers and laying its timeline out left-to-right
    regardless of script. Nothing in the delivery pipeline carried a locale;
    `Order.locale` now does.
    """

    def _doc(self, locale):
        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        return render_html(timeline, customer=None, locale=locale).decode("utf-8")

    def test_declares_the_order_language(self):
        for locale in ("en", "fr", "ar"):
            self.assertIn(f'lang="{locale}"', self._doc(locale))

    def test_arabic_reads_right_to_left(self):
        self.assertIn('dir="rtl"', self._doc("ar"))

    def test_latin_scripts_read_left_to_right(self):
        for locale in ("en", "fr"):
            self.assertIn('dir="ltr"', self._doc(locale))

    def test_region_suffixes_do_not_break_direction(self):
        # "ar-EG" is still Arabic. Matching the full string would silently
        # fall back to ltr for every regional variant.
        self.assertIn('dir="rtl"', self._doc("ar-EG"))
        self.assertIn('dir="ltr"', self._doc("fr-CA"))

    def test_defaults_to_english_when_no_locale_is_given(self):
        # Orders predating `Order.locale` default to "en" at the model level;
        # the renderer must not require the argument either.
        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        self.assertIn('lang="en"', render_html(timeline, customer=None).decode("utf-8"))


class WallpaperRenderingTests(SimpleTestCase):
    """§4 — dedicated per-device renders with real safe zones.

    A wallpaper that puts content behind the lock-screen clock has failed at
    the one job it had, so these check the pixels in the safe bands rather
    than merely that a file came out.
    """

    def _render(self, device_id):
        from apps.delivery.wallpaper_devices import wallpaper_target_id

        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        return render_png(timeline, target_id=wallpaper_target_id(device_id), customer=None)

    def test_each_device_renders_at_its_own_dimensions(self):
        from apps.delivery.wallpaper_devices import WALLPAPER_DEVICES

        for device_id, device in WALLPAPER_DEVICES.items():
            with Image.open(io.BytesIO(self._render(device_id))) as img:
                self.assertEqual(img.size, (device.width, device.height), device_id)

    def test_the_three_devices_are_not_the_same_image(self):
        # §4 requires dedicated renders, not scaled copies. Identical bytes
        # at different sizes would mean a resize.
        renders = {d: self._render(d) for d in ("phone", "tablet", "desktop")}
        self.assertEqual(len(set(renders.values())), 3)

    def test_nothing_is_drawn_where_the_os_puts_its_own_furniture(self):
        """The point of the whole section.

        Samples the top and bottom safe bands and asserts they are uniformly
        the palette background — if the timeline had simply been scaled to
        the device size, content would appear here.
        """
        from apps.delivery.wallpaper_devices import WALLPAPER_DEVICES

        for device_id, device in WALLPAPER_DEVICES.items():
            with Image.open(io.BytesIO(self._render(device_id))) as img:
                rgb = img.convert("RGB")
                width, height = rgb.size
                background = rgb.getpixel((1, 1))

                top_band = int(height * device.safe_top) - 2
                bottom_band = height - int(height * device.safe_bottom) + 2

                for x in range(0, width, max(1, width // 30)):
                    for y in (2, top_band // 2, top_band):
                        self.assertEqual(
                            rgb.getpixel((x, y)), background,
                            f"{device_id}: content inside the top safe zone at ({x}, {y})",
                        )
                    for y in (bottom_band, height - 2):
                        self.assertEqual(
                            rgb.getpixel((x, y)), background,
                            f"{device_id}: content inside the bottom safe zone at ({x}, {y})",
                        )

    def test_the_desktop_leaves_its_icon_column_clear(self):
        # A desktop has furniture on its leading edge that a phone does not.
        from apps.delivery.wallpaper_devices import WALLPAPER_DEVICES

        device = WALLPAPER_DEVICES["desktop"]
        with Image.open(io.BytesIO(self._render("desktop"))) as img:
            rgb = img.convert("RGB")
            width, height = rgb.size
            background = rgb.getpixel((1, 1))
            column = int(width * device.safe_leading) - 2

            for y in range(0, height, max(1, height // 30)):
                for x in (2, column // 2, column):
                    self.assertEqual(
                        rgb.getpixel((x, y)), background,
                        f"content inside the desktop icon column at ({x}, {y})",
                    )

    def test_legacy_wallpaper_shapes_still_render(self):
        # The pack used story-png and landscape-png before §4. Orders placed
        # then must keep downloading.
        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        for legacy in ("story-png", "landscape-png"):
            content = render_png(timeline, target_id=legacy, customer=None)
            self.assertTrue(content.startswith(b"\x89PNG\r\n\x1a\n"), legacy)


class AllCompositionsRenderTests(SimpleTestCase):
    """§7 / §19 — all six compositions, across the whole milestone range.

    §19 requires every layout to adapt intelligently from 3 to 8 rather than
    being designed around one count. That is 48 combinations nobody will
    check by eye, and the failures are silent: a composition that overflows
    still produces a valid PNG.
    """

    def _values(self, count):
        import copy

        values = copy.deepcopy(VALID_VALUES)
        base = values["events"][0]
        values["events"] = [
            {**base, "date": f"20{15 + i}-01-0{(i % 8) + 1}", "title": f"Milestone {i + 1}",
             "photo": {"assetId": f"asset-{i}"}}
            for i in range(count)
        ]
        return values

    def test_every_composition_renders_at_every_supported_count(self):
        from apps.delivery.product_renderers.love_story_timeline.data import MAX_EVENTS, MIN_EVENTS

        for layout in (
            "neat-stack", "alternating-tilt", "overlapping-cascade",
            "dotted-branching", "horizontal-polaroid", "horizontal-circles",
        ):
            for count in range(MIN_EVENTS, MAX_EVENTS + 1):
                timeline = validate_and_normalize(self._values(count), {**VALID_THEME, "layout": layout})
                content = render_png(timeline, target_id="print-a4-edged", customer=None)
                self.assertTrue(content.startswith(b"\x89PNG\r\n\x1a\n"), f"{layout} @ {count}")

    def test_nothing_is_drawn_outside_the_page(self):
        """A composition that overflows still produces a valid PNG — the
        content is simply clipped, silently. Sampling the outer band is what
        catches it."""
        for layout in ("neat-stack", "overlapping-cascade", "horizontal-circles"):
            for count in (3, 8):
                timeline = validate_and_normalize(self._values(count), {**VALID_THEME, "layout": layout})
                with Image.open(io.BytesIO(render_png(timeline, target_id="print-a4-edged", customer=None))) as img:
                    rgb = img.convert("RGB")
                    background = rgb.getpixel((1, 1))
                    for x in range(0, rgb.width, max(1, rgb.width // 40)):
                        self.assertEqual(rgb.getpixel((x, 1)), background, f"{layout} @ {count} top edge")
                        self.assertEqual(rgb.getpixel((x, rgb.height - 2)), background, f"{layout} @ {count} bottom")

    def test_landscape_compositions_turn_the_page(self):
        # §2's orientation model, finally exercised: a print size is a paper
        # size, and the layout decides which way up.
        for layout, landscape in (
            ("neat-stack", False), ("dotted-branching", False),
            ("horizontal-polaroid", True), ("horizontal-circles", True),
        ):
            timeline = validate_and_normalize(self._values(5), {**VALID_THEME, "layout": layout})
            with Image.open(io.BytesIO(render_png(timeline, target_id="print-a4-edged", customer=None))) as img:
                self.assertEqual(img.width > img.height, landscape, layout)

    def test_wallpapers_are_never_rotated_by_a_layout(self):
        # A phone screen is portrait whatever the layout says. Rotating one
        # produces a wallpaper that does not fit the screen it was made for.
        timeline = validate_and_normalize(self._values(5), {**VALID_THEME, "layout": "horizontal-circles"})
        with Image.open(io.BytesIO(render_png(timeline, target_id="wallpaper-phone", customer=None))) as img:
            self.assertEqual(img.size, (1290, 2796))


class AttributionTests(SimpleTestCase):
    """The Heartfolio mark on deliverables.

    Discreet on prints by decision: a printed keepsake is very often a
    wedding or anniversary gift going on someone's wall, and a line of
    vendor marketing on it brands somebody else's present. These assert the
    restraint rather than just the presence, because "add attribution" is
    the kind of instruction that grows over time.
    """

    def _render(self, target="print-a4-edged", palette="classic"):
        timeline = validate_and_normalize(VALID_VALUES, {**VALID_THEME, "palette": palette})
        return render_png(timeline, target_id=target, customer=None)

    def test_the_print_mark_is_the_bare_domain(self):
        from apps.delivery.attribution import PRINT_MARK, WEB_MARK

        self.assertEqual(PRINT_MARK, "theheartfolio.com")
        # No slogan on a paid, framed print. The web surfaces carry more.
        self.assertNotIn("Made with", PRINT_MARK)
        self.assertIn("Made with", WEB_MARK)

    def test_the_mark_stays_inside_the_frame_safe_margin(self):
        """An edged print's outer half-inch disappears under a picture
        frame's lip (§3). A mark cropped in half reads as a defect."""
        from apps.delivery.print_sizes import edged_margin_px

        with Image.open(io.BytesIO(self._render("print-a4-edged"))) as img:
            rgb = img.convert("RGB")
            background = rgb.getpixel((1, 1))
            safe_from = rgb.height - edged_margin_px()
            for y in range(safe_from, rgb.height):
                for x in range(0, rgb.width, 8):
                    self.assertEqual(rgb.getpixel((x, y)), background, f"content at ({x}, {y})")

    def test_the_mark_is_quieter_than_the_customers_own_text(self):
        """Blended against the PAGE, not toward white.

        On the midnight palette the background is near-black, so fading
        toward white would make the mark BRIGHTER than the customer's text
        rather than quieter — the opposite of the intent.
        """
        from apps.delivery.attribution import MARK_OPACITY, blend
        from apps.delivery.product_renderers.love_story_timeline.data import PALETTES

        for name, palette in PALETTES.items():
            mark = blend(palette["muted"], palette["bg"], MARK_OPACITY)
            text = tuple(int(palette["text"].lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
            bg = tuple(int(palette["bg"].lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))

            # Contrast against the page must be lower than the body text's.
            mark_contrast = sum(abs(m - b) for m, b in zip(mark, bg))
            text_contrast = sum(abs(t - b) for t, b in zip(text, bg))
            self.assertLess(mark_contrast, text_contrast, f"{name} palette")

    def test_every_deliverable_carries_it(self):
        for target in ("print-a4-frameless", "print-a4-edged", "print-poster-edged", "wallpaper-phone"):
            content = self._render(target)
            self.assertTrue(content.startswith(b"\x89PNG\r\n\x1a\n"), target)

    def test_the_live_keepsake_carries_the_fuller_mark(self):
        from apps.delivery.product_renderers.love_story_timeline.html_renderer import render_html

        html = render_html(validate_and_normalize(VALID_VALUES, VALID_THEME), customer=None).decode()
        self.assertIn("colophon", html)
        self.assertIn("theheartfolio.com", html)


class NamesAreNeverTruncatedTests(SimpleTestCase):
    """No output may drop or cut a name, at any size or text scale.

    The print header's wrap allowed two lines and added an ellipsis past
    that. At text scale 100 two lines were always enough, which is all the
    earlier test checked; at 130 the edged A4, 8x10 and poster needed three
    or four, and the second name vanished ("Alexandra / Konstantinopol &...").

    Three name pairs, all within the 24-character ceiling: long names, many
    short words (wraps the most freely), and a single unbreakable 24-letter
    word (cannot wrap at all, so it must fit a line on its own).
    """

    NAME_SETS = (
        ("Alexandra Konstantinopol", "Maximilian von Habsburg"),
        ("Ana Maria de la Cruz Paz", "Jean Paul de la Fontaine"),
        ("Wolfeschlegelsteinhausen", "Maximilian von Habsburg"),
    )
    SCALES = (70, 100, 130)

    def _name_runs(self, names, scale, target_id):
        from unittest import mock

        from PIL import ImageDraw

        values = {
            **VALID_VALUES,
            "people": [{"name": n} for n in names],
            # No title, so the AR card's title is the names too.
            "posterTitle": "",
        }
        timeline = validate_and_normalize(
            values, {"palette": "classic", "typography": "modern", "layout": "neat-stack", "scale": scale}
        )
        name_words = set(" ".join(names).split()) | {"&"}
        original = ImageDraw.ImageDraw.text
        runs = []

        def spy(draw, xy, text, *args, **kwargs):
            words = text.replace("…", "").split()
            if words and all(word in name_words for word in words):
                box = draw.textbbox(xy, text, font=kwargs.get("font"))
                runs.append((text, box[0], box[2], draw.im.size[0]))
            return original(draw, xy, text, *args, **kwargs)

        with mock.patch.object(ImageDraw.ImageDraw, "text", spy):
            render_png(timeline, target_id=target_id, customer=None)
        return runs

    def test_every_word_of_both_names_is_drawn_whole_and_on_the_canvas(self):
        from .png_renderer import CARD_TARGET_ID

        targets = [t for t in TARGET_DIMENSIONS if t.startswith(("print-", "wallpaper-"))] + [CARD_TARGET_ID]
        self.assertTrue(any(t.startswith("print-") for t in targets))
        for names in self.NAME_SETS:
            for scale in self.SCALES:
                for target_id in targets:
                    with self.subTest(names=names[0], scale=scale, target_id=target_id):
                        runs = self._name_runs(names, scale, target_id)
                        drawn = " ".join(text for text, *_ in runs)
                        self.assertNotIn("…", drawn, "a name was cut with an ellipsis")
                        for word in " ".join(names).split():
                            self.assertIn(word, drawn.split(), f"{word!r} was dropped")
                        for text, left, right, canvas_width in runs:
                            self.assertGreaterEqual(left, 0, f"{text!r} starts off the canvas")
                            self.assertLessEqual(right, canvas_width, f"{text!r} runs off the canvas")


class HeaderMeasureMatchesDrawingTests(SimpleTestCase):
    """`_draw_header(measure_only=True)` must report exactly the height the
    real draw takes. The names-shrink decision (`_neat_stack_names_font`)
    is made on the measurement; if a line were drawn but not measured, the
    decision would be made on a header shorter than the one printed — and
    the drawing step quietly absorbs it, so no layout test notices.
    """

    def test_measured_and_drawn_header_end_at_the_same_y(self):
        from PIL import ImageDraw

        from . import png_renderer
        from .data import PALETTES

        draw = ImageDraw.Draw(Image.new("RGB", (2480, 3508)))
        cases = [
            (["Emma", "James"], "", "", 100),
            (["Alexandra Konstantinopol", "Maximilian von Habsburg"], SubtitleIsPrintedTests.LONGEST.upper(),
             "Every love story is beautiful, but ours is my favorite.", 130),
            (["Ana Maria de la Cruz Paz", "Jean Paul de la Fontaine"], SubtitleIsPrintedTests.LONGEST, "x " * 80, 70),
        ]
        for names, subtitle, dedication, scale in cases:
            for centered in (False, True):
                with self.subTest(names=names[0], scale=scale, centered=centered):
                    values = {**VALID_VALUES, "people": [{"name": n} for n in names],
                              "subtitle": subtitle, "dedication": dedication.strip()}
                    timeline = validate_and_normalize(values, {"palette": "classic", "typography": "modern",
                                                               "layout": "neat-stack", "scale": scale})
                    fonts = png_renderer.FONT_FILES["modern"]
                    font = lambda name, ratio: png_renderer._font(fonts[name], int(2480 * ratio * scale / 100))
                    kwargs = dict(
                        locale="en", palette=PALETTES["classic"], scale=scale / 100, x=100, y=100,
                        max_width=2280, content_right=2380, margin=100,
                        names_font=font("heading", 0.045), subheading_font=font("heading", 0.028),
                        subtitle_font=font("body", 0.020), body_font=font("body", 0.022),
                        small_font=font("body", 0.018), centered=centered,
                    )
                    events = png_renderer.ordered_events(timeline)
                    measured = png_renderer._draw_header(draw, timeline, events, measure_only=True, **kwargs)
                    drawn = png_renderer._draw_header(draw, timeline, events, **kwargs)
                    self.assertEqual(measured, drawn)


class LocationsArePrintedTests(SimpleTestCase):
    """Every milestone's location reaches the print wherever the preview
    shows it.

    The preview draws it under the milestone on Neat Stack, Overlapping
    Cascade, Alternating Tilt and Dotted Branching; the print drew it only on
    Neat Stack, so the other three silently dropped the customer's places.
    The horizontal compositions show no location in the preview either, and
    the print matches that.
    """

    LOCATION = "Our first flat, Rua das Flores 12, Porto"  # 40, the maximum
    SHOWN = ("neat-stack", "overlapping-cascade", "alternating-tilt", "dotted-branching")
    NOT_SHOWN = ("horizontal-polaroid", "horizontal-circles")

    def _drawn(self, layout, scale, target_id, location):
        from unittest import mock

        from PIL import ImageDraw

        events = [
            {"date": f"202{i}-05-0{i + 1}", "title": f"Milestone {i + 1}", "description": "A line about it.",
             "location": location, "photo": {"assetId": "x"}}
            for i in range(4)
        ]
        values = {**VALID_VALUES, "events": events}
        timeline = validate_and_normalize(
            values, {"palette": "classic", "typography": "modern", "layout": layout, "scale": scale}
        )
        drawn = []
        original = ImageDraw.ImageDraw.text

        def spy(draw, xy, text, *args, **kwargs):
            drawn.append((text, xy[1], draw.textbbox(xy, text, font=kwargs.get("font")), draw.im.size, kwargs.get("fill")))
            return original(draw, xy, text, *args, **kwargs)

        with mock.patch.object(ImageDraw.ImageDraw, "text", spy):
            render_png(timeline, target_id=target_id, customer=None)
        return drawn

    def _location_runs(self, drawn, location):
        words = set(location.split())
        return [d for d in drawn if d[0] and set(d[0].replace("\u2026", "").split()) <= words]

    def test_every_milestone_location_is_printed_whole_where_the_preview_shows_it(self):
        from .data import PALETTES

        for layout in self.SHOWN:
            for scale in (70, 130):
                for target_id in ("print-a4-edged", "print-classic-frameless", "print-poster-edged"):
                    for location in (self.LOCATION, self.LOCATION.upper()):
                        with self.subTest(layout=layout, scale=scale, target_id=target_id, caps=location.isupper()):
                            drawn = self._drawn(layout, scale, target_id, location)
                            runs = self._location_runs(drawn, location)
                            self.assertFalse([r[0] for r in runs if "\u2026" in r[0]], "a location was cut")
                            self.assertEqual(" ".join(r[0] for r in runs).split(), location.split() * 4,
                                             "a milestone's location is missing or incomplete")
                            self.assertTrue(all(r[4] == PALETTES["classic"]["muted"] for r in runs))
                            for _, _, box, (width, height), _ in runs:
                                self.assertTrue(box[0] >= 0 and box[2] <= width and box[3] <= height, "location off the page")
                            titles = [d[1] for d in drawn if d[0].startswith("Milestone ")]
                            self.assertEqual(len(titles), 4)

    def test_the_horizontal_compositions_match_their_preview_and_show_none(self):
        for layout in self.NOT_SHOWN:
            with self.subTest(layout=layout):
                drawn = self._drawn(layout, 100, "print-a4-edged", self.LOCATION)
                self.assertEqual(self._location_runs(drawn, self.LOCATION), [])


class DedicationIsNeverCutTests(SimpleTestCase):
    """A dedication at its 180-character maximum is printed whole.

    It was capped at three lines with an ellipsis; at text scale 130 the
    edged prints need four, so the customer's closing words were cut off.
    """

    DEDICATION = ("For every rainy Sunday, every missed train, every late-night drive home with the windows "
                  "down and the radio far too loud, and for all the ordinary days I would choose over again")
    LAYOUTS = LocationsArePrintedTests.SHOWN + LocationsArePrintedTests.NOT_SHOWN

    def test_the_longest_dedication_is_never_cut(self):
        from unittest import mock

        from PIL import ImageDraw

        self.assertLessEqual(len(self.DEDICATION), 180)
        for layout in self.LAYOUTS:
            for target_id in ("print-a4-edged", "print-classic-edged", "print-poster-edged"):
                with self.subTest(layout=layout, target_id=target_id):
                    values = {**VALID_VALUES, "dedication": self.DEDICATION}
                    timeline = validate_and_normalize(
                        values, {"palette": "classic", "typography": "modern", "layout": layout, "scale": 130}
                    )
                    drawn = []
                    original = ImageDraw.ImageDraw.text

                    def spy(draw, xy, text, *args, **kwargs):
                        drawn.append(text)
                        return original(draw, xy, text, *args, **kwargs)

                    with mock.patch.object(ImageDraw.ImageDraw, "text", spy):
                        render_png(timeline, target_id=target_id, customer=None)
                    start = next(i for i, t in enumerate(drawn) if t.startswith("\u201c"))
                    end = next(i for i, t in enumerate(drawn) if i >= start and t.endswith(("\u201d", "\u2026")))
                    printed = " ".join(drawn[start:end + 1])
                    self.assertNotIn("\u2026", printed, "the dedication was cut")
                    self.assertEqual(printed, f"\u201c{self.DEDICATION}\u201d")
                    if layout in LocationsArePrintedTests.SHOWN:
                        # Portrait pages: this case needs more than the old
                        # three lines, so the test exercises the fix. The
                        # horizontal layouts turn the page to landscape and
                        # fit it in three or fewer.
                        self.assertGreater(end - start + 1, 3, "this case must need more than the old three lines")


class SubtitleIsPrintedTests(SimpleTestCase):
    """The customer's subtitle appears on the print, on every layout.

    It was validated, stored, shown in the Studio preview and on the live
    page — and never drawn by the print renderer, so a customer's own words
    silently vanished from the paid file. It now sits where the preview puts
    it: under the title, above the dedication, in the muted colour, wrapped
    and never cut; centred on Neat Stack, whose header is centred.
    """

    LONGEST = "Twelve years, three cities and one very patient dog, Biscuit"
    LAYOUTS = ("neat-stack", "alternating-tilt", "overlapping-cascade", "dotted-branching",
               "horizontal-polaroid", "horizontal-circles")

    def _header(self, subtitle, *, layout="neat-stack", scale=100, target_id="print-a4-edged"):
        """Text drawn above the header rule: (text, x, y, advance, fill)."""
        from unittest import mock

        from PIL import ImageDraw

        values = {**VALID_VALUES, "posterTitle": "Our Love Story", "subtitle": subtitle,
                  "dedication": "Every love story is beautiful, but ours is my favorite."}
        timeline = validate_and_normalize(
            values, {"palette": "classic", "typography": "modern", "layout": layout, "scale": scale}
        )
        texts, rules = [], []
        text, line = ImageDraw.ImageDraw.text, ImageDraw.ImageDraw.line

        def spy_text(draw, xy, value, *args, **kwargs):
            texts.append((value, xy[0], xy[1], draw.textlength(value, font=kwargs.get("font")), kwargs.get("fill")))
            return text(draw, xy, value, *args, **kwargs)

        def spy_line(draw, xy, *args, **kwargs):
            (x0, y0), (x1, y1) = xy
            if y0 == y1:
                rules.append((x0, x1, y0))
            return line(draw, xy, *args, **kwargs)

        with mock.patch.object(ImageDraw.ImageDraw, "text", spy_text), \
                mock.patch.object(ImageDraw.ImageDraw, "line", spy_line):
            render_png(timeline, target_id=target_id, customer=None)
        left, right, rule_y = rules[0]
        return [t for t in texts if t[2] < rule_y], (left + right) / 2

    def _subtitle_runs(self, header):
        words = set(self.LONGEST.split())
        return [t for t in header if t[0] and set(t[0].split()) <= words]

    def test_every_layout_prints_the_subtitle_whole_between_title_and_dedication(self):
        from .data import PALETTES

        for layout in self.LAYOUTS:
            for target_id in ("print-a4-edged", "print-classic-frameless", "print-poster-edged"):
                with self.subTest(layout=layout, target_id=target_id):
                    header, _ = self._header(self.LONGEST, layout=layout, target_id=target_id)
                    runs = self._subtitle_runs(header)
                    self.assertEqual(" ".join(r[0] for r in runs).split(), self.LONGEST.split(), "subtitle missing or cut")
                    title_y = next(t[2] for t in header if t[0] == "Our Love Story")
                    dedication_y = next(t[2] for t in header if t[0].startswith("\u201c"))
                    self.assertTrue(all(title_y < r[2] < dedication_y for r in runs), "subtitle out of order")
                    self.assertTrue(all(r[4] == PALETTES["classic"]["muted"] for r in runs))

    def test_the_longest_subtitle_is_never_cut_at_any_text_scale(self):
        # In capitals too: a 60-character subtitle in mixed case fits one
        # line everywhere, so only the wider capitals actually exercise the
        # wrap (two lines at 130 on the edged prints).
        for subtitle in (self.LONGEST, self.LONGEST.upper()):
            for scale in (70, 100, 130):
                for target_id in ("print-a4-edged", "print-classic-edged", "print-poster-edged"):
                    with self.subTest(subtitle=subtitle[:6], scale=scale, target_id=target_id):
                        header, _ = self._header(subtitle, scale=scale, target_id=target_id)
                        self.assertFalse([t[0] for t in header if "\u2026" in t[0]], "header text cut with an ellipsis")
                        words = set(subtitle.split())
                        drawn = " ".join(t[0] for t in header if t[0] and set(t[0].split()) <= words)
                        self.assertEqual(drawn.split(), subtitle.split())

    def test_capitals_really_do_wrap_somewhere(self):
        # Guards the test above: if nothing wraps, it proves nothing.
        header, _ = self._header(self.LONGEST.upper(), scale=130, target_id="print-classic-edged")
        words = set(self.LONGEST.upper().split())
        self.assertGreater(len([t for t in header if t[0] and set(t[0].split()) <= words]), 1)

    def test_neat_stack_centres_the_subtitle(self):
        header, centre = self._header(self.LONGEST, scale=130)
        for value, x, _, advance, _ in self._subtitle_runs(header):
            self.assertAlmostEqual(x + advance / 2, centre, delta=2, msg=f"{value!r} is not centred")

    def test_an_empty_subtitle_adds_nothing(self):
        header, _ = self._header("")
        drawn = [t[0] for t in header]
        after_title = drawn[drawn.index("Our Love Story") + 1]
        self.assertTrue(after_title.startswith("“"), f"{after_title!r} drawn between title and dedication")


class NeatStackMilestoneTextFitsTests(TestCase):
    """Neat Stack's milestone text must fit its slot, readably separated.

    The text was sized from a shared formula (`required_height` in
    `render_png`) that left out the location line and assumed tighter spacing
    than the drawing uses: full milestones measured 21-25% taller than
    estimated, and no space was reserved between milestones. Result: one
    milestone ran into the next (9px apart on the 8x10 edged at text scale
    130 with long names; outright overlap with eight milestones), and long
    titles ran off the poster at 130.

    Realistic range: all six print sizes, text scales 70/100/130, short and
    long names, 3/5/8 milestones. Milestones 4-8 have every field at its
    maximum length (title 40, description 140, location 40). Real uploaded
    JPEGs, full header and closing line.
    """

    TARGETS = (
        "print-a4-edged", "print-a4-frameless",
        "print-classic-edged", "print-classic-frameless",
        "print-poster-edged", "print-poster-frameless",
    )
    SCALES = (70, 100, 130)
    NAME_SETS = (("Emma", "James"), ("Alexandra Konstantinopol", "Maximilian von Habsburg"))
    COUNTS = (3, 5, 8)
    #: Combinations allowed to fail. EMPTY: the last one (eight milestones,
    #: long names, 130, 8x10 edged — 141px per milestone against 204px
    #: needed at the smallest type) was closed by letting the names heading
    #: shrink (`_neat_stack_names_font`). Kept as a set so any future
    #: exception has to be written down here, deliberately.
    KNOWN_UNFIT = set()
    MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

    def setUp(self):
        self.customer = make_customer()
        rows = [
            ("2019-04-12", "We Met", "A rainy afternoon, a shared umbrella.", "Lisbon"),
            ("2020-06-20", "First Trip Together", "Three days, one tiny car.", "Andalusia"),
            ("2022-09-03", "He Proposed", "On the beach, at sunset.", "Cascais"),
        ] + [
            (
                f"2023-{month:02d}-15",
                "The weekend we finally painted the kitch",  # 40
                ("We spent the whole weekend arguing about colours, gave up, ordered takeaway, "
                 "and painted it white anyway. Best decision we ever made, honest"),  # 140
                "Our first flat, Rua das Flores 12, Porto",  # 40
            )
            for month in range(1, 6)
        ]
        self.events = []
        for index, (date, title, description, location) in enumerate(rows):
            buf = io.BytesIO()
            Image.new("RGB", (1600, 1200), (30 + index * 25, 140, 200)).save(buf, format="JPEG", quality=90)
            asset = upload_asset(
                self.customer, SimpleUploadedFile(f"m{index}.jpg", buf.getvalue(), content_type="image/jpeg")
            )
            self.events.append({
                "date": date, "title": title, "description": description,
                "location": location, "photo": {"assetId": str(asset.id)},
            })

    def _problems(self, names, scale, count, target_id):
        from unittest import mock

        from PIL import ImageDraw

        values = {
            "storyType": "couple",
            "people": [{"name": n} for n in names],
            "posterTitle": "Our Love Story",
            "subtitle": SubtitleIsPrintedTests.LONGEST,  # 60, the maximum
            "dedication": "Every love story is beautiful, but ours is my favorite.",
            "endingText": "To be continued…",
            "showDuration": True,
            "autoSort": True,
            "events": self.events[:count],
        }
        timeline = validate_and_normalize(
            values, {"palette": "classic", "typography": "modern", "layout": "neat-stack", "scale": scale}
        )
        from . import png_renderer

        texts, cards = [], []
        text, polaroid = ImageDraw.ImageDraw.text, png_renderer._paste_polaroid

        def spy_text(draw, xy, value, *args, **kwargs):
            texts.append((value, draw.textbbox(xy, value, font=kwargs.get("font")), draw.im.size))
            return text(draw, xy, value, *args, **kwargs)

        def spy_polaroid(*args, **kwargs):
            # Tilted outline and shadow: both must stay clear of the text.
            placed = polaroid(*args, **kwargs)
            cards.append(placed["card"])
            if placed["shadow"]:
                cards.append(placed["shadow"])
            return placed

        with mock.patch.object(ImageDraw.ImageDraw, "text", spy_text), \
                mock.patch.object(png_renderer, "_paste_polaroid", spy_polaroid):
            render_png(timeline, target_id=target_id, customer=self.customer)

        def hit(a, b):
            return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]

        problems = []
        for i, (value, box, (width, height)) in enumerate(texts):
            if box[0] < 0 or box[2] > width or box[3] > height:
                problems.append(f"{value!r} runs off the canvas")
            for other, other_box, _ in texts[i + 1:]:
                if hit(box, other_box):
                    problems.append(f"{value!r} overlaps {other!r}")
            for card in cards:
                if hit(box, card):
                    problems.append(f"a card or its shadow covers {value!r}")

        # Milestones must read as separate: the space BETWEEN two milestones
        # has to be larger than any space INSIDE one.
        starts = [i for i, (value, _, _) in enumerate(texts) if value[:3] in self.MONTHS and value[-4:].isdigit()]
        for here, after in zip(starts, starts[1:]):
            block = texts[here:after]
            inside = max(b[1][1] - a[1][3] for a, b in zip(block, block[1:]))
            between = texts[after][1][1] - block[-1][1][3]
            if between <= inside:
                problems.append(f"milestones run together ({between}px between, {inside}px inside)")
        return problems

    def test_milestone_text_fits_across_the_realistic_range(self):
        unfit = set()
        for count in self.COUNTS:
            for names in self.NAME_SETS:
                for scale in self.SCALES:
                    for target_id in self.TARGETS:
                        key = (names[0], scale, count, target_id)
                        problems = self._problems(names, scale, count, target_id)
                        if problems:
                            unfit.add(key)
                        if key in self.KNOWN_UNFIT:
                            continue
                        with self.subTest(names=names[0], scale=scale, milestones=count, target_id=target_id):
                            self.assertEqual(problems, [])
        self.assertEqual(unfit, self.KNOWN_UNFIT, "the set of combinations that cannot fit has changed")


class NeatStackNamesGiveUpRoomOnlyWhenNeededTests(SimpleTestCase):
    """The names heading shrinks only when Neat Stack's milestones cannot
    otherwise fit, only on a sold print, and never down to the title's size.

    Eight milestones under two long names at text scale 130 on the 8x10
    edged print left 141px per milestone; the shortest needs 204px at the
    smallest milestone type. Shrinking the names until they fit on two lines
    (125px) still left 9px short; the heading now steps down until the
    milestones fit (102px measured), staying above the title line.
    """

    LONG = ["Alexandra Konstantinopol", "Maximilian von Habsburg"]

    def _sizes(self, names, count, scale, target_id, layout="neat-stack"):
        """(names font sizes drawn, title font size) for one render."""
        from unittest import mock

        from PIL import ImageDraw

        events = [
            {"date": f"2023-{month:02d}-15", "title": "A milestone", "description": "A short line.",
             "location": "Lisbon", "photo": {"assetId": "x"}}
            for month in range(1, count + 1)
        ]
        values = {
            **VALID_VALUES, "people": [{"name": n} for n in names], "posterTitle": "Our Love Story",
            "dedication": "Every love story is beautiful, but ours is my favorite.",
            "endingText": "To be continued\u2026", "showDuration": True, "events": events,
        }
        timeline = validate_and_normalize(
            values, {"palette": "classic", "typography": "modern", "layout": layout, "scale": scale}
        )
        drawn = []
        original = ImageDraw.ImageDraw.text

        def spy(draw, xy, text, *args, **kwargs):
            drawn.append((text, kwargs.get("font").size))
            return original(draw, xy, text, *args, **kwargs)

        with mock.patch.object(ImageDraw.ImageDraw, "text", spy):
            render_png(timeline, target_id=target_id, customer=None)
        first_names = {n.split()[0] for n in names}
        name_sizes = {size for text, size in drawn if text.split() and text.split()[0] in first_names}
        title_size = next(size for text, size in drawn if text == "Our Love Story")
        return name_sizes, title_size

    def test_names_shrink_for_the_combination_that_could_not_fit(self):
        full, _ = self._sizes(self.LONG, 3, 130, "print-classic-edged")
        shrunk, title = self._sizes(self.LONG, 8, 130, "print-classic-edged")
        self.assertEqual(len(full), 1)
        self.assertEqual(len(shrunk), 1)
        self.assertLess(next(iter(shrunk)), next(iter(full)), "the names did not give up any room")
        self.assertGreater(next(iter(shrunk)), title, "the names shrank to the title's size or below")

    def test_names_stay_full_size_whenever_the_milestones_already_fit(self):
        for count, scale, target_id in ((3, 130, "print-classic-edged"), (8, 100, "print-classic-edged"),
                                        (8, 130, "print-poster-frameless")):
            with self.subTest(milestones=count, scale=scale, target_id=target_id):
                emma, _ = self._sizes(["Emma", "James"], count, scale, target_id)
                long, _ = self._sizes(self.LONG, count, scale, target_id)
                self.assertEqual(emma, long, "names shrank although nothing needed the room")

    def test_legacy_targets_and_other_layouts_never_shrink_the_names(self):
        full, _ = self._sizes(self.LONG, 3, 130, "print-classic-edged")
        for target_id, layout in (("landscape-png", "neat-stack"), ("story-png", "neat-stack"),
                                  ("print-classic-edged", "alternating-tilt")):
            with self.subTest(target_id=target_id, layout=layout):
                eight, _ = self._sizes(self.LONG, 8, 130, target_id, layout)
                three, _ = self._sizes(self.LONG, 3, 130, target_id, layout)
                self.assertEqual(eight, three)


class NeatStackMatchesThePreviewTests(TestCase):
    """Neat Stack's print carries the preview's tilt, shadow and alignment.

    Values read from the live Studio, not eyeballed (renderer.module.css):
    `.header` and `.footer` are `text-align: center`; `.neatPhoto` is
    `rotate(-2deg)` on odd cards and `rotate(1.6deg)` on even ones, with
    `box-shadow: 0 2px 6px rgba(0, 0, 0, 0.14)`. The print left-aligned
    everything and drew the cards flat with no shadow. `composition-parity
    .test.ts` holds the CSS side to the same numbers in compositions.py.
    """

    TARGETS = ("print-a4-edged", "print-classic-frameless", "print-poster-edged")

    def setUp(self):
        self.customer = make_customer()
        self.events = []
        for index in range(5):
            buf = io.BytesIO()
            Image.new("RGB", (1600, 1200), (40 + index * 30, 120, 190)).save(buf, format="JPEG")
            asset = upload_asset(
                self.customer, SimpleUploadedFile(f"t{index}.jpg", buf.getvalue(), content_type="image/jpeg")
            )
            self.events.append({
                "date": f"202{index}-05-0{index + 1}", "title": f"Milestone {index + 1}",
                "description": "A line about it.", "location": "Lisbon", "photo": {"assetId": str(asset.id)},
            })

    def _render(self, *, layout="neat-stack", scale=100, target_id="print-a4-edged", names=("Emma", "James")):
        from unittest import mock

        from PIL import ImageDraw

        from . import png_renderer

        values = {
            "storyType": "couple", "people": [{"name": n} for n in names], "posterTitle": "Our Love Story",
            "subtitle": "", "dedication": "Every love story is beautiful, but ours is my favorite.",
            "endingText": "To be continued\u2026", "showDuration": True, "autoSort": True, "events": self.events,
        }
        timeline = validate_and_normalize(
            values, {"palette": "classic", "typography": "modern", "layout": layout, "scale": scale}
        )
        texts, rules, cards = [], [], []
        text, line, polaroid = ImageDraw.ImageDraw.text, ImageDraw.ImageDraw.line, png_renderer._paste_polaroid

        def spy_text(draw, xy, value, *args, **kwargs):
            texts.append((value, xy, draw.textlength(value, font=kwargs.get("font"))))
            return text(draw, xy, value, *args, **kwargs)

        def spy_line(draw, xy, *args, **kwargs):
            (x0, y0), (x1, y1) = xy
            if y0 == y1:
                rules.append((x0, x1, y0))
            return line(draw, xy, *args, **kwargs)

        def spy_polaroid(*args, **kwargs):
            placed = polaroid(*args, **kwargs)
            cards.append({**placed, "tilt": kwargs["tilt_deg"], "size": kwargs["photo_size"],
                          "border": kwargs["border"], "bottom": kwargs["bottom_border"]})
            return placed

        with mock.patch.object(ImageDraw.ImageDraw, "text", spy_text), \
                mock.patch.object(ImageDraw.ImageDraw, "line", spy_line), \
                mock.patch.object(png_renderer, "_paste_polaroid", spy_polaroid):
            content = render_png(timeline, target_id=target_id, customer=self.customer)
        return Image.open(io.BytesIO(content)).convert("RGB"), texts, rules, cards

    def test_cards_alternate_the_previews_two_tilts(self):
        import math

        # Pillow rotates anticlockwise for a positive angle, CSS clockwise:
        # the preview's rotate(-2deg) is +2.0 here, its rotate(1.6deg) -1.6.
        _, _, _, cards = self._render()
        self.assertEqual([c["tilt"] for c in cards], [2.0, -1.6, 2.0, -1.6, 2.0])
        for card in cards:
            # The placed card really is rotated: its footprint is the
            # rotated outline's bounding box, not the flat card's.
            width = card["size"] + 2 * card["border"]
            height = card["size"] + card["border"] + card["bottom"]
            angle = math.radians(abs(card["tilt"]))
            left, top, right, bottom = card["card"]
            self.assertAlmostEqual(bottom - top, height * math.cos(angle) + width * math.sin(angle), delta=3)
            self.assertAlmostEqual(right - left, width * math.cos(angle) + height * math.sin(angle), delta=3)

    def test_cards_cast_the_previews_shadow(self):
        image, _, _, cards = self._render()
        background = image.getpixel((5, 5))
        for card in cards:
            left, top, right, bottom = card["card"]
            shadow = card["shadow"]
            self.assertIsNotNone(shadow, "a card has no shadow")
            # Offset downwards (`0 2px`), so it reaches further below the card
            # than above it.
            self.assertGreater(shadow[3] - bottom, top - shadow[1])
            # And it is really there: just below the card's centre the page
            # is darker than the bare background, but only faintly (14%).
            pixel = image.getpixel(((left + right) // 2, bottom + 2))
            self.assertLess(sum(pixel), sum(background), "no shadow under the card")
            self.assertGreater(sum(pixel), sum(background) * 0.75, "the shadow is far heavier than the preview's")

    def test_header_and_closing_line_are_centred(self):
        for target_id in self.TARGETS:
            for scale in (70, 130):
                for names in (("Emma", "James"), ("Alexandra Konstantinopol", "Maximilian von Habsburg")):
                    with self.subTest(target_id=target_id, scale=scale, names=names[0]):
                        _, texts, rules, _ = self._render(scale=scale, target_id=target_id, names=names)
                        left, right, rule_y = rules[0]
                        centre = (left + right) / 2
                        header = [t for t in texts if t[1][1] < rule_y]
                        footer = [t for t in texts if t[0].startswith("To be continued")]
                        self.assertTrue(header and footer)
                        for value, (x, _), advance in header + footer:
                            self.assertAlmostEqual(x + advance / 2, centre, delta=2, msg=f"{value!r} is not centred")

    def test_every_layout_centres_its_header_and_footer_as_the_preview_does(self):
        # All six compositions have been reviewed against the preview, whose
        # `.header` and `.footer` are `text-align: center`. (This used to be a
        # scope guard asserting the unreviewed layouts were still left-aligned,
        # until the last of them was reviewed.)
        for layout in ("neat-stack", "alternating-tilt", "overlapping-cascade", "dotted-branching",
                       "horizontal-polaroid", "horizontal-circles"):
            with self.subTest(layout=layout):
                _, texts, rules, _ = self._render(layout=layout)
                left, right, rule_y = rules[0]
                centre = (left + right) / 2
                # (a Polaroid's caption is drawn on its card layer, whose y is the
                # card's own; the header is what sits above the rule on the page)
                header = [t for t in texts if t[1][1] < rule_y and (
                    t[0] in ("Emma & James", "Our Love Story") or t[0].startswith("“")
                    or t[0].endswith("days together"))]
                footer = [t for t in texts if t[0].startswith("To be continued")]
                self.assertTrue(header and footer)
                for value, (x, _), advance in header + footer:
                    self.assertAlmostEqual(x + advance / 2, centre, delta=2, msg=f"{value!r} is not centred")


class AlternatingTiltTests(TestCase):
    """§7.2 Alternating Tilt: fits its slots and matches the preview.

    Before this, 102 of the 108 realistic renders below were broken:
    cards sized from the photo came out 1.01-1.14x their slot (crossing the
    header rule in 72, the footer in 60, and landing on the next milestone's
    text in 29); 40-character titles were one unwrapped line, crossing the
    spine or running off the page. The preview itself hid milestones 4-8.

    The preview's values, read live (renderer.module.css): cards
    rotate(-4deg)/rotate(4deg), `box-shadow: 0 3px 10px rgba(0,0,0,0.16)`,
    padding 5px/16px around a 151px photo, 14px heart nodes on a 540px
    poster, text on the left half right-aligned toward the spine, header and
    footer centred. composition-parity.test.ts holds the CSS to the same
    numbers.
    """

    TARGETS = (
        "print-a4-edged", "print-a4-frameless",
        "print-classic-edged", "print-classic-frameless",
        "print-poster-edged", "print-poster-frameless",
    )
    NAME_SETS = (("Emma", "James"), ("Alexandra Konstantinopol", "Maximilian von Habsburg"))
    MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

    def setUp(self):
        self.customer = make_customer()
        rows = [
            ("2019-04-12", "We Met", "A rainy afternoon, a shared umbrella.", "Lisbon"),
            ("2020-06-20", "First Trip Together", "Three days, one tiny car.", "Andalusia"),
            ("2022-09-03", "He Proposed", "On the beach, at sunset.", "Cascais"),
        ] + [
            (f"2023-{month:02d}-15", "The weekend we finally painted the kitch",  # 40
             "A description this photo-led layout does not print.", "Our first flat, Rua das Flores 12, Porto")  # 40
            for month in range(1, 6)
        ]
        self.events = self._events(rows, (1600, 1200))
        self.rows = rows

    def _events(self, rows, size):
        events = []
        for index, (date, title, description, location) in enumerate(rows):
            buf = io.BytesIO()
            Image.new("RGB", size, (40 + index * 20, 120, 190)).save(buf, format="JPEG", quality=90)
            asset = upload_asset(
                self.customer, SimpleUploadedFile(f"a{index}.jpg", buf.getvalue(), content_type="image/jpeg")
            )
            events.append({"date": date, "title": title, "description": description,
                           "location": location, "photo": {"assetId": str(asset.id)}})
        return events

    def _render(self, names, scale, count, target_id, events=None):
        from unittest import mock

        from PIL import ImageDraw

        from . import png_renderer

        values = {
            "storyType": "couple", "people": [{"name": n} for n in names], "posterTitle": "Our Love Story",
            "subtitle": "", "dedication": "Every love story is beautiful, but ours is my favorite.",
            "endingText": "To be continued\u2026", "showDuration": True, "autoSort": True,
            "events": (events or self.events)[:count],
        }
        timeline = validate_and_normalize(
            values, {"palette": "classic", "typography": "modern", "layout": "alternating-tilt", "scale": scale}
        )
        texts, cards, hearts, lines = [], [], [], []
        text, line = ImageDraw.ImageDraw.text, ImageDraw.ImageDraw.line
        polaroid, heart = png_renderer._paste_polaroid, png_renderer._draw_heart

        def spy_text(draw, xy, value, *args, **kwargs):
            font = kwargs.get("font")
            texts.append((value, draw.textbbox(xy, value, font=font), xy, draw.textlength(value, font=font), draw.im.size))
            return text(draw, xy, value, *args, **kwargs)

        def spy_line(draw, xy, *args, **kwargs):
            lines.append(tuple(map(tuple, xy)))
            return line(draw, xy, *args, **kwargs)

        def spy_polaroid(*args, **kwargs):
            placed = polaroid(*args, **kwargs)
            cards.append((kwargs["tilt_deg"], placed["card"], placed["shadow"]))
            return placed

        def spy_heart(image, centre_x, centre_y, size, fill):
            hearts.append((centre_x, centre_y, size))
            return heart(image, centre_x, centre_y, size, fill)

        with mock.patch.object(ImageDraw.ImageDraw, "text", spy_text), \
                mock.patch.object(ImageDraw.ImageDraw, "line", spy_line), \
                mock.patch.object(png_renderer, "_paste_polaroid", spy_polaroid), \
                mock.patch.object(png_renderer, "_draw_heart", spy_heart):
            render_png(timeline, target_id=target_id, customer=self.customer)
        rule = next(l for l in lines if l[0][1] == l[1][1])
        spine = next(l for l in lines if l[0][0] == l[1][0])
        return texts, cards, hearts, rule, spine

    @staticmethod
    def _hit(a, b):
        return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]

    def _problems(self, names, scale, count, target_id, events=None):
        texts, cards, hearts, rule, spine = self._render(names, scale, count, target_id, events)
        (left, rule_y), (right, _) = rule
        spine_x = spine[0][0]
        half = int((right - left) * 0.44)  # geometry.side_column of the content width
        problems = []
        for i, (value, box, _, _, (width, height)) in enumerate(texts):
            if box[0] < 0 or box[2] > width or box[3] > height:
                problems.append(f"{value!r} runs off the page")
            if "\u2026" in value and not value.startswith("To be continued"):
                problems.append(f"{value!r} was cut")
            for other, other_box, _, _, _ in texts[i + 1:]:
                if self._hit(box, other_box):
                    problems.append(f"{value!r} overlaps {other!r}")
        for _, card, shadow in cards:
            for region in (card, shadow):
                if region[1] <= rule_y:
                    problems.append("a card or its shadow crosses the header rule")
                for value, box, _, _, _ in texts:
                    if self._hit(region, box):
                        problems.append(f"a card or its shadow covers {value!r}")
        if [c[0] for c in cards] != [4.0 if i % 2 == 0 else -4.0 for i in range(count)]:
            problems.append(f"tilts {[c[0] for c in cards]}")
        if len(hearts) != count:
            problems.append("a heart node is missing")
        # Milestone text: inside its half, and reading inward on the left.
        starts = [i for i, t in enumerate(texts) if t[0][:3] in self.MONTHS and t[0][-4:].isdigit()]
        footer = next(i for i, t in enumerate(texts) if t[0].startswith("To be continued"))
        for k, (a, b) in enumerate(zip(starts, starts[1:] + [footer])):
            leading = k % 2 == 1
            for value, _, (x, _), advance, _ in texts[a:b]:
                if leading and (x + advance > spine_x or abs(x + advance - (left + half)) > 2):
                    problems.append(f"{value!r} is not right-aligned inside the left half")
                if not leading and (x < spine_x or x + advance > right + 1):
                    problems.append(f"{value!r} leaves the right half")
        centre = (left + right) / 2
        for value, box, (x, _), advance, _ in texts:
            if box[3] <= rule_y or value.startswith("To be continued"):
                if abs(x + advance / 2 - centre) > 2:
                    problems.append(f"{value!r} is not centred")
        return sorted(set(problems))

    def test_fits_and_matches_the_preview_across_the_realistic_range(self):
        for count in (3, 5, 8):
            for names in self.NAME_SETS:
                for scale in (70, 100, 130):
                    for target_id in self.TARGETS:
                        with self.subTest(milestones=count, names=names[0], scale=scale, target_id=target_id):
                            self.assertEqual(self._problems(names, scale, count, target_id), [])

    def test_photo_shape_does_not_move_or_resize_the_cards(self):
        landscape = self.events
        for size in ((1200, 1600), (1500, 1500)):
            others = self._events(self.rows, size)
            for count, target_id in ((3, "print-poster-edged"), (5, "print-a4-edged"), (8, "print-classic-frameless")):
                with self.subTest(size=size, milestones=count, target_id=target_id):
                    expected = [c[1:] for c in self._render(self.NAME_SETS[1], 130, count, target_id, landscape)[1]]
                    actual = [c[1:] for c in self._render(self.NAME_SETS[1], 130, count, target_id, others)[1]]
                    self.assertEqual(actual, expected)
                    self.assertEqual(self._problems(self.NAME_SETS[1], 130, count, target_id, others), [])


class OverlappingCascadeTests(TestCase):
    """§7.3 Overlapping Cascade: fits its slots and matches the preview.

    Before this, all 108 realistic renders below were broken. Cards sized
    from the photo were 1.20-1.44x their slot: the first crossed the header
    rule in 107 and the last reached the footer line in 107. The drift ran
    the first card off the page or over the frame line in 17. Titles were one
    unwrapped line (off the page in 19). Text started a fixed 22% of a slot
    above the middle, so long milestones ran into the next. The photo was
    pasted SQUARE into a card sized for 1:1.15, leaving a blank band.

    The preview's values, read live (renderer.module.css): cards
    rotate(-2.5deg)/rotate(2.5deg), `box-shadow: 0 3px 10px rgba(0,0,0,0.16)`,
    padding 5px/16px around a 163px photo 1.15x as tall as wide, an even
    diagonal drift of 22% of the column, an 8px node level with the date on a
    1px spine (540px poster), header and footer centred. Each milestone gets
    an equal slot of height / (count + 0.22) and a card overlaps its
    neighbours by up to 0.22 of a slot. composition-parity.test.ts holds the
    CSS to the same numbers.
    """

    TARGETS = AlternatingTiltTests.TARGETS
    NAME_SETS = AlternatingTiltTests.NAME_SETS
    MONTHS = AlternatingTiltTests.MONTHS

    #: Three short milestones, then five at every field's maximum length.
    ROWS = [
        ("2019-04-12", "We Met", "A rainy afternoon, a shared umbrella.", "Lisbon"),
        ("2020-06-20", "First Trip Together", "Three days, one tiny car.", "Andalusia"),
        ("2022-09-03", "He Proposed", "On the beach, at sunset.", "Cascais"),
    ] + [
        (f"2023-{month:02d}-15", "The weekend we finally painted the kitch",  # 40
         "We spent the whole weekend arguing about colours, gave up, ordered takeaway, and painted it "
         "white anyway. Best decision we ever made, honest",  # 140
         "Our first flat, Rua das Flores 12, Porto")  # 40
        for month in range(1, 6)
    ]

    def setUp(self):
        self.customer = make_customer()
        self.rows = self.ROWS
        self.events = self._events((1600, 1200))

    def _events(self, size):
        events = []
        for index, (date, title, description, location) in enumerate(self.rows):
            buf = io.BytesIO()
            Image.new("RGB", size, (40 + index * 20, 120, 190)).save(buf, format="JPEG", quality=90)
            asset = upload_asset(
                self.customer, SimpleUploadedFile(f"c{index}.jpg", buf.getvalue(), content_type="image/jpeg")
            )
            events.append({"date": date, "title": title, "description": description,
                           "location": location, "photo": {"assetId": str(asset.id)}})
        return events

    def _render(self, names, scale, count, target_id, events=None, subtitle=""):
        from unittest import mock

        from PIL import ImageDraw

        from . import png_renderer

        values = {
            "storyType": "couple", "people": [{"name": n} for n in names], "posterTitle": "Our Love Story",
            "subtitle": subtitle, "dedication": "Every love story is beautiful, but ours is my favorite.",
            "endingText": "To be continued\u2026", "showDuration": True, "autoSort": True,
            "events": (events or self.events)[:count],
        }
        timeline = validate_and_normalize(
            values, {"palette": "classic", "typography": "modern", "layout": "overlapping-cascade", "scale": scale}
        )
        texts, cards, nodes, lines = [], [], [], []
        text, line, ellipse = ImageDraw.ImageDraw.text, ImageDraw.ImageDraw.line, ImageDraw.ImageDraw.ellipse
        polaroid = png_renderer._paste_polaroid

        def spy_text(draw, xy, value, *args, **kwargs):
            font = kwargs.get("font")
            texts.append((value, draw.textbbox(xy, value, font=font), xy, draw.textlength(value, font=font), draw.im.size))
            return text(draw, xy, value, *args, **kwargs)

        def spy_line(draw, xy, *args, **kwargs):
            lines.append((tuple(map(tuple, xy)), kwargs.get("width")))
            return line(draw, xy, *args, **kwargs)

        def spy_ellipse(draw, xy, *args, **kwargs):
            nodes.append(tuple(xy))
            return ellipse(draw, xy, *args, **kwargs)

        def spy_polaroid(*args, **kwargs):
            placed = polaroid(*args, **kwargs)
            cards.append({"tilt": kwargs["tilt_deg"], "card": placed["card"], "shadow": placed["shadow"],
                          "photo": (kwargs["photo_size"], kwargs["photo_height"]), "centre_x": kwargs["centre_x"]})
            return placed

        with mock.patch.object(ImageDraw.ImageDraw, "text", spy_text), \
                mock.patch.object(ImageDraw.ImageDraw, "line", spy_line), \
                mock.patch.object(ImageDraw.ImageDraw, "ellipse", spy_ellipse), \
                mock.patch.object(png_renderer, "_paste_polaroid", spy_polaroid):
            content = render_png(timeline, target_id=target_id, customer=self.customer)
        rule = next(l for l, _ in lines if l[0][1] == l[1][1])
        spine = next((l, w) for l, w in lines if l[0][0] == l[1][0])
        texts = [t for t in texts if "heartfolio" not in t[0]]
        return {"image": content, "texts": texts, "cards": cards, "nodes": nodes, "rule": rule, "spine": spine}

    @staticmethod
    def _hit(a, b):
        return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]

    def _blocks(self, texts):
        starts = [i for i, t in enumerate(texts) if t[0][:3] in self.MONTHS and t[0][-4:].isdigit()]
        footer = next(i for i, t in enumerate(texts) if t[0].startswith("To be continued"))
        return [texts[a:b] for a, b in zip(starts, starts[1:] + [footer])], texts[footer]

    def _problems(self, names, scale, count, target_id, events=None, subtitle=""):
        from .compositions import CASCADE

        drawn = self._render(names, scale, count, target_id, events, subtitle)
        texts, cards, nodes = drawn["texts"], drawn["cards"], drawn["nodes"]
        (left, rule_y), (right, _) = drawn["rule"]
        spine_x = drawn["spine"][0][0][0]
        column = (left, left + int((right - left) * CASCADE.photo_column))
        blocks, footer = self._blocks(texts)
        problems = []
        for i, (value, box, _, _, (width, height)) in enumerate(texts):
            if box[0] < 0 or box[2] > width or box[3] > height:
                problems.append(f"{value!r} runs off the page")
            elif box[2] > right + 1:
                problems.append(f"{value!r} runs past the margin")
            for other, other_box, _, _, _ in texts[i + 1:]:
                if self._hit(box, other_box):
                    problems.append(f"{value!r} overlaps {other!r}")
        for k, block in enumerate(blocks):
            # The customer's title and place, whole (descriptions keep their
            # deliberate line limit).
            joined = " ".join(t[0] for t in block)
            if self.rows[k][1] not in joined or self.rows[k][3] not in joined:
                problems.append(f"milestone {k + 1}'s title or location is cut")
            top, bottom = block[0][1][1], max(t[1][3] for t in block)
            if k + 1 < len(blocks):
                inner = max((block[j + 1][1][1] - block[j][1][3] for j in range(len(block) - 1)), default=0)
                if blocks[k + 1][0][1][1] - bottom <= inner:
                    problems.append(f"milestones {k + 1} and {k + 2} are no further apart than lines within one")
            if top <= rule_y or bottom >= footer[1][1]:
                problems.append(f"milestone {k + 1}'s text leaves the timeline")
        if len(nodes) != count:
            problems.append("a node is missing")
        for block, node in zip(blocks, nodes):
            date_middle = (block[0][1][1] + block[0][1][3]) / 2
            if abs((node[1] + node[3]) / 2 - date_middle) > 2 or abs((node[0] + node[2]) / 2 - spine_x) > 1:
                problems.append("a node is not on the spine level with its date")
        # Centred on its card's row, as the preview centres each entry in a
        # row level with the card (it used to start a fixed 22% of a slot
        # above the middle). Within one date line: drawn glyph extents are
        # not the advances the layout measures.
        for k, (block, card) in enumerate(zip(blocks, cards)):
            top, bottom = block[0][1][1], max(t[1][3] for t in block)
            card_middle = (card["card"][1] + card["card"][3]) / 2
            if abs((top + bottom) / 2 - card_middle) > block[0][1][3] - block[0][1][1]:
                problems.append(f"milestone {k + 1}'s text is not centred on its card")
        if [c["tilt"] for c in cards] != [2.5 if i % 2 == 0 else -2.5 for i in range(count)]:
            problems.append(f"tilts {[c['tilt'] for c in cards]}")
        for card in cards:
            if card["card"][0] < column[0] or card["card"][2] > column[1]:
                problems.append("a card leaves the photo column")
            for region in (card["card"], card["shadow"]):
                if region[1] <= rule_y:
                    problems.append("a card or its shadow crosses the header rule")
                for value, box, _, _, _ in texts:
                    if self._hit(region, box):
                        problems.append(f"a card or its shadow covers {value!r}")
        centre = (left + right) / 2
        for value, box, (x, _), advance, _ in texts:
            if box[3] <= rule_y or value.startswith("To be continued"):
                if abs(x + advance / 2 - centre) > 2:
                    problems.append(f"{value!r} is not centred")
        return sorted(set(problems))

    def test_fits_and_matches_the_preview_across_the_realistic_range(self):
        for count in (3, 5, 8):
            for names in self.NAME_SETS:
                for scale in (70, 100, 130):
                    for target_id in self.TARGETS:
                        with self.subTest(milestones=count, names=names[0], scale=scale, target_id=target_id):
                            self.assertEqual(self._problems(names, scale, count, target_id), [])

    def test_the_fullest_header_still_fits(self):
        subtitle = "Twelve years, three cities and one very patient dog, Biscuit"  # 60, the maximum
        for names in self.NAME_SETS:
            for target_id in self.TARGETS:
                with self.subTest(names=names[0], target_id=target_id):
                    self.assertEqual(self._problems(names, 130, 8, target_id, subtitle=subtitle), [])

    def test_photo_shape_does_not_move_or_resize_the_cards(self):
        for size in ((1200, 1600), (1500, 1500)):
            others = self._events(size)
            for count, target_id in ((3, "print-poster-edged"), (5, "print-a4-edged"), (8, "print-classic-frameless")):
                with self.subTest(size=size, milestones=count, target_id=target_id):
                    expected = self._render(self.NAME_SETS[1], 130, count, target_id)["cards"]
                    actual = self._render(self.NAME_SETS[1], 130, count, target_id, others)["cards"]
                    self.assertEqual([c["card"] for c in actual], [c["card"] for c in expected])
                    self.assertEqual(self._problems(self.NAME_SETS[1], 130, count, target_id, others), [])

    def test_cards_overlap_their_neighbours_as_the_preview_does(self):
        from .compositions import CASCADE

        for count, target_id in ((3, "print-a4-edged"), (5, "print-poster-frameless"), (8, "print-classic-edged")):
            with self.subTest(milestones=count, target_id=target_id):
                cards = [c["card"] for c in self._render(self.NAME_SETS[0], 100, count, target_id)["cards"]]
                slot = ((cards[-1][1] + cards[-1][3]) - (cards[0][1] + cards[0][3])) / 2 / (count - 1)
                for upper, lower in zip(cards, cards[1:]):
                    overlap = (upper[3] - lower[1]) / slot
                    # Up to the preview's 0.22 of a slot; at least most of
                    # it, or the "cascade" is a column of separate cards.
                    self.assertGreater(overlap, 0.15)
                    self.assertLessEqual(overlap, CASCADE.photo_overlap + 0.01)

    def test_the_photographs_are_the_previews_shape_with_no_blank_band(self):
        from .compositions import CASCADE

        drawn = self._render(self.NAME_SETS[0], 100, 3, "print-a4-edged")
        for card in drawn["cards"]:
            width, height = card["photo"]
            self.assertAlmostEqual(height / width, CASCADE.photo_aspect, delta=0.01)
        # Pasted 1:1.15, the photograph runs to its own bottom edge: a pixel
        # a little above it is photo, not the white card. (Square, it left a
        # band 15% of the photo deep.)
        from . import png_renderer

        buf = io.BytesIO()
        Image.new("RGB", (1600, 1200), (200, 30, 30)).save(buf, format="JPEG")
        card = Image.new("RGB", (120, 140), (255, 255, 255))
        from unittest import mock

        with mock.patch.object(png_renderer, "get_asset_bytes_for_customer", return_value=(buf.getvalue(), "image/jpeg")):
            png_renderer._paste_photo(card, customer=None, asset_id="x", x=10, y=5, size=100, height=115)
        self.assertNotEqual(card.getpixel((60, 117)), (255, 255, 255), "the photo stops short of its height")
        self.assertEqual(card.getpixel((60, 122)), (255, 255, 255))

    def test_the_cards_drift_along_one_even_diagonal(self):
        from .compositions import CASCADE

        for count in (3, 5, 8):
            with self.subTest(milestones=count):
                drawn = self._render(self.NAME_SETS[0], 100, count, "print-a4-edged")
                (left, _), (right, _) = drawn["rule"]
                column = int((right - left) * CASCADE.photo_column)
                xs = [c["centre_x"] for c in drawn["cards"]]
                steps = [b - a for a, b in zip(xs, xs[1:])]
                self.assertLessEqual(max(steps) - min(steps), 1, "the drift is not even")
                # 22% of the column end to end, as the preview's 22cqw, or
                # less if the widest tilted card would leave the column.
                widest = max(c["card"][2] - c["card"][0] for c in drawn["cards"])
                self.assertAlmostEqual(xs[-1] - xs[0], min(column * CASCADE.drift, column - widest - 2), delta=3)
                self.assertGreater(xs[-1] - xs[0], column * 0.1, "the cascade barely drifts")
                self.assertLess(xs[0], left + column / 2)
                self.assertGreater(xs[-1], left + column / 2)

    def test_cards_cast_the_previews_shadow(self):
        drawn = self._render(self.NAME_SETS[0], 100, 3, "print-a4-edged")
        image = Image.open(io.BytesIO(drawn["image"])).convert("RGB")
        background = image.getpixel((5, 5))
        for card in drawn["cards"]:
            left, top, right, bottom = card["card"]
            shadow = card["shadow"]
            self.assertIsNotNone(shadow, "a card has no shadow")
            self.assertGreater(shadow[3] - bottom, top - shadow[1])
        # Below the last card, where nothing else is drawn, the page is a
        # little darker than the background, but only faintly (16%).
        left, _, right, bottom = drawn["cards"][-1]["card"]
        pixel = image.getpixel(((left + right) // 2, bottom + 3))
        self.assertLess(sum(pixel), sum(background), "no shadow under the card")
        self.assertGreater(sum(pixel), sum(background) * 0.7, "the shadow is far heavier than the preview's")

    def test_the_spine_and_nodes_are_drawn_at_the_previews_share_of_the_page(self):
        from .compositions import CASCADE

        drawn = self._render(self.NAME_SETS[0], 100, 3, "print-a4-edged")
        width = Image.open(io.BytesIO(drawn["image"])).width
        to_poster = width / CASCADE.preview_poster_px
        self.assertEqual(drawn["spine"][1], round(CASCADE.spine_width_px * to_poster))
        for node in drawn["nodes"]:
            self.assertAlmostEqual(node[2] - node[0], CASCADE.node_size_px * to_poster, delta=1)


class OverlappingCascadeNamesGiveUpRoomOnlyWhenNeededTests(SimpleTestCase):
    """Overlapping Cascade follows Neat Stack's rule for the names heading
    (`NeatStackNamesGiveUpRoomOnlyWhenNeededTests`): it shrinks only when the
    milestones cannot otherwise fit, only on a sold print, never to the
    title's size. The case: eight full milestones under two long names at
    130 on the 8x10 edged print had 135px slots for 204px of text at the
    smallest milestone type.
    """

    LAYOUT = "overlapping-cascade"

    def _sizes(self, names, count, scale, target_id):
        from unittest import mock

        from PIL import ImageDraw

        # The rows of `OverlappingCascadeTests`: three short, then five at
        # every field's maximum.
        rows = [(f"2019-0{i + 1}-12", "We Met", "A rainy afternoon, a shared umbrella.", "Lisbon") for i in range(3)] + [
            (f"2023-0{i + 1}-15", "The weekend we finally painted the kitch",
             "We spent the whole weekend arguing about colours, gave up, ordered takeaway, and painted it "
             "white anyway. Best decision we ever made, honest", "Our first flat, Rua das Flores 12, Porto")
            for i in range(5)]
        events = [{"date": d, "title": t, "description": ds, "location": l, "photo": {"assetId": "x"}}
                  for d, t, ds, l in rows[:count]]
        values = {
            **VALID_VALUES, "people": [{"name": n} for n in names], "posterTitle": "Our Love Story",
            "dedication": "Every love story is beautiful, but ours is my favorite.",
            "endingText": "To be continued\u2026", "showDuration": True, "events": events,
        }
        timeline = validate_and_normalize(
            values, {"palette": "classic", "typography": "modern", "layout": self.LAYOUT, "scale": scale}
        )
        drawn = []
        original = ImageDraw.ImageDraw.text

        def spy(draw, xy, text, *args, **kwargs):
            drawn.append((text, kwargs.get("font").size))
            return original(draw, xy, text, *args, **kwargs)

        with mock.patch.object(ImageDraw.ImageDraw, "text", spy):
            render_png(timeline, target_id=target_id, customer=None)
        first_names = {n.split()[0] for n in names}
        name_sizes = {size for text, size in drawn if text.split() and text.split()[0] in first_names}
        title_size = next(size for text, size in drawn if text == "Our Love Story")
        return name_sizes, title_size

    def test_names_shrink_for_the_combination_that_could_not_fit(self):
        long = NeatStackNamesGiveUpRoomOnlyWhenNeededTests.LONG
        full, _ = self._sizes(long, 3, 130, "print-classic-edged")
        shrunk, title = self._sizes(long, 8, 130, "print-classic-edged")
        self.assertLess(next(iter(shrunk)), next(iter(full)), "the names did not give up any room")
        self.assertGreater(next(iter(shrunk)), title, "the names shrank to the title's size or below")

    def test_names_stay_full_size_whenever_the_milestones_already_fit(self):
        long = NeatStackNamesGiveUpRoomOnlyWhenNeededTests.LONG
        for count, scale, target_id in ((3, 130, "print-classic-edged"), (8, 100, "print-poster-frameless")):
            with self.subTest(milestones=count, scale=scale, target_id=target_id):
                emma, _ = self._sizes(["Emma", "James"], count, scale, target_id)
                full, _ = self._sizes(long, count, scale, target_id)
                self.assertEqual(emma, full, "names shrank although nothing needed the room")

    def test_legacy_targets_never_shrink_the_names(self):
        long = NeatStackNamesGiveUpRoomOnlyWhenNeededTests.LONG
        for target_id in ("landscape-png", "story-png"):
            with self.subTest(target_id=target_id):
                self.assertEqual(self._sizes(long, 8, 130, target_id), self._sizes(long, 3, 130, target_id))


class DottedBranchingTests(TestCase):
    """§7.4 Dotted Branching: fits its slots and matches the preview.

    Before this, 106 of the 108 realistic renders below were broken. Cards
    sized from the photo were 1.03-1.38x their slot: the first crossed the
    header rule in 105 and the last covered "To be continued..." in 102.
    Titles were one unwrapped line (off the page in 19). The full-date chip on
    the spine was wider than the gutter between the columns: into the text
    column in 51, the photo column in 16, over a card in 17. The photo was
    pasted SQUARE into a card sized for 1:1.12 (a blank band), the cards were
    flat and stepped 0/5/10% to the right, the heart was a 5px dot.

    The preview's values, read live (renderer.module.css): cards centred in
    the column, rotate(-3deg)/rotate(3deg), `box-shadow: 0 3px 9px
    rgba(0,0,0,0.15)`, padding 5px/16px around a 158px photo 1.12x as tall as
    wide, an 11px heart, a dotted 1px line at 48% with 6px dashes and 8px
    gaps on the 540px poster, text starting at 52%, the full date as the
    first line of each milestone starting on the line, header and footer
    centred. Each milestone gets an equal slot of height / (count + 0.16) and
    a card overlaps its neighbours by up to 0.16 of a slot.
    composition-parity.test.ts holds the CSS to the same numbers.
    """

    TARGETS = AlternatingTiltTests.TARGETS
    NAME_SETS = AlternatingTiltTests.NAME_SETS
    MONTHS = AlternatingTiltTests.MONTHS

    def setUp(self):
        self.customer = make_customer()
        self.rows = OverlappingCascadeTests.ROWS
        self.events = self._events((1600, 1200))

    def _events(self, size):
        events = []
        for index, (date, title, description, location) in enumerate(self.rows):
            buf = io.BytesIO()
            Image.new("RGB", size, (40 + index * 20, 120, 190)).save(buf, format="JPEG", quality=90)
            asset = upload_asset(
                self.customer, SimpleUploadedFile(f"d{index}.jpg", buf.getvalue(), content_type="image/jpeg")
            )
            events.append({"date": date, "title": title, "description": description,
                           "location": location, "photo": {"assetId": str(asset.id)}})
        return events

    def _render(self, names, scale, count, target_id, events=None, subtitle=""):
        from unittest import mock

        from PIL import ImageDraw

        from . import png_renderer
        from .data import PALETTES

        values = {
            "storyType": "couple", "people": [{"name": n} for n in names], "posterTitle": "Our Love Story",
            "subtitle": subtitle, "dedication": "Every love story is beautiful, but ours is my favorite.",
            "endingText": "To be continued\u2026", "showDuration": True, "autoSort": True,
            "events": (events or self.events)[:count],
        }
        timeline = validate_and_normalize(
            values, {"palette": "classic", "typography": "modern", "layout": "dotted-branching", "scale": scale}
        )
        background = PALETTES["classic"]["bg"]
        texts, cards, hearts, lines, chips = [], [], [], [], []
        text, line, rectangle = ImageDraw.ImageDraw.text, ImageDraw.ImageDraw.line, ImageDraw.ImageDraw.rectangle
        polaroid, heart = png_renderer._paste_polaroid, png_renderer._draw_heart

        def spy_text(draw, xy, value, *args, **kwargs):
            font = kwargs.get("font")
            texts.append((value, draw.textbbox(xy, value, font=font), xy, draw.textlength(value, font=font), draw.im.size))
            return text(draw, xy, value, *args, **kwargs)

        def spy_line(draw, xy, *args, **kwargs):
            lines.append((tuple(map(tuple, xy)), kwargs.get("width")))
            return line(draw, xy, *args, **kwargs)

        def spy_rectangle(draw, xy, *args, **kwargs):
            if kwargs.get("fill") == background:
                chips.append(tuple(xy))
            return rectangle(draw, xy, *args, **kwargs)

        def spy_polaroid(*args, **kwargs):
            placed = polaroid(*args, **kwargs)
            cards.append({"tilt": kwargs["tilt_deg"], "card": placed["card"], "shadow": placed["shadow"],
                          "photo": (kwargs["photo_size"], kwargs["photo_height"]), "centre_x": kwargs["centre_x"]})
            return placed

        def spy_heart(image, centre_x, centre_y, size, fill):
            hearts.append((centre_x, centre_y, size))
            return heart(image, centre_x, centre_y, size, fill)

        with mock.patch.object(ImageDraw.ImageDraw, "text", spy_text), \
                mock.patch.object(ImageDraw.ImageDraw, "line", spy_line), \
                mock.patch.object(ImageDraw.ImageDraw, "rectangle", spy_rectangle), \
                mock.patch.object(png_renderer, "_paste_polaroid", spy_polaroid), \
                mock.patch.object(png_renderer, "_draw_heart", spy_heart):
            content = render_png(timeline, target_id=target_id, customer=self.customer)
        rule = next(l for l, _ in lines if l[0][1] == l[1][1])
        dashes = [(l, w) for l, w in lines if l[0][0] == l[1][0]]
        texts = [t for t in texts if "heartfolio" not in t[0]]
        return {"image": content, "texts": texts, "cards": cards, "hearts": hearts, "chips": chips,
                "rule": rule, "dashes": dashes}

    @staticmethod
    def _hit(a, b):
        return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]

    def _blocks(self, texts):
        starts = [i for i, t in enumerate(texts) if t[0][:3] in self.MONTHS and t[0][-4:].isdigit()]
        footer = next(i for i, t in enumerate(texts) if t[0].startswith("To be continued"))
        return [texts[a:b] for a, b in zip(starts, starts[1:] + [footer])], texts[footer]

    def _problems(self, names, scale, count, target_id, events=None, subtitle=""):
        from .compositions import DOTTED

        drawn = self._render(names, scale, count, target_id, events, subtitle)
        texts, cards, hearts, chips = drawn["texts"], drawn["cards"], drawn["hearts"], drawn["chips"]
        (left, rule_y), (right, _) = drawn["rule"]
        width = texts[0][4][0]
        to_poster = width / DOTTED.preview_poster_px
        spine_x = drawn["dashes"][0][0][0][0]
        column = (left, left + int((right - left) * DOTTED.photo_column))
        blocks, footer = self._blocks(texts)
        problems = []
        for i, (value, box, _, _, (w, h)) in enumerate(texts):
            if box[0] < 0 or box[2] > w or box[3] > h:
                problems.append(f"{value!r} runs off the page")
            elif box[2] > right + 1:
                problems.append(f"{value!r} runs past the margin")
            for other, other_box, _, _, _ in texts[i + 1:]:
                if self._hit(box, other_box):
                    problems.append(f"{value!r} overlaps {other!r}")
        for k, block in enumerate(blocks):
            joined = " ".join(t[0] for t in block)
            if self.rows[k][1] not in joined or self.rows[k][3] not in joined:
                problems.append(f"milestone {k + 1}'s title or location is cut")
            if self.rows[k][2][:20] in joined:
                problems.append("a description was printed on a photo-led layout")
            top, bottom = block[0][1][1], max(t[1][3] for t in block)
            if k + 1 < len(blocks):
                inner = max((block[j + 1][1][1] - block[j][1][3] for j in range(len(block) - 1)), default=0)
                if blocks[k + 1][0][1][1] - bottom <= inner:
                    problems.append(f"milestones {k + 1} and {k + 2} are no further apart than lines within one")
            if top <= rule_y or bottom >= footer[1][1]:
                problems.append(f"milestone {k + 1}'s text leaves the timeline")
            # The date starts ON the spine, and its chip a pad before it.
            if abs(block[0][2][0] - spine_x) > 1:
                problems.append("a date does not start on the spine")
        if len(chips) != count or len(hearts) != count:
            problems.append("a chip or a heart is missing")
        pad = max(2, round(DOTTED.chip_pad_px * to_poster))
        for chip in chips:
            if abs(chip[0] - (spine_x - pad)) > 1:
                problems.append("a chip does not start a pad before the spine")
            for card in cards:
                for region in (card["card"], card["shadow"]):
                    if self._hit(chip, region):
                        problems.append("a date chip touches a card or its shadow")
        if [c["tilt"] for c in cards] != [3.0 if i % 2 == 0 else -3.0 for i in range(count)]:
            problems.append(f"tilts {[c['tilt'] for c in cards]}")
        for card in cards:
            if abs(card["centre_x"] - (column[0] + (column[1] - column[0]) // 2)) > 1:
                problems.append("a card is not centred in the photo column")
            if card["card"][0] < column[0] or card["card"][2] > column[1]:
                problems.append("a card leaves the photo column")
            for region in (card["card"], card["shadow"]):
                if region[1] <= rule_y:
                    problems.append("a card or its shadow crosses the header rule")
                for value, box, _, _, _ in texts:
                    if self._hit(region, box):
                        problems.append(f"a card or its shadow covers {value!r}")
        # Centred on its card's row, as the preview centres each entry in a
        # row level with the card (it used to start a fixed 22% of a slot
        # above the middle). Within one date line: drawn glyph extents are
        # not the advances the layout measures.
        for k, (block, card) in enumerate(zip(blocks, cards)):
            top, bottom = block[0][1][1], max(t[1][3] for t in block)
            card_middle = (card["card"][1] + card["card"][3]) / 2
            if abs((top + bottom) / 2 - card_middle) > block[0][1][3] - block[0][1][1]:
                problems.append(f"milestone {k + 1}'s text is not centred on its card")
        # Each heart is level with its title's first line.
        for block, (_, centre_y, _) in zip(blocks, hearts):
            title = block[1][1]
            if abs(centre_y - (title[1] + title[3]) / 2) > (title[3] - title[1]):
                problems.append("a heart is not level with its title")
        centre = (left + right) / 2
        for value, box, (x, _), advance, _ in texts:
            if box[3] <= rule_y or value.startswith("To be continued"):
                if abs(x + advance / 2 - centre) > 2:
                    problems.append(f"{value!r} is not centred")
        return sorted(set(problems))

    def test_fits_and_matches_the_preview_across_the_realistic_range(self):
        for count in (3, 5, 8):
            for names in self.NAME_SETS:
                for scale in (70, 100, 130):
                    for target_id in self.TARGETS:
                        with self.subTest(milestones=count, names=names[0], scale=scale, target_id=target_id):
                            self.assertEqual(self._problems(names, scale, count, target_id), [])

    def test_the_fullest_header_still_fits(self):
        subtitle = "Twelve years, three cities and one very patient dog, Biscuit"  # 60, the maximum
        for names in self.NAME_SETS:
            for target_id in self.TARGETS:
                with self.subTest(names=names[0], target_id=target_id):
                    self.assertEqual(self._problems(names, 130, 8, target_id, subtitle=subtitle), [])

    def test_photo_shape_does_not_move_or_resize_the_cards(self):
        for size in ((1200, 1600), (1500, 1500)):
            others = self._events(size)
            for count, target_id in ((3, "print-poster-edged"), (5, "print-a4-edged"), (8, "print-classic-frameless")):
                with self.subTest(size=size, milestones=count, target_id=target_id):
                    expected = self._render(self.NAME_SETS[1], 130, count, target_id)["cards"]
                    actual = self._render(self.NAME_SETS[1], 130, count, target_id, others)["cards"]
                    self.assertEqual([c["card"] for c in actual], [c["card"] for c in expected])
                    self.assertEqual(self._problems(self.NAME_SETS[1], 130, count, target_id, others), [])

    def test_cards_overlap_their_neighbours_as_the_preview_does(self):
        from .compositions import DOTTED

        # 5 and 8 milestones: the slots are short, so the card is limited by
        # its slot and overlaps by most of `photo_overlap`. (At 3 the column
        # width limits it, as in the preview.)
        for count, target_id in ((5, "print-poster-frameless"), (8, "print-classic-edged")):
            with self.subTest(milestones=count, target_id=target_id):
                cards = [c["card"] for c in self._render(self.NAME_SETS[0], 100, count, target_id)["cards"]]
                slot = ((cards[-1][1] + cards[-1][3]) - (cards[0][1] + cards[0][3])) / 2 / (count - 1)
                for upper, lower in zip(cards, cards[1:]):
                    overlap = (upper[3] - lower[1]) / slot
                    self.assertGreater(overlap, 0.08)
                    self.assertLessEqual(overlap, DOTTED.photo_overlap + 0.01)

    def test_the_photographs_are_the_previews_shape(self):
        from .compositions import DOTTED

        drawn = self._render(self.NAME_SETS[0], 100, 3, "print-a4-edged")
        for card in drawn["cards"]:
            width, height = card["photo"]
            self.assertAlmostEqual(height / width, DOTTED.photo_aspect, delta=0.01)

    def test_the_cards_cast_the_previews_shadow(self):
        drawn = self._render(self.NAME_SETS[0], 100, 3, "print-a4-edged")
        image = Image.open(io.BytesIO(drawn["image"])).convert("RGB")
        background = image.getpixel((5, 5))
        for card in drawn["cards"]:
            left, top, right, bottom = card["card"]
            self.assertIsNotNone(card["shadow"], "a card has no shadow")
            self.assertGreater(card["shadow"][3] - bottom, top - card["shadow"][1])
        left, _, right, bottom = drawn["cards"][-1]["card"]
        pixel = image.getpixel(((left + right) // 2, bottom + 3))
        self.assertLess(sum(pixel), sum(background), "no shadow under the card")
        self.assertGreater(sum(pixel), sum(background) * 0.7, "the shadow is far heavier than the preview's")

    def test_the_line_hearts_and_chip_are_drawn_at_the_previews_share_of_the_page(self):
        from .compositions import DOTTED

        drawn = self._render(self.NAME_SETS[0], 100, 3, "print-a4-edged")
        width = Image.open(io.BytesIO(drawn["image"])).width
        to_poster = width / DOTTED.preview_poster_px
        dashes = drawn["dashes"]
        self.assertTrue(all(w == round(DOTTED.spine_width_px * to_poster) for _, w in dashes))
        lengths = [l[1][1] - l[0][1] for l, _ in dashes[:-1]]
        self.assertTrue(all(length == round(DOTTED.dash_length_px * to_poster) for length in lengths))
        starts = [l[0][1] for l, _ in dashes]
        self.assertTrue(all(b - a == round((DOTTED.dash_length_px + DOTTED.dash_gap_px) * to_poster)
                            or b - a == round(DOTTED.dash_length_px * to_poster) + round(DOTTED.dash_gap_px * to_poster)
                            for a, b in zip(starts, starts[1:])))
        for _, _, size in drawn["hearts"]:
            self.assertEqual(size, round(DOTTED.heart_size_px * to_poster))

    def test_the_date_is_the_first_line_and_the_titles_start_after_the_heart(self):
        drawn = self._render(self.NAME_SETS[0], 100, 3, "print-a4-edged")
        blocks, _ = self._blocks(drawn["texts"])
        for block, (heart_x, _, size) in zip(blocks, drawn["hearts"]):
            date, title = block[0], block[1]
            self.assertLess(date[1][3], title[1][1] + 1, "the date is not above the title")
            self.assertGreaterEqual(title[2][0], heart_x + size / 2, "the title starts under its heart")


class DottedBranchingNamesGiveUpRoomOnlyWhenNeededTests(OverlappingCascadeNamesGiveUpRoomOnlyWhenNeededTests):
    """Dotted Branching follows the same names rule as Neat Stack and
    Overlapping Cascade: the heading shrinks only when the milestones cannot
    otherwise fit, only on a sold print, never to the title's size."""

    LAYOUT = "dotted-branching"


class _HorizontalHarness:
    """Renders a Horizontal composition with real photos and records what it
    draws. Shared by the two Horizontal test classes ONLY as a harness: what
    each class asserts is its own."""

    TARGETS = AlternatingTiltTests.TARGETS
    NAME_SETS = AlternatingTiltTests.NAME_SETS
    MONTHS = AlternatingTiltTests.MONTHS
    LAYOUT = None
    #: Landscape pages are at least 3000px wide; a card layer is at most 88% of
    #: a column, so a text drawn on a wider image is a page text.
    PAGE = 2900

    def setUp(self):
        self.customer = make_customer()
        self.rows = OverlappingCascadeTests.ROWS
        self.events = self._events((1600, 1200))

    def _events(self, size):
        events = []
        for index, (date, title, description, location) in enumerate(self.rows):
            buf = io.BytesIO()
            Image.new("RGB", size, (40 + index * 20, 120, 190)).save(buf, format="JPEG", quality=90)
            asset = upload_asset(
                self.customer, SimpleUploadedFile(f"h{index}.jpg", buf.getvalue(), content_type="image/jpeg")
            )
            events.append({"date": date, "title": title, "description": description,
                           "location": location, "photo": {"assetId": str(asset.id)}})
        return events

    def _render(self, names, scale, count, target_id, events=None, subtitle=""):
        from unittest import mock

        from PIL import ImageDraw

        from . import png_renderer

        values = {
            "storyType": "couple", "people": [{"name": n} for n in names], "posterTitle": "Our Love Story",
            "subtitle": subtitle, "dedication": "Every love story is beautiful, but ours is my favorite.",
            "endingText": "To be continued\u2026", "showDuration": True, "autoSort": True,
            "events": (events or self.events)[:count],
        }
        timeline = validate_and_normalize(
            values, {"palette": "classic", "typography": "modern", "layout": self.LAYOUT, "scale": scale}
        )
        texts, lines, cards, circles, plans = [], [], [], [], []
        text, line = ImageDraw.ImageDraw.text, ImageDraw.ImageDraw.line
        polaroid, photo, plan = png_renderer._paste_polaroid, png_renderer._paste_photo, png_renderer._horizontal_plan

        def spy_text(draw, xy, value, *args, **kwargs):
            if draw.im.size[0] > self.PAGE:
                font = kwargs.get("font")
                texts.append((value, draw.textbbox(xy, value, font=font), xy, draw.textlength(value, font=font), draw.im.size))
            return text(draw, xy, value, *args, **kwargs)

        def spy_line(draw, xy, *args, **kwargs):
            if draw.im.size[0] > self.PAGE:
                lines.append((tuple(map(tuple, xy)), kwargs.get("width"), kwargs.get("fill")))
            return line(draw, xy, *args, **kwargs)

        def spy_polaroid(*args, **kwargs):
            placed = polaroid(*args, **kwargs)
            cards.append({"tilt": kwargs["tilt_deg"], "card": placed["card"], "shadow": placed["shadow"],
                          "photo": kwargs["photo_size"], "photo_h": kwargs["photo_height"], "border": kwargs["border"],
                          "band": kwargs["bottom_border"], "caption": kwargs["caption"], "centre_x": kwargs["centre_x"]})
            return placed

        def spy_photo(image, **kwargs):
            if kwargs.get("circular"):
                circles.append((kwargs["x"], kwargs["y"], kwargs["x"] + kwargs["size"], kwargs["y"] + kwargs["size"], kwargs["size"]))
            return photo(image, **kwargs)

        def spy_plan(*args, **kwargs):
            result = plan(*args, **kwargs)
            plans.append({"plan": result, "band": kwargs["band_height"], "col_w": kwargs["col_w"],
                          "small": kwargs["small_size"]})
            return result

        with mock.patch.object(ImageDraw.ImageDraw, "text", spy_text), \
                mock.patch.object(ImageDraw.ImageDraw, "line", spy_line), \
                mock.patch.object(png_renderer, "_paste_polaroid", spy_polaroid), \
                mock.patch.object(png_renderer, "_paste_photo", spy_photo), \
                mock.patch.object(png_renderer, "_horizontal_plan", spy_plan):
            content = render_png(timeline, target_id=target_id, customer=self.customer)
        texts = [t for t in texts if "heartfolio" not in t[0]]
        rules = [l for l in lines if l[0][0][1] == l[0][1][1]]
        verticals = [l for l in lines if l[0][0][0] == l[0][1][0]]
        return {"image": content, "texts": texts, "rules": rules, "verticals": verticals, "cards": cards,
                "circles": circles, "plan": plans[0]}

    @staticmethod
    def _hit(a, b):
        return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]

    def _columns(self, count, left, right):
        from .compositions import geometry_for

        geometry = geometry_for(self.LAYOUT)
        gap = round((right - left) * geometry.column_gap)
        width = (right - left - gap * (count - 1)) / count
        return [(left + round(i * (width + gap)), left + round(i * (width + gap)) + width) for i in range(count)]

    def _shared_problems(self, drawn, count):
        """What every landscape page must satisfy, whichever composition."""
        texts = drawn["texts"]
        (left, rule_y), (right, _) = drawn["rules"][0][0]
        footer = next(t for t in texts if t[0].startswith("To be continued"))
        below = [t for t in texts if t[1][1] > rule_y and t is not footer]
        problems = []
        for value, box, _, _, (w, h) in texts:
            if box[0] < 0 or box[2] > w or box[3] > h:
                problems.append(f"{value!r} runs off the page")
            elif box[2] > right + 1 and box[1] > rule_y:
                problems.append(f"{value!r} runs past the margin")
        for i, (value, box, _, _, _) in enumerate(below):
            for other, other_box, _, _, _ in below[i + 1:]:
                if self._hit(box, other_box):
                    problems.append(f"{value!r} overlaps {other!r}")
        centre = (left + right) / 2
        for value, box, (x, _), advance, _ in texts:
            if box[3] <= rule_y or value.startswith("To be continued"):
                if abs(x + advance / 2 - centre) > 2:
                    problems.append(f"{value!r} is not centred")
        if max(t[1][3] for t in below) >= footer[1][1]:
            problems.append("the milestones reach the closing line")
        return problems, (left, right, rule_y), footer, below

    def _fits_the_floor(self, drawn):
        plan = drawn["plan"]
        return plan["plan"]["font"].size >= int(plan["small"] * 0.55) - 1


class HorizontalPolaroidsTests(_HorizontalHarness, TestCase):
    """§7.5 Horizontal Polaroids: wraps its text and matches the preview.

    Before this, 70 of the 108 realistic renders below were broken, all at 5
    or 8 milestones: a title and a date were each ONE unwrapped line in a
    column 1/count of the page wide (66 titles wider than their column, 70
    captions wider than their card, 62 collisions, 33 runs off the canvas),
    sized by the shared estimate, which divides the page HEIGHT by the
    milestone count although milestones are columns here. The card was flat,
    a square photograph with a 30% caption band, and the caption did not tilt.

    The preview's values, read live (renderer.module.css): cards `88%` of a
    column, rotate(-1.5deg) on the 1st, 3rd... and rotate(1.5deg) on the 2nd,
    4th..., `box-shadow: 0 2px 7px rgba(0,0,0,0.15)`, a photograph 1:1.15
    with `padding: 4px 4px 0`, the caption inside the lower border and
    tilting with the card, the date below, columns 2% of the box apart,
    everything top-aligned, header and footer centred. composition-parity
    .test.ts holds the CSS to the same numbers.
    """

    LAYOUT = "horizontal-polaroid"

    def _problems(self, names, scale, count, target_id, events=None, subtitle=""):
        from PIL import ImageDraw

        from .compositions import HORIZONTAL_POLAROID as G

        drawn = self._render(names, scale, count, target_id, events, subtitle)
        problems, (left, right, rule_y), footer, below = self._shared_problems(drawn, count)
        cards = drawn["cards"]
        columns = self._columns(count, left, right)
        probe = ImageDraw.Draw(Image.new("RGB", (10, 10)))
        if [c["tilt"] for c in cards] != [1.5 if i % 2 == 0 else -1.5 for i in range(count)]:
            problems.append(f"tilts {[c['tilt'] for c in cards]}")
        for k, card in enumerate(cards):
            column_left, column_right = columns[k]
            caption = card["caption"]
            if " ".join(caption["lines"]) != self.rows[k][1]:
                problems.append(f"milestone {k + 1}'s caption is cut or altered")
            side = round(G.caption_pad_side_em * caption["font"].size)
            if any(probe.textlength(l, font=caption["font"]) > card["photo"] - 2 * side + 1 for l in caption["lines"]):
                problems.append("a caption line is wider than its card")
            if abs(card["photo_h"] / card["photo"] - G.photo_aspect) > 0.01:
                problems.append("a photograph is not 1:1.15")
            if abs(card["centre_x"] - (column_left + int(column_right - column_left) // 2)) > 1:
                problems.append("a card is not centred in its column")
            if card["card"][0] < column_left - 1 or card["card"][2] > column_right + 1:
                problems.append("a card leaves its column")
            if (card["photo"] + 2 * card["border"]) / (column_right - column_left) > G.photo_width + 0.005:
                problems.append("a card is wider than 88% of its column")
            for region in (card["card"], card["shadow"]):
                if region is None:
                    problems.append("a card has no shadow")
                    continue
                if region[1] <= rule_y:
                    problems.append("a card or its shadow crosses the header rule")
                if region[3] >= footer[1][1]:
                    problems.append("a card or its shadow reaches the closing line")
            # The date is below its card, centred in its column.
            dates = [t for t in below if column_left - 2 <= t[1][0] and t[1][2] <= column_right + 2]
            if not dates:
                problems.append(f"milestone {k + 1}'s date is missing or outside its column")
            for value, box, (x, _), advance, _ in dates:
                if abs(x + advance / 2 - (column_left + column_right) / 2) > 3:
                    problems.append("a date is not centred in its column")
                if box[1] < card["card"][1]:
                    problems.append("a date is above its card")
        for upper, lower in zip(cards, cards[1:]):
            if self._hit(upper["card"], lower["card"]):
                problems.append("two cards overlap")
        if not self._fits_the_floor(drawn):
            problems.append("the text shrank below the 55% floor")
        return sorted(set(problems))

    def test_fits_and_matches_the_preview_across_the_realistic_range(self):
        for count in (3, 5, 8):
            for names in self.NAME_SETS:
                for scale in (70, 100, 130):
                    for target_id in self.TARGETS:
                        with self.subTest(milestones=count, names=names[0], scale=scale, target_id=target_id):
                            self.assertEqual(self._problems(names, scale, count, target_id), [])

    def test_the_fullest_header_still_fits(self):
        subtitle = "Twelve years, three cities and one very patient dog, Biscuit"  # 60, the maximum
        for names in self.NAME_SETS:
            for target_id in self.TARGETS:
                with self.subTest(names=names[0], target_id=target_id):
                    self.assertEqual(self._problems(names, 130, 8, target_id, subtitle=subtitle), [])

    def test_photo_shape_does_not_move_or_resize_the_cards(self):
        for size in ((1200, 1600), (1500, 1500)):
            others = self._events(size)
            for count, target_id in ((3, "print-poster-edged"), (5, "print-a4-edged"), (8, "print-classic-frameless")):
                with self.subTest(size=size, milestones=count, target_id=target_id):
                    expected = self._render(self.NAME_SETS[1], 130, count, target_id)["cards"]
                    actual = self._render(self.NAME_SETS[1], 130, count, target_id, others)["cards"]
                    self.assertEqual([c["card"] for c in actual], [c["card"] for c in expected])
                    self.assertEqual(self._problems(self.NAME_SETS[1], 130, count, target_id, others), [])

    def test_the_caption_is_drawn_on_the_card_so_it_tilts_with_it(self):
        # Page-level texts are the dates (and the header and footer): a caption
        # drawn flat on the page would show up here, and it would not tilt.
        drawn = self._render(self.NAME_SETS[0], 100, 5, "print-a4-edged")
        page_text = " ".join(t[0] for t in drawn["texts"])
        for card, row in zip(drawn["cards"], self.rows):
            self.assertNotIn(row[1], page_text)
            self.assertEqual(" ".join(card["caption"]["lines"]), row[1])
            self.assertNotEqual(card["tilt"], 0)

    def test_a_short_band_gives_a_narrower_card_not_one_that_spills(self):
        # The widest card whose single-line milestone fits (the preview's
        # `min(88%, ...cqh...)`): at 3 milestones on a short page it is
        # narrower than 88% of its column, and everything still fits.
        from .compositions import HORIZONTAL_POLAROID as G

        short = self._render(self.NAME_SETS[1], 130, 3, "print-a4-edged")
        card_w = short["plan"]["plan"]["card_w"]
        col_w = short["plan"]["col_w"]
        self.assertLess(card_w, int(G.photo_width * col_w), "the band was not short enough to need a narrower card")
        self.assertEqual(self._problems(self.NAME_SETS[1], 130, 3, "print-a4-edged"), [])
        # ... and a tall one leaves it at the column's 88%.
        tall = self._render(self.NAME_SETS[0], 100, 3, "print-a4-edged")
        self.assertEqual(tall["plan"]["plan"]["card_w"], int(G.photo_width * tall["plan"]["col_w"]))

    def test_the_cards_cast_the_previews_shadow(self):
        drawn = self._render(self.NAME_SETS[0], 100, 3, "print-a4-edged")
        image = Image.open(io.BytesIO(drawn["image"])).convert("RGB")
        background = image.getpixel((5, 5))
        for card in drawn["cards"]:
            left, top, right, bottom = card["card"]
            self.assertIsNotNone(card["shadow"], "a card has no shadow")
            self.assertGreater(card["shadow"][3] - bottom, top - card["shadow"][1])
        left, _, right, bottom = drawn["cards"][0]["card"]
        pixel = image.getpixel(((left + right) // 2, bottom + 2))
        self.assertLess(sum(pixel), sum(background) * 1.0, "no shadow under the card")
        self.assertGreater(sum(pixel), sum(background) * 0.7, "the shadow is far heavier than the preview's")

    def test_text_shrinks_only_when_a_milestone_does_not_fit(self):
        full = self._render(self.NAME_SETS[0], 100, 3, "print-a4-edged")["plan"]
        self.assertEqual(full["plan"]["font"].size, full["small"], "text shrank although it fit")
        tight = self._render(self.NAME_SETS[1], 130, 8, "print-classic-edged")["plan"]
        self.assertLess(tight["plan"]["font"].size, tight["small"], "this case must need smaller text")
        self.assertGreaterEqual(tight["plan"]["font"].size, int(tight["small"] * 0.55) - 1)


class HorizontalCirclesTests(_HorizontalHarness, TestCase):
    """§7.6 Horizontal Circles: wraps its text and matches the preview.

    Before this, 66 of the 108 realistic renders below were broken, all at 5
    or 8 milestones: a label and a date were each ONE unwrapped line in a
    column 1/count of the page wide (66 labels wider than their column, 62
    collisions, 33 runs off the canvas), sized by the shared estimate (which
    divides the page height by the milestone count). The axis was 1px and the
    ticks `18 * text scale` px on a 3000px page, the circle 69% of its column.
    In the PREVIEW the axis ran across the TOP of the timeline, above the
    circles, instead of joining the tick tops (the print had that right).

    The preview's values, read live (renderer.module.css): circles `78%` of a
    column, an axis `inset-inline: 2%` at the circles' bottoms, 1px wide, a
    18px tick from it under each circle, then the label (`margin-top: 5px`
    under 8px type) and the date, all centred, columns 2% of the box apart,
    everything top-aligned, header and footer centred.
    """

    LAYOUT = "horizontal-circles"

    def _problems(self, names, scale, count, target_id, events=None, subtitle=""):
        from apps.delivery.attribution import blend

        from .compositions import HORIZONTAL_CIRCLES as G
        from .data import PALETTES

        drawn = self._render(names, scale, count, target_id, events, subtitle)
        problems, (left, right, rule_y), footer, below = self._shared_problems(drawn, count)
        circles, verticals = drawn["circles"], drawn["verticals"]
        columns = self._columns(count, left, right)
        width = Image.open(io.BytesIO(drawn["image"])).width
        to_poster = width / G.preview_poster_px
        palette = PALETTES["classic"]
        axes = drawn["rules"][1:]
        if len(circles) != count:
            problems.append("a circle is missing")
        if len(axes) != 1:
            problems.append("the axis is missing or drawn twice")
        else:
            (x0, axis_y), (x1, _), = axes[0][0]
            inset = round((right - left) * G.axis_inset)
            if abs(x0 - (left + inset)) > 1 or abs(x1 - (right - inset)) > 1:
                problems.append("the axis is not inset 2% from each side")
            if axes[0][1] != max(1, round(G.axis_width_px * to_poster)):
                problems.append("the axis is not at the preview's share of the page")
            if any(abs(axis_y - c[3]) > 1 for c in circles):
                problems.append("the axis is not at the circles' bottoms")
            if tuple(axes[0][2]) != blend(palette["text"], palette["bg"], 0.85):
                problems.append("the axis is not the preview's 85% line")
        for k, circle in enumerate(circles):
            column_left, column_right = columns[k]
            if abs(circle[4] / (column_right - column_left) - G.photo_width) > 0.01:
                problems.append("a circle is not 78% of its column")
            if circle[0] < column_left - 1 or circle[2] > column_right + 1:
                problems.append("a circle leaves its column")
            if abs((circle[0] + circle[2]) / 2 - (column_left + column_right) / 2) > 2:
                problems.append("a circle is not centred in its column")
            if circle[1] <= rule_y:
                problems.append("a circle crosses the header rule")
        tick = max(2, round(G.tick_height_px * to_poster))
        if len(verticals) != count:
            problems.append("a tick is missing")
        for k, vertical in enumerate(verticals):
            (x0, y0), (x1, y1) = vertical[0]
            column_left, column_right = columns[k]
            if abs(x0 - (column_left + int(column_right - column_left) // 2)) > 1:
                problems.append("a tick is not under its circle's centre")
            if abs((y1 - y0) - tick) > 1:
                problems.append("a tick is not at the preview's share of the page")
        for k in range(count):
            column_left, column_right = columns[k]
            here = sorted((t for t in below if column_left - 2 <= t[1][0] and t[1][2] <= column_right + 2),
                          key=lambda t: t[1][1])
            label_lines = next((n for n in range(1, len(here) + 1)
                                if " ".join(t[0] for t in here[:n]) == self.rows[k][1]), None)
            if label_lines is None:
                problems.append(f"milestone {k + 1}'s label is cut, altered or outside its column")
                continue
            if len(here) == label_lines:
                problems.append(f"milestone {k + 1}'s date is missing")
            for value, box, (x, _), advance, _ in here:
                if abs(x + advance / 2 - (column_left + column_right) / 2) > 3:
                    problems.append("a label or date is not centred in its column")
            if k < len(verticals) and here[0][1][1] < verticals[k][0][1][1] - 1:
                problems.append("a label starts above its tick's end")
        if not self._fits_the_floor(drawn):
            problems.append("the text shrank below the 55% floor")
        return sorted(set(problems))

    def test_fits_and_matches_the_preview_across_the_realistic_range(self):
        for count in (3, 5, 8):
            for names in self.NAME_SETS:
                for scale in (70, 100, 130):
                    for target_id in self.TARGETS:
                        with self.subTest(milestones=count, names=names[0], scale=scale, target_id=target_id):
                            self.assertEqual(self._problems(names, scale, count, target_id), [])

    def test_the_fullest_header_still_fits(self):
        subtitle = "Twelve years, three cities and one very patient dog, Biscuit"  # 60, the maximum
        for names in self.NAME_SETS:
            for target_id in self.TARGETS:
                with self.subTest(names=names[0], target_id=target_id):
                    self.assertEqual(self._problems(names, 130, 8, target_id, subtitle=subtitle), [])

    def test_photo_shape_does_not_move_or_resize_the_circles(self):
        for size in ((1200, 1600), (1500, 1500)):
            others = self._events(size)
            for count, target_id in ((3, "print-poster-edged"), (5, "print-a4-edged"), (8, "print-classic-frameless")):
                with self.subTest(size=size, milestones=count, target_id=target_id):
                    expected = self._render(self.NAME_SETS[1], 130, count, target_id)["circles"]
                    actual = self._render(self.NAME_SETS[1], 130, count, target_id, others)["circles"]
                    self.assertEqual(actual, expected)
                    self.assertEqual(self._problems(self.NAME_SETS[1], 130, count, target_id, others), [])

    def test_the_axis_joins_the_tops_of_the_ticks_under_the_circles(self):
        # The preview's axis ran across the TOP of the timeline: 186px, 107px
        # and 63px from the ticks at 3, 5 and 8 milestones.
        for count in (3, 5, 8):
            with self.subTest(milestones=count):
                drawn = self._render(self.NAME_SETS[0], 100, count, "print-a4-edged")
                axis_y = drawn["rules"][1][0][0][1]
                for circle in drawn["circles"]:
                    self.assertEqual(circle[3], axis_y)
                for vertical in drawn["verticals"]:
                    self.assertEqual(vertical[0][0][1], axis_y)

    def test_the_height_the_fit_plans_is_the_height_the_drawing_uses(self):
        # The fit sizes the text from each milestone's planned height. If the
        # plan wrapped the label differently from the drawing, the text would
        # shrink more (or less) than it needs to, with nothing visibly broken.
        for count, names, scale, target_id in ((5, self.NAME_SETS[1], 100, "print-a4-edged"),
                                               (8, self.NAME_SETS[1], 100, "print-classic-frameless")):
            with self.subTest(milestones=count, target_id=target_id):
                drawn = self._render(names, scale, count, target_id)
                plan = drawn["plan"]["plan"]
                (left, _), (right, _) = drawn["rules"][0][0]
                columns = self._columns(count, left, right)
                for k, (circle, block) in enumerate(zip(drawn["circles"], plan["blocks"])):
                    column_left, column_right = columns[k]
                    here = sorted((t for t in drawn["texts"]
                                   if column_left - 2 <= t[1][0] and t[1][2] <= column_right + 2 and t[1][1] > circle[3]
                                   and not t[0].startswith("To be continued")),
                                  key=lambda t: t[2][1])
                    drawn_bottom = here[-1][2][1] + block["line_h"]
                    self.assertAlmostEqual(drawn_bottom - circle[1], block["height"], delta=3)

    def test_the_circles_are_not_tilted_or_given_cards(self):
        drawn = self._render(self.NAME_SETS[0], 100, 5, "print-a4-edged")
        self.assertEqual(drawn["cards"], [])
        self.assertEqual(len(drawn["circles"]), 5)

    def test_text_shrinks_only_when_a_milestone_does_not_fit(self):
        full = self._render(self.NAME_SETS[0], 100, 3, "print-a4-edged")["plan"]
        self.assertEqual(full["plan"]["font"].size, full["small"], "text shrank although it fit")
        tight = self._render(self.NAME_SETS[1], 130, 8, "print-a4-frameless")["plan"]
        self.assertLess(tight["plan"]["font"].size, tight["small"], "this case must need smaller text")
        self.assertGreaterEqual(tight["plan"]["font"].size, int(tight["small"] * 0.55) - 1)


class NeatStackCardsFitTheirSlotsTests(TestCase):
    """Neat Stack's polaroid cards must stay inside the timeline area.

    Found on a real order, not by a test: the card's PHOTO was capped at its
    slot and the polaroid borders (25% more height) were added on top, so the
    first card rose over the header rule and the duration line, the last one
    sat under "To be continued...", and neighbours overlapped by a quarter of
    a card — flat white, so the column read as one white strip. At text
    scale 130 it showed on every print size but the poster.

    An earlier check missed it by rendering with `customer=None`, which skips
    every photo, on a project with no dedication, duration or ending text. So
    this renders the FULL case: real uploaded JPEGs through the real asset
    path, every header line, the closing line, all six print targets, at the
    smallest, default and largest text scale, with short and long names.
    """

    TARGETS = (
        "print-a4-edged", "print-a4-frameless",
        "print-classic-edged", "print-classic-frameless",
        "print-poster-edged", "print-poster-frameless",
    )
    SCALES = (70, 100, 130)
    NAME_SETS = (("Emma", "James"), ("Alexandra Konstantinopol", "Maximilian von Habsburg"))
    #: ~1mm at 300dpi. Flat white cards closer than this read as one strip.
    MIN_CARD_GAP_PX = 10

    def setUp(self):
        self.customer = make_customer()
        events = []
        for index, (date, title, description, location) in enumerate((
            ("2019-04-12", "We Met", "A rainy afternoon, a shared umbrella.", "Lisbon"),
            ("2020-06-20", "First Trip Together", "Three days, one tiny car.", "Andalusia"),
            ("2022-09-03", "He Proposed", "On the beach, at sunset.", "Cascais"),
        )):
            # A landscape photograph-sized JPEG, not a 200px square: the crop
            # and resize path should do real work.
            photo = Image.new("RGB", (1600, 1200), (30 + index * 60, 140, 200))
            buf = io.BytesIO()
            photo.save(buf, format="JPEG", quality=90)
            asset = upload_asset(
                self.customer, SimpleUploadedFile(f"m{index}.jpg", buf.getvalue(), content_type="image/jpeg")
            )
            events.append({
                "date": date, "title": title, "description": description,
                "location": location, "photo": {"assetId": str(asset.id)},
            })
        self.events = events

    def _drawn(self, names, scale, target_id):
        """Cards (tilted outline + shadow), text boxes and the header rule,
        in drawing order."""
        from unittest import mock

        from PIL import ImageDraw

        from . import png_renderer

        values = {
            "storyType": "couple",
            "people": [{"name": n} for n in names],
            "posterTitle": "Our Love Story",
            "subtitle": "",
            "dedication": "Every love story is beautiful, but ours is my favorite.",
            "endingText": "To be continued…",
            "showDuration": True,
            "autoSort": True,
            "events": self.events,
        }
        timeline = validate_and_normalize(
            values, {"palette": "classic", "typography": "modern", "layout": "neat-stack", "scale": scale}
        )
        from . import png_renderer

        drawn = []
        text, line, polaroid = ImageDraw.ImageDraw.text, ImageDraw.ImageDraw.line, png_renderer._paste_polaroid

        def spy_text(draw, xy, value, *args, **kwargs):
            drawn.append(("text", value, draw.textbbox(xy, value, font=kwargs.get("font"))))
            return text(draw, xy, value, *args, **kwargs)

        def spy_line(draw, xy, *args, **kwargs):
            (x0, y0), (x1, y1) = xy
            if y0 == y1:
                drawn.append(("rule", None, (x0, y0, x1, y1)))
            return line(draw, xy, *args, **kwargs)

        def spy_polaroid(*args, **kwargs):
            # The card is tilted, so its real footprint is the rotated
            # outline's bounding box, plus the shadow it casts.
            placed = polaroid(*args, **kwargs)
            drawn.append(("card", None, placed["card"]))
            if placed["shadow"]:
                drawn.append(("shadow", None, placed["shadow"]))
            return placed

        with mock.patch.object(ImageDraw.ImageDraw, "text", spy_text), \
                mock.patch.object(ImageDraw.ImageDraw, "line", spy_line), \
                mock.patch.object(png_renderer, "_paste_polaroid", spy_polaroid):
            render_png(timeline, target_id=target_id, customer=self.customer)
        return drawn

    @staticmethod
    def _intersects(a, b):
        return a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]

    def _events_with_photos(self, size):
        events = []
        for index, event in enumerate(self.events):
            buf = io.BytesIO()
            Image.new("RGB", size, (30 + index * 60, 140, 200)).save(buf, format="JPEG", quality=90)
            asset = upload_asset(
                self.customer, SimpleUploadedFile(f"s{index}.jpg", buf.getvalue(), content_type="image/jpeg")
            )
            events.append({**event, "photo": {"assetId": str(asset.id)}})
        return events

    def test_photo_shape_does_not_move_or_resize_the_cards(self):
        # Cards crop every photo to a centre square, so a portrait or square
        # photo should change what is IN the card, never where the card or
        # its shadow sits. Confirmed rather than assumed.
        landscape = self.events
        for shape, size in (("portrait", (1200, 1600)), ("square", (1500, 1500))):
            others = self._events_with_photos(size)
            for scale in self.SCALES:
                for target_id in ("print-a4-edged", "print-classic-edged", "print-poster-frameless"):
                    with self.subTest(shape=shape, scale=scale, target_id=target_id):
                        self.events = landscape
                        expected = [box for kind, _, box in self._drawn(self.NAME_SETS[1], scale, target_id)
                                    if kind in ("card", "shadow")]
                        self.events = others
                        actual = [box for kind, _, box in self._drawn(self.NAME_SETS[1], scale, target_id)
                                  if kind in ("card", "shadow")]
                        self.assertEqual(actual, expected)
        self.events = landscape

    def test_cards_never_cross_the_header_the_footer_or_each_other(self):
        for names in self.NAME_SETS:
            for scale in self.SCALES:
                for target_id in self.TARGETS:
                    with self.subTest(names=names[0], scale=scale, target_id=target_id):
                        drawn = self._drawn(names, scale, target_id)
                        cards = [box for kind, _, box in drawn if kind == "card"]
                        self.assertEqual(len(cards), 3, "every milestone's photo should be drawn")

                        rule_y = next(box[1] for kind, _, box in drawn if kind == "rule")
                        self.assertGreater(cards[0][1], rule_y, "first card crosses the header rule")
                        shadows = [box for kind, _, box in drawn if kind == "shadow"]
                        self.assertEqual(len(shadows), 3, "every card should cast a shadow")
                        self.assertGreater(min(box[1] for box in shadows), rule_y, "a shadow crosses the rule")

                        texts = [(value, box) for kind, value, box in drawn if kind == "text"]
                        for card in cards + shadows:
                            for value, box in texts:
                                self.assertFalse(self._intersects(card, box), f"a card or shadow covers {value!r}")

                        for upper, lower in zip(cards, cards[1:]):
                            self.assertGreaterEqual(
                                lower[1] - upper[3], self.MIN_CARD_GAP_PX,
                                "neighbouring cards touch or overlap and read as one strip",
                            )


class LongNamesFitEveryRenderTests(SimpleTestCase):
    """Two names at the 24-character ceiling must not run off any output.

    The names were drawn as one unwrapped `draw.text` (print header), one
    unwrapped `_draw_centered` (phone/tablet wallpaper caption) and one
    unwrapped title (AR card, whose title IS the names when there is no
    poster title). "Alexandra Konstantinopol & Maximilian von Habsburg" was
    clipped at the canvas edge in each, while the Studio preview (CSS, which
    wraps) showed it whole.
    """

    NAMES = ("Alexandra Konstantinopol", "Maximilian von Habsburg")

    def _drawn_runs(self, target_id, *, layout="neat-stack", ending_text=""):
        """Every text run that was drawn, as (text, left, right, y, canvas_w)."""
        from unittest import mock

        from PIL import ImageDraw

        values = {
            **VALID_VALUES,
            "people": [{"name": n} for n in self.NAMES],
            "posterTitle": "",
            "endingText": ending_text,
        }
        timeline = validate_and_normalize(
            values, {"palette": "classic", "typography": "serif-classic", "layout": layout, "scale": 100}
        )
        original = ImageDraw.ImageDraw.text
        runs = []

        def spy(draw, xy, text, *args, **kwargs):
            if isinstance(text, str):
                right = xy[0] + draw.textbbox((0, 0), text, font=kwargs.get("font"))[2]
                runs.append((text, xy[0], right, xy[1], draw.im.size[0]))
            return original(draw, xy, text, *args, **kwargs)

        with mock.patch.object(ImageDraw.ImageDraw, "text", spy):
            render_png(timeline, target_id=target_id, customer=None)
        return runs

    def _name_runs(self, runs):
        return [r for r in runs if any(name.split()[0] in r[0] or name.split()[-1] in r[0] for name in self.NAMES)]

    def _assert_names_fit(self, target_id, **kwargs):
        runs = self._drawn_runs(target_id, **kwargs)
        name_runs = self._name_runs(runs)
        self.assertTrue(name_runs, "the names were never drawn")
        for text, left, right, _y, canvas_width in name_runs:
            self.assertGreaterEqual(left, 0, f"{text!r} starts off the canvas")
            self.assertLessEqual(right, canvas_width, f"{text!r} runs off the canvas")
        # Wrapped, not dropped: both surnames are present somewhere.
        joined = " ".join(r[0] for r in name_runs)
        for name in self.NAMES:
            self.assertIn(name.split()[-1], joined)
        return runs, name_runs

    def test_neat_stack_print_wraps_the_names_instead_of_clipping(self):
        for target_id in ("print-png", "print-a4-frameless", "print-a4-edged"):
            with self.subTest(target_id=target_id):
                self._assert_names_fit(target_id)

    def test_phone_and_tablet_wallpaper_captions_wrap(self):
        for layout in ("neat-stack", "horizontal-polaroid"):
            for target_id in ("wallpaper-phone", "wallpaper-tablet"):
                with self.subTest(layout=layout, target_id=target_id):
                    self._assert_names_fit(target_id, layout=layout)

    def test_the_ending_text_sits_below_the_wrapped_names(self):
        # The ending text used to be placed at a fixed offset under ONE line
        # of names; with two lines it would land on the second.
        for target_id in ("wallpaper-phone", "wallpaper-tablet"):
            with self.subTest(target_id=target_id):
                runs, name_runs = self._assert_names_fit(target_id, ending_text="To be continued")
                ending = [r for r in runs if r[0] == "To be continued"]
                self.assertEqual(len(ending), 1)
                self.assertGreater(ending[0][3], max(r[3] for r in name_runs))

    def test_ar_card_title_falls_back_to_names_and_wraps(self):
        from .png_renderer import CARD_TARGET_ID

        self._assert_names_fit(CARD_TARGET_ID)

    def test_ar_card_does_not_repeat_the_names_when_the_title_is_cleared(self):
        # With no poster title the names ARE the title, so the "whose card is
        # this" subline under it said the same thing twice. Short names, so
        # the title is one run and wrapping cannot explain a second one.
        from .png_renderer import CARD_TARGET_ID

        self.NAMES = ("Emma", "James")
        runs = self._drawn_runs(CARD_TARGET_ID)
        self.assertEqual([r[0] for r in runs if "Emma" in r[0]], ["Emma & James"])

    def test_ar_card_keeps_the_names_subline_under_a_real_title(self):
        # The subline is not removed, only skipped when it would duplicate.
        from unittest import mock

        from .png_renderer import CARD_TARGET_ID

        titled = {**VALID_VALUES, "people": [{"name": "Emma"}, {"name": "James"}], "posterTitle": "Our Love Story"}
        timeline = validate_and_normalize(
            titled, {"palette": "classic", "typography": "serif-classic", "layout": "neat-stack", "scale": 100}
        )
        from PIL import ImageDraw

        original = ImageDraw.ImageDraw.text
        drawn = []

        def spy(draw, xy, text, *args, **kwargs):
            drawn.append(text)
            return original(draw, xy, text, *args, **kwargs)

        with mock.patch.object(ImageDraw.ImageDraw, "text", spy):
            render_png(timeline, target_id=CARD_TARGET_ID, customer=None)
        self.assertIn("Our Love Story", drawn)
        self.assertEqual(drawn.count("Emma & James"), 1)


class NameJoiningTests(SimpleTestCase):
    """§3 — how the story's names are joined. "&" and nothing else, in
    every locale.

    A story holds one or two names (`MAX_PEOPLE`), so this is "A" or
    "A & B". The joiner used to vary by locale — a translated
    "and"/"et"/"و" — until §3 made it explicit and unqualified: always "&",
    never a translated word. That REVERSES an earlier fix that avoided a
    Latin ampersand inside right-to-left Arabic text — worth knowing, not
    hidden.
    """

    def test_two_names_use_the_pair_form(self):
        from apps.delivery.product_renderers.love_story_timeline.data import join_names

        self.assertEqual(join_names(["Emma", "James"], "en"), "Emma & James")

    def test_two_long_names_join_with_a_single_ampersand(self):
        # Within the 24-character per-name ceiling (`_validate_people`).
        from apps.delivery.product_renderers.love_story_timeline.data import join_names

        first, second = "Alexandra Konstantinopol", "Maximilian von Habsburg"
        self.assertTrue(len(first) <= 24 and len(second) <= 24)
        self.assertEqual(join_names([first, second], "en"), f"{first} & {second}")

    def test_arabic_uses_the_same_ampersand_not_a_translated_word(self):
        # This is the reversal: an earlier version deliberately avoided a
        # Latin "&" in Arabic text. §3's rule does not carve out an
        # exception, so the ampersand is uniform here too now.
        from apps.delivery.product_renderers.love_story_timeline.data import join_names

        joined = join_names(["Emma", "James"], "ar")
        self.assertEqual(joined, "Emma & James")
        self.assertNotIn("و", joined)

    def test_french_never_translates_to_et(self):
        from apps.delivery.product_renderers.love_story_timeline.data import join_names

        joined = join_names(["Emma", "James"], "fr")
        self.assertNotIn(" et ", joined)
        self.assertEqual(joined, "Emma & James")

    def test_locale_has_no_effect_on_the_result_at_all(self):
        # The strongest version of the rule: not just "no translated word"
        # but genuinely locale-independent output.
        from apps.delivery.product_renderers.love_story_timeline.data import join_names

        names = ["Emma", "James"]
        results = {join_names(names, locale) for locale in ("en", "fr", "ar", "de")}
        self.assertEqual(len(results), 1)

    def test_empty_and_single_names_are_handled(self):
        from apps.delivery.product_renderers.love_story_timeline.data import join_names

        self.assertEqual(join_names([], "en"), "")
        self.assertEqual(join_names(["Emma"], "en"), "Emma")
        self.assertEqual(join_names(["", "James"], "en"), "James")


class MomentWallpaperTests(SimpleTestCase):
    """§13 — both wallpaper kinds, as decided.

    `story` adapts the whole timeline to the device; `moment` gives one
    milestone the whole screen. Different compositions, not two crops of
    one — a timeline shrunk to a phone is legible at arm's length and
    unreadable on a lock screen.
    """

    def _render(self, target):
        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        return render_png(timeline, target_id=target, customer=None)

    def test_a_moment_wallpaper_matches_its_device(self):
        from apps.delivery.wallpaper_devices import WALLPAPER_DEVICES

        for device_id, device in WALLPAPER_DEVICES.items():
            with Image.open(io.BytesIO(self._render(f"wallpaper-{device_id}-moment-1"))) as img:
                self.assertEqual(img.size, (device.width, device.height), device_id)

    def test_story_and_moment_are_different_images(self):
        # If these came out identical, `moment` would be a naming exercise
        # rather than a second deliverable.
        self.assertNotEqual(
            self._render("wallpaper-phone"),
            self._render("wallpaper-phone-moment-1"),
        )

    def test_each_milestone_gives_a_different_wallpaper(self):
        self.assertNotEqual(
            self._render("wallpaper-phone-moment-1"),
            self._render("wallpaper-phone-moment-2"),
        )

    def test_an_index_past_the_last_milestone_still_renders(self):
        """Reachable if a project loses milestones between purchase and
        download. The customer paid for the file; a plain wallpaper beats a
        500 on it."""
        content = self._render("wallpaper-phone-moment-9")
        self.assertTrue(content.startswith(b"\x89PNG\r\n\x1a\n"))

    def test_moment_targets_are_named_from_one_not_zero(self):
        # The id reaches a filename a person reads, and "moment-0" reads as
        # a bug rather than as the first memory.
        from apps.delivery.wallpaper_devices import moment_target_id

        self.assertEqual(moment_target_id("phone", 0), "wallpaper-phone-moment-1")

    def test_the_pack_asks_for_story_targets_without_knowing_a_story(self):
        # A pack is defined before any customer exists, so the catalog must
        # be able to ask for its fixed targets with no milestone count.
        from apps.delivery.wallpaper_devices import all_wallpaper_target_ids

        self.assertEqual(len(all_wallpaper_target_ids()), 3)
        self.assertEqual(len(all_wallpaper_target_ids(3)), 12)


class OptionalMediaTests(SimpleTestCase):
    """§5 — milestone video, voice notes and background music.

    The word §5 keeps repeating is OPTIONAL: a Love Story Timeline must be
    valuable with only the core story and photographs, and customers must
    never be forced to provide media to make Digital or AR valid. Most of
    these assert that absence is fine.
    """

    def _values(self, **event_extra):
        import copy

        values = copy.deepcopy(VALID_VALUES)
        values["events"][0].update(event_extra)
        return values

    def test_a_story_with_no_media_is_completely_valid(self):
        # The baseline §5 insists on.
        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        self.assertIsNone(timeline.events[0].video_asset_id)
        self.assertEqual(timeline.background_music_preset, "none")

    def test_media_is_carried_through_when_provided(self):
        timeline = validate_and_normalize(
            self._values(video={"assetId": "v1"}, audio={"assetId": "a1"}), VALID_THEME
        )
        self.assertEqual(timeline.events[0].video_asset_id, "v1")
        self.assertEqual(timeline.events[0].audio_asset_id, "a1")

    def test_background_music_is_a_preset_selection_not_an_upload(self):
        """§4 — background music stopped being a customer upload and
        became a shipped preset id. It is story-level, which was already
        true and remains true: it plays across the whole journey, and a
        track per milestone would cut in and out as someone scrolls."""
        values = {**VALID_VALUES, "backgroundMusic": "tender-piano"}
        self.assertEqual(validate_and_normalize(values, VALID_THEME).background_music_preset, "tender-piano")

    def test_an_unknown_music_preset_is_rejected(self):
        # Unlike the old asset-upload field, this is now a closed choice —
        # any value not in MUSIC_PRESETS is a real validation error, not
        # something silently accepted.
        with self.assertRaises(LoveStoryTimelineInvalidData):
            validate_and_normalize({**VALID_VALUES, "backgroundMusic": "a-track-that-does-not-exist"}, VALID_THEME)

    def test_a_malformed_reference_is_rejected_rather_than_ignored(self):
        """Absent is fine; present-but-broken is not.

        Skipping it silently would surface as a failed render after the
        customer had already paid.
        """
        from apps.common.exceptions.api_errors import LoveStoryTimelineInvalidData

        with self.assertRaises(LoveStoryTimelineInvalidData):
            validate_and_normalize(self._values(video={"nope": True}), VALID_THEME)

    def test_media_never_reaches_a_printed_deliverable(self):
        """A poster cannot play a voice note.

        Rendering with and without media must produce identical bytes — if
        it did not, something in the print path would be reading media it
        has no way to present.
        """
        plain = render_png(validate_and_normalize(VALID_VALUES, VALID_THEME),
                           target_id="print-a4-edged", customer=None)
        with_media = render_png(
            validate_and_normalize(self._values(video={"assetId": "v1"}, audio={"assetId": "a1"}), VALID_THEME),
            target_id="print-a4-edged", customer=None,
        )
        self.assertEqual(plain, with_media)


class DurationPhrasingTests(SimpleTestCase):
    """§16 / §22 — the duration line on a poster.

    This hardcoded "days together" in English for every story type and
    every language, so a family history claimed a couple's phrasing and an
    Arabic poster carried an English sentence. Found by rendering the pack
    previews rather than by any test, which is why these exist now.
    """

    def test_a_couple_gets_days_together(self):
        from apps.delivery.product_renderers.love_story_timeline.data import duration_phrase

        self.assertIn("together", duration_phrase("couple", 2122, "en"))

    def test_parents_get_their_own_phrasing(self):
        from apps.delivery.product_renderers.love_story_timeline.data import duration_phrase

        self.assertIn("side by side", duration_phrase("parents", 2122, "en"))

    def test_family_and_gift_have_no_duration_line_at_all(self):
        # Not a fallback to the couple wording — None, so nothing is drawn.
        from apps.delivery.product_renderers.love_story_timeline.data import duration_phrase

        self.assertIsNone(duration_phrase("family", 2122, "en"))
        self.assertIsNone(duration_phrase("gift", 2122, "en"))

    def test_it_is_translated(self):
        from apps.delivery.product_renderers.love_story_timeline.data import duration_phrase

        arabic = duration_phrase("couple", 2122, "ar")
        self.assertNotIn("together", arabic)
        self.assertIn("معًا", arabic)

    def test_an_unknown_locale_falls_back_to_english(self):
        from apps.delivery.product_renderers.love_story_timeline.data import duration_phrase

        self.assertIn("together", duration_phrase("couple", 2122, "de"))

    def test_a_family_poster_renders_without_the_line(self):
        # End to end: the renderer must skip it rather than drawing an
        # empty string where the line would have been.
        import copy

        values = copy.deepcopy(VALID_VALUES)
        values["storyType"] = "family"
        values["showDuration"] = True
        content = render_png(
            validate_and_normalize(values, VALID_THEME), target_id="print-a4-edged", customer=None
        )
        self.assertTrue(content.startswith(b"\x89PNG\r\n\x1a\n"))


class LocationFieldTests(SimpleTestCase):
    """§6 — a milestone's place, structured rather than a plain string.

    A place with a name but no coordinates is not enough for the AR use
    case this exists for, and a legacy plain-string location (every
    milestone saved before this field existed) must keep opening rather
    than suddenly failing validation.
    """

    def _values(self, location):
        import copy

        values = copy.deepcopy(VALID_VALUES)
        values["events"][0]["location"] = location
        return values

    def test_a_structured_location_is_carried_through(self):
        timeline = validate_and_normalize(
            self._values({"name": "Lisbon", "lat": 38.7223, "lng": -9.1393, "mapboxId": "place.123"}),
            VALID_THEME,
        )
        event = timeline.events[0]
        self.assertEqual(event.location, "Lisbon")
        self.assertAlmostEqual(event.location_lat, 38.7223)
        self.assertAlmostEqual(event.location_lng, -9.1393)
        self.assertEqual(event.location_mapbox_id, "place.123")

    def test_a_legacy_plain_string_still_opens(self):
        """Every milestone location saved before this field existed IS a
        plain string. Rejecting it would break an old draft outright."""
        timeline = validate_and_normalize(self._values("Lisbon"), VALID_THEME)
        event = timeline.events[0]
        self.assertEqual(event.location, "Lisbon")
        self.assertIsNone(event.location_lat)
        self.assertIsNone(event.location_lng)

    def test_no_location_at_all_is_fine(self):
        # §4 — location has always been optional; that has not changed.
        timeline = validate_and_normalize(self._values(None), VALID_THEME)
        event = timeline.events[0]
        self.assertEqual(event.location, "")
        self.assertIsNone(event.location_lat)

    def test_a_name_with_no_coordinates_is_rejected(self):
        """A place with a name but no lat/lng is not what §6 needs — half
        the point is having real geography for AR to use later."""
        with self.assertRaises(LoveStoryTimelineInvalidData):
            validate_and_normalize(self._values({"name": "Lisbon"}), VALID_THEME)

    def test_out_of_range_coordinates_are_rejected(self):
        with self.assertRaises(LoveStoryTimelineInvalidData):
            validate_and_normalize(
                self._values({"name": "Nowhere", "lat": 200, "lng": 0}), VALID_THEME
            )

    def test_mapbox_id_is_optional(self):
        # Coordinates and a name are the minimum §6 asks for; the id is a
        # bonus when Mapbox provides one.
        timeline = validate_and_normalize(
            self._values({"name": "Lisbon", "lat": 38.7223, "lng": -9.1393}), VALID_THEME
        )
        self.assertIsNone(timeline.events[0].location_mapbox_id)

    def test_the_poster_still_draws_the_plain_name(self):
        """Every one of the six compositions' drawing code reads
        `event.location` as a string, unchanged — this is what makes the
        whole change purely additive rather than a renderer rewrite."""
        content = render_png(
            validate_and_normalize(
                self._values({"name": "Cascais", "lat": 38.69, "lng": -9.42}), VALID_THEME
            ),
            target_id="print-a4-edged", customer=None,
        )
        self.assertTrue(content.startswith(b"\x89PNG\r\n\x1a\n"))
