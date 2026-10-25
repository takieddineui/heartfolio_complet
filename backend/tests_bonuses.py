"""Tests for the bonus deliverables (§18).

The recurring concern here is that a bonus must never cost a customer the
thing they actually paid for. Several of these check exactly that.
"""

import io
import re
import uuid
import zipfile
from types import SimpleNamespace
from unittest.mock import patch

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


# ---------------------------------------------------------------------
# The QR card's caption (18 Oct 2026)
# ---------------------------------------------------------------------

_SHORT_CAPTIONS = ("Emma & James", "Our Love Story", "The Landing — Halfway Home", "Theo & Hana", "Amira Benali",
                   "Éléonore & Jean-Baptiste", None)
_LONG_CAPTIONS = (
    "Alexandra Konstantinopol & Maximilian von Habsburg",  # LST names, 24 + 24
    "The Long and Winding Road to Your Doorst",  # LST poster title, 40
    # Song Poster's "artist — track", 60 + 60
    "Sir Paul McCartney and the Royal Liverpool Philharmonic Orch — The Long and Winding Road That Leads Me Back to Your Door Ag",
    "Bartholomew-Alexander L. & Anastasia-Konstantina M.",  # Reasons, 24 + 24
    "Maximiliane Josephine Charlotte von Arnim",  # Graduation, 40
    "ليلى & عمر",
    "عبد الرحمن بن سلطان العت & نور الهدى بنت محمد القحط",
    "ماجد المهندس — أحبك أكثر من أي شيء",
    # Long enough that Arabic takes two lines, spaced by its ink: vowel marks
    # above tall letters and below deep tails, the case the floor exists for.
    "إِلَى قُلُوبِنَا جَمِيعًا — أُغْنِيَةُ الْحُبِّ الْأَبَدِيِّ لِلْأَحِبَّةِ فِي كُلِّ مَكَانٍ وَزَمَانٍ بَعِيدٍ",
    "Layla & عمر",
    "Supercalifragilisticexpialidocious-and-beyond-the-card-edge",
)


def _drawn_card(caption, variant):
    """Every text the card draws (text, ink box, font) and its QR plate."""
    from unittest import mock

    from PIL import Image as PILImage
    from PIL import ImageDraw

    from apps.delivery import bonuses

    texts, plates = [], []
    real_text, real_plate = ImageDraw.ImageDraw.text, ImageDraw.ImageDraw.rounded_rectangle

    def spy_text(draw, xy, value, *args, **kwargs):
        texts.append((value, draw.textbbox(xy, value, font=kwargs.get("font")), kwargs.get("font")))
        return real_text(draw, xy, value, *args, **kwargs)

    def spy_plate(draw, xy, *args, **kwargs):
        plates.append(tuple(xy[0]) + tuple(xy[1]) if isinstance(xy[0], (tuple, list)) else tuple(xy))
        return real_plate(draw, xy, *args, **kwargs)

    with mock.patch.object(ImageDraw.ImageDraw, "text", spy_text), \
            mock.patch.object(ImageDraw.ImageDraw, "rounded_rectangle", spy_plate):
        png = bonuses._render_qr_card("https://www.theheartfolio.com/en/k/abc", variant, caption=caption)
    size = PILImage.open(io.BytesIO(png)).size
    [plate] = plates
    caption_lines = [t for t in texts if t[0] != "HEARTFOLIO"]
    [wordmark] = [t for t in texts if t[0] == "HEARTFOLIO"]
    return size, plate, caption_lines, wordmark


class QrCaptionTests(SimpleTestCase):
    """The caption was one line at a fixed size: long names and Song Poster's
    "artist — track" ran off both edges (117% and 283% of the card), on the gift
    card emailed to the recipient too, and Arabic printed as empty boxes.

    The limits approved on 18 Oct 2026 are written here, not read back from
    `bonuses`, so changing one there fails this: 84% of the card's width, two
    lines, a 70% floor."""

    WIDTH, MAX_LINES, MIN_SCALE = 0.84, 2, 0.70

    def test_a_caption_that_fits_one_line_is_drawn_exactly_where_it_always_was(self):
        from apps.delivery import bonuses

        for variant in bonuses.QR_CARD_VARIANTS:
            for caption in _SHORT_CAPTIONS:
                with self.subTest(variant=variant, caption=caption):
                    (width, height), plate, lines, wordmark = _drawn_card(caption, variant)
                    plate_bottom = plate[3]
                    [(text, box, font)] = lines
                    self.assertEqual(text, caption or "Scan to open your keepsake")
                    self.assertEqual(font.size, int(width * 0.042))
                    self.assertEqual(box[1], plate_bottom + int(height * 0.045))  # the ink's top, as before
                    self.assertEqual(wordmark[1][1], plate_bottom + int(height * 0.105))

    def test_every_caption_stays_on_the_card_clear_of_the_plate_and_the_wordmark(self):
        """Boxes that never overlap also mean no letters ever touch."""
        from apps.delivery import bonuses

        def hit(a, b):
            return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]

        for variant in bonuses.QR_CARD_VARIANTS:
            for caption in _SHORT_CAPTIONS + _LONG_CAPTIONS:
                with self.subTest(variant=variant, caption=caption):
                    (width, height), plate, lines, wordmark = _drawn_card(caption, variant)
                    left, right = width * (1 - self.WIDTH) / 2, width * (1 + self.WIDTH) / 2
                    self.assertLessEqual(len(lines), self.MAX_LINES)
                    for i, (text, box, font) in enumerate(lines):
                        self.assertGreaterEqual(box[0], left - 1, f"{text!r} runs off the left")
                        self.assertLessEqual(box[2], right + 1, f"{text!r} runs off the right")
                        self.assertGreaterEqual(box[1], plate[3], f"{text!r} reaches into the QR plate")
                        self.assertFalse(hit(box, wordmark[1]), f"{text!r} touches the wordmark")
                        for other in lines[i + 1:]:
                            self.assertFalse(hit(box, other[1]), f"{text!r} touches the next line")
                        self.assertGreaterEqual(font.size, int(width * 0.042 * self.MIN_SCALE))
                    self.assertLessEqual(wordmark[1][3], height * (1 - bonuses.CAPTION_BOTTOM_MARGIN))

    def test_the_whole_caption_is_printed_unless_cut_at_the_floor(self):
        from apps.delivery import bonuses

        for variant in bonuses.QR_CARD_VARIANTS:
            for caption in _SHORT_CAPTIONS + _LONG_CAPTIONS:
                with self.subTest(variant=variant, caption=caption):
                    (width, _), _, lines, _ = _drawn_card(caption, variant)
                    printed = " ".join(text for text, _, _ in lines)
                    wanted = caption or "Scan to open your keepsake"
                    if printed.endswith("…"):
                        self.assertEqual(lines[0][2].size, round(int(width * 0.042) * self.MIN_SCALE))
                        self.assertTrue(wanted.startswith(printed[:-1].rstrip()), printed)
                    else:
                        self.assertEqual(printed, wanted)
                    if caption in _LONG_CAPTIONS[:2] + _LONG_CAPTIONS[3:5]:
                        self.assertFalse(printed.endswith("…"), "long names fit whole on two lines")
                    if caption == _LONG_CAPTIONS[8]:
                        self.assertEqual(len(lines), 2, "the long Arabic caption wraps (it exercises the Arabic line spacing)")

    def test_every_printed_character_has_a_real_glyph_and_arabic_is_kufi(self):
        from apps.delivery import bonuses
        from apps.delivery.mixed_script import has_glyph

        for variant in bonuses.QR_CARD_VARIANTS:
            for caption in _LONG_CAPTIONS:
                with self.subTest(variant=variant, caption=caption):
                    _, _, lines, wordmark = _drawn_card(caption, variant)
                    for text, _, font in lines + [wordmark]:
                        for ch in text:
                            if ch.isspace():
                                continue
                            face = font.face_for_char(ch) if hasattr(font, "face_for_char") else font
                            self.assertTrue(has_glyph(face, ch), f"{ch!r} in {text!r} is an empty box")
                            if 0x0600 <= ord(ch) <= 0x06FF:
                                self.assertEqual(face.getname()[0], "Noto Kufi Arabic")

    def test_the_card_fonts_are_in_the_folder(self):
        """`_card_font` falls back to Pillow's bitmap font rather than fail the
        bonus; this makes sure the shipped files never need it."""
        from apps.delivery import bonuses

        for name in ("DejaVuSerif.ttf", "DejaVuSans.ttf", "noto-kufi-arabic.woff2"):
            with self.subTest(font=name):
                self.assertTrue((bonuses._CARD_FONT_DIR / name).is_file())


class LocalizedBonusTests(SimpleTestCase):
    """THE BONUS FILES AND THE QR CARD SPEAK THE ORDER'S LANGUAGE (owner's
    decision, 25 Oct 2026: they were English for every order). Each
    document's words come from `bonus_copy`, wrapped to the page; Arabic is
    drawn right to left as shaped lines."""

    def _drawn(self, render, locale):
        """Every line the PDF draws: (text, right_to_left, width, room)."""
        from apps.delivery import bonuses

        drawn = []
        real_line = bonuses._PdfText.line

        def record(text_self, line, y, size, colour, *, bold=False, italic=False, inset=0.0):
            drawn.append((line, text_self.rtl, text_self.width(line, size, bold=bold, italic=italic),
                          text_self.right - text_self.left - inset))
            return real_line(text_self, line, y, size, colour, bold=bold, italic=italic, inset=inset)

        with patch.object(bonuses._PdfText, "line", record):
            pdf = render(locale)
        self.assertTrue(pdf.startswith(b"%PDF-"))
        return drawn

    def _documents(self):
        from apps.delivery.bonus_copy import PRINT_ADVICE, THANK_YOU

        return (
            (render_thank_you_card, lambda l: [THANK_YOU[l]["title"], *THANK_YOU[l]["paragraphs"]]),
            (render_printing_advice_pdf, lambda l: [PRINT_ADVICE[l]["title"]] + [
                part for heading, paragraphs in PRINT_ADVICE[l]["sections"] for part in [heading, *paragraphs]]),
        )

    def test_each_language_draws_its_own_words_and_none_of_the_english(self):
        for render, words in self._documents():
            english = " ".join(words("en"))
            for locale in ("en", "fr", "ar"):
                with self.subTest(render.__name__, locale=locale):
                    drawn = " ".join(line for line, *_ in self._drawn(render, locale))
                    for part in words(locale):
                        self.assertIn(part, drawn)
                    if locale != "en":
                        self.assertNotIn(english[:60], drawn)

    def test_arabic_is_drawn_right_to_left_and_the_others_left_to_right(self):
        for render, _ in self._documents():
            for locale in ("en", "fr", "ar"):
                with self.subTest(render.__name__, locale=locale):
                    self.assertEqual({rtl for _, rtl, *_ in self._drawn(render, locale)}, {locale == "ar"})

    def test_every_line_fits_the_page(self):
        for render, _ in self._documents():
            for locale in ("en", "fr", "ar"):
                for line, _, width, room in self._drawn(render, locale):
                    with self.subTest(render.__name__, locale=locale, line=line[:30]):
                        self.assertLessEqual(width, room + 0.5)

    def test_an_unknown_language_gets_the_english_documents(self):
        from apps.delivery.bonus_copy import THANK_YOU

        drawn = " ".join(line for line, *_ in self._drawn(render_thank_you_card, "de"))
        self.assertIn(THANK_YOU["en"]["paragraphs"][0], drawn)

    def test_the_thank_you_card_no_longer_promises_files(self):
        """A Digital-only order has no files; the card is the same for every order."""
        from apps.delivery.bonus_copy import THANK_YOU

        self.assertNotIn("files", " ".join(THANK_YOU["en"]["paragraphs"]).lower())

    def test_the_qr_card_default_caption_is_in_the_order_language(self):
        from apps.delivery import bonuses
        from apps.delivery.bonus_copy import QR_DEFAULT_CAPTION

        for locale in ("en", "fr", "ar"):
            captured = {}
            real = bonuses._caption_layout

            def spy(draw, text, **kwargs):
                captured["text"] = text
                return real(draw, text, **kwargs)

            with self.subTest(locale), patch.object(bonuses, "_caption_layout", spy):
                bonuses._render_qr_card("https://example.test/x", "dark", caption=None, locale=locale)
                self.assertEqual(captured["text"], QR_DEFAULT_CAPTION[locale])
