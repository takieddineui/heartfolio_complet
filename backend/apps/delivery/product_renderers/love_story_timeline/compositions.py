"""Composition geometry, shared by both renderers (§7).

WHY THIS FILE EXISTS
--------------------
The preview and the delivered file are two implementations by decision:
`renderer.tsx` draws with CSS, `png_renderer.py` draws with Pillow. That is
workable for one plain vertical list. Across six compositions it is a
standing risk that the customer approves one thing and receives another,
because nothing errors when they drift — the poster is simply not what was
on screen.

This narrows the surface that can drift. Every proportion that defines a
composition lives here as a number, and both sides read the SAME numbers:
Pillow imports them directly, and the frontend test asserts its CSS matches
them. What is left to human care is the drawing, not the geometry.

It does not eliminate the risk. Rounding, font metrics and text wrapping
still differ between a browser and Pillow. It removes the class of drift
that comes from someone changing a column width on one side only, which is
the likely one.

THE NUMBERS COME FROM THE REFERENCE POSTERS, not from taste. Where a value
was measured off a reference it says so.
"""

from __future__ import annotations

from dataclasses import dataclass


#: Whether a composition carries the milestone DESCRIPTION.
#:
#: This is the differentiator that was missing, and it comes from the
#: reference posters rather than from taste. Images 3 and 5 (Neat Stack)
#: carry a date, a title and a sentence. Images 2, 4 and 7 (Alternating,
#: Dotted) carry a year and two or three words — the photographs do the
#: talking.
#:
#: Giving all four the same content is what made them look alike: they could
#: then only differ by column width, which reads as the same layout nudged.
#: A composition that drops the description is visibly a different thing,
#: and it is also why those layouts can afford larger photographs.
#:
#: The description is not lost — the customer still enters it, and the
#: layouts that show it are the ones designed around it. §8's rule that the
#: customer chooses the direction and Heartfolio controls the composition is
#: exactly this.


@dataclass(frozen=True)
class NeatStackGeometry:
    """7.1 — Neat Vertical Stack.

    Photographs in one column, a solid spine beside them, text on the far
    side. The references put the photo column a little under half the width
    and leave the text column wider than it looks, because the descriptions
    run to two lines.
    """

    #: Fraction of content width given to the photo column.
    photo_column: float = 0.42
    #: Fraction given to the spine. Narrow — it holds a 1.5px line and the
    #: heart nodes, nothing else.
    spine_column: float = 0.06
    #: Gap between columns, as a fraction of content width.
    column_gap: float = 0.02

    #: Polaroid width within its column.
    photo_width: float = 0.78
    #: Vertical overlap between consecutive photos, as a fraction of photo
    #: height. Small: the references stack, they do not pile.
    #: The structured one: it carries the full caption.
    shows_description: bool = True
    #: Vertical overlap between consecutive photos, as a fraction of photo
    #: height. Small: the references stack, they do not pile.
    photo_overlap: float = 0.06
    #: Tilt in degrees, alternating sign. Two degrees on the references —
    #: past about four it stops reading as "neat". This is the ODD cards'
    #: tilt (1st, 3rd, ...): `rotate(-2deg)` in renderer.module.css, i.e.
    #: anticlockwise.
    photo_tilt_deg: float = 2.0
    #: The EVEN cards' tilt (2nd, 4th, ...), the other way: `rotate(1.6deg)`,
    #: clockwise. Deliberately not equal to `photo_tilt_deg` in the CSS, so
    #: the pile does not look mirrored.
    photo_tilt_even_deg: float = 1.6
    #: Polaroid border, as a fraction of photo width. The bottom edge is
    #: heavier, which is what makes it read as a Polaroid rather than a
    #: white box.
    polaroid_border: float = 0.06
    polaroid_bottom_border: float = 0.19
    #: The card's drop shadow, exactly as the preview declares it:
    #: `box-shadow: 0 2px 6px rgba(0, 0, 0, 0.14)`. Those are CSS pixels, so
    #: the print converts them through the photograph's width in the Studio
    #: preview (`preview_photo_px`, measured 146px on its 540px poster): the
    #: shadow keeps the same size RELATIVE TO THE PHOTO. The blur is a CSS
    #: blur radius; the Gaussian it describes has half that as its sigma.
    card_shadow_offset_px: float = 2.0
    card_shadow_blur_px: float = 6.0
    card_shadow_opacity: float = 0.14
    preview_photo_px: float = 146.0

    @property
    def text_column(self) -> float:
        return 1.0 - self.photo_column - self.spine_column - (self.column_gap * 2)


NEAT_STACK = NeatStackGeometry()


@dataclass(frozen=True)
class CascadeGeometry:
    """7.3 — Overlapping Cascade.

    No reference poster existed for this one, so it was designed by
    rendering it at 3, 5 and 8 milestones and correcting what broke. Two
    things broke, and both are why the numbers below are shaped the way they
    are.

    Sizing photographs from page width let them run taller than their slot,
    and they covered the title, the text and the spine — three of §8's rules
    at once. Then, with height driven by the slot alone, three milestones
    meant three enormous slots: the photos grew until the last card swallowed
    its own node.

    That note claimed "a low count produces generous whitespace instead of
    overflow". Measured on 7 Oct 2026 it did not, at any count: cards were
    1.20-1.44x their slot, crossing the header rule in 107 of 108 realistic
    renders and the footer line in 107. Both renderers now divide the
    timeline the same way (below), and the whole tilted card is fitted.

    THE ROWS. Each milestone gets an equal slot of height / (count +
    `photo_overlap`), and half the overlap is left empty at the top and the
    bottom. A card may be up to (1 + `photo_overlap`) slots tall, so it
    overlaps each neighbour by up to 0.11 of a slot and the first and last
    never leave the timeline. The preview does the same with flex rows and
    two 0.11 spacers (`.cascadePhotos::before/::after`).
    """

    #: Photographs occupy the left half; the spine sits just past it.
    photo_column: float = 0.50
    spine_position: float = 0.505
    text_start: float = 0.545
    #: The spine stops this far short of each end of the timeline (CSS
    #: `inset-block: 6%`).
    spine_inset: float = 0.06

    #: The CARD's width as a fraction of the photo column, borders included
    #: (the CSS width is border-box), unless the slot is too short for it.
    photo_width: float = 0.80
    #: The photograph's height over its width: the preview's `aspect-ratio:
    #: 1 / 1.15`. The print used to paste a SQUARE photo into a card sized
    #: for this, leaving a blank band 15% of the photo deep.
    photo_aspect: float = 1.15
    #: How far a card may reach past its slot, as a fraction of the slot.
    photo_overlap: float = 0.22
    #: Editorial, and the descriptions are part of that — this is the
    #: layout where a photograph and a sentence sit together.
    shows_description: bool = True
    #: Horizontal drift across the whole cascade, as a fraction of the photo
    #: column: the first card sits half of it to one side, the last half of
    #: it to the other, the rest evenly between. One diagonal, not an
    #: alternation — that is what distinguishes this composition from 7.2.
    #: Narrowed when a wide card would otherwise leave the column.
    drift: float = 0.22
    #: Tilt of the ODD cards, `rotate(-2.5deg)`, anticlockwise; the EVEN
    #: cards the other way, `rotate(2.5deg)`.
    photo_tilt_deg: float = 2.5
    photo_tilt_even_deg: float = 2.5
    #: Polaroid border as a fraction of the photo, read from the preview:
    #: `padding: 5px 5px 16px` around a 163px photo (the Studio's 540px
    #: poster, 3 milestones). Was a hardcoded 5%/16% in the renderer.
    polaroid_border: float = 0.0307
    polaroid_bottom_border: float = 0.0982
    #: `box-shadow: 0 3px 10px rgba(0, 0, 0, 0.16)`, in CSS pixels, converted
    #: through the photo's width in the preview (`preview_photo_px`).
    card_shadow_offset_px: float = 3.0
    card_shadow_blur_px: float = 10.0
    card_shadow_opacity: float = 0.16
    preview_photo_px: float = 163.0
    #: The preview poster's width, for converting fixed CSS sizes that are
    #: not tied to the photo (the spine and the nodes) into print pixels.
    preview_poster_px: float = 540.0
    #: The smallest fraction of its normal size the milestone text shrinks
    #: to, in the print and in the preview (TIMELINE_TEXT_FIT_FLOOR).
    text_fit_floor: float = 0.55

    #: §7.3 — the timeline recedes. One hairline and small muted nodes; a
    #: heavier spine competes with the photographs it is meant to sit behind.
    #: CSS pixels on the preview's 540px poster: the print draws them at the
    #: same share of its width (a 1px line was 1px on a 2480px page, nearly
    #: invisible, and the node a fifth of the preview's relative size).
    spine_width_px: int = 1
    node_size_px: int = 8


CASCADE = CascadeGeometry()


@dataclass(frozen=True)
class AlternatingGeometry:
    """7.2 — Alternating Tilted Layout.

    Read from two reference posters. They differ in one respect and agree on
    everything else, which is informative: one uses tick branches off the
    spine, the other heart nodes. §7.2 says "larger heart nodes", so the
    hearts win — and they are noticeably larger here than 7.1's, because
    they are the only ornament in a composition that is otherwise photos
    and space.

    The defining rule: a milestone's photograph and its text sit on OPPOSITE
    sides of the spine, and both flip each milestone. Putting them on the
    same side would collapse this into 7.1 with a zigzag.

    Strongest at 3–5. The references show three and five, and both give each
    photograph far more room than 7.1 does — which is why the photo occupies
    most of its half rather than a fraction of it.
    """

    #: Each side of the spine, as a fraction of content width.
    side_column: float = 0.44
    #: The spine sits dead centre.
    spine_position: float = 0.50

    #: Photo width within its half. Generous: this layout trades milestone
    #: count for photograph size.
    photo_width: float = 0.86
    photo_aspect: float = 1.0
    #: More tilt than 7.1. The references are visibly more expressive, and
    #: §7.2 calls the layout expressive rather than structured — but past
    #: about five degrees a Polaroid starts to look dropped rather than
    #: placed. The ODD cards' tilt: `.altPhotoOdd { rotate(-4deg) }`,
    #: anticlockwise.
    photo_tilt_deg: float = 4.0
    #: The EVEN cards' tilt, the other way: `.altPhotoEven { rotate(4deg) }`.
    #: Symmetric here, unlike Neat Stack's -2/+1.6.
    photo_tilt_even_deg: float = 4.0
    #: Polaroid border as a fraction of the photo, read from the preview:
    #: `padding: 5px 5px 16px` around a 151px photo (the Studio's default
    #: 540px poster, 3 milestones). Was a hardcoded 5%/16% in the renderer.
    polaroid_border: float = 0.0331
    polaroid_bottom_border: float = 0.106
    #: `box-shadow: 0 3px 10px rgba(0, 0, 0, 0.16)`, in CSS pixels, converted
    #: through the photo's width in the preview (`preview_photo_px`).
    card_shadow_offset_px: float = 3.0
    card_shadow_blur_px: float = 10.0
    card_shadow_opacity: float = 0.16
    preview_photo_px: float = 151.0
    #: The preview poster's width, for converting fixed CSS sizes that are
    #: not tied to the photo (the heart nodes) into print pixels.
    preview_poster_px: float = 540.0
    #: The smallest fraction of its normal size the milestone text shrinks
    #: to, in the print and in the preview (ALT_TEXT_FIT_FLOOR).
    text_fit_floor: float = 0.55

    #: Larger than 7.1's, per §7.2.
    node_size_px: int = 14
    spine_width_px: int = 2
    #: PHOTO-LED. The references show a year and two or three words; the
    #: photographs carry the composition, which is also what lets them be
    #: this large.
    shows_description: bool = False


ALTERNATING = AlternatingGeometry()


@dataclass(frozen=True)
class DottedGeometry:
    """7.4 — Dotted Branching Timeline.

    From the reference poster. Structurally close to 7.1 — photographs on
    one side, text on the other — and distinguished by three things:

      * the spine is DOTTED and faint, not solid
      * the year sits ON the spine, interrupting it, rather than in the
        text column
      * a heart precedes each label, and the label reads as a phrase
        ("Engaged", "First Baby") rather than a sentence

    The photographs cascade with real overlap, more than 7.1's stack —
    closer to 7.3 — which is why the photo column is narrower here: the
    overlap does the work that width does elsewhere.

    THE ROWS, as Overlapping Cascade (7 Oct 2026): `photo_overlap` is the
    share of a slot a card reaches past it, and both renderers divide the
    timeline into `count + photo_overlap` equal slots with half the overlap
    spare at each end. A card's tilted outline may be (1 + overlap) slots
    tall, so it overlaps its neighbours and the first and last stay inside.
    Measured before this: 106 of 108 realistic print renders broken (cards
    1.03-1.38x their slot, the first over the header rule and the last over
    the footer in 102), and the preview clipped 10px at 3 milestones.

    THE DATE CHIP is a full date ("Apr 12, 2019"), wider than the gutter
    between the photographs and the text, so it cannot sit centred on the
    spine: it did, 21px off it, over the cards' edge. It is the first line
    of each milestone instead, starting on the spine and running right
    above the title, over the dotted line and clear of the cards.
    """

    photo_column: float = 0.40
    spine_position: float = 0.48
    #: Where the text column starts, as a fraction of the content width: a
    #: little right of the spine. (The print used 0.545 and the preview came
    #: out at 0.49 once `.timeline`'s 14px gap was added; both are now this.)
    text_start: float = 0.52
    #: The dotted line stops this far short of each end of the timeline (CSS
    #: `inset-block: 5%`).
    spine_inset: float = 0.05

    #: The CARD's width as a fraction of the photo column, borders included
    #: (the CSS width is border-box), unless the slot is too short for it.
    photo_width: float = 0.88
    #: The photograph's height over its width: the preview's `aspect-ratio:
    #: 1 / 1.12`. The print pasted a SQUARE photo into a card sized for
    #: this, leaving a blank band.
    photo_aspect: float = 1.12
    #: More than 7.1's stack, less than 7.3's cascade.
    photo_overlap: float = 0.16
    #: The ODD cards' tilt, `rotate(-3deg)`, anticlockwise; the EVEN cards
    #: the other way, `rotate(3deg)`. The cards are centred in the column
    #: (the print used to step them 0/5/10% to the right).
    photo_tilt_deg: float = 3.0
    photo_tilt_even_deg: float = 3.0
    #: Polaroid border as a fraction of the photo, read from the preview:
    #: `padding: 5px 5px 16px` around a 158px photo (the Studio's 540px
    #: poster, 3 milestones).
    polaroid_border: float = 0.0316
    polaroid_bottom_border: float = 0.1013
    #: `box-shadow: 0 3px 9px rgba(0, 0, 0, 0.15)`, in CSS pixels, converted
    #: through the photo's width in the preview (`preview_photo_px`).
    card_shadow_offset_px: float = 3.0
    card_shadow_blur_px: float = 9.0
    card_shadow_opacity: float = 0.15
    preview_photo_px: float = 158.0
    #: The preview poster's width, for converting fixed CSS sizes that are
    #: not tied to the photo (the line, the dashes, the heart, the chip's
    #: padding) into print pixels.
    preview_poster_px: float = 540.0
    #: The smallest fraction of its normal size the milestone text shrinks
    #: to, in the print and in the preview (TIMELINE_TEXT_FIT_FLOOR).
    text_fit_floor: float = 0.55

    #: Dash pattern, in CSS pixels on the preview's 540px poster; the print
    #: draws the same share of its width (they were 6px and 8px on a 2480px
    #: page, nearly invisible). The reference reads as a fine dotted rule.
    dash_length_px: int = 6
    dash_gap_px: int = 8
    spine_width_px: int = 1
    #: The heart preceding each label, and the space after it.
    heart_size_px: int = 11
    label_gap_px: int = 5
    #: The date chip's side padding: it starts this far left of the spine
    #: and the date itself starts ON the spine.
    chip_pad_px: int = 4
    #: Photo-led, like 7.2. The reference shows a year on the line and a
    #: single phrase beside a heart — "Engaged", "First Baby".
    shows_description: bool = False


DOTTED = DottedGeometry()


@dataclass(frozen=True)
class HorizontalGeometry:
    """7.5 and 7.6 — the two LANDSCAPE compositions.

    One dataclass for both, because they share their structure and differ
    only in how a milestone is shown: 7.5 puts Polaroids in a row with the
    caption inside the lower border, 7.6 puts circular photographs above a
    ticked axis with the label beneath. `circular` is what selects between
    them.

    These are the first compositions to use the orientation work from §2.
    `orientationFor()` returns landscape for both, so an A4 renders the
    other way up and sizing, mounting, exports and delivery naming all
    follow without change.

    MILESTONE COUNT MATTERS MORE HERE than in the portrait layouts. A
    horizontal row divides the width by the number of milestones, so each
    one gets narrower as they are added — where a vertical layout simply
    gets taller. Three milestones on a landscape page leave a lot of space;
    eight are tight. That is why §7 records these as strongest at 5–7.
    """

    #: Fraction of content height given to the photograph row.
    photo_row: float = 0.52
    #: Gap between milestones, as a fraction of the per-milestone width.
    column_gap: float = 0.12
    #: Photograph size within its column.
    photo_width: float = 0.88

    #: 7.5 tilts its Polaroids very slightly; 7.6's circles do not tilt.
    photo_tilt_deg: float = 1.5
    #: 7.6 — circular crop and a ticked axis instead of Polaroids.
    circular: bool = False
    #: Height of the downward tick under each milestone (7.6).
    tick_height_px: int = 18


HORIZONTAL_POLAROID = HorizontalGeometry()
HORIZONTAL_CIRCLES = HorizontalGeometry(circular=True, photo_tilt_deg=0.0, photo_width=0.78)

#: Every composition's geometry, keyed by layout id (§7). The five not yet
#: built fall back to Neat Stack, matching the frontend — a half-built
#: composition should render as a complete different one rather than as a
#: broken version of itself.
COMPOSITIONS = {
    "neat-stack": NEAT_STACK,
    "alternating-tilt": ALTERNATING,
    "overlapping-cascade": CASCADE,
    "dotted-branching": DOTTED,
    "horizontal-polaroid": HORIZONTAL_POLAROID,
    "horizontal-circles": HORIZONTAL_CIRCLES,
}


def geometry_for(layout_id: str) -> NeatStackGeometry:
    return COMPOSITIONS.get(layout_id, NEAT_STACK)
