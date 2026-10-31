"""One logo source for every backend deliverable (owner, 31 Oct 2026).

The QR cards and the bonus PDFs used to DRAW the mark themselves, a Pillow
copy and a reportlab copy, and both had drifted from the site's: other
curves, flat colours, square ends, the weave reversed. Now they paste
`apps/delivery/brand/mark.png`, rendered from the site's own `icon.svg`
(`frontend-heartfolio/src/lib/brand/brand.test.ts` re-renders it and fails
if the file differs). This fails if any other module draws the mark again.
"""

from __future__ import annotations

import re
from pathlib import Path

from django.test import SimpleTestCase

APPS = Path(__file__).resolve().parents[1]

#: The mark's geometry, in any of the ways a hand-made copy would write it:
#: the spark's points, the lobes' end points, the crossing bands, as SVG path
#: data or as (x, y) tuples.
GEOMETRY = [
    re.compile(r"52\.8\D{1,4}13\.2"),          # a spark point
    re.compile(r"49\.2\D{1,4}16\.8"),          # another
    re.compile(r"14\D{1,4}31\.5"),             # the left lobe's end
    re.compile(r"50\D{1,4}31\.5"),             # the right lobe's end
    re.compile(r"41\D{1,4}23\D{1,8}23\D{1,4}40\.5"),  # the band that passes over
]


class OneLogoSourceTests(SimpleTestCase):
    def _sources(self):
        for path in APPS.rglob("*.py"):
            relative = path.relative_to(APPS).as_posix()
            if relative.startswith("delivery/brand/") or "/migrations/" in relative:
                continue
            if path.name.startswith("test") or path.name == "tests.py":
                continue
            yield relative, path.read_text(encoding="utf-8")

    def test_no_deliverable_draws_its_own_mark(self):
        offenders = [
            f"{relative}: {pattern.pattern}"
            for relative, source in self._sources()
            for pattern in GEOMETRY
            if pattern.search(source)
        ]
        self.assertEqual(offenders, [], "draw the mark from apps.delivery.brand, never by hand")

    def test_the_qr_cards_and_pdfs_use_the_shared_source(self):
        source = (APPS / "delivery" / "bonuses.py").read_text(encoding="utf-8")
        self.assertIn("brand.mark_image(", source)
        self.assertIn("brand.mark_master_path()", source)
        self.assertIn("brand.lockup_line(", source)
        self.assertNotIn("def _mark_on", source)
        self.assertNotIn('"HEARTFOLIO"', source)

    def test_the_master_is_the_full_box_with_a_transparent_ground(self):
        from PIL import Image

        from apps.delivery import brand

        with Image.open(brand.MARK_PNG) as master:
            self.assertEqual(master.size, (1024, 1024))
            self.assertEqual(master.mode, "RGBA")
            self.assertEqual(master.getpixel((0, 0))[3], 0)
            self.assertEqual(master.getpixel((512, 820))[3], 255)  # the heart's point

    def test_the_wordmark_is_the_sites(self):
        from apps.delivery import brand

        self.assertEqual((brand.WORDMARK_TEXT, brand.WORDMARK_WEIGHT, brand.WORDMARK_TRACKING_EM), ("Heartfolio", 400, -0.025))
        # The font's default instance is weight 900 (11% wider here): the
        # wordmark must be drawn at the site's 400.
        regular = brand.ImageFont.truetype(str(brand.FRAUNCES), 120)
        regular.set_variation_by_axes([400])
        self.assertEqual(
            brand.wordmark_font(120).getlength(brand.WORDMARK_TEXT), regular.getlength(brand.WORDMARK_TEXT)
        )
