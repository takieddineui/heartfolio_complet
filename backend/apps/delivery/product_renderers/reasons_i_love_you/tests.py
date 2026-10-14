"""
Reasons I Love You — the first live-only product.

What is pinned here, and why it matters:
  - the data contract (`data.py`): required fields, every cap, the 1-10
    reasons (the deck has only Ace to 10), optional photos that must still be
    real uploads, the letter required only while it is on, and a gift that
    always resolves to one of the four;
  - the registry entry exists FOR the pre-payment check, and order creation
    really runs it, so a malformed gift is refused before anyone pays;
  - the live page's own payload, with each photo's URL generated fresh and
    ownership-checked, and the explicit per-product dispatch (an unknown
    product gets the generic 404 rather than Love Story Timeline's builder);
  - the catalog: one `live` pack granting `__live__` only, accepted by both
    the seed script's and the admin form's target checks.
"""

from __future__ import annotations

import copy
import uuid
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase
from rest_framework import status as http_status
from rest_framework.test import APIClient

from apps.commerce.models import Order
from apps.common.exceptions.api_errors import RendererNotAvailable, ReasonsILoveYouInvalidData
from apps.delivery.bonuses import BONUS_PRINT_ADVICE, BONUS_QR, BONUS_THANK_YOU, bonus_targets_for_order
from apps.delivery.delivery_types import LIVE_TARGET_SENTINEL
from apps.delivery.models import PublicExperience
from apps.delivery.registry import get_renderer
from apps.delivery.tests import make_asset, make_customer, make_paid_order_with_entitlements, make_product
from apps.projects.models import Project

from . import data as reasons_data
from .data import validate_and_normalize
from .renderer import ReasonsILoveYouRenderer

SLUG = "reasons-i-love-you"

#: The Studio's own opening state (`initial-state.ts`), as it is saved.
VALID_VALUES = {
    "toName": "Hana",
    "fromName": "Theo",
    "title": "",
    "reasons": [
        {"text": "The way you laugh at your own jokes."},
        {"text": "Ordinary Tuesdays.", "memory": "Pancakes for dinner, March 2025."},
        {"text": "Good morning, every single day."},
    ],
    "finaleTeaser": "",
    "finaleLine": "And the reason above all: you are you.",
    "signature": "",
    "letterEnabled": True,
    "letterGreeting": "Hana,",
    "letterParagraphs": [{"text": "I could have written a hundred."}, {"text": "Thank you for the ordinary days."}],
    "letterSignoff": "All my love,",
    "music": True,
    "showShare": True,
}
VALID_THEME = {"gift": "deck"}


def values(**overrides):
    result = copy.deepcopy(VALID_VALUES)
    result.update(overrides)
    return result


class DataValidationTests(SimpleTestCase):
    def test_the_studios_opening_state_is_valid(self):
        gift = validate_and_normalize(VALID_VALUES, VALID_THEME)
        self.assertEqual(gift.gift, "deck")
        self.assertEqual(gift.to_name, "Hana")
        self.assertEqual(len(gift.reasons), 3)
        self.assertEqual(gift.reasons[1].memory, "Pancakes for dinner, March 2025.")
        self.assertEqual(gift.letter.paragraphs, ("I could have written a hundred.", "Thank you for the ordinary days."))

    def test_an_unknown_or_missing_gift_falls_back_to_the_jar(self):
        self.assertIn(reasons_data.DEFAULT_GIFT, reasons_data.GIFTS)
        self.assertEqual(validate_and_normalize(VALID_VALUES, {"gift": "tiara"}).gift, "jar")
        self.assertEqual(validate_and_normalize(VALID_VALUES, None).gift, "jar")

    def test_every_gift_is_accepted(self):
        for gift in ("jar", "daisy", "deck", "cookies"):
            self.assertEqual(validate_and_normalize(VALID_VALUES, {"gift": gift}).gift, gift)

    def test_not_a_dict_is_refused(self):
        with self.assertRaises(ReasonsILoveYouInvalidData):
            validate_and_normalize(["not", "a", "dict"], VALID_THEME)

    def test_required_fields(self):
        for key in ("toName", "fromName", "finaleLine"):
            with self.subTest(key=key), self.assertRaises(ReasonsILoveYouInvalidData):
                validate_and_normalize(values(**{key: "   "}), VALID_THEME)

    def test_the_optional_fields_may_be_empty(self):
        gift = validate_and_normalize(values(title="", finaleTeaser="", signature="", letterSignoff=""), VALID_THEME)
        self.assertEqual((gift.title, gift.finale_teaser, gift.signature), ("", "", ""))

    def test_every_cap_is_enforced_at_one_over_and_allowed_at_the_cap(self):
        top_level = {
            "toName": reasons_data.NAME_MAX_LENGTH,
            "fromName": reasons_data.NAME_MAX_LENGTH,
            "title": reasons_data.TITLE_MAX_LENGTH,
            "finaleTeaser": reasons_data.TEASER_MAX_LENGTH,
            "finaleLine": reasons_data.FINALE_LINE_MAX_LENGTH,
            "signature": reasons_data.SIGNATURE_MAX_LENGTH,
            "letterGreeting": reasons_data.GREETING_MAX_LENGTH,
            "letterSignoff": reasons_data.SIGNOFF_MAX_LENGTH,
        }
        for key, cap in top_level.items():
            with self.subTest(key=key):
                validate_and_normalize(values(**{key: "x" * cap}), VALID_THEME)
                with self.assertRaises(ReasonsILoveYouInvalidData):
                    validate_and_normalize(values(**{key: "x" * (cap + 1)}), VALID_THEME)

        for key, cap in (("text", reasons_data.REASON_MAX_LENGTH), ("memory", reasons_data.MEMORY_MAX_LENGTH)):
            with self.subTest(key=f"reasons[].{key}"):
                validate_and_normalize(values(reasons=[{"text": "x", key: "x" * cap}]), VALID_THEME)
                with self.assertRaises(ReasonsILoveYouInvalidData):
                    validate_and_normalize(values(reasons=[{"text": "x", key: "x" * (cap + 1)}]), VALID_THEME)

        validate_and_normalize(values(letterParagraphs=[{"text": "x" * reasons_data.PARAGRAPH_MAX_LENGTH}]), VALID_THEME)
        with self.assertRaises(ReasonsILoveYouInvalidData):
            validate_and_normalize(values(letterParagraphs=[{"text": "x" * (reasons_data.PARAGRAPH_MAX_LENGTH + 1)}]), VALID_THEME)

    def test_one_to_ten_reasons(self):
        self.assertEqual(reasons_data.MAX_REASONS, 10)  # the deck: Ace to 10 of Hearts
        validate_and_normalize(values(reasons=[{"text": "one"}]), VALID_THEME)
        validate_and_normalize(values(reasons=[{"text": f"r{i}"} for i in range(10)]), VALID_THEME)
        for count in (0, 11):
            with self.subTest(count=count), self.assertRaises(ReasonsILoveYouInvalidData):
                validate_and_normalize(values(reasons=[{"text": f"r{i}"} for i in range(count)]), VALID_THEME)

    def test_a_reason_needs_words(self):
        with self.assertRaises(ReasonsILoveYouInvalidData):
            validate_and_normalize(values(reasons=[{"text": "  ", "memory": "a memory alone"}]), VALID_THEME)

    def test_a_photo_is_optional_but_must_be_a_real_upload_if_present(self):
        gift = validate_and_normalize(values(reasons=[{"text": "x", "photo": {"assetId": "abc", "url": "blob:ignored"}}]), VALID_THEME)
        self.assertEqual(gift.reasons[0].photo_asset_id, "abc")
        self.assertIsNone(validate_and_normalize(values(reasons=[{"text": "x"}]), VALID_THEME).reasons[0].photo_asset_id)
        # Picked in the Studio but never uploaded: refused before payment.
        with self.assertRaises(ReasonsILoveYouInvalidData):
            validate_and_normalize(values(reasons=[{"text": "x", "photo": {"url": "blob:local-only"}}]), VALID_THEME)

    def test_the_letter_is_required_only_while_it_is_on(self):
        off = validate_and_normalize(values(letterEnabled=False, letterGreeting="", letterParagraphs=[]), VALID_THEME)
        self.assertIsNone(off.letter)
        # Missing entirely means off.
        no_keys = {k: v for k, v in VALID_VALUES.items() if not k.startswith("letter")}
        self.assertIsNone(validate_and_normalize(no_keys, VALID_THEME).letter)

        for broken in (
            {"letterGreeting": ""},
            {"letterParagraphs": []},
            {"letterParagraphs": [{"text": "  "}]},
            {"letterParagraphs": [{"text": f"p{i}"} for i in range(6)]},
        ):
            with self.subTest(broken=broken), self.assertRaises(ReasonsILoveYouInvalidData):
                validate_and_normalize(values(**broken), VALID_THEME)

    def test_switches_default_to_on(self):
        gift = validate_and_normalize({k: v for k, v in VALID_VALUES.items() if k not in ("music", "showShare")}, VALID_THEME)
        self.assertTrue(gift.music)
        self.assertTrue(gift.show_share)
        gift = validate_and_normalize(values(music=False, showShare=False), VALID_THEME)
        self.assertFalse(gift.music)
        self.assertFalse(gift.show_share)


class RegistrationTests(SimpleTestCase):
    def test_registered_for_its_pre_payment_check(self):
        renderer = get_renderer(SLUG, "")
        self.assertIsInstance(renderer, ReasonsILoveYouRenderer)
        renderer.validate_project_data(VALID_VALUES, VALID_THEME)
        with self.assertRaises(ReasonsILoveYouInvalidData):
            renderer.validate_project_data(values(toName=""), VALID_THEME)

    def test_it_never_renders_anything(self):
        with self.assertRaises(RendererNotAvailable):
            ReasonsILoveYouRenderer().render(None, "printable", None, "print-png")


class OrderCreationTests(TestCase):
    """The point of registering a renderer that renders nothing."""

    def _project(self, customer, product, project_values):
        return Project.objects.create(
            customer=customer, product=product, data={"version": 1, "values": project_values, "themeSelections": VALID_THEME}
        )

    def test_a_malformed_gift_is_refused_before_payment(self):
        from apps.commerce.services import create_order
        from apps.delivery.tests import make_delivery_pack

        customer = make_customer()
        product = make_product(slug=SLUG)
        make_delivery_pack(product=product, slug="live", included_targets=[LIVE_TARGET_SENTINEL], price_cents=1599)
        project = self._project(customer, product, values(reasons=[]))

        with self.assertRaises(ReasonsILoveYouInvalidData):
            create_order(customer, product_slug=SLUG, delivery_pack_slug="live", project_id=project.id)
        self.assertFalse(Order.objects.filter(project=project).exists())

    def test_a_valid_gift_can_be_ordered(self):
        from apps.commerce.services import create_order
        from apps.delivery.tests import make_delivery_pack

        customer = make_customer()
        product = make_product(slug=SLUG)
        make_delivery_pack(product=product, slug="live", included_targets=[LIVE_TARGET_SENTINEL], price_cents=1599)
        project = self._project(customer, product, VALID_VALUES)

        order = create_order(customer, product_slug=SLUG, delivery_pack_slug="live", project_id=project.id)
        self.assertEqual(order.total_cents, 1599)


class LivePayloadTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _experience(self, *, project_values=None, theme=None, product_slug=SLUG, paid=True):
        from apps.delivery.tests import make_delivery_pack
        from apps.products.models import DeliveryPack, Product

        # One product and one `live` pack, however many orders a test makes,
        # as in the real catalog (both are unique).
        product = Product.objects.filter(slug=product_slug).first() or make_product(slug=product_slug)
        pack = DeliveryPack.objects.filter(product=product, slug="live").first() or make_delivery_pack(
            product=product, slug="live", included_targets=[LIVE_TARGET_SENTINEL], price_cents=1599
        )
        customer, order, _ = make_paid_order_with_entitlements(
            target_ids=[LIVE_TARGET_SENTINEL], product=product, delivery_pack=pack
        )
        order.project.data = {"version": 1, "values": project_values or VALID_VALUES, "themeSelections": theme or VALID_THEME}
        order.project.save(update_fields=["data"])
        if not paid:
            order.status = Order.STATUS_PENDING
            order.save(update_fields=["status"])
        order.locale = "ar"
        order.save(update_fields=["locale"])
        experience = PublicExperience.objects.get(entitlement__order=order, kind=PublicExperience.KIND_LIVE)
        return customer, order, experience

    def test_the_payload_is_the_experiences_own_shape(self):
        _, _, experience = self._experience()

        response = self.client.get(f"/api/v1/live/{experience.id}/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response["X-Robots-Tag"], "noindex, nofollow")
        self.assertEqual(response.data["productId"], SLUG)
        self.assertEqual(response.data["locale"], "ar")
        payload = response.data["values"]
        self.assertEqual(
            set(payload),
            {"gift", "toName", "fromName", "title", "reasons", "finaleTeaser", "finaleLine", "signature", "letter", "music", "share"},
        )
        self.assertEqual(payload["gift"], "deck")
        self.assertEqual(payload["reasons"][1], {"text": "Ordinary Tuesdays.", "memory": "Pancakes for dinner, March 2025.", "photo": None})
        self.assertEqual(payload["letter"]["paragraphs"], ["I could have written a hundred.", "Thank you for the ordinary days."])
        # Nothing AR-shaped leaks in: this is not Love Story Timeline's payload.
        for absent in ("scene", "level", "targetUrl", "media", "themeSelections"):
            self.assertNotIn(absent, response.data)

    def test_a_switched_off_letter_is_null(self):
        _, _, experience = self._experience(project_values=values(letterEnabled=False))
        self.assertIsNone(self.client.get(f"/api/v1/live/{experience.id}/").data["values"]["letter"])

    def test_photos_are_fresh_ownership_checked_urls_and_a_foreign_one_is_dropped(self):
        product = make_product(slug=SLUG)
        customer, order, _ = make_paid_order_with_entitlements(target_ids=[LIVE_TARGET_SENTINEL], product=product)
        own = make_asset(customer=customer, mime_type="image/jpeg", storage_key=f"assets/{uuid.uuid4().hex}.jpg")
        foreign = make_asset(customer=make_customer(), mime_type="image/jpeg", storage_key=f"assets/{uuid.uuid4().hex}.jpg")
        order.project.data = {
            "version": 1,
            "values": values(
                reasons=[
                    {"text": "mine", "photo": {"assetId": str(own.id), "url": "https://expired.example/old"}},
                    {"text": "not mine", "photo": {"assetId": str(foreign.id)}},
                ]
            ),
            "themeSelections": VALID_THEME,
        }
        order.project.save(update_fields=["data"])
        experience = PublicExperience.objects.get(entitlement__order=order)

        with patch("apps.assets.services.generate_asset_access_url", side_effect=lambda asset: f"https://fresh.example/{asset.id}") as fresh:
            response = self.client.get(f"/api/v1/live/{experience.id}/")

        reasons = response.data["values"]["reasons"]
        self.assertEqual(reasons[0]["photo"], {"url": f"https://fresh.example/{own.id}"})
        self.assertIsNone(reasons[1]["photo"])
        self.assertEqual(fresh.call_count, 1)

    def test_an_invalid_project_unpaid_order_or_unknown_id_are_the_same_404(self):
        _, _, broken = self._experience(project_values=values(reasons=[]))
        _, _, unpaid = self._experience(paid=False)
        responses = [
            self.client.get(f"/api/v1/live/{broken.id}/"),
            self.client.get(f"/api/v1/live/{unpaid.id}/"),
            self.client.get(f"/api/v1/live/{uuid.uuid4()}/"),
        ]
        self.assertEqual({r.status_code for r in responses}, {http_status.HTTP_404_NOT_FOUND})
        self.assertEqual(len({str(r.data) for r in responses}), 1)

    def test_dispatch_is_explicit_an_unknown_product_gets_the_generic_404(self):
        # Valid Reasons data, but the order is for a product with no live
        # page. It used to fall through to Love Story Timeline's builder.
        _, _, experience = self._experience(product_slug=f"mystery-{uuid.uuid4().hex[:6]}")
        # `return_value=None`: if the fallback ever comes back, the builder is
        # CALLED (and the assertion below fails cleanly) rather than handing a
        # MagicMock to the response renderer, which crashes the run instead.
        with patch("apps.delivery.live_views._build_ar_payload", return_value=None) as love_story_builder:
            response = self.client.get(f"/api/v1/live/{experience.id}/")
        self.assertEqual(response.status_code, http_status.HTTP_404_NOT_FOUND)
        love_story_builder.assert_not_called()

    def test_each_product_reaches_its_own_builder(self):
        from apps.delivery import live_views

        self.assertIs(live_views._LIVE_PAYLOAD_BUILDERS["love-story-timeline"], live_views._build_ar_payload)
        self.assertIs(live_views._LIVE_PAYLOAD_BUILDERS["song-poster"], live_views._build_song_poster_live_payload)
        self.assertIs(live_views._LIVE_PAYLOAD_BUILDERS[SLUG], live_views._build_reasons_live_payload)


class CatalogTests(SimpleTestCase):
    def _entry(self):
        import seed_catalog

        return next(entry for entry in seed_catalog.CATALOG if entry["slug"] == SLUG)

    def test_one_live_pack_at_the_digital_price_granting_only_the_live_page(self):
        entry = self._entry()
        self.assertEqual(entry["category"], "other")
        self.assertEqual(entry["starting_price_cents"], 1599)
        self.assertEqual(entry["packs"], [("live", 1599, ["__live__"], "active")])

    def test_the_seed_and_the_admin_accept_it(self):
        import seed_catalog
        from apps.products.admin import _supported_targets

        self.assertEqual(seed_catalog.supported_targets(SLUG), {LIVE_TARGET_SENTINEL})
        self.assertEqual(seed_catalog.validate(self._entry()), [])
        self.assertEqual(_supported_targets(SLUG), {LIVE_TARGET_SENTINEL})

    def test_a_live_only_order_gets_the_thank_you_and_gift_qr_but_no_printing_advice(self):
        order = SimpleNamespace(delivery_pack=SimpleNamespace(included_targets=["__live__"]))
        bonuses = bonus_targets_for_order(order)
        self.assertEqual(bonuses, [BONUS_THANK_YOU, BONUS_QR])
        self.assertNotIn(BONUS_PRINT_ADVICE, bonuses)


class GiftCardCaptionTests(TestCase):
    """The recipient's gift QR card is captioned with the two names, sender
    first, the way Love Story Timeline's carries its couple's names. It used
    to fall back to the generic caption."""

    def _order(self, project_values, locale="en"):
        _customer, order, _ = make_paid_order_with_entitlements(
            target_ids=[LIVE_TARGET_SENTINEL], product=make_product(slug=SLUG)
        )
        order.project.data = {"version": 1, "values": project_values, "themeSelections": dict(VALID_THEME)}
        order.project.save(update_fields=["data"])
        order.locale = locale
        order.save(update_fields=["locale"])
        order.refresh_from_db()
        return order

    def test_the_caption_is_the_sender_and_the_recipient(self):
        from apps.delivery.bonuses import _qr_caption_for_order

        self.assertEqual(_qr_caption_for_order(self._order(values())), "Theo & Hana")

    def test_the_names_are_never_put_into_an_english_sentence(self):
        from apps.delivery.bonuses import _qr_caption_for_order

        caption = _qr_caption_for_order(self._order(values(fromName="  سامي ", toName="ليلى"), locale="ar"))
        self.assertEqual(caption, "سامي & ليلى")

    def test_the_recipients_card_is_drawn_with_it(self):
        from apps.delivery import bonuses

        order = self._order(values())
        with patch.object(bonuses, "_render_qr_card", return_value=b"png") as render:
            bonuses.render_recipient_qr_card(order)
        self.assertEqual(render.call_args.kwargs["caption"], "Theo & Hana")

    def test_a_project_that_does_not_validate_gets_the_generic_caption(self):
        from apps.delivery.bonuses import _qr_caption_for_order

        self.assertIsNone(_qr_caption_for_order(self._order(values(fromName=""))))

