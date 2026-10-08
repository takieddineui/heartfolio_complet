"""Tests for the manageable catalog entities (§7d).

The load-bearing one is the sellability guard. Everything else here is
ordinary CRUD behaviour; that one is the difference between a dashboard that
manages the catalog and a dashboard that can sell an undeliverable file.
"""

from django.test import SimpleTestCase

from apps.products.catalog_entities import PrintSize
from apps.products.catalog_entities import SizeNotRenderable, assert_size_can_be_sold


class PrintSizeSellabilityTests(SimpleTestCase):
    def test_a_size_the_renderer_supports_is_sellable(self):
        size = PrintSize(key="a4", base_width_px=2480, base_height_px=3508)
        self.assertTrue(size.is_sellable)

    def test_a_size_no_renderer_produces_is_not_sellable(self):
        # The whole point: this row can exist, but it must not be sold.
        size = PrintSize(key="a2", base_width_px=4960, base_height_px=7016)
        self.assertFalse(size.is_sellable)

    def test_a_size_implies_one_target_per_mounting(self):
        # §3 — frameless and edged are two products, not two styles.
        size = PrintSize(key="a4", base_width_px=2480, base_height_px=3508)
        self.assertEqual(sorted(size.target_ids), ["print-a4-edged", "print-a4-frameless"])

    def test_the_ratio_is_derived_not_stored(self):
        # A stored ratio would be a second source of truth that can disagree
        # with the dimensions beside it.
        self.assertAlmostEqual(
            PrintSize(key="classic", base_width_px=2400, base_height_px=3000).ratio, 1.25, places=3
        )


class SellabilityGuardTests(SimpleTestCase):
    def test_selling_an_unrenderable_size_is_refused(self):
        """The failure chain this prevents, in order: the row saves, it
        enters a pack, the product page advertises it, Paddle charges for
        it, the customer downloads and gets a 501 — after paying."""
        with self.assertRaises(SizeNotRenderable):
            assert_size_can_be_sold("a2", 4960, 7016)

    def test_the_error_says_what_would_have_to_exist(self):
        # A refusal that does not say what is missing is a dead end.
        with self.assertRaises(SizeNotRenderable) as ctx:
            assert_size_can_be_sold("a2", 4960, 7016)
        message = str(ctx.exception)
        self.assertIn("print-a2-frameless", message)
        self.assertIn("print-a2-edged", message)

    def test_a_renderable_size_passes(self):
        # §7d asks for manageability; only SELLING an impossible size is
        # blocked. Creating, naming and ordering one is untouched.
        assert_size_can_be_sold("a4", 2480, 3508)
        assert_size_can_be_sold("poster", 3600, 5400)
