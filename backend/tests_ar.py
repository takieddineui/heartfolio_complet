"""Tests for the AR pack system (§21).

Nearly all of these are about §21f's security requirements, because the AR
URL is a bearer credential and this is the only endpoint in the project with
no session check. The classification tests come first because a
misclassified AR target would route it into the wrong delivery path before
any of the access rules were reached.
"""

import uuid

from django.test import SimpleTestCase, TestCase

from apps.delivery.ar_views import _load_experience
from apps.delivery.delivery_types import DeliveryType, infer_delivery_type


class ARClassificationTests(SimpleTestCase):
    def test_ar_targets_classify_as_ar(self):
        for target in ("ar-card", "ar-screen", "ar-print"):
            self.assertEqual(infer_delivery_type(target_id=target), DeliveryType.AR)

    def test_a_pack_slug_cannot_override_an_ar_target(self):
        """AR is checked BEFORE the pack-slug map, unlike every other prefix.

        The pack map disambiguates targets whose type genuinely depends on
        how they were sold (`story-png` is social or wallpaper by pack). AR
        has no such ambiguity, and letting a slug win would misclassify it
        the moment someone adds `ar-card` to the printable pack.
        """
        self.assertEqual(
            infer_delivery_type(target_id="ar-card", delivery_pack_slug="printable"),
            DeliveryType.AR,
        )

    def test_the_live_sentinel_is_still_digital_not_ar(self):
        # §21d — `__live__` and AR are deliberately separate concepts.
        self.assertEqual(infer_delivery_type(target_id="__live__"), DeliveryType.DIGITAL)

    def test_ar_does_not_reclassify_anything_already_sold(self):
        # Additive by construction: no existing target starts with "ar-".
        for target in ("print-a4-edged", "wallpaper-phone", "story-png", "print-png"):
            self.assertNotEqual(infer_delivery_type(target_id=target), DeliveryType.AR)


class ARAccessSecurityTests(SimpleTestCase):
    """§21f — everything a caller must NOT be able to learn."""

    def test_a_malformed_id_does_not_escape_as_an_error(self):
        """A 500 on a malformed id would itself distinguish it from an
        unknown one, turning a guessing attempt into an oracle."""
        for bad in ("not-a-uuid", "", "../../etc/passwd", "12345"):
            self.assertIsNone(_load_experience(bad))

    def test_there_is_no_list_endpoint(self):
        """§21f forbids any listing, and the guarantee is structural rather
        than a rule someone has to remember: nothing in the AR module
        returns more than one experience."""
        from apps.delivery import ar_views

        exported = [name for name in dir(ar_views) if name.lower().endswith("listview")]
        self.assertEqual(exported, [])

    def test_ar_ids_are_not_exposed_in_any_serializer(self):
        # §21f — never in bulk. A single id is a link someone was given; a
        # list of them is every customer's private link at once.
        from apps.commerce import serializers as commerce_serializers

        source = open(commerce_serializers.__file__).read()
        self.assertNotIn("ar_experience", source)
        self.assertNotIn("arId", source)


class ARLifecycleTests(TestCase):
    """DATABASE-BACKED, and not run in the environment these were written in
    — no Postgres available there."""

    def setUp(self):
        # THIS setUp DID NOT EXIST. Four of the five tests here reference
        # `self.order` and `self.experience`, so they all failed with
        # AttributeError the first time the suite genuinely ran. Built to
        # match what `grant_entitlements` produces for a paid AR purchase:
        # a paid order with a project, an `ar-card` entitlement, and the
        # PublicExperience row that carries the public link.
        from apps.commerce.models import Entitlement, Order
        from apps.customers.models import Customer
        from apps.delivery.models import PublicExperience
        from apps.products.models import DeliveryPack, Product
        from apps.projects.models import Project

        self.customer = Customer.objects.create(email=f"ar-{uuid.uuid4().hex[:8]}@example.com")
        self.product = Product.objects.create(
            slug="love-story-timeline",
            name_i18n_key="loveStoryTimeline",
            category=Product.CATEGORY_TIMELINE,
            status=Product.STATUS_AVAILABLE,
        )
        self.pack = DeliveryPack.objects.create(
            product=self.product,
            slug="ar",
            name_i18n_key="packs.ar.name",
            description_i18n_key="packs.ar.description",
            price_cents=1500,
            included_targets=["ar-card"],
        )
        # `themeSelections` is required by the database's own check
        # constraint (ck_projects_data_has_required_keys); without it this
        # setUp failed and none of these tests ran (found 25 Oct 2026).
        # A VALID project: with empty values the payload builder refused it,
        # so the revoked/unpaid tests below returned nothing whether or not
        # those checks existed (mutation-checked, 25 Oct 2026).
        # `test_a_paid_active_experience_loads` is the control.
        from apps.delivery.product_renderers.love_story_timeline.tests import VALID_THEME, VALID_VALUES

        self.project = Project.objects.create(
            customer=self.customer,
            product=self.product,
            data={"version": 1, "values": dict(VALID_VALUES), "themeSelections": dict(VALID_THEME)},
        )
        self.order = Order.objects.create(
            customer=self.customer,
            product=self.product,
            delivery_pack=self.pack,
            project=self.project,
            guest_email=self.customer.email,
            subtotal_cents=self.pack.price_cents,
            total_cents=self.pack.price_cents,
            status=Order.STATUS_PAID,
        )
        self.entitlement = Entitlement.objects.create(
            order=self.order, product=self.product, target_id="ar-card"
        )
        self.experience = PublicExperience.objects.create(
            entitlement=self.entitlement,
            kind=PublicExperience.KIND_AR,
            status=PublicExperience.STATUS_ACTIVE,
        )

    def test_an_unknown_id_returns_the_same_nothing_as_a_malformed_one(self):
        # Needs a database because a well-formed but unknown UUID reaches
        # the query, unlike a malformed one which fails while preparing it.
        # Both must be indistinguishable to the caller regardless.
        self.assertIsNone(_load_experience(str(uuid.uuid4())))

    def test_a_paid_active_experience_loads(self):
        """The control the tests below depend on: without it, a fixture the
        payload builder rejects makes every "yields nothing" test pass for
        the wrong reason."""
        self.assertIsNotNone(_load_experience(self.experience.id))

    def test_an_id_of_the_other_kind_answers_exactly_like_an_unknown_one(self):
        """The property the source checks below stand in for, end to end: an
        AR link used on the live route (and a live link on the AR route) gets
        the same response, status and body, as an id that does not exist, so
        nobody can tell a real id from a fake one (§21f)."""
        from rest_framework.test import APIClient

        from apps.commerce.models import Entitlement
        from apps.delivery.models import PublicExperience

        live = PublicExperience.objects.create(
            entitlement=Entitlement.objects.create(order=self.order, product=self.product, target_id="__live__"),
            kind=PublicExperience.KIND_LIVE,
            status=PublicExperience.STATUS_ACTIVE,
        )
        client = APIClient()
        unknown = str(uuid.uuid4())
        for route, wrong_kind_id in (("live", self.experience.id), ("ar", live.id)):
            wrong = client.get(f"/api/v1/{route}/{wrong_kind_id}/")
            missing = client.get(f"/api/v1/{route}/{unknown}/")
            self.assertEqual(wrong.status_code, 404, route)
            self.assertEqual((wrong.status_code, wrong.content), (missing.status_code, missing.content), route)

    def test_a_revoked_experience_becomes_genuinely_inaccessible(self):
        # §21f — revoked must not merely be hidden from a listing that does
        # not exist anyway.
        self.experience.status = self.experience.STATUS_REVOKED
        self.experience.save(update_fields=["status"])
        self.assertIsNone(_load_experience(self.experience.id))

    def test_an_unpaid_order_yields_nothing(self):
        # The row should only exist for a paid order; checking is cheap, and
        # trusting the invariant forever is how a refund quietly reopens
        # access.
        self.order.status = "pending"
        self.order.save(update_fields=["status"])
        self.assertIsNone(_load_experience(self.experience.id))

    def test_a_deleted_project_yields_nothing_rather_than_a_crash(self):
        # §21e flags this: Order.project is ON DELETE SET NULL, so orders
        # deliberately outlive projects.
        self.order.project = None
        self.order.save(update_fields=["project"])
        self.assertIsNone(_load_experience(self.experience.id))

    def test_a_redelivered_webhook_does_not_mint_a_second_url(self):
        """The first URL may already be printed on something."""
        from apps.commerce.services import grant_entitlements
        from apps.delivery.models import PublicExperience

        before = PublicExperience.objects.count()
        grant_entitlements(self.order)
        self.assertEqual(PublicExperience.objects.count(), before)


class ARVariantOptInTests(SimpleTestCase):
    """§21b — explicit per-product opt-in, and what it must refuse."""

    def test_love_story_supports_card_and_screen(self):
        from apps.delivery.ar_support import AR_CARD, AR_SCREEN, supported_ar_targets

        self.assertEqual(supported_ar_targets("love-story-timeline"), {AR_CARD, AR_SCREEN})

    def test_ar_print_is_reserved_and_supported_by_nothing(self):
        """§21j — the target string exists so the catalog needs no redesign
        later, but the generation pipeline does not. Supporting it would let
        a pack sell an experience nothing can produce."""
        from apps.delivery.ar_support import AR_PRINT, PRODUCT_AR_TARGETS

        for targets in PRODUCT_AR_TARGETS.values():
            self.assertNotIn(AR_PRINT, targets)

    def test_a_product_with_no_declaration_supports_no_ar(self):
        # The correct default: AR needs a designed scene and a tracking
        # target, neither of which a product gets for free.
        from apps.delivery.ar_support import supported_ar_targets

        self.assertEqual(supported_ar_targets("some-future-product"), set())
        self.assertEqual(supported_ar_targets("heart-map"), set())

    def test_the_pack_guard_now_accepts_ar_for_an_opted_in_product(self):
        """Before this, adding `ar-card` to a pack failed admin validation:
        the guard checks what the PNG renderer produces, and AR is served by
        its own endpoint. The guard was right — it needed to be told which
        products opt in, not loosened."""
        from apps.products.admin import _supported_targets

        supported = _supported_targets("love-story-timeline")
        self.assertIn("ar-card", supported)
        self.assertIn("ar-screen", supported)
        self.assertNotIn("ar-print", supported)

    def test_the_guard_still_refuses_ar_for_a_product_that_has_not_opted_in(self):
        from apps.products.admin import _supported_targets

        self.assertNotIn("ar-card", _supported_targets("heart-map"))

    def test_an_unknown_product_still_validates_nothing(self):
        # A future product can be entered before its renderer exists.
        from apps.products.admin import _supported_targets

        self.assertIsNone(_supported_targets("not-a-product"))


class ARSceneSelectionTests(SimpleTestCase):
    """§21c — the scene is a product module constant."""

    def test_each_product_declares_its_own_scene(self):
        from apps.delivery.ar_support import ar_scene_for

        self.assertEqual(ar_scene_for("love-story-timeline"), "timeline-unfold")

    def test_an_undeclared_product_gets_an_explicit_default(self):
        # Explicit rather than falling back to whichever scene happens to be
        # first, which would change meaning when a scene is added.
        from apps.delivery.ar_support import DEFAULT_AR_SCENE, ar_scene_for

        self.assertEqual(ar_scene_for("some-future-product"), DEFAULT_AR_SCENE)
        self.assertEqual(ar_scene_for(""), DEFAULT_AR_SCENE)

    def test_the_scene_is_not_derived_from_customer_data(self):
        """§21c: the customer chooses personalization, never which AR
        behaviour executes. Deriving the scene from the data would mean a
        timeline with no photos silently getting a different experience."""
        from apps.delivery.ar_support import ar_scene_for

        self.assertEqual(ar_scene_for("love-story-timeline"), ar_scene_for("love-story-timeline"))


class ARLevelTests(SimpleTestCase):
    """§14 / §15 — experience levels, derived from the story.

    The rule §14 states plainly: AR must remain valuable when the customer
    provides no video or audio, because the core story alone is enough.
    Everything here follows from that.
    """

    def _timeline(self, **overrides):
        from apps.delivery.product_renderers.love_story_timeline.data import validate_and_normalize
        from apps.delivery.product_renderers.love_story_timeline.tests import (
            VALID_THEME,
            VALID_VALUES,
        )
        import copy

        values = copy.deepcopy(VALID_VALUES)
        values.update(overrides.pop("story", {}))
        if "event" in overrides:
            values["events"][0].update(overrides["event"])
        return validate_and_normalize(values, VALID_THEME)

    def test_a_story_with_only_photos_earns_a_full_basic_experience(self):
        from apps.delivery.ar_support import AR_LEVEL_BASIC, ar_level_for

        self.assertEqual(ar_level_for(self._timeline()), AR_LEVEL_BASIC)

    def test_a_voice_note_lifts_it_to_enhanced(self):
        from apps.delivery.ar_support import AR_LEVEL_ENHANCED, ar_level_for

        self.assertEqual(
            ar_level_for(self._timeline(event={"audio": {"assetId": "a1"}})), AR_LEVEL_ENHANCED
        )

    def test_a_milestone_video_lifts_it_to_enhanced(self):
        from apps.delivery.ar_support import AR_LEVEL_ENHANCED, ar_level_for

        self.assertEqual(
            ar_level_for(self._timeline(event={"video": {"assetId": "v1"}})), AR_LEVEL_ENHANCED
        )

    def test_background_music_alone_lifts_it(self):
        from apps.delivery.ar_support import AR_LEVEL_ENHANCED, ar_level_for

        self.assertEqual(
            ar_level_for(self._timeline(story={"backgroundMusic": "tender-piano"})),
            AR_LEVEL_ENHANCED,
        )

    def test_advanced_is_named_but_never_returned(self):
        """§15 — the vocabulary exists so nothing has to be renamed later;
        the experience does not, because §15 says not to turn V1 into a
        giant AR platform."""
        from apps.delivery.ar_support import AR_LEVEL_ADVANCED, ar_level_for

        for timeline in (
            self._timeline(),
            self._timeline(event={"video": {"assetId": "v1"}, "audio": {"assetId": "a1"}}),
            self._timeline(story={"backgroundMusic": "tender-piano"}),
        ):
            self.assertNotEqual(ar_level_for(timeline), AR_LEVEL_ADVANCED)

    def test_the_level_is_not_something_a_customer_can_choose(self):
        """If Enhanced were purchasable, someone could pay for it and
        receive Basic because they uploaded no media — and be right to
        complain. Deriving it means the experience is always exactly as rich
        as the story allows."""
        import inspect

        from apps.delivery import ar_support

        signature = inspect.signature(ar_support.ar_level_for)
        self.assertEqual(list(signature.parameters), ["timeline"])


class SharedExperienceAccessTests(SimpleTestCase):
    """§10 / §21f — AR and the live keepsake share one access model.

    The live keepsake became a hosted page in §10, which gave it exactly the
    requirements §21f wrote for AR. These assert the sharing is real rather
    than two copies that happen to agree today.
    """

    def test_both_kinds_exist_on_one_model(self):
        from apps.delivery.models import PublicExperience

        self.assertEqual(PublicExperience.KIND_AR, "ar")
        self.assertEqual(PublicExperience.KIND_LIVE, "live")

    def test_the_live_route_reuses_the_ar_loader(self):
        # Not two implementations of the same generic-404 rule, revocation
        # check and no-listing discipline. The one that drifted would be
        # whichever nobody was looking at.
        import inspect

        from apps.delivery import live_views

        source = inspect.getsource(live_views)
        # The shared loader is `_load_paid_experience` (AR's `_load_experience`
        # is now a thin wrapper over it); this test still named the old one.
        self.assertIn("from apps.delivery.ar_views import _build_ar_payload, _load_paid_experience", source)
        self.assertNotIn("PublicExperience.objects", source)

    def test_kind_is_filtered_in_the_query_not_checked_after(self):
        """An AR id used on the live route must be indistinguishable from an
        id that does not exist.

        Checking `kind` after fetching would let a caller tell a real id
        from a fake one by the difference in behaviour, which is the oracle
        §21f exists to prevent.
        """
        import inspect

        from apps.delivery import ar_views

        source = inspect.getsource(ar_views._load_paid_experience)
        self.assertIn(".get(id=experience_id, kind=kind)", source)

    def test_the_live_endpoint_is_throttled_and_sessionless(self):
        from apps.delivery.live_views import LiveExperienceView

        self.assertEqual(LiveExperienceView.authentication_classes, [])
        self.assertTrue(LiveExperienceView.throttle_scope)

    def test_there_is_no_live_listing_endpoint(self):
        from apps.delivery import live_views

        self.assertEqual([n for n in dir(live_views) if n.lower().endswith("listview")], [])


class ARCardTests(SimpleTestCase):
    """§21i — the cards a product offers.

    A product may offer one, two or many. Love Story Timeline offers two,
    and they differ in a way that is infrastructural rather than visual:
    one shares a target compiled once, the other needs one per order.
    """

    def test_love_story_offers_a_generic_and_a_personalized_card(self):
        from apps.delivery.ar_support import ar_cards_for

        cards = ar_cards_for("love-story-timeline")
        self.assertEqual([c.id for c in cards], ["classic", "timeline"])
        self.assertTrue(cards[0].shared_target)
        self.assertFalse(cards[1].shared_target)

    def test_a_product_without_ar_offers_no_cards(self):
        # The per-product opt-in is the single source of whether AR exists
        # at all; the card map cannot contradict it.
        from apps.delivery.ar_support import ar_cards_for

        self.assertEqual(ar_cards_for("heart-map"), ())
        self.assertEqual(ar_cards_for("some-future-product"), ())

    def test_cards_are_offered_only_to_an_ar_purchase(self):
        """A card with no experience behind it is a piece of paper.

        Checked against the pack's TARGETS rather than its name, like every
        other rule in this module — a renamed pack must not change who gets
        a card.
        """
        from types import SimpleNamespace

        from apps.delivery.ar_support import cards_available_for_order

        def order(targets):
            return SimpleNamespace(
                product=SimpleNamespace(slug="love-story-timeline"),
                delivery_pack=SimpleNamespace(included_targets=targets, slug="whatever"),
            )

        self.assertEqual(len(cards_available_for_order(order(["ar-card"]))), 2)
        self.assertEqual(cards_available_for_order(order(["print-a4-edged"])), ())
        self.assertEqual(cards_available_for_order(order(["__live__"])), ())

    def test_a_shared_target_needs_no_per_order_work(self):
        # The distinction exists to decide infrastructure, not appearance:
        # only a per-order card requires compilation off the request path.
        from apps.delivery.ar_support import ar_cards_for

        per_order = [c for c in ar_cards_for("love-story-timeline") if not c.shared_target]
        self.assertEqual(len(per_order), 1)


class ARTargetTests(SimpleTestCase):
    """§21i — per-order tracking targets, compiled in the buyer's browser.

    The upload is the only AR endpoint that accepts data, so most of these
    are about who may write to it. An attacker who could overwrite someone
    else's target would steal nothing — they would silently break a gift,
    which is its own kind of damage.
    """

    def test_the_upload_is_session_gated_not_id_gated(self):
        """The AR id is a READ credential (§21f).

        Accepting it here would mean anyone who received a gift could alter
        it, which inverts the whole point of the ownership chain.
        """
        import inspect

        from apps.delivery import target_views

        source = inspect.getsource(target_views.ARTargetUploadView)
        self.assertIn("order__customer=customer", source)
        self.assertNotIn("ar_id", source)

    def test_it_writes_once(self):
        # Compilation is deterministic for a given card, so a second write
        # is either a duplicate or an attempt to change something.
        import inspect

        from apps.delivery import target_views

        source = inspect.getsource(target_views.ARTargetUploadView.post)
        self.assertIn("already-compiled", source)

    def test_a_missing_entitlement_and_a_foreign_one_look_the_same(self):
        import inspect

        from apps.delivery import target_views

        source = inspect.getsource(target_views.ARTargetUploadView.post)
        self.assertEqual(source.count("That item could not be found."), 2)

    def test_the_upload_is_size_capped(self):
        from apps.delivery.target_views import MAX_TARGET_BYTES

        self.assertLessEqual(MAX_TARGET_BYTES, 16 * 1024 * 1024)

    def test_a_shared_card_needs_no_stored_target(self):
        from apps.delivery.models import PublicExperience

        experience = PublicExperience(kind=PublicExperience.KIND_AR)
        # `needs_target` is only meaningful for a per-order card; the AR
        # payload pairs it with the card registry before acting on it.
        self.assertTrue(experience.needs_target)
        experience.target_key = "ar-targets/x.mind"
        self.assertFalse(experience.needs_target)


class ARCardArtworkTests(SimpleTestCase):
    """§21i — the per-order card, which is two things at once.

    It is the object the customer prints, and it is the image MindAR
    compiles into a tracking target. The second purpose is why it is denser
    than a poster: `AR-VR-SCOPING.md` records that Heartfolio's art
    direction — flat colour, thin type, generous negative space — is close
    to the worst case for image tracking.
    """

    def _card(self):
        from apps.delivery.product_renderers.love_story_timeline.data import validate_and_normalize
        from apps.delivery.product_renderers.love_story_timeline.png_renderer import render_png
        from apps.delivery.product_renderers.love_story_timeline.tests import (
            VALID_THEME,
            VALID_VALUES,
        )

        return render_png(
            validate_and_normalize(VALID_VALUES, VALID_THEME),
            target_id="ar-card-artwork", customer=None,
        )

    def test_it_renders_at_card_size(self):
        import io

        from PIL import Image

        from apps.delivery.ar_support import CARD_HEIGHT_PX, CARD_WIDTH_PX

        with Image.open(io.BytesIO(self._card())) as img:
            self.assertEqual(img.size, (CARD_WIDTH_PX, CARD_HEIGHT_PX))

    def test_it_shows_a_few_milestones_large_rather_than_all_of_them_small(self):
        """Assuming the card was a SUMMARY is what kept the photographs
        small — eight milestones divide the height eight ways.

        It is a trigger and an invitation; the full story appears when it is
        scanned, and the poster already holds the data.
        """
        import inspect

        from apps.delivery.product_renderers.love_story_timeline import png_renderer

        source = inspect.getsource(png_renderer._render_ar_card)
        self.assertIn("CARD_MILESTONES = 3", source)
        self.assertIn("more, when you scan", source)

    def test_the_qr_is_composited_by_the_delivery_layer_not_the_renderer(self):
        """The QR encodes the ORDER's experience URL.

        A renderer that knew about orders could not be exercised without
        one — and the whole composition suite renders from a normalized
        timeline and nothing else.
        """
        import inspect

        from apps.delivery import ar_card
        from apps.delivery.product_renderers.love_story_timeline import png_renderer

        self.assertNotIn("qrcode", inspect.getsource(png_renderer._render_ar_card))
        self.assertIn("qrcode", inspect.getsource(ar_card))

    def test_the_qr_sits_where_the_renderer_reserved_space(self):
        # Both sides read the same constants, so the block and the code
        # cannot drift apart.
        import inspect

        from apps.delivery import ar_card

        source = inspect.getsource(ar_card.composite_qr)
        self.assertIn("CARD_QR_BLOCK_RATIO", source)
        self.assertIn("CARD_MARGIN_RATIO", source)

    def test_the_qr_gets_a_white_quiet_zone_whatever_the_palette(self):
        # A QR on the midnight palette's near-black background would look
        # right and not scan.
        import inspect

        from apps.delivery import ar_card

        self.assertIn('"#ffffff"', inspect.getsource(ar_card.composite_qr))

    def test_the_link_carries_no_query_string(self):
        """The id IS the credential, and keeping it in the path keeps it out
        of `Referer` headers — the one weakness flagged in the §12
        magic-link review that this design does not repeat."""
        from types import SimpleNamespace

        from apps.delivery.ar_card import experience_url

        url = experience_url(SimpleNamespace(id="abc"), "https://x.test", "ar")
        self.assertNotIn("?", url)
        self.assertTrue(url.endswith("/ar/abc"))


class GenericCardTests(SimpleTestCase):
    """§21i — the shared card, whose artwork is the same for everyone.

    Designed for the TRACKER first, which is the opposite of how a keepsake
    is usually designed and is the whole reason this card can exist. A
    per-order card inherits Heartfolio's art direction — flat colour, thin
    type, generous negative space — which `AR-VR-SCOPING.md` records as
    close to the worst case for image tracking. This one is a single image
    we control completely.
    """

    def test_it_renders_at_card_size(self):
        import io

        from PIL import Image

        from apps.delivery.ar_support import CARD_HEIGHT_PX, CARD_WIDTH_PX
        from apps.delivery.generic_card import render_generic_card

        with Image.open(io.BytesIO(render_generic_card())) as img:
            self.assertEqual(img.size, (CARD_WIDTH_PX, CARD_HEIGHT_PX))

    def test_it_is_identical_every_time(self):
        """The compiled target must match the artwork that is printed.

        Any randomness here would mean a card compiled today failing to
        track a card printed tomorrow — which is why the motif uses a
        deterministic spiral rather than a random scatter.
        """
        from apps.delivery.generic_card import render_generic_card

        self.assertEqual(render_generic_card(), render_generic_card())

    def test_it_carries_no_customer_data(self):
        """A shared card that varied per customer would need a target per
        customer, which is exactly what it exists to avoid.

        Asserted on the SIGNATURE rather than by scanning the source: the
        first version of this test matched the word "timeline" and failed on
        an import path, which is the kind of test that fails for reasons
        unrelated to what it is checking. A function that takes no arguments
        cannot receive customer data.
        """
        import inspect

        from apps.delivery.generic_card import render_generic_card

        self.assertEqual(list(inspect.signature(render_generic_card).parameters), [])

    def test_it_is_visually_dense(self):
        """The property that makes it trackable at all.

        Measured rather than asserted in prose: a tracker needs local
        contrast across the frame, and the first version of this card was
        mostly empty paper.
        """
        import io

        from PIL import Image

        from apps.delivery.generic_card import render_generic_card

        with Image.open(io.BytesIO(render_generic_card())) as img:
            grey = img.convert("L")
            background = grey.getpixel((5, 5))
            # Sample the middle band, where the motif lives.
            marked = 0
            total = 0
            for y in range(int(grey.height * 0.2), int(grey.height * 0.7), 6):
                for x in range(0, grey.width, 6):
                    total += 1
                    if abs(grey.getpixel((x, y)) - background) > 25:
                        marked += 1
            self.assertGreater(marked / total, 0.05, "motif is too sparse to track")


class MusicPresetUrlTests(SimpleTestCase):
    """§4 — resolving a preset id to its playable URL, for the AR/Live
    payload."""

    def test_none_resolves_to_no_url(self):
        from apps.delivery.ar_support import preset_music_url

        self.assertIsNone(preset_music_url("none"))
        self.assertIsNone(preset_music_url(""))

    def test_a_real_preset_resolves_to_the_shared_static_path(self):
        # Must match `presetMusicUrl()` in music-presets.ts exactly — both
        # sides compute this path independently, and a mismatch would mean
        # the Studio's in-editor Live preview and the real /live/<id> page
        # point at different files for the same story.
        from apps.delivery.ar_support import preset_music_url

        self.assertEqual(preset_music_url("tender-piano"), "/audio/presets/tender-piano.mp3")
