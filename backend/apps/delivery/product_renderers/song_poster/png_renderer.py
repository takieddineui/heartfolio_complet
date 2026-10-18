"""
Player theme — Pillow renderer.

The authored composition mirrors `player-theme.tsx`/`player-theme.
module.css` deliberately: same 800x1000 design canvas, same margins
(56/60px), same font sizes, scaled uniformly to whatever output size is
requested. This is the print/wallpaper side of the SAME theme the
Studio preview shows — not a separate design.

WHAT IS HONESTLY DIFFERENT FROM THE LIVE PREVIEW, AND WHY:

  PLAYBACK IS STATIC. A print or a wallpaper cannot play anything, so
  the progress row is drawn in its "not started" state — waveform bars
  dim and unplayed, no knob, elapsed reads 0:00. This is not a missing
  feature; nothing about a paper poster or a phone wallpaper should
  show `currentTime` mid-scrub.

  NO CODE IS PRINTED ON THE POSTER. Player used to print a decorative
  5x5 block (the prototype's `codeSVG`, which nothing could scan) under the
  designer's placeholder "CODE POSITION — LINKS TO YOUR PAGE": a promise of
  a link nothing provided, which the Studio preview never showed (removed
  18 Oct 2026). `render()` receives the `project`, not the owning order, so
  there is no live-page link to encode here; the real, scannable gift QR
  ships as its own file (the QR cards), as Love Story Timeline's does.

  EDGED IS A SCALED INSET, NOT A RE-LAYOUT. `print_sizes.py`'s own
  docstring is explicit that Love Story Timeline's `edged` variant
  re-flows content into a smaller box — different text wrapping, not a
  shrunk copy. Player's composition does not yet have that per-size
  authored re-layout; `edged` here scales the same design to fit inside
  the safe margin, background-filled around it. Stated as a real,
  deliberate simplification rather than silently claimed as equivalent
  to Love Story Timeline's approach.
"""

from __future__ import annotations

import io
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from apps.assets.services import get_asset_bytes_for_customer
from apps.common.exceptions.api_errors import SongPosterRenderFailed
from apps.delivery.attribution import MARK_OPACITY, MARK_SCALE, PRINT_MARK, blend
from apps.delivery.print_sizes import EDGED, edged_margin_px, parse_print_target, print_target_dimensions
from apps.delivery.wallpaper_devices import parse_wallpaper_target

from .data import NormalizedSongPoster
from .waveform import downsample, generate_envelope, seed_for_order

#: The authored design canvas — identical to `player-theme.tsx`'s
#: `CANVAS_WIDTH`/`CANVAS_HEIGHT`. Every measurement below is tuned
#: against these numbers, exactly like the frontend CSS module is.
DESIGN_W = 800
DESIGN_H = 1000

_FONT_DIR = Path(__file__).parent.parent / "love_story_timeline" / "fonts"
# Reuses Love Story Timeline's bundled DejaVu set rather than duplicating
# the same four files into a second product folder — one licensed,
# embeddable font family, shared across every renderer that needs one.

_INK = "#18191a"
_SOFT = "#6b6a63"
_BG = "#f6f3ec"
_RULE = "#d8d4c8"

_EQ_BARS = 60

#: Player's dedication, from `player-theme.module.css`: `.bottom` sits
#: `bottom: 32px` inside the sheet with `inset-inline: 60px`, and its
#: `.message` is 13.5px at line-height 1.5 with a 20px bottom margin, so
#: the message's line box ends 52px above the sheet's bottom edge.
#: `composition`-style parity: `player-print-parity.test.ts` reads these
#: and the CSS and fails if they disagree.
PLAYER_BOTTOM_PX = 32
PLAYER_MESSAGE_MARGIN_BOTTOM_PX = 20
PLAYER_MESSAGE_SIZE_PX = 13.5
PLAYER_MESSAGE_LINE_HEIGHT = 1.5
PLAYER_MESSAGE_INSET_PX = 60


def _font(name: str, size_at_design_scale: float, scale: float) -> ImageFont.FreeTypeFont:
    size = max(8, round(size_at_design_scale * scale))
    return ImageFont.truetype(str(_FONT_DIR / name), size=size)


def _fit_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: float) -> str:
    """Truncates with an ellipsis rather than letting a long title
    overflow past the photo's right edge — `.pl-title`'s CSS uses
    `text-overflow: ellipsis` for the same reason; Pillow draws no
    overflow handling on its own, so this is that behaviour by hand."""
    if draw.textlength(text, font=font) <= max_width:
        return text
    ellipsis = "…"
    low, high = 0, len(text)
    while low < high:
        mid = (low + high + 1) // 2
        if draw.textlength(text[:mid] + ellipsis, font=font) <= max_width:
            low = mid
        else:
            high = mid - 1
    return text[:low] + ellipsis if low > 0 else ellipsis


def _paste_photo_cover(image: Image.Image, *, customer, asset_id: str, box: tuple[int, int, int, int]) -> None:
    """Rectangular cover-fit crop into `box` — the same ownership-checked
    asset resolution Love Story Timeline's `_paste_photo` uses, but for
    an arbitrary (non-square) target rectangle, matching Player's photo
    frame and CSS `object-fit: cover`."""
    x0, y0, x1, y1 = box
    target_w, target_h = x1 - x0, y1 - y0

    try:
        raw_bytes, _mime_type = get_asset_bytes_for_customer(customer, asset_id)
        with Image.open(io.BytesIO(raw_bytes)) as photo:
            photo = photo.convert("RGB")
            src_ratio = photo.width / photo.height
            dst_ratio = target_w / target_h

            if src_ratio > dst_ratio:
                # Source is relatively wider — crop its sides.
                new_width = round(photo.height * dst_ratio)
                left = (photo.width - new_width) // 2
                photo = photo.crop((left, 0, left + new_width, photo.height))
            else:
                new_height = round(photo.width / dst_ratio)
                top = (photo.height - new_height) // 2
                photo = photo.crop((0, top, photo.width, top + new_height))

            photo = photo.resize((target_w, target_h), Image.LANCZOS)
            image.paste(photo, (x0, y0))
    except Exception as exc:  # noqa: BLE001 — any failure here must not crash rendering
        raise SongPosterRenderFailed("Could not render the referenced photo.") from exc


def _draw_player(canvas: Image.Image, song: NormalizedSongPoster, *, scale: float, origin: tuple[int, int], customer) -> None:
    """Draws the full Player composition at `scale`, top-left corner at
    `origin` — the one function both the frameless (scale to fill,
    origin 0,0) and edged (scale to inset, origin centred) paths call,
    so the two can never draw a different design, only a different size
    and position of the same one."""
    draw = ImageDraw.Draw(canvas)
    ox, oy = origin

    def pt(x: float, y: float) -> tuple[int, int]:
        return (round(ox + x * scale), round(oy + y * scale))

    # --- photo -----------------------------------------------------
    photo_top, photo_height = 56, 560
    photo_box = (*pt(60, photo_top), *pt(60 + 680, photo_top + photo_height))
    if song.photo_asset_id:
        _paste_photo_cover(canvas, customer=customer, asset_id=song.photo_asset_id, box=photo_box)
    else:
        draw.rectangle(photo_box, fill="#dad5c7")
    draw.rectangle(photo_box, outline=_INK, width=max(1, round(scale)))

    # --- title / artist ----------------------------------------------
    #
    # THE PROTOTYPE'S CSS IS BLOCK FLOW, PILLOW IS NOT. Every `margin`
    # value below (`.pl-head{margin:24px...}`, `.pl-progress{margin:
    # 30px...}`, `.pl-transport{margin-top:22px}`) is a gap ADDED TO
    # THE PREVIOUS ELEMENT'S ACTUAL BOTTOM EDGE in the browser's
    # document flow — never an absolute position on the canvas. An
    # earlier version of this function used each margin number
    # directly as a y-coordinate, which is why title, artist and the
    # waveform all drew on top of each other: a real, visible bug,
    # caught by actually rendering this and looking at the output
    # rather than trusting the numbers matched the CSS.
    #
    # `cursor_y` is that running bottom edge, advanced by a REAL
    # measured text height each step (`draw.textbbox`), not an assumed
    # line-height — DejaVu's metrics are not identical to the
    # prototype's Archivo, and a guessed height would silently
    # reintroduce the same class of bug at a smaller scale.
    title_font = _font("DejaVuSans-Bold.ttf", 40, scale)
    artist_font = _font("DejaVuSans.ttf", 16, scale)

    cursor_y = photo_top + photo_height + 24  # `.pl-head`'s margin-top
    title_x, title_y = pt(60, cursor_y)
    max_title_w = 800 * scale - 60 * scale - 60 * scale - 30 * scale  # leaves room for the heart glyph
    title_text = _fit_text(draw, song.track, title_font, max_title_w)
    draw.text((title_x, title_y), title_text, font=title_font, fill=_INK)
    title_box = draw.textbbox((title_x, title_y), title_text, font=title_font)
    cursor_y += (title_box[3] - title_box[1]) / scale + 7  # `.pl-title`'s own margin-bottom

    artist_x, artist_y = pt(60, cursor_y)
    draw.text((artist_x, artist_y), song.artist, font=artist_font, fill=_SOFT)
    artist_box = draw.textbbox((artist_x, artist_y), song.artist, font=artist_font)
    cursor_y += (artist_box[3] - artist_box[1]) / scale

    # --- progress row: waveform + rule, STATIC (see module docstring) -
    cursor_y += 30  # `.pl-progress`'s margin-top
    progress_top = cursor_y
    eq_bottom = pt(0, progress_top + 20 - 4)[1]  # `.pl-eq{top:-4px;height:20px}`, relative to `.pl-progress`
    bar_w = 680 * scale / _EQ_BARS
    seed = seed_for_order(song.track, song.artist)
    bars = downsample(generate_envelope(seed), _EQ_BARS)
    for i, v in enumerate(bars):
        x0 = ox + (60 + i * (680 / _EQ_BARS)) * scale
        h = max(1.5 * scale, v * 18 * scale)
        draw.rectangle(
            [x0, eq_bottom - h, x0 + bar_w * 0.62, eq_bottom],
            fill=_INK,
        )
    rule_y = pt(0, progress_top + 9)[1]  # `.pl-rule{top:9px}`, relative to `.pl-progress`
    draw.line([(pt(60, 0)[0], rule_y), (pt(740, 0)[0], rule_y)], fill=_RULE, width=max(1, round(scale)))
    elapsed_font = _font("DejaVuSansMono.ttf", 14, scale)
    draw.text((pt(60, 0)[0], pt(0, progress_top + 17)[1]), "0:00", font=elapsed_font, fill=_SOFT)
    cursor_y = progress_top + 36  # `.pl-progress{height:36px}`

    # --- transport row: inert, matching print/wallpaper reality --------
    cursor_y += 22  # `.pl-transport`'s margin-top
    play_r = round(22 * scale)
    play_cx, play_cy = pt(400, cursor_y + play_r / scale)  # `.pl-play` is 44px tall; centre is half that down
    draw.ellipse([play_cx - play_r, play_cy - play_r, play_cx + play_r, play_cy + play_r], fill=_INK)
    tri = [
        (play_cx - play_r * 0.32, play_cy - play_r * 0.42),
        (play_cx - play_r * 0.32, play_cy + play_r * 0.42),
        (play_cx + play_r * 0.45, play_cy),
    ]
    draw.polygon(tri, fill=_BG)

    # --- dedication ---------------------------------------------------
    #
    # `.bottom` IS genuinely absolutely positioned in the CSS, unlike
    # everything above it: anchored to the SHEET's own bottom edge, not
    # the flow. The message's line box ends PLAYER_BOTTOM_PX +
    # PLAYER_MESSAGE_MARGIN_BOTTOM_PX above the sheet's bottom, and CSS
    # centres the text in its line box, so the text is placed by its
    # vertical middle ("mm") at the line box's centre. (Still one line,
    # cut with an ellipsis where the preview wraps: a separate finding.)
    if song.dedication:
        msg_font = (
            _font("DejaVuSerif-Italic.ttf", PLAYER_MESSAGE_SIZE_PX, scale)
            if (_FONT_DIR / "DejaVuSerif-Italic.ttf").exists()
            else _font("DejaVuSans.ttf", PLAYER_MESSAGE_SIZE_PX, scale)
        )
        msg = _fit_text(draw, song.dedication, msg_font, (800 - 2 * PLAYER_MESSAGE_INSET_PX) * scale)
        draw.text(pt(400, player_message_centre_y()), msg, font=msg_font, fill=_SOFT, anchor="mm")


def player_message_centre_y() -> float:
    """The design-space y of the centre of Player's one-line dedication."""
    line_box_bottom = DESIGN_H - PLAYER_BOTTOM_PX - PLAYER_MESSAGE_MARGIN_BOTTOM_PX
    return line_box_bottom - PLAYER_MESSAGE_SIZE_PX * PLAYER_MESSAGE_LINE_HEIGHT / 2


def _draw_attribution(canvas: Image.Image, *, content_box: tuple[int, int, int, int], bg: str, soft: str) -> None:
    """Site-wide policy (`apps/delivery/attribution.py`) applied here the
    same way every other product's print/wallpaper output applies it —
    not an LST-specific convention.

    `bg`/`soft` are the SELECTED THEME'S OWN colours, not the module's
    Player-specific `_BG`/`_SOFT` constants — an earlier version of this
    function used those unconditionally, which would have blended
    Ledger's attribution mark against Player's cream background instead
    of Ledger's own khaki. Subtle, but a real per-theme colour bug the
    same class as the canvas-background one just above it.
    """
    x0, y0, x1, y1 = content_box
    draw = ImageDraw.Draw(canvas)
    size = max(8, round((y1 - y0) * MARK_SCALE))
    font = ImageFont.truetype(str(_FONT_DIR / "DejaVuSans.ttf"), size=size)
    colour = blend(soft, bg, MARK_OPACITY)
    draw.text((x0 + size, y1 - size * 2), PRINT_MARK, font=font, fill=colour)


def _draw_ledger(canvas: Image.Image, song: NormalizedSongPoster, *, scale: float, origin: tuple[int, int], customer) -> None:
    """Ledger's poster composition — ported from the prototype's
    `.lg-*` rules, adapted to this product's real schema. See
    `ledger-theme.tsx`'s own docstring, which this function matches
    field-for-field: no transport control (Ledger's own design has
    none), and the six-row evidence table (Album/Year/Runtime/Mark/
    Logged/Location) is not drawn — none of its six fields exist in
    `NormalizedSongPoster`, and inventing values for them would be
    exactly the fabrication this project avoids everywhere else.

    CUMULATIVE Y POSITIONS, MEASURED, from the first draft — not
    guessed round numbers. Player's own first version got this wrong by
    treating CSS flow margins as absolute coordinates; this function is
    written the corrected way from the start, verified the same way
    Player's fix was: by actually rendering it and looking.
    """
    draw = ImageDraw.Draw(canvas)
    ox, oy = origin

    def pt(x: float, y: float) -> tuple[int, int]:
        return (round(ox + x * scale), round(oy + y * scale))

    ink = "#232019"
    soft = "#6c6455"
    rule_colour = "#b2aa98"

    head_font = _font("DejaVuSans.ttf", 14.5, scale)
    title_font = _font("DejaVuSans-Bold.ttf", 66, scale)
    artist_font = _font("DejaVuSansMono.ttf", 16, scale)
    caption_font = _font("DejaVuSans.ttf", 13.5, scale)
    wavelab_font = _font("DejaVuSans.ttf", 13.5, scale)
    dedication_font = _font("DejaVuSans.ttf", 15, scale)
    foot_font = _font("DejaVuSans.ttf", 13.5, scale)

    # --- head: "SESSION LOG" / "SHEET 01 / 01" ------------------------
    cursor_y = 52.0  # sheet's own top padding
    left_label = "SESSION LOG"
    right_label = "SHEET 01 / 01"
    draw.text(pt(54, cursor_y), left_label, font=head_font, fill=soft)
    rw = draw.textlength(right_label, font=head_font)
    draw.text((pt(746, cursor_y)[0] - rw, pt(0, cursor_y)[1]), right_label, font=head_font, fill=soft)
    head_box = draw.textbbox((0, 0), left_label, font=head_font)
    cursor_y += (head_box[3] - head_box[1]) / scale + 9  # `.lg-rule`'s own margin-top

    # --- rule ----------------------------------------------------------
    draw.line([pt(54, cursor_y), pt(746, cursor_y)], fill=ink, width=max(1, round(scale)))
    cursor_y += 1 / scale + 26  # rule height + `.lg-rule`'s margin-bottom

    # --- title / artist --------------------------------------------
    title_text = _fit_text(draw, song.track, title_font, 692 * scale)
    draw.text(pt(54, cursor_y), title_text, font=title_font, fill=ink)
    title_box = draw.textbbox(pt(54, cursor_y), title_text, font=title_font)
    cursor_y += (title_box[3] - title_box[1]) / scale + 6

    draw.text(pt(54, cursor_y), song.artist, font=artist_font, fill=ink)
    artist_box = draw.textbbox(pt(54, cursor_y), song.artist, font=artist_font)
    cursor_y += (artist_box[3] - artist_box[1]) / scale + 28  # `.lg-mid`'s margin-top

    # --- photo, filed evidence-style ---------------------------------
    photo_box = (*pt(54, cursor_y), *pt(54 + 222, cursor_y + 270))
    if song.photo_asset_id:
        _paste_photo_cover(canvas, customer=customer, asset_id=song.photo_asset_id, box=photo_box)
    else:
        draw.rectangle(photo_box, fill="#cfc9ba")
    draw.rectangle(photo_box, outline=ink, width=max(1, round(scale)))
    cursor_y += 270 + 7  # `.lg-cap`'s margin-top

    caption = "PRINT · AFFIXED"
    cw = draw.textlength(caption, font=caption_font)
    draw.text((pt(54 + 222, cursor_y)[0] - cw, pt(0, cursor_y)[1]), caption, font=caption_font, fill=soft)
    caption_box = draw.textbbox((0, 0), caption, font=caption_font)
    cursor_y += (caption_box[3] - caption_box[1]) / scale + 30  # `.lg-wavebox`'s margin-top

    # --- wavebox: bordered frame, centred oscillogram waveform --------
    wave_top = cursor_y
    wave_inner_h = 88.0
    wave_box_h = 11 + wave_inner_h + 8  # `.lg-wavebox`'s own padding
    draw.rectangle([pt(54, wave_top)[0], pt(0, wave_top)[1], pt(746, wave_top)[0], pt(0, wave_top + wave_box_h)[1]], outline=ink, width=max(1, round(scale)))

    wavelab = "PROGRAMME · FULL RUNTIME"
    lw = draw.textlength(wavelab, font=wavelab_font)
    # Sits astride the border's top edge, background-coloured behind it,
    # matching `.lg-wavelab{top:-6px}` cutting a gap in the frame line —
    # drawn as a filled rect behind the text for the same visual effect
    # Pillow has no "background-colour punch-through" primitive for.
    lab_x = pt(54 + 10, 0)[0]
    lab_y = pt(0, wave_top - 6)[1]
    lab_box = draw.textbbox((lab_x, lab_y), wavelab, font=wavelab_font)
    draw.rectangle([lab_box[0] - 5 * scale, lab_box[1], lab_box[2] + 5 * scale, lab_box[3]], fill="#e7e3d8")
    draw.text((lab_x, lab_y), wavelab, font=wavelab_font, fill=soft)

    seed = seed_for_order(song.track, song.artist)
    points = 340
    env = downsample(generate_envelope(seed), points)
    wave_mid_y = pt(0, wave_top + 11 + wave_inner_h / 2)[1]
    wave_left_x = pt(54 + 12, 0)[0]
    wave_right_x = pt(746 - 12, 0)[0]
    wave_width_px = wave_right_x - wave_left_x
    for i, v in enumerate(env):
        x = wave_left_x + (i + 0.5) * (wave_width_px / points)
        h = v * 44 * scale
        draw.line([(x, wave_mid_y - h), (x, wave_mid_y + h)], fill=ink, width=max(1, round(scale * 0.8)))

    cursor_y = wave_top + wave_box_h + 24  # gap before the dedication

    # --- dedication --------------------------------------------------
    if song.dedication:
        msg = _fit_text(draw, song.dedication, dedication_font, 692 * scale)
        draw.text(pt(54, cursor_y), msg, font=dedication_font, fill=soft)

    # --- foot: artist + wordmark, anchored to the sheet's own bottom --
    foot_y = DESIGN_H - 40 - 13.5
    draw.line([pt(54, foot_y - 8), pt(746, foot_y - 8)], fill=rule_colour, width=max(1, round(scale)))
    draw.text(pt(54, foot_y), song.artist.upper(), font=foot_font, fill=soft)
    wordmark = "HEARTFOLIO"
    ww = draw.textlength(wordmark, font=foot_font)
    draw.text((pt(746, foot_y)[0] - ww, pt(0, foot_y)[1]), wordmark, font=foot_font, fill=soft)


def _polar_ring_points(envelope, *, cx: float, cy: float, radius: float, amplitude: float) -> list[tuple[float, float]]:
    """Direct port of the prototype's own `platePolar()` — the envelope
    perturbs a circle's radius around its circumference, closed into a
    ring. Returns raw points rather than an SVG path string, since
    Pillow draws polygons from point lists, not path syntax."""
    n = len(envelope)
    points: list[tuple[float, float]] = []
    for i in range(n):
        angle = (i / n) * math.pi * 2 - math.pi / 2
        r = radius + (envelope[i] - 0.5) * amplitude * 2
        points.append((cx + math.cos(angle) * r, cy + math.sin(angle) * r))
    return points


def _draw_ephemeris(canvas: Image.Image, song: NormalizedSongPoster, *, scale: float, origin: tuple[int, int], customer) -> None:
    """Ephemeris's poster composition. See `ephemeris-theme.tsx`'s own
    docstring for the full, honest account of what changed: the
    prototype's tick marks (dividing the circle by `duration`) and its
    moment hand/marker (plotting `momentAt` on the circle) are NOT
    drawn — this product's schema has neither field. What remains is
    the concentric-rings plate, a polar ring built from the real seeded
    waveform, and a circular photo at the centre.
    """
    draw = ImageDraw.Draw(canvas)
    ox, oy = origin
    ink = "#e9e4d7"
    soft = "#8e8c82"
    rule_colour = "#3a4049"

    def pt(x: float, y: float) -> tuple[int, int]:
        return (round(ox + x * scale), round(oy + y * scale))

    head_font = _font("DejaVuSans.ttf", 14, scale)
    title_font = _font("DejaVuSerif.ttf", 56, scale)
    artist_font = _font("DejaVuSans.ttf", 13.5, scale)
    dedication_font = _font("DejaVuSerif-Italic.ttf", 15, scale)
    foot_font = _font("DejaVuSans.ttf", 13.5, scale)

    # --- head: centred, small-caps-style label ------------------------
    cursor_y = 56.0
    head_text = "EPHEMERIS OF ONE RECORDING"
    hw = draw.textlength(head_text, font=head_font)
    draw.text((ox + 400 * scale - hw / 2, pt(0, cursor_y)[1]), head_text, font=head_font, fill=soft)
    head_box = draw.textbbox((0, 0), head_text, font=head_font)
    cursor_y += (head_box[3] - head_box[1]) / scale + 26  # `.ep-plate`'s margin-top

    # --- plate: concentric rings + polar waveform ring + circular photo
    plate_size = 560.0
    plate_left = 56 + (688 - plate_size) / 2  # 688 = design width minus both 56px paddings
    plate_top = cursor_y
    c = plate_left + plate_size / 2
    plate_cy = plate_top + plate_size / 2
    # The prototype's own SVG viewBox is 0..560 with its centre at 280;
    # mapping that 1:1 onto the plate's actual design-space box, so the
    # ring-radius constants (279/262/232-amplitude/198) carry over
    # unchanged rather than needing their own rescale.
    svg_scale = plate_size / 560.0

    def ring(cx_design, cy_design, r, width_px, opacity):
        bbox = [
            pt(cx_design - r, cy_design - r),
            pt(cx_design + r, cy_design + r),
        ]
        colour = blend_opacity(ink, "#12161c", opacity)
        draw.ellipse([bbox[0][0], bbox[0][1], bbox[1][0], bbox[1][1]], outline=colour, width=max(1, round(width_px * scale)))

    def blend_opacity(fg_hex, bg_hex, opacity):
        fg = tuple(int(fg_hex.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
        bg = tuple(int(bg_hex.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
        return tuple(round(bg[i] + (fg[i] - bg[i]) * opacity) for i in range(3))

    cx_design = plate_left + 280 * svg_scale
    cy_design = plate_top + 280 * svg_scale
    ring(cx_design, cy_design, 279 * svg_scale, 1, 0.45)
    ring(cx_design, cy_design, 262 * svg_scale, 1, 0.28)

    seed = seed_for_order(song.track, song.artist)
    ring_points = 520
    env = downsample(generate_envelope(seed), ring_points)
    raw_points = _polar_ring_points(env, cx=280.0, cy=280.0, radius=232.0, amplitude=27.0)
    scaled_points = [pt(plate_left + x * svg_scale, plate_top + y * svg_scale) for x, y in raw_points]
    draw.line(scaled_points + [scaled_points[0]], fill=blend_opacity(ink, "#12161c", 0.92), width=max(1, round(1.15 * scale)))

    ring(cx_design, cy_design, 198 * svg_scale, 1, 0.22)

    photo_size = 226 * svg_scale
    photo_x0 = cx_design - photo_size / 2
    photo_y0 = cy_design - photo_size / 2
    photo_box = (*pt(photo_x0, photo_y0), *pt(photo_x0 + photo_size, photo_y0 + photo_size))

    if song.photo_asset_id:
        mask_size = photo_box[2] - photo_box[0]
        try:
            raw_bytes, _mime = get_asset_bytes_for_customer(customer, song.photo_asset_id)
            with Image.open(io.BytesIO(raw_bytes)) as photo:
                photo = photo.convert("RGB")
                side = min(photo.size)
                left = (photo.width - side) // 2
                top = (photo.height - side) // 2
                photo = photo.crop((left, top, left + side, top + side)).resize((mask_size, mask_size), Image.LANCZOS)
                mask = Image.new("L", (mask_size * 2, mask_size * 2), 0)
                ImageDraw.Draw(mask).ellipse([0, 0, mask_size * 2, mask_size * 2], fill=255)
                canvas.paste(photo, (photo_box[0], photo_box[1]), mask.resize((mask_size, mask_size), Image.LANCZOS))
        except Exception as exc:  # noqa: BLE001
            raise SongPosterRenderFailed("Could not render the referenced photo.") from exc
    else:
        draw.ellipse(photo_box, fill="#232a33")
    draw.ellipse(photo_box, outline=rule_colour, width=max(1, round(scale)))

    cursor_y = plate_top + plate_size + 26

    # --- title / artist, centred ---------------------------------------
    title_text = _fit_text(draw, song.track, title_font, 688 * scale)
    tw = draw.textlength(title_text, font=title_font)
    draw.text((ox + 400 * scale - tw / 2, pt(0, cursor_y)[1]), title_text, font=title_font, fill=ink)
    title_box = draw.textbbox((0, 0), title_text, font=title_font)
    cursor_y += (title_box[3] - title_box[1]) / scale + 11

    artist_text = song.artist.upper()
    aw = draw.textlength(artist_text, font=artist_font)
    draw.text((ox + 400 * scale - aw / 2, pt(0, cursor_y)[1]), artist_text, font=artist_font, fill=soft)
    artist_box = draw.textbbox((0, 0), artist_text, font=artist_font)
    cursor_y += (artist_box[3] - artist_box[1]) / scale + 22

    # --- dedication, centred, italic ------------------------------------
    if song.dedication:
        msg = _fit_text(draw, song.dedication, dedication_font, 688 * scale)
        mw = draw.textlength(msg, font=dedication_font)
        draw.text((ox + 400 * scale - mw / 2, pt(0, cursor_y)[1]), msg, font=dedication_font, fill=soft)

    # --- foot: artist + wordmark, anchored to the sheet's own bottom ----
    foot_y = DESIGN_H - 78 - 13.5
    draw.line([pt(56, foot_y - 13), pt(744, foot_y - 13)], fill=rule_colour, width=max(1, round(scale)))
    draw.text(pt(56, foot_y), song.artist.upper(), font=foot_font, fill=soft)
    wordmark = "HEARTFOLIO"
    ww = draw.textlength(wordmark, font=foot_font)
    draw.text((pt(744, foot_y)[0] - ww, pt(0, foot_y)[1]), wordmark, font=foot_font, fill=soft)


def _draw_contact_sheet(canvas: Image.Image, song: NormalizedSongPoster, *, scale: float, origin: tuple[int, int], customer) -> None:
    """Contact Sheet's poster composition. See `contact-sheet-theme.
    tsx`'s own docstring for the honest account: this theme's identity
    is "several photos, not one," and this product's schema collects
    exactly one. All four frames below show the SAME photo — fetched
    and cropped ONCE, pasted four times, not re-fetched per frame.
    """
    draw = ImageDraw.Draw(canvas)
    ox, oy = origin
    ink = "#17181a"
    soft = "#68665d"
    rule_colour = "#c7c2b4"
    void_colour = "#d8d3c4"

    def pt(x: float, y: float) -> tuple[int, int]:
        return (round(ox + x * scale), round(oy + y * scale))

    head_font = _font("DejaVuSans.ttf", 14.5, scale)
    title_font = _font("DejaVuSans-Bold.ttf", 34, scale)
    artist_font = _font("DejaVuSans.ttf", 15.5, scale)
    num_font = _font("DejaVuSansMono.ttf", 13.5, scale)
    caption_font = _font("DejaVuSansMono-Italic.ttf", 14, scale) if (_FONT_DIR / "DejaVuSansMono-Italic.ttf").exists() else _font("DejaVuSansMono.ttf", 14, scale)
    foot_font = _font("DejaVuSans.ttf", 14, scale)

    # --- head ------------------------------------------------------
    cursor_y = 48.0
    head_text = "CONTACT SHEET"
    draw.text(pt(50, cursor_y), head_text, font=head_font, fill=soft)
    head_box = draw.textbbox((0, 0), head_text, font=head_font)
    cursor_y += (head_box[3] - head_box[1]) / scale + 20  # `.cs-grid`'s margin-top

    # --- 2x2 grid, sprocket holes, one photo pasted four times --------
    grid_left, grid_right = 50.0, 750.0
    gap = 8.0
    col_width = (grid_right - grid_left - gap) / 2
    frame_height = col_width * 5 / 6  # aspect-ratio: 6 / 5
    grid_top = cursor_y

    # Fetched and cropped ONCE, pasted into all four frames below — not
    # re-fetched per frame. `grayscale(.08)` in the CSS is a slight
    # desaturation, not full monochrome; blending 8% of a greyscale copy
    # over the original approximates that without a true colour-matrix
    # operation, which Pillow's basic ops don't expose.
    frame_image = None
    if song.photo_asset_id:
        try:
            raw_bytes, _mime = get_asset_bytes_for_customer(customer, song.photo_asset_id)
            with Image.open(io.BytesIO(raw_bytes)) as photo:
                photo = photo.convert("RGB")
                target_w, target_h = round(col_width * scale), round(frame_height * scale)
                src_ratio = photo.width / photo.height
                dst_ratio = target_w / target_h
                if src_ratio > dst_ratio:
                    new_w = round(photo.height * dst_ratio)
                    left = (photo.width - new_w) // 2
                    photo = photo.crop((left, 0, left + new_w, photo.height))
                else:
                    new_h = round(photo.width / dst_ratio)
                    top = (photo.height - new_h) // 2
                    photo = photo.crop((0, top, photo.width, top + new_h))
                photo = photo.resize((target_w, target_h), Image.LANCZOS)
                grey = photo.convert("L").convert("RGB")
                frame_image = Image.blend(photo, grey, 0.08)
        except Exception as exc:  # noqa: BLE001
            raise SongPosterRenderFailed("Could not render the referenced photo.") from exc

    for row in range(2):
        for col in range(2):
            index = row * 2 + col
            fx0 = grid_left + col * (col_width + gap)
            fy0 = grid_top + row * (frame_height + gap)
            box = (*pt(fx0, fy0), *pt(fx0 + col_width, fy0 + frame_height))
            if frame_image is not None:
                canvas.paste(frame_image, (box[0], box[1]))
            else:
                draw.rectangle(box, fill=void_colour)
            draw.rectangle(box, outline=ink, width=max(1, round(scale)))

            num_text = f"{index + 1:02d}"
            nw = draw.textlength(num_text, font=num_font)
            nh_box = draw.textbbox((0, 0), num_text, font=num_font)
            nh = nh_box[3] - nh_box[1]
            badge_pad = 5 * scale
            badge = [box[0] + 6 * scale, box[3] - 6 * scale - nh - 3 * scale, box[0] + 6 * scale + nw + badge_pad * 2, box[3] - 6 * scale]
            # Solid, not semi-transparent — `canvas` is always RGB here
            # (never RGBA), so there is no alpha channel to blend into;
            # a solid dark rectangle is the honest equivalent of the
            # CSS's `rgba(18,18,16,.72)` badge, not an approximation
            # pretending to have transparency it cannot actually have.
            draw.rectangle(badge, fill=(33, 32, 29))
            draw.text((badge[0] + badge_pad, badge[1] + 1 * scale), num_text, font=num_font, fill="#edefe7")

    # Sprocket ticks, both outer edges, in the margin just outside the grid.
    sprocket_top = pt(0, grid_top)[1]
    sprocket_bottom = pt(0, grid_top + 2 * frame_height + gap)[1]
    tick_h, tick_gap = 3 * scale, 14 * scale
    for edge_x in (pt(grid_left - 16, 0)[0], pt(grid_right + 16 - 5, 0)[0]):
        y = sprocket_top
        while y < sprocket_bottom:
            draw.rectangle([edge_x, y, edge_x + 5 * scale, y + tick_h], fill=ink)
            y += tick_gap

    cursor_y = grid_top + 2 * frame_height + gap + 22  # `.cs-title`'s margin-top

    # --- title / artist --------------------------------------------
    title_text = _fit_text(draw, song.track, title_font, 700 * scale)
    draw.text(pt(50, cursor_y), title_text, font=title_font, fill=ink)
    title_box = draw.textbbox(pt(50, cursor_y), title_text, font=title_font)
    cursor_y += (title_box[3] - title_box[1]) / scale + 6

    draw.text(pt(50, cursor_y), song.artist.upper(), font=artist_font, fill=soft)
    artist_box = draw.textbbox(pt(50, cursor_y), song.artist.upper(), font=artist_font)
    cursor_y += (artist_box[3] - artist_box[1]) / scale + 20  # `.cs-wavebox`'s margin-top

    # --- waveform: bottom-anchored bars, unplayed (static, see module
    #     docstring at the top of this file on why print/wallpaper never
    #     shows a "played" state) --------------------------------------
    wave_bars = 90
    wave_h = 34.0
    env = downsample(generate_envelope(seed_for_order(song.track, song.artist)), wave_bars)
    bar_w = 700 * scale / wave_bars
    wave_bottom = pt(0, cursor_y + wave_h)[1]
    for i, v in enumerate(env):
        x0 = ox + (50 + i * (700 / wave_bars)) * scale
        h = max(2 * scale, v * wave_h * scale)
        draw.rectangle([x0, wave_bottom - h, x0 + bar_w * 0.84, wave_bottom], fill=ink)
    cursor_y += wave_h + 18  # `.cs-caption`'s margin-top

    # --- dedication caption ------------------------------------------
    if song.dedication:
        msg = _fit_text(draw, song.dedication, caption_font, 560 * scale)
        draw.text(pt(50, cursor_y), msg, font=caption_font, fill=ink)

    # --- foot ----------------------------------------------------------
    foot_y = DESIGN_H - 42 - 14
    draw.line([pt(50, foot_y - 9), pt(750, foot_y - 9)], fill=rule_colour, width=max(1, round(scale)))
    draw.text(pt(50, foot_y), song.artist.upper(), font=foot_font, fill=soft)
    wordmark = "HEARTFOLIO"
    ww = draw.textlength(wordmark, font=foot_font)
    draw.text((pt(750, foot_y)[0] - ww, pt(0, foot_y)[1]), wordmark, font=foot_font, fill=soft)


def _draw_label(canvas: Image.Image, song: NormalizedSongPoster, *, scale: float, origin: tuple[int, int], customer) -> None:
    """Label's poster composition — a vinyl record. See `label-theme.
    tsx`'s own docstring: `.lb-meta` (duration + momentAt) and the
    header's album/year are dropped, same reasoning as every theme
    before this one — none of those four fields exist in this
    product's schema.
    """
    draw = ImageDraw.Draw(canvas)
    ox, oy = origin
    ink = "#18181a"
    soft = "#68665d"
    rule_colour = "#cdc8b9"
    vinyl = "#101012"
    groove = "#2b2b2e"
    bg = "#edeae3"

    def pt(x: float, y: float) -> tuple[int, int]:
        return (round(ox + x * scale), round(oy + y * scale))

    head_font = _font("DejaVuSans.ttf", 14.5, scale)
    title_font = _font("DejaVuSans-Bold.ttf", 38, scale)
    artist_font = _font("DejaVuSans.ttf", 16, scale)
    dedication_font = _font("DejaVuSans-Italic.ttf", 13.5, scale) if (_FONT_DIR / "DejaVuSans-Italic.ttf").exists() else _font("DejaVuSans.ttf", 13.5, scale)
    foot_font = _font("DejaVuSans.ttf", 14, scale)

    # --- head, centred -------------------------------------------------
    cursor_y = 48.0
    head_text = "PRESSED FOR ONE RECORDING"
    hw = draw.textlength(head_text, font=head_font)
    draw.text((ox + 400 * scale - hw / 2, pt(0, cursor_y)[1]), head_text, font=head_font, fill=soft)
    head_box = draw.textbbox((0, 0), head_text, font=head_font)
    cursor_y += (head_box[3] - head_box[1]) / scale + 30  # `.lb-disc`'s margin-top

    # --- disc: vinyl, grooves, circular photo label, spindle -----------
    disc_size = 560.0
    disc_left = 400 - disc_size / 2
    disc_top = cursor_y
    svg_scale = disc_size / 560.0
    disc_r = 280.0

    def disc_pt(x, y):
        return pt(disc_left + x * svg_scale, disc_top + y * svg_scale)

    disc_bbox = [disc_pt(disc_r - 278 * svg_scale, disc_r - 278 * svg_scale), disc_pt(disc_r + 278 * svg_scale, disc_r + 278 * svg_scale)]
    draw.ellipse([disc_bbox[0][0], disc_bbox[0][1], disc_bbox[1][0], disc_bbox[1][1]], fill=vinyl)

    def blend_opacity(fg_hex, bg_hex, opacity):
        fg = tuple(int(fg_hex.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
        bgc = tuple(int(bg_hex.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
        return tuple(round(bgc[i] + (fg[i] - bgc[i]) * opacity) for i in range(3))

    for i, r in enumerate([258, 240, 222, 204, 186, 168, 150]):
        opacity = 0.55 if i % 2 else 0.85
        colour = blend_opacity(groove, vinyl, opacity)
        bbox = [disc_pt(disc_r - r * svg_scale, disc_r - r * svg_scale), disc_pt(disc_r + r * svg_scale, disc_r + r * svg_scale)]
        draw.ellipse([bbox[0][0], bbox[0][1], bbox[1][0], bbox[1][1]], outline=colour, width=max(1, round(scale)))

    label_size = 272 * svg_scale
    label_box = (*disc_pt(disc_r - 272 * svg_scale / 2, disc_r - 272 * svg_scale / 2), *disc_pt(disc_r + 272 * svg_scale / 2, disc_r + 272 * svg_scale / 2))
    if song.photo_asset_id:
        try:
            raw_bytes, _mime = get_asset_bytes_for_customer(customer, song.photo_asset_id)
            with Image.open(io.BytesIO(raw_bytes)) as photo:
                photo = photo.convert("RGB")
                mask_size = label_box[2] - label_box[0]
                side = min(photo.size)
                left = (photo.width - side) // 2
                top = (photo.height - side) // 2
                photo = photo.crop((left, top, left + side, top + side)).resize((mask_size, mask_size), Image.LANCZOS)
                mask = Image.new("L", (mask_size * 2, mask_size * 2), 0)
                ImageDraw.Draw(mask).ellipse([0, 0, mask_size * 2, mask_size * 2], fill=255)
                canvas.paste(photo, (label_box[0], label_box[1]), mask.resize((mask_size, mask_size), Image.LANCZOS))
        except Exception as exc:  # noqa: BLE001
            raise SongPosterRenderFailed("Could not render the referenced photo.") from exc
    else:
        draw.ellipse(label_box, fill="#3a3a3d")
    draw.ellipse(label_box, outline=groove, width=max(1, round(scale)))

    spindle_box = (*disc_pt(disc_r - 4.5 * svg_scale, disc_r - 4.5 * svg_scale), *disc_pt(disc_r + 4.5 * svg_scale, disc_r + 4.5 * svg_scale))
    draw.ellipse(spindle_box, fill=bg, outline=vinyl, width=max(1, round(scale)))

    cursor_y = disc_top + disc_size + 26  # `.lb-title`'s margin-top

    # --- title / artist, centred ---------------------------------------
    title_text = _fit_text(draw, song.track, title_font, 680 * scale)
    tw = draw.textlength(title_text, font=title_font)
    draw.text((ox + 400 * scale - tw / 2, pt(0, cursor_y)[1]), title_text, font=title_font, fill=ink)
    title_box = draw.textbbox((0, 0), title_text, font=title_font)
    cursor_y += (title_box[3] - title_box[1]) / scale + 6

    artist_text = song.artist.upper()
    aw = draw.textlength(artist_text, font=artist_font)
    draw.text((ox + 400 * scale - aw / 2, pt(0, cursor_y)[1]), artist_text, font=artist_font, fill=soft)
    artist_box = draw.textbbox((0, 0), artist_text, font=artist_font)
    cursor_y += (artist_box[3] - artist_box[1]) / scale + 20

    # --- dedication, centred ---------------------------------------------
    if song.dedication:
        msg = _fit_text(draw, song.dedication, dedication_font, 680 * scale)
        mw = draw.textlength(msg, font=dedication_font)
        draw.text((ox + 400 * scale - mw / 2, pt(0, cursor_y)[1]), msg, font=dedication_font, fill=soft)

    # --- foot ----------------------------------------------------------
    foot_y = DESIGN_H - 44 - 14
    draw.line([pt(60, foot_y - 14), pt(740, foot_y - 14)], fill=rule_colour, width=max(1, round(scale)))
    draw.text(pt(60, foot_y), song.artist.upper(), font=foot_font, fill=soft)
    wordmark = "HEARTFOLIO"
    ww = draw.textlength(wordmark, font=foot_font)
    draw.text((pt(740, foot_y)[0] - ww, pt(0, foot_y)[1]), wordmark, font=foot_font, fill=soft)


AWARD_DESIGN_W = 1200
AWARD_DESIGN_H = 800


def _draw_award(canvas: Image.Image, song: NormalizedSongPoster, *, scale: float, origin: tuple[int, int], customer) -> None:
    """Award's poster composition — LANDSCAPE ONLY, matching the
    prototype's own registry (`ratios:['landscape']`; its portrait
    branch was already unreachable there). See `award-theme.tsx`'s own
    docstring for the adaptation notes and the material caveat about
    the plaque's brass tone worth repeating rather than treating as
    settled.
    """
    draw = ImageDraw.Draw(canvas)
    ox, oy = origin
    ink = "#1a1917"
    soft = "#6b675c"
    rule_colour = "#cfc8b4"
    plaque_bg = "#8c6a34"
    plaque_ink = "#f3e9ce"

    def pt(x: float, y: float) -> tuple[int, int]:
        return (round(ox + x * scale), round(oy + y * scale))

    head_font = _font("DejaVuSans.ttf", 14.5, scale)
    title_font = _font("DejaVuSans-Bold.ttf", 44, scale)
    artist_font = _font("DejaVuSans.ttf", 15, scale)
    plaque_font = _font("DejaVuSans-Italic.ttf", 13, scale) if (_FONT_DIR / "DejaVuSans-Italic.ttf").exists() else _font("DejaVuSans.ttf", 13, scale)
    plaque_foot_font = _font("DejaVuSans.ttf", 14, scale)

    # --- frame: two nested borders ------------------------------------
    draw.rectangle([pt(26, 26), pt(AWARD_DESIGN_W - 26, AWARD_DESIGN_H - 26)], outline=ink, width=max(1, round(scale)))
    draw.rectangle([pt(36, 36), pt(AWARD_DESIGN_W - 36, AWARD_DESIGN_H - 36)], outline=rule_colour, width=max(1, round(scale)))

    # --- head ------------------------------------------------------
    cursor_y = 40.0
    head_text = "AWARDED FOR ONE RECORDING"
    draw.text(pt(72, cursor_y), head_text, font=head_font, fill=soft)
    head_box = draw.textbbox((0, 0), head_text, font=head_font)
    cursor_y += (head_box[3] - head_box[1]) / scale + 20  # `.aw-lrow`'s margin-top

    # --- row: photo beside disc + title + artist ------------------------
    photo_w, photo_h = 460.0, 540.0
    photo_box = (*pt(72, cursor_y), *pt(72 + photo_w, cursor_y + photo_h))
    if song.photo_asset_id:
        try:
            raw_bytes, _mime = get_asset_bytes_for_customer(customer, song.photo_asset_id)
            with Image.open(io.BytesIO(raw_bytes)) as photo:
                photo = photo.convert("RGB")
                target_w, target_h = photo_box[2] - photo_box[0], photo_box[3] - photo_box[1]
                src_ratio = photo.width / photo.height
                dst_ratio = target_w / target_h
                if src_ratio > dst_ratio:
                    new_w = round(photo.height * dst_ratio)
                    left = (photo.width - new_w) // 2
                    photo = photo.crop((left, 0, left + new_w, photo.height))
                else:
                    new_h = round(photo.width / dst_ratio)
                    top = (photo.height - new_h) // 2
                    photo = photo.crop((0, top, photo.width, top + new_h))
                photo = photo.resize((target_w, target_h), Image.LANCZOS)
                canvas.paste(photo, (photo_box[0], photo_box[1]))
        except Exception as exc:  # noqa: BLE001
            raise SongPosterRenderFailed("Could not render the referenced photo.") from exc
    else:
        draw.rectangle(photo_box, fill="#d7d0bc")
    draw.rectangle(photo_box, outline=ink, width=max(1, round(scale)))

    info_x = 72 + photo_w + 44  # `.aw-lrow`'s gap
    disc_r = 110.0
    disc_top = cursor_y  # `.aw-linfo` centres vertically, but with only
    # a disc + title + artist stacked, top-aligning inside the photo's
    # own height reads the same and needs no vertical-centring math.
    disc_cx = info_x + disc_r
    disc_cy = disc_top + disc_r
    disc_box = [pt(disc_cx - 108, disc_cy - 108), pt(disc_cx + 108, disc_cy + 108)]
    draw.ellipse([disc_box[0][0], disc_box[0][1], disc_box[1][0], disc_box[1][1]], fill=ink)

    def blend_opacity(fg_hex, bg_hex, opacity):
        fg = tuple(int(fg_hex.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
        bgc = tuple(int(bg_hex.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
        return tuple(round(bgc[i] + (fg[i] - bgc[i]) * opacity) for i in range(3))

    for i, r in enumerate([96, 86, 76, 66, 56]):
        opacity = 0.5 if i % 2 else 0.8
        colour = blend_opacity(rule_colour, ink, opacity)
        bbox = [pt(disc_cx - r, disc_cy - r), pt(disc_cx + r, disc_cy + r)]
        draw.ellipse([bbox[0][0], bbox[0][1], bbox[1][0], bbox[1][1]], outline=colour, width=max(1, round(scale)))

    hub_box = [pt(disc_cx - 38, disc_cy - 38), pt(disc_cx + 38, disc_cy + 38)]
    bg_colour_at_hub = "#f1ede3"
    draw.ellipse([hub_box[0][0], hub_box[0][1], hub_box[1][0], hub_box[1][1]], fill=bg_colour_at_hub, outline=rule_colour, width=max(1, round(scale)))
    centre_dot = [pt(disc_cx - 2, disc_cy - 2), pt(disc_cx + 2, disc_cy + 2)]
    draw.ellipse([centre_dot[0][0], centre_dot[0][1], centre_dot[1][0], centre_dot[1][1]], fill=ink)

    info_cursor_y = disc_top + 220 + 26  # disc's own 220px height + its margin-bottom
    title_text = _fit_text(draw, song.track, title_font, (AWARD_DESIGN_W - info_x - 72) * scale)
    draw.text(pt(info_x, info_cursor_y), title_text, font=title_font, fill=ink)
    title_box = draw.textbbox(pt(info_x, info_cursor_y), title_text, font=title_font)
    info_cursor_y += (title_box[3] - title_box[1]) / scale + 8

    draw.text(pt(info_x, info_cursor_y), song.artist.upper(), font=artist_font, fill=soft)

    # --- plaque: brass box, dedication + artist/wordmark line -----------
    plaque_left, plaque_right = 72.0, AWARD_DESIGN_W - 72.0
    plaque_bottom = AWARD_DESIGN_H - 36.0
    pad_x, pad_y = 20.0, 16.0

    lines: list[str] = []
    if song.dedication:
        lines.append(_fit_text(draw, song.dedication, plaque_font, (plaque_right - plaque_left - pad_x * 2) * scale))

    foot_text = f"{song.artist.upper()} · HEARTFOLIO"
    rule_h = 1.0
    content_h = rule_h + 10  # rule + its own margin-bottom
    if lines:
        box = draw.textbbox((0, 0), lines[0], font=plaque_font)
        content_h += (box[3] - box[1]) / scale + 8
    foot_box = draw.textbbox((0, 0), foot_text, font=plaque_foot_font)
    content_h += (foot_box[3] - foot_box[1]) / scale

    plaque_top = plaque_bottom - pad_y * 2 - content_h
    draw.rectangle([pt(plaque_left, plaque_top), pt(plaque_right, plaque_bottom)], fill=plaque_bg)

    inner_cursor = plaque_top + pad_y
    rule_w = 60.0
    rule_cx = (plaque_left + plaque_right) / 2
    draw.line([pt(rule_cx - rule_w / 2, inner_cursor), pt(rule_cx + rule_w / 2, inner_cursor)], fill=plaque_ink, width=max(1, round(scale)))
    inner_cursor += rule_h + 10

    if lines:
        lw = draw.textlength(lines[0], font=plaque_font)
        draw.text((ox + rule_cx * scale - lw / 2, pt(0, inner_cursor)[1]), lines[0], font=plaque_font, fill=plaque_ink)
        box = draw.textbbox((0, 0), lines[0], font=plaque_font)
        inner_cursor += (box[3] - box[1]) / scale + 8

    fw = draw.textlength(foot_text, font=plaque_foot_font)
    draw.text((ox + rule_cx * scale - fw / 2, pt(0, inner_cursor)[1]), foot_text, font=plaque_foot_font, fill=plaque_ink)


def _ring_text(raw: str, circumference: float) -> str:
    """Direct port of the prototype's own ring-text builder: repeats
    the source (or a bare dot separator, when there is none) until it
    fills the ring's own character budget, `circumference / 3.35`."""
    total_chars = max(30, int(circumference / 3.35))
    text = f"{raw} · " if raw else "· "
    while len(text) < total_chars:
        text += text
    return text[:total_chars]


def _draw_curved_ring(
    canvas: Image.Image, *, cx: float, cy: float, radius: float, text: str, font, colour, start_angle_deg: float = -90.0
) -> None:
    """Draws `text` running clockwise around a circle, one character at
    a time — Pillow has no curved-text/textPath primitive, so each
    glyph is rendered to its own small transparent tile, rotated to sit
    tangent to the ring at its position, and pasted.

    EQUAL ANGULAR STEPS PER CHARACTER, not per-glyph-width spacing —
    this matches what the prototype's own `_ring_text` already implies:
    it fills a FIXED character budget (`circumference / 3.35`) rather
    than measuring real glyph widths, so the source text was already
    being treated as uniform-width dense texture, not typeset prose.
    Matching that assumption here rather than adding real proportional
    spacing this ring was never designed to have.
    """
    n = len(text)
    if n == 0:
        return

    step_deg = 360.0 / n
    for i, ch in enumerate(text):
        if ch == " ":
            continue
        angle_deg = start_angle_deg + i * step_deg
        angle_rad = math.radians(angle_deg)

        # A small square tile, generously sized for the glyph — rotation
        # needs headroom on every side or corners clip.
        tile_size = max(16, int(font.size * 2.4))
        tile = Image.new("RGBA", (tile_size, tile_size), (0, 0, 0, 0))
        tile_draw = ImageDraw.Draw(tile)
        tw = tile_draw.textlength(ch, font=font)
        tile_draw.text((tile_size / 2 - tw / 2, tile_size / 2 - font.size / 2), ch, font=font, fill=colour)

        # Rotate so the glyph's own "up" points outward from the ring
        # centre — the glyph's baseline runs tangent to the circle,
        # matching how SVG's textPath orients characters along a path.
        rotated = tile.rotate(-angle_deg - 90, resample=Image.BICUBIC, expand=False)

        px = cx + math.cos(angle_rad) * radius
        py = cy + math.sin(angle_rad) * radius
        paste_x = round(px - tile_size / 2)
        paste_y = round(py - tile_size / 2)
        canvas.paste(rotated, (paste_x, paste_y), rotated)


#: Direct port of the frontend's own `SLEEVE_PALETTES` — the same six
#: hex values, so a customer previewing Red in the Studio receives an
#: actually-red print, not the Cream this backend used to hardcode
#: regardless of what was picked. Kept as its own dict rather than
#: importing from the frontend (a different language, a different
#: repo) — the two are proven to agree by the parity test in this
#: module's own `tests.py`, the same discipline the seeded waveform's
#: two independent implementations already follow.
SLEEVE_PALETTES: dict[str, dict[str, str]] = {
    "cream": {"bg": "#f1ece2", "ink": "#171512", "soft": "#5c574c"},
    "mustard": {"bg": "#e3a83c", "ink": "#171512", "soft": "#4a3b18"},
    "red": {"bg": "#b93b2c", "ink": "#f4eee1", "soft": "#e7c9bf"},
    "orange": {"bg": "#d66f2e", "ink": "#171512", "soft": "#4a2e14"},
    "black": {"bg": "#151412", "ink": "#efe8d6", "soft": "#b7ae97"},
    "blueGrey": {"bg": "#57666c", "ink": "#f1eee4", "soft": "#c7cfd1"},
}


def _draw_sleeve_disc(
    canvas: Image.Image, *, cx: float, cy: float, radius: float, scale: float, ring_source: str, font, ink: str, bg: str
) -> None:
    """One of Sleeve's two discs — ink-coloured circle, four curved text
    rings, a bare hub. `radius` is the design-space disc radius (150,
    matching the prototype's `R=150` in its own `svDisc`); ring radii
    scale proportionally from it.

    `ink`/`bg` are the SELECTED PALETTE'S colours, not the module-wide
    `_INK`/`_BG` constants — Sleeve's disc is genuinely ink-on-ground,
    inverted from most other themes' ground-on-ink, so its two colours
    swap roles between the disc body and its ring text/hub exactly the
    way the frontend's inline SVG does via `var(--sv-ink)`/`var(--sv-bg)`.
    """
    draw = ImageDraw.Draw(canvas)
    outer_r = radius * (148 / 150) * scale
    bbox = [cx - outer_r, cy - outer_r, cx + outer_r, cy + outer_r]
    draw.ellipse(bbox, fill=ink)

    for i, r in enumerate([130, 113, 96, 79]):
        ring_r = r * scale
        circumference = 2 * math.pi * r  # design-space circumference — the
        # SAME character budget regardless of print scale, matching the
        # prototype's own ring text, which is computed once against the
        # SVG's fixed 0..300 viewBox, never against final pixel size.
        text = _ring_text(ring_source, circumference)
        start = 180.0 if i % 2 else 0.0  # `startOffset="50%"` on odd rings
        _draw_curved_ring(canvas, cx=cx, cy=cy, radius=ring_r, text=text, font=font, colour=bg, start_angle_deg=start)

    hub_r = 25 * scale
    hub_bbox = [cx - hub_r, cy - hub_r, cx + hub_r, cy + hub_r]
    draw.ellipse(hub_bbox, fill=bg, outline=ink, width=max(1, round(scale)))
    dot_r = 2.6 * scale
    draw.ellipse([cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r], fill=ink)


SLEEVE_DESIGN_W = 1200
SLEEVE_DESIGN_H = 800


def _draw_sleeve(canvas: Image.Image, song: NormalizedSongPoster, *, scale: float, origin: tuple[int, int], customer) -> None:
    """Sleeve's poster composition — LANDSCAPE ONLY. See `sleeve-theme.
    tsx`'s own docstring: album/year/runtime credits dropped, and the
    ring text uses dedication in place of the prototype's own lyric-
    or-dedication fallback chain — there is no `lyric` field in this
    schema at all.

    ALL SIX PALETTES ARE NOW WIRED UP HERE TOO — an earlier version of
    this function hardcoded Cream regardless of `song.sleeve_palette`,
    which meant a customer who picked Red in the Studio would have
    received a Cream print. `_draw_sleeve` re-fills the whole canvas in
    the selected palette's own `bg` as its first act, overriding
    whatever colour `render_png` created the canvas with (the static
    per-theme default in `_THEME_RENDERERS`, which has no way to know a
    customer's in-Studio palette choice) — self-contained here rather
    than teaching the generic dispatch in `render_png` about one
    theme's own sub-selection.
    """
    palette = SLEEVE_PALETTES.get(song.sleeve_palette, SLEEVE_PALETTES["cream"])
    ink = palette["ink"]
    soft = palette["soft"]
    bg = palette["bg"]

    draw = ImageDraw.Draw(canvas)
    ox, oy = origin
    draw.rectangle([0, 0, canvas.width, canvas.height], fill=bg)

    def pt(x: float, y: float) -> tuple[int, int]:
        return (round(ox + x * scale), round(oy + y * scale))

    ring_font = _font("DejaVuSans.ttf", 6.3, scale)
    title_font = _font("DejaVuSans-Bold.ttf", 46, scale)
    artist_font = _font("DejaVuSans.ttf", 15, scale)
    foot_font = _font("DejaVuSans.ttf", 14.5, scale)

    # --- layout constants, design space -------------------------------
    row_left, row_right = 64.0, SLEEVE_DESIGN_W - 64.0
    hearts_w, hearts_h = 520.0, 340.0
    hearts_top = (SLEEVE_DESIGN_H - hearts_h) / 2
    disc_size = 300.0

    left_cx = row_left + 10 + disc_size / 2
    right_cx = row_left + hearts_w - 10 - disc_size / 2
    disc_cy = hearts_top + disc_size / 2

    ring_source = song.dedication.strip()
    _draw_sleeve_disc(canvas, cx=ox + left_cx * scale, cy=oy + disc_cy * scale, radius=150, scale=scale, ring_source=ring_source, font=ring_font, ink=ink, bg=bg)
    _draw_sleeve_disc(canvas, cx=ox + right_cx * scale, cy=oy + disc_cy * scale, radius=150, scale=scale, ring_source=ring_source, font=ring_font, ink=ink, bg=bg)

    # --- the sleeve photo, rotated, tucked in the seam ------------------
    sleeve_size = 150.0
    sleeve_cx = row_left + hearts_w / 2
    sleeve_cy = hearts_top + hearts_h  # `bottom:0` of `.sv-hearts`, plus the
    # `translate(-50%, 10%)` below shifts it down by 10% of ITS OWN height.
    sleeve_cy += sleeve_size * 0.10

    if song.photo_asset_id:
        try:
            raw_bytes, _mime = get_asset_bytes_for_customer(customer, song.photo_asset_id)
            with Image.open(io.BytesIO(raw_bytes)) as photo:
                photo = photo.convert("RGB")
                side = min(photo.size)
                left = (photo.width - side) // 2
                top = (photo.height - side) // 2
                target = round(sleeve_size * scale)
                photo = photo.crop((left, top, left + side, top + side)).resize((target, target), Image.LANCZOS)
                rotated = photo.convert("RGBA").rotate(16, resample=Image.BICUBIC, expand=True)
                paste_x = round(ox + sleeve_cx * scale - rotated.width / 2)
                paste_y = round(oy + sleeve_cy * scale - rotated.height / 2)
                canvas.paste(rotated, (paste_x, paste_y), rotated)
        except Exception as exc:  # noqa: BLE001
            raise SongPosterRenderFailed("Could not render the referenced photo.") from exc

    # --- info column: swatches + mark, title, artist --------------------
    info_x = row_left + hearts_w + 56  # `.sv-lrow`'s own `gap`
    info_right = row_right
    cursor_y = hearts_top

    swatch = 16.0
    for i, colour in enumerate(["#1f6e6b", "#c6432e", "#d9a233"]):
        x0 = info_x + i * (swatch + 6)
        draw.rectangle([pt(x0, cursor_y), pt(x0 + swatch, cursor_y + swatch)], fill=colour)

    mark_size = 46.0
    mark_box = [pt(info_right - mark_size, cursor_y), pt(info_right, cursor_y + mark_size)]
    mcx, mcy = (mark_box[0][0] + mark_box[1][0]) / 2, (mark_box[0][1] + mark_box[1][1]) / 2
    mark_r = 15 * scale
    draw.ellipse([mcx - mark_r, mcy - mark_r, mcx + mark_r, mcy + mark_r], outline=ink, width=max(1, round(scale)))
    draw.line([(mcx - mark_r * 2, mcy), (mcx + mark_r * 2, mcy)], fill=ink, width=max(1, round(scale)))
    draw.line([(mcx, mcy - mark_r * 2), (mcx, mcy + mark_r * 2)], fill=ink, width=max(1, round(scale)))

    cursor_y += mark_size + 24  # `.sv-head`'s margin-bottom

    title_text = _fit_text(draw, song.track, title_font, (info_right - info_x) * scale)
    draw.text(pt(info_x, cursor_y), title_text, font=title_font, fill=ink)
    title_box = draw.textbbox(pt(info_x, cursor_y), title_text, font=title_font)
    cursor_y += (title_box[3] - title_box[1]) / scale + 8

    draw.text(pt(info_x, cursor_y), song.artist.upper(), font=artist_font, fill=soft)

    # --- foot ----------------------------------------------------------
    foot_y = SLEEVE_DESIGN_H - 40 - 14.5
    draw.text(pt(56, foot_y), song.artist.upper(), font=foot_font, fill=soft)
    wordmark = "HEARTFOLIO"
    ww = draw.textlength(wordmark, font=foot_font)
    draw.text((pt(SLEEVE_DESIGN_W - 56, foot_y)[0] - ww, pt(0, foot_y)[1]), wordmark, font=foot_font, fill=soft)


#: Direct port of the prototype's own `MOSAIC_MARKS` — authored
#: percentages (of the design canvas), not random, matching the
#: frontend's own `MOSAIC_MARKS` array field for field.
_MOSAIC_MARK_POSITIONS = [
    (14, 8, 46, -12, 0.92), (34, 15, 28, 9, 0.70), (62, 7, 40, -7, 0.86), (84, 16, 26, 0, 0.72),
    (16, 88, 34, -9, 0.80), (40, 92, 40, 6, 0.92), (63, 86, 28, 10, 0.70), (84, 92, 30, -6, 0.74),
]


def _draw_vector_heart(canvas: Image.Image, *, cx: float, cy: float, size: float, rotation_deg: float, opacity: float) -> None:
    """A hand-drawn vector heart, standing in for ALL EIGHT of the
    prototype's marks — hearts, notes, sparkle, headphones, a disc.

    WHY ONE SHAPE FOR SIX DIFFERENT MARKS: the prototype's own marks
    are real emoji, rendered by the OS's font stack — fine in a
    browser, where every platform ships emoji glyphs. DejaVu Sans (the
    only font bundled with this renderer) has none. Attempting to draw
    "🎧"/"💿"/"✨" with it would not degrade gracefully — it would
    render as missing-glyph boxes, genuinely broken, not merely
    inconsistent the way the prototype's own material note already
    warns emoji can be across devices. A single heart — Heartfolio's
    own mark, and one already used twice in the original eight — reads
    as a deliberate texture rather than a bug the other five distinct
    icons would. A full six-icon vector set is real, separate
    illustration work this pass does not attempt.
    """
    draw = ImageDraw.Draw(canvas, "RGBA")
    tile = Image.new("RGBA", (max(8, round(size * 2)), max(8, round(size * 2))), (0, 0, 0, 0))
    tdraw = ImageDraw.Draw(tile)
    tcx = tile.width / 2
    tcy = tile.height / 2
    r = size * 0.34
    alpha = round(255 * opacity)
    fill = (237, 237, 232, alpha)
    tdraw.ellipse([tcx - r * 1.9, tcy - r * 0.9, tcx - r * 0.1, tcy + r * 0.9], fill=fill)
    tdraw.ellipse([tcx + r * 0.1, tcy - r * 0.9, tcx + r * 1.9, tcy + r * 0.9], fill=fill)
    tdraw.polygon(
        [(tcx - r * 1.85, tcy + r * 0.25), (tcx + r * 1.85, tcy + r * 0.25), (tcx, tcy + r * 2.3)],
        fill=fill,
    )
    rotated = tile.rotate(-rotation_deg, resample=Image.BICUBIC, expand=False)
    canvas.paste(rotated, (round(cx - tile.width / 2), round(cy - tile.height / 2)), rotated)


def _mosaic_card_height(draw, song: NormalizedSongPoster, *, title_font, artist_font, dedication_font, times_font, foot_font) -> float:
    """The card's total height depends on whether a dedication exists
    and how long it is — computed once, DRY-RUN style, so the card can
    be vertically centred (`top:50%; transform:translateY(-50%)` in the
    CSS) before anything is actually drawn, rather than guessed."""
    height = 340.0  # `.ms-hero .art`'s fixed photo height
    height += 20  # `.ms-hero-body`'s own top padding

    title_box = draw.textbbox((0, 0), song.track or " ", font=title_font)
    height += (title_box[3] - title_box[1]) + 3
    artist_box = draw.textbbox((0, 0), song.artist or " ", font=artist_font)
    height += artist_box[3] - artist_box[1]

    height += 16 + 20  # `.ms-progress`'s margin-top + its own height
    times_box = draw.textbbox((0, 0), "0:00", font=times_font)
    height += 5 + (times_box[3] - times_box[1])  # `.ms-times`'s margin-top

    if song.dedication:
        ded_box = draw.textbbox((0, 0), song.dedication, font=dedication_font)
        height += 16 + (ded_box[3] - ded_box[1])

    foot_box = draw.textbbox((0, 0), "A", font=foot_font)
    height += 10 + (foot_box[3] - foot_box[1])  # `.ms-foot`'s margin-top

    height += 24  # `.ms-hero-body`'s own bottom padding
    return height


def _draw_mosaic(canvas: Image.Image, song: NormalizedSongPoster, *, scale: float, origin: tuple[int, int], customer) -> None:
    """Mosaic's poster composition — the simplest of the eight
    themes: a hero card floating on a dark, marked ground. See this
    module's own docstring on `_draw_vector_heart` for why the marks
    are a single heart, not the original six-icon mix.
    """
    draw = ImageDraw.Draw(canvas)
    ox, oy = origin
    ink = "#edede8"
    soft = "#a9a9a2"
    rule_colour = "#3a3a3b"

    def pt(x: float, y: float) -> tuple[int, int]:
        return (round(ox + x * scale), round(oy + y * scale))

    title_font = _font("DejaVuSans-Bold.ttf", 26, scale)
    artist_font = _font("DejaVuSans.ttf", 14.5, scale)
    dedication_font = _font("DejaVuSans-Italic.ttf", 16, scale) if (_FONT_DIR / "DejaVuSans-Italic.ttf").exists() else _font("DejaVuSans.ttf", 16, scale)
    times_font = _font("DejaVuSansMono.ttf", 13, scale)
    foot_font = _font("DejaVuSans.ttf", 13, scale)

    # --- the eight marks, on the ground, drawn FIRST so the card sits
    #     on top of them --------------------------------------------
    for x_pct, y_pct, size, rotation, opacity in _MOSAIC_MARK_POSITIONS:
        mx = ox + (x_pct / 100) * DESIGN_W * scale
        my = oy + (y_pct / 100) * DESIGN_H * scale
        _draw_vector_heart(canvas, cx=mx, cy=my, size=size * scale, rotation_deg=rotation, opacity=opacity)

    # --- the card, vertically and horizontally centred -------------------
    card_w = 560.0
    card_h = _mosaic_card_height(draw, song, title_font=title_font, artist_font=artist_font, dedication_font=dedication_font, times_font=times_font, foot_font=foot_font) / scale
    card_left = (DESIGN_W - card_w) / 2
    card_top = (DESIGN_H - card_h) / 2

    card_box = (*pt(card_left, card_top), *pt(card_left + card_w, card_top + card_h))
    draw.rectangle(card_box, fill="#0e0f10")
    draw.rectangle(card_box, outline=rule_colour, width=max(1, round(scale)))

    # --- photo, top of the card -----------------------------------------
    photo_box = (card_box[0], card_box[1], card_box[2], card_box[1] + round(340 * scale))
    if song.photo_asset_id:
        try:
            raw_bytes, _mime = get_asset_bytes_for_customer(customer, song.photo_asset_id)
            with Image.open(io.BytesIO(raw_bytes)) as photo:
                photo = photo.convert("RGB")
                target_w, target_h = photo_box[2] - photo_box[0], photo_box[3] - photo_box[1]
                src_ratio = photo.width / photo.height
                dst_ratio = target_w / target_h
                if src_ratio > dst_ratio:
                    new_w = round(photo.height * dst_ratio)
                    left = (photo.width - new_w) // 2
                    photo = photo.crop((left, 0, left + new_w, photo.height))
                else:
                    new_h = round(photo.width / dst_ratio)
                    top = (photo.height - new_h) // 2
                    photo = photo.crop((0, top, photo.width, top + new_h))
                photo = photo.resize((target_w, target_h), Image.LANCZOS)
                canvas.paste(photo, (photo_box[0], photo_box[1]))
        except Exception as exc:  # noqa: BLE001
            raise SongPosterRenderFailed("Could not render the referenced photo.") from exc
    else:
        draw.rectangle(photo_box, fill="#2a2a2c")

    # --- body: title/artist/heart, progress, dedication, footer -------
    body_left = card_left + 26
    body_right = card_left + card_w - 26
    cursor_y = card_top + 340 + 20

    title_text = _fit_text(draw, song.track, title_font, (body_right - body_left - 30) * scale)
    draw.text(pt(body_left, cursor_y), title_text, font=title_font, fill=ink)
    title_box = draw.textbbox(pt(body_left, cursor_y), title_text, font=title_font)
    cursor_y += (title_box[3] - title_box[1]) / scale + 3

    draw.text(pt(body_left, cursor_y), song.artist.upper(), font=artist_font, fill=soft)
    artist_box = draw.textbbox(pt(body_left, cursor_y), song.artist.upper(), font=artist_font)

    # A small heart, top-right of the row — matches `.ms-heart`'s own
    # SVG outline. Reuses `_draw_vector_heart` rather than a plain
    # circle, so the one "real" heart in this composition and the
    # eight decorative ground marks are drawn by the same shape, not
    # two different approximations of the same idea.
    heart_size = 16 * scale
    heart_cx = pt(body_right, 0)[0] - heart_size / 2
    heart_cy = pt(0, cursor_y)[1] + 3 * scale + heart_size / 2
    _draw_vector_heart(canvas, cx=heart_cx, cy=heart_cy, size=heart_size * 0.9, rotation_deg=0, opacity=1.0)

    cursor_y += (artist_box[3] - artist_box[1]) / scale + 16  # `.ms-progress`'s margin-top

    # --- progress: static, unplayed (see module docstring on why) -----
    rule_y = pt(0, cursor_y + 9)[1]
    draw.line([pt(body_left, cursor_y + 9), pt(body_right, cursor_y + 9)], fill=rule_colour, width=max(1, round(scale)))
    cursor_y += 20 + 5  # `.ms-progress`'s own height + `.ms-times`'s margin-top

    draw.text(pt(body_left, cursor_y), "0:00", font=times_font, fill=soft)
    times_box = draw.textbbox((0, 0), "0:00", font=times_font)
    cursor_y += (times_box[3] - times_box[1]) / scale

    # --- dedication ------------------------------------------------------
    if song.dedication:
        cursor_y += 16
        msg = _fit_text(draw, song.dedication, dedication_font, (body_right - body_left) * scale)
        draw.text(pt(body_left, cursor_y), msg, font=dedication_font, fill=soft)
        msg_box = draw.textbbox(pt(body_left, cursor_y), msg, font=dedication_font)
        cursor_y += (msg_box[3] - msg_box[1]) / scale

    # --- footer ----------------------------------------------------------
    cursor_y += 10
    draw.text(pt(body_left, cursor_y), song.artist.upper(), font=foot_font, fill=soft)
    wordmark = "HEARTFOLIO"
    ww = draw.textlength(wordmark, font=foot_font)
    draw.text((pt(body_right, cursor_y)[0] - ww, pt(0, cursor_y)[1]), wordmark, font=foot_font, fill=soft)


def _draw_wallpaper(canvas: Image.Image, song: NormalizedSongPoster, *, device, customer) -> None:
    """Player's OWN wallpaper composition — full-bleed photo, a bottom
    scrim, track + artist. Not a crop of the poster design; the poster's
    fixed 60px margins and 800-wide layout have no sensible mapping onto
    a phone's 1290x2796 shape or a desktop's 3840x2160 one, which is
    exactly what the previous cover-crop-of-the-poster version got
    wrong — proven by actually rendering it and reading the result:
    "Halfway Home" cropped down to "way Home" on a real phone ratio.

    THE SAME SHAPE AS LOVE STORY TIMELINE'S MOMENT WALLPAPER, on
    purpose — full photo, eased bottom scrim, text seated inside
    `device.safe_bottom` — because it is solving the identical problem
    (a device wallpaper needs to clear the OS's own furniture) with the
    same answer. See that renderer's `_render_moment_wallpaper` and this
    product's own frontend twin, `MomentWallpaper` in
    `preview-modes.tsx`, whose docstring this composition matches
    field-for-field so the Studio preview and this file do not quietly
    diverge from each other.

    NOTHING SITS IN `safe_top`. A lock screen's clock lives there; the
    photo is free to extend through it (it is just an image), but no
    text or scrim does.
    """
    width, height = device.width, device.height
    draw = ImageDraw.Draw(canvas)

    if song.photo_asset_id:
        _paste_photo_cover(canvas, customer=customer, asset_id=song.photo_asset_id, box=(0, 0, width, height))
    else:
        # Matches the frontend's own fallback reasoning: a plain fill,
        # not an error state — a paid download must not fail outright
        # over a missing decorative element.
        for y in range(height):
            t = y / height
            r = round(58 + (36 - 58) * t)
            g = round(54 + (33 - 54) * t)
            b = round(48 + (29 - 48) * t)
            draw.line([(0, y), (width, y)], fill=(r, g, b))

    # Eased scrim: three gradient stops rather than a hard edge, same
    # curve shape the frontend approximates with a three-stop CSS
    # gradient — not identical pixel-for-pixel (Pillow has no linear-
    # gradient primitive; this draws it row by row), close enough that
    # neither reads as a visibly different treatment.
    band_height = round(height * 0.20)
    band_bottom = height - round(height * device.safe_bottom)
    band_top = band_bottom - band_height
    overlay = Image.new("RGBA", (width, band_height), (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)
    for row in range(band_height):
        t = row / band_height
        if t < 0.55:
            alpha = int(0.28 * 255 * (t / 0.55))
        else:
            alpha = int((0.28 + (0.62 - 0.28) * (t - 0.55) / 0.45) * 255)
        odraw.line([(0, row), (width, row)], fill=(0, 0, 0, alpha))
    canvas.paste(Image.alpha_composite(canvas.crop((0, band_top, width, band_bottom)).convert("RGBA"), overlay).convert("RGB"), (0, band_top))

    # Sized off the SHORTER canvas dimension, not a fixed px value — a
    # phone (1290 wide) and a desktop (2160 tall) need genuinely
    # different absolute sizes for the same relative prominence, the
    # same reason the frontend's moment caption uses container-query
    # units rather than a fixed rem size.
    unit = min(width, height)
    title_font = ImageFont.truetype(str(_FONT_DIR / "DejaVuSans-Bold.ttf"), size=max(18, round(unit * 0.045)))
    artist_font = ImageFont.truetype(str(_FONT_DIR / "DejaVuSans.ttf"), size=max(12, round(unit * 0.028)))

    pad_bottom = round(height * device.safe_bottom) + round(unit * 0.03)
    artist_text = song.artist
    artist_box = draw.textbbox((0, 0), artist_text, font=artist_font)
    artist_h = artist_box[3] - artist_box[1]
    artist_y = height - pad_bottom - artist_h
    artist_w = draw.textlength(artist_text, font=artist_font)
    draw.text(((width - artist_w) / 2, artist_y), artist_text, font=artist_font, fill=(236, 234, 230))

    title_text = _fit_text(draw, song.track, title_font, width * 0.84)
    title_box = draw.textbbox((0, 0), title_text, font=title_font)
    title_h = title_box[3] - title_box[1]
    title_y = artist_y - title_h - round(unit * 0.012)
    title_w = draw.textlength(title_text, font=title_font)
    draw.text(((width - title_w) / 2, title_y), title_text, font=title_font, fill=(255, 255, 255))


#: Mirrors the frontend's `SONG_POSTER_THEMES` registry — one entry per
#: theme, each providing its own poster-composition and wallpaper-
#: composition functions. Only "player" exists; adding a theme here is
#: meant to be the ENTIRE change needed, the same way adding one to the
#: frontend registry is — `render_png` below never branches on a theme
#: id directly, only ever looks it up here.
_THEME_RENDERERS: dict[str, dict[str, object]] = {
    "player": {"poster": _draw_player, "wallpaper": _draw_wallpaper, "bg": _BG, "soft": _SOFT},
    "ledger": {"poster": _draw_ledger, "wallpaper": _draw_wallpaper, "bg": "#e7e3d8", "soft": "#6c6455"},
    "ephemeris": {"poster": _draw_ephemeris, "wallpaper": _draw_wallpaper, "bg": "#12161c", "soft": "#8e8c82"},
    "contactsheet": {"poster": _draw_contact_sheet, "wallpaper": _draw_wallpaper, "bg": "#edeae2", "soft": "#68665d"},
    "label": {"poster": _draw_label, "wallpaper": _draw_wallpaper, "bg": "#edeae3", "soft": "#68665d"},
    "award": {
        "poster": _draw_award,
        "wallpaper": _draw_wallpaper,
        "bg": "#f1ede3",
        "soft": "#6b675c",
        "design_w": AWARD_DESIGN_W,
        "design_h": AWARD_DESIGN_H,
    },
    "sleeve": {
        "poster": _draw_sleeve,
        "wallpaper": _draw_wallpaper,
        "bg": "#f1ece2",
        "soft": "#5c574c",
        "design_w": SLEEVE_DESIGN_W,
        "design_h": SLEEVE_DESIGN_H,
    },
    "mosaic": {"poster": _draw_mosaic, "wallpaper": _draw_wallpaper, "bg": "#17181a", "soft": "#a9a9a2"},
}


def render_png(song: NormalizedSongPoster, *, target_id: str, customer) -> bytes:
    theme_renderers = _THEME_RENDERERS.get(song.theme, _THEME_RENDERERS["player"])
    draw_poster = theme_renderers["poster"]
    draw_wallpaper = theme_renderers["wallpaper"]
    theme_bg = theme_renderers["bg"]
    theme_soft = theme_renderers["soft"]
    theme_design_w = theme_renderers.get("design_w", DESIGN_W)
    theme_design_h = theme_renderers.get("design_h", DESIGN_H)

    # Sleeve alone has a SECOND, customer-chosen colour selection on top
    # of its theme — `_THEME_RENDERERS`'s static "bg"/"soft" are only
    # ever Cream, since the registry has no way to know a particular
    # order's palette pick. Overridden here, explicitly, the same way
    # the print/wallpaper orientation swap below already makes a small,
    # targeted exception for one theme rather than teaching the whole
    # dispatch about it: without this, the CANVAS `render_png` creates
    # and the attribution mark it draws would still be Cream even when
    # `_draw_sleeve` itself correctly repaints the composition in Red,
    # Black, or whichever palette was actually chosen.
    if song.theme == "sleeve":
        palette = SLEEVE_PALETTES.get(song.sleeve_palette, SLEEVE_PALETTES["cream"])
        theme_bg = palette["bg"]
        theme_soft = palette["soft"]

    print_match = parse_print_target(target_id)
    wallpaper_match = parse_wallpaper_target(target_id)

    if print_match is not None:
        size_id, mounting = print_match
        width, height = print_target_dimensions()[target_id]

        # `print_target_dimensions()` returns PORTRAIT pixels always — see
        # that function's own module docstring, which states plainly that
        # a landscape layout needs to swap them at render time rather
        # than the static catalog trying to pre-declare two orientations
        # of the same physical paper size. This mirrors the frontend's
        # own `dimensionsFor(size, orientation)` helper exactly, applied
        # here for Award and Sleeve — the same real gap Love Story
        # Timeline's own `exports.ts` already documents ("the export
        # engine will need to call dimensionsFor... at render time") but
        # had never actually needed until these two themes existed.
        #
        # A landscape theme is identified by its OWN design canvas
        # being wider than it is tall — not a separate flag to keep in
        # sync, since the canvas shape already says everything needed.
        if theme_design_w > theme_design_h:
            width, height = height, width

        canvas = Image.new("RGB", (width, height), theme_bg)

        if mounting == EDGED:
            margin = edged_margin_px()
            inner_w, inner_h = width - margin * 2, height - margin * 2
            scale = min(inner_w / theme_design_w, inner_h / theme_design_h)
            drawn_w, drawn_h = theme_design_w * scale, theme_design_h * scale
            origin = (margin + (inner_w - drawn_w) / 2, margin + (inner_h - drawn_h) / 2)
            draw_poster(canvas, song, scale=scale, origin=origin, customer=customer)
            _draw_attribution(canvas, content_box=(margin, margin, width - margin, height - margin), bg=theme_bg, soft=theme_soft)
        else:
            scale = max(width / theme_design_w, height / theme_design_h)
            drawn_w, drawn_h = theme_design_w * scale, theme_design_h * scale
            origin = ((width - drawn_w) / 2, (height - drawn_h) / 2)
            draw_poster(canvas, song, scale=scale, origin=origin, customer=customer)
            _draw_attribution(canvas, content_box=(0, 0, width, height), bg=theme_bg, soft=theme_soft)

    elif wallpaper_match is not None:
        device = wallpaper_match
        canvas = Image.new("RGB", (device.width, device.height), theme_bg)
        draw_wallpaper(canvas, song, device=device, customer=customer)
        _draw_attribution(canvas, content_box=(0, 0, device.width, device.height), bg=theme_bg, soft=theme_soft)

    else:
        raise SongPosterRenderFailed(f"'{target_id}' is not a supported Song Poster export target.")

    buffer = io.BytesIO()
    canvas.save(buffer, format="PNG")
    return buffer.getvalue()
