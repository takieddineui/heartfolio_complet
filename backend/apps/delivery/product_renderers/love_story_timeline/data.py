"""
Love Story Timeline data contract — validation and normalization.

This is the *one* place in the codebase that interprets Love Story
Timeline's `values`/`themeSelections`. `Project.data` stays fully
opaque everywhere else (Phase 3.4/3.8 rule) — the generic delivery
layer (`apps/delivery/services.py`) never reads a single key out of it.

The contract below was read directly out of the real frontend product
module, not guessed:
  - `schema.ts`      — field list, required-ness, max lengths
  - `metadata.ts`     — min/max event count (1-5)
  - `initial-state.ts` — the exact `TimelineValues`/`TimelineEvent` shape
  - `themes.ts`       — the six theme axes and every option id + real
                         palette hex values
  - `validation.ts`   — the one cross-field rule the generic schema
                         validator can't express: event dates must be
                         unique within a project

`photo.assetId` is the only part of a `TimelinePhoto` this module
requires — `url`/`mimeType`/`filename` in the client-sent value are
display-only leftovers from the upload response and are never trusted
for actually retrieving the image (see png_renderer.py, which
re-resolves the asset by id through the ownership-checked
`apps.assets.services` API instead).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date as date_cls

from apps.common.exceptions.api_errors import LoveStoryTimelineInvalidData

# §4 — the floor mirrors `metadata.ts`: a timeline with one point is not a
# timeline. The ceiling is what the RENDERERS accept, not what the Studio
# offers: the Studio stops at five (`maxEvents` in `metadata.ts`, a product
# decision of 12 Oct 2026), but every composition is verified to eight, and a
# saved project or paid order made with six to eight milestones must keep
# rendering. Lowering this would turn those into failed downloads.
MIN_EVENTS = 3
MAX_EVENTS = 8

# §16 — story types. Mirrors `story-types.ts`.
STORY_TYPES = ("couple", "family", "parents", "gift")

#: §4 — mirrors `MUSIC_PRESETS` ids in music-presets.ts. "none" is a real,
#: first entry, not a special case — see that file for the full reasoning,
#: including the explicit instrumental/no-vocals constraint on whatever
#: presets actually ship (none do yet, by decision, rather than shipped
#: with a fabricated placeholder tone).
MUSIC_PRESETS = ("none", "tender-piano", "quiet-strings", "evening-glow", "still-waters")
#: One limit for every story type — mirrors `MAX_PEOPLE` in `story-types.ts`.
#: The names are joined with "&" into a single header line built around a pair.
MAX_PEOPLE = 2

# Exact hex values from themes.ts — not approximated.
PALETTES = {
    "classic": {"bg": "#f7f1e6", "text": "#3a3a38", "muted": "#8a8578", "accent": "#c9a24b", "line": "#dcd4c4"},
    "blush": {"bg": "#f3e3e0", "text": "#4a2f2b", "muted": "#a67f78", "accent": "#b5654b", "line": "#e3c9c3"},
    "midnight": {"bg": "#141b2e", "text": "#f7f1e6", "muted": "#8a91a8", "accent": "#c9a24b", "line": "#2c3248"},
    "sage": {"bg": "#e8ede2", "text": "#3a4536", "muted": "#7f8f74", "accent": "#6b7a5e", "line": "#cdd8c3"},
    "terracotta": {"bg": "#e7cba0", "text": "#3a2a22", "muted": "#8f6f52", "accent": "#b5654b", "line": "#d8b98a"},
    "monochrome": {"bg": "#ffffff", "text": "#141414", "muted": "#8a8a8a", "accent": "#141414", "line": "#d9d9d9"},
    "gold": {"bg": "#fdf6e3", "text": "#332b12", "muted": "#9c8a52", "accent": "#c9a24b", "line": "#e8dcb0"},
    "forest": {"bg": "#1d2b22", "text": "#e8f0e6", "muted": "#87a08f", "accent": "#c9a24b", "line": "#2f4236"},
}
TYPOGRAPHIES = ("serif-classic", "modern", "script", "typewriter")
# §7 — the six compositions. Mirrors `layouts.ts`, including the two
# landscape ones. The five old ids are gone: nothing has been sold, so no
# stored project references them.
LAYOUTS = (
    "neat-stack",
    "alternating-tilt",
    "overlapping-cascade",
    "dotted-branching",
    "horizontal-polaroid",
    "horizontal-circles",
)
# FRAMES removed (§13) — frame style is no longer a customer input; see
# DEFAULT_FRAME_STYLE in png_renderer.py for what replaced it.



@dataclass(frozen=True)
class TimelineEvent:
    date: str  # ISO 8601, already validated
    title: str
    description: str
    #: §4 — optional.
    #: The place name, always a plain string — every existing renderer
    #: draws this exactly as before. Geographic precision lives alongside
    #: it, never replacing it (§6).
    location: str
    #: §6 — kept for AR and future experiences that need real geography,
    #: not just a caption. None for a milestone with no location, or one
    #: saved before this field existed.
    location_lat: float | None
    location_lng: float | None
    location_mapbox_id: str | None
    #: §4 — required at validation; typed optional because the dataclass is
    #: also built in tests from partial fixtures.
    photo_asset_id: str | None
    #: §5 — optional enhancements. Never reach a printed deliverable: a
    #: poster cannot play a voice note, and the print renderers ignore them.
    video_asset_id: str | None = None
    audio_asset_id: str | None = None


@dataclass(frozen=True)
class NormalizedTimeline:
    # §16 — replaces partner1/partner2. Two fixed slots made the product
    # couple-only.
    story_type: str
    people: list[str]
    poster_title: str
    subtitle: str
    dedication: str
    #: §5 — plays across the Digital experience, user-controlled (§10).
    #: §4 — a preset id from MUSIC_PRESETS, never an uploaded asset.
    #: Renamed from `background_music_asset_id`: it never referenced an
    #: `Asset` row at all once music became a shipped, selectable preset
    #: rather than a customer upload — the old name would have been an
    #: active lie about what the value is.
    background_music_preset: str
    ending_text: str
    show_duration: bool
    auto_sort: bool
    events: list[TimelineEvent]
    palette: str
    typography: str
    layout: str
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


def _location_field(
    container: dict, key: str, *, max_length: int, errors: list[str]
) -> tuple[str, float | None, float | None, str | None]:
    """§6 — a milestone's place, structured rather than reduced to text.

    Accepts `{"name": str, "lat": number, "lng": number, "mapboxId"?: str}`
    from the Studio's Mapbox search. `lat`/`lng` are required together with
    `name` when the object is present at all — a place with a name but no
    coordinates is not what the AR use case in §6 needs, and half-saved
    geography is worse than none, since nothing downstream can tell the
    difference between "no location" and "location without coordinates"
    once they are separated.

    ALSO ACCEPTS A BARE STRING, for exactly one reason: every milestone
    location saved before this field existed IS a plain string. Rejecting
    those outright would make an old draft suddenly fail to open. A legacy
    string becomes the display name with no coordinates — recoverable by
    the customer re-picking the place in the Studio, not a hard failure.
    """
    value = container.get(key)
    if value is None or value == "":
        return "", None, None, None

    if isinstance(value, str):
        if len(value) > max_length:
            errors.append(f"'{key}' must be at most {max_length} characters.")
            return value[:max_length], None, None, None
        return value, None, None, None

    if not isinstance(value, dict):
        errors.append(f"'{key}' must be a string or a Mapbox location object.")
        return "", None, None, None

    name = value.get("name")
    lat = value.get("lat")
    lng = value.get("lng")
    mapbox_id = value.get("mapboxId")

    if not isinstance(name, str) or not name:
        errors.append(f"'{key}.name' is required when '{key}' is set.")
        return "", None, None, None
    if len(name) > max_length:
        errors.append(f"'{key}.name' must be at most {max_length} characters.")
        name = name[:max_length]

    if not isinstance(lat, (int, float)) or isinstance(lat, bool) or not (-90 <= lat <= 90):
        errors.append(f"'{key}.lat' must be a number between -90 and 90.")
        return name, None, None, None
    if not isinstance(lng, (int, float)) or isinstance(lng, bool) or not (-180 <= lng <= 180):
        errors.append(f"'{key}.lng' must be a number between -180 and 180.")
        return name, None, None, None

    if mapbox_id is not None and not isinstance(mapbox_id, str):
        errors.append(f"'{key}.mapboxId', if present, must be a string.")
        mapbox_id = None

    return name, float(lat), float(lng), mapbox_id


def _optional_asset_id(container: dict, key: str, index: int, errors: list[str]) -> str | None:
    """Reads an optional media reference (§5).

    Absent is fine — §5 is explicit that media must never be required, and a
    story with photographs alone is a complete keepsake. PRESENT BUT
    MALFORMED is not fine: it means the Studio sent something broken, and
    letting it through would surface as a failed render after payment.
    """
    raw = container.get(key)
    if raw is None:
        return None
    if not isinstance(raw, dict) or not isinstance(raw.get("assetId"), str) or not raw["assetId"]:
        errors.append(f"events[{index}].{key}, if present, must include a non-empty string 'assetId'.")
        return None
    return raw["assetId"]


def _validate_people(raw_people, errors: list[str]) -> list[str]:
    """§16 — the names in the story.

    The bound is the same for every story type, so this validator does not
    need to know what a "family" is — that is presentation rather than data.
    """
    if not isinstance(raw_people, list) or not (1 <= len(raw_people) <= MAX_PEOPLE):
        errors.append(f"'people' must be a list of 1-{MAX_PEOPLE} items.")
        return []

    names: list[str] = []
    for index, raw_person in enumerate(raw_people):
        if not isinstance(raw_person, dict):
            errors.append(f"people[{index}] must be an object.")
            continue
        name = _string_field(raw_person, "name", max_length=24, required=True, errors=errors)
        if name:
            names.append(name)
    return names


def _validate_events(raw_events, errors: list[str]) -> list[TimelineEvent]:
    normalized: list[TimelineEvent] = []

    if not isinstance(raw_events, list) or not (MIN_EVENTS <= len(raw_events) <= MAX_EVENTS):
        errors.append(f"'events' must be a list of {MIN_EVENTS}-{MAX_EVENTS} items.")
        return normalized

    seen_dates: set[str] = set()
    for index, raw_event in enumerate(raw_events):
        if not isinstance(raw_event, dict):
            errors.append(f"events[{index}] must be an object.")
            continue

        event_errors: list[str] = []
        event_date = _string_field(raw_event, "date", max_length=10, required=True, errors=event_errors)
        if event_date:
            try:
                date_cls.fromisoformat(event_date)
            except ValueError:
                event_errors.append(f"events[{index}].date must be a valid ISO 8601 date.")
            else:
                if event_date in seen_dates:
                    # Mirrors validation.ts's duplicateDate rule exactly.
                    event_errors.append(f"events[{index}].date duplicates an earlier event's date.")
                seen_dates.add(event_date)

        # §4 — raised from 22/55. §19 forbids solving overflow by shrinking
        # type, so a ceiling stays; these are wide enough for a real
        # sentence and narrow enough for six compositions to hold.
        title = _string_field(raw_event, "title", max_length=40, required=True, errors=event_errors)
        description = _string_field(raw_event, "description", max_length=140, required=False, errors=event_errors)
        location, location_lat, location_lng, location_mapbox_id = _location_field(
            raw_event, "location", max_length=40, errors=event_errors
        )

        # §4 — REQUIRED now, where it was optional. Every one of the six
        # compositions is photo-led: a milestone without one leaves a hole
        # in the layout rather than a smaller version of it.
        # §5 — optional media. Validated in the same shape as `photo` so
        # one malformed reference is caught here rather than at render time,
        # when the customer has already paid.
        video_asset_id = _optional_asset_id(raw_event, "video", index, event_errors)
        audio_asset_id = _optional_asset_id(raw_event, "audio", index, event_errors)

        photo_asset_id = None
        photo = raw_event.get("photo")
        if not isinstance(photo, dict) or not isinstance(photo.get("assetId"), str) or not photo.get("assetId"):
            event_errors.append(f"events[{index}].photo is required and must include a non-empty string 'assetId'.")
        else:
            photo_asset_id = photo["assetId"]

        if event_errors:
            errors.extend(event_errors)
        else:
            normalized.append(
                TimelineEvent(
                    date=event_date,
                    title=title,
                    description=description,
                    location=location,
                    location_lat=location_lat,
                    location_lng=location_lng,
                    location_mapbox_id=location_mapbox_id,
                    photo_asset_id=photo_asset_id,
                    video_asset_id=video_asset_id,
                    audio_asset_id=audio_asset_id,
                )
            )

    return normalized


def _choice_field(container: dict, key: str, *, choices: tuple, default: str, errors: list[str]) -> str:
    value = container.get(key, default)
    if value not in choices:
        errors.append(f"'{key}' must be one of {choices}.")
        return default
    return value


def validate_and_normalize(values, theme_selections) -> NormalizedTimeline:
    """Raises `LoveStoryTimelineInvalidData` (with every problem found,
    not just the first) if `values`/`themeSelections` don't match the
    real Love Story Timeline contract. Returns a fully-typed,
    already-validated `NormalizedTimeline` otherwise — callers never
    need to re-check anything.
    """
    errors: list[str] = []

    if not isinstance(values, dict):
        raise LoveStoryTimelineInvalidData("Project 'values' must be an object.")
    if not isinstance(theme_selections, dict):
        raise LoveStoryTimelineInvalidData("Project 'themeSelections' must be an object.")

    story_type = _choice_field(values, "storyType", choices=STORY_TYPES, default="couple", errors=errors)
    people = _validate_people(values.get("people"), errors)
    poster_title = _string_field(values, "posterTitle", max_length=40, required=False, errors=errors)
    subtitle = _string_field(values, "subtitle", max_length=60, required=False, errors=errors)
    dedication = _string_field(values, "dedication", max_length=180, required=False, errors=errors)
    background_music_preset = _choice_field(
        values, "backgroundMusic", choices=MUSIC_PRESETS, default="none", errors=errors
    )
    ending_text = _string_field(values, "endingText", max_length=40, required=False, errors=errors)

    show_duration = bool(values.get("showDuration", False))
    auto_sort = bool(values.get("autoSort", False))

    events = _validate_events(values.get("events"), errors)

    palette = _choice_field(theme_selections, "palette", choices=tuple(PALETTES), default="classic", errors=errors)
    typography = _choice_field(theme_selections, "typography", choices=TYPOGRAPHIES, default="serif-classic", errors=errors)
    # DEFAULT WAS "centered", WHICH IS NOT IN `LAYOUTS`. §7 replaced the
    # five old composition ids with the six current ones and this default
    # was missed, so `_choice_field` fell back to a value its own choices
    # tuple rejects: any project whose `themeSelections` has no `layout`
    # key failed validation with "'layout' must be one of (...)", and the
    # render failed after the customer had already paid. "neat-stack" is
    # the canonical first composition and matches the frontend's
    # `DEFAULT_LAYOUT_ID` in layouts.ts, so both sides now agree on what an
    # unset layout means.
    layout = _choice_field(theme_selections, "layout", choices=LAYOUTS, default="neat-stack", errors=errors)

    scale = theme_selections.get("scale", 100)
    if not isinstance(scale, (int, float)) or isinstance(scale, bool) or not (70 <= scale <= 130):
        errors.append("'scale' must be a number between 70 and 130.")
        scale = 100

    if errors:
        raise LoveStoryTimelineInvalidData(
            "Invalid Love Story Timeline project data.", details={"errors": errors}
        )

    return NormalizedTimeline(
        story_type=story_type,
        people=people,
        poster_title=poster_title,
        subtitle=subtitle,
        dedication=dedication,
        background_music_preset=background_music_preset,
        ending_text=ending_text,
        show_duration=show_duration,
        auto_sort=auto_sort,
        events=events,
        palette=palette,
        typography=typography,
        layout=layout,
        scale=int(scale),
    )


def join_names(names: list[str], locale: str = "en") -> str:
    """Joins the story's names for display (§3).

    "&" and nothing else, at every count. This function used to vary the
    joiner by locale — a translated "and"/"et"/"و" for three or more names,
    and (in an even earlier version) a locale-aware pair form specifically
    to avoid a Latin ampersand sitting inside right-to-left Arabic text.
    Both were my own earlier reasoning, not something confirmed against
    this exact rule, which reads as explicit and unqualified: "the
    separator is ALWAYS &... never and/et/or any translated equivalent."

    WORTH KNOWING: this REVERSES the RTL fix specifically. An Arabic
    keepsake will now show a Latin "&" in the middle of right-to-left
    text again — which is the exact thing that earlier change existed to
    prevent. Implemented as stated rather than silently kept as an
    exception, because the rule does not carve one out; flagged here in
    case that tradeoff is worth revisiting.

    `locale` stays a parameter for call-site compatibility even though
    nothing here reads it anymore — every caller already passes it for
    date formatting elsewhere in the same renderer, and removing the
    parameter would mean threading a conditional signature through several
    call sites for no benefit.
    """
    names = [n for n in names if n]
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    return " & ".join(names)


#: Duration phrasing, per story type and locale (§16, §22).
#:
#: Mirrors `durationKey()` in `story-types.ts`. A story type absent from
#: this map has NO duration line, which is the point: "days together" on a
#: family history reads as a mistake, and §16 says the wording has to suit
#: the story rather than assume a couple.
_DURATION_PHRASES = {
    "couple": {
        "en": "{days} days together",
        "fr": "{days} jours ensemble",
        "ar": "{days} يومًا معًا",
    },
    "parents": {
        "en": "{days} days side by side",
        "fr": "{days} jours côte à côte",
        "ar": "{days} يومًا جنبًا إلى جنب",
    },
}


def duration_phrase(story_type: str, days: int, locale: str = "en") -> str | None:
    """The duration line for a poster, or None where the type has none.

    This previously hardcoded "days together" in English for every story
    type and every language — so a family history claimed a couple's
    phrasing, and an Arabic poster carried an English sentence.

    None is a real answer, not a failure: family and gift stories have no
    duration line at all.
    """
    phrases = _DURATION_PHRASES.get(story_type)
    if not phrases:
        return None
    # The count in the order's language too ("1 799" in French), as the
    # preview writes it.
    from apps.delivery.date_formatting import format_count

    return phrases.get(locale, phrases["en"]).format(days=format_count(days, locale))
