"""The colophon on every print (owner, 27 Oct 2026): "Heartfolio ·
theheartfolio.com", at least FRAMELESS_SAFE_PX (6.35mm) from the trim of a
frameless print, and never on the customer's content.

Every Love Story Timeline layout and every Song Poster theme is rendered at
MAXIMUM content on every print target. `draw_colophon` is drawn last, so at
the moment it is called the page holds everything except the colophon: the
spy reads the pixels under (and 6px around) where its ink will land, and they
must be one plain colour. A photo, a word, a rule or a card's shadow there
would not be.
"""

from __future__ import annotations

import io
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from PIL import Image, ImageDraw

from apps.assets.services import upload_asset
from apps.customers.models import Customer
from apps.delivery import attribution
from apps.delivery.print_sizes import all_print_target_ids

PAD = 6


def _photo(customer, colour):
    buf = io.BytesIO()
    Image.new("RGB", (1600, 1200), colour).save(buf, format="JPEG", quality=90)
    asset = upload_asset(customer, SimpleUploadedFile("p.jpg", buf.getvalue(), content_type="image/jpeg"))
    return {"assetId": str(asset.id)}


class _Spy:
    """Wraps a renderer module's `draw_colophon` and records, per call, the
    page size, the ink box, and how many distinct colours lie under it."""

    def __init__(self, real):
        self.real = real
        self.calls = []

    def __call__(self, image, *, font, colour, content_box, corner, inset):
        box = attribution.colophon_ink_box(ImageDraw.Draw(image), font, content_box, corner=corner, inset=inset)
        region = image.convert("RGB").crop(
            (max(0, box[0] - PAD), max(0, box[1] - PAD), min(image.width, box[2] + PAD), min(image.height, box[3] + PAD))
        )
        colours = region.getcolors(maxcolors=4096) or [(0, None)] * 4097
        self.calls.append({"size": image.size, "box": box, "colours": len(colours)})
        return self.real(image, font=font, colour=colour, content_box=content_box, corner=corner, inset=inset)


class ColophonClearanceTests(TestCase):
    def _check(self, spy, label, target):
        self.assertEqual(len(spy.calls), 1, f"{label} {target}: the colophon must be drawn exactly once")
        call = spy.calls[0]
        width, height = call["size"]
        left, top, right, bottom = call["box"]
        self.assertEqual(call["colours"], 1, f"{label} {target}: something of the design lies under the colophon")
        self.assertGreaterEqual(left, 0)
        self.assertLessEqual(right, width)
        if target.endswith("-frameless"):
            nearest = min(left, width - right, height - bottom)
            self.assertGreaterEqual(
                nearest, attribution.FRAMELESS_SAFE_PX, f"{label} {target}: {nearest}px from the trim"
            )

    def test_love_story_timeline_every_layout_and_print(self):
        from apps.delivery.product_renderers.love_story_timeline import png_renderer
        from apps.delivery.product_renderers.love_story_timeline.data import LAYOUTS, validate_and_normalize

        customer = Customer.objects.create(email="colophon-lst@example.com")
        events = [
            {
                "date": f"2023-{month:02d}-15",
                "title": "The weekend we finally painted the kitch",  # 40
                "description": (
                    "We spent the whole weekend arguing about colours, gave up, ordered takeaway, "
                    "and painted it white anyway. Best decision we ever made, honest"
                ),  # 140
                "location": "Our first flat, Rua das Flores 12, Porto",  # 40
                "photo": _photo(customer, (40 + month * 30, 120, 200)),
            }
            for month in range(1, 6)  # the Studio's cap
        ]
        values = {
            "storyType": "couple",
            "people": [{"name": "Alexandra Konstantinopol"}, {"name": "Maximilian von Habsburg"}],
            "posterTitle": "Our Love Story, from the very first day",
            "subtitle": "x" * 60,
            "dedication": "Every love story is beautiful, but ours is my favorite. " * 3,
            "endingText": "To be continued, wherever life takes us.",  # 40
            "showDuration": True,
            "autoSort": True,
            "events": events,
        }
        from apps.delivery.product_renderers.love_story_timeline.tests import ARABIC_MAX

        arabic = {
            **values,
            "people": [{"name": name} for name in ARABIC_MAX["people"]],
            **{key: ARABIC_MAX[key] for key in ("posterTitle", "subtitle", "dedication", "endingText")},
            "events": [
                {**event, "date": date, "title": title, "description": description, "location": location}
                for event, (date, title, description, location) in zip(events, ARABIC_MAX["events"])
            ],
        }
        for script, content in (("latin", values), ("arabic", arabic)):
            for layout in LAYOUTS:
                timeline = validate_and_normalize(
                    content, {"palette": "classic", "typography": "serif-classic", "layout": layout, "scale": 130}
                )
                for target in all_print_target_ids():
                    with self.subTest(script=script, layout=layout, target=target):
                        spy = _Spy(png_renderer.draw_colophon)
                        with mock.patch.object(png_renderer, "draw_colophon", spy):
                            png_renderer.render_png(timeline, target_id=target, customer=customer, locale="ar" if script == "arabic" else "en")
                        self._check(spy, f"{script} {layout}", target)

    def test_song_poster_every_theme_and_print(self):
        from apps.delivery.product_renderers.song_poster import png_renderer
        from apps.delivery.product_renderers.song_poster.data import THEMES, validate_and_normalize

        customer = Customer.objects.create(email="colophon-song@example.com")
        values = {
            "track": "The Long and Winding Road That Leads Me Back to Your Door Ag",
            "artist": "Sir Paul McCartney and the Royal Liverpool Philharmonic Orch",
            "dedication": "For every night we danced in the kitchen before the dishes were done. " * 2,
            "youtubeUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "youtubeVideoId": "dQw4w9WgXcQ",
            "photo": _photo(customer, (200, 120, 60)),
        }
        arabic = {
            **values,
            # Each at its field's maximum (track and artist 60, dedication 180).
            "track": "أغنية الليالي الطويلة التي رقصنا فيها في المطبخ قبل غسل الصحون كلها"[:60],
            "artist": "عبد الرحمن بن سلطان العتيبي وفرقة الموسيقى العربية الكبرى للحفلات"[:60],
            "dedication": ("إلى كل ليلة رقصنا فيها في المطبخ قبل أن ننتهي من غسل الصحون. " * 3)[:180],
        }
        for script, content in (("latin", values), ("arabic", arabic)):
            for theme in THEMES:
                song = validate_and_normalize(content, {"theme": theme, "sleevePalette": "black"})
                for target in all_print_target_ids():
                    with self.subTest(script=script, theme=theme, target=target):
                        spy = _Spy(png_renderer.draw_colophon)
                        with mock.patch.object(png_renderer, "draw_colophon", spy):
                            png_renderer.render_png(song, target_id=target, customer=customer)
                        self._check(spy, f"{script} {theme}", target)

    def test_the_colophon_is_the_name_and_the_address(self):
        self.assertEqual(attribution.PRINT_MARK, "Heartfolio · theheartfolio.com")
        # 0.25in at the prints' 300dpi.
        self.assertEqual(attribution.FRAMELESS_SAFE_PX, 75)


class ColophonOnBonusesTests(TestCase):
    """The QR cards, the bonus PDFs and the receipt email carry the name and
    the address too."""

    def _card_texts(self, variant, caption):
        from apps.delivery import bonuses

        drawn = []
        real = bonuses._centred

        def spy(draw, text, width, y, fill, font):
            left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
            drawn.append({"text": text, "top": y, "bottom": y + (bottom - top), "height": draw.im.size[1]})
            return real(draw, text, width, y, fill, font)

        with mock.patch.object(bonuses, "_centred", spy):
            bonuses._render_qr_card("https://theheartfolio.com/en/live/x", variant, caption=caption, locale="en")
        return drawn

    def test_every_qr_card_ends_with_the_wordmark_and_the_address_inside_its_margin(self):
        from apps.delivery import bonuses

        self.assertEqual(bonuses.QR_WORDMARK, "HEARTFOLIO · theheartfolio.com")
        longest = "Sir Paul McCartney and the Royal Liverpool Philharmonic Orch — " + "The Long and Winding Road That Leads Me Back to Your Door Ag"
        for variant in bonuses.QR_CARD_VARIANTS:
            for caption in ("Our Love Story", longest):
                with self.subTest(variant=variant, caption=caption[:12]):
                    drawn = self._card_texts(variant, caption)
                    wordmark = drawn[-1]
                    self.assertEqual(wordmark["text"], bonuses.QR_WORDMARK)
                    self.assertLessEqual(wordmark["bottom"], wordmark["height"] * (1 - bonuses.CAPTION_BOTTOM_MARGIN))
                    for line in drawn[:-1]:
                        self.assertLess(line["bottom"], wordmark["top"], f"{line['text']!r} runs into the wordmark")

    def test_both_bonus_pdfs_carry_the_colophon_in_every_language(self):
        from apps.delivery.bonuses import PDF_FOOTER, render_printing_advice_pdf, render_thank_you_card

        self.assertEqual(PDF_FOOTER, "HEARTFOLIO · theheartfolio.com")
        from reportlab.pdfgen.canvas import Canvas

        for locale in ("en", "fr", "ar"):
            for render in (render_thank_you_card, render_printing_advice_pdf):
                with self.subTest(locale=locale, pdf=render.__name__):
                    # The pages are compressed: record what is drawn instead.
                    drawn = []
                    real_left, real_right = Canvas.drawString, Canvas.drawRightString

                    def left(canvas, x, y, text, *args, **kwargs):
                        drawn.append(text)
                        return real_left(canvas, x, y, text, *args, **kwargs)

                    def right(canvas, x, y, text, *args, **kwargs):
                        drawn.append(text)
                        return real_right(canvas, x, y, text, *args, **kwargs)

                    with mock.patch.object(Canvas, "drawString", left), mock.patch.object(Canvas, "drawRightString", right):
                        render(locale)
                    self.assertIn(PDF_FOOTER, drawn)
