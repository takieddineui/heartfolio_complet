"""
Raster (PNG) rendering for the `printable`, `social`, and `wallpaper`
delivery types — confirmed as the correct output format directly from
the real product catalog (src/lib/studio/product-modules/love-story-
timeline/exports.ts): every target Love Story Timeline currently
exports (`story-png`, `square-png`, `landscape-png`, `portrait-png`,
`print-png`) is PNG. No PDF anywhere in the actual catalog, so none is
implemented here.

Fonts: DejaVu Serif/Sans/Sans Mono, bundled in `./fonts/` (see
`fonts/LICENSE.txt`) rather than relying on whatever happens to be
installed on a given OS/container — this is what "do not depend on
fonts that may not exist in production without documenting/providing
them" means in practice. They are close-but-not-identical substitutes
for the frontend's actual CSS fonts (Fraunces/Inter/JetBrains Mono),
which aren't bundled or license-cleared here — see the Phase 3.9
report's "Known limitations". ARABIC is the exception: it is drawn in the
site's own Noto Kufi/Naskh files, character by character (see
`ARABIC_FONT_ROLES`), because no DejaVu Serif face has an Arabic glyph.

Scope note: `palette` (real hex values) and `typography` (real font
family choice) are fully implemented. `layout` currently renders as one
of two structurally distinct algorithms — a plain stacked list (used
for `standard`/`alternating`/`centered`/`journal`, which the frontend
itself differentiates via CSS positioning this renderer doesn't
attempt to replicate pixel-for-pixel) or `cards` (each event in its own
bordered box, genuinely different). `frame` renders as a real but
simplified border treatment (color/thickness per frame id, not the
CSS's actual gallery-matting/wood-grain/vintage textures). This is a
deliberate, documented scope decision, not an oversight.
"""

from __future__ import annotations

import functools
import io
import math
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageFilter, ImageFont

from apps.assets.services import get_asset_bytes_for_customer
from apps.delivery.print_sizes import EDGED, edged_margin_px, parse_print_target, print_target_dimensions
from apps.delivery.ar_support import (
    CARD_HEIGHT_PX,
    CARD_MARGIN_RATIO,
    CARD_QR_BLOCK_RATIO,
    CARD_TARGET_ID,
    CARD_WIDTH_PX,
)
from apps.delivery.wallpaper_devices import (
    parse_moment_target,
    parse_wallpaper_target,
    wallpaper_target_dimensions,
)
from apps.common.exceptions.api_errors import LoveStoryTimelineRenderFailed
from apps.delivery.mixed_script import MixedScriptFont, parse_unicode_range

from .data import duration_phrase, join_names, PALETTES, NormalizedTimeline
from apps.delivery.attribution import MARK_OPACITY, MARK_SCALE, PRINT_MARK, blend

from .compositions import HEADER_NAMES_LINE_HEIGHT, geometry_for
from .layout import days_together, format_event_date, ordered_events

FONT_DIR = Path(__file__).parent / "fonts"

FONT_FILES = {
    "serif-classic": {"heading": "DejaVuSerif-Bold.ttf", "body": "DejaVuSerif.ttf"},
    "modern": {"heading": "DejaVuSans-Bold.ttf", "body": "DejaVuSans.ttf"},
    "script": {"heading": "DejaVuSerif-Italic.ttf", "body": "DejaVuSans.ttf"},
    "typewriter": {"heading": "DejaVuSansMono-Bold.ttf", "body": "DejaVuSansMono.ttf"},
}

# Real dimensions, matching the frontend catalog — the catalog is the source
# of truth, nothing here is invented.
#
# The `print-<size>-<mounting>` entries are the current §2/§3 model, built
# from the shared size list so a size cannot be added on one side only. The
# five bare `*-png` ids below them are LEGACY: superseded, no longer sold in
# any pack, and retained because entitlements record their `target_id` at
# purchase time. Re-downloading an order placed before this model still
# routes through here, so removing them would break past purchases.
_LEGACY_TARGET_DIMENSIONS = {
    "story-png": (1080, 1920),
    "square-png": (1080, 1080),
    "landscape-png": (1920, 1080),
    "portrait-png": (1080, 1350),
    "print-png": (2480, 3508),
}

TARGET_DIMENSIONS = {
    **print_target_dimensions(),
    **wallpaper_target_dimensions(),
    **_LEGACY_TARGET_DIMENSIONS,
}

#: §13 — the frame is no longer a customer choice; the Studio no longer
#: offers thin-black/gallery/wood/vintage/none as options. Per an explicit
#: product decision, every edged print now uses ONE fixed style rather than
#: deriving it from palette or anything else — the other four styles are
#: kept here, commented, rather than deleted outright, in case a future
#: product decision revives per-style selection at the delivery layer
#: (customer-chosen or otherwise) and the exact values are worth having on
#: hand rather than reconstructed from memory.
DEFAULT_FRAME_STYLE = {"color": "#000000", "thickness": 6}  # was "thin-black"
# FRAME_STYLES = {
#     "none": None,
#     "thin-black": {"color": "#000000", "thickness": 6},
#     "gallery": {"color": "#1a1a1a", "thickness": 10},
#     "wood": {"color": "#6b4423", "thickness": 26},
#     "vintage": {"color": "#8b7355", "thickness": 18},
# }

PHOTO_THUMBNAIL_SIZE = 220


#: ARABIC IN THE PRINT (18 Oct 2026). Every DejaVu Serif face has no Arabic
#: glyph, so Serif Classic printed every Arabic slot as empty boxes, and
#: Romantic Italic its headings (and, on /ar, the generated duration line).
#: Arabic is now drawn in the face the STUDIO PREVIEW gives it (`themes.ts`):
#: a "Heartfolio Serif" token draws Arabic in Noto Kufi, "Heartfolio Sans"
#: in Noto Naskh (`globals.css`), and Typewriter's JetBrains Mono has none,
#: so it keeps DejaVu Sans Mono, which has Arabic. Always upright. Faces are
#: chosen per character, as CSS `unicode-range` does
#: (`apps.delivery.mixed_script`): the site's Noto files have no Latin-1, so
#: digits, punctuation and Latin stay in DejaVu. Pinned against `themes.ts`
#: and `globals.css` by `lst-arabic-print-parity.test.ts`.
ARABIC_FONT_ROLES = {
    "serif-classic": {"heading": "serif", "body": "sans"},
    "modern": {"heading": "sans", "body": "sans"},
    "script": {"heading": "serif", "body": "sans"},
    "typewriter": {"heading": None, "body": None},
}
ARABIC_FACES = {"serif": "noto-kufi-arabic.woff2", "sans": "noto-naskh-arabic.woff2"}
#: The CSS's Arabic `unicode-range`, less the punctuation it shares with Latin.
ARABIC_UNICODE_RANGE = "U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0898-08E1, U+08E3-08FF, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC"
#: The site declares both faces `font-weight: 300 700`.
ARABIC_WEIGHT_RANGE = (300, 700)
_ARABIC_RANGES = parse_unicode_range(ARABIC_UNICODE_RANGE)


def _arabic_face_by_file() -> dict[str, str | None]:
    """Each DejaVu file's Arabic face. The print reaches fonts by FILE
    (`_font(fonts["heading"], ...)`), so the roles are turned into a map by
    file; a file two typographies would give different Arabic faces stops
    the import rather than picking one silently."""
    by_file: dict[str, str | None] = {}
    for typography, roles in FONT_FILES.items():
        for role, file_name in roles.items():
            kind = ARABIC_FONT_ROLES[typography][role]
            face = ARABIC_FACES[kind] if kind else None
            if by_file.setdefault(file_name, face) != face:
                raise ValueError(f"{file_name} would draw Arabic in two faces")
    return by_file


_ARABIC_FACE_BY_FILE = _arabic_face_by_file()


@functools.lru_cache(maxsize=256)
def _arabic_face(face_file: str, size: int, weight: int) -> ImageFont.FreeTypeFont:
    face = ImageFont.truetype(str(FONT_DIR / face_file), size=size)
    [axis] = face.get_variation_axes()
    low, high = ARABIC_WEIGHT_RANGE
    face.set_variation_by_axes([min(max(min(max(weight, low), high), axis["minimum"]), axis["maximum"])])
    return face


@functools.lru_cache(maxsize=256)
def _font(path_name: str, size: int) -> ImageFont.FreeTypeFont:
    """Cached for ONE render (`render_png` clears it when it returns): a font
    is immutable, and its measurement caches (see `MixedScriptFont`) then
    carry across the fit search's many sizes. An Arabic print that no longer
    fits at the first sizes tried took 25x longer to render without this; kept
    for the whole process instead, 512 fonts held 107MB. The DejaVu face `path_name`, drawing Arabic in the preview's Arabic
    face at the weight the print already gives the slot (a Bold file draws
    700, any other 400). Text with no Arabic renders exactly as before."""
    face_file = _ARABIC_FACE_BY_FILE.get(path_name)
    if face_file is None:
        return ImageFont.truetype(str(FONT_DIR / path_name), size=size)
    weight = 700 if "Bold" in path_name else 400
    return MixedScriptFont(str(FONT_DIR / path_name), size, second=_arabic_face(face_file, size, weight), second_range=_ARABIC_RANGES)


#: ARABIC LINES ARE SPACED BY THEIR INK (18 Oct 2026, phase 2). The print
#: spaces lines at `font.size` x a factor (1.25-1.5), which suits DejaVu's
#: Latin (ink 1.15em tall) but not Kufi or Naskh: their tall letters rise
#: 1.14-1.29em above the baseline and their tails reach 0.44-0.47em below it,
#: so one Arabic line's tails met the next line's alefs (Serif Classic's
#: poster title touched the subtitle on every layout). A line with Arabic in
#: it is now never closer to the next than the Arabic face's tallest letter
#: plus its deepest tail plus this clearance, in ems. Latin text keeps its
#: own spacing exactly: the floor only applies where Arabic is present.
ARABIC_LINE_CLEARANCE = 0.10
#: The tallest and deepest Arabic shapes, with marks above and below, that
#: the floor is measured from (once per font).
_ARABIC_TALL_AND_DEEP = "ألآإأُكلطظ يجحخعغقنسشصضى إِلَى قُلُوبِنَا جَمِيعًا"


def _line_pitch(font, pitch: int, text: str) -> int:
    """`pitch` (the print's `int(size * factor)`), or, for text with Arabic in
    it, at least the Arabic face's ink height plus `ARABIC_LINE_CLEARANCE`: the
    taller of the probe's (`_ARABIC_TALL_AND_DEEP`, the face's usual reach) and
    the text's OWN, because full vowel marks stack deeper than the probe (a
    kasra under a deep tail reaches 0.68em in Kufi against the probe's 0.47).
    Every line of the text is part of it, so none can reach further."""
    if not text or not isinstance(font, MixedScriptFont) or not font.uses_second(text):
        return pitch
    floor = font.__dict__.get("_arabic_line_floor")
    if floor is None:
        box = font.getbbox(_ARABIC_TALL_AND_DEEP, anchor="ls")
        floor = math.ceil(box[3] - box[1] + ARABIC_LINE_CLEARANCE * font.size)
        font._arabic_line_floor = floor
    own = font.getbbox(text, anchor="ls")
    return max(pitch, floor, math.ceil(own[3] - own[1] + ARABIC_LINE_CLEARANCE * font.size))


def _wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    if not text:
        return []
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if draw.textbbox((0, 0), candidate, font=font)[2] <= max_width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def _draw_wrapped(
    draw, text, font, *, x, y, max_width, max_lines, fill, line_spacing, measure_only=False, centered=False,
    right_aligned=False,
) -> int:
    """Draws up to `max_lines` of wrapped text, truncating the last
    line with an ellipsis if there was more that didn't fit. Returns
    the y coordinate just below the drawn text.

    `measure_only` runs the same layout without drawing — used to ask how
    tall something WOULD be, through the one code path that draws it.

    `centered` centres each line within `max_width` from `x`, as CSS
    `text-align: center` does: by the line's advance width. `right_aligned`
    ends each line at `x + max_width` (CSS `text-align: end` in LTR).
    """
    lines = _wrap_text(draw, text, font, max_width)
    truncated = len(lines) > max_lines
    lines = lines[:max_lines]
    if truncated and lines:
        last = lines[-1]
        while last and draw.textbbox((0, 0), last + "\u2026", font=font)[2] > max_width:
            last = last[:-1]
        lines[-1] = last + "\u2026"

    line_spacing = _line_pitch(font, line_spacing, text)
    for line in lines:
        if not measure_only:
            if centered:
                line_x = x + (max_width - draw.textlength(line, font=font)) / 2
            elif right_aligned:
                line_x = x + max_width - draw.textlength(line, font=font)
            else:
                line_x = x
            draw.text((line_x, y), line, font=font, fill=fill)
        y += line_spacing
    return y


#: zlib effort for the full-screen outputs below. PIL's own default, stated
#: explicitly so the choice is visible.
#:
#: THESE USED TO BE SAVED WITH `optimize=True`, which makes PIL try several
#: PNG filter strategies at zlib level 9 and keep the smallest. Measured on a
#: real phone-wallpaper canvas (1290x2796, a customer's photo): 5.6s against
#: 0.55s here, for a file only 7% smaller (2.31MB vs 2.47MB) and PIXEL-IDENTICAL
#: either way — PNG is lossless. A Complete pack renders a story wallpaper per
#: device plus a moment wallpaper per milestone per device; profiling a real
#: 4-milestone order showed ~62s of its ~100s inside PIL's PNG encoder, against
#: a hard 120s worker timeout. A smaller download is not worth that.
PNG_COMPRESS_LEVEL = 6


def _encode_png(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", compress_level=PNG_COMPRESS_LEVEL)
    return buffer.getvalue()


def _paste_photo(
    image: Image.Image, *, customer, asset_id: str, x: int, y: int,
    size: int = PHOTO_THUMBNAIL_SIZE, circular: bool = False, height: int | None = None,
) -> None:
    """Resolves and composites an event photo. Ownership-checked
    (`get_asset_bytes_for_customer`) — the client-sent `photo.url` in
    `values` is never used to fetch the image; only the ownership-
    verified `Asset` row's own storage key is ever read.

    `size` wide and `height` tall (square when `height` is omitted), cropped
    from the centre of the photograph as CSS `object-fit: cover` does.
    """
    try:
        raw_bytes, _mime_type = get_asset_bytes_for_customer(customer, asset_id)
        with Image.open(io.BytesIO(raw_bytes)) as photo:
            photo = photo.convert("RGB")
            if height is None or height == size:
                side = min(photo.size)
                left = (photo.width - side) // 2
                top = (photo.height - side) // 2
                photo = photo.crop((left, top, left + side, top + side))
                photo = photo.resize((size, size))
            else:
                # The largest centred box of the target shape.
                crop_w = min(photo.width, round(photo.height * size / height))
                crop_h = min(photo.height, round(photo.width * height / size))
                left = (photo.width - crop_w) // 2
                top = (photo.height - crop_h) // 2
                photo = photo.crop((left, top, left + crop_w, top + crop_h))
                photo = photo.resize((size, height))
            if circular:
                # §7.6 — circular crop, drawn 4x and downsampled because
                # Pillow's ellipse has no anti-aliasing and a hard-edged
                # circle at print resolution looks like a rendering fault
                # rather than a design choice.
                mask = Image.new("L", (size * 4, size * 4), 0)
                ImageDraw.Draw(mask).ellipse([0, 0, size * 4, size * 4], fill=255)
                image.paste(photo, (x, y), mask.resize((size, size), Image.LANCZOS))
            else:
                image.paste(photo, (x, y))
    except Exception as exc:  # noqa: BLE001 - deliberately broad: any failure here must not crash rendering
        raise LoveStoryTimelineRenderFailed("Could not render one of the referenced photos.") from exc


def render_png(
    timeline: NormalizedTimeline, *, target_id: str, customer, locale: str = "en"
) -> bytes:
    """See `_render_png`. Releases the fonts this render cached (`_font`)."""
    try:
        return _render_png(timeline, target_id=target_id, customer=customer, locale=locale)
    finally:
        _font.cache_clear()


def _render_png(
    timeline: NormalizedTimeline, *, target_id: str, customer, locale: str = "en"
) -> bytes:
    """`customer` is the *project's* owning customer (`project.customer`,
    already an existing, ownership-verified relationship — see
    apps/projects/models.py) — never a new, separately-trusted input.
    Used only to resolve event photos securely.
    """
    # §13 — a MOMENT wallpaper is a different composition, not a crop.
    #
    # One milestone's photograph fills the screen with just its date and
    # title. Routed before anything else because almost none of the poster
    # pipeline applies: no timeline, no spine, no milestone loop.
    # §13 — a STORY wallpaper is composed FOR the device, not scaled onto
    # it. Routed here, before the poster pipeline, for the same reason the
    # moment wallpaper is: almost none of that pipeline applies.
    # §21i — the printed AR card carrying this customer's own timeline.
    #
    # Rendered like any other deliverable, and routed first because it is
    # neither a print size nor a device. Its output is TWO things at once:
    # the card the customer prints, and the image MindAR's compiler turns
    # into a tracking target.
    if target_id == CARD_TARGET_ID:
        return _render_ar_card(timeline, customer=customer, locale=locale)

    story_device = parse_wallpaper_target(target_id)
    if story_device is not None:
        return _render_story_wallpaper(timeline, device=story_device, customer=customer, locale=locale)

    moment = parse_moment_target(target_id)
    if moment is not None:
        return _render_moment_wallpaper(
            timeline, device=moment[0], index=moment[1], customer=customer, locale=locale
        )

    if target_id not in TARGET_DIMENSIONS:
        raise LoveStoryTimelineRenderFailed(f"No printable/social/wallpaper dimensions defined for '{target_id}'.")

    width, height = TARGET_DIMENSIONS[target_id]

    # §7 / §2 — a LANDSCAPE composition turns the page.
    #
    # `TARGET_DIMENSIONS` stores every print size in portrait, because a
    # print size is a paper size and has no inherent orientation — that was
    # the §2 decision. The layout supplies the orientation, so the swap
    # belongs here, at the point the page is created.
    #
    # Scoped to PRINT targets. A wallpaper's dimensions come from the device
    # and must never be rotated: a phone screen is portrait whatever the
    # layout says, and turning it would produce a wallpaper that does not
    # fit the screen it was made for.
    if timeline.layout in ("horizontal-polaroid", "horizontal-circles") and target_id.startswith("print-"):
        width, height = height, width
    palette = PALETTES[timeline.palette]
    fonts = FONT_FILES[timeline.typography]
    scale = timeline.scale / 100.0

    image = Image.new("RGB", (width, height), palette["bg"])
    draw = ImageDraw.Draw(image)

    # §3 — mounting variant. `edged` insets everything by the frame-safe
    # margin so a picture frame's lip cannot cover any content; `frameless`
    # runs full bleed for glass/acrylic mounting. The margin is left as bare
    # background rather than drawn as a mat: it takes the palette's own
    # colour, so the print works against any frame the customer owns.
    #
    # Applied BEFORE the decorative frame axis, so that a `wood` or
    # `gallery` border also sits inside the safe area instead of being the
    # thing that gets covered.
    parsed = parse_print_target(target_id)
    inset = edged_margin_px() if parsed and parsed[1] == EDGED else 0

    content_left, content_top = inset, inset
    content_right, content_bottom = width - inset, height - inset

    # §4 — a wallpaper is not a resized print. The OS draws its own
    # furniture on top: the lock-screen clock high up, the home indicator
    # and first icon row at the bottom, a dock and an icon column on a
    # desktop. The timeline is laid out inside what is left, which is what
    # makes this a different composition rather than a scaled copy.
    #
    # `safe_leading` is applied to the LEFT here because the PNG renderer
    # draws left-to-right unconditionally — the poster's own bidi handling
    # is a separate, unsolved problem (see the `lang`/`dir` note in the HTML
    # renderer). When that is addressed this should follow the same
    # direction rather than assuming.
    device = parse_wallpaper_target(target_id)
    if device:
        content_top += int(height * device.safe_top)
        content_bottom -= int(height * device.safe_bottom)
        content_left += int(width * device.safe_leading)

    # §13 — the fixed default frame, drawn ONLY for an "edged" target.
    #
    # The previous version checked only `timeline.frame != "none"` — no
    # check for frameless vs edged at all. That meant a customer who chose
    # a frame style could have gotten a decorative border drawn on a
    # FRAMELESS print, which by definition should have none. Gating on the
    # target id closes that regardless of how it behaved before; frame
    # style is no longer customer input, so there is no "none" case left
    # to reason about — either this is an edged target and gets the one
    # fixed style, or it is anything else and gets no border at all.
    if "edged" in target_id:
        t = DEFAULT_FRAME_STYLE["thickness"]
        draw.rectangle(
            [content_left, content_top, content_right - 1, content_bottom - 1],
            outline=DEFAULT_FRAME_STYLE["color"],
            width=t,
        )
        content_left, content_top = content_left + t + 20, content_top + t + 20
        content_right, content_bottom = content_right - t - 20, content_bottom - t - 20

    margin = int(40 * scale)
    x = content_left + margin
    max_width = (content_right - content_left) - 2 * margin
    y = content_top + margin

    # Type is sized from the canvas WIDTH everywhere except wallpapers.
    #
    # That works for the prints, which are all portrait: width is their
    # smaller dimension, so text scales with the narrow edge and the
    # composition fits. A desktop wallpaper is 3840 x 2160 — wide and short
    # — and sizing from width gives 173px headings inside ~1800px of usable
    # height once the safe zones are removed. The header alone then
    # overflows into the dock.
    #
    # So a wallpaper sizes from whichever edge of its CONTENT BOX is
    # smaller. Deliberately scoped to wallpapers: applying it everywhere
    # would change `landscape-png`, a legacy target whose output must stay
    # stable for orders already placed.
    # Also applies to a LANDSCAPE composition (§7.5, §7.6). An A4 rendered
    # the other way up is 3508 x 2480: sizing type from width would give the
    # same overflow that wallpapers had, with the header running off the
    # bottom.
    #
    # Keyed on the LAYOUT's orientation, not on whether the canvas happens
    # to be wider than tall. `landscape-png` is a legacy target whose output
    # must stay stable for orders already placed, and it is 1920 x 1080 —
    # a shape test would silently change it.
    is_landscape_layout = timeline.layout in ("horizontal-polaroid", "horizontal-circles")
    type_basis = width
    if device or is_landscape_layout:
        type_basis = min(content_right - content_left, content_bottom - content_top)

    heading_font = _font(fonts["heading"], int(type_basis * 0.045 * scale))
    subheading_font = _font(fonts["heading"], int(type_basis * 0.028 * scale))
    body_font = _font(fonts["body"], int(type_basis * 0.022 * scale))
    small_font = _font(fonts["body"], int(type_basis * 0.018 * scale))
    # The subtitle sits between the dedication and the duration in size, as
    # in the preview (`.subtitle` 12px, against `.quote` 13px and
    # `.duration` 11px, which are body 0.022 and small 0.018 here).
    subtitle_font = _font(fonts["body"], int(type_basis * 0.020 * scale))

    events = ordered_events(timeline)

    # THE FOOTER BAND IS RESERVED BEFORE THE EVENTS ARE LAID OUT.
    #
    # This used to divide everything down to `content_bottom` between the
    # events, and then draw the closing line ("To be continued...") at a
    # position clamped to the bottom of the same box. Both were therefore
    # entitled to the last few centimetres, so the closing line landed on
    # top of the final milestone's photo — which is what it looked like:
    # text printed over an image.
    #
    # Subtracting the band first means the events are only ever offered
    # space the footer has already given up. The clamp below stays, as a
    # guard rather than as the thing doing the work.
    footer_block_height = int(small_font.size * 3.2)
    footer_reserve = footer_block_height + int(24 * scale) if timeline.ending_text else 0

    # §7.1, §7.3 — on a Neat Stack or Overlapping Cascade PRINT the names
    # give up room when the milestones cannot otherwise fit (see
    # `_names_font_for_milestones`). Every other layout, every page that
    # fits, and the legacy `*-png` targets (`parsed` is None for those — kept
    # as rendered for past orders, and 1920x1080 cannot hold a vertical stack
    # at 130 whatever the names do) keep `heading_font`.
    names_font = heading_font
    if parsed is not None and (
        timeline.layout not in _LAYOUTS_WITH_THEIR_OWN_TEXT_FIT
        or timeline.layout in ("overlapping-cascade", "dotted-branching")
    ):
        names_font = _names_font_for_milestones(
            draw, timeline, events, locale=locale, fonts=fonts, palette=palette, scale=scale,
            x=x, y=y, max_width=max_width, margin=margin,
            content_left=content_left, content_right=content_right, content_bottom=content_bottom,
            footer_reserve=footer_reserve, page_width=width,
            heading_font=heading_font, subheading_font=subheading_font,
            subtitle_font=subtitle_font, body_font=body_font, small_font=small_font,
        )

    # The preview centres the header and the closing line (`.header` and
    # `.footer` are both `text-align: center`); the print left-aligned them.
    # Matched on Neat Stack, the composition reviewed so far — the other
    # five follow as each is reviewed.
    centered_text = (
        timeline.layout not in _LAYOUTS_WITH_THEIR_OWN_TEXT_FIT
        or timeline.layout in _REVIEWED_CENTRED_LAYOUTS
    )

    y = _draw_header(
        draw, timeline, events, locale=locale, palette=palette, scale=scale,
        x=x, y=y, max_width=max_width, content_right=content_right, margin=margin,
        names_font=names_font, subheading_font=subheading_font, subtitle_font=subtitle_font,
        body_font=body_font, small_font=small_font, centered=centered_text,
    )


    remaining_height = max(content_bottom - margin - footer_reserve - y, 0)
    event_count = max(len(events), 1)
    available_per_event = remaining_height / event_count

    # The fixed heading/body font sizes chosen above are appropriate for
    # a roomy canvas, but a short canvas (e.g. landscape wallpaper) with
    # several events can genuinely run out of vertical space per event.
    # Rather than let text overlap (illegible, and would silently ship
    # a broken-looking output), shrink a *local* copy of the event-loop
    # fonts to whatever actually fits, with a sane floor so text never
    # becomes unreadably small.
    required_height = small_font.size * 1.4 + body_font.size * 1.3 + small_font.size * 1.3 * 2
    shrink = min(1.0, max(0.55, available_per_event / required_height)) if required_height else 1.0
    event_small_font = _font(fonts["body"], max(10, int(small_font.size * shrink)))
    event_body_font = _font(fonts["body"], max(12, int(body_font.size * shrink)))
    # Severe shrink (very little room) also drops to a single
    # description line instead of two, rather than shrinking fonts
    # past readability.
    description_max_lines = 2 if shrink > 0.75 else 1
    slot_height = int(remaining_height // event_count)

    # §7.1 — NEAT VERTICAL STACK, mirroring renderer.tsx.
    #
    # Three columns: photographs, spine, text. Proportions come from
    # `compositions.py`, which the frontend test also asserts against — so a
    # column width cannot be changed on one side only, which is the drift
    # most likely to happen and least likely to be noticed.
    #
    # The spine is drawn ONCE, floor to ceiling, rather than per milestone.
    # A per-slot segment would break at every gap; the references show one
    # unbroken line with the hearts sitting on top of it.
    # §7 — dispatch by composition. Each draws differently enough that a
    # shared loop would be a tangle of conditionals; the shared part is the
    # GEOMETRY, in compositions.py, which both this and the CSS read.
    if timeline.layout in ("horizontal-polaroid", "horizontal-circles"):
        y = _draw_horizontal(
            image, draw, timeline, events,
            customer=customer, palette=palette,
            x=x, y=y, content_right=content_right, margin=margin,
            # The whole band under the header and above the closing line;
            # unshrunk fonts, which it fits to its own milestones.
            band_height=remaining_height,
            small_font=small_font, body_font_file=fonts["body"], page_width=width,
        )
    elif timeline.layout == "dotted-branching":
        y = _draw_dotted(
            image, draw, timeline, events,
            customer=customer, palette=palette,
            x=x, y=y, content_right=content_right, margin=margin,
            # The whole band, divided by the layout itself; unshrunk fonts,
            # which it fits to its own milestones (`_fit_milestone_text`).
            band_height=remaining_height,
            small_font=small_font, body_font=body_font, body_font_file=fonts["body"],
        )
    elif timeline.layout == "alternating-tilt":
        y = _draw_alternating(
            image, draw, timeline, events,
            customer=customer, palette=palette, scale=scale,
            x=x, y=y, content_right=content_right, margin=margin,
            slot_height=int(remaining_height // event_count),
            # Unshrunk: like Neat Stack, Alternating Tilt measures its own
            # milestones (`_fit_milestone_text`) instead of using the shared
            # `required_height` estimate, which over-counts here (it budgets
            # two description lines this photo-led layout never draws).
            small_font=small_font, body_font=body_font, body_font_file=fonts["body"],
        )
    elif timeline.layout == "overlapping-cascade":
        y = _draw_cascade(
            image, draw, timeline, events,
            customer=customer, palette=palette,
            x=x, y=y, content_right=content_right, margin=margin,
            # The whole band: the cascade divides it itself, into slots
            # with half an overlap spare at each end. Unshrunk fonts: it
            # measures its own milestones (`_fit_milestone_text`).
            band_height=remaining_height,
            small_font=small_font, body_font=body_font, body_font_file=fonts["body"],
        )
    else:
        y = _draw_neat_stack(
            image, draw, timeline, events,
            customer=customer, palette=palette, scale=scale,
            x=x, y=y, content_left=content_left, content_right=content_right, margin=margin,
            slot_height=int(remaining_height // event_count),
            # The UNSHRUNK fonts: Neat Stack measures its own milestones
            # (see `_fit_neat_stack_text`) instead of using the shared
            # `required_height` estimate above, which the other layouts
            # still use unchanged.
            small_font=small_font, body_font=body_font, body_font_file=fonts["body"],
        )


    # Clamped, not just positioned: `max()` alone lets an overflowing
    # timeline push the footer past the bottom of the content box and into
    # the safe zone below it.
    footer_y = max(y + int(20 * scale), content_bottom - margin - footer_block_height)
    footer_y = min(footer_y, content_bottom - margin - footer_block_height)
    if timeline.ending_text:
        draw.text(
            (_line_x(draw, timeline.ending_text, small_font, x, max_width, centered_text), footer_y),
            timeline.ending_text, font=small_font, fill=palette["muted"],
        )

    # Attribution — the bare domain, at the foot of the page.
    #
    # Drawn LAST and below the customer's own closing line, so it never
    # competes with their words. Inside the content box, which on an edged
    # print means inside the frame-safe margin (§3) — a mark cropped in half
    # by a picture frame would look like a defect rather than a colophon.
    #
    # The fade is computed rather than declared: Pillow's text() has no
    # alpha on an RGB image, so a translucent fill would print at full
    # strength, which is the one thing this must not do.
    mark_font = _font(fonts["body"], max(9, int(type_basis * MARK_SCALE * scale)))
    mark_colour = blend(palette["muted"], palette["bg"], MARK_OPACITY)
    try:
        bbox = draw.textbbox((0, 0), PRINT_MARK, font=mark_font)
        mark_w, mark_h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    except Exception:  # noqa: BLE001 - very old Pillow
        mark_w, mark_h = len(PRINT_MARK) * (mark_font.size // 2), mark_font.size
    draw.text(
        (content_right - margin - mark_w, content_bottom - margin - mark_h),
        PRINT_MARK, font=mark_font, fill=mark_colour,
    )

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()



#: Layouts past Neat Stack whose print has been matched to the preview's
#: centred header and footer. Each is added as it is reviewed.
_REVIEWED_CENTRED_LAYOUTS = (
    "alternating-tilt", "overlapping-cascade", "dotted-branching", "horizontal-polaroid", "horizontal-circles",
)


#: Layouts that are NOT Neat Stack — mirrors the dispatch in `render_png`,
#: whose final `else` is Neat Stack (and the fallback for an unknown id).
_LAYOUTS_WITH_THEIR_OWN_TEXT_FIT = (
    "horizontal-polaroid", "horizontal-circles", "dotted-branching",
    "alternating-tilt", "overlapping-cascade",
)


def _draw_header(
    draw, timeline, events, *, locale, palette, scale, x, y, max_width, content_right, margin,
    names_font, subheading_font, subtitle_font, body_font, small_font, measure_only=False, centered=False,
) -> int:
    """Names, title, subtitle, dedication, duration and the rule beneath them.
    Returns the y where the composition starts. With `measure_only`, the
    same layout runs without drawing, so "how tall would the header be"
    is answered by the code that draws it, not by a copy of its arithmetic.
    """
    # WRAPPED, NOT DRAWN AS ONE LINE. Two names at the 24-character ceiling
    # ("Alexandra Konstantinopol & Maximilian von Habsburg") are wider than a
    # print at heading size, and a plain `draw.text` ran straight off the
    # right edge while the Studio preview (CSS, which wraps) showed it whole.
    # §19 forbids shrinking type to fit, so the line wraps instead. One line
    # advances exactly as it did before, so short names render unchanged.
    #
    # UP TO FOUR LINES, so a name is never cut. This was two, which held at
    # text scale 100 but not at 130: on the edged A4, 8x10 and poster the
    # heading is wide enough that two long names need three or four lines,
    # and the ellipsis dropped the second name entirely ("Alexandra /
    # Konstantinopol &..."). Four is two names each wrapping once: measured,
    # the worst 24-character pairs need exactly four on the edged A4 at 130
    # (`NamesAreNeverTruncatedTests` holds that). The photographs below take
    # whatever height is left (they are sized to their slots).
    y = _draw_wrapped(
        draw, join_names(timeline.people, locale), names_font,
        x=x, y=y, max_width=max_width, max_lines=4, fill=palette["text"],
        line_spacing=int(names_font.size * HEADER_NAMES_LINE_HEIGHT), measure_only=measure_only, centered=centered,
    )

    if timeline.poster_title:
        if not measure_only:
            draw.text(
                (_line_x(draw, timeline.poster_title, subheading_font, x, max_width, centered), y),
                timeline.poster_title, font=subheading_font, fill=palette["accent"],
            )
        y += _line_pitch(subheading_font, int(subheading_font.size * 1.5), timeline.poster_title)

    # THE SUBTITLE WAS NEVER PRINTED. The Studio asks for it, validation
    # keeps it, the preview and the live page show it under the title — and
    # this header skipped it, so a customer's own words vanished from the
    # paid print on every layout. Drawn where the preview draws it, in its
    # muted colour, wrapped and never cut.
    if timeline.subtitle:
        y = _draw_wrapped(
            draw, timeline.subtitle, subtitle_font,
            x=x, y=y, max_width=max_width, max_lines=_NO_LINE_LIMIT, fill=palette["muted"],
            line_spacing=int(subtitle_font.size * 1.3), measure_only=measure_only, centered=centered,
        )
        y += int(subtitle_font.size * 0.4)

    if timeline.dedication:
        y = _draw_wrapped(
            draw, f"\u201c{timeline.dedication}\u201d", body_font,
            # No line limit: this was 3, and a 180-character dedication at
            # text scale 130 on the edged prints needs 4 — the ellipsis cut
            # the customer's own closing words off the paid print.
            x=x, y=y, max_width=max_width, max_lines=_NO_LINE_LIMIT, fill=palette["muted"],
            line_spacing=int(body_font.size * 1.3), measure_only=measure_only, centered=centered,
        )
        y += int(body_font.size * 0.5)

    duration = days_together(events, show_duration=timeline.show_duration)
    if duration is not None:
        # §16 — phrasing depends on the story type, and some types have
        # none. Previously hardcoded English "days together" for all four,
        # so a family history claimed a couple's wording.
        phrase = duration_phrase(timeline.story_type, duration, locale)
        if phrase:
            if not measure_only:
                draw.text(
                    (_line_x(draw, phrase, small_font, x, max_width, centered), y),
                    phrase, font=small_font, fill=palette["accent"],
                )
            y += _line_pitch(small_font, int(small_font.size * 1.8), phrase)

    y += int(20 * scale)
    if not measure_only:
        draw.line([(x, y), (content_right - margin, y)], fill=palette["line"], width=2)
    y += int(30 * scale)

    return y


def _line_x(draw, text, font, x, max_width, centered):
    """Where a single line starts: at `x`, or centred in `max_width`."""
    return x + (max_width - draw.textlength(text, font=font)) / 2 if centered else x


def _names_font_for_milestones(
    draw, timeline, events, *, locale, fonts, palette, scale, x, y, max_width, margin,
    content_left, content_right, content_bottom, footer_reserve, page_width,
    heading_font, subheading_font, subtitle_font, body_font, small_font,
):
    """The names heading for a Neat Stack or Overlapping Cascade page —
    normally `heading_font`.

    WHY IT CAN SHRINK. Eight milestones under two long names at text scale
    130 on the 8x10 edged print left 141px per milestone below a four-line
    names heading, and the shortest milestone needs 204px even at the
    smallest type `_fit_neat_stack_text` allows (date 45 + title 49 +
    description 40 + location 40 + separation 30). Shrinking only until the
    names fit on two lines (125px) still left it 9px short. The names are
    the largest thing on the page, so they give up the room: the heading
    steps down a pixel at a time until the milestones fit — 99px there,
    against 140px. It stays strictly larger than the title line beneath it
    (`subheading_font`); if even that cannot make room, it stops there.

    Only ever smaller when the milestones would NOT fit at full size, so
    every page that already fits renders exactly as before.

    Overlapping Cascade follows the same rule (7 Oct 2026): the same case,
    eight milestones under two long names at 130 on the 8x10 edged print,
    left its milestones 204px of text in 135px slots at the smallest type.
    Dotted Branching follows it too (`_dotted_block_height`).
    """
    event_count = max(len(events), 1)

    def milestones_fit(names_font) -> bool:
        top = _draw_header(
            draw, timeline, events, locale=locale, palette=palette, scale=scale,
            x=x, y=y, max_width=max_width, content_right=content_right, margin=margin,
            names_font=names_font, subheading_font=subheading_font, subtitle_font=subtitle_font,
            body_font=body_font, small_font=small_font, measure_only=True,
        )
        band_height = max(content_bottom - margin - footer_reserve - top, 0)
        if timeline.layout in ("overlapping-cascade", "dotted-branching"):
            stack = _overlapping_stack_layout(
                timeline.layout, x=x, content_right=content_right, margin=margin,
                band_height=band_height, count=event_count,
            )
            slot_height = int(stack["slot"])
            block_for = _cascade_block_height
            if timeline.layout == "dotted-branching":
                block_for = functools.partial(_dotted_block_height, indent=_dotted_indent(page_width))
            *_, block_height = _fit_milestone_text(
                draw, events, font_file=fonts["body"], small_size=small_font.size, body_size=body_font.size,
                width=stack["text_w"], slot_height=slot_height, block_height=block_for,
            )
            return block_height <= slot_height
        columns = _neat_stack_columns(timeline, x=x, content_left=content_left, content_right=content_right, margin=margin)
        slot_height = int(band_height // event_count)
        *_, block_height = _fit_neat_stack_text(
            draw, events, font_file=fonts["body"], small_size=small_font.size, body_size=body_font.size,
            width=columns["text_col_w"], slot_height=slot_height,
        )
        return block_height <= slot_height

    if milestones_fit(heading_font):
        return heading_font
    names_font = heading_font
    for size in range(heading_font.size - 1, subheading_font.size, -1):
        names_font = _font(fonts["heading"], size)
        if milestones_fit(names_font):
            break
    return names_font


def _draw_neat_stack(
    image, draw, timeline, events, *, customer, palette, scale,
    x, y, content_left, content_right, margin, slot_height,
    small_font, body_font, body_font_file,
) -> int:
    """§7.1 — see compositions.py for the geometry and renderer.module.css
    for the mirror. Returns the y after the last milestone.

    `small_font`/`body_font` are the unshrunk sizes; the milestone text is
    fitted to its slot here (`_fit_neat_stack_text`)."""
    geometry = geometry_for(timeline.layout)
    columns = _neat_stack_columns(timeline, x=x, content_left=content_left, content_right=content_right, margin=margin)
    photo_col_x, photo_col_w = columns["photo_col_x"], columns["photo_col_w"]
    spine_col_x, spine_col_w = columns["spine_col_x"], columns["spine_col_w"]
    text_col_x, text_col_w = columns["text_col_x"], columns["text_col_w"]

    small_font, body_font, description_max_lines, block_height = _fit_neat_stack_text(
        draw, events, font_file=body_font_file, small_size=small_font.size, body_size=body_font.size,
        width=text_col_w, slot_height=slot_height,
    )

    spine_center_x = spine_col_x + (spine_col_w // 2)
    spine_top = y + int(slot_height * 0.08)
    spine_bottom = y + (slot_height * len(events)) - int(slot_height * 0.08)
    draw.line(
        [(spine_center_x, spine_top), (spine_center_x, spine_bottom)],
        fill=palette["text"], width=max(1, int(2 * scale)),
    )

    polaroid_w = int(photo_col_w * geometry.photo_width)

    # THE WHOLE CARD FITS ITS SLOT, WITH A GAP — not just the photograph.
    #
    # This used to cap the PHOTO at the slot height plus the 6% overlap, then
    # add the polaroid borders (6% top, 19% bottom) on top of that. The card
    # came out ~1.3x its slot, centred on it, so the first card rose over the
    # header rule (and on 8x10 over the duration line) and the last one sat
    # under the closing line; at text scale 130 that happened on every size
    # but the poster. Between cards the overlap was 25-30% of a card, and with
    # flat white cards (no tilt or shadow here, unlike the CSS) the column read
    # as one white strip.
    #
    # So the card's full height is capped at the slot minus a gap. Centred in
    # its slot, it can then never cross the top or bottom of the timeline
    # area — which already sits below the rule and above the footer band —
    # and neighbours stay visibly apart. `photo_overlap` is not used here:
    # an overlap only reads as a stack with the tilt and shadow the preview
    # has, which this renderer does not draw.
    card_frame = 1 + geometry.polaroid_border + geometry.polaroid_bottom_border
    card_gap = max(2, int(slot_height * 0.05))
    # The cards are TILTED, as in the preview, so what has to fit the slot
    # is the tilted card's bounding box: h*cos + w*sin of the larger tilt.
    # Two pixels absorb the integer borders and Pillow's rounding when it
    # expands a rotated image.
    tilt = math.radians(max(abs(geometry.photo_tilt_deg), abs(geometry.photo_tilt_even_deg)))
    tilted_frame = card_frame * math.cos(tilt) + (1 + 2 * geometry.polaroid_border) * math.sin(tilt)
    max_photo_for_slot = int((slot_height - card_gap) / tilted_frame) - 2

    for index, event in enumerate(events):
        slot_top = y + (index * slot_height)
        slot_middle = slot_top + (slot_height // 2)

        # --- photograph -------------------------------------------------
        if event.photo_asset_id and customer is not None:
            photo_size = max(1, min(polaroid_w, max_photo_for_slot))
            border = int(photo_size * geometry.polaroid_border)
            bottom_border = int(photo_size * geometry.polaroid_bottom_border)

            # CSS rotates clockwise for a positive angle and Pillow
            # anticlockwise, so the preview's rotate(-2deg) is +2 here and
            # its rotate(1.6deg) is -1.6. Odd/even counts from the first card.
            tilt_deg = geometry.photo_tilt_deg if index % 2 == 0 else -geometry.photo_tilt_even_deg
            to_print = photo_size / geometry.preview_photo_px
            _paste_polaroid(
                image, customer=customer, asset_id=event.photo_asset_id,
                centre_x=photo_col_x + photo_col_w // 2, centre_y=slot_middle,
                photo_size=photo_size, border=border, bottom_border=bottom_border, tilt_deg=tilt_deg,
                shadow_offset=round(geometry.card_shadow_offset_px * to_print),
                shadow_sigma=geometry.card_shadow_blur_px / 2 * to_print,
                shadow_opacity=geometry.card_shadow_opacity,
            )

        # --- heart node on the spine ------------------------------------
        node = max(4, int(9 * scale))
        draw.ellipse(
            [spine_center_x - node // 2, slot_middle - node // 2,
             spine_center_x + node // 2, slot_middle + node // 2],
            fill=palette["text"],
        )

        # --- text -------------------------------------------------------
        # Starts where it always has, unless that would run the block (and
        # the space owed to the next milestone) past the bottom of its slot;
        # then it moves up, never above the slot's own top.
        text_y = slot_middle - int(slot_height * 0.28)
        text_y = max(slot_top, min(text_y, slot_top + slot_height - block_height))
        draw.text((text_col_x, text_y), format_event_date(event.date), font=small_font, fill=palette["text"])
        text_y += int(small_font.size * geometry.date_line_height)
        # Wrapped, never cut: a 40-character title ran off the right edge of
        # the poster at text scale 130. One line advances exactly as before.
        text_y = _draw_wrapped(
            draw, event.title, body_font,
            x=text_col_x, y=text_y, max_width=text_col_w,
            max_lines=_NO_LINE_LIMIT, fill=palette["text"],
            line_spacing=int(body_font.size * geometry.text_line_height),
        )
        if event.description:
            text_y = _draw_wrapped(
                draw, event.description, small_font,
                x=text_col_x, y=text_y, max_width=text_col_w,
                max_lines=description_max_lines, fill=palette["muted"],
                line_spacing=int(small_font.size * geometry.text_line_height),
            ) or text_y + int(small_font.size * geometry.text_line_height)
        if event.location:
            _draw_wrapped(
                draw, event.location, small_font,
                x=text_col_x, y=text_y, max_width=text_col_w,
                max_lines=_NO_LINE_LIMIT, fill=palette["muted"],
                line_spacing=int(small_font.size * geometry.text_line_height),
            )

    y = y + (slot_height * len(events))
    return y


def _paste_polaroid(
    image, *, customer, asset_id, centre_x, centre_y, photo_size, border, bottom_border,
    tilt_deg, shadow_offset, shadow_sigma, shadow_opacity, photo_height=None, caption=None,
) -> dict:
    """A tilted Polaroid with its drop shadow, centred on (`centre_x`,
    `centre_y`) — the preview rotates about the card's centre (CSS
    `transform-origin` default).

    The card is built on its own transparent layer and rotated there, in
    premultiplied alpha so the antialiased edge does not pick up a dark
    fringe. The shadow is the card's own outline, offset and blurred, laid
    down first at `shadow_opacity` black — what `box-shadow` does.

    The photograph is `photo_size` wide and `photo_height` tall (square if
    omitted).

    `caption`, if given, is drawn on the card before it is rotated, centred
    in the card, so it tilts with it as the preview's does (Horizontal
    Polaroids): `{"lines": [...], "font": ..., "fill": ..., "top": the y of
    the first line inside the card, "line_height": ...}`.

    Returns the card's bounding box and the shadow's visible bounding box,
    so callers and tests can check what the card actually covers.
    """
    photo_height = photo_height or photo_size
    card_w = photo_size + border * 2
    card_h = photo_height + border + bottom_border
    card = Image.new("RGBA", (card_w, card_h), (255, 255, 255, 255))
    _paste_photo(card, customer=customer, asset_id=asset_id, x=border, y=border, size=photo_size, height=photo_height)
    if caption:
        layer = ImageDraw.Draw(card)
        line_y = caption["top"]
        for line in caption["lines"]:
            advance = layer.textlength(line, font=caption["font"])
            layer.text(((card_w - advance) / 2, line_y), line, font=caption["font"], fill=caption["fill"])
            line_y += caption["line_height"]
    if tilt_deg:
        card = card.convert("RGBa").rotate(tilt_deg, resample=Image.BICUBIC, expand=True).convert("RGBA")
    left, top = centre_x - card.width // 2, centre_y - card.height // 2
    outline = card.getchannel("A")

    shadow_box = None
    if shadow_opacity > 0 and shadow_sigma > 0:
        pad = math.ceil(shadow_sigma * 3)
        shadow = Image.new("L", (card.width + pad * 2, card.height + pad * 2), 0)
        shadow.paste(outline, (pad, pad))
        shadow = shadow.filter(ImageFilter.GaussianBlur(shadow_sigma))
        shadow = shadow.point(lambda value: round(value * shadow_opacity))
        shadow_left, shadow_top = left - pad, top - pad + shadow_offset
        image.paste((0, 0, 0), (shadow_left, shadow_top), shadow)
        visible = shadow.getbbox()
        if visible:
            shadow_box = (shadow_left + visible[0], shadow_top + visible[1],
                          shadow_left + visible[2], shadow_top + visible[3])

    image.paste(card.convert("RGB"), (left, top), outline)
    return {"card": (left, top, left + card.width, top + card.height), "shadow": shadow_box}


def _neat_stack_columns(timeline, *, x, content_left, content_right, margin) -> dict:
    """Photo, spine and text columns for §7.1 — one definition, shared by
    the drawing and by `_names_font_for_milestones`'s fit check."""
    geometry = geometry_for(timeline.layout)
    content_width = content_right - content_left - (2 * margin)
    gap_px = int(content_width * geometry.column_gap)
    photo_col_w = int(content_width * geometry.photo_column)
    spine_col_w = int(content_width * geometry.spine_column)
    photo_col_x = x
    spine_col_x = photo_col_x + photo_col_w + gap_px
    text_col_x = spine_col_x + spine_col_w + gap_px
    return {
        "photo_col_x": photo_col_x, "photo_col_w": photo_col_w,
        "spine_col_x": spine_col_x, "spine_col_w": spine_col_w,
        "text_col_x": text_col_x, "text_col_w": max(40, (content_right - margin) - text_col_x),
    }


#: Titles and locations wrap to as many lines as they need — they are the
#: customer's own words and are never cut. (Descriptions keep their existing
#: one- or two-line limit with an ellipsis.)
_NO_LINE_LIMIT = 10

#: The shrink steps tried, largest first, down to the floor the shared
#: estimate in `render_png` already uses.
_NEAT_STACK_SHRINK_STEPS = tuple(round(1.0 - 0.025 * i, 3) for i in range(19))  # 1.0 .. 0.55


def _neat_stack_block_height(draw, event, small_font, body_font, width, description_lines) -> int:
    """The height `_draw_neat_stack` advances through for one milestone —
    the same steps, fonts and wrap width, measured rather than estimated."""
    geometry = geometry_for("neat-stack")
    height = int(small_font.size * geometry.date_line_height)  # date
    height += max(1, len(_wrap_text(draw, event.title, body_font, width))) * _line_pitch(body_font, int(body_font.size * geometry.text_line_height), event.title)
    if event.description:
        lines = min(description_lines, max(1, len(_wrap_text(draw, event.description, small_font, width))))
        height += lines * _line_pitch(small_font, int(small_font.size * geometry.text_line_height), event.description)
    if event.location:
        height += len(_wrap_text(draw, event.location, small_font, width)) * _line_pitch(small_font, int(small_font.size * geometry.text_line_height), event.location)
    return height


def _fit_neat_stack_text(draw, events, *, font_file, small_size, body_size, width, slot_height):
    """Neat Stack's milestones. See `_fit_milestone_text`."""
    return _fit_milestone_text(
        draw, events, font_file=font_file, small_size=small_size, body_size=body_size,
        width=width, slot_height=slot_height, block_height=_neat_stack_block_height,
    )


def _fit_milestone_text(draw, events, *, font_file, small_size, body_size, width, slot_height, block_height):
    """Chooses the milestone fonts so every milestone's text fits its slot,
    with a clear gap before the next one.

    WHY THIS EXISTS. `render_png`'s shared `required_height` is a formula
    (date + title + two description lines) that leaves out the location
    line and assumes tighter spacing than the drawing uses. Measured on full
    milestones it under-counted by 21-25%, so text that "fit" filled its
    whole slot: 9px between milestones on the 8x10 edged print at text scale
    130 with long names, and outright overlap with eight milestones. It also
    reserved no space BETWEEN milestones at all.

    Same policy as the shared estimate — shrink in steps to the 0.55 floor,
    and drop descriptions to one line below 0.75 — but each step is checked
    against the real wrapped height of the tallest milestone plus one line
    of separation. Returns `(small_font, body_font, description_lines,
    block_height)`; at the floor it returns the floor even if that still
    does not fit, which the caller then places as high as the slot allows.
    """
    for shrink in _NEAT_STACK_SHRINK_STEPS:
        description_lines = 2 if shrink > 0.75 else 1
        small = _font(font_file, max(10, int(small_size * shrink)))
        body = _font(font_file, max(12, int(body_size * shrink)))
        separation = small.size
        tallest = max(
            (block_height(draw, event, small, body, width, description_lines) for event in events),
            default=0,
        )
        if tallest + separation <= slot_height:
            break
    return small, body, description_lines, tallest + separation

def _draw_cascade(
    image, draw, timeline, events, *, customer, palette,
    x, y, content_right, margin, band_height,
    small_font, body_font, body_font_file,
) -> int:
    """§7.3 — Overlapping Cascade. Mirrors `.layoutCascade` in the CSS.

    Photographs drift along one diagonal down the left, overlapping, while
    the timeline recedes to a hairline behind them.

    THE BAND IS DIVIDED AS THE PREVIEW DIVIDES IT (see `CascadeGeometry`):
    `count + photo_overlap` slots, half the overlap spare at each end. In its
    slot each milestone gets

    * a CARD, tilted (+2.5/-2.5 here, the preview's rotate(-2.5deg)/
      rotate(2.5deg)), with the preview's shadow and a 1:1.15 photograph,
      sized so its whole tilted outline fits 1 + `photo_overlap` slots, with
      room for the shadow kept at the two ends (`_overlapping_stack_layout`): it
      overlaps its neighbours, never the header rule or the footer.
      It used to be sized from the photo, 1.20-1.44x its slot, and crossed
      both in 107 of 108 realistic renders.
    * a DRIFT along the diagonal, spread evenly from the first card to the
      last and narrowed so no card leaves its column (the first card used to
      run off the page or over the frame line);
    * TEXT measured and fitted (`_fit_milestone_text`), wrapped and never
      cut, centred on the slot as the preview centres it. Titles were one
      unwrapped line (off the page in 19 renders), and the text started a
      fixed 22% of a slot above the middle, so long milestones ran into the
      next;
    * a NODE on the spine, level with the date line, as the preview has it.
    """
    geometry = geometry_for("overlapping-cascade")
    count = max(len(events), 1)
    layout = _overlapping_stack_layout(
        "overlapping-cascade", x=x, content_right=content_right, margin=margin, band_height=band_height, count=count,
    )
    photo_col_w, spine_x, text_x, text_w = layout["photo_col_w"], layout["spine_x"], layout["text_x"], layout["text_w"]
    photo_w, photo_h, border, bottom_border = layout["photo_w"], layout["photo_h"], layout["border"], layout["bottom_border"]
    reserve, slot, spread = layout["reserve"], layout["slot"], layout["spread"]
    overlap = geometry.photo_overlap
    to_poster = image.width / geometry.preview_poster_px
    to_print = photo_w / geometry.preview_photo_px

    inset = int(band_height * geometry.spine_inset)
    draw.line(
        [(spine_x, y + inset), (spine_x, y + band_height - inset)],
        fill=palette["line"], width=max(1, round(geometry.spine_width_px * to_poster)),
    )

    small_font, body_font, description_lines, _ = _fit_milestone_text(
        draw, events, font_file=body_font_file, small_size=small_font.size, body_size=body_font.size,
        width=text_w, slot_height=int(slot), block_height=_cascade_block_height,
    )
    node = max(4, round(geometry.node_size_px * to_poster))

    for index, event in enumerate(events):
        middle = y + reserve + round(slot * (index + 0.5 + overlap / 2))

        if event.photo_asset_id and customer is not None:
            # One diagonal rather than an alternation — the move that
            # distinguishes this composition from 7.2.
            offset = index / max(1, count - 1) - 0.5
            # CSS rotates clockwise for a positive angle and Pillow
            # anticlockwise: the preview's rotate(-2.5deg) on odd cards is
            # +2.5 here, rotate(2.5deg) on even cards is -2.5.
            tilt_deg = geometry.photo_tilt_deg if index % 2 == 0 else -geometry.photo_tilt_even_deg
            _paste_polaroid(
                image, customer=customer, asset_id=event.photo_asset_id,
                centre_x=x + photo_col_w // 2 + round(offset * spread), centre_y=middle,
                photo_size=photo_w, photo_height=photo_h, border=border, bottom_border=bottom_border,
                tilt_deg=tilt_deg,
                shadow_offset=round(geometry.card_shadow_offset_px * to_print),
                shadow_sigma=geometry.card_shadow_blur_px / 2 * to_print,
                shadow_opacity=geometry.card_shadow_opacity,
            )

        block = _cascade_block_height(draw, event, small_font, body_font, text_w, description_lines)
        text_y = middle - block // 2
        date = format_event_date(event.date)
        date_box = draw.textbbox((text_x, text_y), date, font=small_font)
        date_middle = (date_box[1] + date_box[3]) // 2
        draw.ellipse(
            [spine_x - node / 2, date_middle - node / 2, spine_x + node / 2, date_middle + node / 2],
            fill=palette["muted"],
        )

        # Drawn as Neat Stack draws its text, which `_cascade_block_height`
        # measures: date, wrapped title, description, wrapped location.
        draw.text((text_x, text_y), date, font=small_font, fill=palette["text"])
        text_y += int(small_font.size * geometry.date_line_height)
        text_y = _draw_wrapped(
            draw, event.title, body_font, x=text_x, y=text_y, max_width=text_w,
            max_lines=_NO_LINE_LIMIT, fill=palette["text"], line_spacing=int(body_font.size * geometry.text_line_height),
        )
        if event.description:
            text_y = _draw_wrapped(
                draw, event.description, small_font, x=text_x, y=text_y, max_width=text_w,
                max_lines=description_lines, fill=palette["muted"], line_spacing=int(small_font.size * geometry.text_line_height),
            ) or text_y + int(small_font.size * geometry.text_line_height)
        if event.location:
            _draw_wrapped(
                draw, event.location, small_font, x=text_x, y=text_y, max_width=text_w,
                max_lines=_NO_LINE_LIMIT, fill=palette["muted"], line_spacing=int(small_font.size * geometry.text_line_height),
            )

    return y + band_height


def _overlapping_stack_layout(layout_id, *, x, content_right, margin, band_height, count) -> dict:
    """The columns, card size and slots of the two portrait layouts whose cards
    overlap (Overlapping Cascade and Dotted Branching) — one definition,
    shared by the drawing and by `_names_font_for_milestones`'s fit check.
    See `_draw_cascade` and `CascadeGeometry`; Dotted has no drift."""
    geometry = geometry_for(layout_id)
    content_width = content_right - x - margin
    photo_col_w = int(content_width * geometry.photo_column)
    spine_x = x + int(content_width * geometry.spine_position)
    text_x = x + int(content_width * geometry.text_start)
    text_w = max(40, (content_right - margin) - text_x)
    overlap = geometry.photo_overlap

    # The whole tilted card inside 1 + overlap slots: per pixel of photo
    # width, the outline is (h cos + w sin) tall. No wider than the column
    # share, borders included.
    #
    # The SHADOW needs room only at the two ends — between cards it falls on
    # the next card, as in the preview — so the slots are laid out inside
    # the band less `reserve` at the top and bottom, the shadow's visible
    # extent (2.25 sigma plus its offset below; see `_draw_alternating`).
    # Counting it in every card instead left neighbours overlapping by 5% of
    # a slot against the preview's 22%. The reserve scales with the card, so
    # the card is solved for: photo_w x tilted = (band - 2 reserve) x k - gap,
    # with k = (1 + overlap) / (count + overlap).
    tilt = math.radians(max(abs(geometry.photo_tilt_deg), abs(geometry.photo_tilt_even_deg)))
    frame_w = 1 + 2 * geometry.polaroid_border
    frame_h = geometry.photo_aspect + geometry.polaroid_border + geometry.polaroid_bottom_border
    tilted = frame_h * math.cos(tilt) + frame_w * math.sin(tilt)
    shadow_below = (
        geometry.card_shadow_offset_px + 2.25 * geometry.card_shadow_blur_px / 2
    ) / geometry.preview_photo_px
    k = (1 + overlap) / (count + overlap)
    card_gap = max(2, int(band_height / (count + overlap) * 0.02))
    photo_w = max(1, min(
        int((band_height * k - card_gap) / (tilted + 2 * shadow_below * k)) - 2,
        int(photo_col_w * geometry.photo_width / frame_w),
    ))
    reserve = math.ceil(photo_w * shadow_below)
    slot = (band_height - 2 * reserve) / (count + overlap)
    photo_h = round(photo_w * geometry.photo_aspect)
    border = int(photo_w * geometry.polaroid_border)
    bottom_border = int(photo_w * geometry.polaroid_bottom_border)

    # The drift, narrowed so the widest tilted card stays inside its column
    # (the preview: `min(22cqw, 100cqw - tilted width)`).
    card_w, card_h = photo_w + 2 * border, photo_h + border + bottom_border
    tilted_w = card_w * math.cos(tilt) + card_h * math.sin(tilt)
    spread = max(0.0, min(photo_col_w * getattr(geometry, "drift", 0.0), photo_col_w - tilted_w - 2))

    return {
        "photo_col_w": photo_col_w, "spine_x": spine_x, "text_x": text_x, "text_w": text_w,
        "photo_w": photo_w, "photo_h": photo_h, "border": border, "bottom_border": bottom_border,
        "reserve": reserve, "slot": slot, "spread": spread,
    }


def _cascade_block_height(draw, event, small_font, body_font, width, description_lines) -> int:
    """The height `_draw_cascade` advances through for one milestone. It
    draws the same four parts with the same spacing as Neat Stack."""
    return _neat_stack_block_height(draw, event, small_font, body_font, width, description_lines)


def _draw_alternating(
    image, draw, timeline, events, *, customer, palette, scale,
    x, y, content_right, margin, slot_height,
    small_font, body_font, body_font_file,
) -> int:
    """§7.2 — Alternating Tilt. Mirrors `.layoutAlternating` in the CSS.

    A milestone's photograph and its text sit on OPPOSITE sides of the
    spine, and both flip each milestone. Same-side would collapse this into
    7.1 with a zigzag.

    Text reads inward toward the spine: on the LEADING half (left, in LTR)
    it is right-aligned, on the trailing half left-aligned — the preview's
    `.altTextStart { text-align: end }` and `.altText { text-align: start }`.
    (This docstring used to claim the trailing half was right-aligned while
    the code aligned nothing; both were wrong against the preview.)

    Every milestone gets an equal slot, as every preview row gets an equal
    share of the height (`grid-auto-rows: minmax(0, 1fr)`). In its slot:

    * the CARD, tilted (+4/-4 here, the preview's rotate(-4deg)/rotate(4deg))
      with the preview's shadow, is sized so its whole tilted outline fits
      the slot with a gap — it used to be sized from the photo and came out
      1.01-1.14x its slot, crossing the header rule and the footer and
      landing on the next milestone's text;
    * the TEXT is measured and fitted (`_fit_milestone_text`), wrapped and
      never cut, and centred on the slot as the preview centres it
      (`align-items: center`).
    """
    geometry = geometry_for("alternating-tilt")
    content_width = content_right - x - margin

    side_w = int(content_width * geometry.side_column)
    spine_x = x + int(content_width * geometry.spine_position)
    trailing_x = spine_x + (spine_x - x - side_w)

    draw.line(
        [(spine_x, y + int(slot_height * 0.04)),
         (spine_x, y + (slot_height * len(events)) - int(slot_height * 0.04))],
        fill=palette["text"], width=max(1, int(geometry.spine_width_px * scale)),
    )

    # The whole tilted card fits its slot: (h cos + w sin) of the card, with
    # a gap, and no wider than the preview's 86% of the column (the CSS
    # width is the card's, borders included).
    tilt = math.radians(max(abs(geometry.photo_tilt_deg), abs(geometry.photo_tilt_even_deg)))
    frame_h = 1 + geometry.polaroid_border + geometry.polaroid_bottom_border
    frame_w = 1 + 2 * geometry.polaroid_border
    card_gap = max(2, int(slot_height * 0.05))
    # The SHADOW stays inside the slot too. In the preview it cannot leave
    # the timeline (`.timeline` clips), but on the print the last card's
    # shadow reached "To be continued..." on the poster. It is visible out to
    # 2.25 sigma (past that, 16% of the blurred edge rounds to 0) and reaches
    # further down by its offset; per pixel of photo, since both scale with
    # it. The card is centred, so the deeper (lower) side bounds both.
    shadow_below = (
        geometry.card_shadow_offset_px + 2.25 * geometry.card_shadow_blur_px / 2
    ) / geometry.preview_photo_px
    photo_size = max(1, min(
        int((slot_height - card_gap)
            / (frame_h * math.cos(tilt) + frame_w * math.sin(tilt) + 2 * shadow_below)) - 2,
        int(side_w * geometry.photo_width / frame_w),
    ))
    border = int(photo_size * geometry.polaroid_border)
    bottom_border = int(photo_size * geometry.polaroid_bottom_border)
    to_print = photo_size / geometry.preview_photo_px

    small_font, body_font, description_lines, _ = _fit_milestone_text(
        draw, events, font_file=body_font_file, small_size=small_font.size, body_size=body_font.size,
        width=side_w, slot_height=slot_height, block_height=_alternating_block_height,
    )
    heart = max(8, round(geometry.node_size_px * image.width / geometry.preview_poster_px))

    for index, event in enumerate(events):
        middle = y + (index * slot_height) + (slot_height // 2)
        photo_on_leading = index % 2 == 0

        photo_col_x = x if photo_on_leading else trailing_x
        text_col_x = trailing_x if photo_on_leading else x

        if event.photo_asset_id and customer is not None:
            # CSS rotates clockwise for a positive angle and Pillow
            # anticlockwise: the preview's rotate(-4deg) on odd cards is +4
            # here, rotate(4deg) on even cards is -4.
            tilt_deg = geometry.photo_tilt_deg if index % 2 == 0 else -geometry.photo_tilt_even_deg
            _paste_polaroid(
                image, customer=customer, asset_id=event.photo_asset_id,
                centre_x=photo_col_x + side_w // 2, centre_y=middle,
                photo_size=photo_size, border=border, bottom_border=bottom_border, tilt_deg=tilt_deg,
                shadow_offset=round(geometry.card_shadow_offset_px * to_print),
                shadow_sigma=geometry.card_shadow_blur_px / 2 * to_print,
                shadow_opacity=geometry.card_shadow_opacity,
            )

        # The preview's node is a heart (`.altNode`, 14px on its 540px
        # poster), not a dot.
        _draw_heart(image, spine_x, middle, heart, palette["text"])

        # Text on the leading half reads inward: right-aligned to the spine.
        inward = not photo_on_leading
        block = _alternating_block_height(draw, event, small_font, body_font, side_w, description_lines)
        text_y = middle - block // 2
        lines = dict(x=text_col_x, max_width=side_w, right_aligned=inward)
        text_y = _draw_wrapped(
            draw, format_event_date(event.date), small_font, y=text_y, max_lines=_NO_LINE_LIMIT,
            fill=palette["text"], line_spacing=int(small_font.size * geometry.date_line_height), **lines,
        )
        # Wrapped, never cut: a 40-character title used to be one line that
        # crossed the spine or ran off the page.
        text_y = _draw_wrapped(
            draw, event.title, body_font, y=text_y, max_lines=_NO_LINE_LIMIT,
            fill=palette["text"], line_spacing=int(body_font.size * geometry.text_line_height), **lines,
        )
        if geometry.shows_description and event.description:
            text_y = _draw_wrapped(
                draw, event.description, small_font, y=text_y, max_lines=description_lines,
                fill=palette["muted"], line_spacing=int(small_font.size * geometry.text_line_height), **lines,
            )
        # The location was never printed on this layout, though the preview
        # shows it under the milestone. Muted, after the description,
        # wrapped and never cut.
        if event.location:
            _draw_wrapped(
                draw, event.location, small_font, y=text_y, max_lines=_NO_LINE_LIMIT,
                fill=palette["muted"], line_spacing=int(small_font.size * geometry.text_line_height), **lines,
            )

    return y + (slot_height * len(events))


def _alternating_block_height(draw, event, small_font, body_font, width, description_lines) -> int:
    """The height `_draw_alternating` advances through for one milestone."""
    geometry = geometry_for("alternating-tilt")
    height = max(1, len(_wrap_text(draw, format_event_date(event.date), small_font, width))) * int(small_font.size * geometry.date_line_height)
    height += max(1, len(_wrap_text(draw, event.title, body_font, width))) * _line_pitch(body_font, int(body_font.size * geometry.text_line_height), event.title)
    if geometry.shows_description and event.description:
        lines = min(description_lines, max(1, len(_wrap_text(draw, event.description, small_font, width))))
        height += lines * _line_pitch(small_font, int(small_font.size * geometry.text_line_height), event.description)
    if event.location:
        height += len(_wrap_text(draw, event.location, small_font, width)) * _line_pitch(small_font, int(small_font.size * geometry.text_line_height), event.location)
    return height


#: The preview's heart (`.altNode` / `.dottedHeart`): an SVG path in a 12x12
#: viewBox, `M6 11S1 7.6 1 4.4A3 3 0 0 1 6 2.3 3 3 0 0 1 11 4.4C11 7.6 6 11 6 11Z`.
def _heart_outline(steps=24):
    def cubic(p0, p1, p2, p3):
        return [
            tuple(
                (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d
                for a, b, c, d in zip(p0, p1, p2, p3)
            )
            for t in (i / steps for i in range(1, steps + 1))
        ]

    def arc(p0, p1, radius):
        # SVG arc, large-arc 0, sweep 1, equal radii: centre from the chord.
        (x0, y0), (x1, y1) = p0, p1
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        dx, dy = x1 - x0, y1 - y0
        chord = math.hypot(dx, dy)
        h = math.sqrt(max(radius ** 2 - (chord / 2) ** 2, 0))
        # sweep=1 (clockwise on screen) with the small arc: centre to the right of travel.
        cx, cy = mx - h * dy / chord, my + h * dx / chord
        a0, a1 = math.atan2(y0 - cy, x0 - cx), math.atan2(y1 - cy, x1 - cx)
        if a1 < a0:
            a1 += 2 * math.pi
        return [(cx + radius * math.cos(a0 + (a1 - a0) * i / steps), cy + radius * math.sin(a0 + (a1 - a0) * i / steps))
                for i in range(1, steps + 1)]

    points = [(6, 11)]
    points += cubic((6, 11), (6, 11), (1, 7.6), (1, 4.4))   # S after M: first control = current point
    points += arc((1, 4.4), (6, 2.3), 3)
    points += arc((6, 2.3), (11, 4.4), 3)
    points += cubic((11, 4.4), (11, 7.6), (6, 11), (6, 11))
    return points


_HEART = _heart_outline()


def _draw_heart(image, centre_x, centre_y, size, fill) -> None:
    """The preview's heart, `size` pixels square (its 12x12 viewBox scaled),
    centred where the SVG box would be. Drawn 4x and downsampled: Pillow's
    polygons have no antialiasing."""
    big = size * 4
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).polygon([(px * big / 12, py * big / 12) for px, py in _HEART], fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    image.paste(ImageColor.getrgb(fill), (int(centre_x - size / 2), int(centre_y - size / 2)), mask)


def _dotted_indent(page_width) -> int:
    """How far a Dotted milestone's title starts right of the text column: the
    heart and the space after it, at the preview's share of the page."""
    geometry = geometry_for("dotted-branching")
    to_poster = page_width / geometry.preview_poster_px
    return round(geometry.heart_size_px * to_poster) + round(geometry.label_gap_px * to_poster)


def _dotted_block_height(draw, event, small_font, body_font, width, description_lines, indent=0) -> int:
    """The height `_draw_dotted` advances through for one milestone: the date
    chip's line, the title (wrapped to the width left of the heart) and the
    location (wrapped). Descriptions are not drawn on this layout."""
    line = geometry_for("dotted-branching").text_line_height
    height = int(small_font.size * 1.5)
    height += max(1, len(_wrap_text(draw, event.title, body_font, max(1, width - indent)))) * _line_pitch(body_font, int(body_font.size * line), event.title)
    if event.location:
        height += len(_wrap_text(draw, event.location, small_font, width)) * _line_pitch(small_font, int(small_font.size * line), event.location)
    return height


def _draw_dotted(
    image, draw, timeline, events, *, customer, palette,
    x, y, content_right, margin, band_height,
    small_font, body_font, body_font_file,
) -> int:
    """§7.4 — Dotted Branching. Mirrors `.layoutDotted` in the CSS.

    Distinguished from 7.1 by a dotted, faint spine with the date sitting on
    the line and interrupting it, and a heart before each label.

    Laid out as Overlapping Cascade (see `CascadeGeometry`, `_draw_cascade`):
    `count + photo_overlap` equal slots with half the overlap spare at each
    end. In its slot each milestone gets

    * a CARD, centred in the photo column and tilted (+3/-3 here, the
      preview's rotate(-3deg)/rotate(3deg)) with the preview's shadow and a
      1:1.12 photograph, whose whole tilted outline fits 1 + `photo_overlap`
      slots. It used to be 1.03-1.38x its slot (the first over the header
      rule and the last over the footer in 102 of 108 renders), stepped
      0/5/10% to the right, flat, with a square photo in a 1:1.12 card;
    * TEXT measured and fitted (`_fit_milestone_text`), wrapped and never
      cut, centred on the slot as the preview centres it: the date, then the
      heart and the title, then the location. (Titles were one unwrapped
      line, off the page in 19 renders; text started at fixed offsets.)

    THE DATE CHIP is the first line of the milestone, starting on the spine
    and running right with the page background behind it, so it punches
    through the dotted line, which runs unbroken underneath. The full date is
    wider than the gutter between the cards and the text, which is why it
    cannot be centred on the spine as it was: it sat 21px off it, over the
    cards' edge, in the preview, and reached into both columns in the print.
    """
    geometry = geometry_for("dotted-branching")
    count = max(len(events), 1)
    layout = _overlapping_stack_layout(
        "dotted-branching", x=x, content_right=content_right, margin=margin, band_height=band_height, count=count,
    )
    photo_col_w, spine_x, text_x, text_w = layout["photo_col_w"], layout["spine_x"], layout["text_x"], layout["text_w"]
    photo_w, photo_h, border, bottom_border = layout["photo_w"], layout["photo_h"], layout["border"], layout["bottom_border"]
    reserve, slot = layout["reserve"], layout["slot"]
    overlap = geometry.photo_overlap
    to_poster = image.width / geometry.preview_poster_px
    to_print = photo_w / geometry.preview_photo_px

    # The dotted line, at the preview's share of the page width: the dash
    # figures are CSS pixels on its 540px poster.
    dash = max(2, round(geometry.dash_length_px * to_poster))
    gap = max(2, round(geometry.dash_gap_px * to_poster))
    line_width = max(1, round(geometry.spine_width_px * to_poster))
    inset = int(band_height * geometry.spine_inset)
    cursor, span_bottom = y + inset, y + band_height - inset
    while cursor < span_bottom:
        end = min(cursor + dash, span_bottom)
        draw.line([(spine_x, cursor), (spine_x, end)], fill=palette["line"], width=line_width)
        cursor = end + gap

    indent = _dotted_indent(image.width)
    heart = max(4, round(geometry.heart_size_px * to_poster))
    chip_pad = max(2, round(geometry.chip_pad_px * to_poster))
    small_font, body_font, description_lines, _ = _fit_milestone_text(
        draw, events, font_file=body_font_file, small_size=small_font.size, body_size=body_font.size,
        width=text_w, slot_height=int(slot), block_height=functools.partial(_dotted_block_height, indent=indent),
    )
    row_height = int(small_font.size * 1.5)

    for index, event in enumerate(events):
        middle = y + reserve + round(slot * (index + 0.5 + overlap / 2))

        if event.photo_asset_id and customer is not None:
            # CSS rotates clockwise for a positive angle and Pillow
            # anticlockwise: the preview's rotate(-3deg) on odd cards is +3
            # here, rotate(3deg) on even cards is -3.
            tilt_deg = geometry.photo_tilt_deg if index % 2 == 0 else -geometry.photo_tilt_even_deg
            _paste_polaroid(
                image, customer=customer, asset_id=event.photo_asset_id,
                centre_x=x + photo_col_w // 2, centre_y=middle,
                photo_size=photo_w, photo_height=photo_h, border=border, bottom_border=bottom_border,
                tilt_deg=tilt_deg,
                shadow_offset=round(geometry.card_shadow_offset_px * to_print),
                shadow_sigma=geometry.card_shadow_blur_px / 2 * to_print,
                shadow_opacity=geometry.card_shadow_opacity,
            )

        block = _dotted_block_height(draw, event, small_font, body_font, text_w, description_lines, indent)
        top = middle - block // 2

        # The date chip: its text starts on the spine, its background (the
        # page's own) starts `chip_pad` before it and ends `chip_pad` after.
        date = format_event_date(event.date)
        advance = draw.textlength(date, font=small_font)
        draw.rectangle(
            [spine_x - chip_pad, top, spine_x + advance + chip_pad, top + row_height], fill=palette["bg"],
        )
        draw.text((spine_x, top), date, font=small_font, fill=palette["muted"])

        # The heart, level with the title's first line, then the title.
        label_top = top + row_height
        glyphs = draw.textbbox((0, label_top), "Ag", font=body_font)
        _draw_heart(image, text_x + heart // 2, (glyphs[1] + glyphs[3]) // 2, heart, palette["accent"])
        text_y = _draw_wrapped(
            draw, event.title, body_font, x=text_x + indent, y=label_top, max_width=max(1, text_w - indent),
            max_lines=_NO_LINE_LIMIT, fill=palette["text"], line_spacing=int(body_font.size * geometry.text_line_height),
        )
        # The location, muted, under the title, wrapped and never cut. The
        # description is omitted by design on both sides ("photo-led").
        if event.location:
            _draw_wrapped(
                draw, event.location, small_font, x=text_x, y=text_y, max_width=text_w,
                max_lines=_NO_LINE_LIMIT, fill=palette["muted"], line_spacing=int(small_font.size * geometry.text_line_height),
            )

    return y + band_height


def _horizontal_columns(geometry, *, x, content_right, margin, count):
    """The content width, the gap between columns and one column's width:
    CSS `column-gap: 2%` of the box and `grid-auto-columns: 1fr`."""
    content_width = content_right - x - margin
    gap = round(content_width * geometry.column_gap)
    return content_width, gap, (content_width - gap * (count - 1)) / count


def _polaroid_card(geometry, card_w):
    """Photograph width, border and the card's own width for a card up to
    `card_w` wide (borders included, as the CSS width is border-box)."""
    photo = max(8, int(card_w / (1 + 2 * geometry.polaroid_border)))
    border = max(1, round(photo * geometry.polaroid_border))
    return photo, border, photo + 2 * border


def _polaroid_extent(geometry, font, card_w, caption_lines, date_lines, caption_text=""):
    """What one Polaroid milestone occupies at `font`, from the top of its
    row: the room the tilted card and its shadow need ABOVE the layout top
    (`top_pad`), the card's height, the date's height. The caption is the
    card's bottom border, so it makes the card taller, as in the preview."""
    photo, border, card_w = _polaroid_card(geometry, card_w)
    photo_h = round(photo * geometry.photo_aspect)
    line_h = _line_pitch(font, int(font.size * geometry.caption_line_height), caption_text)
    pad_top = round(geometry.caption_pad_top_em * font.size)
    band = pad_top + caption_lines * line_h + round(geometry.caption_pad_bottom_em * font.size)
    card_h = border + photo_h + band
    date_gap = round(geometry.date_gap_em * font.size)
    date_h = date_gap + date_lines * int(font.size * geometry.date_line_height)
    tilt = math.radians(max(geometry.photo_tilt_deg, geometry.photo_tilt_even_deg))
    to_print = photo / geometry.preview_photo_px
    sigma = geometry.card_shadow_blur_px / 2 * to_print
    reach = (card_h * math.cos(tilt) + card_w * math.sin(tilt) - card_h) / 2
    reach += max(0.0, 2.25 * sigma - round(geometry.card_shadow_offset_px * to_print))
    return {
        "photo": photo, "photo_h": photo_h, "border": border, "card_w": card_w, "band": band, "card_h": card_h,
        "pad_top": pad_top, "line_h": line_h, "date_gap": date_gap, "date_h": date_h,
        "top_pad": math.ceil(max(reach, 0)),
    }


def _widest(draw, lines, font) -> float:
    """The advance of the widest of `lines`."""
    return max((draw.textlength(line, font=font) for line in lines), default=0)


def _horizontal_plan(draw, events, geometry, *, font_file, small_size, col_w, band_height, page_width):
    """Sizes for the landscape compositions, fitted to the band.

    Both Horizontal styles drew each title and date as ONE line in a column
    1/count of the page wide, and sized their text with the shared estimate,
    which divides the page HEIGHT by the milestone count although milestones
    are columns here: 70 and 66 of 108 realistic renders collided or ran off
    the page, all at 5 or 8 milestones. Now the text wraps to its column (or
    to the card) and shrinks in steps to `text_fit_floor` until the tallest
    milestone fits the band: the preview does the same with `FittedTimeline`.

    The CARD (7.5) is the column's 88%, or less when the band is short: the
    widest card whose milestone, with a ONE-line caption and a one-line date
    at the UNSHRUNK size, fits. Like the preview, it does not grow back as
    the text shrinks. A CIRCLE (7.6) is the column's 78%, as in the preview.
    """
    steps = [step for step in _NEAT_STACK_SHRINK_STEPS if step >= geometry.text_fit_floor]
    base = _font(font_file, small_size)
    to_poster = page_width / geometry.preview_poster_px

    if geometry.circular:
        diameter = round(geometry.photo_width * col_w)
        tick_h = max(2, round(geometry.tick_height_px * to_poster))
        axis_w = max(1, round(geometry.axis_width_px * to_poster))
        # The label and the date are lines of the same height.
        for step in steps:
            font = _font(font_file, max(10, int(small_size * step)))
            line_h = int(font.size * geometry.date_line_height)
            label_gap = round(geometry.label_gap_em * font.size)
            date_gap = round(geometry.date_gap_em * font.size)
            blocks, widest = [], 0
            for event in events:
                label = _wrap_text(draw, event.title, font, max(1, int(col_w))) or [""]
                date = _wrap_text(draw, format_event_date(event.date), font, max(1, int(col_w))) or [""]
                widest = max(widest, _widest(draw, label + date, font))
                blocks.append({
                    "label_gap": label_gap, "date_gap": date_gap, "line_h": line_h,
                    "height": diameter + tick_h + label_gap + len(label) * _line_pitch(font, line_h, event.title)
                    + date_gap + len(date) * line_h,
                })
            # A word cannot wrap: a line wider than the column also means
            # "does not fit", and the text shrinks until it does.
            if max(b["height"] for b in blocks) <= band_height and widest <= col_w:
                break
        return {"font": font, "diameter": diameter, "tick_h": tick_h, "axis_w": axis_w, "blocks": blocks}

    def single_line(card_w):
        extent = _polaroid_extent(geometry, base, card_w, 1, 1)
        return extent["top_pad"] + extent["card_h"] + extent["date_h"]

    low, high = 24, max(24, int(geometry.photo_width * col_w))
    while low < high:
        middle = (low + high + 1) // 2
        if single_line(middle) <= band_height:
            low = middle
        else:
            high = middle - 1
    card_w = low
    for step in steps:
        font = _font(font_file, max(10, int(small_size * step)))
        photo, border, _ = _polaroid_card(geometry, card_w)
        side = round(geometry.caption_pad_side_em * font.size)
        blocks, too_wide = [], False
        for event in events:
            caption = _wrap_text(draw, event.title, font, max(1, photo - 2 * side)) or [""]
            date = _wrap_text(draw, format_event_date(event.date), font, max(1, int(col_w))) or [""]
            too_wide = too_wide or _widest(draw, caption, font) > photo - 2 * side or _widest(draw, date, font) > col_w
            extent = _polaroid_extent(geometry, font, card_w, len(caption), len(date), caption_text=event.title)
            blocks.append({**extent, "caption": caption, "date": date})
        top_pad = max(b["top_pad"] for b in blocks)
        # A word cannot wrap: a line wider than its card (or the date wider
        # than the column) also means "does not fit".
        if max(top_pad + b["card_h"] + b["date_h"] for b in blocks) <= band_height and not too_wide:
            break
    return {"font": font, "card_w": card_w, "top_pad": top_pad, "blocks": blocks}


def _draw_horizontal(
    image, draw, timeline, events, *, customer, palette,
    x, y, content_right, margin, band_height, small_font, body_font_file, page_width,
) -> int:
    """§7.5 / §7.6 — the landscape compositions. Mirrors `.layoutHorizontal`.

    Milestones become COLUMNS. Adding one makes every milestone narrower
    rather than making the page taller, which is the structural difference
    from the four portrait layouts and the reason these are recorded as
    strongest at 5-7.

    7.5 draws a Polaroid, tilted (+1.5/-1.5 here, the preview's
    rotate(-1.5deg)/rotate(1.5deg)) with the preview's shadow and a 1:1.15
    photograph, the caption wrapped inside its lower border and tilting with
    it, and the date below. 7.6 draws a circular photograph above a ticked
    axis with the label and date below. `circular` in the geometry selects
    between them. Everything is top-aligned, as the preview's grid is.
    """
    geometry = geometry_for(timeline.layout)
    count = max(1, len(events))
    content_width, gap, col_w = _horizontal_columns(
        geometry, x=x, content_right=content_right, margin=margin, count=count,
    )
    plan = _horizontal_plan(
        draw, events, geometry, font_file=body_font_file, small_size=small_font.size,
        col_w=col_w, band_height=band_height, page_width=page_width,
    )
    font = plan["font"]

    if geometry.circular:
        axis_y = y + plan["diameter"]
        inset = round(content_width * geometry.axis_inset)
        draw.line(
            [(x + inset, axis_y), (x + content_width - inset, axis_y)],
            fill=blend(palette["text"], palette["bg"], 0.85), width=plan["axis_w"],
        )

    for index, event in enumerate(events):
        col_x = x + round(index * (col_w + gap))
        centre_x = col_x + int(col_w) // 2
        block = plan["blocks"][index]

        if geometry.circular:
            diameter = plan["diameter"]
            if event.photo_asset_id and customer is not None:
                _paste_photo(
                    image, customer=customer, asset_id=event.photo_asset_id,
                    x=centre_x - diameter // 2, y=y, size=diameter, circular=True,
                )
            draw.line(
                [(centre_x, axis_y), (centre_x, axis_y + plan["tick_h"])],
                fill=blend(palette["text"], palette["bg"], 0.7), width=plan["axis_w"],
            )
            label_y = axis_y + plan["tick_h"] + block["label_gap"]
            label_y = _draw_wrapped(
                draw, event.title, font, x=col_x, y=label_y, max_width=int(col_w), max_lines=_NO_LINE_LIMIT,
                fill=palette["text"], line_spacing=block["line_h"], centered=True,
            )
            _draw_wrapped(
                draw, format_event_date(event.date), font, x=col_x, y=label_y + block["date_gap"],
                max_width=int(col_w), max_lines=_NO_LINE_LIMIT,
                fill=palette["muted"], line_spacing=block["line_h"], centered=True,
            )
            continue

        card_top = y + plan["top_pad"]
        if event.photo_asset_id and customer is not None:
            # CSS rotates clockwise for a positive angle and Pillow
            # anticlockwise: the preview's rotate(-1.5deg) on the 1st, 3rd...
            # card is +1.5 here, rotate(1.5deg) on the 2nd, 4th... is -1.5.
            tilt_deg = geometry.photo_tilt_deg if index % 2 == 0 else -geometry.photo_tilt_even_deg
            to_print = block["photo"] / geometry.preview_photo_px
            _paste_polaroid(
                image, customer=customer, asset_id=event.photo_asset_id,
                centre_x=centre_x, centre_y=card_top + block["card_h"] // 2,
                photo_size=block["photo"], photo_height=block["photo_h"],
                border=block["border"], bottom_border=block["band"], tilt_deg=tilt_deg,
                shadow_offset=round(geometry.card_shadow_offset_px * to_print),
                shadow_sigma=geometry.card_shadow_blur_px / 2 * to_print,
                shadow_opacity=geometry.card_shadow_opacity,
                caption={
                    "lines": block["caption"], "font": font, "fill": palette["text"],
                    "top": block["border"] + block["photo_h"] + block["pad_top"], "line_height": block["line_h"],
                },
            )
        _draw_wrapped(
            draw, format_event_date(event.date), font, x=col_x,
            y=card_top + block["card_h"] + block["date_gap"], max_width=int(col_w), max_lines=_NO_LINE_LIMIT,
            fill=palette["muted"], line_spacing=int(font.size * geometry.date_line_height), centered=True,
        )

    return y + band_height


def _draw_centered(draw, text, font, *, centre_x, y, fill):
    """Centres a single line on a column. Used only by the landscape
    compositions, where everything is centred under its photograph."""
    if not text:
        return
    try:
        bbox = draw.textbbox((0, 0), text, font=font)
        width = bbox[2] - bbox[0]
    except Exception:  # noqa: BLE001 - very old Pillow
        width = len(text) * (font.size // 2)
    draw.text((centre_x - width // 2, y), text, font=font, fill=fill)


def _draw_centered_wrapped(draw, text, font, *, centre_x, y, max_width, max_lines, fill, line_spacing) -> int:
    """`_draw_centered` for text that may be wider than its column: wraps to
    at most `max_lines` (ellipsis on the last if more would not fit) and
    centres each line. Returns the y just below the drawn text, so a single
    line advances by exactly `line_spacing` — what a caller that used to draw
    one line and add a fixed offset already assumed.
    """
    lines = _wrap_text(draw, text, font, max_width)
    truncated = len(lines) > max_lines
    lines = lines[:max_lines]
    if truncated and lines:
        last = lines[-1]
        while last and draw.textbbox((0, 0), last + "…", font=font)[2] > max_width:
            last = last[:-1]
        lines[-1] = last + "…"
    line_spacing = _line_pitch(font, line_spacing, text)
    for line in lines:
        _draw_centered(draw, line, font, centre_x=centre_x, y=y, fill=fill)
        y += line_spacing
    return y


def _render_moment_wallpaper(timeline, *, device, index: int, customer, locale: str) -> bytes:
    """§13 — one milestone, filling a device screen.

    A different composition from the story wallpaper rather than a tighter
    crop of it. The timeline shrunk to a phone is legible at arm's length
    and unreadable on a lock screen; a single memory is the thing people
    actually keep.

    THE SAFE ZONES STILL GOVERN, and they matter more here than anywhere:
    the photograph fills the whole screen, so the caption is the only thing
    that can be pushed out of the clock's way. Text sits in the lower safe
    band, above the home indicator and below anything the OS draws at the
    top.

    A SCRIM SITS UNDER THE TEXT because a photograph is not a controlled
    background — white text on a pale sky is invisible, and this is the one
    surface where the background is entirely the customer's choice.
    """
    events = ordered_events(timeline)
    if index >= len(events):
        # Reachable if a project loses milestones between purchase and
        # download. Better a plain background than a 500 on a paid file.
        events = events or []

    palette = PALETTES[timeline.palette]
    image = Image.new("RGB", (device.width, device.height), palette["bg"])
    draw = ImageDraw.Draw(image)

    event = events[index] if index < len(events) else None

    if event is not None and event.photo_asset_id and customer is not None:
        # Cover the screen: scale to the larger ratio and centre-crop, so a
        # portrait photograph on a desktop wallpaper fills rather than
        # letterboxes.
        _paste_cover(
            image, customer=customer, asset_id=event.photo_asset_id,
            width=device.width, height=device.height,
        )

    scale = min(device.width, device.height) / 1200
    title_font = _font(FONT_FILES[timeline.typography]["heading"], max(22, int(46 * scale)))
    date_font = _font(FONT_FILES[timeline.typography]["body"], max(14, int(26 * scale)))

    # The caption band, inside the lower safe zone.
    band_bottom = device.height - int(device.height * device.safe_bottom)
    band_top = band_bottom - int(device.height * 0.16)

    # The scrim was TOO TALL and read as a colour block rather than a fade:
    # it covered roughly 40% of the screen. Shortened to a band just deep
    # enough to seat the caption, and eased so it is nearly invisible at the
    # top edge — a fade that starts abruptly is a panel with soft corners.
    scrim_height = int(device.height * 0.20)
    scrim_top = band_bottom - scrim_height
    scrim = Image.new("RGBA", (device.width, scrim_height), (0, 0, 0, 0))
    scrim_draw = ImageDraw.Draw(scrim)
    for row in range(scrim.height):
        # Cubic rather than the previous 0.7 power: the earlier curve rose
        # quickly and then flattened, which is what made it look like a
        # block. This stays near-transparent for the first half.
        alpha = int(170 * (row / scrim.height) ** 2.2)
        scrim_draw.line([(0, row), (scrim.width, row)], fill=(0, 0, 0, alpha))
    image.paste(Image.alpha_composite(
        image.crop((0, scrim_top, device.width, scrim_top + scrim.height)).convert("RGBA"), scrim
    ).convert("RGB"), (0, scrim_top))

    if event is not None:
        # Seated in the lower part of the scrim, where it is darkest, so
        # the text has contrast wherever the photograph is pale.
        # An Arabic title takes more room above its date (`_line_pitch`); the
        # caption rises by that much, so its foot stays where it was.
        title_pitch = int(title_font.size * 1.35)
        date_offset = _line_pitch(title_font, title_pitch, event.title)
        caption_y = band_bottom - int(title_font.size * 2.6) - (date_offset - title_pitch)
        _draw_centered(draw, event.title, title_font, centre_x=device.width // 2, y=caption_y, fill="#ffffff")
        _draw_centered(
            draw, format_event_date(event.date), date_font,
            centre_x=device.width // 2, y=caption_y + date_offset,
            fill="#eceae6",
        )

    _draw_attribution(
        draw, device.width, device.height, palette, scale,
        FONT_FILES[timeline.typography]["body"],
    )

    return _encode_png(image)


def _paste_cover(image, *, customer, asset_id: str, width: int, height: int) -> None:
    """Scales a photograph to COVER the canvas and centre-crops it.

    `_paste_photo` fits a square; a wallpaper needs the whole screen filled,
    and letterboxing a portrait photograph on a desktop wallpaper would
    leave bars the customer did not ask for.
    """
    raw_bytes, _mime = get_asset_bytes_for_customer(customer, asset_id)
    if not raw_bytes:
        return
    try:
        with Image.open(io.BytesIO(raw_bytes)) as photo:
            photo = photo.convert("RGB")
            ratio = max(width / photo.width, height / photo.height)
            resized = photo.resize((max(1, int(photo.width * ratio)), max(1, int(photo.height * ratio))))
            left = (resized.width - width) // 2
            top = (resized.height - height) // 2
            image.paste(resized.crop((left, top, left + width, top + height)), (0, 0))
    except Exception:  # noqa: BLE001 - a bad photo must not fail a paid download
        # Left as an empty background rather than raising: the customer paid
        # for this file, and a plain wallpaper beats a 500.
        pass


def _draw_attribution(draw, width: int, height: int, palette, scale: float, font_file) -> None:
    """The print mark, on a wallpaper's lower edge."""
    font = _font(font_file, max(10, int(18 * scale)))
    colour = blend(palette["muted"], palette["bg"], MARK_OPACITY)
    try:
        bbox = draw.textbbox((0, 0), PRINT_MARK, font=font)
        mark_w, mark_h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    except Exception:  # noqa: BLE001
        mark_w, mark_h = len(PRINT_MARK) * 8, font.size
    draw.text(
        ((width - mark_w) // 2, height - mark_h - int(height * 0.035)),
        PRINT_MARK, font=font, fill=colour,
    )


def _render_story_wallpaper(timeline, *, device, customer, locale: str) -> bytes:
    """§13 — the whole story, composed for a screen.

    THIS REPLACES SCALING THE POSTER ONTO A DEVICE SHAPE, which is what it
    used to do and what §13 explicitly rules out: "remain visually useful
    rather than simply shrinking the poster". Rendering the poster into a
    phone's aspect left dates and descriptions at a size nobody could read,
    and the safe zones made the squeeze worse rather than better.

    WHAT A PHONE WALLPAPER CAN ACTUALLY CARRY is the thing that decided this
    composition. Five dates, five titles and five descriptions do not fit
    legibly on a lock screen at arm's length — so it carries the
    PHOTOGRAPHS and the names, which is the emotional content, and drops
    the data, which the poster already holds.

    The photographs form a full-width column between the safe zones. Names
    sit in the lower band above the home indicator, where nothing the OS
    draws will land on them.
    """
    palette = PALETTES[timeline.palette]
    image = Image.new("RGB", (device.width, device.height), palette["bg"])
    draw = ImageDraw.Draw(image)
    events = ordered_events(timeline)

    top = int(device.height * device.safe_top)
    bottom = device.height - int(device.height * device.safe_bottom)
    left = int(device.width * device.safe_leading)
    usable_h = bottom - top
    usable_w = device.width - left

    scale = min(device.width, device.height) / 1200
    name_font = _font(FONT_FILES[timeline.typography]["heading"], max(18, int(46 * scale)))
    small_font = _font(FONT_FILES[timeline.typography]["body"], max(12, int(24 * scale)))

    # The names sit at the foot, so the photographs get everything above.
    caption_band = int(usable_h * 0.16)
    photo_area_h = usable_h - caption_band

    count = max(1, len(events))
    if device.id == "desktop":
        # A desktop screen is wide: a single column would leave two thirds
        # of it empty, which is exactly the failure being fixed. The
        # photographs run across instead.
        # A FILMSTRIP, not a row of small squares.
        #
        # Fitting squares into the cell width left them floating in a large
        # empty field, which is the same "poster in the wrong shape" failure
        # one step removed. Each photograph now fills its full cell — tall
        # crops across the screen — so the composition uses the space a
        # desktop actually has.
        gutter = max(2, int(6 * scale))
        cell_w = (usable_w - gutter * (count - 1)) // count
        strip_h = int(photo_area_h * 0.92)
        strip_y = top + (photo_area_h - strip_h) // 2
        for index, event in enumerate(events):
            if not (event.photo_asset_id and customer is not None):
                continue
            _paste_cover_region(
                image, customer=customer, asset_id=event.photo_asset_id,
                x=left + index * (cell_w + gutter), y=strip_y,
                width=cell_w, height=strip_h,
            )
    else:
        # Phone and tablet: one column, photographs stacked and cropped to
        # fill the width. Nothing is letterboxed, because a wallpaper with
        # bars is a wallpaper that looks broken.
        cell_h = photo_area_h // count
        for index, event in enumerate(events):
            if not (event.photo_asset_id and customer is not None):
                continue
            _paste_cover_region(
                image, customer=customer, asset_id=event.photo_asset_id,
                x=left, y=top + index * cell_h, width=usable_w, height=cell_h,
            )

    # WRAPPED, NOT ONE LINE. Two names at the 24-character ceiling are wider
    # than a phone or tablet at this size, and a single centred line ran off
    # both edges. §19 forbids shrinking type to fit, so the line wraps; one
    # line advances exactly as before, so short names are unchanged. The
    # ending text follows whatever height the names actually took.
    caption_margin = max(left, int(40 * scale))
    names_end_y = _draw_centered_wrapped(
        draw, join_names(timeline.people, locale), name_font,
        centre_x=device.width // 2, y=bottom - caption_band + int(10 * scale),
        max_width=device.width - 2 * caption_margin, max_lines=2,
        fill=palette["text"], line_spacing=int(name_font.size * 1.35),
    )
    if timeline.ending_text:
        _draw_centered(
            draw, timeline.ending_text, small_font,
            centre_x=device.width // 2,
            y=names_end_y,
            fill=palette["muted"],
        )

    _draw_attribution(
        draw, device.width, device.height, palette, scale,
        FONT_FILES[timeline.typography]["body"],
    )

    return _encode_png(image)


def _paste_cover_region(image, *, customer, asset_id: str, x: int, y: int, width: int, height: int) -> None:
    """Fills a rectangle with a photograph, cropping rather than fitting.

    `_paste_photo` fits a square and `_paste_cover` fills a whole canvas;
    this fills an arbitrary band, which is what a stacked wallpaper column
    needs. Letterboxing here would put bars between every photograph.
    """
    raw_bytes, _mime = get_asset_bytes_for_customer(customer, asset_id)
    if not raw_bytes:
        return
    try:
        with Image.open(io.BytesIO(raw_bytes)) as photo:
            photo = photo.convert("RGB")
            ratio = max(width / photo.width, height / photo.height)
            resized = photo.resize((max(1, int(photo.width * ratio)), max(1, int(photo.height * ratio))))
            crop_x = (resized.width - width) // 2
            crop_y = (resized.height - height) // 2
            image.paste(resized.crop((crop_x, crop_y, crop_x + width, crop_y + height)), (x, y))
    except Exception:  # noqa: BLE001
        pass


def _render_ar_card(timeline, *, customer, locale: str) -> bytes:
    """§21i — the per-order AR card.

    SERVES TWO PURPOSES AT ONCE, and the second one shapes the design.

    It is the card the customer prints and hands over. It is also the image
    MindAR compiles into a tracking target — and image tracking depends on
    high-contrast, non-repeating detail. `AR-VR-SCOPING.md` records that
    Heartfolio's art direction is close to the worst case for this: flat
    colour, thin type, generous negative space.

    So this composition is deliberately BUSIER than a poster. The
    photographs are large and placed asymmetrically, the timeline rule is
    heavy rather than hairline, and a dense corner motif sits opposite the
    QR. None of that is decoration for its own sake — it is feature density,
    which is what makes the card trackable at all.

    THE QR IS DRAWN BY THE CALLER, not here: it encodes the order's own
    experience URL, which this renderer has no access to. A reserved block
    is left for it, and the delivery layer composites it in.
    """
    palette = PALETTES[timeline.palette]
    width, height = CARD_WIDTH_PX, CARD_HEIGHT_PX
    image = Image.new("RGB", (width, height), palette["bg"])
    draw = ImageDraw.Draw(image)
    events = ordered_events(timeline)

    scale = width / 1200
    # Shared with the delivery layer, which composites the QR into the
    # block reserved below — see `ar_support.CARD_MARGIN_RATIO`.
    margin = int(width * CARD_MARGIN_RATIO)
    fonts = FONT_FILES[timeline.typography]
    title_font = _font(fonts["heading"], int(52 * scale))
    name_font = _font(fonts["body"], int(26 * scale))
    date_font = _font(fonts["body"], int(20 * scale))
    small_font = _font(fonts["body"], int(17 * scale))

    y = margin
    # Wrapped: with no poster title the title IS the names, and two long ones
    # ran off the card. One line advances exactly as before.
    y = _draw_wrapped(
        draw, timeline.poster_title or join_names(timeline.people, locale), title_font,
        x=margin, y=y, max_width=width - 2 * margin, max_lines=2, fill=palette["text"],
        line_spacing=int(title_font.size * 1.35),
    )
    # The names line only exists to say whose card it is UNDER a title. When
    # the customer has cleared the title, the names are already the title, and
    # repeating them a line below read as a mistake. Deliberately NOT replaced
    # by a story-type default: a title the customer removed must not come back.
    if timeline.poster_title:
        names = join_names(timeline.people, locale)
        draw.text((margin, y), names, font=name_font, fill=palette["muted"])
        y += _line_pitch(name_font, int(name_font.size * 2.2), names)
    else:
        # Just the breathing room above the rule; the subline's own line
        # height is gone with it.
        y += int(name_font.size)

    # A heavy rule rather than a hairline — see the docstring: the tracker
    # needs contrast, and a 1px line at 300dpi is invisible to it.
    rule_y = y
    draw.rectangle([margin, rule_y, width - margin, rule_y + max(3, int(5 * scale))], fill=palette["text"])
    y += int(28 * scale)

    # Photographs, large and alternating, filling most of the card.
    qr_block = int(width * CARD_QR_BLOCK_RATIO)
    photo_area_bottom = height - margin - qr_block - int(40 * scale)
    # THE CARD IS NOT A SUMMARY, and assuming it was is what kept the
    # photographs small.
    #
    # Showing all eight milestones divides the height eight ways, so each
    # photograph shrinks — which is both a worse object and worse for
    # tracking, since small flat squares give a tracker little to lock onto.
    # The card is a trigger and an invitation: the full story is what
    # appears when it is scanned, and the poster already holds the data.
    #
    # So it shows up to THREE, large, and says how many more there are.
    CARD_MILESTONES = 3
    shown = events[:CARD_MILESTONES]
    remaining = len(events) - len(shown)

    count = max(1, len(shown))
    slot = (photo_area_bottom - y) // count
    photo_size = min(int(width * 0.56), slot - int(12 * scale))

    for index, event in enumerate(shown):
        slot_top = y + index * slot
        on_left = index % 2 == 0
        px = margin if on_left else width - margin - photo_size

        if event.photo_asset_id and customer is not None:
            border = max(3, int(photo_size * 0.035))
            draw.rectangle(
                [px - border, slot_top - border, px + photo_size + border, slot_top + photo_size + border],
                fill="#ffffff",
            )
            _paste_photo(image, customer=customer, asset_id=event.photo_asset_id,
                         x=px, y=slot_top, size=photo_size)

        # Text sits ADJACENT to its photograph, not at the far margin.
        # Placing it at the opposite edge left a date floating unattached to
        # anything, which read as a mistake and added no density where it
        # was needed.
        gap = int(24 * scale)
        if on_left:
            text_x = margin + photo_size + gap
        else:
            text_x = width - margin - photo_size - gap - int(width * 0.26)
        draw.text((text_x, slot_top + int(10 * scale)), format_event_date(event.date),
                  font=date_font, fill=palette["accent"])
        draw.text((text_x, slot_top + int(10 * scale) + int(date_font.size * 1.5)), event.title,
                  font=small_font, fill=palette["text"])

        # A short rule tying the caption to its photograph — and one more
        # high-contrast edge for the tracker.
        rule_x = text_x
        rule_y2 = slot_top + int(10 * scale) + int(date_font.size * 3.1)
        draw.rectangle([rule_x, rule_y2, rule_x + int(width * 0.14), rule_y2 + max(2, int(3 * scale))],
                       fill=palette["line"])

    if remaining > 0:
        # Says what is missing rather than leaving the card looking like the
        # whole story — the point is to make someone scan it.
        draw.text(
            (margin, photo_area_bottom + int(10 * scale)),
            f"+ {remaining} more, when you scan",
            font=small_font, fill=palette["muted"],
        )

    # The reserved QR block, drawn as an outline so a card rendered without
    # one is obviously incomplete rather than subtly wrong.
    qr_x = width - margin - qr_block
    qr_y = height - margin - qr_block
    draw.rectangle([qr_x, qr_y, qr_x + qr_block, qr_y + qr_block],
                   outline=palette["line"], width=max(2, int(3 * scale)))

    # The instruction that stops people scanning and then not knowing to
    # look back down at the card.
    draw.text((margin, qr_y + int(qr_block * 0.35)),
              "Scan, then hold your camera", font=small_font, fill=palette["muted"])
    draw.text((margin, qr_y + int(qr_block * 0.35) + int(small_font.size * 1.5)),
              "over this card.", font=small_font, fill=palette["muted"])

    _draw_attribution(draw, width, height, palette, scale, fonts["body"])

    return _encode_png(image)
