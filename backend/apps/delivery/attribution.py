"""Heartfolio attribution on deliverables: the colophon.

THE RULE (owner, 27 Oct 2026): every deliverable carries both the name and
the address, as one quiet line, "Heartfolio · theheartfolio.com". It is not
translated (a name and an address), has no slogan, no "made with" and no
logo, and never sits on the customer's photographs or words.

On a PRINT that means:
- muted colour at `MARK_OPACITY`, small (`MARK_SCALE`), drawn LAST, in the
  bottom corner each product keeps empty (Love Story Timeline right, Song
  Poster left), through `draw_colophon` so both products place it alike;
- at least `FRAMELESS_SAFE_PX` (0.25in, 6.35mm at 300dpi) from every trim
  edge on a FRAMELESS print. It used to sit 2.2-5.3mm from the edge, which a
  print shop's trim can cut. An EDGED print keeps it inside the frame-safe
  border (§3), where a frame's lip cannot cover it;
- clear of the design: `tests_colophon.py` renders every layout and theme at
  maximum content and fails if anything but plain page lies under the mark.

The QR cards, the bonus PDFs, the receipt email and the share cards carry
the same words (`bonuses.py`, `apps/commerce/emails.py`,
`frontend-heartfolio/src/lib/og.tsx`); the live pages end with a translated
line around the same name and address (`components/live/live-colophon.tsx`).

Until 27 Oct 2026 prints carried the bare domain only, on the reasoning that
a poster on someone's wall should not carry vendor marketing. The colophon
keeps that restraint (no slogan, no logo, no larger type); it adds the name
because "theheartfolio.com" alone reads as a web address, not as who made it.
"""

from __future__ import annotations

SITE_DOMAIN = "theheartfolio.com"

#: The colophon: printed keepsakes, QR cards, PDFs, email and share cards.
PRINT_MARK = f"Heartfolio · {SITE_DOMAIN}"

#: The closest a colophon comes to the trim of a frameless print: 0.25in,
#: 6.35mm at the prints' 300dpi.
FRAMELESS_SAFE_PX = 75

#: Web surfaces Heartfolio serves.
WEB_MARK = f"Made with Heartfolio · {SITE_DOMAIN}"

#: Fraction of the smaller page edge used for the mark's type size. Small
#: enough to read as a colophon rather than a credit line.
MARK_SCALE = 0.011

#: Opacity applied to the palette's muted colour. The mark should be found,
#: not noticed.
MARK_OPACITY = 0.55


def _to_rgb(colour: str | tuple[int, int, int]) -> tuple[int, int, int]:
    """Accepts either form.

    The palettes store hex strings (`"#8a8578"`), which is what the rest of
    the renderer passes straight to Pillow. Assuming tuples here raised a
    TypeError on the first real palette — worth handling both rather than
    converting at every call site.
    """
    if isinstance(colour, tuple):
        return colour
    value = colour.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def blend(colour, background, opacity: float) -> tuple[int, int, int]:
    """Flattens a translucent colour against the page.

    Pillow's `text()` has no alpha on an RGB image, so the fade has to be
    computed rather than declared — otherwise the mark would print at full
    strength, which is exactly the thing this module exists to avoid.

    Blending against the PAGE rather than white matters: on the midnight
    palette the background is near-black, and fading toward white would make
    the mark brighter than the customer's own text instead of quieter.
    """
    fg, bg = _to_rgb(colour), _to_rgb(background)
    return tuple(
        int(round(c * opacity + b * (1 - opacity)))
        for c, b in zip(fg, bg)
    )


def colophon_ink_box(draw, font, content_box, *, corner: str, inset: int) -> tuple[int, int, int, int]:
    """Where the colophon's INK lands: `inset` pixels inside `content_box`
    from its bottom edge and from the `corner` side ("left" or "right"),
    measured to the glyphs themselves, not to the text's origin."""
    x0, _y0, x1, y1 = content_box
    left, top, right, bottom = draw.textbbox((0, 0), PRINT_MARK, font=font)
    x = (x1 - inset - right) if corner == "right" else (x0 + inset - left)
    y = y1 - inset - bottom
    return (x + left, y + top, x + right, y + bottom)


def draw_colophon(image, *, font, colour, content_box, corner: str, inset: int) -> tuple[int, int, int, int]:
    """Draws the colophon on a print or wallpaper and returns its ink box.
    Call it LAST: nothing may be drawn over it, and the clearance test reads
    the page under it at the moment it is called."""
    from PIL import ImageDraw

    draw = ImageDraw.Draw(image)
    box = colophon_ink_box(draw, font, content_box, corner=corner, inset=inset)
    left, top, _right, _bottom = draw.textbbox((0, 0), PRINT_MARK, font=font)
    draw.text((box[0] - left, box[1] - top), PRINT_MARK, font=font, fill=colour)
    return box
