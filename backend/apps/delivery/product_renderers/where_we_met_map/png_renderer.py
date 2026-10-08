"""
Raster (PNG) rendering for Where We Met Map — the product's real
export catalog (src/lib/studio/product-modules/where-we-met-map/
exports.ts) has exactly four PNG targets and **no digital/`__live__`
target at all**, so unlike Love Story Timeline, there is no
`html_renderer.py` here — nothing to build.

Map strategy: confirmed directly from the frontend's own renderer.tsx
comment — "No map tiles, no external service, no backend: an
art-directed static illustration... which is what the actual product
brief describes... rather than literal cartography." This backend
renderer replicates the *exact same* deterministic approach (no
network access, no third-party map API, no credentials needed): a
graticule grid + a deterministic pseudo-random dot scatter (identical
formula to the frontend's, see layout.py) standing in for a basemap,
with the actual coordinate projected onto it and a marker drawn at
that position.

Fonts: reuses the exact same bundled DejaVu fonts as Love Story
Timeline (apps/delivery/product_renderers/love_story_timeline/fonts/)
rather than duplicating ~3MB of font binaries for a second product —
fonts are a generic, product-agnostic asset, not something specific to
either product.

Known frontend quirk, replicated intentionally *not* bug-for-bug: the
real CSS (renderer.module.css) defines per-`mapStyle` stroke colors
targeting `circle`/`path` selectors, but the actual grid backdrop uses
`<line>` elements those selectors never match — so in the current
frontend preview, the grid lines are effectively invisible, and dots
render in a fixed color regardless of `mapStyle` (see the Phase 3.11
report). This renderer implements the colors those CSS rules clearly
*intended* (they're real, named, per-style tokens) rather than
reproducing the frontend's incomplete-selector rendering gap — judged
to be the correct choice for "the authoritative final output," not a
silent redesign.
"""

from __future__ import annotations

import io
import math

from PIL import Image, ImageDraw, ImageFont

from apps.assets.services import get_asset_bytes_for_customer
from apps.common.exceptions.api_errors import WhereWeMetMapRenderFailed
from apps.delivery.product_renderers.love_story_timeline.png_renderer import FONT_DIR

from .data import PALETTES, NormalizedMap
from .layout import decorative_dot_positions, format_date, project

FONT_FILES = {
    "serif-classic": {"heading": "DejaVuSerif-Bold.ttf", "body": "DejaVuSerif.ttf"},
    "modern": {"heading": "DejaVuSans-Bold.ttf", "body": "DejaVuSans.ttf"},
}

# Real dimensions, copied verbatim from exports.ts.
TARGET_DIMENSIONS = {
    "story-png": (1080, 1920),
    "square-png": (1080, 1080),
    "portrait-png": (1080, 1350),
    "print-png": (2480, 3508),
}

FRAME_STYLES = {
    "none": None,
    "thin-black": {"color": "#000000", "thickness": 6},
    "vintage": {"color": "#8b7355", "thickness": 16},
}

# Per-mapStyle grid/dot color and optional background override — the
# intended values from renderer.module.css (see module docstring).
MAP_STYLE_TREATMENTS = {
    "line": {"grid_color_key": "line", "grid_color": None, "opacity": 1.0, "bg_override": None},
    "vintage": {"grid_color_key": "accent", "grid_color": None, "opacity": 0.6, "bg_override": None},
    "night": {"grid_color_key": None, "grid_color": "#3a4462", "opacity": 1.0, "bg_override": "#0c1220"},
    "topographic": {"grid_color_key": "muted", "grid_color": None, "opacity": 1.0, "bg_override": None},
}

MARKER_SIZE = 40
PHOTO_THUMBNAIL_SIZE = 200


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


def _centered_wrapped_text(
    draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, *,
    y: int, canvas_left: int, canvas_width: int, max_width: int, fill: str,
    max_lines: int = 3, line_spacing: int | None = None,
) -> int:
    """Wraps `text` to fit `max_width`, centering each resulting line
    within `canvas_width`. Prevents the exact bug found during Phase
    3.11 visual verification: long names/messages on a narrow canvas
    (e.g. `square-png`) were clipped off both edges by a single-line
    centered draw that never checked whether the text actually fit.
    """
    spacing = line_spacing or int(font.size * 1.3)
    lines = _wrap_text(draw, text, font, max_width)
    truncated = len(lines) > max_lines
    lines = lines[:max_lines]
    if truncated and lines:
        last = lines[-1]
        while last and draw.textbbox((0, 0), last + "\u2026", font=font)[2] > max_width:
            last = last[:-1]
        lines[-1] = last + "\u2026"

    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        line_width = bbox[2] - bbox[0]
        x = canvas_left + (canvas_width - line_width) / 2
        draw.text((x, y), line, font=font, fill=fill)
        y += spacing
    return y


def _font(path_name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_DIR / path_name), size=size)


def _hex_with_opacity(hex_color: str, opacity: float) -> tuple[int, int, int, int]:
    hex_color = hex_color.lstrip("#")
    r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    return (r, g, b, int(255 * opacity))


def _draw_map_backdrop(image: Image.Image, *, box: tuple[int, int, int, int], palette: dict, map_style: str) -> None:
    left, top, right, bottom = box
    width, height = right - left, bottom - top
    treatment = MAP_STYLE_TREATMENTS[map_style]

    bg_color = treatment["bg_override"] or palette["bg"]
    overlay = Image.new("RGBA", (width, height), bg_color)
    draw = ImageDraw.Draw(overlay)

    grid_color_key = treatment["grid_color_key"]
    grid_color_hex = palette[grid_color_key] if grid_color_key else treatment["grid_color"]
    grid_color = _hex_with_opacity(grid_color_hex, treatment["opacity"])

    # 7 grid lines at (i+1) * (100/8) percent — identical to
    # renderer.tsx's DecorativeMapBackdrop.
    for i in range(7):
        position_pct = (i + 1) * (100 / 8)
        x = width * position_pct / 100
        y = height * position_pct / 100
        draw.line([(x, 0), (x, height)], fill=grid_color, width=1)
        draw.line([(0, y), (width, y)], fill=grid_color, width=1)

    for dot_x_pct, dot_y_pct in decorative_dot_positions(100, 100):
        x = width * dot_x_pct / 100
        y = height * dot_y_pct / 100
        r = max(1, int(width * 0.004))
        draw.ellipse([x - r, y - r, x + r, y + r], fill=grid_color)

    image.paste(overlay, (left, top), overlay)


def _draw_marker(draw: ImageDraw.ImageDraw, *, x: float, y: float, shape: str, color: str, size: int = MARKER_SIZE) -> None:
    """Real, recognizably-distinct shapes per markerStyle — not pixel
    copies of the frontend's SVG paths, but the same visual intent
    (pin/heart/star/dot), anchored so the shape's point sits at (x, y)
    matching the frontend's `transform: translate(-50%, -100%)`.
    """
    half = size / 2
    top = y - size
    if shape == "dot":
        draw.ellipse([x - half / 1.5, y - size, x + half / 1.5, y - size + size], fill=color)
        return
    if shape == "star":
        points = []
        for i in range(10):
            angle = math.pi / 2 + i * math.pi / 5
            radius = half if i % 2 == 0 else half / 2.3
            points.append((x + radius * math.cos(angle), (y - half) - radius * math.sin(angle)))
        draw.polygon(points, fill=color)
        return
    if shape == "heart":
        cx, cy, s = x, top + size * 0.35, size * 0.32
        draw.ellipse([cx - s, cy - s, cx, cy + s], fill=color)
        draw.ellipse([cx, cy - s, cx + s, cy + s], fill=color)
        draw.polygon([(cx - s, cy + s * 0.4), (cx + s, cy + s * 0.4), (x, y)], fill=color)
        return
    # "pin" (default)
    draw.ellipse([x - half, top, x + half, top + size], fill=color)
    draw.polygon([(x - half * 0.5, top + size * 0.75), (x + half * 0.5, top + size * 0.75), (x, y)], fill=color)


def _shrink_font_to_fit(draw, text: str, path_name: str, *, start_size: int, min_size: int, max_width: int) -> ImageFont.FreeTypeFont:
    """Tries decreasing font sizes until `text` fits on one line within
    `max_width`, with a floor so text never becomes unreadably small.
    Loading a new `ImageFont` per size is required — Pillow fonts
    aren't resizable in place.
    """
    size = start_size
    while size > min_size:
        font = _font(path_name, size)
        if draw.textbbox((0, 0), text, font=font)[2] <= max_width:
            return font
        size -= 2
    return _font(path_name, min_size)


def _wrap_text(draw, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
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

    # A single "word" with no internal whitespace (e.g. a very long
    # URL-like or unbroken string) can still be wider than max_width on
    # its own — the loop above always keeps at least one word per line
    # to guarantee progress, so that case needs a character-level
    # fallback split rather than silently overflowing.
    final_lines: list[str] = []
    for line in lines:
        while draw.textbbox((0, 0), line, font=font)[2] > max_width and len(line) > 1:
            split_at = len(line) - 1
            while split_at > 1 and draw.textbbox((0, 0), line[:split_at], font=font)[2] > max_width:
                split_at -= 1
            final_lines.append(line[:split_at])
            line = line[split_at:]
        final_lines.append(line)
    return final_lines


def _draw_wrapped_centered(draw, text: str, font, *, y: int, content_left: int, content_right: int, max_lines: int, fill, line_spacing: int) -> int:
    max_width = content_right - content_left
    lines = _wrap_text(draw, text, font, max_width)
    truncated = len(lines) > max_lines
    lines = lines[:max_lines]
    if truncated and lines:
        last = lines[-1]
        while last and draw.textbbox((0, 0), last + "\u2026", font=font)[2] > max_width:
            last = last[:-1]
        lines[-1] = last + "\u2026"

    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        x = content_left + (max_width - (bbox[2] - bbox[0])) / 2
        draw.text((x, y), line, font=font, fill=fill)
        y += line_spacing
    return y


def _paste_photo(image: Image.Image, *, customer, asset_id: str, x: int, y: int, size: int) -> None:
    try:
        raw_bytes, _mime_type = get_asset_bytes_for_customer(customer, asset_id)
        with Image.open(io.BytesIO(raw_bytes)) as photo:
            photo = photo.convert("RGB")
            side = min(photo.size)
            left = (photo.width - side) // 2
            top = (photo.height - side) // 2
            photo = photo.crop((left, top, left + side, top + side)).resize((size, size))
            image.paste(photo, (x, y))
    except Exception as exc:  # noqa: BLE001 - any failure here must not crash rendering
        raise WhereWeMetMapRenderFailed("Could not render the referenced photo.") from exc


def render_png(map_data: NormalizedMap, *, target_id: str, customer) -> bytes:
    """`customer` is the *project's* owning customer (`project.customer`
    — an existing, already ownership-verified relationship), used only
    to resolve the optional photo securely.
    """
    if target_id not in TARGET_DIMENSIONS:
        raise WhereWeMetMapRenderFailed(f"No dimensions defined for target '{target_id}'.")

    width, height = TARGET_DIMENSIONS[target_id]
    palette = PALETTES[map_data.palette]
    fonts = FONT_FILES[map_data.typography]
    scale = map_data.scale / 100.0

    image = Image.new("RGB", (width, height), palette["bg"])
    draw = ImageDraw.Draw(image)

    frame_style = FRAME_STYLES[map_data.frame]
    content_left, content_top, content_right, content_bottom = 0, 0, width, height
    if frame_style:
        t = frame_style["thickness"]
        draw.rectangle([0, 0, width - 1, height - 1], outline=frame_style["color"], width=t)
        content_left, content_top = t + 20, t + 20
        content_right, content_bottom = width - t - 20, height - t - 20

    margin = int(30 * scale)
    footer_height = int(height * 0.22)
    map_box = (
        content_left + margin,
        content_top + margin,
        content_right - margin,
        content_bottom - margin - footer_height,
    )

    _draw_map_backdrop(image, box=map_box, palette=palette, map_style=map_data.map_style)

    map_left, map_top, map_right, map_bottom = map_box
    map_width, map_height = map_right - map_left, map_bottom - map_top
    px, py = project(map_data.lat, map_data.lng, map_width, map_height)
    _draw_marker(draw, x=map_left + px, y=map_top + py, shape=map_data.marker_style, color=palette["accent"])

    if map_data.photo_asset_id and customer is not None:
        photo_size = min(PHOTO_THUMBNAIL_SIZE, int(map_width * 0.28))
        _paste_photo(
            image, customer=customer, asset_id=map_data.photo_asset_id,
            x=map_right - photo_size - 16, y=map_bottom - photo_size - 16, size=photo_size,
        )

    # Footer: names, location label, date, message — centered, and
    # shrunk/wrapped to fit the canvas width rather than overflowing
    # past both edges (a real bug found and fixed here during Phase
    # 3.11's manual visual verification — long names/messages on a
    # narrow canvas previously ran clean off both sides).
    footer_top = content_bottom - margin - footer_height + int(20 * scale)
    content_width = content_right - content_left
    heading_max_size = int(width * 0.045 * scale)
    label_max_size = int(width * 0.022 * scale)
    small_size = int(width * 0.018 * scale)
    small_font = _font(fonts["body"], small_size)

    names_text = f"{map_data.partner1} & {map_data.partner2}"
    heading_font = _shrink_font_to_fit(
        draw, names_text, fonts["heading"], start_size=heading_max_size, min_size=int(heading_max_size * 0.4), max_width=content_width
    )
    location_text = map_data.location_label.upper()
    label_font = _shrink_font_to_fit(
        draw, location_text, fonts["body"], start_size=label_max_size, min_size=int(label_max_size * 0.5), max_width=content_width
    )

    def _centered_line(y: int, text: str, font: ImageFont.FreeTypeFont, fill: str) -> int:
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        x = content_left + (content_width - text_width) / 2
        draw.text((x, y), text, font=font, fill=fill)
        return y + int(font.size * 1.4)

    y = footer_top
    y = _centered_line(y, names_text, heading_font, palette["text"])
    y = _centered_line(y, location_text, label_font, palette["accent"])
    if map_data.date:
        y = _centered_line(y, format_date(map_data.date), small_font, palette["muted"])
    if map_data.message:
        _draw_wrapped_centered(
            draw, f"\u201c{map_data.message}\u201d", small_font,
            y=y, content_left=content_left, content_right=content_right,
            max_lines=2, fill=palette["muted"], line_spacing=int(small_size * 1.3),
        )

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()
