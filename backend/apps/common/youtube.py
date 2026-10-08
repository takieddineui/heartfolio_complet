"""Song Poster's YouTube link — parsing and validation.

WHY THIS EXISTS. Song Poster asks for a YouTube URL rather than an
uploaded audio file: no audio bytes ever pass through Heartfolio, which
sidesteps the licensing question entirely — YouTube hosts the video,
Heartfolio only embeds it, using the iframe embedding YouTube's own
oEmbed endpoint exists to support.

SPLIT FROM THE VIEW DELIBERATELY. `extract_video_id` is pure — no
network, no Django — so it can be tested exhaustively against the many
URL shapes a customer might actually paste, without a live call to
Google for every case. `check_embeddable` is the one function that
touches the network, and is where the test coverage necessarily thins
out: nothing in this container can reach youtube.com to prove it against
a live response, and that gap is real, not hidden.
"""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse

import requests

_OEMBED_ENDPOINT = "https://www.youtube.com/oembed"
_TIMEOUT_SECONDS = 6

#: youtu.be/<id> and .../shorts/<id> and .../embed/<id> all carry the id
#: as the first path segment; matched directly rather than through
#: `urlparse` + `parse_qs`, which only work for the `?v=` query-string form.
_PATH_ID_RE = re.compile(r"^/(?:shorts/|embed/|live/)?([A-Za-z0-9_-]{11})/?$")


def extract_video_id(raw_url: str) -> str | None:
    """Pulls an 11-character YouTube video id out of whatever a customer
    actually pastes, or returns `None` if it doesn't look like one.

    HANDLES, because a customer will paste all of these:
      https://www.youtube.com/watch?v=ID
      https://youtube.com/watch?v=ID&t=42s&list=...   (extra params kept
                                                         out of the id)
      https://music.youtube.com/watch?v=ID             (YouTube Music —
                                                         plausible for a
                                                         song specifically)
      https://youtu.be/ID
      https://youtu.be/ID?t=42
      https://www.youtube.com/embed/ID
      https://www.youtube.com/shorts/ID
      ID alone, no URL at all — someone who already knows what an id
      looks like will sometimes just paste that.

    Deliberately permissive about the host (`youtube.com`, `youtu.be`,
    `music.youtube.com`, with or without `www.`/`m.`) rather than an
    allow-list of exact hostnames, which breaks the moment YouTube adds
    a regional or mobile subdomain nothing here anticipated.
    """
    raw_url = (raw_url or "").strip()
    if not raw_url:
        return None

    # A bare id, no URL structure at all.
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", raw_url):
        return raw_url

    if "://" not in raw_url:
        raw_url = f"https://{raw_url}"

    try:
        parsed = urlparse(raw_url)
    except ValueError:
        return None

    host = parsed.netloc.lower().removeprefix("www.").removeprefix("m.")

    if host in ("youtube.com", "music.youtube.com") and parsed.path == "/watch":
        video_id = parse_qs(parsed.query).get("v", [None])[0]
        if video_id and re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
            return video_id
        return None

    if host in ("youtube.com", "music.youtube.com", "youtu.be"):
        match = _PATH_ID_RE.match(parsed.path)
        if match:
            return match.group(1)

    return None


class YouTubeValidationError(Exception):
    """Raised for anything that isn't a clean yes/no — a network failure,
    a malformed oEmbed response — so the view can tell "this video does
    not exist or cannot be embedded" apart from "we could not check"."""


def check_embeddable(video_id: str) -> dict:
    """Calls YouTube's oEmbed endpoint server-side and returns
    `{title, author_name, thumbnail_url}` on success.

    SERVER-SIDE, NOT FROM THE BROWSER, because YouTube's oEmbed response
    carries no `Access-Control-Allow-Origin` header — confirmed against
    real reports of browsers rejecting exactly this call — so a direct
    `fetch()` from the Studio would fail before this code ever runs.

    WHAT A SUCCESSFUL RESPONSE DOES AND DOES NOT PROVE. oEmbed succeeding
    means the video exists and YouTube is willing to describe it for
    embedding right now. It is the same mechanism the iframe player
    itself relies on, so it is a genuine signal, not a guess — but a
    video's owner can disable embedding or take a video private
    AFTER this check ran and before the poster ships, and nothing here
    can watch for that continuously. The Studio's live iframe is the
    real, continuous proof; this is the gate at the point of purchase.

    Raises `YouTubeValidationError` for a 404 (deleted, private, or
    embedding disabled — oEmbed does not distinguish these), any other
    non-2xx, a network failure, or a response oEmbed's own schema
    doesn't explain.
    """
    try:
        response = requests.get(
            _OEMBED_ENDPOINT,
            params={"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"},
            timeout=_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise YouTubeValidationError(f"Could not reach YouTube: {exc}") from exc

    if response.status_code == 404:
        raise YouTubeValidationError(
            "This video is not available for embedding — it may be private, deleted, "
            "or the owner has disabled embedding."
        )
    if response.status_code != 200:
        raise YouTubeValidationError(f"YouTube returned an unexpected response ({response.status_code}).")

    try:
        payload = response.json()
    except ValueError as exc:
        raise YouTubeValidationError("YouTube's response could not be read.") from exc

    title = payload.get("title")
    if not title:
        raise YouTubeValidationError("YouTube's response was missing the video title.")

    return {
        "title": title,
        "author_name": payload.get("author_name", ""),
        "thumbnail_url": payload.get("thumbnail_url", ""),
    }
