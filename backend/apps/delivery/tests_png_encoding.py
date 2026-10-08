"""
Full-screen PNGs are encoded at a normal zlib effort, not `optimize=True`.

`optimize=True` was measured at 5.6s per phone wallpaper against 0.55s at the
default level, for a file 7% smaller and PIXEL-IDENTICAL. A Complete pack
renders a story wallpaper per device plus a moment wallpaper per milestone per
device, and profiling a real 4-milestone order put ~62s of its ~100s inside
PIL's PNG encoder, against a hard 120s worker timeout.
"""

import io
import os
from pathlib import Path
from unittest.mock import patch

from django.test import SimpleTestCase
from PIL import Image

from apps.delivery.product_renderers.love_story_timeline import png_renderer
from apps.delivery.product_renderers.love_story_timeline.data import validate_and_normalize
from apps.delivery.product_renderers.love_story_timeline.png_renderer import (
    PNG_COMPRESS_LEVEL,
    _encode_png,
    render_png,
)
from apps.delivery.product_renderers.love_story_timeline.tests import VALID_THEME, VALID_VALUES
from apps.delivery.wallpaper_devices import WALLPAPER_DEVICES, moment_target_id, wallpaper_target_id

PNG_SIGNATURE = bytes([0x89]) + b"PNG\r\n" + bytes([0x1A]) + b"\n"


def _save_spy():
    """A replacement for `Image.Image.save` that records the keyword
    arguments of every PNG save, then saves for real. Returns (save, calls)."""
    real = Image.Image.save
    png_params: list[dict] = []

    def save(self, fp, format=None, **params):
        if format == "PNG":
            png_params.append(params)
        return real(self, fp, format=format, **params)

    return save, png_params


class EncodePngTests(SimpleTestCase):
    def test_the_output_is_a_valid_png_and_pixel_identical_to_the_canvas(self):
        canvas = Image.frombytes("RGB", (240, 360), os.urandom(240 * 360 * 3))

        data = _encode_png(canvas)

        self.assertTrue(data.startswith(PNG_SIGNATURE))
        with Image.open(io.BytesIO(data)) as decoded:
            self.assertEqual(decoded.convert("RGB").tobytes(), canvas.tobytes())  # PNG is lossless

    def test_it_uses_the_fast_compress_level_and_never_optimize(self):
        save, png_params = _save_spy()
        with patch.object(Image.Image, "save", save):
            _encode_png(Image.new("RGB", (8, 8), "white"))

        self.assertEqual(png_params, [{"compress_level": PNG_COMPRESS_LEVEL}])
        self.assertLess(PNG_COMPRESS_LEVEL, 9, "level 9 is the setting `optimize=True` implied")


class FullScreenRendersUseTheFastEncoderTests(SimpleTestCase):
    """Through the real render paths, not just the helper: a future edit that
    re-adds `optimize=True` to one of them would otherwise go unnoticed until
    a Complete pack timed out."""

    def _saved_png_params(self, target_id):
        timeline = validate_and_normalize(VALID_VALUES, VALID_THEME)
        save, png_params = _save_spy()
        with patch.object(Image.Image, "save", save):
            data = render_png(timeline, target_id=target_id, customer=None)
        self.assertTrue(data.startswith(PNG_SIGNATURE))
        return png_params

    def test_story_wallpapers_do_not_optimize(self):
        for device_id in WALLPAPER_DEVICES:
            params = self._saved_png_params(wallpaper_target_id(device_id))
            self.assertTrue(params, device_id)
            for p in params:
                self.assertNotIn("optimize", p, device_id)
                self.assertEqual(p.get("compress_level"), PNG_COMPRESS_LEVEL, device_id)

    def test_moment_wallpapers_do_not_optimize(self):
        for device_id in WALLPAPER_DEVICES:
            params = self._saved_png_params(moment_target_id(device_id, 0))
            self.assertTrue(params, device_id)
            for p in params:
                self.assertNotIn("optimize", p, device_id)
                self.assertEqual(p.get("compress_level"), PNG_COMPRESS_LEVEL, device_id)

    def test_the_renderer_source_no_longer_asks_for_optimize(self):
        """A blunt backstop for the three full-screen save sites."""
        source = Path(png_renderer.__file__).read_text(encoding="utf8")
        executable = [line for line in source.splitlines() if not line.lstrip().startswith("#")]
        self.assertFalse([line for line in executable if "optimize=True" in line])
