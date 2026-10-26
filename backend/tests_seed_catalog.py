"""Tests for the seed script's price protection (§5).

Run: DJANGO_SECRET_KEY=x python -m pytest tests_seed_catalog.py  — or via
`manage.py test tests_seed_catalog`.

These target `price_defaults`, which is the whole decision: whether a given
run is allowed to write a price. Importing the module itself would call
`django.setup()` against production settings, so the function is exercised
directly rather than by running the script.
"""

from types import SimpleNamespace

from django.test import SimpleTestCase

from seed_price_policy import price_defaults


class SeedPricePolicyTests(SimpleTestCase):
    def test_a_new_pack_gets_the_files_price(self):
        # Nothing to protect on a create — without this, a fresh database
        # would seed with no price at all.
        drift = []
        self.assertEqual(
            price_defaults(None, "price_cents", 1800, False, "new/pack", drift),
            {"price_cents": 1800},
        )
        self.assertEqual(drift, [])

    def test_an_existing_price_is_never_overwritten_by_default(self):
        # The bug this exists to prevent: re-running the seed to fix a target
        # list silently reverting a price someone set deliberately.
        existing = SimpleNamespace(price_cents=2600)
        drift = []
        self.assertEqual(
            price_defaults(existing, "price_cents", 1800, False, "lst/printable", drift), {}
        )
        self.assertEqual(len(drift), 1)
        self.assertIn("26.00", drift[0])
        self.assertIn("18.00", drift[0])
        self.assertIn("left unchanged", drift[0])

    def test_a_matching_price_reports_no_drift(self):
        # Only genuine disagreement is worth printing; otherwise every run
        # would list every pack and the real warnings would be lost in it.
        existing = SimpleNamespace(price_cents=1800)
        drift = []
        self.assertEqual(
            price_defaults(existing, "price_cents", 1800, False, "lst/printable", drift), {}
        )
        self.assertEqual(drift, [])

    def test_the_flag_writes_the_price(self):
        existing = SimpleNamespace(price_cents=2600)
        drift = []
        self.assertEqual(
            price_defaults(existing, "price_cents", 1800, True, "lst/printable", drift),
            {"price_cents": 1800},
        )
        # Nothing to warn about — the overwrite was asked for.
        self.assertEqual(drift, [])

    def test_it_applies_to_the_advertised_starting_price_too(self):
        # `starting_price_cents` is the "from" figure on the storefront. It
        # is a price, and gets the same protection.
        existing = SimpleNamespace(starting_price_cents=1200)
        drift = []
        self.assertEqual(
            price_defaults(existing, "starting_price_cents", 800, False, "lst", drift), {}
        )
        self.assertEqual(len(drift), 1)


class RealCatalogStateTests(SimpleTestCase):
    """Validates the ACTUAL `CATALOG` constant this file will seed — not a
    synthetic fixture. Locks in the final, approved pack/pricing state
    reached across several audits earlier in this project, so a future
    edit to CATALOG can't silently drift from it the way this file
    already had, once, before being caught and fixed here.
    """

    def _love_story_packs(self):
        from seed_catalog import CATALOG

        entry = next(e for e in CATALOG if e["slug"] == "love-story-timeline")
        return {pack[0]: pack for pack in entry["packs"]}

    def test_the_real_catalog_has_no_validation_problems(self):
        from seed_catalog import CATALOG, validate

        problems = [p for entry in CATALOG for p in validate(entry)]
        self.assertEqual(problems, [], f"CATALOG itself is invalid: {problems}")

    def test_exactly_seven_love_story_timeline_packs_five_active_two_disabled(self):
        packs = self._love_story_packs()
        self.assertEqual(len(packs), 7)

        statuses = {slug: (pack[3] if len(pack) > 3 else "active") for slug, pack in packs.items()}
        active = {slug for slug, status in statuses.items() if status == "active"}
        disabled = {slug for slug, status in statuses.items() if status == "disabled"}

        self.assertEqual(
            active,
            {
                "printable",
                "printable-plus-wallpaper",
                "live",
                "digital-plus-wallpaper",
                "printable-plus-digital",
            },
        )
        # `complete` is retired by the combo model — disabled, never deleted
        # (past orders still reference the row).
        self.assertEqual(disabled, {"wallpaper", "complete"})

    def test_prices_match_the_approved_state_exactly(self):
        packs = self._love_story_packs()
        expected = {
            # New approved state: the five-tier FastSpring commercial
            # structure (Digital / Digital+Wallpapers / Printable /
            # Printable+Wallpapers / Complete), applied to Love Story
            # Timeline's existing packs with NO included_targets change —
            # only price_cents moved. `wallpaper` (disabled, unsold)
            # is untouched, same as before this change.
            "printable": 2299,
            "printable-plus-wallpaper": 2799,
            "live": 1599,
            "digital-plus-wallpaper": 2099,
            "complete": 3999,
            "wallpaper": 800,
            # $22.99 + $15.99 = $38.98, less a flat discount, rounded to a
            # clean price point.
            "printable-plus-digital": 3599,
        }
        for slug, price_cents in expected.items():
            self.assertEqual(packs[slug][1], price_cents, f"{slug} price drifted")

    def test_printable_plus_wallpaper_is_the_real_union_of_its_two_sources(self):
        # Not hand-typed — this is what actually makes it correct rather
        # than merely plausible-looking.
        packs = self._love_story_packs()
        printable_targets = set(packs["printable"][2])
        wallpaper_targets = set(packs["wallpaper"][2])
        combo_targets = set(packs["printable-plus-wallpaper"][2])
        self.assertEqual(combo_targets, printable_targets | wallpaper_targets)

    def test_digital_plus_wallpaper_is_the_real_union_of_its_two_sources(self):
        packs = self._love_story_packs()
        live_targets = set(packs["live"][2])
        wallpaper_targets = set(packs["wallpaper"][2])
        combo_targets = set(packs["digital-plus-wallpaper"][2])
        self.assertEqual(combo_targets, live_targets | wallpaper_targets)

    def test_printable_plus_digital_is_the_real_union_of_its_two_sources(self):
        packs = self._love_story_packs()
        printable_targets = set(packs["printable"][2])
        live_targets = set(packs["live"][2])
        combo_targets = set(packs["printable-plus-digital"][2])
        self.assertEqual(combo_targets, printable_targets | live_targets)

    def test_printable_plus_digital_is_cheaper_than_its_parts_but_not_free(self):
        # The point of a combo: a real saving over buying the two bases
        # separately — and a floor, so a typo cannot make it cheaper than
        # either base on its own.
        packs = self._love_story_packs()
        printable, live = packs["printable"][1], packs["live"][1]
        combo = packs["printable-plus-digital"][1]
        self.assertLess(combo, printable + live)
        self.assertGreater(combo, max(printable, live))

    def test_complete_is_retired_not_deleted(self):
        packs = self._love_story_packs()
        self.assertIn("complete", packs)
        self.assertEqual(packs["complete"][3], "disabled")

    def test_complete_does_not_include_ar(self):
        # Deliberate — AR is not launch-ready. See the CATALOG comment.
        packs = self._love_story_packs()
        complete_targets = packs["complete"][2]
        self.assertFalse(any(str(t).startswith("ar-") for t in complete_targets))

    def test_no_ar_pack_exists_in_the_catalog_at_all(self):
        packs = self._love_story_packs()
        self.assertNotIn("ar", packs)
        self.assertNotIn("ar-plus-wallpaper", packs)


class SongPosterCatalogStateTests(SimpleTestCase):
    """Song Poster's packs as the owner decided on 19 Oct 2026: Love Story
    Timeline's combo model, without its wallpaper combos. Three sellable
    packs, each to get its own Freemius plan; every older pack kept as a
    disabled row, never deleted."""

    def _packs(self):
        from seed_catalog import CATALOG

        entry = next(e for e in CATALOG if e["slug"] == "song-poster")
        return {pack[0]: pack for pack in entry["packs"]}

    def test_three_packs_are_sold_and_the_rest_are_disabled_not_deleted(self):
        packs = self._packs()
        statuses = {slug: (pack[3] if len(pack) > 3 else "active") for slug, pack in packs.items()}
        self.assertEqual(
            {slug for slug, status in statuses.items() if status == "active"},
            {"printable", "live", "printable-plus-digital"},
        )
        self.assertEqual(
            {slug for slug, status in statuses.items() if status == "disabled"},
            {"wallpaper", "printable-plus-wallpaper", "digital-plus-wallpaper", "complete"},
        )

    def test_prices_match_the_approved_state_exactly(self):
        packs = self._packs()
        expected = {
            "printable": 2299,
            "live": 1599,
            "printable-plus-digital": 3599,
            # Disabled rows keep the prices they were seeded with.
            "wallpaper": 799,
            "printable-plus-wallpaper": 2799,
            "digital-plus-wallpaper": 2099,
            "complete": 3999,
        }
        self.assertEqual({slug: pack[1] for slug, pack in packs.items()}, expected)

    def test_printable_plus_digital_is_the_real_union_of_its_two_sources(self):
        packs = self._packs()
        self.assertEqual(set(packs["printable-plus-digital"][2]), set(packs["printable"][2]) | set(packs["live"][2]))

    def test_printable_plus_digital_is_cheaper_than_its_parts_but_not_free(self):
        packs = self._packs()
        printable, live, combo = packs["printable"][1], packs["live"][1], packs["printable-plus-digital"][1]
        self.assertLess(combo, printable + live)
        self.assertGreater(combo, max(printable, live))

    def test_the_combo_matches_love_story_timelines_price(self):
        from seed_catalog import CATALOG

        lst = next(e for e in CATALOG if e["slug"] == "love-story-timeline")
        lst_combo = next(pack for pack in lst["packs"] if pack[0] == "printable-plus-digital")
        self.assertEqual(self._packs()["printable-plus-digital"][1], lst_combo[1])


class SellableMeansMappedTests(SimpleTestCase):
    """Production sells through Freemius only (owner, 25 Oct 2026), so a pack
    the catalog offers with no Freemius plan is a pack a customer can choose
    and never pay for. Where We Met was seeded `available` with three active
    packs and no plan until 26 Oct 2026; it is withdrawn now."""

    #: Active in the owner-approved Love Story Timeline state
    #: (`RealCatalogStateTests`), unmapped, and unreachable from the checkout
    #: (the wallpaper add-on is hidden, `SHOW_WALLPAPER_ADDON`). Whether to
    #: disable them is the owner's call, raised 26 Oct 2026. Anything else
    #: unmapped fails.
    KNOWN_UNMAPPED = {
        "love-story-timeline:printable-plus-wallpaper",
        "love-story-timeline:digital-plus-wallpaper",
    }

    def test_every_active_pack_of_an_available_product_has_a_freemius_plan(self):
        from apps.commerce.freemius_integration import FREEMIUS_PLAN_MAPPING
        from seed_catalog import CATALOG

        unmapped = [
            f"{entry['slug']}:{pack[0]}"
            for entry in CATALOG
            if entry["status"] == "available"
            for pack in entry["packs"]
            if (pack[3] if len(pack) > 3 else "active") == "active"
            and f"{entry['slug']}:{pack[0]}" not in FREEMIUS_PLAN_MAPPING
        ]
        self.assertEqual(sorted(set(unmapped) - self.KNOWN_UNMAPPED), [])
        # The exceptions stay real: a stale one (mapped or disabled since)
        # must be removed from the list, not linger as a blind spot.
        self.assertEqual(sorted(self.KNOWN_UNMAPPED - set(unmapped)), [])

    def test_where_we_met_is_withdrawn_not_deleted(self):
        from seed_catalog import CATALOG

        entry = next(e for e in CATALOG if e["slug"] == "heart-map")
        self.assertEqual(entry["status"], "disabled")
        self.assertEqual({pack[3] for pack in entry["packs"]}, {"disabled"})
        self.assertEqual({pack[0] for pack in entry["packs"]}, {"printable", "wallpaper", "complete"})
