"""Print sizes and mounting variants (brief §2, §3).

Mirrors `src/lib/studio/print-sizes.ts`. The frontend catalog remains the
source of truth for what is *offered*; this module is what turns an
entitlement's `target_id` back into pixels and margins at render time, and
the two must agree. The frontend test suite asserts the ids and dimensions;
`tests.py` here asserts the same numbers, so a change on one side without
the other fails on both.

THE SAFE MARGIN, AND WHERE 0.5in COMES FROM
-------------------------------------------
A standard picture frame's lip (the rabbet) covers roughly 1/4 inch of the
artwork on all four sides — that overlap is what physically holds the print,
backing and glazing together, and 1/8 inch is the smallest any framer
recommends before the art risks falling through the opening.

The `edged` variant therefore insets its content by 0.5 inch: double the
standard lip, which absorbs the overlap plus the positioning slack of a
ready-made frame. Nothing that matters — a name, a date, the final milestone
— can end up hidden behind the moulding.

`frameless` has no inset at all. It is printed on transparent or photo stock
and pressed under glass or acrylic with nothing overlapping it, so a margin
there would be dead space rather than protection.

THE MARGIN IS NOT A VISIBLE MAT. It takes the palette's own background
colour, so the print reads as one continuous piece with breathing room and
sits well against a black frame or a wooden one equally. A paper-white mat
would put a halo around the darker palettes (midnight, forest) and force the
customer to match their frame to the print.

RE-LAYOUT, NOT SCALING. `render_png` applies this inset to the same content
box the decorative frame axis already uses, so the timeline genuinely
reflows into the smaller area — text wraps at a different width, milestones
space differently. That is what makes `edged` a different render rather than
a shrunk copy of `frameless`, which §3 requires explicitly.
"""

from __future__ import annotations

PRINT_DPI = 300

#: Safe margin for the `edged` variant, in inches. See module docstring.
EDGED_MARGIN_INCHES = 0.5

FRAMELESS = "frameless"
EDGED = "edged"
MOUNTINGS = (FRAMELESS, EDGED)

#: Base render dimensions in PORTRAIT, at 300dpi. Every current layout is
#: portrait; a landscape layout swaps these. Kept identical to
#: `PRINT_SIZES` in the frontend's print-sizes.ts.
PRINT_SIZES = {
    # A4 and A3 share the 1:root-2 ratio, so one render serves both — A3 is
    # A4 printed larger, not a different shape.
    "a4": (2480, 3508),
    # 8x10in, scaling to 16x20.
    "classic": (2400, 3000),
    # 12x18in, scaling to 24x36. Rendered at its base size: 24x36 at 300dpi
    # would be 78 megapixels, and printing the base file at that size lands
    # at 150dpi, which is normal for a poster at that viewing distance.
    "poster": (3600, 5400),
}


def print_target_id(size_id: str, mounting: str) -> str:
    """The stable target id for one print deliverable.

    Keeps the `print-` prefix on purpose: `infer_delivery_type` classifies
    by that prefix when the purchasing pack is a bundle with no single type
    of its own, so renaming these would misclassify every bundle purchase.
    """
    return f"print-{size_id}-{mounting}"


def parse_print_target(target_id: str) -> tuple[str, str] | None:
    """Splits a print target id into (size_id, mounting).

    Returns None for anything that is not one of the current print targets —
    a legacy id such as `print-png`, the `__live__` sentinel, or an
    unrecognised string. Callers fall back to their existing handling rather
    than guessing, so an unknown id fails loudly at the dimension lookup
    instead of rendering something silently wrong.
    """
    for size_id in PRINT_SIZES:
        for mounting in MOUNTINGS:
            if target_id == print_target_id(size_id, mounting):
                return size_id, mounting
    return None


def edged_margin_px() -> int:
    """The safe margin in pixels. Uniform across sizes because all three
    render at 300dpi."""
    return int(EDGED_MARGIN_INCHES * PRINT_DPI)


def print_target_dimensions() -> dict[str, tuple[int, int]]:
    """Every current print target mapped to its portrait pixel size."""
    return {
        print_target_id(size_id, mounting): dimensions
        for size_id, dimensions in PRINT_SIZES.items()
        for mounting in MOUNTINGS
    }


def all_print_target_ids() -> list[str]:
    """Display order: size major, mounting minor."""
    return [
        print_target_id(size_id, mounting)
        for size_id in PRINT_SIZES
        for mounting in MOUNTINGS
    ]
