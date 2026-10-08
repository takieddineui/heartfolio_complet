"""The shared AR card (§21i).

The card whose artwork is the same for every customer. Their story appears
only when it is scanned — nothing personal is printed on it.

DESIGNED FOR THE TRACKER FIRST, which is the opposite of how a keepsake is
usually designed and is the whole reason this card can exist at all.
`AR-VR-SCOPING.md` records that Heartfolio's art direction — flat colour,
thin type, generous negative space — is close to the worst case for image
tracking. A per-order card inherits that problem from the customer's own
photographs. This one does not: it is one image we control completely, so
it can be made deliberately feature-rich.

WHAT MAKES AN IMAGE TRACKABLE, and what each element below is doing:

  * high local contrast — the dark band and the dense motif
  * NON-REPEATING detail — the motif is asymmetric on purpose. A regular
    grid or a symmetric pattern gives a tracker many equally good matches
    and it cannot decide which way up the card is.
  * detail spread across the whole frame, not clustered in the middle —
    a card seen at an angle loses its edges first.

Rendered rather than drawn by hand so it stays in step with the palette
system, and so regenerating it after a brand change is one command.
"""

from __future__ import annotations

import io
import math

from PIL import Image, ImageDraw

from apps.delivery.ar_support import CARD_HEIGHT_PX, CARD_WIDTH_PX
from apps.delivery.attribution import PRINT_MARK

#: Deliberately not the customer's chosen palette: this card is one shipped
#: image, and it must track identically for everyone.
INK = "#22222a"
PAPER = "#f4efe6"
ACCENT = "#c9a24b"
MUTED = "#8a8578"


def render_generic_card() -> bytes:
    width, height = CARD_WIDTH_PX, CARD_HEIGHT_PX
    image = Image.new("RGB", (width, height), PAPER)
    draw = ImageDraw.Draw(image)
    margin = int(width * 0.07)
    scale = width / 1200

    from apps.delivery.product_renderers.love_story_timeline.png_renderer import _font, FONT_FILES

    fonts = FONT_FILES["serif-classic"]
    title_font = _font(fonts["heading"], int(76 * scale))
    body_font = _font(fonts["body"], int(26 * scale))
    small_font = _font(fonts["body"], int(19 * scale))

    # A heavy header band. The single highest-contrast edge on the card, and
    # the one a tracker locks onto first.
    band_h = int(height * 0.18)
    draw.rectangle([0, 0, width, band_h], fill=INK)
    draw.text((margin, band_h // 2 - int(title_font.size * 0.6)), "Our Story",
              font=title_font, fill=PAPER)

    # An asymmetric motif. NOT a grid: a repeating pattern gives the tracker
    # many equally good matches and it cannot resolve orientation.
    # DENSER, and filling more of the frame.
    #
    # The first version scattered 34 small marks over a large field and
    # came out mostly empty cream — the exact low-feature-density failure
    # this card exists to avoid. A tracker needs something to lock onto
    # across the whole image, not a sprinkle in the middle.
    motif_top = band_h + int(height * 0.04)
    motif_h = int(height * 0.52)
    for i in range(160):
        # Deterministic pseudo-random placement — the same card every time,
        # which matters because the compiled target must match what is
        # actually printed.
        # A phyllotactic spiral: dense, even coverage with NO repeating
        # motif. A grid would give the tracker many equally good matches
        # and it could not resolve which way up the card is; this has a
        # different neighbourhood everywhere.
        t = i * 2.399963
        radius = (i / 160) ** 0.5
        cx = margin + int((0.5 + 0.47 * radius * math.cos(t)) * (width - 2 * margin))
        cy = motif_top + int((0.5 + 0.47 * radius * math.sin(t)) * motif_h)
        size = int((5 + (i % 7) * 7) * scale)

        kind = i % 4
        if kind == 0:
            draw.ellipse([cx, cy, cx + size, cy + size], fill=ACCENT)
        elif kind == 1:
            draw.rectangle([cx, cy, cx + size, cy + int(size * 0.45)], fill=INK)
        elif kind == 2:
            draw.line([(cx, cy), (cx + size, cy + size)], fill=INK, width=max(2, int(3 * scale)))
        else:
            draw.ellipse([cx, cy, cx + int(size * 0.5), cy + int(size * 0.5)], outline=MUTED,
                         width=max(2, int(2 * scale)))

    # A rule and instruction, giving the lower half structure too — detail
    # spread across the frame, because a card seen at an angle loses its
    # edges first.
    rule_y = motif_top + motif_h + int(height * 0.02)
    draw.rectangle([margin, rule_y, width - margin, rule_y + max(4, int(6 * scale))], fill=INK)

    draw.text((margin, rule_y + int(40 * scale)),
              "Scan the code, then hold", font=body_font, fill=INK)
    draw.text((margin, rule_y + int(40 * scale) + int(body_font.size * 1.4)),
              "your camera over this card.", font=body_font, fill=INK)

    # The QR block, left empty and composited per order — the code differs
    # even though the artwork does not.
    from apps.delivery.ar_support import CARD_MARGIN_RATIO, CARD_QR_BLOCK_RATIO

    block = int(width * CARD_QR_BLOCK_RATIO)
    qx = width - int(width * CARD_MARGIN_RATIO) - block
    qy = height - int(width * CARD_MARGIN_RATIO) - block
    draw.rectangle([qx, qy, qx + block, qy + block], outline=MUTED, width=max(2, int(3 * scale)))

    draw.text((margin, height - int(margin * 0.8)), PRINT_MARK, font=small_font, fill=MUTED)

    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()
