"""`mixed_script`: per-character faces and bidi order, as a browser does."""

from pathlib import Path

from django.test import SimpleTestCase
from PIL import Image, ImageDraw, ImageFont

from apps.delivery.mixed_script import MixedScriptFont, bidi_levels, has_glyph, parse_unicode_range, visual_order

FONTS = Path(__file__).parent / "product_renderers" / "love_story_timeline" / "fonts"
ARABIC = parse_unicode_range("U+0600-06FF, U+0750-077F, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC")


def _font(name="DejaVuSans.ttf", size=40):
    naskh = ImageFont.truetype(str(FONTS / "noto-naskh-arabic.woff2"), size=size)
    return MixedScriptFont(str(FONTS / name), size, second=naskh, second_range=ARABIC)


def _display(text):
    """The string in left-to-right display order."""
    return "".join(text[i] for i in visual_order(bidi_levels(text)))


class BidiTests(SimpleTestCase):
    def test_latin_is_left_to_right(self):
        self.assertEqual(_display("Here Comes the Sun"), "Here Comes the Sun")

    def test_arabic_is_right_to_left(self):
        self.assertEqual(_display("ابت ثج"), "جث تبا")

    def test_a_string_takes_its_direction_from_its_first_strong_letter(self):
        # RTL paragraph: the Latin run keeps its own order but sits on the left.
        self.assertEqual(_display("ابت · HEARTFOLIO"), "HEARTFOLIO · تبا")
        # LTR paragraph: the Arabic run is reversed in place.
        self.assertEqual(_display("Love ابت"), "Love تبا")

    def test_spaces_between_latin_words_stay_with_them_inside_arabic(self):
        # N1: a neutral between two L letters is L, even in an RTL paragraph.
        self.assertEqual(_display("ابت Here Comes"), "Here Comes تبا")

    def test_numbers_inside_arabic_keep_left_to_right(self):
        self.assertEqual(_display("ابت 2024"), "2024 تبا")

    def test_trailing_punctuation_follows_the_paragraph(self):
        # "…" at the end of an Arabic title sits at its visual left.
        self.assertEqual(_display("ابت…"), "…تبا")
        self.assertEqual(_display("abc…"), "abc…")

    def test_brackets_take_the_direction_around_them(self):
        self.assertEqual(_display("ابت (ثج)"), ")جث( تبا")  # raqm mirrors the brackets when it shapes the run


class MixedScriptFontTests(SimpleTestCase):
    def test_latin_takes_pillows_own_path(self):
        font, plain = _font(), ImageFont.truetype(str(FONTS / "DejaVuSans.ttf"), size=40)
        text = "Here Comes the Sun — «déjà» · 1959"
        self.assertEqual(font.getlength(text), plain.getlength(text))
        self.assertEqual(font.getbbox(text), plain.getbbox(text))
        self.assertEqual(Image.Image()._new(font.getmask(text)).tobytes(), Image.Image()._new(plain.getmask(text)).tobytes())

    def test_each_character_is_drawn_by_a_face_that_has_it(self):
        """The Noto files are subsets with no Latin-1: those characters fall to
        DejaVu, and Arabic DejaVu lacks falls to Noto."""
        for name in ("DejaVuSans.ttf", "DejaVuSerif.ttf", "DejaVuSans-Oblique.ttf"):
            font = _font(name)
            for ch in "ابتثجحخ،؟ـﷺ·…«»—é A1":
                with self.subTest(font=name, ch=ch):
                    if not ch.isspace():
                        self.assertTrue(has_glyph(font.face_for_char(ch), ch), f"{ch!r} has no glyph in {font.face_for_char(ch).getname()}")

    def test_a_character_its_face_lacks_comes_from_the_other_face(self):
        """U+204F (the Arabic reversed semicolon) is outside the range the
        print switches on, and DejaVu Sans Mono Oblique (Contact Sheet's
        caption) has no glyph for it; Naskh does, so Naskh draws it."""
        font = _font("DejaVuSansMono-Oblique.ttf")
        self.assertFalse(has_glyph(font, "⁏"))
        self.assertIs(font.face_for_char("⁏"), font.second)
        self.assertTrue(has_glyph(font.face_for_char("⁏"), "⁏"))

    def test_arabic_letters_come_from_the_second_face_and_the_rest_from_the_first(self):
        font = _font()
        self.assertIs(font.face_for_char("ب"), font.second)
        for ch in "A·… ":
            self.assertIs(font.face_for_char(ch), font)

    def test_runs_are_in_display_order_with_their_faces(self):
        font = _font()
        runs = font.runs("ماجد · HEARTFOLIO")
        self.assertEqual([run for run, _, _ in runs], ["HEARTFOLIO", " · ", "ماجد"])
        self.assertEqual([face is font.second for _, face, _ in runs], [False, False, True])
        self.assertEqual([direction for _, _, direction in runs], ["ltr", "rtl", "rtl"])

    def test_the_drawn_ink_is_where_getbbox_says_and_as_long_as_getlength_says(self):
        for name in ("DejaVuSans.ttf", "DejaVuSerif-Italic.ttf"):
            font = _font(name)
            for text in ("ماجد · HEARTFOLIO", "أحبك أكثر من أي شيء…", "Love أحبك 2024", "«إلى رفيقة دربي»"):
                for anchor in ("la", "mm", "ls", "rd"):
                    with self.subTest(font=name, text=text, anchor=anchor):
                        image = Image.new("L", (1600, 400), 0)
                        xy = (700.4, 200.6)
                        ImageDraw.Draw(image).text(xy, text, font=font, fill=255, anchor=anchor)
                        ink = image.getbbox()
                        x0, y0, x1, y1 = ImageDraw.Draw(image).textbbox(xy, text, font=font, anchor=anchor)
                        self.assertTrue(x0 - 1 <= ink[0] and y0 - 1 <= ink[1] and ink[2] <= x1 + 1 and ink[3] <= y1 + 1, f"ink {ink} outside {(x0, y0, x1, y1)}")
                        self.assertLessEqual(abs(ink[2] - ink[0] - font.getlength(text)), 0.12 * font.size + 4)

    def test_nothing_is_dropped(self):
        """Every run is drawn: the ink of the whole equals the runs' ink side by side."""
        font = _font()
        text = "ماجد · HEARTFOLIO"
        whole = Image.new("L", (1600, 200), 0)
        ImageDraw.Draw(whole).text((10, 20), text, font=font, fill=255)
        self.assertEqual(sum(whole.getdata()) // 255 > 0, True)
        parts = 0
        for run, face, direction in font.runs(text):
            piece = Image.new("L", (1600, 200), 0)
            ImageDraw.Draw(piece).text((10, 20), run, font=face, fill=255, direction=direction)
            parts += sum(piece.getdata())
        self.assertAlmostEqual(sum(whole.getdata()), parts, delta=parts * 0.02)

    def test_one_run_lays_out_exactly_as_pillow_lays_out_its_face(self):
        """The anchor arithmetic matches Pillow's own for every anchor used."""
        font = _font()
        word = "أحبك"
        for anchor in ("la", "ma", "mm", "ls", "rd", "rs"):
            with self.subTest(anchor=anchor):
                self.assertEqual(font.getbbox(word, anchor=anchor), font.second.getbbox(word, anchor=anchor))
                mixed, mixed_offset = font.getmask2(word, "L", anchor=anchor, start=(0.3, 0.6))
                plain, plain_offset = font.second.getmask2(word, "L", anchor=anchor, start=(0.3, 0.6))
                self.assertEqual(mixed_offset, plain_offset)
                self.assertEqual(Image.Image()._new(mixed).tobytes(), Image.Image()._new(plain).tobytes())

    def test_an_unsupported_anchor_is_refused_not_guessed(self):
        with self.assertRaises(ValueError):
            _font().getbbox("ابت", anchor="lt")
