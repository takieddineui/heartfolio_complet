"""Graduation Keepsake's backend: the data contract, the live payload, the paid
voice messages, the gift card and the catalog entry.

Run with the throwaway database (CLAUDE.md, "Running the tests").
"""

from __future__ import annotations

import copy
import uuid
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase
from rest_framework import status as http_status
from rest_framework.test import APIClient

from apps.commerce.models import Order
from apps.common.exceptions.api_errors import GraduationKeepsakeInvalidData, RendererNotAvailable
from apps.delivery.delivery_types import LIVE_TARGET_SENTINEL
from apps.delivery.models import PublicExperience
from apps.delivery.registry import get_renderer
from apps.delivery.tests import make_asset, make_customer, make_paid_order_with_entitlements, make_product
from apps.projects.models import Project

from . import data as grad_data
from .data import audio_asset_ids, validate_and_normalize
from .renderer import GraduationKeepsakeRenderer

SLUG = "graduation-keepsake"


def _media(asset_id: str | None = None) -> dict:
    return {"assetId": asset_id or str(uuid.uuid4()), "url": "blob:preview", "mimeType": "image/jpeg"}


def _person(name: str, **extra) -> dict:
    return {"name": name, "color": "", "emoji": "", "message": f"Well done, from {name}.", **extra}


#: The Studio's opening state (`initial-state.ts`), with its photos uploaded.
VALID_VALUES = {
    "gradName": "Maya",
    "gradFullName": "Maya Chen",
    "gradYear": "2027",
    "gradDegree": "BA (Hons) Architecture",
    "gradSchool": "University of Edinburgh",
    "gradDate": "2027-07-02",
    "gradPhoto": _media(),
    "pathEnabled": True,
    "thenYear": "2005",
    "thenText": "A five-year-old who drew houses on every wall.",
    "thenPhoto": _media(),
    "stops": [
        {"year": "2010", "caption": "First day of school", "code": "sch", "photo": _media()},
        {"year": "2023", "caption": "Studio all-nighter no. 47", "code": "", "photo": _media()},
    ],
    "nowYear": "2027",
    "nowText": "An architect, with a first-class degree to prove it.",
    "nextText": "A junior designer role in Copenhagen.",
    "nextPhoto": _media(),
    "achievementsEnabled": True,
    "achievements": [{"title": "First-class honours", "detail": "Top of the year", "place": "EDINBURGH"}],
    "messagesEnabled": True,
    "messageGroups": [
        {"label": "From home", "people": [_person("Mum", color="coral", emoji="🏡"), _person("Dad")]},
        {"label": "From friends", "people": [_person("Priya", emoji="👨‍👩‍👧‍👦")]},
    ],
    "goalsEnabled": True,
    "goals": [{"text": "Start at the studio in Copenhagen", "code": "CPH"}],
    "letterEnabled": True,
    "letterGreeting": "Dear Maya,",
    "letterParagraphs": [{"text": "We could not be prouder."}],
    "letterSignoff": "With all our love,",
    "letterSignatures": [{"name": "Mum"}, {"name": "Dad"}],
    "endingLine": "Congratulations, Maya!",
    "endingSub": "Your next chapter starts now.",
    "flightAirline": "",
    "flightFromCode": "kid",
    "sound": True,
    "showShare": True,
}
VALID_THEME = {"journey": "space"}
AIRLINE = {"journey": "airline"}


def values(**overrides) -> dict:
    result = copy.deepcopy(VALID_VALUES)
    result.update(overrides)
    return result


def people(count: int, **extra) -> list[dict]:
    return [_person(f"P{i}", **extra) for i in range(count)]


class DataValidationTests(SimpleTestCase):
    def test_the_studio_opening_state_is_valid(self):
        grad = validate_and_normalize(VALID_VALUES, VALID_THEME)
        self.assertEqual(grad.journey, "space")
        self.assertEqual(grad.graduate.full_name, "Maya Chen")
        self.assertEqual(grad.messages[0].people[0].colour, "coral")
        airline = validate_and_normalize(VALID_VALUES, AIRLINE)
        self.assertEqual([s.code for s in airline.path.stops], ["SCH", ""])
        self.assertEqual(airline.flight.from_code, "KID")

    def test_airline_only_fields_are_neither_checked_nor_kept_on_another_journey(self):
        """Hidden in the Studio on the other four journeys, so a bad value left
        over from trying the airline cannot block payment invisibly."""
        bad = values(
            goals=[{"text": "g", "code": "1X"}],
            achievements=[{"title": "a", "place": "x" * 99}],
            flightFromCode="??",
            flightAirline="x" * 99,
        )
        grad = validate_and_normalize(bad, VALID_THEME)
        self.assertEqual((grad.goals[0].code, grad.achievements[0].place, grad.flight.airline), ("", "", ""))
        for key in ("code", "place", "flightFromCode", "flightAirline"):
            with self.subTest(key=key), self.assertRaisesRegex(GraduationKeepsakeInvalidData, key):
                validate_and_normalize(bad, AIRLINE)

    def test_an_unknown_or_missing_journey_falls_back_to_the_airline(self):
        for theme in ({}, {"journey": "submarine"}, None):
            self.assertEqual(validate_and_normalize(VALID_VALUES, theme).journey, grad_data.DEFAULT_JOURNEY)
        self.assertIn(grad_data.DEFAULT_JOURNEY, grad_data.JOURNEYS)
        self.assertEqual(grad_data.JOURNEYS, ("airline", "space", "arcade", "museum", "summit"))

    def test_every_text_cap_is_inclusive_and_one_more_is_refused(self):
        def at(n):
            return "x" * n

        cases = [
            ({"gradName": None}, "gradName", grad_data.NAME_MAX_LENGTH),
            ({"gradFullName": None}, "gradFullName", grad_data.FULL_NAME_MAX_LENGTH),
            ({"gradDegree": None}, "gradDegree", grad_data.DEGREE_MAX_LENGTH),
            ({"gradSchool": None}, "gradSchool", grad_data.SCHOOL_MAX_LENGTH),
            ({"thenYear": None}, "thenYear", grad_data.PATH_YEAR_MAX_LENGTH),
            ({"thenText": None}, "thenText", grad_data.PATH_TEXT_MAX_LENGTH),
            ({"nowText": None}, "nowText", grad_data.PATH_TEXT_MAX_LENGTH),
            ({"nextText": None}, "nextText", grad_data.PATH_TEXT_MAX_LENGTH),
            ({"letterGreeting": None}, "letterGreeting", grad_data.GREETING_MAX_LENGTH),
            ({"letterSignoff": None}, "letterSignoff", grad_data.SIGNOFF_MAX_LENGTH),
            ({"endingLine": None}, "endingLine", grad_data.ENDING_LINE_MAX_LENGTH),
            ({"endingSub": None}, "endingSub", grad_data.ENDING_SUB_MAX_LENGTH),
            ({"flightAirline": None}, "flightAirline", grad_data.FLIGHT_AIRLINE_MAX_LENGTH),
            ({"flightNumber": None}, "flightNumber", grad_data.FLIGHT_NUMBER_MAX_LENGTH),
            ({"flightSeat": None}, "flightSeat", grad_data.FLIGHT_SEAT_MAX_LENGTH),
            ({"flightCabin": None}, "flightCabin", grad_data.FLIGHT_CABIN_MAX_LENGTH),
            ({"flightToCity": None}, "flightToCity", grad_data.FLIGHT_CITY_MAX_LENGTH),
        ]
        for _, key, cap in cases:
            with self.subTest(key=key):
                validate_and_normalize(values(**{key: at(cap)}), AIRLINE)
                with self.assertRaisesRegex(GraduationKeepsakeInvalidData, key):
                    validate_and_normalize(values(**{key: at(cap + 1)}), AIRLINE)

    def test_nested_text_caps(self):
        def item_case(field, key, cap, build):
            validate_and_normalize(values(**{field: build("x" * cap)}), AIRLINE)
            with self.assertRaisesRegex(GraduationKeepsakeInvalidData, key):
                validate_and_normalize(values(**{field: build("x" * (cap + 1))}), AIRLINE)

        stop = lambda **kw: [{"year": "2010", "caption": "c", "photo": _media(), **kw}]  # noqa: E731
        item_case("stops", "caption", grad_data.STOP_CAPTION_MAX_LENGTH, lambda t: stop(caption=t))
        item_case("stops", "year", grad_data.PATH_YEAR_MAX_LENGTH, lambda t: stop(year=t))
        item_case("achievements", "title", grad_data.ACHIEVEMENT_TITLE_MAX_LENGTH, lambda t: [{"title": t}])
        item_case("achievements", "detail", grad_data.ACHIEVEMENT_DETAIL_MAX_LENGTH, lambda t: [{"title": "a", "detail": t}])
        item_case("achievements", "place", grad_data.ACHIEVEMENT_PLACE_MAX_LENGTH, lambda t: [{"title": "a", "place": t}])
        item_case("goals", "text", grad_data.GOAL_MAX_LENGTH, lambda t: [{"text": t}])
        item_case("letterParagraphs", "text", grad_data.PARAGRAPH_MAX_LENGTH, lambda t: [{"text": t}])
        item_case("letterSignatures", "name", grad_data.SIGNATURE_MAX_LENGTH, lambda t: [{"name": t}])
        item_case("messageGroups", "label", grad_data.GROUP_LABEL_MAX_LENGTH, lambda t: [{"label": t, "people": people(1)}])
        item_case("messageGroups", "name", grad_data.PERSON_NAME_MAX_LENGTH, lambda t: [{"label": "g", "people": [_person(t)]}])
        item_case(
            "messageGroups", "message", grad_data.MESSAGE_MAX_LENGTH,
            lambda t: [{"label": "g", "people": [{"name": "n", "message": t}]}],
        )
        item_case(
            "messageGroups", "voiceCaption", grad_data.VOICE_CAPTION_MAX_LENGTH,
            lambda t: [{"label": "g", "people": [_person("n", voice=_media(), voiceCaption=t)]}],
        )

    def test_list_sizes(self):
        stop = {"year": "2010", "caption": "c", "photo": _media()}
        cases = [
            ("stops", stop, grad_data.MIN_STOPS, grad_data.MAX_STOPS),
            ("achievements", {"title": "a"}, grad_data.MIN_ACHIEVEMENTS, grad_data.MAX_ACHIEVEMENTS),
            ("goals", {"text": "g"}, grad_data.MIN_GOALS, grad_data.MAX_GOALS),
            ("letterParagraphs", {"text": "p"}, grad_data.MIN_PARAGRAPHS, grad_data.MAX_PARAGRAPHS),
            ("letterSignatures", {"name": "s"}, grad_data.MIN_SIGNATURES, grad_data.MAX_SIGNATURES),
            ("messageGroups", {"label": "g", "people": people(1)}, grad_data.MIN_GROUPS, grad_data.MAX_GROUPS),
        ]
        for key, item, low, high in cases:
            with self.subTest(key=key):
                for count in (low, high):
                    validate_and_normalize(values(**{key: [copy.deepcopy(item) for _ in range(count)]}), VALID_THEME)
                for count in (low - 1, high + 1):
                    with self.assertRaisesRegex(GraduationKeepsakeInvalidData, key):
                        validate_and_normalize(values(**{key: [copy.deepcopy(item) for _ in range(count)]}), VALID_THEME)
        validate_and_normalize(values(messageGroups=[{"label": "g", "people": people(grad_data.MAX_PEOPLE)}]), VALID_THEME)
        for count in (0, grad_data.MAX_PEOPLE + 1):
            with self.assertRaisesRegex(GraduationKeepsakeInvalidData, "people"):
                validate_and_normalize(values(messageGroups=[{"label": "g", "people": people(count)}]), VALID_THEME)

    def test_the_spec_numbers(self):
        """The approved limits (14 Oct 2026), so a change is a decision."""
        self.assertEqual(
            (grad_data.MAX_STOPS, grad_data.MAX_ACHIEVEMENTS, grad_data.MAX_GROUPS, grad_data.MAX_PEOPLE, grad_data.MAX_GOALS),
            (12, 10, 3, 12, 10),
        )
        self.assertEqual((grad_data.MAX_VOICES, grad_data.MAX_DRAWINGS), (5, 5))
        self.assertEqual((grad_data.ACHIEVEMENT_TITLE_MAX_LENGTH, grad_data.MESSAGE_MAX_LENGTH), (26, 300))
        # The worst-case upload count stays under production's 30 a minute.
        photos = 3 + grad_data.MAX_STOPS
        self.assertLessEqual(photos + grad_data.MAX_VOICES + grad_data.MAX_DRAWINGS, 25)

    def test_required_fields_and_photos(self):
        for key in ("gradName", "gradFullName", "gradDegree", "gradSchool", "gradPhoto", "thenPhoto", "nextPhoto", "endingLine", "letterGreeting"):
            with self.subTest(key=key), self.assertRaisesRegex(GraduationKeepsakeInvalidData, key):
                validate_and_normalize(values(**{key: None}), VALID_THEME)
        with self.assertRaisesRegex(GraduationKeepsakeInvalidData, "photo"):
            validate_and_normalize(values(stops=[{"year": "2010", "caption": "c"}]), VALID_THEME)
        # A file picked but never uploaded (no assetId) is caught before payment.
        with self.assertRaisesRegex(GraduationKeepsakeInvalidData, "assetId"):
            validate_and_normalize(values(gradPhoto={"url": "blob:x"}), VALID_THEME)

    def test_a_switched_off_chapter_is_neither_validated_nor_returned(self):
        off = values(
            pathEnabled=False, stops=[], thenPhoto=None,
            achievementsEnabled=False, achievements=[],
            messagesEnabled=False, messageGroups=[],
            goalsEnabled=False, goals=[],
            letterEnabled=False, letterGreeting="", letterSignatures=[],
        )
        grad = validate_and_normalize(off, VALID_THEME)
        self.assertEqual((grad.path, grad.achievements, grad.messages, grad.goals, grad.letter), (None, None, None, None, None))
        # A missing switch is ON, as in the Studio's opening state.
        with self.assertRaises(GraduationKeepsakeInvalidData):
            validate_and_normalize({k: v for k, v in off.items() if k != "goalsEnabled"}, VALID_THEME)

    def test_years_dates_and_codes(self):
        for bad in ("27", "20x7", "", "20270"):
            with self.subTest(year=bad), self.assertRaisesRegex(GraduationKeepsakeInvalidData, "gradYear"):
                validate_and_normalize(values(gradYear=bad), VALID_THEME)
        self.assertEqual(validate_and_normalize(values(gradYear=2027), VALID_THEME).graduate.year, "2027")
        for bad in ("2027-02-30", "20270702", "2 July 2027", ""):
            with self.subTest(date=bad), self.assertRaisesRegex(GraduationKeepsakeInvalidData, "gradDate"):
                validate_and_normalize(values(gradDate=bad), VALID_THEME)
        for bad in ("CP", "CPHX", "C1H", "ÇPH"):
            with self.subTest(code=bad), self.assertRaisesRegex(GraduationKeepsakeInvalidData, "code"):
                validate_and_normalize(values(goals=[{"text": "g", "code": bad}]), AIRLINE)

    def test_one_emoji_and_a_palette_colour(self):
        with self.assertRaisesRegex(GraduationKeepsakeInvalidData, "emoji"):
            validate_and_normalize(values(messageGroups=[{"label": "g", "people": [_person("n", emoji="🎓 🎉")]}]), VALID_THEME)
        with self.assertRaisesRegex(GraduationKeepsakeInvalidData, "color"):
            validate_and_normalize(values(messageGroups=[{"label": "g", "people": [_person("n", color="#ff0000")]}]), VALID_THEME)

    def test_at_most_five_voice_messages_and_five_drawings_in_the_whole_keepsake(self):
        """Across groups, not per person: three groups of two voices is six."""
        def groups(field, total):
            spread = [[], [], []]
            for i in range(total):
                spread[i % 3].append(_person(f"P{i}", **{field: _media()}))
            return [{"label": f"g{i}", "people": p or people(1)} for i, p in enumerate(spread)]

        for field, cap in (("voice", grad_data.MAX_VOICES), ("drawing", grad_data.MAX_DRAWINGS)):
            with self.subTest(field=field):
                validate_and_normalize(values(messageGroups=groups(field, cap)), VALID_THEME)
                with self.assertRaisesRegex(GraduationKeepsakeInvalidData, f"at most {cap}"):
                    validate_and_normalize(values(messageGroups=groups(field, cap + 1)), VALID_THEME)

    def test_a_caption_without_a_voice_is_not_kept(self):
        grad = validate_and_normalize(
            values(messageGroups=[{"label": "g", "people": [_person("n", voiceCaption="hello")]}]), VALID_THEME
        )
        self.assertEqual(grad.messages[0].people[0].voice_caption, "")

    def test_not_an_object_is_refused(self):
        with self.assertRaises(GraduationKeepsakeInvalidData):
            validate_and_normalize(["not", "a", "dict"], VALID_THEME)


class AudioAssetIdsTests(SimpleTestCase):
    def test_lists_every_voice_and_nothing_else(self):
        voice_a, voice_b, drawing = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
        project_values = values(
            messageGroups=[
                {"label": "a", "people": [_person("x", voice={"assetId": voice_a}, drawing={"assetId": drawing})]},
                {"label": "b", "people": [_person("y", voice={"assetId": voice_b}), _person("z")]},
            ]
        )
        self.assertEqual(audio_asset_ids(project_values), [voice_a, voice_b])

    def test_none_while_messages_are_off_and_never_raises(self):
        with_voices = values(messageGroups=[{"label": "g", "people": [_person("x", voice={"assetId": str(uuid.uuid4())})]}])
        self.assertEqual(len(audio_asset_ids(with_voices)), 1)
        self.assertEqual(audio_asset_ids({**with_voices, "messagesEnabled": False}), [])
        for junk in (None, [], {"messageGroups": "nope"}, {"messageGroups": [None, {"people": [None, 3]}]}):
            self.assertEqual(audio_asset_ids(junk), [])


class RegistrationTests(SimpleTestCase):
    def test_registered_for_its_pre_payment_check(self):
        renderer = get_renderer(SLUG, "")
        self.assertIsInstance(renderer, GraduationKeepsakeRenderer)
        renderer.validate_project_data(VALID_VALUES, VALID_THEME)
        with self.assertRaises(GraduationKeepsakeInvalidData):
            renderer.validate_project_data(values(gradName=""), VALID_THEME)

    def test_it_never_renders_anything(self):
        with self.assertRaises(RendererNotAvailable):
            GraduationKeepsakeRenderer().render(None, "printable", None, "print-png")

    def test_paid_voice_messages_are_collected_for_this_product(self):
        from apps.commerce import media_promotion

        voice = str(uuid.uuid4())
        project = type("P", (), {"data": {"values": values(messageGroups=[{"label": "g", "people": [_person("n", voice={"assetId": voice})]}])}})()
        self.assertEqual(media_promotion._media_asset_ids(project, SLUG), [voice])


class OrderCreationTests(TestCase):
    def _project(self, customer, product, project_values):
        return Project.objects.create(
            customer=customer, product=product, data={"version": 1, "values": project_values, "themeSelections": VALID_THEME}
        )

    def _setup(self):
        from apps.delivery.tests import make_delivery_pack

        customer = make_customer()
        product = make_product(slug=SLUG)
        make_delivery_pack(product=product, slug="live", included_targets=[LIVE_TARGET_SENTINEL], price_cents=1599)
        return customer, product

    def test_a_malformed_keepsake_is_refused_before_payment(self):
        from apps.commerce.services import create_order

        customer, product = self._setup()
        project = self._project(customer, product, values(achievements=[]))
        with self.assertRaises(GraduationKeepsakeInvalidData):
            create_order(customer, product_slug=SLUG, delivery_pack_slug="live", project_id=project.id)
        self.assertFalse(Order.objects.filter(project=project).exists())

    def test_a_valid_keepsake_can_be_ordered(self):
        from apps.commerce.services import create_order

        customer, product = self._setup()
        project = self._project(customer, product, VALID_VALUES)
        order = create_order(customer, product_slug=SLUG, delivery_pack_slug="live", project_id=project.id)
        self.assertEqual(order.total_cents, 1599)

    def test_a_valid_keepsake_stages_a_freemius_checkout_with_the_real_mapping(self):
        """Through the REAL, unpatched plan table: before plan 72194 was mapped
        this raised `FreemiusPlanNotConfigured`."""
        from django.test import override_settings

        from apps.commerce.services import stage_freemius_checkout

        customer, product = self._setup()
        project = self._project(customer, product, VALID_VALUES)
        with override_settings(FREEMIUS_ENABLED=True):
            staging = stage_freemius_checkout(customer, product_slug=SLUG, delivery_pack_slug="live", project_id=project.id)
        self.assertEqual(staging.expected_total_cents, 1599)
        self.assertEqual(staging.project, project)


class PaidVoiceMessagesTests(TestCase):
    """A paid order's voice messages lose their expiry; an unpaid project's do
    not (they are deleted with the other unpaid media after the window)."""

    def test_paying_promotes_this_keepsakes_voice_messages(self):
        from datetime import timedelta

        from django.utils import timezone

        from apps.commerce.media_promotion import promote_media_assets_for_order

        product = make_product(slug=SLUG)
        customer, order, _ = make_paid_order_with_entitlements(target_ids=[LIVE_TARGET_SENTINEL], product=product)
        soon = timezone.now() + timedelta(days=7)
        voice = make_asset(customer=customer, mime_type="audio/mp4", storage_key=f"assets/{uuid.uuid4().hex}.m4a")
        other = make_asset(customer=customer, mime_type="audio/mp4", storage_key=f"assets/{uuid.uuid4().hex}.m4a")
        type(voice).objects.filter(id__in=[voice.id, other.id]).update(expires_at=soon)
        order.project.data = {
            "version": 1,
            "values": values(messageGroups=[{"label": "g", "people": [_person("n", voice={"assetId": str(voice.id)})]}]),
            "themeSelections": VALID_THEME,
        }
        order.project.save(update_fields=["data"])

        promote_media_assets_for_order(order)

        voice.refresh_from_db()
        other.refresh_from_db()
        self.assertIsNone(voice.expires_at)
        self.assertIsNotNone(other.expires_at, "only the voice messages this keepsake uses are kept")


class GiftCardCaptionTests(TestCase):
    def test_the_caption_is_the_graduates_full_name(self):
        from apps.delivery.bonuses import _qr_caption_for_order

        product = make_product(slug=SLUG)
        _, order, _ = make_paid_order_with_entitlements(target_ids=[LIVE_TARGET_SENTINEL], product=product)
        order.project.data = {"version": 1, "values": VALID_VALUES, "themeSelections": VALID_THEME}
        order.project.save(update_fields=["data"])
        order.refresh_from_db()
        self.assertEqual(_qr_caption_for_order(order), "Maya Chen")

        order.project.data = {"version": 1, "values": values(gradFullName=""), "themeSelections": VALID_THEME}
        order.project.save(update_fields=["data"])
        order.refresh_from_db()
        self.assertIsNone(_qr_caption_for_order(order))


class LivePayloadTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _order(self, project_values_for, *, paid=True, theme=None):
        from apps.delivery.tests import make_delivery_pack
        from apps.products.models import DeliveryPack, Product

        product = Product.objects.filter(slug=SLUG).first() or make_product(slug=SLUG)
        pack = DeliveryPack.objects.filter(product=product, slug="live").first() or make_delivery_pack(
            product=product, slug="live", included_targets=[LIVE_TARGET_SENTINEL], price_cents=1599
        )
        customer, order, _ = make_paid_order_with_entitlements(
            target_ids=[LIVE_TARGET_SENTINEL], product=product, delivery_pack=pack
        )
        order.project.data = {"version": 1, "values": project_values_for(customer), "themeSelections": theme or VALID_THEME}
        order.project.save(update_fields=["data"])
        if not paid:
            order.status = Order.STATUS_PENDING
            order.save(update_fields=["status"])
        order.locale = "fr"
        order.save(update_fields=["locale"])
        return customer, order, PublicExperience.objects.get(entitlement__order=order, kind=PublicExperience.KIND_LIVE)

    @staticmethod
    def _owned_values(customer):
        def asset(kind="image/jpeg"):
            return {"assetId": str(make_asset(customer=customer, mime_type=kind, storage_key=f"assets/{uuid.uuid4().hex}").id)}

        return values(
            gradPhoto=asset(),
            thenPhoto=asset(),
            nextPhoto=asset(),
            stops=[{"year": "2010", "caption": "School", "code": "sch", "photo": asset()}],
            messageGroups=[
                {
                    "label": "From home",
                    "people": [
                        _person("Mum", voice=asset("audio/mp4"), voiceCaption="My clever girl.", drawing=asset()),
                        # Someone else's file, referenced by id: dropped.
                        _person("Stranger", drawing={"assetId": str(make_asset(customer=make_customer(), mime_type="image/jpeg", storage_key="assets/x").id)}),
                    ],
                }
            ],
        )

    def test_the_payload_is_the_experiences_own_shape_with_fresh_urls(self):
        _, _, experience = self._order(self._owned_values, theme=AIRLINE)
        with patch("apps.assets.services.generate_asset_access_url", side_effect=lambda a: f"https://fresh.example/{a.id}"):
            response = self.client.get(f"/api/v1/live/{experience.id}/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response["X-Robots-Tag"], "noindex, nofollow")
        self.assertEqual((response.data["productId"], response.data["locale"]), (SLUG, "fr"))
        payload = response.data["values"]
        self.assertEqual(
            set(payload),
            {"journey", "grad", "path", "achievements", "messages", "goals", "letter", "ending", "flight", "sound", "share"},
        )
        self.assertEqual(payload["journey"], "airline")
        self.assertTrue(payload["grad"]["photo"]["url"].startswith("https://fresh.example/"))
        self.assertEqual(payload["path"]["stops"][0]["code"], "SCH")
        mum, stranger = payload["messages"][0]["people"]
        self.assertTrue(mum["voice"]["url"].startswith("https://fresh.example/"))
        self.assertEqual(mum["voiceCaption"], "My clever girl.")
        self.assertIsNone(stranger["drawing"], "a file the paying customer does not own is never served")
        self.assertEqual(payload["flight"]["fromCode"], "KID")
        for absent in ("scene", "level", "targetUrl", "themeSelections"):
            self.assertNotIn(absent, response.data)

    def test_every_file_is_fetched_in_one_query(self):
        """Up to 25 files: one query for all of them, not one each."""
        from apps.delivery.product_renderers.graduation_keepsake.live_payload import _media_urls

        customer = make_customer()
        ids = [str(make_asset(customer=customer, mime_type="image/jpeg", storage_key=f"k{i}").id) for i in range(25)]
        with self.assertNumQueries(1):
            urls = _media_urls(customer, ids + ["not-a-uuid"])
        self.assertEqual(len(urls), 25)

    def test_switched_off_chapters_are_null(self):
        _, _, experience = self._order(
            lambda c: values(
                gradPhoto=None, achievementsEnabled=False, goalsEnabled=False, letterEnabled=False, messagesEnabled=False
            ) | {"gradPhoto": {"assetId": str(make_asset(customer=c, mime_type="image/jpeg", storage_key="g").id)}}
        )
        payload = self.client.get(f"/api/v1/live/{experience.id}/").data["values"]
        self.assertEqual((payload["achievements"], payload["goals"], payload["letter"], payload["messages"]), (None, None, None, None))

    def test_an_invalid_project_unpaid_order_or_unknown_id_are_the_same_404(self):
        _, _, broken = self._order(lambda c: values(achievements=[]))
        _, _, unpaid = self._order(lambda c: VALID_VALUES, paid=False)
        responses = [
            self.client.get(f"/api/v1/live/{broken.id}/"),
            self.client.get(f"/api/v1/live/{unpaid.id}/"),
            self.client.get(f"/api/v1/live/{uuid.uuid4()}/"),
        ]
        self.assertEqual({r.status_code for r in responses}, {http_status.HTTP_404_NOT_FOUND})
        self.assertEqual(len({str(r.data) for r in responses}), 1)

    def test_this_product_reaches_its_own_builder(self):
        from apps.delivery import live_views

        self.assertIs(live_views._LIVE_PAYLOAD_BUILDERS[SLUG], live_views._build_graduation_live_payload)


class CatalogTests(SimpleTestCase):
    def _entry(self):
        import seed_catalog

        return next(entry for entry in seed_catalog.CATALOG if entry["slug"] == SLUG)

    def test_one_live_pack_at_the_digital_tier(self):
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

    def test_its_one_pack_has_its_freemius_plan(self):
        """Plan 72194, created 15 Oct 2026 (pinned with the others in
        `apps.commerce.tests.FreemiusPlanMappingTests`)."""
        from apps.commerce.freemius_integration import plan_for_pack

        self.assertEqual(plan_for_pack(SLUG, "live"), {"plan_id": "72194"})
