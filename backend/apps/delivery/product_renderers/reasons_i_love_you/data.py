"""
Reasons I Love You data contract — validation and normalization.

The one place in the backend that interprets this product's `values`;
`Project.data` stays opaque everywhere else, the same rule Love Story
Timeline's and Song Poster's own `data.py` state and follow.

Read from the real frontend module, not guessed:
  - `schema.ts`         — the fields, which are required, their caps
  - `initial-state.ts`  — the exact `ReasonsValues` shape (flat by field id;
                           `reasons` and `letterParagraphs` are lists of
                           objects, as the Studio's groups store them)
  - `validation.ts`     — the letter's fields are required only while the
                           letter is on
  - `limits.ts`         — the caps below; `limits.test.ts` reads THIS file
                           and fails if the two sides disagree
  - `gifts.ts`          — the four gift ids, also pinned by that test

`photo.assetId` is the only part of a photo value this module trusts — same
reasoning as the other products: `url`/`mimeType`/`filename` are display-only
leftovers from the upload, never used to fetch anything.

A LIVE-ONLY PRODUCT: nothing here is drawn by Pillow. This validation runs
before payment (`ReasonsILoveYouRenderer.validate_project_data`) and again
whenever the live page is served (`live_views._build_reasons_live_payload`).
"""

from __future__ import annotations

from dataclasses import dataclass

from apps.common.exceptions.api_errors import ReasonsILoveYouInvalidData

#: The same numbers as the frontend's `REASONS_LIMITS` (`limits.ts`).
MIN_REASONS = 1
#: Also the deck's size: its cards run Ace to 10 of Hearts.
MAX_REASONS = 10
MIN_PARAGRAPHS = 1
MAX_PARAGRAPHS = 5
NAME_MAX_LENGTH = 24
TITLE_MAX_LENGTH = 40
REASON_MAX_LENGTH = 160
MEMORY_MAX_LENGTH = 60
TEASER_MAX_LENGTH = 40
FINALE_LINE_MAX_LENGTH = 180
SIGNATURE_MAX_LENGTH = 24
GREETING_MAX_LENGTH = 40
PARAGRAPH_MAX_LENGTH = 500
SIGNOFF_MAX_LENGTH = 40

#: Mirrors `GIFT_IDS` in the frontend's `gifts.ts`. An unknown or missing gift
#: falls back to the default rather than failing, the same as Song Poster's
#: theme; the default is a member of its own choices (CLAUDE.md's
#: `_choice_field` trap).
GIFTS = ("jar", "daisy", "deck", "cookies")
DEFAULT_GIFT = "jar"


@dataclass(frozen=True)
class Reason:
    text: str
    memory: str
    photo_asset_id: str | None


@dataclass(frozen=True)
class Letter:
    greeting: str
    paragraphs: tuple[str, ...]
    signoff: str


@dataclass(frozen=True)
class NormalizedReasons:
    gift: str
    to_name: str
    from_name: str
    #: As written, `{count}` and all; empty means the frontend's localized
    #: default title (it chooses the plural form, which needs the locale).
    title: str
    reasons: tuple[Reason, ...]
    finale_teaser: str
    finale_line: str
    signature: str
    #: `None` when the sender switched the letter off.
    letter: Letter | None
    music: bool
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


def _validate_reasons(raw, errors: list[str]) -> tuple[Reason, ...]:
    if not isinstance(raw, list):
        errors.append("'reasons' must be a list.")
        return ()
    if not MIN_REASONS <= len(raw) <= MAX_REASONS:
        errors.append(f"'reasons' must have between {MIN_REASONS} and {MAX_REASONS} entries.")
    reasons = []
    for index, item in enumerate(raw[:MAX_REASONS]):
        if not isinstance(item, dict):
            errors.append(f"reasons[{index}] must be an object.")
            continue
        where = f"reasons[{index}]."
        text = _string_field(item, "text", max_length=REASON_MAX_LENGTH, required=True, errors=errors, where=where)
        memory = _string_field(item, "memory", max_length=MEMORY_MAX_LENGTH, required=False, errors=errors, where=where)
        photo = item.get("photo")
        photo_asset_id = None
        if photo is not None:
            # Optional, but if present it must be a real upload: a photo the
            # customer picked and that never uploaded is exactly what this
            # pre-payment check exists to catch.
            if isinstance(photo, dict) and isinstance(photo.get("assetId"), str) and photo["assetId"]:
                photo_asset_id = photo["assetId"]
            else:
                errors.append(f"reasons[{index}].photo, if present, must include a non-empty string 'assetId'.")
        reasons.append(Reason(text=text, memory=memory, photo_asset_id=photo_asset_id))
    return tuple(reasons)


def _validate_letter(values: dict, errors: list[str]) -> Letter | None:
    # Missing means off: a project with no letter keys at all has no letter.
    if not _bool_field(values, "letterEnabled", default=False):
        return None
    greeting = _string_field(values, "letterGreeting", max_length=GREETING_MAX_LENGTH, required=True, errors=errors)
    signoff = _string_field(values, "letterSignoff", max_length=SIGNOFF_MAX_LENGTH, required=False, errors=errors)
    raw = values.get("letterParagraphs")
    paragraphs: list[str] = []
    if not isinstance(raw, list) or not MIN_PARAGRAPHS <= len(raw) <= MAX_PARAGRAPHS:
        errors.append(f"'letterParagraphs' must have between {MIN_PARAGRAPHS} and {MAX_PARAGRAPHS} entries while the letter is on.")
    for index, item in enumerate((raw if isinstance(raw, list) else [])[:MAX_PARAGRAPHS]):
        container = item if isinstance(item, dict) else {}
        paragraphs.append(
            _string_field(container, "text", max_length=PARAGRAPH_MAX_LENGTH, required=True, errors=errors, where=f"letterParagraphs[{index}].")
        )
    return Letter(greeting=greeting, paragraphs=tuple(paragraphs), signoff=signoff)


def validate_and_normalize(values: dict, theme_selections: dict | None = None) -> NormalizedReasons:
    if not isinstance(values, dict):
        raise ReasonsILoveYouInvalidData("Project data is not a valid Reasons I Love You payload.")

    theme_selections = theme_selections if isinstance(theme_selections, dict) else {}
    gift = theme_selections.get("gift")
    if gift not in GIFTS:
        gift = DEFAULT_GIFT

    errors: list[str] = []
    to_name = _string_field(values, "toName", max_length=NAME_MAX_LENGTH, required=True, errors=errors)
    from_name = _string_field(values, "fromName", max_length=NAME_MAX_LENGTH, required=True, errors=errors)
    title = _string_field(values, "title", max_length=TITLE_MAX_LENGTH, required=False, errors=errors)
    reasons = _validate_reasons(values.get("reasons"), errors)
    finale_teaser = _string_field(values, "finaleTeaser", max_length=TEASER_MAX_LENGTH, required=False, errors=errors)
    finale_line = _string_field(values, "finaleLine", max_length=FINALE_LINE_MAX_LENGTH, required=True, errors=errors)
    signature = _string_field(values, "signature", max_length=SIGNATURE_MAX_LENGTH, required=False, errors=errors)
    letter = _validate_letter(values, errors)

    if errors:
        raise ReasonsILoveYouInvalidData("; ".join(errors))

    return NormalizedReasons(
        gift=gift,
        to_name=to_name,
        from_name=from_name,
        title=title,
        reasons=reasons,
        finale_teaser=finale_teaser,
        finale_line=finale_line,
        signature=signature,
        letter=letter,
        music=_bool_field(values, "music", default=True),
        show_share=_bool_field(values, "showShare", default=True),
    )
