"""
Graduation Keepsake data contract — validation and normalization.

The one place in the codebase that interprets this product's `values`.
`Project.data` stays opaque everywhere else, the same rule Love Story
Timeline's and Song Poster's `data.py` state and follow.

THE SHAPE MIRRORS THE STUDIO MODULE (`lib/studio/product-modules/
graduation-keepsake/`): flat top-level keys, repeatable groups as arrays of
objects, a media value as `{ assetId, ... }`. `validate_and_normalize`
returns the same shape, cleaned: unknown keys dropped, strings stripped and
length-capped, media reduced to its `assetId`, and — the part that matters —
every chapter the creator switched OFF is removed entirely. A chapter that is
off is not validated, not served, and (see `media_asset_ids`) not promoted.

ONE STORY, FIVE JOURNEYS. Nothing here depends on the journey except the
airline-only boarding-pass fields; the journey is `themeSelections.journey`
and only decides which live experience tells the story. Adding a journey
means adding its id to `JOURNEYS` below (and its registry entry on the
frontend) and nothing else in this file.

TWO VALUES ARE ALLOWLISTS, NOT FREE TEXT: a person's colour and emoji. The
frontend stores an id (`"coral"`, `"home"`), never a hex code or an emoji
string, because a person's colour ends up in a `style` attribute on the live
page — a free-text colour there is a CSS injection surface. The id tables
below MUST match `palette.ts` in the Studio module; a frontend test reads
this file to pin it (the same arrangement `composition-parity.test.ts` has
with the Pillow renderers).
"""

from __future__ import annotations

import re
import unicodedata
import uuid
from dataclasses import dataclass
from datetime import date

from apps.common.exceptions.api_errors import GraduationKeepsakeInvalidData

# ---------------------------------------------------------------------------
# Closed vocabularies. KEEP IN SYNC WITH THE STUDIO MODULE (palette.ts,
# journeys.ts, schema.ts) — pinned by a frontend test.
# ---------------------------------------------------------------------------

#: Journeys the live page can tell the story through. Only implemented
#: journeys belong here; the Studio's journey axis lists the same set.
JOURNEYS = ("airline",)
DEFAULT_JOURNEY = "airline"

LANGUAGES = ("en", "fr", "ar")
DEFAULT_LANGUAGE = "en"

#: Chapters that can be switched on/off, in their fixed display order, and the
#: values key that holds each one's switch.
CHAPTERS = (
    ("path", "showPath"),
    ("achievements", "showAchievements"),
    ("messages", "showMessages"),
    ("goals", "showGoals"),
    ("letter", "showLetter"),
)

PERSON_COLORS = ("coral", "blue", "amber", "green", "pink", "violet", "navy", "red")
DEFAULT_PERSON_COLOR = "coral"

PERSON_EMOJIS = (
    "home", "coffee", "tree", "pencil", "party", "school", "heart", "star", "book", "music",
    "camera", "cake", "dog", "cat", "sun", "rocket", "palette", "plane", "cap", "hug",
)
DEFAULT_PERSON_EMOJI = "heart"

# ---------------------------------------------------------------------------
# Limits (docs/graduation/graduation-customer-inputs.md)
# ---------------------------------------------------------------------------

MIN_STOPS, MAX_STOPS = 1, 12
MIN_ACHIEVEMENTS, MAX_ACHIEVEMENTS = 1, 10
MIN_MESSAGE_GROUPS, MAX_MESSAGE_GROUPS = 1, 3
MIN_PEOPLE, MAX_PEOPLE = 1, 12
MIN_GOALS, MAX_GOALS = 1, 10
MIN_LETTER_PARAGRAPHS, MAX_LETTER_PARAGRAPHS = 1, 6
MIN_SIGNATURES, MAX_SIGNATURES = 1, 12

NAME_MAX = 24
FULL_NAME_MAX = 40
DEGREE_MAX = 60
SCHOOL_MAX = 60
YEAR_TEXT_MAX = 12
STORY_TEXT_MAX = 140
CAPTION_MAX = 40
ACHIEVEMENT_TITLE_MAX = 26
ACHIEVEMENT_DETAIL_MAX = 60
ACHIEVEMENT_PLACE_MAX = 24
GROUP_LABEL_MAX = 24
MESSAGE_MAX = 300
GOAL_MAX = 80
GREETING_MAX = 60
PARAGRAPH_MAX = 500
SIGNOFF_MAX = 40
SIGNATURE_MAX = 24
ENDING_LINE_MAX = 60
ENDING_SUB_MAX = 80
FLIGHT_FIELD_MAX = 30
FLIGHT_NUMBER_MAX = 10
FLIGHT_SEAT_MAX = 4
FLIGHT_PLACE_MAX = 24

_CODE_RE = re.compile(r"^[A-Z]{3}$")
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f‎‏‪-‮⁦-⁩]")


@dataclass(frozen=True)
class NormalizedGraduation:
    """`values` is the cleaned, Studio-shaped copy of the project's values."""

    values: dict
    journey: str
    language: str
    year: int


class _Errors:
    def __init__(self) -> None:
        self.items: list[str] = []

    def add(self, message: str) -> None:
        if len(self.items) < 20:  # a flood of messages helps nobody
            self.items.append(message)

    def __bool__(self) -> bool:
        return bool(self.items)


def _clean(raw, *, multiline: bool = False) -> str:
    """Strips control and bidi-override characters and normalizes to NFC."""
    if not isinstance(raw, str):
        return ""
    text = unicodedata.normalize("NFC", raw)
    if multiline:
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        text = "\n".join(_CONTROL_RE.sub("", line) for line in text.split("\n"))
    else:
        text = _CONTROL_RE.sub("", text.replace("\n", " "))
    return text.strip()


def _text(
    source: dict, key: str, label: str, *, max_length: int, required: bool, errors: _Errors,
    multiline: bool = False,
) -> str:
    text = _clean(source.get(key), multiline=multiline)
    if required and not text:
        errors.add(f"'{label}' is required.")
    if len(text) > max_length:
        errors.add(f"'{label}' must be at most {max_length} characters.")
        text = text[:max_length]
    return text


def _media_asset_id(value) -> str:
    """The `assetId` of a media value, or "" when there is none.

    Only the id is trusted — `url`/`mimeType`/`filename` are display-only
    leftovers from the upload (the stored URL is a presigned, expiring one,
    or a `blob:` that was never valid for anyone else).
    """
    if not isinstance(value, dict):
        return ""
    asset_id = value.get("assetId")
    if not isinstance(asset_id, str) or not asset_id:
        return ""
    try:
        return str(uuid.UUID(asset_id))
    except ValueError:
        return ""


def _required_media(source: dict, key: str, label: str, errors: _Errors) -> dict:
    asset_id = _media_asset_id(source.get(key))
    if not asset_id:
        errors.add(f"'{label}' is required and must include an uploaded file.")
        return {}
    return {"assetId": asset_id}


def _optional_media(source: dict, key: str, label: str, errors: _Errors) -> dict | None:
    raw = source.get(key)
    if raw in (None, "", {}):
        return None
    asset_id = _media_asset_id(raw)
    if not asset_id:
        errors.add(f"'{label}' must include an uploaded file.")
        return None
    return {"assetId": asset_id}


def _items(source: dict, key: str, label: str, *, minimum: int, maximum: int, errors: _Errors) -> list[dict]:
    raw = source.get(key)
    items = [item for item in raw if isinstance(item, dict)] if isinstance(raw, list) else []
    if len(items) < minimum:
        errors.add(f"'{label}' needs at least {minimum} item{'s' if minimum != 1 else ''}.")
    if len(items) > maximum:
        errors.add(f"'{label}' allows at most {maximum} items.")
        items = items[:maximum]
    return items


def _code(source: dict, key: str, label: str, errors: _Errors) -> str:
    code = _clean(source.get(key)).upper()
    if code and not _CODE_RE.match(code):
        errors.add(f"'{label}' must be exactly three letters.")
        return ""
    return code


def _choice(source: dict, key: str, label: str, choices: tuple, default: str, errors: _Errors) -> str:
    raw = source.get(key)
    if raw in (None, ""):
        return default
    if raw not in choices:
        errors.add(f"'{label}' is not one of the available options.")
        return default
    return raw


def _flag(source: dict, key: str, *, default: bool) -> bool:
    raw = source.get(key)
    return raw if isinstance(raw, bool) else default


def _parse_date(raw, errors: _Errors) -> tuple[str, int]:
    if not isinstance(raw, str) or not raw.strip():
        errors.add("'gradDate' is required.")
        return "", 0
    try:
        parsed = date.fromisoformat(raw.strip()[:10])
    except ValueError:
        errors.add("'gradDate' is not a valid date.")
        return "", 0
    if not 1950 <= parsed.year <= 2100:
        errors.add("'gradDate' is out of range.")
        return "", 0
    return parsed.isoformat(), parsed.year


def validate_and_normalize(values: dict, theme_selections: dict | None = None) -> NormalizedGraduation:
    if not isinstance(values, dict):
        raise GraduationKeepsakeInvalidData("Project data is not a valid Graduation Keepsake payload.")

    theme_selections = theme_selections if isinstance(theme_selections, dict) else {}
    errors = _Errors()

    journey = _choice(theme_selections, "journey", "journey", JOURNEYS, DEFAULT_JOURNEY, errors)
    language = _choice(values, "language", "language", LANGUAGES, DEFAULT_LANGUAGE, errors)
    on = {chapter: _flag(values, flag, default=True) for chapter, flag in CHAPTERS}

    out: dict = {"language": language}
    for chapter, flag in CHAPTERS:
        out[flag] = on[chapter]

    # --- The graduate (always on) --------------------------------------
    out["gradName"] = _text(values, "gradName", "gradName", max_length=NAME_MAX, required=True, errors=errors)
    out["gradFullName"] = _text(
        values, "gradFullName", "gradFullName", max_length=FULL_NAME_MAX, required=True, errors=errors
    )
    out["gradDegree"] = _text(values, "gradDegree", "gradDegree", max_length=DEGREE_MAX, required=True, errors=errors)
    out["gradSchool"] = _text(values, "gradSchool", "gradSchool", max_length=SCHOOL_MAX, required=True, errors=errors)
    out["gradDate"], year = _parse_date(values.get("gradDate"), errors)
    out["gradPhoto"] = _required_media(values, "gradPhoto", "gradPhoto", errors)

    # --- Path through the years ----------------------------------------
    if on["path"]:
        out["thenYear"] = _text(values, "thenYear", "thenYear", max_length=YEAR_TEXT_MAX, required=True, errors=errors)
        out["thenText"] = _text(values, "thenText", "thenText", max_length=STORY_TEXT_MAX, required=True, errors=errors)
        out["thenPhoto"] = _required_media(values, "thenPhoto", "thenPhoto", errors)
        stops = []
        for i, raw in enumerate(
            _items(values, "stops", "stops", minimum=MIN_STOPS, maximum=MAX_STOPS, errors=errors)
        ):
            where = f"stops[{i}]"
            stops.append(
                {
                    "year": _text(raw, "year", f"{where}.year", max_length=YEAR_TEXT_MAX, required=True, errors=errors),
                    "caption": _text(
                        raw, "caption", f"{where}.caption", max_length=CAPTION_MAX, required=True, errors=errors
                    ),
                    "photo": _required_media(raw, "photo", f"{where}.photo", errors),
                    "code": _code(raw, "code", f"{where}.code", errors),
                }
            )
        out["stops"] = stops
        out["nowYear"] = _text(values, "nowYear", "nowYear", max_length=YEAR_TEXT_MAX, required=True, errors=errors)
        out["nowText"] = _text(values, "nowText", "nowText", max_length=STORY_TEXT_MAX, required=True, errors=errors)
        out["nextText"] = _text(values, "nextText", "nextText", max_length=STORY_TEXT_MAX, required=True, errors=errors)
        out["nextPhoto"] = _required_media(values, "nextPhoto", "nextPhoto", errors)

    # --- Achievements ---------------------------------------------------
    if on["achievements"]:
        achievements = []
        for i, raw in enumerate(
            _items(
                values, "achievements", "achievements",
                minimum=MIN_ACHIEVEMENTS, maximum=MAX_ACHIEVEMENTS, errors=errors,
            )
        ):
            where = f"achievements[{i}]"
            achievements.append(
                {
                    "title": _text(
                        raw, "title", f"{where}.title", max_length=ACHIEVEMENT_TITLE_MAX, required=True, errors=errors
                    ),
                    "detail": _text(
                        raw, "detail", f"{where}.detail", max_length=ACHIEVEMENT_DETAIL_MAX, required=False, errors=errors
                    ),
                    "place": _text(
                        raw, "place", f"{where}.place", max_length=ACHIEVEMENT_PLACE_MAX, required=False, errors=errors
                    ),
                }
            )
        out["achievements"] = achievements

    # --- Messages -------------------------------------------------------
    if on["messages"]:
        groups = []
        for gi, raw_group in enumerate(
            _items(
                values, "messageGroups", "messageGroups",
                minimum=MIN_MESSAGE_GROUPS, maximum=MAX_MESSAGE_GROUPS, errors=errors,
            )
        ):
            gwhere = f"messageGroups[{gi}]"
            people = []
            for pi, raw in enumerate(
                _items(raw_group, "people", f"{gwhere}.people", minimum=MIN_PEOPLE, maximum=MAX_PEOPLE, errors=errors)
            ):
                where = f"{gwhere}.people[{pi}]"
                people.append(
                    {
                        "name": _text(raw, "name", f"{where}.name", max_length=NAME_MAX, required=True, errors=errors),
                        "color": _choice(raw, "color", f"{where}.color", PERSON_COLORS, DEFAULT_PERSON_COLOR, errors),
                        "emoji": _choice(raw, "emoji", f"{where}.emoji", PERSON_EMOJIS, DEFAULT_PERSON_EMOJI, errors),
                        "message": _text(
                            raw, "message", f"{where}.message", max_length=MESSAGE_MAX, required=True, errors=errors,
                            multiline=True,
                        ),
                        "voice": _optional_media(raw, "voice", f"{where}.voice", errors),
                        "drawing": _optional_media(raw, "drawing", f"{where}.drawing", errors),
                    }
                )
            groups.append(
                {
                    "label": _text(
                        raw_group, "label", f"{gwhere}.label", max_length=GROUP_LABEL_MAX, required=True, errors=errors
                    ),
                    "people": people,
                }
            )
        out["messageGroups"] = groups

    # --- Future goals ---------------------------------------------------
    if on["goals"]:
        goals = []
        for i, raw in enumerate(
            _items(values, "goals", "goals", minimum=MIN_GOALS, maximum=MAX_GOALS, errors=errors)
        ):
            where = f"goals[{i}]"
            goals.append(
                {
                    "text": _text(raw, "text", f"{where}.text", max_length=GOAL_MAX, required=True, errors=errors),
                    "code": _code(raw, "code", f"{where}.code", errors),
                }
            )
        out["goals"] = goals

    # --- Personal letter ------------------------------------------------
    if on["letter"]:
        out["letterGreeting"] = _text(
            values, "letterGreeting", "letterGreeting", max_length=GREETING_MAX, required=True, errors=errors
        )
        out["letterBody"] = [
            {
                "text": _text(
                    raw, "text", f"letterBody[{i}].text", max_length=PARAGRAPH_MAX, required=True, errors=errors,
                    multiline=True,
                )
            }
            for i, raw in enumerate(
                _items(
                    values, "letterBody", "letterBody",
                    minimum=MIN_LETTER_PARAGRAPHS, maximum=MAX_LETTER_PARAGRAPHS, errors=errors,
                )
            )
        ]
        out["letterSignoff"] = _text(
            values, "letterSignoff", "letterSignoff", max_length=SIGNOFF_MAX, required=False, errors=errors
        )
        out["letterSignatures"] = [
            {
                "name": _text(
                    raw, "name", f"letterSignatures[{i}].name", max_length=SIGNATURE_MAX, required=True, errors=errors
                )
            }
            for i, raw in enumerate(
                _items(
                    values, "letterSignatures", "letterSignatures",
                    minimum=MIN_SIGNATURES, maximum=MAX_SIGNATURES, errors=errors,
                )
            )
        ]

    # --- Ending, sharing (always on) -----------------------------------
    out["endingLine"] = _text(
        values, "endingLine", "endingLine", max_length=ENDING_LINE_MAX, required=True, errors=errors
    )
    out["endingSub"] = _text(values, "endingSub", "endingSub", max_length=ENDING_SUB_MAX, required=False, errors=errors)
    out["soundEnabled"] = _flag(values, "soundEnabled", default=True)
    out["shareEnabled"] = _flag(values, "shareEnabled", default=True)
    out["brandingShow"] = _flag(values, "brandingShow", default=True)

    # --- Airline journey only: the boarding pass -----------------------
    if journey == "airline":
        out["flightAirline"] = _text(
            values, "flightAirline", "flightAirline", max_length=FLIGHT_FIELD_MAX, required=False, errors=errors
        )
        out["flightNumber"] = _text(
            values, "flightNumber", "flightNumber", max_length=FLIGHT_NUMBER_MAX, required=False, errors=errors
        )
        out["flightSeat"] = _text(
            values, "flightSeat", "flightSeat", max_length=FLIGHT_SEAT_MAX, required=False, errors=errors
        )
        out["flightCabin"] = _text(
            values, "flightCabin", "flightCabin", max_length=FLIGHT_FIELD_MAX, required=False, errors=errors
        )
        out["flightFromCode"] = _code(values, "flightFromCode", "flightFromCode", errors)
        out["flightFromPlace"] = _text(
            values, "flightFromPlace", "flightFromPlace", max_length=FLIGHT_PLACE_MAX, required=False, errors=errors
        )
        out["flightToCode"] = _code(values, "flightToCode", "flightToCode", errors)
        out["flightToPlace"] = _text(
            values, "flightToPlace", "flightToPlace", max_length=FLIGHT_PLACE_MAX, required=False, errors=errors
        )

    if errors:
        raise GraduationKeepsakeInvalidData("; ".join(errors.items))

    return NormalizedGraduation(values=out, journey=journey, language=language, year=year)


def media_asset_ids(values: dict) -> list[str]:
    """Every asset id a project references, WITHOUT validating the project.

    Used by media promotion (`apps/commerce/media_promotion.py`), which must
    tolerate a project that does not validate cleanly — promotion is a
    best-effort backend/cost concern and must never become a second, stricter
    validator that can fail a payment. It therefore reads the same keys this
    module reads, defensively, and honours the chapter switches: a chapter
    that is off is never served, so its media is neither promoted nor kept.
    """
    if not isinstance(values, dict):
        return []

    def on(flag: str) -> bool:
        return _flag(values, flag, default=True)

    ids: list[str] = []

    def add(value) -> None:
        asset_id = _media_asset_id(value)
        if asset_id:
            ids.append(asset_id)

    add(values.get("gradPhoto"))
    if on("showPath"):
        add(values.get("thenPhoto"))
        add(values.get("nextPhoto"))
        for stop in values.get("stops") or []:
            if isinstance(stop, dict):
                add(stop.get("photo"))
    if on("showMessages"):
        for group in values.get("messageGroups") or []:
            if not isinstance(group, dict):
                continue
            for person in group.get("people") or []:
                if isinstance(person, dict):
                    add(person.get("voice"))
                    add(person.get("drawing"))
    return ids


def audio_asset_ids(values: dict) -> list[str]:
    """Only the voice-message ids — the provisional (expiring) media.

    Photos and drawings are permanent from upload; voice messages are audio
    and carry an `expires_at` until a paid order promotes them.
    """
    if not isinstance(values, dict) or not _flag(values, "showMessages", default=True):
        return []
    ids: list[str] = []
    for group in values.get("messageGroups") or []:
        if not isinstance(group, dict):
            continue
        for person in group.get("people") or []:
            if isinstance(person, dict):
                asset_id = _media_asset_id(person.get("voice"))
                if asset_id:
                    ids.append(asset_id)
    return ids
