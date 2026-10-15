"""
Graduation Keepsake data contract — validation and normalization.

The one place in the backend that interprets this product's `values`;
`Project.data` stays opaque everywhere else, the same rule every product's
`data.py` follows.

Read from the real frontend module, not guessed:
  - `schema.ts`         — the fields, which are required, their caps, and
                           which chapter switch hides which fields
  - `initial-state.ts`  — the exact `GraduationValues` shape (flat by field
                           id; groups are lists of objects, and a message
                           group's `people` is a list inside each group)
  - `validation.ts`     — the rules the shared form engine cannot express
                           (years, codes, one emoji, the per-keepsake voice
                           and drawing caps)
  - `limits.ts`         — the caps below; `graduation-module.test.ts` reads
                           THIS file and fails if the two sides disagree
  - `journeys.ts`       — the five journey ids and the colour palette, also
                           pinned by that test

A chapter that is switched off is not validated and not returned: its fields
are hidden in the Studio, so they cannot be what stops a customer paying, and
the live page never shows them. The same for the AIRLINE-ONLY fields (the
three-letter codes, an achievement's place, the boarding pass): on another
journey they are hidden, so they are neither checked nor kept. A media value's `assetId` is the only part of
it this module trusts (`url`/`mimeType`/`filename` are display-only leftovers
from the upload, never used to fetch anything).

A LIVE-ONLY PRODUCT: nothing here is drawn by Pillow. This validation runs
before payment (`GraduationKeepsakeRenderer.validate_project_data`), whenever
the live page is served (`live_payload.build_graduation_live_payload`) and to
find the voice messages a paid order keeps (`audio_asset_ids`).
"""

from __future__ import annotations

import datetime
import re
from dataclasses import dataclass

from apps.common.exceptions.api_errors import GraduationKeepsakeInvalidData

#: The same numbers as the frontend's `GRADUATION_LIMITS` (`limits.ts`).
NAME_MAX_LENGTH = 24
FULL_NAME_MAX_LENGTH = 40
DEGREE_MAX_LENGTH = 60
SCHOOL_MAX_LENGTH = 60
PATH_YEAR_MAX_LENGTH = 12
PATH_TEXT_MAX_LENGTH = 140
STOP_CAPTION_MAX_LENGTH = 40
MIN_STOPS = 1
MAX_STOPS = 12
MIN_ACHIEVEMENTS = 1
MAX_ACHIEVEMENTS = 10
ACHIEVEMENT_TITLE_MAX_LENGTH = 26
ACHIEVEMENT_DETAIL_MAX_LENGTH = 40
ACHIEVEMENT_PLACE_MAX_LENGTH = 16
MIN_GROUPS = 1
MAX_GROUPS = 3
GROUP_LABEL_MAX_LENGTH = 24
MIN_PEOPLE = 1
MAX_PEOPLE = 12
PERSON_NAME_MAX_LENGTH = 24
MESSAGE_MAX_LENGTH = 300
VOICE_CAPTION_MAX_LENGTH = 300
#: Per KEEPSAKE, across every group and person, not per person: together with
#: at most 15 photos (main, then, next and 12 stops) a keepsake uploads at most
#: 25 files at checkout, under production's 30-a-minute upload limit.
MAX_VOICES = 5
MAX_DRAWINGS = 5
#: One emoji in the Studio (counted by grapheme with `Intl.Segmenter`). Python
#: has no grapheme segmentation without a third-party module, so the gate here
#: is looser: at most this many code points and no whitespace, which every
#: single emoji passes (the longest, a tagged flag, is 7).
EMOJI_MAX_CODE_POINTS = 16
MIN_GOALS = 1
MAX_GOALS = 10
GOAL_MAX_LENGTH = 60
GREETING_MAX_LENGTH = 40
MIN_PARAGRAPHS = 1
MAX_PARAGRAPHS = 6
PARAGRAPH_MAX_LENGTH = 500
SIGNOFF_MAX_LENGTH = 40
MIN_SIGNATURES = 1
MAX_SIGNATURES = 12
SIGNATURE_MAX_LENGTH = 24
ENDING_LINE_MAX_LENGTH = 40
ENDING_SUB_MAX_LENGTH = 80
FLIGHT_AIRLINE_MAX_LENGTH = 24
FLIGHT_NUMBER_MAX_LENGTH = 8
FLIGHT_SEAT_MAX_LENGTH = 4
FLIGHT_CABIN_MAX_LENGTH = 24
FLIGHT_CITY_MAX_LENGTH = 16

#: Mirrors `JOURNEY_IDS` in the frontend's `journeys.ts`. An unknown or missing
#: journey falls back to the default rather than failing, like Reasons' gift;
#: the default is a member of its own choices.
JOURNEYS = ("airline", "space", "arcade", "museum", "summit")
DEFAULT_JOURNEY = "airline"

#: Mirrors `COLOUR_IDS` in `journeys.ts`. Stored as an id, never a hex value,
#: so a person's colour is always one the journeys were designed with. Empty
#: means "by position" (the frontend picks).
COLOURS = ("coral", "sky", "amber", "mint", "berry", "violet", "forest", "gold")

_YEAR = re.compile(r"^\d{4}$")
_CODE = re.compile(r"^[A-Za-z]{3}$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@dataclass(frozen=True)
class Graduate:
    name: str
    full_name: str
    year: str
    degree: str
    school: str
    date: str
    photo_asset_id: str


@dataclass(frozen=True)
class Stop:
    year: str
    caption: str
    code: str
    photo_asset_id: str


@dataclass(frozen=True)
class Path:
    then_year: str
    then_text: str
    then_photo_asset_id: str
    stops: tuple[Stop, ...]
    now_year: str
    now_text: str
    next_text: str
    next_photo_asset_id: str


@dataclass(frozen=True)
class Achievement:
    title: str
    detail: str
    place: str


@dataclass(frozen=True)
class Person:
    name: str
    colour: str
    emoji: str
    message: str
    voice_asset_id: str | None
    voice_caption: str
    drawing_asset_id: str | None


@dataclass(frozen=True)
class MessageGroup:
    label: str
    people: tuple[Person, ...]


@dataclass(frozen=True)
class Goal:
    text: str
    code: str


@dataclass(frozen=True)
class Letter:
    greeting: str
    paragraphs: tuple[str, ...]
    signoff: str
    signatures: tuple[str, ...]


@dataclass(frozen=True)
class Flight:
    airline: str
    number: str
    seat: str
    cabin: str
    from_code: str
    from_city: str
    to_code: str
    to_city: str


@dataclass(frozen=True)
class NormalizedGraduation:
    journey: str
    graduate: Graduate
    #: `None` for a chapter switched off.
    path: Path | None
    achievements: tuple[Achievement, ...] | None
    messages: tuple[MessageGroup, ...] | None
    goals: tuple[Goal, ...] | None
    letter: Letter | None
    ending_line: str
    ending_sub: str
    #: Only read by the airline journey; empty fields fall back to that
    #: journey's own translated defaults on the frontend.
    flight: Flight
    sound: bool
    show_share: bool


def _string_field(container: dict, key: str, *, max_length: int, required: bool, errors: list[str], where: str = "") -> str:
    raw = container.get(key)
    text = raw.strip() if isinstance(raw, str) else ""
    label = f"{where}{key}"
    if required and not text:
        errors.append(f"'{label}' is required.")
    if len(text) > max_length:
        errors.append(f"'{label}' must be at most {max_length} characters.")
    return text


def _bool_field(container: dict, key: str, *, default: bool) -> bool:
    raw = container.get(key)
    return raw if isinstance(raw, bool) else default


def _code_field(container: dict, key: str, *, required: bool, errors: list[str], where: str = "") -> str:
    """Three Latin letters, stored upper-case (airport-code style)."""
    raw = container.get(key)
    text = raw.strip() if isinstance(raw, str) else ""
    if not text:
        if required:
            errors.append(f"'{where}{key}' is required.")
        return ""
    if not _CODE.match(text):
        errors.append(f"'{where}{key}' must be three letters A to Z.")
    return text.upper()


def _asset_id(container: dict, key: str, *, required: bool, errors: list[str], where: str = "") -> str | None:
    """A media value is trusted only for its `assetId`. A value present without
    one is a file the customer picked that never uploaded, which is exactly
    what this pre-payment check exists to catch."""
    value = container.get(key)
    if value is None or value == "":
        if required:
            errors.append(f"'{where}{key}' is required.")
        return None
    if isinstance(value, dict) and isinstance(value.get("assetId"), str) and value["assetId"]:
        return value["assetId"]
    errors.append(f"'{where}{key}', if present, must include a non-empty string 'assetId'.")
    return None


def _list_field(values: dict, key: str, *, minimum: int, maximum: int, errors: list[str], where: str = "") -> list:
    raw = values.get(key)
    if not isinstance(raw, list):
        errors.append(f"'{where}{key}' must be a list.")
        return []
    if not minimum <= len(raw) <= maximum:
        errors.append(f"'{where}{key}' must have between {minimum} and {maximum} entries.")
    return raw[:maximum]


def _items(raw: list, key: str, errors: list[str], where: str = ""):
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            errors.append(f"{where}{key}[{index}] must be an object.")
            continue
        yield index, item, f"{where}{key}[{index}]."


def _validate_graduate(values: dict, errors: list[str]) -> Graduate:
    year = values.get("gradYear")
    year = year.strip() if isinstance(year, str) else (str(year) if isinstance(year, int) and not isinstance(year, bool) else "")
    if not _YEAR.match(year):
        errors.append("'gradYear' must be a four-digit year.")
    date = values.get("gradDate")
    date = date.strip() if isinstance(date, str) else ""
    try:
        # The pattern first: `fromisoformat` alone also accepts "20270702".
        if not _DATE.match(date):
            raise ValueError
        datetime.date.fromisoformat(date)
    except ValueError:
        errors.append("'gradDate' must be a date (YYYY-MM-DD).")
    return Graduate(
        name=_string_field(values, "gradName", max_length=NAME_MAX_LENGTH, required=True, errors=errors),
        full_name=_string_field(values, "gradFullName", max_length=FULL_NAME_MAX_LENGTH, required=True, errors=errors),
        year=year,
        degree=_string_field(values, "gradDegree", max_length=DEGREE_MAX_LENGTH, required=True, errors=errors),
        school=_string_field(values, "gradSchool", max_length=SCHOOL_MAX_LENGTH, required=True, errors=errors),
        date=date,
        photo_asset_id=_asset_id(values, "gradPhoto", required=True, errors=errors) or "",
    )


def _validate_path(values: dict, errors: list[str], airline: bool) -> Path:
    stops = []
    for index, item, where in _items(
        _list_field(values, "stops", minimum=MIN_STOPS, maximum=MAX_STOPS, errors=errors), "stops", errors
    ):
        stops.append(
            Stop(
                year=_string_field(item, "year", max_length=PATH_YEAR_MAX_LENGTH, required=True, errors=errors, where=where),
                caption=_string_field(item, "caption", max_length=STOP_CAPTION_MAX_LENGTH, required=True, errors=errors, where=where),
                code=_code_field(item, "code", required=False, errors=errors, where=where) if airline else "",
                photo_asset_id=_asset_id(item, "photo", required=True, errors=errors, where=where) or "",
            )
        )
    return Path(
        then_year=_string_field(values, "thenYear", max_length=PATH_YEAR_MAX_LENGTH, required=True, errors=errors),
        then_text=_string_field(values, "thenText", max_length=PATH_TEXT_MAX_LENGTH, required=True, errors=errors),
        then_photo_asset_id=_asset_id(values, "thenPhoto", required=True, errors=errors) or "",
        stops=tuple(stops),
        now_year=_string_field(values, "nowYear", max_length=PATH_YEAR_MAX_LENGTH, required=True, errors=errors),
        now_text=_string_field(values, "nowText", max_length=PATH_TEXT_MAX_LENGTH, required=True, errors=errors),
        next_text=_string_field(values, "nextText", max_length=PATH_TEXT_MAX_LENGTH, required=True, errors=errors),
        next_photo_asset_id=_asset_id(values, "nextPhoto", required=True, errors=errors) or "",
    )


def _validate_achievements(values: dict, errors: list[str], airline: bool) -> tuple[Achievement, ...]:
    return tuple(
        Achievement(
            title=_string_field(item, "title", max_length=ACHIEVEMENT_TITLE_MAX_LENGTH, required=True, errors=errors, where=where),
            detail=_string_field(item, "detail", max_length=ACHIEVEMENT_DETAIL_MAX_LENGTH, required=False, errors=errors, where=where),
            place=(
                _string_field(item, "place", max_length=ACHIEVEMENT_PLACE_MAX_LENGTH, required=False, errors=errors, where=where)
                if airline
                else ""
            ),
        )
        for index, item, where in _items(
            _list_field(values, "achievements", minimum=MIN_ACHIEVEMENTS, maximum=MAX_ACHIEVEMENTS, errors=errors),
            "achievements",
            errors,
        )
    )


def _emoji_field(container: dict, errors: list[str], where: str) -> str:
    raw = container.get("emoji")
    text = raw.strip() if isinstance(raw, str) else ""
    if len(text) > EMOJI_MAX_CODE_POINTS or any(ch.isspace() for ch in text):
        errors.append(f"'{where}emoji' must be a single emoji.")
    return text


def _validate_messages(values: dict, errors: list[str]) -> tuple[MessageGroup, ...]:
    groups = []
    for _, group, where in _items(
        _list_field(values, "messageGroups", minimum=MIN_GROUPS, maximum=MAX_GROUPS, errors=errors), "messageGroups", errors
    ):
        people = []
        for _, person, person_where in _items(
            _list_field(group, "people", minimum=MIN_PEOPLE, maximum=MAX_PEOPLE, errors=errors, where=where),
            "people",
            errors,
            where,
        ):
            colour = person.get("color")
            colour = colour if isinstance(colour, str) else ""
            if colour and colour not in COLOURS:
                errors.append(f"'{person_where}color' must be one of {', '.join(COLOURS)}.")
                colour = ""
            voice = _asset_id(person, "voice", required=False, errors=errors, where=person_where)
            people.append(
                Person(
                    name=_string_field(person, "name", max_length=PERSON_NAME_MAX_LENGTH, required=True, errors=errors, where=person_where),
                    colour=colour,
                    emoji=_emoji_field(person, errors, person_where),
                    message=_string_field(person, "message", max_length=MESSAGE_MAX_LENGTH, required=True, errors=errors, where=person_where),
                    voice_asset_id=voice,
                    # A caption belongs to its recording; without one it is
                    # never shown, so it is not kept either.
                    voice_caption=(
                        _string_field(person, "voiceCaption", max_length=VOICE_CAPTION_MAX_LENGTH, required=False, errors=errors, where=person_where)
                        if voice
                        else ""
                    ),
                    drawing_asset_id=_asset_id(person, "drawing", required=False, errors=errors, where=person_where),
                )
            )
        groups.append(
            MessageGroup(
                label=_string_field(group, "label", max_length=GROUP_LABEL_MAX_LENGTH, required=True, errors=errors, where=where),
                people=tuple(people),
            )
        )
    voices = sum(1 for group in groups for person in group.people if person.voice_asset_id)
    drawings = sum(1 for group in groups for person in group.people if person.drawing_asset_id)
    if voices > MAX_VOICES:
        errors.append(f"A keepsake can hold at most {MAX_VOICES} voice messages ({voices} given).")
    if drawings > MAX_DRAWINGS:
        errors.append(f"A keepsake can hold at most {MAX_DRAWINGS} drawings ({drawings} given).")
    return tuple(groups)


def _validate_goals(values: dict, errors: list[str], airline: bool) -> tuple[Goal, ...]:
    return tuple(
        Goal(
            text=_string_field(item, "text", max_length=GOAL_MAX_LENGTH, required=True, errors=errors, where=where),
            code=_code_field(item, "code", required=False, errors=errors, where=where) if airline else "",
        )
        for _, item, where in _items(
            _list_field(values, "goals", minimum=MIN_GOALS, maximum=MAX_GOALS, errors=errors), "goals", errors
        )
    )


def _validate_letter(values: dict, errors: list[str]) -> Letter:
    paragraphs = tuple(
        _string_field(item, "text", max_length=PARAGRAPH_MAX_LENGTH, required=True, errors=errors, where=where)
        for _, item, where in _items(
            _list_field(values, "letterParagraphs", minimum=MIN_PARAGRAPHS, maximum=MAX_PARAGRAPHS, errors=errors),
            "letterParagraphs",
            errors,
        )
    )
    signatures = tuple(
        _string_field(item, "name", max_length=SIGNATURE_MAX_LENGTH, required=True, errors=errors, where=where)
        for _, item, where in _items(
            _list_field(values, "letterSignatures", minimum=MIN_SIGNATURES, maximum=MAX_SIGNATURES, errors=errors),
            "letterSignatures",
            errors,
        )
    )
    return Letter(
        greeting=_string_field(values, "letterGreeting", max_length=GREETING_MAX_LENGTH, required=True, errors=errors),
        paragraphs=paragraphs,
        signoff=_string_field(values, "letterSignoff", max_length=SIGNOFF_MAX_LENGTH, required=False, errors=errors),
        signatures=signatures,
    )


def _validate_flight(values: dict, errors: list[str], airline: bool) -> Flight:
    if not airline:
        return Flight(airline="", number="", seat="", cabin="", from_code="", from_city="", to_code="", to_city="")

    def text(key: str, max_length: int) -> str:
        return _string_field(values, key, max_length=max_length, required=False, errors=errors)

    return Flight(
        airline=text("flightAirline", FLIGHT_AIRLINE_MAX_LENGTH),
        number=text("flightNumber", FLIGHT_NUMBER_MAX_LENGTH),
        seat=text("flightSeat", FLIGHT_SEAT_MAX_LENGTH),
        cabin=text("flightCabin", FLIGHT_CABIN_MAX_LENGTH),
        from_code=_code_field(values, "flightFromCode", required=False, errors=errors),
        from_city=text("flightFromCity", FLIGHT_CITY_MAX_LENGTH),
        to_code=_code_field(values, "flightToCode", required=False, errors=errors),
        to_city=text("flightToCity", FLIGHT_CITY_MAX_LENGTH),
    )


def validate_and_normalize(values: dict, theme_selections: dict | None = None) -> NormalizedGraduation:
    if not isinstance(values, dict):
        raise GraduationKeepsakeInvalidData("Project data is not a valid Graduation Keepsake payload.")

    theme_selections = theme_selections if isinstance(theme_selections, dict) else {}
    journey = theme_selections.get("journey")
    if journey not in JOURNEYS:
        journey = DEFAULT_JOURNEY

    errors: list[str] = []
    graduate = _validate_graduate(values, errors)
    # Each chapter is ON unless switched off (a missing switch is on, as in
    # the Studio's opening state); a chapter that is off is not validated.
    airline = journey == "airline"
    path = _validate_path(values, errors, airline) if _bool_field(values, "pathEnabled", default=True) else None
    achievements = (
        _validate_achievements(values, errors, airline) if _bool_field(values, "achievementsEnabled", default=True) else None
    )
    messages = _validate_messages(values, errors) if _bool_field(values, "messagesEnabled", default=True) else None
    goals = _validate_goals(values, errors, airline) if _bool_field(values, "goalsEnabled", default=True) else None
    letter = _validate_letter(values, errors) if _bool_field(values, "letterEnabled", default=True) else None
    ending_line = _string_field(values, "endingLine", max_length=ENDING_LINE_MAX_LENGTH, required=True, errors=errors)
    ending_sub = _string_field(values, "endingSub", max_length=ENDING_SUB_MAX_LENGTH, required=False, errors=errors)
    flight = _validate_flight(values, errors, airline)

    if errors:
        raise GraduationKeepsakeInvalidData("; ".join(errors))

    return NormalizedGraduation(
        journey=journey,
        graduate=graduate,
        path=path,
        achievements=achievements,
        messages=messages,
        goals=goals,
        letter=letter,
        ending_line=ending_line,
        ending_sub=ending_sub,
        flight=flight,
        sound=_bool_field(values, "sound", default=True),
        show_share=_bool_field(values, "showShare", default=True),
    )


def audio_asset_ids(values: dict) -> list[str]:
    """The voice messages a PAID order must keep (`media_promotion.py`).

    Lenient on purpose, like every promotion collector: it never raises, and
    it reads a project that might not validate cleanly. Voice messages in a
    Messages chapter that is switched off are never shown, and a keepsake is
    final once bought, so they are left to expire with the other unpaid media.
    """
    if not isinstance(values, dict) or not _bool_field(values, "messagesEnabled", default=True):
        return []
    ids: list[str] = []
    for group in values.get("messageGroups") or []:
        if not isinstance(group, dict):
            continue
        for person in group.get("people") or []:
            voice = person.get("voice") if isinstance(person, dict) else None
            if isinstance(voice, dict) and isinstance(voice.get("assetId"), str) and voice["assetId"]:
                ids.append(voice["assetId"])
    return ids
