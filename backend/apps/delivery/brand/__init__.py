"""The Heartfolio mark and wordmark on everything the backend makes: the ONE
place they come from (owner, 31 Oct 2026).

THE MARK is `mark.png`, the site's own `src/app/icon.svg` rendered at 1024px
by `frontend-heartfolio/scripts/brand/render-mark.mjs` (gradients, round
caps, the real arcs and the weave's paint order, exactly as the browser
draws them). Deliverables paste it, scaled DOWN with Lanczos, never draw it.
It replaced two hand-made copies that had drifted: Pillow arcs and lines in
two flat colours with square ends and the weave reversed (the QR cards), and
a reportlab two-tone vector with an approximated curve (the PDFs).
`frontend-heartfolio/src/lib/brand/brand.test.ts` renders `icon.svg` again
and fails if this file differs; `apps/delivery/tests_brand.py` fails if any
other module draws the mark's geometry.

THE WORDMARK is the site's: "Heartfolio" in Fraunces (`fonts/`, byte-identical
to `public/fonts/`) at weight 400, tracking -0.025em, as the header sets it
(`lib/brand/mark.ts`, `WORDMARK`). The address beside it is in the site's
sans, Inter, as on the share cards.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from apps.delivery.attribution import SITE_DOMAIN

BRAND_DIR = Path(__file__).resolve().parent
MARK_PNG = BRAND_DIR / "mark.png"
FRAUNCES = BRAND_DIR / "fonts" / "fraunces-latin.woff2"
INTER = BRAND_DIR / "fonts" / "inter-latin.woff2"

#: The site's wordmark (`WORDMARK` in `lib/brand/mark.ts`, pinned by
#: `brand.test.ts`).
WORDMARK_TEXT = "Heartfolio"
WORDMARK_WEIGHT = 400
WORDMARK_TRACKING_EM = -0.025

#: The address after the wordmark, a little smaller, as on the share cards
#: (20px beside a 24px wordmark).
DOMAIN_SCALE = 0.83
DOMAIN_TEXT = f" · {SITE_DOMAIN}"


@lru_cache(maxsize=1)
def _mark_master() -> Image.Image:
    with Image.open(MARK_PNG) as master:
        return master.convert("RGBA")


@lru_cache(maxsize=16)
def mark_image(size_px: int) -> Image.Image:
    """The mark, `size_px` square (the 64-unit box), transparent around it."""
    master = _mark_master()
    if size_px >= master.width:
        return master.copy()
    return master.resize((size_px, size_px), Image.LANCZOS)


def mark_master_path() -> Path:
    """For a PDF, which embeds the full master and lets the page scale it."""
    return MARK_PNG


@lru_cache(maxsize=32)
def wordmark_font(size_px: int) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(str(FRAUNCES), size_px)
    # The file's default instance is weight 900: set the site's own.
    font.set_variation_by_axes([WORDMARK_WEIGHT])
    return font


@lru_cache(maxsize=32)
def sans_font(size_px: int) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(str(INTER), size_px)
    font.set_variation_by_axes([400])
    return font


def _tracked_positions(font: ImageFont.FreeTypeFont, text: str, tracking_px: float) -> list[float]:
    """Each character's x, keeping the font's kerning (the length of the text
    before it) and adding the tracking after every character, as CSS
    `letter-spacing` does."""
    return [font.getlength(text[:index]) + index * tracking_px for index in range(len(text))]


def lockup_line(size_px: int, colour, *, with_domain: bool = True) -> Image.Image:
    """"Heartfolio" in the site's wordmark, then " · theheartfolio.com" in the
    site's sans, on one baseline, as an RGBA image cropped to its ink.
    `size_px` is the wordmark's font size; `colour` an RGB tuple."""
    name_font = wordmark_font(size_px)
    tracking = size_px * WORDMARK_TRACKING_EM
    positions = _tracked_positions(name_font, WORDMARK_TEXT, tracking)
    name_width = positions[-1] + name_font.getlength(WORDMARK_TEXT[-1])
    domain_font = sans_font(max(1, round(size_px * DOMAIN_SCALE)))
    domain_width = domain_font.getlength(DOMAIN_TEXT) if with_domain else 0

    ascent, descent = name_font.getmetrics()
    pad = size_px  # room for any ink past the advance widths
    layer = Image.new("L", (int(name_width + domain_width) + 2 * pad, ascent + descent + 2 * pad), 0)
    draw = ImageDraw.Draw(layer)
    baseline = pad + ascent
    for x, character in zip(positions, WORDMARK_TEXT):
        draw.text((pad + x, baseline), character, font=name_font, fill=255, anchor="ls")
    if with_domain:
        draw.text((pad + name_width, baseline), DOMAIN_TEXT, font=domain_font, fill=255, anchor="ls")

    mask = layer.crop(layer.getbbox())
    line = Image.new("RGBA", mask.size, tuple(colour) + (255,))
    line.putalpha(mask)
    return line


def paste(target: Image.Image, layer: Image.Image, xy: tuple[float, float]) -> tuple[int, int, int, int]:
    """Composites an RGBA `layer` onto `target` at `xy` (rounded) and returns
    the box it covers."""
    x, y = round(xy[0]), round(xy[1])
    target.paste(layer, (x, y), layer)
    return (x, y, x + layer.width, y + layer.height)
