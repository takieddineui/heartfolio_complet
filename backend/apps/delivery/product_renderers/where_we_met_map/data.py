"""
Where We Met Map data contract — validation and normalization.

This is the *one* place in the codebase that interprets Where We Met
Map's `values`/`themeSelections`. `Project.data` stays fully opaque
everywhere else (Phase 3.4/3.8 rule).

The contract below was read directly out of the real frontend product
module, not guessed — note the actual product **slug is `"heart-map"`**
even though the module's own folder/internal naming is
`where-we-met-map` (src/lib/products/registry.ts,
src/lib/studio/product-modules/registry.ts):

  - `schema.ts`        — field list, required-ness, max lengths
  - `metadata.ts`       — `messageMaxLength` (90)
  - `initial-state.ts`  — the exact `MapValues`/`CoordinatesValue` shape
  - `themes.ts`         — five theme axes (`palette`, `typography`,
                           `mapStyle`, `markerStyle`, `frame` — plus
                           `format`/`scale`, both preview-sizing
                           concerns the backend renderer doesn't need)
  - `validation.ts`     — the one cross-field rule the generic schema
                           validator can't express: `coordinates` is a
                           required object with lat/lng range checks,
                           not a string/array `isEmpty()` can detect

`photo.assetId` is the only part of a `MapPhoto` this module requires —
same reasoning as Love Story Timeline: `url`/`mimeType`/`filename` in
the client-sent value are display-only leftovers from the upload
response and are never trusted for actually retrieving the image.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date as date_cls

from apps.common.exceptions.api_errors import WhereWeMetMapInvalidData

MESSAGE_MAX_LENGTH = 90  # mapMetadata.messageMaxLength

# Exact hex values from themes.ts — not approximated. Only 4 palettes
# (Love Story Timeline has 8) — this product's real theme surface is
# smaller, not an oversight.
PALETTES = {
    "classic": {"bg": "#f7f1e6", "text": "#3a3a38", "muted": "#8a8578", "accent": "#c9a24b", "line": "#c9beac"},
    "midnight": {"bg": "#141b2e", "text": "#f7f1e6", "muted": "#8a91a8", "accent": "#c9a24b", "line": "#3a4462"},
    "sage": {"bg": "#e8ede2", "text": "#3a4536", "muted": "#7f8f74", "accent": "#6b7a5e", "line": "#b7c7ab"},
    "terracotta": {"bg": "#e7cba0", "text": "#3a2a22", "muted": "#8f6f52", "accent": "#b5654b", "line": "#c9a877"},
}
TYPOGRAPHIES = ("serif-classic", "modern")
MAP_STYLES = ("line", "vintage", "night", "topographic")
MARKER_STYLES = ("pin", "heart", "star", "dot")
FRAMES = ("none", "thin-black", "vintage")


@dataclass(frozen=True)
class NormalizedMap:
    partner1: str
    partner2: str
    date: str
    message: str
    location_label: str
    lat: float
    lng: float
    photo_asset_id: str | None
    palette: str
    typography: str
    map_style: str
    marker_style: str
    frame: str
    scale: int


def _string_field(container: dict, key: str, *, max_length: int, required: bool, errors: list[str]) -> str:
    value = container.get(key)
    if value is None or value == "":
        if required:
            errors.append(f"'{key}' is required.")
        return ""
    if not isinstance(value, str):
        errors.append(f"'{key}' must be a string.")
        return ""
    if len(value) > max_length:
        errors.append(f"'{key}' must be at most {max_length} characters.")
    return value


def _choice_field(container: dict, key: str, *, choices: tuple, default: str, errors: list[str]) -> str:
    value = container.get(key, default)
    if value not in choices:
        errors.append(f"'{key}' must be one of {choices}.")
        return default
    return value


def _validate_coordinates(raw_coordinates, errors: list[str]) -> tuple[float, float]:
    """Mirrors validation.ts's `validateMap` exactly: required, and
    range-checked (lat in [-90, 90], lng in [-180, 180]) — the one rule
    the generic schema validator can't express for an object-valued
    field, so it's re-checked here rather than assumed already-clean.
    """
    if not isinstance(raw_coordinates, dict):
        errors.append("'coordinates' is required.")
        return 0.0, 0.0

    lat = raw_coordinates.get("lat")
    lng = raw_coordinates.get("lng")

    if lat is None or lng is None:
        errors.append("'coordinates' is required.")
        return 0.0, 0.0

    if not isinstance(lat, (int, float)) or isinstance(lat, bool) or not isinstance(lng, (int, float)) or isinstance(lng, bool):
        errors.append("'coordinates.lat'/'coordinates.lng' must be numbers.")
        return 0.0, 0.0

    if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
        errors.append("'coordinates' must be a valid latitude/longitude.")
        return 0.0, 0.0

    return float(lat), float(lng)


def validate_and_normalize(values, theme_selections) -> NormalizedMap:
    """Raises `WhereWeMetMapInvalidData` (with every problem found, not
    just the first) if `values`/`themeSelections` don't match the real
    Where We Met Map contract. Returns a fully-typed, already-validated
    `NormalizedMap` otherwise.
    """
    errors: list[str] = []

    if not isinstance(values, dict):
        raise WhereWeMetMapInvalidData("Project 'values' must be an object.")
    if not isinstance(theme_selections, dict):
        raise WhereWeMetMapInvalidData("Project 'themeSelections' must be an object.")

    partner1 = _string_field(values, "partner1", max_length=20, required=True, errors=errors)
    partner2 = _string_field(values, "partner2", max_length=20, required=True, errors=errors)
    message = _string_field(values, "message", max_length=MESSAGE_MAX_LENGTH, required=False, errors=errors)
    location_label = _string_field(values, "locationLabel", max_length=40, required=True, errors=errors)

    date_value = values.get("date")
    date_str = ""
    if not date_value:
        errors.append("'date' is required.")
    elif not isinstance(date_value, str):
        errors.append("'date' must be a string.")
    else:
        try:
            date_cls.fromisoformat(date_value)
        except ValueError:
            errors.append("'date' must be a valid ISO 8601 date.")
        else:
            date_str = date_value

    lat, lng = _validate_coordinates(values.get("coordinates"), errors)

    photo_asset_id = None
    photo = values.get("photo")
    if photo is not None:
        if not isinstance(photo, dict) or not isinstance(photo.get("assetId"), str) or not photo.get("assetId"):
            errors.append("'photo', if present, must include a non-empty string 'assetId'.")
        else:
            photo_asset_id = photo["assetId"]

    palette = _choice_field(theme_selections, "palette", choices=tuple(PALETTES), default="classic", errors=errors)
    typography = _choice_field(theme_selections, "typography", choices=TYPOGRAPHIES, default="serif-classic", errors=errors)
    map_style = _choice_field(theme_selections, "mapStyle", choices=MAP_STYLES, default="line", errors=errors)
    marker_style = _choice_field(theme_selections, "markerStyle", choices=MARKER_STYLES, default="heart", errors=errors)
    frame = _choice_field(theme_selections, "frame", choices=FRAMES, default="thin-black", errors=errors)

    # Real range is 80-120 (not Timeline's 70-130) — themes.ts's `scale`
    # axis for this product.
    scale = theme_selections.get("scale", 100)
    if not isinstance(scale, (int, float)) or isinstance(scale, bool) or not (80 <= scale <= 120):
        errors.append("'scale' must be a number between 80 and 120.")
        scale = 100

    if errors:
        raise WhereWeMetMapInvalidData("Invalid Where We Met Map project data.", details={"errors": errors})

    return NormalizedMap(
        partner1=partner1,
        partner2=partner2,
        date=date_str,
        message=message,
        location_label=location_label,
        lat=lat,
        lng=lng,
        photo_asset_id=photo_asset_id,
        palette=palette,
        typography=typography,
        map_style=map_style,
        marker_style=marker_style,
        frame=frame,
        scale=int(scale),
    )
