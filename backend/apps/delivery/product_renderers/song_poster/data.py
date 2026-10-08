"""
Song Poster data contract — validation and normalization.

The one place in the codebase that interprets Song Poster's `values` —
`Project.data` stays opaque everywhere else, same rule Love Story
Timeline's own `data.py` states and follows.

Read directly from the real frontend module, not guessed:
  - `schema.ts`         — track/artist/youtubeUrl/dedication/photo, and
                           which are required
  - `initial-state.ts`  — the exact `SongPosterValues` shape, including
                           that `youtubeVideoId` is only ever set once
                           `YouTubeValidateView` has confirmed the link
  - `youtube.ts`         — `extractVideoId`, mirrored here as
                           `extract_video_id` (already proven bit-for-bit
                           identical in `apps/common/youtube.py`, which
                           this module imports rather than reimplements)

`photo.assetId` is the only part of a photo value this module trusts —
same reasoning as Love Story Timeline's own note: `url`/`mimeType`/
`filename` are display-only leftovers from the upload response, never
used to actually fetch the image at render time.
"""

from __future__ import annotations

from dataclasses import dataclass

from apps.common.exceptions.api_errors import SongPosterInvalidData
from apps.common.youtube import extract_video_id

TRACK_MAX_LENGTH = 60
ARTIST_MAX_LENGTH = 60
DEDICATION_MAX_LENGTH = 180


@dataclass(frozen=True)
class NormalizedSongPoster:
    track: str
    artist: str
    dedication: str
    photo_asset_id: str
    youtube_video_id: str
    theme: str
    #: Only ever READ while `theme == "sleeve"` — every other theme
    #: ignores it, the same relationship `sleevePaletteId` has to every
    #: other theme's React component on the frontend. Present
    #: unconditionally rather than `| None`, matching how `theme`
    #: itself always resolves to a real value (falling back to a
    #: stated default) rather than leaving the caller to handle
    #: absence.
    sleeve_palette: str


def _string_field(values: dict, key: str, *, max_length: int, required: bool, errors: list[str]) -> str:
    raw = values.get(key)
    text = (raw or "").strip() if isinstance(raw, str) else ""
    if required and not text:
        errors.append(f"'{key}' is required.")
    if len(text) > max_length:
        errors.append(f"'{key}' must be at most {max_length} characters.")
    return text


#: Mirrors `SONG_POSTER_THEMES` in the frontend's `theme-registry.ts` —
#: only "player" exists so far. An unrecognised or missing theme id
#: falls back to this default rather than raising, matching how the
#: frontend's own `getSongPosterTheme(undefined)` falls back to the
#: first registry entry: a project saved before a theme axis existed at
#: all (every project created before this fix) has no `theme` key, and
#: that must render as Player, not fail to render at all.
#: THIS MUST STAY IN SYNC WITH `_THEME_RENDERERS` IN `png_renderer.py`,
#: by hand — there is no single shared source both read from, since one
#: is a validation whitelist and the other a drawing-function registry.
#: A theme registered in one but not the other is exactly the bug this
#: comment exists to prevent: `png_renderer.py` gained a `"ledger"`
#: entry before this tuple did, which meant `validate_and_normalize`
#: was silently rejecting every real customer's Ledger selection and
#: falling back to Player — the renderer's own dispatch was correct,
#: the gate in front of it was not. Caught by code inspection, not by
#: running the test that was already written to catch it
#: (`test_ledger_theme_renders`'s `self.assertEqual(song.theme,
#: "ledger")` — this environment cannot run Django to have caught it
#: automatically).
THEMES = ("player", "ledger", "ephemeris", "contactsheet", "label", "award", "sleeve", "mosaic")
DEFAULT_THEME = "player"

#: MUST STAY IN SYNC WITH `SLEEVE_PALETTES` IN `png_renderer.py`, by
#: hand — same reasoning as `THEMES`/`_THEME_RENDERERS`'s own sync
#: requirement, and the same class of bug (`test_every_registered_
#: drawing_theme_is_also_a_valid_selection`) it caused there once
#: already, this time between a palette id list and a palette colour
#: registry instead of a theme id list and a theme drawing registry.
SLEEVE_PALETTES = ("cream", "mustard", "red", "orange", "black", "blueGrey")
DEFAULT_SLEEVE_PALETTE = "cream"


def validate_and_normalize(values: dict, theme_selections: dict | None = None) -> NormalizedSongPoster:
    if not isinstance(values, dict):
        raise SongPosterInvalidData("Project data is not a valid Song Poster payload.")

    theme_selections = theme_selections if isinstance(theme_selections, dict) else {}
    theme = theme_selections.get("theme")
    if theme not in THEMES:
        theme = DEFAULT_THEME

    sleeve_palette = theme_selections.get("sleevePalette")
    if sleeve_palette not in SLEEVE_PALETTES:
        sleeve_palette = DEFAULT_SLEEVE_PALETTE

    errors: list[str] = []

    track = _string_field(values, "track", max_length=TRACK_MAX_LENGTH, required=True, errors=errors)
    artist = _string_field(values, "artist", max_length=ARTIST_MAX_LENGTH, required=True, errors=errors)
    dedication = _string_field(values, "dedication", max_length=DEDICATION_MAX_LENGTH, required=False, errors=errors)

    photo = values.get("photo")
    photo_asset_id = ""
    if isinstance(photo, dict) and isinstance(photo.get("assetId"), str) and photo["assetId"]:
        photo_asset_id = photo["assetId"]
    else:
        errors.append("'photo' is required.")

    # THE SAME GATE `validation.ts`'s `validateSongPoster` ENFORCES ON THE
    # CLIENT — re-checked here rather than trusted, because `Project.data`
    # is customer-writable state and the frontend's own validation is a
    # UX convenience, not a security boundary. A project reaching checkout
    # with a `youtubeUrl` that was never actually confirmed by
    # `YouTubeValidateView` (or was edited afterward, which the frontend
    # does not re-stamp `youtubeVideoId` for — see `initial-state.ts`'s
    # own note) must fail here, not render with no video at all.
    youtube_url = values.get("youtubeUrl")
    youtube_video_id = values.get("youtubeVideoId")
    if not isinstance(youtube_url, str) or not youtube_url.strip():
        errors.append("'youtubeUrl' is required.")
    elif not isinstance(youtube_video_id, str) or not youtube_video_id:
        errors.append("The YouTube link has not been confirmed as playable.")
    elif extract_video_id(youtube_url) != youtube_video_id:
        # The stored id no longer matches what the current URL text
        # parses to — the customer edited the link after it was
        # validated. Caught here rather than trusting a stale id.
        errors.append("The YouTube link has changed since it was last confirmed — check it again.")

    if errors:
        raise SongPosterInvalidData("; ".join(errors))

    return NormalizedSongPoster(
        track=track,
        artist=artist,
        dedication=dedication,
        photo_asset_id=photo_asset_id,
        youtube_video_id=youtube_video_id,
        theme=theme,
        sleeve_palette=sleeve_palette,
    )
