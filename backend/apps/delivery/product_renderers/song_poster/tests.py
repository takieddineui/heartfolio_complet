"""
Tests for Song Poster's data contract, Pillow renderer, and registry
registration — the same three layers Love Story Timeline's own
`tests.py` covers, in the same style (`make_customer`/`make_*` local
fixture helpers, real uploaded photos via `upload_asset`, not
placeholder asset ids — see that file's own comment on why a
placeholder id fails at the renderer rather than at validation).

WRITTEN, NOT RUN. No Django is available in the environment these were
authored in — every assertion here is reasoned from the real model
fields and the real function signatures actually read from the source
files (`data.py`, `png_renderer.py`, `renderer.py`, `registry.py`), the
same discipline the rest of this session's test-repair work followed,
but it has not executed against a real database. Run with:

    docker compose exec -e DATABASE_URL=postgres://heartfolio:heartfolio@db:5432/heartfolio \\
      -e ASSET_STORAGE_BACKEND=mock api python manage.py test apps.delivery.product_renderers.song_poster
"""

import io
import uuid

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, TestCase
from PIL import Image

from apps.assets.services import upload_asset
from apps.common.exceptions.api_errors import SongPosterInvalidData, SongPosterRenderFailed
from apps.customers.models import Customer
from apps.delivery.delivery_types import DeliveryType
from apps.delivery.registry import get_renderer
from apps.delivery.renderers import NotImplementedRenderer
from apps.products.models import DeliveryPack, Product
from apps.projects.models import Project

from .data import THEMES, NormalizedSongPoster, validate_and_normalize
from .png_renderer import render_png
from .renderer import SongPosterRenderer

VALID_VALUES = {
    "track": "Halfway Home",
    "artist": "The Landing",
    "dedication": "For every long drive that led back to you.",
    "photo": {"assetId": "asset-1"},
    "youtubeUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "youtubeVideoId": "dQw4w9WgXcQ",
}


def make_customer(**overrides) -> Customer:
    defaults = {"email": f"guest-{uuid.uuid4().hex[:8]}@example.com"}
    defaults.update(overrides)
    return Customer.objects.create(**defaults)


def make_song_poster_product() -> Product:
    return Product.objects.create(
        slug="song-poster", name_i18n_key="product.songPoster.name",
        category=Product.CATEGORY_MUSIC, status=Product.STATUS_AVAILABLE,
    )


def make_delivery_pack(product, **overrides) -> DeliveryPack:
    defaults = {
        "product": product, "slug": "printable", "name_i18n_key": "pack.name",
        "description_i18n_key": "pack.description", "price_cents": 1200,
        "included_targets": ["print-classic-frameless"],
    }
    defaults.update(overrides)
    return DeliveryPack.objects.create(**defaults)


def values_with_real_photo(customer, values=None):
    """`VALID_VALUES` with a REAL uploaded photo, not the placeholder
    `"asset-1"` id — same reasoning as Love Story Timeline's own
    `values_with_real_photos`: a test that actually renders needs
    `get_asset_bytes_for_customer` to resolve something real, and a
    placeholder id fails there (correctly) rather than at validation.
    """
    base = values or VALID_VALUES
    buf = io.BytesIO()
    Image.new("RGB", (1200, 900), "steelblue").save(buf, format="JPEG")
    buf.seek(0)
    asset = upload_asset(customer, SimpleUploadedFile("p.jpg", buf.read(), content_type="image/jpeg"))
    return {**base, "photo": {"assetId": str(asset.id)}}


# ------------------------------------------------------------------
# Data validation
# ------------------------------------------------------------------

class DataValidationTests(SimpleTestCase):
    def test_valid_data_passes(self):
        song = validate_and_normalize(VALID_VALUES)
        self.assertEqual(song.track, "Halfway Home")
        self.assertEqual(song.artist, "The Landing")
        self.assertEqual(song.youtube_video_id, "dQw4w9WgXcQ")

    def test_missing_track_rejected(self):
        values = {**VALID_VALUES, "track": ""}
        with self.assertRaises(SongPosterInvalidData):
            validate_and_normalize(values)

    def test_missing_artist_rejected(self):
        values = {**VALID_VALUES, "artist": ""}
        with self.assertRaises(SongPosterInvalidData):
            validate_and_normalize(values)

    def test_missing_photo_rejected(self):
        values = {**VALID_VALUES, "photo": None}
        with self.assertRaises(SongPosterInvalidData):
            validate_and_normalize(values)

    def test_dedication_is_optional(self):
        values = {**VALID_VALUES, "dedication": ""}
        song = validate_and_normalize(values)
        self.assertEqual(song.dedication, "")

    def test_dedication_over_length_rejected(self):
        values = {**VALID_VALUES, "dedication": "x" * 181}
        with self.assertRaises(SongPosterInvalidData):
            validate_and_normalize(values)

    def test_missing_youtube_url_rejected(self):
        values = {**VALID_VALUES, "youtubeUrl": ""}
        with self.assertRaises(SongPosterInvalidData):
            validate_and_normalize(values)

    def test_unconfirmed_youtube_link_rejected(self):
        """A `youtubeUrl` with no matching `youtubeVideoId` — the
        customer pasted a link but `YouTubeValidateView` was never
        actually called (or was, and rejected it). Must fail here, not
        render with no video at all."""
        values = {**VALID_VALUES, "youtubeVideoId": None}
        with self.assertRaises(SongPosterInvalidData):
            validate_and_normalize(values)

    def test_edited_link_since_confirmation_rejected(self):
        """The customer validated one link, then edited the text field
        afterward — `youtubeVideoId` still holds the OLD confirmation,
        which no longer matches what the current URL text parses to.
        `extract_video_id` re-parsing the URL is what catches this."""
        values = {
            **VALID_VALUES,
            "youtubeUrl": "https://www.youtube.com/watch?v=differentId",
            # youtubeVideoId still "dQw4w9WgXcQ" — stale.
        }
        with self.assertRaises(SongPosterInvalidData):
            validate_and_normalize(values)

    def test_not_a_dict_rejected(self):
        with self.assertRaises(SongPosterInvalidData):
            validate_and_normalize(["not", "a", "dict"])

    def test_track_over_length_rejected(self):
        values = {**VALID_VALUES, "track": "x" * 61}
        with self.assertRaises(SongPosterInvalidData):
            validate_and_normalize(values)

    def test_theme_selection_is_read_and_normalized(self):
        song = validate_and_normalize(VALID_VALUES, {"theme": "player"})
        self.assertEqual(song.theme, "player")

    def test_unrecognised_theme_falls_back_to_default(self):
        """Matches the frontend's own `getSongPosterTheme(undefined)`
        fallback — a project saved before the theme axis existed, or
        one referencing a since-removed theme id, must still render as
        Player rather than fail outright."""
        song = validate_and_normalize(VALID_VALUES, {"theme": "not-a-real-theme"})
        self.assertEqual(song.theme, "player")

    def test_missing_theme_selections_falls_back_to_default(self):
        song = validate_and_normalize(VALID_VALUES, None)
        self.assertEqual(song.theme, "player")


# ------------------------------------------------------------------
# PNG rendering
# ------------------------------------------------------------------

class PngRenderingTests(TestCase):
    def test_print_target_renders(self):
        customer = make_customer()
        values = values_with_real_photo(customer)
        song = validate_and_normalize(values)

        content = render_png(song, target_id="print-classic-frameless", customer=customer)

        self.assertGreater(len(content), 0)
        with Image.open(io.BytesIO(content)) as img:
            self.assertEqual(img.size, (2400, 3000))

    def test_edged_print_is_smaller_content_than_frameless(self):
        """Not a pixel-identical assertion (the two ARE meant to differ —
        edged insets by the safe margin) — just proves the edged
        variant is a genuinely distinct render, not the frameless
        bytes with a different filename."""
        customer = make_customer()
        values = values_with_real_photo(customer)
        song = validate_and_normalize(values)

        frameless = render_png(song, target_id="print-classic-frameless", customer=customer)
        edged = render_png(song, target_id="print-classic-edged", customer=customer)

        self.assertNotEqual(frameless, edged)

    def test_wallpaper_target_renders_at_device_dimensions(self):
        customer = make_customer()
        values = values_with_real_photo(customer)
        song = validate_and_normalize(values)

        content = render_png(song, target_id="wallpaper-phone", customer=customer)

        with Image.open(io.BytesIO(content)) as img:
            self.assertEqual(img.size, (1290, 2796))

    def test_unsupported_target_raises(self):
        customer = make_customer()
        values = values_with_real_photo(customer)
        song = validate_and_normalize(values)

        with self.assertRaises(SongPosterRenderFailed):
            render_png(song, target_id="not-a-real-target", customer=customer)

    def test_photo_belonging_to_another_customer_fails(self):
        """The same ownership boundary Love Story Timeline's own
        `SecurityTests` proves — `get_asset_bytes_for_customer` is
        called with THIS render's customer, not whoever originally
        owned the asset id in a malformed/stale `values` payload."""
        owner = make_customer()
        stranger = make_customer()
        values = values_with_real_photo(owner)
        song = validate_and_normalize(values)

        with self.assertRaises(SongPosterRenderFailed):
            render_png(song, target_id="print-classic-frameless", customer=stranger)

    def test_ledger_theme_renders(self):
        """Proves the theme DISPATCH, not just Player's own path — a
        real risk this test exists specifically to catch: a second
        theme registered but never actually reached because
        `render_png` kept calling `_draw_player` by name somewhere."""
        customer = make_customer()
        values = values_with_real_photo(customer, {**VALID_VALUES, "youtubeVideoId": "dQw4w9WgXcQ"})
        song = validate_and_normalize(values, {"theme": "ledger"})
        self.assertEqual(song.theme, "ledger")

        content = render_png(song, target_id="print-classic-frameless", customer=customer)
        self.assertGreater(len(content), 0)

    def test_ledger_and_player_produce_different_bytes(self):
        """The two themes must actually look different — a regression
        here would mean the dispatch resolved but both paths silently
        called the same drawing function."""
        customer = make_customer()
        values = values_with_real_photo(customer)
        player_song = validate_and_normalize(values, {"theme": "player"})
        ledger_song = validate_and_normalize(values, {"theme": "ledger"})

        player_bytes = render_png(player_song, target_id="print-classic-frameless", customer=customer)
        ledger_bytes = render_png(ledger_song, target_id="print-classic-frameless", customer=customer)

        self.assertNotEqual(player_bytes, ledger_bytes)

    def test_every_registered_drawing_theme_is_also_a_valid_selection(self):
        """The EXACT bug found while building Ephemeris: `png_renderer.
        py`'s `_THEME_RENDERERS` gained an entry before `data.py`'s
        `THEMES` whitelist did, so `validate_and_normalize` was
        silently rejecting a real customer's theme choice and falling
        back to Player — the drawing dispatch was correct throughout;
        the gate in front of it was not. This test exists specifically
        so the same class of bug fails loudly the next time a theme is
        registered in one place and not the other.
        """
        from .png_renderer import _THEME_RENDERERS

        for theme_id in _THEME_RENDERERS:
            with self.subTest(theme=theme_id):
                self.assertIn(theme_id, THEMES)

    def test_ephemeris_theme_renders(self):
        customer = make_customer()
        values = values_with_real_photo(customer)
        song = validate_and_normalize(values, {"theme": "ephemeris"})
        self.assertEqual(song.theme, "ephemeris")

        content = render_png(song, target_id="print-classic-frameless", customer=customer)
        self.assertGreater(len(content), 0)

    def test_ephemeris_produces_different_bytes_from_the_other_two(self):
        customer = make_customer()
        values = values_with_real_photo(customer)
        ledger_bytes = render_png(
            validate_and_normalize(values, {"theme": "ledger"}), target_id="print-classic-frameless", customer=customer
        )
        ephemeris_bytes = render_png(
            validate_and_normalize(values, {"theme": "ephemeris"}), target_id="print-classic-frameless", customer=customer
        )
        self.assertNotEqual(ledger_bytes, ephemeris_bytes)

    def test_contact_sheet_theme_renders(self):
        customer = make_customer()
        values = values_with_real_photo(customer)
        song = validate_and_normalize(values, {"theme": "contactsheet"})
        self.assertEqual(song.theme, "contactsheet")

        content = render_png(song, target_id="print-classic-frameless", customer=customer)
        self.assertGreater(len(content), 0)

    def test_contact_sheet_produces_different_bytes_from_the_others(self):
        customer = make_customer()
        values = values_with_real_photo(customer)
        contactsheet_bytes = render_png(
            validate_and_normalize(values, {"theme": "contactsheet"}), target_id="print-classic-frameless", customer=customer
        )
        player_bytes = render_png(
            validate_and_normalize(values, {"theme": "player"}), target_id="print-classic-frameless", customer=customer
        )
        self.assertNotEqual(contactsheet_bytes, player_bytes)

    def test_label_theme_renders(self):
        customer = make_customer()
        values = values_with_real_photo(customer)
        song = validate_and_normalize(values, {"theme": "label"})
        self.assertEqual(song.theme, "label")

        content = render_png(song, target_id="print-classic-frameless", customer=customer)
        self.assertGreater(len(content), 0)

    def test_label_produces_different_bytes_from_the_others(self):
        customer = make_customer()
        values = values_with_real_photo(customer)
        label_bytes = render_png(
            validate_and_normalize(values, {"theme": "label"}), target_id="print-classic-frameless", customer=customer
        )
        ledger_bytes = render_png(
            validate_and_normalize(values, {"theme": "ledger"}), target_id="print-classic-frameless", customer=customer
        )
        self.assertNotEqual(label_bytes, ledger_bytes)

    def test_award_theme_renders_at_its_own_landscape_dimensions(self):
        """Award has no portrait composition at all — `ratios:
        ['landscape']` in the prototype's own registry — so this uses
        the theme's own `design_w`/`design_h` (1200x800) directly,
        exercising `_draw_award` in isolation rather than through
        `render_png`'s target-dimension resolution (that path is
        proven separately, by `test_landscape_themes_swap_a_nominally_
        portrait_print_target` below).

        UPDATED FROM THIS TEST'S ORIGINAL VERSION: it used to say Award
        "is not purchasable and printable correctly" — true when this
        test was first written, no longer true. `render_png` now swaps
        a print target's dimensions to landscape when the selected
        theme's own design canvas is landscape, so the SAME
        `print-classic-frameless` a Player customer buys now produces
        a genuinely landscape file for Award. See that test for the
        proof.

        WHAT REMAINS GENUINELY OPEN: the Studio's export panel
        (`export-section.tsx`) still LABELS every print target's
        dimensions from a static, theme-unaware list — so while the
        delivered FILE is now correct, the panel a customer sees while
        composing may still show portrait numbers for a theme that
        will actually deliver landscape. Fixing that needs
        `ExportEngineConfig` (or how the panel reads it) to become
        theme-selection-aware, a real Shell-level type change, not
        something to fold into this backend fix.
        """
        from .png_renderer import AWARD_DESIGN_H, AWARD_DESIGN_W

        customer = make_customer()
        values = values_with_real_photo(customer)
        song = validate_and_normalize(values, {"theme": "award"})
        self.assertEqual(song.theme, "award")

        from .png_renderer import _draw_award

        canvas = Image.new("RGB", (AWARD_DESIGN_W, AWARD_DESIGN_H), "#f1ede3")
        _draw_award(canvas, song, scale=1.0, origin=(0, 0), customer=customer)
        self.assertEqual(canvas.size, (AWARD_DESIGN_W, AWARD_DESIGN_H))

    def test_sleeve_theme_renders_at_its_own_landscape_dimensions(self):
        """Same shape as the Award test above, including the same
        correction: see that test's docstring for what changed and
        what remains genuinely open (the export panel's display, not
        the delivered file).
        """
        from .png_renderer import SLEEVE_DESIGN_H, SLEEVE_DESIGN_W, _draw_sleeve

        customer = make_customer()
        values = values_with_real_photo(customer)
        song = validate_and_normalize(values, {"theme": "sleeve"})
        self.assertEqual(song.theme, "sleeve")

        canvas = Image.new("RGB", (SLEEVE_DESIGN_W, SLEEVE_DESIGN_H), "#f1ece2")
        _draw_sleeve(canvas, song, scale=1.0, origin=(0, 0), customer=customer)
        self.assertEqual(canvas.size, (SLEEVE_DESIGN_W, SLEEVE_DESIGN_H))

    def test_sleeve_ring_text_falls_back_to_a_dot_when_no_dedication(self):
        """`_ring_text`'s own fallback ('· ' repeated) when there is
        nothing to ring the disc with — proves the same "always
        something to draw" guarantee the frontend's `ringText` already
        has, on the Python side too."""
        from .png_renderer import _ring_text

        text = _ring_text("", circumference=2 * 3.14159 * 130)
        self.assertTrue(text)
        self.assertTrue(set(text.replace(" ", "")) <= {"·"})

    def test_sleeve_palette_selection_reaches_the_rendered_pixels(self):
        """The fix for a real gap: an earlier version of `_draw_sleeve`
        hardcoded Cream regardless of `themeSelections.sleevePalette`
        — the frontend preview could show any of six colours, but the
        delivered file was always Cream. Checks the literal corner
        pixel of the rendered PNG against each palette's own `bg` hex
        value, not just that rendering succeeds without error.
        """
        from .png_renderer import SLEEVE_PALETTES

        customer = make_customer()
        values = values_with_real_photo(customer)

        for palette_id in ("cream", "red", "black"):
            with self.subTest(palette=palette_id):
                song = validate_and_normalize(values, {"theme": "sleeve", "sleevePalette": palette_id})
                self.assertEqual(song.sleeve_palette, palette_id)

                content = render_png(song, target_id="print-classic-frameless", customer=customer)
                with Image.open(io.BytesIO(content)) as img:
                    corner = img.getpixel((10, 10))
                    expected_hex = SLEEVE_PALETTES[palette_id]["bg"].lstrip("#")
                    expected_rgb = tuple(int(expected_hex[i : i + 2], 16) for i in (0, 2, 4))
                    self.assertEqual(corner, expected_rgb)

    def test_unrecognised_sleeve_palette_falls_back_to_cream(self):
        customer = make_customer()
        values = values_with_real_photo(customer)
        song = validate_and_normalize(values, {"theme": "sleeve", "sleevePalette": "not-a-real-palette"})
        self.assertEqual(song.sleeve_palette, "cream")

    def test_sleeve_palette_ids_stay_in_sync_with_the_renderer(self):
        """Same class of guard as `test_every_registered_drawing_theme_
        is_also_a_valid_selection` — this time between `data.py`'s
        `SLEEVE_PALETTES` id tuple and `png_renderer.py`'s own
        `SLEEVE_PALETTES` colour dict, which are two independently
        maintained lists for the same reason `THEMES`/`_THEME_
        RENDERERS` are."""
        from .data import SLEEVE_PALETTES as VALID_PALETTE_IDS
        from .png_renderer import SLEEVE_PALETTES as PALETTE_COLOURS

        self.assertEqual(set(VALID_PALETTE_IDS), set(PALETTE_COLOURS))

    def test_mosaic_theme_renders(self):
        customer = make_customer()
        values = values_with_real_photo(customer)
        song = validate_and_normalize(values, {"theme": "mosaic"})
        self.assertEqual(song.theme, "mosaic")

        content = render_png(song, target_id="print-classic-frameless", customer=customer)
        self.assertGreater(len(content), 0)

    def test_mosaic_card_height_grows_with_a_long_dedication(self):
        """`_mosaic_card_height` is a dry run used to vertically centre
        the floating card BEFORE anything is drawn — this proves it
        actually varies with real content rather than returning a
        fixed guess, which would silently mis-centre the card whenever
        a dedication is unusually long or absent."""
        from PIL import ImageDraw

        from .png_renderer import _font, _mosaic_card_height

        customer = make_customer()
        song_short = validate_and_normalize(
            values_with_real_photo(customer, {**VALID_VALUES, "dedication": ""}), {"theme": "mosaic"}
        )
        song_long = validate_and_normalize(
            values_with_real_photo(customer, {**VALID_VALUES, "dedication": "A " * 80}), {"theme": "mosaic"}
        )

        from .png_renderer import _dedication_lines

        canvas = Image.new("RGB", (10, 10))
        draw = ImageDraw.Draw(canvas)

        def height(song, scale):
            fonts = dict(
                title_font=_font("DejaVuSans-Bold.ttf", 26, scale),
                artist_font=_font("DejaVuSans.ttf", 14.5, scale),
                dedication_font=_font("DejaVuSans.ttf", 16, scale),
                times_font=_font("DejaVuSansMono.ttf", 13, scale),
                foot_font=_font("DejaVuSans.ttf", 13, scale),
            )
            lines, line_height = _dedication_lines(draw, song, "mosaic", fonts["dedication_font"], scale) if song.dedication else ([], 0.0)
            return _mosaic_card_height(
                draw, song, scale=scale, title_text=song.track, artist_text=song.artist.upper(), artist_drop=0.0,
                foot_artist=song.artist.upper(), dedication_lines=lines, dedication_line_height=line_height, **fonts
            )

        self.assertGreater(height(song_long, 1.0), height(song_short, 1.0))
        # In DESIGN units, whatever the print scale: it used to mix units, so
        # at 3x the card came out shorter than its own 340-unit photo.
        for song in (song_short, song_long):
            self.assertGreater(height(song, 3.0), 340)
            self.assertAlmostEqual(height(song, 3.0), height(song, 1.0), delta=6)

    def test_all_eight_themes_render_without_error(self):
        """One pass over every registered theme, through the SAME
        `render_png(..., target_id="print-classic-frameless", ...)`
        call for all eight — no special-casing needed for Award or
        Sleeve since `test_landscape_themes_swap_a_nominally_portrait_
        print_target` below confirmed `render_png` now resolves their
        correct landscape dimensions itself. The final, cumulative
        guard for this entire module: if any theme's composition
        throws, or if `THEMES`/`_THEME_RENDERERS` ever drift apart
        again the way they did for Ledger, this is where it surfaces.
        """
        from .png_renderer import _THEME_RENDERERS

        customer = make_customer()
        values = values_with_real_photo(customer)
        self.assertEqual(set(THEMES), set(_THEME_RENDERERS))

        for theme_id in THEMES:
            with self.subTest(theme=theme_id):
                song = validate_and_normalize(values, {"theme": theme_id})
                content = render_png(song, target_id="print-classic-frameless", customer=customer)
                self.assertGreater(len(content), 0)

    def test_landscape_themes_swap_a_nominally_portrait_print_target(self):
        """The fix for the gap `test_award_theme_renders_at_its_own_
        landscape_dimensions` and `test_sleeve_theme_renders_at_its_
        own_landscape_dimensions` originally flagged as unresolved —
        NOT a full fix (the Studio's export panel can still LABEL the
        dimensions as portrait for these two themes; that needs the
        Shell-level change those tests' docstrings describe), but the
        part that matters most: requesting the SAME `print-classic-
        frameless` target a Player customer would buy now produces a
        genuinely landscape file for Award or Sleeve, at the swapped
        dimensions, rather than a portrait canvas holding a landscape
        composition badly cropped or letterboxed into it.
        """
        customer = make_customer()
        values = values_with_real_photo(customer)

        portrait_song = validate_and_normalize(values, {"theme": "player"})
        portrait_content = render_png(portrait_song, target_id="print-classic-frameless", customer=customer)
        with Image.open(io.BytesIO(portrait_content)) as img:
            self.assertEqual(img.size, (2400, 3000))

        for theme_id in ("award", "sleeve"):
            with self.subTest(theme=theme_id):
                song = validate_and_normalize(values, {"theme": theme_id})
                content = render_png(song, target_id="print-classic-frameless", customer=customer)
                with Image.open(io.BytesIO(content)) as img:
                    # Same nominal target, same two numbers — swapped.
                    self.assertEqual(img.size, (3000, 2400))
                    self.assertGreater(img.width, img.height)


# ------------------------------------------------------------------
# Renderer / registry
# ------------------------------------------------------------------

class PlayerBottomTests(TestCase):
    """Player's print used to end with a fake 5x5 "code" nothing could scan
    and the designer's placeholder "CODE POSITION — LINKS TO YOUR PAGE",
    which the Studio preview never showed (removed 18 Oct 2026). The
    dedication now sits where the preview puts it."""

    PRINTS = (
        "print-a4-frameless", "print-a4-edged", "print-classic-frameless",
        "print-classic-edged", "print-poster-frameless", "print-poster-edged",
    )

    def _texts_drawn(self, song, target, customer):
        from unittest.mock import patch

        from PIL import ImageDraw

        calls = []
        real_text = ImageDraw.ImageDraw.text

        def spy(draw, xy, text, *args, **kwargs):
            calls.append({"xy": xy, "text": text, "anchor": kwargs.get("anchor")})
            return real_text(draw, xy, text, *args, **kwargs)

        with patch.object(ImageDraw.ImageDraw, "text", spy):
            render_png(song, target_id=target, customer=customer)
        return calls

    def test_no_print_size_carries_the_placeholder(self):
        customer = make_customer()
        for dedication in ("For you, always.", ""):
            song = validate_and_normalize({**values_with_real_photo(customer), "dedication": dedication}, {"theme": "player"})
            for target in self.PRINTS:
                with self.subTest(target=target, dedication=bool(dedication)):
                    drawn = " ".join(call["text"] for call in self._texts_drawn(song, target, customer)).upper()
                    self.assertNotIn("CODE POSITION", drawn)
                    self.assertNotIn("LINKS TO YOUR PAGE", drawn)

    def test_nothing_is_drawn_where_the_fake_code_was(self):
        """The glyph sat centred at (400, 936) in the 800x1000 design, 32
        units square. With no dedication, that area is now plain paper."""
        from . import png_renderer

        customer = make_customer()
        song = validate_and_normalize({**values_with_real_photo(customer), "dedication": ""}, {"theme": "player"})
        with Image.open(io.BytesIO(render_png(song, target_id="print-classic-frameless", customer=customer))) as img:
            rgb = img.convert("RGB")
            scale = 3  # 2400x3000 is exactly 3x the 800x1000 design
            box = (round((400 - 30) * scale), round((936 - 30) * scale), round((400 + 30) * scale), round((960 + 4) * scale))
            colours = set(rgb.crop(box).getdata())
        self.assertEqual(colours, {Image.new("RGB", (1, 1), png_renderer._BG).getpixel((0, 0))})

    def test_the_dedication_sits_where_the_preview_puts_it(self):
        from . import png_renderer

        # `.bottom{bottom:32px}` + `.message{margin-bottom:20px}`: the line box
        # ends 52 above the sheet's bottom, and is 13.5 x 1.5 tall; the text is
        # centred in it, as CSS centres it.
        self.assertAlmostEqual(png_renderer.player_message_centre_y(), 1000 - 32 - 20 - 13.5 * 1.5 / 2)

        customer = make_customer()
        song = validate_and_normalize({**values_with_real_photo(customer), "dedication": "For you, always."}, {"theme": "player"})
        for target, scale, origin in (("print-classic-frameless", 3.0, (0, 0)),):
            calls = self._texts_drawn(song, target, customer)
            [dedication] = [call for call in calls if call["text"] == "For you, always."]
            self.assertEqual(dedication["anchor"], "mm")
            self.assertEqual(
                dedication["xy"],
                (round(origin[0] + 400 * scale), round(origin[1] + png_renderer.player_message_centre_y() * scale)),
            )

    def test_the_wallpapers_never_had_it_and_are_unchanged_in_shape(self):
        customer = make_customer()
        song = validate_and_normalize(values_with_real_photo(customer), {"theme": "player"})
        for target in ("wallpaper-phone", "wallpaper-tablet", "wallpaper-desktop"):
            with self.subTest(target=target):
                drawn = " ".join(call["text"] for call in self._texts_drawn(song, target, customer)).upper()
                self.assertNotIn("CODE POSITION", drawn)


class FramelessFitTests(TestCase):
    """Frameless prints FIT the design, never cut it (18 Oct 2026). They used
    `max`, which filled the page and cut whatever overflowed whenever the
    paper's shape differs from the design's: Award's header printed as
    "ARDED FOR ONE RECORDING" on 8x10, every portrait theme lost 66.7 design
    units each side on the 12x18 poster."""

    FRAMELESS = ("print-a4-frameless", "print-classic-frameless", "print-poster-frameless")
    TEXTS = {
        "realistic": {"track": "Here Comes the Sun", "artist": "The Beatles", "dedication": "For the summer we drove to the sea."},
        "max": {
            "track": "The Long and Winding Road That Leads Me Back to Your Door Ag",
            "artist": "Sir Paul McCartney and the Royal Liverpool Philharmonic Orch",
            "dedication": "x " * 90,
        },
    }

    def _selections(self, theme):
        # Sleeve with a non-default palette: its spare paper must be the palette's.
        return {"theme": theme, "sleevePalette": "black"} if theme == "sleeve" else {"theme": theme}

    def _background(self, theme):
        from . import png_renderer

        bg = png_renderer.SLEEVE_PALETTES["black"]["bg"] if theme == "sleeve" else png_renderer._THEME_RENDERERS[theme]["bg"]
        return Image.new("RGB", (1, 1), bg).getpixel((0, 0))

    def test_no_design_content_touches_a_page_edge(self):
        customer = make_customer()
        photo = values_with_real_photo(customer)["photo"]
        for theme in THEMES:
            bg = self._background(theme)
            for case, text in self.TEXTS.items():
                song = validate_and_normalize({**VALID_VALUES, **text, "photo": photo}, self._selections(theme))
                for target in self.FRAMELESS:
                    with self.subTest(theme=theme, target=target, text=case):
                        with Image.open(io.BytesIO(render_png(song, target_id=target, customer=customer))) as img:
                            rgb = img.convert("RGB")
                            w, h = rgb.size
                            edges = [rgb.crop(box) for box in ((0, 0, w, 2), (0, h - 2, w, h), (0, 0, 2, h), (w - 2, 0, w, h))]
                            inked = sum(
                                1
                                for strip in edges
                                for px in strip.getdata()
                                if max(abs(a - b) for a, b in zip(px, bg)) > 40
                            )
                        self.assertEqual(inked, 0, f"{inked} pixels of design touch the page edge")

    def test_the_whole_composition_is_drawn_centred_on_the_page(self):
        from unittest.mock import patch

        from apps.delivery.print_sizes import print_target_dimensions

        from . import png_renderer

        customer = make_customer()
        photo = values_with_real_photo(customer)["photo"]
        for theme in THEMES:
            renderers = png_renderer._THEME_RENDERERS[theme]
            design_w = renderers.get("design_w", png_renderer.DESIGN_W)
            design_h = renderers.get("design_h", png_renderer.DESIGN_H)
            seen = []
            real = renderers["poster"]

            def record(canvas, song, *, scale, origin, customer, _real=real, _seen=seen):
                _seen.append((canvas.size, scale, origin))
                return _real(canvas, song, scale=scale, origin=origin, customer=customer)

            song = validate_and_normalize({**VALID_VALUES, "photo": photo}, self._selections(theme))
            with patch.dict(renderers, {"poster": record}):
                for target in self.FRAMELESS:
                    render_png(song, target_id=target, customer=customer)
            for target, ((width, height), scale, (ox, oy)) in zip(self.FRAMELESS, seen):
                with self.subTest(theme=theme, target=target):
                    page_w, page_h = print_target_dimensions()[target]
                    if design_w > design_h:
                        page_w, page_h = page_h, page_w
                    self.assertEqual((width, height), (page_w, page_h))
                    drawn_w, drawn_h = design_w * scale, design_h * scale
                    # Whole: fits both ways, and fills one of them.
                    self.assertLessEqual(drawn_w, width + 1e-6)
                    self.assertLessEqual(drawn_h, height + 1e-6)
                    self.assertTrue(abs(drawn_w - width) < 1e-6 or abs(drawn_h - height) < 1e-6)
                    # Centred: equal spare paper on opposite sides.
                    self.assertAlmostEqual(ox, (width - drawn_w) / 2)
                    self.assertAlmostEqual(oy, (height - drawn_h) / 2)


class _DrawRecorder:
    """Records every text, line and rectangle a render draws, with each
    text's real box (`textbbox` with the same arguments)."""

    def __init__(self):
        self.texts, self.lines, self.rects = [], [], []

    def __enter__(self):
        from unittest.mock import patch

        from PIL import ImageDraw

        real_text, real_line, real_rect = ImageDraw.ImageDraw.text, ImageDraw.ImageDraw.line, ImageDraw.ImageDraw.rectangle
        recorder = self

        def text(draw, xy, text, *args, **kwargs):
            font, anchor = kwargs.get("font"), kwargs.get("anchor")
            box = draw.textbbox(xy, text, font=font, anchor=anchor) if text else None
            recorder.texts.append({"text": text, "box": box, "xy": tuple(xy), "size": getattr(font, "size", None), "font": getattr(font, "path", ""), "font_obj": font})
            return real_text(draw, xy, text, *args, **kwargs)

        def line(draw, xy, *args, **kwargs):
            pts = [tuple(p) for p in xy] if not isinstance(xy[0], (int, float)) else [tuple(xy[:2]), tuple(xy[2:4])]
            w = (kwargs.get("width") or 1) / 2
            recorder.lines.append((min(p[0] for p in pts) - w, min(p[1] for p in pts) - w, max(p[0] for p in pts) + w, max(p[1] for p in pts) + w))
            return real_line(draw, xy, *args, **kwargs)

        def rectangle(draw, xy, *args, **kwargs):
            flat = [c for p in xy for c in (p if isinstance(p, tuple) else (p,))] if not isinstance(xy[0], (int, float)) else list(xy)
            recorder.rects.append({"box": (min(flat[0], flat[2]), min(flat[1], flat[3]), max(flat[0], flat[2]), max(flat[1], flat[3])), "fill": kwargs.get("fill")})
            return real_rect(draw, xy, *args, **kwargs)

        self._patches = [patch.object(ImageDraw.ImageDraw, "text", text), patch.object(ImageDraw.ImageDraw, "line", line),
                         patch.object(ImageDraw.ImageDraw, "rectangle", rectangle)]
        for active in self._patches:
            active.start()
        return self

    def __exit__(self, *exc):
        for active in self._patches:
            active.stop()


def _intersects(a, b) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _inside(a, b) -> bool:
    return b[0] <= a[0] and b[1] <= a[1] and a[2] <= b[2] and a[3] <= b[3]


class DedicationWrapTests(TestCase):
    """Every preview WRAPS the dedication in full; the print used to cut it
    to one line with "…" (fixed 18 Oct 2026). The print wraps it at the
    preview's width, size and line height (`DEDICATION_LAYOUT`), and each
    theme puts the extra lines where its preview does."""

    THEMES_WITH_DEDICATION = ("player", "ledger", "ephemeris", "contactsheet", "label", "award", "mosaic")
    TEXTS = {
        "realistic": "For the summer we drove to the sea with the windows down.",
        "max": (
            "For the summer we drove to the sea with the windows down and this song on repeat, and every "
            "summer since; you sang the wrong words every time and I never once corrected you, love x"
        )[:180],
        "one long word": "x" * 180,
        "arabic max": ("إلى رفيقة دربي، هذه الأغنية كانت معنا في كل رحلة، وفي كل صيف منذ ذلك الحين؛ " * 3)[:180].strip(),
    }

    def _render(self, theme, dedication, customer, photo, target="print-classic-frameless"):
        song = validate_and_normalize({**VALID_VALUES, "photo": photo, "dedication": dedication}, {"theme": theme})
        with _DrawRecorder() as drawn:
            content = render_png(song, target_id=target, customer=customer)
        with Image.open(io.BytesIO(content)) as img:
            page = (0, 0, *img.size)
        return drawn, page

    def _dedication_run(self, drawn, dedication):
        """The consecutive text calls that spell the whole dedication."""
        wanted = " ".join(dedication.split())
        texts = [t["text"] for t in drawn.texts]
        for start in range(len(texts)):
            for end in range(start + 1, len(texts) + 1):
                joined = " ".join(texts[start:end]) if " " in wanted else "".join(texts[start:end])
                if joined == wanted:
                    return drawn.texts[start:end]
                if len(joined) > len(wanted):
                    break
        return None

    def test_the_whole_dedication_is_printed_and_nothing_overlaps_or_leaves_the_page(self):
        customer = make_customer()
        photo = values_with_real_photo(customer)["photo"]
        for theme in self.THEMES_WITH_DEDICATION:
            for case, dedication in self.TEXTS.items():
                with self.subTest(theme=theme, text=case):
                    drawn, page = self._render(theme, dedication, customer, photo)
                    run = self._dedication_run(drawn, dedication)
                    self.assertIsNotNone(run, f"the dedication is not printed whole: {[t['text'] for t in drawn.texts]}")
                    self.assertFalse(any("…" in t["text"] for t in run))
                    others = [t for t in drawn.texts if t not in run and t["box"]]
                    for line in run:
                        box = line["box"]
                        self.assertTrue(_inside(box, page), f"{line['text']!r} leaves the page")
                        for other in others:
                            self.assertFalse(_intersects(box, other["box"]), f"{line['text']!r} overlaps {other['text']!r}")
                        for rule in drawn.lines:
                            self.assertFalse(_intersects(box, rule), f"{line['text']!r} crosses a rule")
                        for rect in drawn.rects:
                            if rect["box"][2] - rect["box"][0] >= page[2] - 1:
                                continue  # a full-width background
                            self.assertTrue(
                                _inside(box, rect["box"]) or not _intersects(box, rect["box"]),
                                f"{line['text']!r} crosses the border of a box",
                            )

    def test_lines_are_spaced_by_the_previews_line_height(self):
        from . import png_renderer

        customer = make_customer()
        photo = values_with_real_photo(customer)["photo"]
        for theme in self.THEMES_WITH_DEDICATION:
            with self.subTest(theme=theme):
                drawn, _ = self._render(theme, self.TEXTS["max"], customer, photo)
                run = self._dedication_run(drawn, self.TEXTS["max"])
                self.assertGreaterEqual(len(run), 2)
                _, size, line_height, _file = png_renderer.DEDICATION_LAYOUT[theme]
                renderers = png_renderer._THEME_RENDERERS[theme]
                design_w = renderers.get("design_w", png_renderer.DESIGN_W)
                design_h = renderers.get("design_h", png_renderer.DESIGN_H)
                page_w, page_h = (3000, 2400) if design_w > design_h else (2400, 3000)
                scale = min(page_w / design_w, page_h / design_h)
                step = size * line_height * scale
                anchors = [line["xy"][1] for line in run]
                for upper, lower in zip(anchors, anchors[1:]):
                    self.assertAlmostEqual(lower - upper, step, delta=1)  # pt() rounds to whole pixels

    def test_player_grows_upward_from_its_last_line(self):
        customer = make_customer()
        photo = values_with_real_photo(customer)["photo"]
        one, _ = self._render("player", self.TEXTS["realistic"], customer, photo)
        many, _ = self._render("player", self.TEXTS["max"], customer, photo)
        last_one = self._dedication_run(one, self.TEXTS["realistic"])[-1]["xy"]
        last_many = self._dedication_run(many, self.TEXTS["max"])[-1]["xy"]
        self.assertEqual(last_one, last_many)  # the last line keeps its place; the others stack above it

    def test_awards_plaque_grows_upward_and_mosaics_card_holds_every_line(self):
        customer = make_customer()
        photo = values_with_real_photo(customer)["photo"]
        for theme, fill in (("award", "#8c6a34"), ("mosaic", "#0e0f10")):
            with self.subTest(theme=theme):
                short, _ = self._render(theme, self.TEXTS["realistic"], customer, photo)
                long, _ = self._render(theme, self.TEXTS["max"], customer, photo)
                [short_box] = [r["box"] for r in short.rects if r["fill"] == fill]
                [long_box] = [r["box"] for r in long.rects if r["fill"] == fill]
                self.assertGreater(long_box[3] - long_box[1], short_box[3] - short_box[1])
                if theme == "award":
                    self.assertEqual(long_box[3], short_box[3])  # anchored at the bottom
                for line in self._dedication_run(long, self.TEXTS["max"]):
                    self.assertTrue(_inside(line["box"], long_box))
                # ...and so does everything below the dedication: the plaque's or
                # card's own footer must not be pushed out of it by the extra lines.
                [footer] = [t for t in long.texts if t["text"].endswith("HEARTFOLIO")]
                self.assertTrue(_inside(footer["box"], long_box), f"{footer['text']!r} is pushed out of the {theme} box")

    def test_mosaics_card_holds_all_its_text(self):
        """The card's height used to mix design units with pixel heights, so at
        3x it came out shorter than its own photo and the text ran off it."""
        customer = make_customer()
        photo = values_with_real_photo(customer)["photo"]
        for case, dedication in (("none", ""), *self.TEXTS.items()):
            with self.subTest(text=case):
                drawn, _ = self._render("mosaic", dedication, customer, photo)
                [card] = [r["box"] for r in drawn.rects if r["fill"] == "#0e0f10"]
                # Everything on the card; the page's own attribution mark sits at
                # the page's corner by design (`_draw_attribution`).
                card_texts = [t for t in drawn.texts if t["box"] and t["box"][1] >= card[1] and t["text"] != "theheartfolio.com"]
                self.assertTrue(card_texts)
                for text in card_texts:
                    self.assertTrue(_inside(text["box"], card), f"{text['text']!r} runs off the card")


ARABIC_TITLE = "أحبك أكثر من أي شيء"
ARABIC_ARTIST = "ماجد المهندس"
ARABIC_DEDICATION = "إلى رفيقة دربي، هذه الأغنية كانت معنا في كل رحلة."


def _arabic(text) -> bool:
    from . import png_renderer

    return any(low <= ord(ch) <= high for ch in text for low, high in png_renderer._ARABIC_RANGES)


def _ink(face, text) -> int:
    """Total coverage of `text` drawn in `face`: heavier weights draw more."""
    mask = face.getmask(text)
    return sum(Image.Image()._new(mask).getdata())


class PrintFontTests(TestCase):
    """The print's font folder holds what the themes ask for (18 Oct 2026).
    Arabic printed as empty boxes in Ephemeris and Player (DejaVu Serif has no
    Arabic glyphs), and four themes printed their italic dedications upright
    because the code asked for files DejaVu never shipped and silently fell
    back. Arabic is now drawn in the preview's own Noto Kufi/Naskh files,
    character by character as the browser picks faces."""

    def test_every_font_the_renderer_names_is_in_the_font_folder(self):
        """A missing font must fail here, never fall back to another face."""
        import re
        from pathlib import Path

        from . import png_renderer

        source = Path(png_renderer.__file__).read_text(encoding="utf-8")
        named = set(re.findall(r'"([\w-]+\.(?:ttf|otf|woff2?))"', source))
        self.assertGreaterEqual(len(named), 8)
        for name in sorted(named):
            with self.subTest(font=name):
                self.assertTrue((png_renderer._FONT_DIR / name).is_file(), f"{name} is not in {png_renderer._FONT_DIR}")
        self.assertNotIn(".exists()", source, "a font must not silently fall back when its file is missing")

    def test_no_printed_character_falls_back_to_the_empty_box(self):
        """Every character of every text, not only the Arabic ones: the Noto
        files have no Latin-1, and Award's footer once lost its "·"."""
        from apps.delivery.mixed_script import has_glyph

        customer = make_customer()
        photo = values_with_real_photo(customer)["photo"]
        for theme in THEMES:
            for case, dedication in (("short", ARABIC_DEDICATION), ("max", DedicationWrapTests.TEXTS["arabic max"])):
                for target in ("print-classic-frameless", "wallpaper-phone"):
                    with self.subTest(theme=theme, dedication=case, target=target):
                        song = validate_and_normalize(
                            {**VALID_VALUES, "photo": photo, "track": ARABIC_TITLE, "artist": ARABIC_ARTIST, "dedication": dedication},
                            {"theme": theme},
                        )
                        with _DrawRecorder() as drawn:
                            render_png(song, target_id=target, customer=customer)
                        self.assertTrue(any(_arabic(t["text"]) for t in drawn.texts))
                        for text in drawn.texts:
                            font = text["font_obj"]
                            missing = sorted({
                                ch for ch in text["text"]
                                if not ch.isspace() and not has_glyph(font.face_for_char(ch) if hasattr(font, "face_for_char") else font, ch)
                            })
                            self.assertEqual(missing, [], f"{text['text']!r} draws empty boxes")

    def test_arabic_is_drawn_in_the_previews_face_for_its_slot_and_upright(self):
        """Serif slots in Noto Kufi Arabic, sans in Noto Naskh Arabic (the
        preview's files), mono in DejaVu Sans Mono, and never an oblique."""
        from . import png_renderer

        expected = {"serif": "Noto Kufi Arabic", "sans": "Noto Naskh Arabic", "mono": "DejaVu Sans Mono"}
        customer = make_customer()
        photo = values_with_real_photo(customer)["photo"]
        seen = set()
        for theme in THEMES:
            with self.subTest(theme=theme):
                song = validate_and_normalize(
                    {**VALID_VALUES, "photo": photo, "track": ARABIC_TITLE, "artist": ARABIC_ARTIST, "dedication": ARABIC_DEDICATION},
                    {"theme": theme},
                )
                with _DrawRecorder() as drawn:
                    render_png(song, target_id="print-classic-frameless", customer=customer)
                for text in drawn.texts:
                    font = text["font_obj"]
                    if not hasattr(font, "face_for_char") or not _arabic(text["text"]):
                        continue
                    kind = png_renderer._kind(text["font"].replace("\\", "/").rsplit("/", 1)[-1])
                    for ch in {ch for ch in text["text"] if _arabic(ch)}:
                        family, style = font.face_for_char(ch).getname()
                        self.assertEqual(family, expected[kind], f"{ch!r} in {text['text']!r} ({kind})")
                        self.assertNotIn("Oblique", style)
                        self.assertNotIn("Italic", style)
                    seen.add(kind)
        self.assertEqual(seen, {"serif", "sans", "mono"})  # every kind was exercised

    def test_awards_footer_keeps_its_separator_beside_an_arabic_artist(self):
        customer = make_customer()
        photo = values_with_real_photo(customer)["photo"]
        song = validate_and_normalize({**VALID_VALUES, "photo": photo, "artist": ARABIC_ARTIST}, {"theme": "award"})
        with _DrawRecorder() as drawn:
            render_png(song, target_id="print-classic-frameless", customer=customer)
        [footer] = [t for t in drawn.texts if t["text"].endswith("HEARTFOLIO")]
        runs = footer["font_obj"].runs(footer["text"])
        self.assertEqual("".join(run for run, _, _ in runs).count("·"), 1)
        [dot_face] = [face for run, face, _ in runs if "·" in run]
        self.assertIs(dot_face, footer["font_obj"])  # DejaVu, which has it

    def test_latin_text_keeps_dejavu(self):
        """Only Arabic changes face: Latin, a hyphenated title (U+2010 is in
        the CSS's Arabic range too) and digits stay DejaVu."""
        from . import png_renderer

        font = png_renderer._font("DejaVuSans-Bold.ttf", 40, 1, weight=800)
        for text in ("Here Comes the Sun", "Well\u2010known", "0:00", "Ne me quitte pas — 1959", "« déjà · vu »"):
            with self.subTest(text=text):
                self.assertTrue(all(font.face_for_char(ch) is font for ch in text))
        mixed = "Love " + ARABIC_ARTIST
        self.assertEqual({font.face_for_char(ch) is font for ch in mixed}, {True, False})

    def test_arabic_titles_are_drawn_at_their_css_weight(self):
        """800 draws as Naskh's heaviest (700); Ephemeris's 300 draws lighter
        than Kufi's regular."""
        from . import png_renderer

        for theme, (font_file, size, _lines, weight) in png_renderer.TITLE_LAYOUT.items():
            with self.subTest(theme=theme):
                titled = png_renderer._font(font_file, size, 3, weight=weight).second
                regular = png_renderer._font(font_file, size, 3, weight=400).second
                if weight > 400:
                    self.assertGreater(_ink(titled, ARABIC_TITLE), _ink(regular, ARABIC_TITLE) * 1.1)
                else:
                    self.assertLess(_ink(titled, ARABIC_TITLE), _ink(regular, ARABIC_TITLE) * 0.95)

    def test_arabic_layout_overlaps_nothing_and_stays_on_the_page(self):
        customer = make_customer()
        photo = values_with_real_photo(customer)["photo"]
        for theme in THEMES:
            for case, dedication in (("short", ARABIC_DEDICATION), ("max", DedicationWrapTests.TEXTS["arabic max"])):
                with self.subTest(theme=theme, dedication=case):
                    song = validate_and_normalize(
                        {**VALID_VALUES, "photo": photo, "track": ARABIC_TITLE, "artist": ARABIC_ARTIST, "dedication": dedication},
                        {"theme": theme},
                    )
                    with _DrawRecorder() as drawn:
                        content = render_png(song, target_id="print-classic-frameless", customer=customer)
                    with Image.open(io.BytesIO(content)) as img:
                        page = (0, 0, *img.size)
                    # Single letters are Sleeve's ring, drawn on tiles of their own.
                    texts = [t for t in drawn.texts if t["box"] and len(t["text"]) > 1]
                    for i, text in enumerate(texts):
                        self.assertTrue(_inside(text["box"], page), f"{text['text']!r} leaves the page")
                        for other in texts[i + 1:]:
                            self.assertFalse(_intersects(text["box"], other["box"]), f"{text['text']!r} overlaps {other['text']!r}")


class TitleFitTests(TestCase):
    """A title shrinks to fit, down to 80% of its design size, before it is
    cut with "…" (owner's decision, 18 Oct 2026); Sleeve's may use two
    lines, as its preview does."""

    TITLES = (
        "Here Comes the Sun",
        "Ne me quitte pas",
        "The Long and Winding Road",
        "The Long and Winding Road That Leads",
        "The Long and Winding Road That Leads Me Back to Your Door Ag",
        "أحبك أكثر من أي شيء",
    )

    def _fits(self, theme):
        """Every `_fit_title` call a render makes: its inputs and its answer."""
        from unittest.mock import patch

        from . import png_renderer

        calls = []
        real = png_renderer._fit_title

        def spy(draw, text, theme_id, scale, max_width):
            lines, font = real(draw, text, theme_id, scale, max_width)
            calls.append({"draw": draw, "text": text, "scale": scale, "max_width": max_width, "lines": lines, "font": font})
            return lines, font

        return patch.object(png_renderer, "_fit_title", spy), calls

    def test_a_title_is_cut_only_at_the_floor_and_never_when_it_fits_there(self):
        from . import png_renderer

        customer = make_customer()
        photo = values_with_real_photo(customer)["photo"]
        for theme in THEMES:
            font_file, size, max_lines, weight = png_renderer.TITLE_LAYOUT[theme]
            for title in self.TITLES:
                with self.subTest(theme=theme, title=title):
                    song = validate_and_normalize({**VALID_VALUES, "photo": photo, "track": title}, {"theme": theme})
                    patcher, calls = self._fits(theme)
                    with patcher, _DrawRecorder() as drawn:
                        render_png(song, target_id="print-classic-frameless", customer=customer)
                    [call] = calls
                    draw, scale, width, lines, font = call["draw"], call["scale"], call["max_width"], call["lines"], call["font"]
                    full = png_renderer._font(font_file, size, scale, weight=weight)
                    floor = png_renderer._font(font_file, size * png_renderer.TITLE_MIN_SCALE, scale, weight=weight)
                    self.assertLessEqual(len(lines), max_lines)
                    self.assertGreaterEqual(font.size, floor.size)
                    for line in lines:
                        self.assertLessEqual(draw.textlength(line, font=font), width)
                    drawn_texts = [t["text"] for t in drawn.texts]
                    for line in lines:
                        self.assertIn(line, drawn_texts)
                    if any("…" in line for line in lines):
                        self.assertEqual(font.size, floor.size, "cut before reaching the floor")
                        if max_lines == 1:
                            self.assertGreater(draw.textlength(title, font=floor), width, "cut although it fits at the floor")
                    else:
                        self.assertEqual(" ".join(lines), title)
                        if font.size < full.size and max_lines == 1:
                            self.assertGreater(draw.textlength(title, font=full), width, "shrunk although it fits at full size")

    def test_the_titles_the_audit_found_cut_now_print_whole(self):
        customer = make_customer()
        photo = values_with_real_photo(customer)["photo"]
        for theme in ("ledger", "sleeve"):
            with self.subTest(theme=theme):
                song = validate_and_normalize({**VALID_VALUES, "photo": photo, "track": "Here Comes the Sun"}, {"theme": theme})
                patcher, calls = self._fits(theme)
                with patcher:
                    render_png(song, target_id="print-classic-frameless", customer=customer)
                self.assertEqual(" ".join(calls[0]["lines"]), "Here Comes the Sun")
        # Sleeve keeps its full size and takes a second line, as its preview does.
        self.assertEqual(len(calls[0]["lines"]), 2)


class ArtistFitTests(TestCase):
    """The artist line (19 Oct 2026). Nothing limited its width: a long one ran
    under Mosaic's heart and past its card, off the page in seven themes and
    into every footer's HEARTFOLIO. And the print stepped down by the title's
    ink HEIGHT, so Ledger's artist sat 2.3 units INTO every title and Sleeve's
    under a second line's descenders. Now the artist fits one line in its
    column (shrinking to the title's 80% floor before "…") and never comes
    closer than `ARTIST_TITLE_CLEARANCE` to the title's last line.

    One render pass for the whole class (`setUpTestData`): every theme, every
    artist case and every print size, plus the wallpapers."""

    TRACK = "Bohemian Rhapsody"  # descenders, and two lines in Sleeve
    ARTISTS = (
        "Edith Piaf",
        "Florence + the Machine & the London Symphony",  # 44, realistic
        "Sir Paul McCartney and the Royal Liverpool Philharmonic Orch",  # 60, the limit
        "W" * 60,  # the widest the limit allows
        "عبد الرحمن بن سلطان العتيبي وفرقة الموسيقى العربية الكبرى",
    )
    TARGETS = ("print-classic-frameless", "print-a4-edged", "print-poster-frameless")
    WALLPAPERS = ("wallpaper-phone", "wallpaper-tablet", "wallpaper-desktop")

    @classmethod
    def setUpTestData(cls):
        from unittest.mock import patch

        from . import png_renderer

        customer = make_customer()
        photo = values_with_real_photo(customer)["photo"]
        cls.renders = []
        for theme in png_renderer._THEME_RENDERERS:
            targets = cls.TARGETS + (cls.WALLPAPERS if theme == "player" else ())  # every theme shares one wallpaper
            for artist in cls.ARTISTS:
                for target in targets:
                    song = validate_and_normalize({**VALID_VALUES, "photo": photo, "track": cls.TRACK, "artist": artist}, {"theme": theme})
                    fits, titles, hearts, scales = [], [], [], []
                    real_fit, real_title, real_heart = png_renderer._fit_line, png_renderer._fit_title, png_renderer._draw_vector_heart
                    real_poster = png_renderer._THEME_RENDERERS[theme]["poster"]

                    def fit(draw, text, font_file, size, scale, max_width, *, suffix=""):
                        # Numbers only: keeping `draw` would keep every canvas alive.
                        answer, font = real_fit(draw, text, font_file, size, scale, max_width, suffix=suffix)
                        full = png_renderer._font(font_file, size, scale)
                        floor = png_renderer._font(font_file, size * png_renderer.TITLE_MIN_SCALE, scale)
                        fits.append({
                            "text": text, "suffix": suffix, "answer": answer, "max_width": max_width,
                            "size": font.size, "full_size": full.size, "floor_size": floor.size,
                            "answer_width": draw.textlength(answer + suffix, font=font),
                            "whole_width_at_floor": draw.textlength(text + suffix, font=floor),
                        })
                        return answer, font

                    def title(draw, text, theme_id, scale, max_width):
                        lines, font = real_title(draw, text, theme_id, scale, max_width)
                        titles.extend(lines)
                        return lines, font

                    def heart(canvas, *, cx, cy, size, rotation_deg, opacity):
                        hearts.append((cx - size / 2, cy - size / 2, cx + size / 2, cy + size / 2))
                        return real_heart(canvas, cx=cx, cy=cy, size=size, rotation_deg=rotation_deg, opacity=opacity)

                    def poster(canvas, song, *, scale, origin, customer):
                        scales.append(scale)
                        return real_poster(canvas, song, scale=scale, origin=origin, customer=customer)

                    with _DrawRecorder() as drawn, patch.object(png_renderer, "_fit_line", fit), \
                            patch.object(png_renderer, "_fit_title", title), \
                            patch.object(png_renderer, "_draw_vector_heart", heart), \
                            patch.dict(png_renderer._THEME_RENDERERS[theme], {"poster": poster}):
                        content = render_png(song, target_id=target, customer=customer)
                    with Image.open(io.BytesIO(content)) as img:
                        page = (0, 0, *img.size)
                    texts = [{"text": t["text"], "box": t["box"], "font": t["font"], "xy": t["xy"]} for t in drawn.texts]
                    cards = [r["box"] for r in drawn.rects if r["fill"] == "#0e0f10"]  # Mosaic's card
                    cls.renders.append({"theme": theme, "artist": artist, "target": target, "page": page, "texts": texts, "cards": cards,
                                        "fits": fits, "titles": titles, "hearts": hearts, "scale": scales[0] if scales else None})

    def _artist_texts(self, render):
        """(drawn text, its fit) for each artist line the render drew."""
        found = []
        for fit in render["fits"]:
            wanted = fit["answer"] + fit["suffix"]
            [drawn] = [t for t in render["texts"] if t["text"] == wanted and t not in (f for f, _ in found)][:1] or [None]
            self.assertIsNotNone(drawn, f"{fit['answer']!r} was fitted but not drawn")
            found.append((drawn, fit))
        return found

    def _posters(self):
        return [r for r in self.renders if r["target"].startswith("print-")]

    def test_the_layout_constants_are_the_approved_ones(self):
        """The preview's columns as measured in the browser on 19 Oct 2026, the
        footer gap and the clearance floor. Changing one is a decision."""
        from . import png_renderer

        self.assertEqual(png_renderer.ARTIST_COLUMN, {
            "player": 643.0, "ledger": 692.0, "ephemeris": 688.0, "contactsheet": 700.0,
            "label": 680.0, "award": 552.0, "sleeve": 496.0, "mosaic": 478.0,
        })
        self.assertEqual(png_renderer.FOOT_GAP, 16.0)
        self.assertEqual(png_renderer.ARTIST_TITLE_CLEARANCE, 2.0)
        self.assertEqual(png_renderer.TITLE_MIN_SCALE, 0.8)

    def test_every_poster_fits_the_artist_under_the_title_and_in_the_footer(self):
        from . import png_renderer

        expected = {"player": 1, "award": 2}  # head only; head and plaque line
        for render in self._posters():
            with self.subTest(theme=render["theme"], artist=render["artist"][:12], target=render["target"]):
                fits = render["fits"]
                self.assertEqual(len(fits), expected.get(render["theme"], 2))
                self.assertEqual(fits[0]["max_width"], png_renderer.ARTIST_COLUMN[render["theme"]] * render["scale"])

    def test_no_artist_leaves_its_column_or_the_page_or_touches_anything(self):
        for render in self._posters():
            others = [t for t in render["texts"] if t["box"]]
            for drawn, fit in self._artist_texts(render):
                with self.subTest(theme=render["theme"], artist=render["artist"][:12], target=render["target"], line=drawn["text"][:16]):
                    box = drawn["box"]
                    self.assertTrue(_inside(box, render["page"]), f"{drawn['text']!r} leaves the page")
                    self.assertLessEqual(box[2] - box[0], fit["max_width"] + 1, "wider than its column")
                    for other in others:
                        if other is not drawn:
                            self.assertFalse(_intersects(box, other["box"]), f"{drawn['text']!r} overlaps {other['text']!r}")
                    for heart in render["hearts"]:
                        if heart[2] - heart[0] < 0.05 * render["page"][2]:  # the card's heart, not a ground mark
                            self.assertFalse(_intersects(box, heart), "runs under the heart")

    def test_the_footer_artist_stops_short_of_heartfolio(self):
        from . import png_renderer

        for render in self._posters():
            if render["theme"] in ("player", "award"):
                continue  # no footer; Award's plaque line is one text, checked by its width
            with self.subTest(theme=render["theme"], artist=render["artist"][:12], target=render["target"]):
                [(drawn, fit)] = self._artist_texts(render)[1:]
                [wordmark] = [t for t in render["texts"] if t["text"] == "HEARTFOLIO" and abs(t["box"][1] - drawn["box"][1]) < 0.05 * render["page"][3]]
                self.assertLessEqual(drawn["box"][2], wordmark["box"][0] - png_renderer.FOOT_GAP * render["scale"] + 1)
                if render["artist"].isascii() and not any(c in render["artist"].upper() for c in ",;Q"):
                    # Capitals with no descender: the artist, shrunk or not, sits on
                    # the wordmark's baseline.
                    self.assertLessEqual(abs(drawn["box"][3] - wordmark["box"][3]), 1)

    def test_the_artist_clears_the_titles_last_line(self):
        from . import png_renderer

        for render in self._posters():
            with self.subTest(theme=render["theme"], artist=render["artist"][:12], target=render["target"]):
                [(head, _)] = self._artist_texts(render)[:1]
                title_lines = [t for t in render["texts"] if t["text"] in render["titles"] and t["box"]]
                self.assertEqual(len(title_lines), len(render["titles"]))
                floor = png_renderer.ARTIST_TITLE_CLEARANCE
                bottom = max(t["box"][3] for t in title_lines)
                self.assertGreaterEqual(head["box"][1] - bottom, floor * render["scale"] - 1)

    def test_an_artist_is_cut_only_at_the_floor_and_printed_whole_otherwise(self):
        for render in self.renders:
            for fit in render["fits"]:
                with self.subTest(theme=render["theme"], artist=render["artist"][:12], target=render["target"], suffix=fit["suffix"]):
                    self.assertLessEqual(fit["answer_width"], fit["max_width"])
                    if fit["answer"] == fit["text"]:
                        continue
                    self.assertTrue(fit["answer"].endswith("…"))
                    self.assertTrue(fit["text"].startswith(fit["answer"][:-1]))
                    self.assertEqual(fit["size"], fit["floor_size"], "cut before shrinking to the floor")
                    self.assertGreater(fit["whole_width_at_floor"], fit["max_width"], "cut although it fits at the floor")

    def test_a_realistic_artist_prints_whole_at_full_size(self):
        for render in self._posters():
            if render["artist"] not in self.ARTISTS[:2]:
                continue
            for fit in render["fits"]:
                with self.subTest(theme=render["theme"], artist=render["artist"][:12], target=render["target"], suffix=fit["suffix"]):
                    self.assertEqual(fit["answer"], fit["text"])
                    self.assertEqual(fit["size"], fit["full_size"])

    def test_mosaics_card_grows_by_the_artists_drop(self):
        """Mosaic's card is sized before it is drawn (`_mosaic_card_height`): when
        the artist drops to clear the title, the card must grow by as much, or
        its 24-unit bottom padding shrinks. The footer is drawn at the wordmark's
        top-left; the card ends the footer artist's ink height and the padding
        below it."""
        from . import png_renderer

        for render in self._posters():
            if render["theme"] != "mosaic":
                continue
            with self.subTest(artist=render["artist"][:12], target=render["target"]):
                [card] = render["cards"]
                scale = render["scale"]
                [wordmark] = [t for t in render["texts"] if t["text"] == "HEARTFOLIO" and _inside(t["box"], card)]
                foot_artist = render["fits"][1]["answer"]
                ink = png_renderer._font("DejaVuSans.ttf", 13, scale).getbbox(foot_artist)
                expected = wordmark["xy"][1] + ink[3] - ink[1] + 24 * scale
                self.assertLessEqual(abs(card[3] - expected), 1.5)

    def test_the_wallpaper_artist_stays_inside_the_title_width_and_clear_of_it(self):
        for render in self.renders:
            if not render["target"].startswith("wallpaper-"):
                continue
            with self.subTest(artist=render["artist"][:12], target=render["target"]):
                width = render["page"][2]
                [title] = [t for t in render["texts"] if t["text"] == self.TRACK]
                [artist] = [t for t in render["texts"] if t["text"] == render["artist"]
                            or (t["text"].endswith("…") and render["artist"].startswith(t["text"][:-1]))]
                box = artist["box"]
                self.assertTrue(_inside(box, render["page"]))
                self.assertLessEqual(box[2] - box[0], width * 0.84 + 1)
                self.assertFalse(_intersects(box, title["box"]))
                if render["artist"] in self.ARTISTS[:2]:
                    self.assertEqual(artist["text"], render["artist"])


class FreemiusStagingTests(TestCase):
    """Song Poster's checkout through the REAL, unpatched plan table (plans
    73260, 73263 and 73264, mapped 19 Oct 2026; pinned with the others in
    `apps.commerce.tests.FreemiusPlanMappingTests`). Before they were mapped,
    staging raised `FreemiusPlanNotConfigured`. The packs are the seed's own
    rows: slug, price, targets and status."""

    def _seeded(self):
        import seed_catalog

        entry = next(e for e in seed_catalog.CATALOG if e["slug"] == "song-poster")
        product = make_song_poster_product()
        for slug, price_cents, targets, *status in entry["packs"]:
            make_delivery_pack(
                product, slug=slug, price_cents=price_cents, included_targets=list(targets),
                status=status[0] if status else DeliveryPack.STATUS_ACTIVE,
            )
        customer = make_customer()
        project = Project.objects.create(
            customer=customer, product=product,
            data={"version": 1, "values": values_with_real_photo(customer), "themeSelections": {"theme": "player"}},
        )
        return customer, project

    def test_every_sellable_pack_stages_a_checkout_at_its_seeded_price(self):
        from django.test import override_settings

        from apps.commerce.services import stage_freemius_checkout

        customer, project = self._seeded()
        expected = {"printable": 2299, "live": 1599, "printable-plus-digital": 3599}
        with override_settings(FREEMIUS_ENABLED=True):
            for pack, price_cents in expected.items():
                with self.subTest(pack=pack):
                    staging = stage_freemius_checkout(
                        customer, product_slug="song-poster", delivery_pack_slug=pack, project_id=project.id
                    )
                    self.assertEqual(staging.delivery_pack.slug, pack)
                    self.assertEqual(staging.expected_total_cents, price_cents)
                    self.assertEqual(staging.project, project)

    def test_a_retired_pack_cannot_be_staged(self):
        from django.test import override_settings

        from apps.commerce.services import stage_freemius_checkout
        from apps.common.exceptions.api_errors import DeliveryPackDisabled

        customer, project = self._seeded()
        with override_settings(FREEMIUS_ENABLED=True):
            for pack in ("complete", "printable-plus-wallpaper", "digital-plus-wallpaper", "wallpaper"):
                with self.subTest(pack=pack), self.assertRaises(DeliveryPackDisabled):
                    stage_freemius_checkout(customer, product_slug="song-poster", delivery_pack_slug=pack, project_id=project.id)


class RendererTests(TestCase):
    def test_render_with_no_project_raises(self):
        renderer = SongPosterRenderer()
        with self.assertRaises(SongPosterRenderFailed):
            renderer.render(None, DeliveryType.PRINTABLE, None, "print-classic-frameless")

    def test_render_dispatches_printable(self):
        customer = make_customer()
        product = make_song_poster_product()
        pack = make_delivery_pack(product)
        values = values_with_real_photo(customer)
        project = Project.objects.create(
            customer=customer, product=product, data={"version": 1, "values": values, "themeSelections": {"theme": "player"}}
        )

        renderer = SongPosterRenderer()
        result = renderer.render(project, DeliveryType.PRINTABLE, pack, "print-classic-frameless")

        self.assertEqual(result.content_type, "image/png")
        self.assertGreater(len(result.content), 0)

    def test_render_rejects_unsupported_delivery_type(self):
        customer = make_customer()
        product = make_song_poster_product()
        pack = make_delivery_pack(product)
        values = values_with_real_photo(customer)
        project = Project.objects.create(
            customer=customer, product=product, data={"version": 1, "values": values, "themeSelections": {"theme": "player"}}
        )

        renderer = SongPosterRenderer()
        with self.assertRaises(SongPosterRenderFailed):
            renderer.render(project, DeliveryType.DIGITAL, pack, "__live__")

    def test_preview_is_not_implemented(self):
        """Deliberately NOT a fake HTML wrapper — see `renderer.py`'s
        own note on why Song Poster has no server-rendered digital
        artifact the way Love Story Timeline's `render_html` is one."""
        renderer = SongPosterRenderer()
        with self.assertRaises(SongPosterRenderFailed):
            renderer.preview(None)


class RegistryTests(SimpleTestCase):
    def test_song_poster_resolves_to_the_real_renderer(self):
        """The specific regression Love Story Timeline's own registry
        test set out to prevent: a product slug quietly falling through
        to `NotImplementedRenderer` because nobody registered the real
        one — see `apps/delivery/registry.py`'s own comment on why
        nothing outside that file should ever branch on a product slug."""
        renderer = get_renderer("song-poster", DeliveryType.PRINTABLE)
        self.assertIsInstance(renderer, SongPosterRenderer)
        self.assertNotIsInstance(renderer, NotImplementedRenderer)

    def test_unregistered_slug_still_falls_through_safely(self):
        renderer = get_renderer("not-a-real-product", DeliveryType.PRINTABLE)
        self.assertIsInstance(renderer, NotImplementedRenderer)
