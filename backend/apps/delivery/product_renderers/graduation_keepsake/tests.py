"""Graduation Keepsake: data contract, live payload, media promotion, catalog.

The product is LIVE-ONLY, so there is no renderer output to inspect; what has
to be right is (a) what the validator accepts and rejects, (b) that the live
payload carries fresh, ownership-checked URLs and nothing stored, (c) that a
PAID order keeps its voice messages (the media-promotion regression), and
(d) that the catalog and the two target maps agree.
"""

from __future__ import annotations

import copy
import uuid

from django.test import SimpleTestCase, TestCase
from django.test.utils import CaptureQueriesContext
from django.db import connection
from rest_framework import status as http_status
from rest_framework.test import APIClient

from apps.assets.models import Asset
from apps.common.exceptions.api_errors import GraduationKeepsakeInvalidData, GraduationKeepsakeRenderFailed
from apps.delivery.delivery_types import LIVE_TARGET_SENTINEL
from apps.delivery.models import PublicExperience
from apps.delivery.registry import get_renderer
from apps.delivery.tests import make_asset, make_customer, make_paid_order_with_entitlements, make_product

from .data import (
    CHAPTERS,
    DEFAULT_PERSON_COLOR,
    audio_asset_ids,
    media_asset_ids,
    validate_and_normalize,
)
from .renderer import GraduationKeepsakeRenderer

SLUG = "graduation-keepsake"


def _id() -> str:
    return str(uuid.uuid4())


def valid_values(**overrides) -> dict:
    """A complete, valid project with every chapter on. Each call mints fresh
    asset ids, so tests can mutate their own copy freely."""
    values = {
        "language": "en",
        "showPath": True,
        "showAchievements": True,
        "showMessages": True,
        "showGoals": True,
        "showLetter": True,
        "gradName": "Maya",
        "gradFullName": "Maya Chen",
        "gradDegree": "BA (Hons) Architecture",
        "gradSchool": "University of Edinburgh",
        "gradDate": "2027-07-02",
        "gradPhoto": {"assetId": _id(), "url": "blob:http://x/1", "mimeType": "image/jpeg", "filename": "a.jpg"},
        "thenYear": "2005",
        "thenText": "A five-year-old who drew houses on every wall.",
        "thenPhoto": {"assetId": _id()},
        "stops": [
            {"year": "2010", "caption": "First day of school", "photo": {"assetId": _id()}, "code": "sch"},
            {"year": "2014", "caption": "The Lego city phase", "photo": {"assetId": _id()}},
        ],
        "nowYear": "2027",
        "nowText": "An architect, with a first-class degree to prove it.",
        "nextText": "A junior designer role in Copenhagen.",
        "nextPhoto": {"assetId": _id()},
        "achievements": [
            {"title": "First-class honours", "detail": "Top of the year", "place": "EDINBURGH"},
            {"title": "Dean's list"},
        ],
        "messageGroups": [
            {
                "label": "From home",
                "people": [
                    {
                        "name": "Mum",
                        "color": "coral",
                        "emoji": "home",
                        "message": "So proud of you.\nSecond line.",
                        "voice": {"assetId": _id()},
                        "drawing": {"assetId": _id()},
                    },
                    {"name": "Dad", "color": "blue", "emoji": "coffee", "message": "Well done, kiddo."},
                ],
            }
        ],
        "goals": [{"text": "Start at the studio in Copenhagen", "code": "cph"}, {"text": "Build Kai a treehouse"}],
        "letterGreeting": "Dear Maya,",
        "letterBody": [{"text": "Today you wear a cap and gown."}, {"text": "Go and build it."}],
        "letterSignoff": "With all our love,",
        "letterSignatures": [{"name": "Mum"}, {"name": "Dad"}],
        "endingLine": "Congratulations, Maya!",
        "endingSub": "Your next chapter starts now.",
        "soundEnabled": True,
        "shareEnabled": True,
        "brandingShow": True,
        "flightAirline": "Next Chapter Airways",
        "flightNumber": "NC 2027",
        "flightSeat": "1A",
        "flightCabin": "First Class Honours",
        "flightFromCode": "kid",
        "flightFromPlace": "Childhood",
        "flightToCode": "NXT",
        "flightToPlace": "What's next",
    }
    values.update(overrides)
    return values


THEME = {"journey": "airline"}


class DataValidationTests(SimpleTestCase):
    def test_a_complete_project_validates_and_derives_the_year(self):
        result = validate_and_normalize(valid_values(), THEME)
        self.assertEqual(result.year, 2027)
        self.assertEqual(result.journey, "airline")
        self.assertEqual(result.values["gradFullName"], "Maya Chen")

    def test_media_is_reduced_to_its_asset_id(self):
        # `url` is a presigned/blob leftover and must never survive.
        result = validate_and_normalize(valid_values(), THEME)
        self.assertEqual(set(result.values["gradPhoto"]), {"assetId"})

    def test_codes_are_uppercased_and_three_letters_only(self):
        result = validate_and_normalize(valid_values(), THEME)
        self.assertEqual(result.values["stops"][0]["code"], "SCH")
        self.assertEqual(result.values["flightFromCode"], "KID")
        with self.assertRaises(GraduationKeepsakeInvalidData):
            validate_and_normalize(valid_values(flightToCode="NEXT"), THEME)

    def test_the_graduate_block_is_always_required(self):
        for key in ("gradName", "gradFullName", "gradDegree", "gradSchool", "gradDate", "gradPhoto", "endingLine"):
            with self.subTest(key=key):
                with self.assertRaises(GraduationKeepsakeInvalidData):
                    validate_and_normalize(valid_values(**{key: None}), THEME)

    def test_a_non_uuid_or_missing_asset_id_is_rejected(self):
        for bad in ({"assetId": "asset-1"}, {"assetId": ""}, {"url": "blob:x"}, "photo.jpg", None):
            with self.subTest(bad=bad):
                with self.assertRaises(GraduationKeepsakeInvalidData):
                    validate_and_normalize(valid_values(gradPhoto=bad), THEME)

    def test_a_bad_date_is_rejected(self):
        for bad in ("2027-13-40", "not a date", "1800-01-01", ""):
            with self.subTest(bad=bad):
                with self.assertRaises(GraduationKeepsakeInvalidData):
                    validate_and_normalize(valid_values(gradDate=bad), THEME)

    def test_limits_on_every_repeatable_group(self):
        v = valid_values()
        cases = {
            "stops: none": {"stops": []},
            "stops: 13": {"stops": [copy.deepcopy(v["stops"][0]) for _ in range(13)]},
            "achievements: none": {"achievements": []},
            "achievements: 11": {"achievements": [{"title": f"t{i}"} for i in range(11)]},
            "messageGroups: none": {"messageGroups": []},
            "messageGroups: 4": {"messageGroups": [copy.deepcopy(v["messageGroups"][0]) for _ in range(4)]},
            "goals: none": {"goals": []},
            "goals: 11": {"goals": [{"text": f"g{i}"} for i in range(11)]},
            "letterBody: none": {"letterBody": []},
            "letterBody: 7": {"letterBody": [{"text": "p"} for _ in range(7)]},
            "signatures: none": {"letterSignatures": []},
            "signatures: 13": {"letterSignatures": [{"name": f"n{i}"} for i in range(13)]},
        }
        for name, override in cases.items():
            with self.subTest(name):
                with self.assertRaises(GraduationKeepsakeInvalidData):
                    validate_and_normalize(valid_values(**override), THEME)

    def test_people_per_group_limit(self):
        person = {"name": "P", "message": "hi"}
        group = {"label": "From home", "people": [dict(person) for _ in range(13)]}
        with self.assertRaises(GraduationKeepsakeInvalidData):
            validate_and_normalize(valid_values(messageGroups=[group]), THEME)
        group["people"] = []
        with self.assertRaises(GraduationKeepsakeInvalidData):
            validate_and_normalize(valid_values(messageGroups=[group]), THEME)

    def test_text_length_ceilings(self):
        v = valid_values()
        v["achievements"] = [{"title": "x" * 27}]
        with self.assertRaises(GraduationKeepsakeInvalidData):
            validate_and_normalize(v, THEME)
        v = valid_values()
        v["messageGroups"][0]["people"][0]["message"] = "x" * 301
        with self.assertRaises(GraduationKeepsakeInvalidData):
            validate_and_normalize(v, THEME)
        # ...and the boundary itself is fine.
        v["messageGroups"][0]["people"][0]["message"] = "x" * 300
        validate_and_normalize(v, THEME)

    def test_a_switched_off_chapter_is_neither_validated_nor_kept(self):
        # Broken data inside an OFF chapter must not block the purchase, and
        # must not reach the payload.
        v = valid_values(showMessages=False, messageGroups=[{"label": "", "people": []}], showPath=False, stops=[])
        result = validate_and_normalize(v, THEME).values
        self.assertFalse(result["showMessages"])
        self.assertNotIn("messageGroups", result)
        self.assertNotIn("stops", result)
        self.assertNotIn("thenPhoto", result)
        self.assertIn("achievements", result)

    def test_every_chapter_can_be_off_at_once(self):
        v = valid_values(**{flag: False for _, flag in CHAPTERS})
        result = validate_and_normalize(v, THEME).values
        for key in ("stops", "achievements", "messageGroups", "goals", "letterBody"):
            self.assertNotIn(key, result)

    def test_person_colour_and_emoji_come_from_an_allowlist(self):
        # The colour reaches a style attribute on the live page: a free-text
        # value there is a CSS injection surface.
        for field, bad in (("color", "red;background:url(//evil)"), ("color", "#ff0000"), ("emoji", "<script>"), ("emoji", "🏡")):
            with self.subTest(field=field, bad=bad):
                v = valid_values()
                v["messageGroups"][0]["people"][0][field] = bad
                with self.assertRaises(GraduationKeepsakeInvalidData):
                    validate_and_normalize(v, THEME)

    def test_a_missing_colour_or_emoji_falls_back_to_a_default(self):
        v = valid_values()
        del v["messageGroups"][0]["people"][1]["color"]
        result = validate_and_normalize(v, THEME).values
        self.assertEqual(result["messageGroups"][0]["people"][1]["color"], DEFAULT_PERSON_COLOR)

    def test_control_and_bidi_override_characters_are_stripped(self):
        v = valid_values(gradName="Ma‮y\x00a")
        self.assertEqual(validate_and_normalize(v, THEME).values["gradName"], "Maya")

    def test_newlines_survive_in_messages_only(self):
        result = validate_and_normalize(valid_values(), THEME).values
        self.assertEqual(result["messageGroups"][0]["people"][0]["message"], "So proud of you.\nSecond line.")
        self.assertNotIn("\n", validate_and_normalize(valid_values(gradName="Ma\nya"), THEME).values["gradName"])

    def test_unknown_journey_and_language_are_rejected_but_missing_ones_default(self):
        with self.assertRaises(GraduationKeepsakeInvalidData):
            validate_and_normalize(valid_values(), {"journey": "spaceship"})
        self.assertEqual(validate_and_normalize(valid_values(), {}).journey, "airline")
        with self.assertRaises(GraduationKeepsakeInvalidData):
            validate_and_normalize(valid_values(language="de"), THEME)
        self.assertEqual(validate_and_normalize(valid_values(language=None), THEME).language, "en")

    def test_boarding_pass_fields_exist_only_for_the_airline_journey(self):
        self.assertIn("flightNumber", validate_and_normalize(valid_values(), THEME).values)

    def test_a_non_dict_payload_is_rejected(self):
        for bad in (None, [], "x", 3):
            with self.assertRaises(GraduationKeepsakeInvalidData):
                validate_and_normalize(bad, THEME)


class MediaIdCollectionTests(SimpleTestCase):
    def test_collects_every_photo_drawing_and_voice(self):
        v = valid_values()
        # gradPhoto, thenPhoto, nextPhoto, 2 stops, voice, drawing
        self.assertEqual(len(media_asset_ids(v)), 7)
        self.assertEqual(audio_asset_ids(v), [v["messageGroups"][0]["people"][0]["voice"]["assetId"]])

    def test_a_chapter_that_is_off_contributes_nothing(self):
        v = valid_values(showMessages=False, showPath=False)
        self.assertEqual(audio_asset_ids(v), [])
        self.assertEqual(media_asset_ids(v), [v["gradPhoto"]["assetId"]])

    def test_a_malformed_project_does_not_raise(self):
        for bad in (None, [], {"messageGroups": "x"}, {"messageGroups": [None, {"people": [1, None]}]}, {"stops": [3]}):
            self.assertIsInstance(media_asset_ids(bad), list)
            self.assertIsInstance(audio_asset_ids(bad), list)


class RendererTests(SimpleTestCase):
    def test_it_is_registered_for_the_product_slug(self):
        self.assertIsInstance(get_renderer(SLUG, "digital"), GraduationKeepsakeRenderer)

    def test_render_refuses_every_target_loudly(self):
        with self.assertRaises(GraduationKeepsakeRenderFailed):
            GraduationKeepsakeRenderer().render(None, "printable", None, "print-a4-frameless")

    def test_validate_project_data_is_the_pre_payment_gate(self):
        renderer = GraduationKeepsakeRenderer()
        renderer.validate_project_data(valid_values(), THEME)
        with self.assertRaises(GraduationKeepsakeInvalidData):
            renderer.validate_project_data(valid_values(gradPhoto=None), THEME)


def _paid_graduation_order(values, *, customer=None, theme=None):
    customer = customer or make_customer()
    _, order, entitlements = make_paid_order_with_entitlements(
        target_ids=[LIVE_TARGET_SENTINEL],
        product=make_product(slug=SLUG),
        customer=customer,
    )
    order.project.data = {"version": 1, "values": values, "themeSelections": theme or THEME}
    order.project.save(update_fields=["data"])
    experience = PublicExperience.objects.get(entitlement__order=order, kind=PublicExperience.KIND_LIVE)
    return customer, order, experience


def _owned_values(customer):
    """valid_values() whose assets really exist and belong to `customer`."""
    values = valid_values()

    def real(mime="image/jpeg"):
        return {"assetId": str(make_asset(customer=customer, mime_type=mime, storage_key=f"assets/{uuid.uuid4().hex}").id)}

    values["gradPhoto"] = real()
    values["thenPhoto"] = real()
    values["nextPhoto"] = real()
    for stop in values["stops"]:
        stop["photo"] = real()
    person = values["messageGroups"][0]["people"][0]
    person["voice"] = real("audio/mp4")
    person["drawing"] = real()
    return values


class LivePayloadTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_every_media_value_becomes_a_fresh_url_and_nothing_stored_survives(self):
        customer = make_customer()
        values = _owned_values(customer)
        _, _, experience = _paid_graduation_order(values, customer=customer)

        response = self.client.get(f"/api/v1/live/{experience.id}/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response.data["productId"], SLUG)
        self.assertEqual(response.data["themeSelections"], {"journey": "airline"})
        photo = response.data["values"]["gradPhoto"]
        self.assertEqual(set(photo), {"url"})
        stored = Asset.objects.get(id=values["gradPhoto"]["assetId"])
        self.assertIn(stored.storage_key, photo["url"])
        voice = response.data["values"]["messageGroups"][0]["people"][0]["voice"]
        self.assertIn(Asset.objects.get(id=values["messageGroups"][0]["people"][0]["voice"]["assetId"]).storage_key, voice["url"])
        self.assertNotIn("blob:", str(response.data))
        self.assertNotIn("assetId", str(response.data))

    def test_a_foreign_asset_resolves_to_null_and_does_not_leak(self):
        customer, stranger = make_customer(), make_customer()
        values = _owned_values(customer)
        foreign = make_asset(customer=stranger, storage_key="assets/secret-of-someone-else")
        values["messageGroups"][0]["people"][0]["drawing"] = {"assetId": str(foreign.id)}
        _, _, experience = _paid_graduation_order(values, customer=customer)

        response = self.client.get(f"/api/v1/live/{experience.id}/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertIsNone(response.data["values"]["messageGroups"][0]["people"][0]["drawing"])
        self.assertNotIn("secret-of-someone-else", str(response.data))

    def test_a_deleted_asset_resolves_to_null(self):
        customer = make_customer()
        values = _owned_values(customer)
        Asset.objects.filter(id=values["thenPhoto"]["assetId"]).update(status=Asset.STATUS_DELETED)
        _, _, experience = _paid_graduation_order(values, customer=customer)

        response = self.client.get(f"/api/v1/live/{experience.id}/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertIsNone(response.data["values"]["thenPhoto"])

    def test_assets_are_resolved_in_one_query_however_many_there_are(self):
        customer = make_customer()
        values = _owned_values(customer)
        for i in range(10):
            values["stops"].append({"year": str(2000 + i), "caption": f"c{i}", "photo": {"assetId": str(make_asset(customer=customer).id)}})
        _, _, experience = _paid_graduation_order(values, customer=customer)

        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(f"/api/v1/live/{experience.id}/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        asset_queries = [q for q in queries if "assets" in q["sql"] and "SELECT" in q["sql"]]
        self.assertEqual(len(asset_queries), 1, [q["sql"] for q in asset_queries])

    def test_a_chapter_that_is_off_is_absent_from_the_payload(self):
        customer = make_customer()
        values = _owned_values(customer)
        values["showMessages"] = False
        _, _, experience = _paid_graduation_order(values, customer=customer)

        response = self.client.get(f"/api/v1/live/{experience.id}/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertNotIn("messageGroups", response.data["values"])

    def test_an_invalid_project_is_a_404_not_a_500(self):
        customer = make_customer()
        values = _owned_values(customer)
        values["gradName"] = ""
        _, _, experience = _paid_graduation_order(values, customer=customer)

        response = self.client.get(f"/api/v1/live/{experience.id}/")

        self.assertEqual(response.status_code, http_status.HTTP_404_NOT_FOUND)
        self.assertEqual(response["X-Robots-Tag"], "noindex, nofollow")

    def test_a_product_with_no_payload_builder_fails_loudly(self):
        # Used to fall through to Love Story Timeline's builder and 404 with
        # nothing to say why. It is still a 404 to the visitor (one generic
        # answer, §21f) but the log now names the product.
        _, order, _ = make_paid_order_with_entitlements(
            target_ids=[LIVE_TARGET_SENTINEL], product=make_product(slug="some-future-product")
        )
        experience = PublicExperience.objects.get(entitlement__order=order, kind=PublicExperience.KIND_LIVE)

        with self.assertLogs("apps.delivery.live_views", level="ERROR") as logs:
            response = self.client.get(f"/api/v1/live/{experience.id}/")

        self.assertEqual(response.status_code, http_status.HTTP_404_NOT_FOUND)
        self.assertIn("live_experience_product_has_no_payload_builder", "".join(logs.output))


class MediaPromotionRegressionTests(TestCase):
    """THE BUG THIS PREVENTS: `media_promotion` used to read only Love Story
    Timeline's `events[].video/audio`, so a paid Graduation Keepsake kept its
    voice messages for `MEDIA_PROVISIONAL_RETENTION` and then
    `expire_provisional_assets` deleted them."""

    def _promote(self, values):
        from apps.commerce.media_promotion import promote_media_assets_for_order

        customer = make_customer()
        values = values(customer)
        _, order, _ = _paid_graduation_order(values, customer=customer)
        voice_id = values["messageGroups"][0]["people"][0]["voice"]["assetId"]
        from django.utils import timezone

        Asset.objects.filter(id=voice_id).update(expires_at=timezone.now())
        promote_media_assets_for_order(order)
        return Asset.objects.get(id=voice_id)

    def test_a_paid_order_keeps_its_voice_messages(self):
        voice = self._promote(_owned_values)
        self.assertIsNone(voice.expires_at)

    def test_an_off_messages_chapter_is_left_to_expire(self):
        def values(customer):
            v = _owned_values(customer)
            v["showMessages"] = False
            return v

        voice = self._promote(values)
        self.assertIsNotNone(voice.expires_at)

    def test_love_story_timeline_collection_is_unchanged(self):
        from unittest.mock import MagicMock

        from apps.commerce.media_promotion import _media_asset_ids

        project = MagicMock()
        project.data = {"values": {"events": [{"audio": {"assetId": "a-1"}}]}}
        self.assertEqual(_media_asset_ids(project, "love-story-timeline"), ["a-1"])
        self.assertEqual(_media_asset_ids(project), ["a-1"])


class BonusTitleTests(TestCase):
    def test_the_gift_card_carries_the_graduates_name(self):
        from apps.delivery.bonuses import _qr_caption_for_order

        customer = make_customer()
        _, order, _ = _paid_graduation_order(_owned_values(customer), customer=customer)
        self.assertEqual(_qr_caption_for_order(order), "Maya Chen")

    def test_an_invalid_project_falls_back_to_the_generic_caption(self):
        from apps.delivery.bonuses import _qr_caption_for_order

        _, order, _ = _paid_graduation_order({"gradName": ""})
        self.assertIsNone(_qr_caption_for_order(order))


class CatalogTests(SimpleTestCase):
    def _entry(self):
        from seed_catalog import CATALOG

        return next(entry for entry in CATALOG if entry["slug"] == SLUG)

    def test_exact_catalog_entry(self):
        entry = self._entry()
        self.assertEqual(entry["name_i18n_key"], "graduationKeepsake")
        self.assertEqual(entry["category"], "other")
        # coming_soon until a Freemius plan exists - see the seed comment.
        self.assertEqual(entry["status"], "coming_soon")
        self.assertEqual(entry["starting_price_cents"], 1599)
        self.assertEqual(entry["packs"], [("live", 1599, ["__live__"], "active")])

    def test_the_seed_validator_accepts_it(self):
        from seed_catalog import validate

        self.assertEqual(validate(self._entry()), [])

    def test_seed_and_admin_target_maps_agree(self):
        from apps.products.admin import _supported_targets
        from seed_catalog import supported_targets

        self.assertEqual(supported_targets(SLUG), {LIVE_TARGET_SENTINEL})
        self.assertEqual(_supported_targets(SLUG), {LIVE_TARGET_SENTINEL})

    def test_a_print_target_is_refused_until_a_print_renderer_exists(self):
        from seed_catalog import validate

        entry = copy.deepcopy(self._entry())
        entry["packs"].append(("printable", 2299, ["print-a4-frameless"], "active"))
        self.assertTrue(any("renderer cannot produce" in problem for problem in validate(entry)))

    def test_song_poster_is_now_known_to_the_admin_map(self):
        from apps.products.admin import _supported_targets

        self.assertIsNotNone(_supported_targets("song-poster"))
        self.assertIn(LIVE_TARGET_SENTINEL, _supported_targets("song-poster"))


class AudioUploadAcceptanceTests(SimpleTestCase):
    def test_voice_messages_people_actually_have_are_accepted(self):
        # WhatsApp (.opus/.ogg), iPhone (.m4a), .mp3 - all re-encoded to
        # AAC/MP4 on upload, so playback never depends on the original.
        from django.conf import settings

        from apps.assets.media import AUDIO_MIME_TYPES, is_media

        for mime in ("audio/ogg", "audio/opus", "audio/x-m4a", "audio/mp3", "audio/mpeg", "audio/mp4"):
            with self.subTest(mime=mime):
                self.assertIn(mime, settings.ALLOWED_ASSET_MIME_TYPES)
                self.assertIn(mime, AUDIO_MIME_TYPES)
                self.assertTrue(is_media(mime))

    def test_audio_may_run_a_minute_but_video_stays_at_thirty_seconds(self):
        from apps.assets.media import MAX_AUDIO_SECONDS, MAX_MEDIA_SECONDS

        self.assertEqual(MAX_AUDIO_SECONDS, 60)
        self.assertEqual(MAX_MEDIA_SECONDS, 30)
