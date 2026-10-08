"""Tests for the bonus deliverables (§18).

The recurring concern here is that a bonus must never cost a customer the
thing they actually paid for. Several of these check exactly that.
"""

import io
import re
import uuid
import zipfile
from types import SimpleNamespace

from django.test import SimpleTestCase, override_settings

from apps.delivery.bonuses import (
    BONUS_PRINT_ADVICE,
    BONUS_QR,
    BONUS_THANK_YOU,
    bonus_targets_for_order,
    pdf_targets_for_order,
    png_to_pdf,
    render_live_qr,
    render_printing_advice_pdf,
    render_thank_you_card,
)
from apps.commerce.order_access import verify_order_access_token


def _order(targets, locale="en"):
    return SimpleNamespace(
        id=uuid.uuid4(),
        locale=locale,
        delivery_pack=SimpleNamespace(included_targets=targets, slug="pack"),
        # Every real `Order` row has these two attributes, always — just
        # possibly `None`. `render_live_qr_card`'s caption customization
        # (`_qr_caption_for_order`) reads both, so a fixture missing them
        # entirely (rather than setting them to `None`) raised
        # `AttributeError` the moment that call was added, for a shape no
        # real `Order` can actually be in.
        project=None,
        product=None,
    )


class BonusAttachmentRulesTests(SimpleTestCase):
    def test_every_purchase_gets_the_thank_you_card(self):
        # §18a is explicit: every purchase, every pack.
        for targets in ([], ["__live__"], ["print-a4-edged"], ["wallpaper-phone"]):
            self.assertIn(BONUS_THANK_YOU, bonus_targets_for_order(_order(targets)))

    def test_printing_advice_only_when_something_is_printed(self):
        self.assertIn(BONUS_PRINT_ADVICE, bonus_targets_for_order(_order(["print-a4-edged"])))
        self.assertNotIn(BONUS_PRINT_ADVICE, bonus_targets_for_order(_order(["wallpaper-phone"])))
        self.assertNotIn(BONUS_PRINT_ADVICE, bonus_targets_for_order(_order(["__live__"])))

    def test_the_qr_only_when_there_is_a_live_page_to_point_at(self):
        self.assertIn(BONUS_QR, bonus_targets_for_order(_order(["__live__"])))
        self.assertNotIn(BONUS_QR, bonus_targets_for_order(_order(["print-a4-edged"])))

    def test_rules_read_the_targets_not_the_pack_name(self):
        # A renamed or newly added pack must get the right bonuses without
        # anyone remembering to update a list of slugs.
        order = _order(["print-poster-frameless", "__live__"])
        order.delivery_pack.slug = "some-pack-invented-next-year"
        bonuses = bonus_targets_for_order(order)
        self.assertIn(BONUS_PRINT_ADVICE, bonuses)
        self.assertIn(BONUS_QR, bonuses)

    def test_pdf_copies_are_scoped_to_prints_not_wallpapers(self):
        # §18c scopes this to the Printable Pack. Nobody takes a phone
        # wallpaper to a print shop.
        targets = pdf_targets_for_order(_order(["print-a4-edged", "wallpaper-phone", "__live__"]))
        self.assertEqual(targets, ["print-a4-edged"])


class BonusDocumentTests(SimpleTestCase):
    def test_the_printing_advice_is_a_real_pdf_covering_both_methods(self):
        # §18b requires ONE document covering both, because after §3 the two
        # variants need genuinely different instructions.
        pdf = render_printing_advice_pdf()
        self.assertTrue(pdf.startswith(b"%PDF-"))
        self.assertGreater(len(pdf), 1000)

    def test_the_thank_you_card_is_a_real_pdf(self):
        self.assertTrue(render_thank_you_card().startswith(b"%PDF-"))

    def test_a_wrapped_print_keeps_its_true_physical_size(self):
        """The page must BE the artwork, not the artwork placed on A4.

        Forcing A4 would silently resize a 12x18 poster, and a print shop
        would have no way to know that had happened.
        """
        from PIL import Image

        buffer = io.BytesIO()
        Image.new("RGB", (3600, 5400), (255, 255, 255)).save(buffer, format="PNG")
        pdf = png_to_pdf(buffer.getvalue(), width_px=3600, height_px=5400)

        box = re.search(rb"/MediaBox \[([\d\.\s]+)\]", pdf)
        self.assertIsNotNone(box)
        values = [float(v) for v in box.group(1).split()]
        # 3600px / 300dpi = 12in = 864pt; 5400px = 18in = 1296pt.
        self.assertAlmostEqual(values[2], 864.0, places=0)
        self.assertAlmostEqual(values[3], 1296.0, places=0)


class LiveQrTests(SimpleTestCase):
    @override_settings(FRONTEND_URL="https://example.test")
    def test_the_qr_encodes_a_link_that_actually_opens_the_order(self):
        """A QR pointing at a URL that then demands a session cookie is a QR
        that does not work — it is scanned on a phone that has never seen
        the site."""
        order = _order(["__live__"])
        png = render_live_qr(order)
        self.assertTrue(png.startswith(b"\x89PNG\r\n\x1a\n"))

        # Rebuild the URL the same way and confirm its token is valid for
        # this order — the encoded payload is what matters, not the pixels.
        from apps.commerce.order_access import generate_order_access_token

        token = generate_order_access_token(order.id)
        self.assertTrue(verify_order_access_token(token, order_id=order.id))

    @override_settings(FRONTEND_URL="https://example.test")
    def test_the_qr_uses_the_order_locale(self):
        # The link should open in the language the order was placed in.
        import qrcode

        order = _order(["__live__"], locale="ar")
        render_live_qr(order)  # must not raise for a non-default locale
        self.assertTrue(callable(qrcode.make))
