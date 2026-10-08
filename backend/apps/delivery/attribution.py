"""Heartfolio attribution on deliverables.

WHAT IT SAYS, AND WHY SO LITTLE
--------------------------------
On a printed keepsake the mark is the bare domain — no slogan, no "made
with", no logo. That poster is going on someone's wall, and it is very often
a wedding or anniversary gift: a sentence of vendor marketing on it brands
somebody else's present. A quiet URL at the foot of the page is legible to
anyone who wants to know where it came from and invisible to everyone else,
which is the most a paid product should take.

The web surfaces — the live keepsake and the AR page — carry a slightly
fuller line, because those are pages Heartfolio serves rather than files the
customer bought and framed.

VISUAL WEIGHT IS DELIBERATELY LOW: muted colour, small, and set at the very
bottom edge below the customer's own closing line, so it never competes with
their words. It is drawn after everything else and inside the frame-safe
margin (§3), so a picture frame cannot crop it into something illegible.
"""

from __future__ import annotations

SITE_DOMAIN = "theheartfolio.com"

#: Printed keepsakes — the bare domain, nothing else.
PRINT_MARK = SITE_DOMAIN

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
