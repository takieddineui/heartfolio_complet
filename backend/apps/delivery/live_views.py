"""Public access to the Digital keepsake (§10, §21f).

REUSES THE AR ACCESS RULES ENTIRELY, and that is the point of this file
being short. §10 made the live keepsake a hosted page, which means it needs
exactly what §21f specified for AR: an unguessable id, no session, one
generic response for every failure, no listing endpoint, no ids in bulk,
`noindex`, and throttling.

Writing those rules a second time would mean two implementations of the same
security surface, and the one that drifted would be whichever nobody was
looking at. `_load_paid_experience` is shared; only `kind` differs, and now
only the PAYLOAD SHAPE differs per product, dispatched by `order.product.
slug` — see `_build_song_poster_live_payload` below for why Song Poster's
own live page is not `_build_ar_payload` reused, the way it briefly might
look like it should be.
"""

from __future__ import annotations

import logging

from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.delivery.ar_views import _build_ar_payload, _load_paid_experience
from apps.delivery.models import PublicExperience

logger = logging.getLogger(__name__)


def _build_song_poster_live_payload(experience, order, project, product_slug) -> dict | None:
    """Song Poster's own digital keepsake payload — NOT `_build_ar_payload`
    reused, because that function's entire shape is AR/Love-Story-Timeline
    concepts (`scene`, `level`, `targetUrl`, `needsTarget`) this product has
    none of. Song Poster's own §10: one song, one photo, one dedication —
    "hear the song, see the dedication, see the photo," not a chronological
    journey with milestones to activate.

    INDEPENDENT OF `themeSelections.theme` ENTIRELY — a customer who bought
    the Ledger print gets the SAME digital keepsake a Player customer gets.
    `theme` is not read here at all, deliberately: matches Love Story
    Timeline's own live page never reproducing whichever print layout was
    purchased (see `live-keepsake.tsx`'s own opening comment on this
    exact principle, worked out for a different product).

    TODO (deferred, not forgotten) — a different live experience per print
    theme, later, not now. Recorded here since this is the exact line
    that would need to change first: add `"theme": (theme_selections or
    {}).get("theme")` to the payload below, then `song-live-keepsake.tsx`
    (frontend) becomes a per-theme dispatcher instead of one component.
    See that file's own matching TODO for what the real work actually is
    — eight products' worth of "what does digital even mean for this
    theme," not just threading one more field through.

    THE PHOTO URL IS GENERATED FRESH ON EVERY CALL, never read from
    `project.data`'s own stored value. `lib/studio/media-values.ts`'s own
    documented lifecycle (`UPLOADED`/`RESTORED`) confirms a stored photo
    URL is a PRESIGNED, EXPIRING one — passing it through unresolved would
    mean a gift recipient opening this page weeks after purchase, once the
    presigned URL has expired, sees a broken image. `generate_asset_access_
    url` is already documented as "computed fresh on every call, never
    persisted" — the exact tool for this — used here via the asset's
    ownership-checked path (`get_asset_for_customer`, against the PAYING
    customer, i.e. `order.customer`, since this page has no session of its
    own to check against).
    """
    from apps.assets.services import (
        AssetAccessDenied,
        AssetNotFound,
        generate_asset_access_url,
        get_asset_for_customer,
    )
    from apps.delivery.product_renderers.song_poster.data import validate_and_normalize

    values = (project.data or {}).get("values", {})
    theme_selections = (project.data or {}).get("themeSelections", {})

    try:
        song = validate_and_normalize(values, theme_selections)
    except Exception:  # noqa: BLE001
        logger.warning("live_experience_invalid_project", extra={"experience_id": str(experience.id)})
        return None

    photo_url = None
    if song.photo_asset_id:
        try:
            asset = get_asset_for_customer(order.customer, song.photo_asset_id)
            photo_url = generate_asset_access_url(asset)
        except (AssetNotFound, AssetAccessDenied):
            # The photo this project pointed at is gone or no longer this
            # order's own — same reasoning `_load_experience` already
            # documents for a missing project: cheap to re-check, and the
            # alternative is trusting an invariant that a data fix or a
            # future erasure feature could quietly violate. The keepsake
            # still renders; it renders without the photo.
            logger.warning("live_experience_missing_photo", extra={"experience_id": str(experience.id)})

    return {
        "productId": product_slug,
        "locale": order.locale,
        "values": {
            "track": song.track,
            "artist": song.artist,
            "dedication": song.dedication,
            "photo": {"url": photo_url} if photo_url else None,
            # `null` rather than an empty string — `SongLiveKeepsakeProps`
            # on the frontend already treats a missing video id as "no
            # player to show," the same contract the Studio's own
            # `youtubeVideoId ?? null` uses.
            "youtubeVideoId": song.youtube_video_id or None,
        },
    }


class LiveExperienceView(APIView):
    """`GET /live/<id>/` — the Digital keepsake behind a shared link."""

    permission_classes = [AllowAny]
    authentication_classes = []
    #: Shares AR's scope: same shape of endpoint, same reason to throttle.
    throttle_scope = "ar_access"

    def get(self, request, experience_id):
        loaded = _load_paid_experience(
            experience_id,
            kind=PublicExperience.KIND_LIVE,
            missing_project_log_event="live_experience_without_project",
            missing_project_log_extra={"experience_id": str(experience_id)},
        )
        if loaded is not None:
            experience, order, project, product_slug = loaded
            # Dispatched by product, both builders sharing the SAME
            # already-loaded row — never a second lookup per product
            # tried. Anything not Song Poster falls through to the
            # original AR-shaped builder, preserving today's exact
            # behaviour for every existing live keepsake (Love Story
            # Timeline) rather than requiring every future product to be
            # added to an explicit allow-list before its live page works
            # at all.
            if product_slug == "song-poster":
                payload = _build_song_poster_live_payload(experience, order, project, product_slug)
            else:
                payload = _build_ar_payload(experience, order, project, product_slug)
        else:
            payload = None

        if payload is None:
            return Response(
                {"detail": "This keepsake is not available."},
                status=status.HTTP_404_NOT_FOUND,
                headers={"X-Robots-Tag": "noindex, nofollow"},
            )
        return Response(payload, headers={"X-Robots-Tag": "noindex, nofollow"})
