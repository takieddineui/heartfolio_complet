"""Public AR access (§21f).

THE ONE ENDPOINT IN THIS PROJECT WITH NO SESSION CHECK, and that is
deliberate rather than an oversight. The person scanning the QR is the gift
recipient: they have no Heartfolio session, no account, and never will.
Possession of the unguessable URL is the access mechanism.

That makes the URL a bearer credential, and §21f lists what follows from it.
Each requirement is implemented here rather than assumed:

  * **Unguessable id** — `uuid4`, non-sequential, derived from nothing.
    Enforced by the model's default, not by this view.
  * **No listing endpoint** — there is no list view in this module, and
    there must never be one. A single AR id is a link someone was given;
    a list of them is every customer's private link at once.
  * **Never exposed in bulk** — no API response anywhere includes AR ids.
  * **Generic response for anything invalid** — a missing id, a malformed
    id, a revoked experience and an unpaid order all return the *same*
    404. Distinguishing them would confirm which ids exist, turning a
    guessing attack into a working oracle.
  * **Revoked means inaccessible** — checked here, not merely hidden from
    a listing that does not exist anyway.
  * **`noindex`** — sent as a header, because this response is JSON and
    has no `<head>` to put a meta tag in. The page that consumes it sends
    the meta tag too; a crawler that reaches either must not index it.
  * **Rate limited** — a bearer-token endpoint with no session is the one
    place brute force is even theoretically worth attempting. The
    namespace is 122 bits of randomness so guessing is not a real threat,
    but throttling costs nothing and removes the argument.
  * **No personal data in the URL** — the UUID alone. No email, no name,
    no order reference.

Anyone holding the URL can open the experience. §21f calls that an
intentional consequence of a no-login, recipient-facing model, and it is:
the security boundary is the secrecy of the URL, not an account.
"""

from __future__ import annotations

import logging

from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from django.core.exceptions import ValidationError

from apps.commerce.models import Order
from apps.delivery.ar_support import ar_level_for, ar_scene_for, preset_music_url

#: A malformed UUID raises `ValidationError` on some backends and
#: `ValueError` on others. Both are caught, so a malformed id can never
#: escape as a 500 — which would itself distinguish it from an unknown one.
_LOOKUP_FAILURES = (ValidationError, ValueError, TypeError)

logger = logging.getLogger("heartfolio")


class ARExperienceView(APIView):
    """`GET /ar/<id>/` — the scene data behind a scanned QR code."""

    permission_classes = [AllowAny]
    #: No session authentication at all. Adding it would not make this more
    #: secure — it would make the feature not work.
    authentication_classes = []
    throttle_scope = "ar_access"

    def get(self, request, ar_id):
        payload = _load_experience(ar_id)
        if payload is None:
            # One response for every failure mode. See the module docstring.
            return Response(
                {"detail": "This experience is not available."},
                status=status.HTTP_404_NOT_FOUND,
                headers={"X-Robots-Tag": "noindex, nofollow"},
            )

        return Response(payload, headers={"X-Robots-Tag": "noindex, nofollow"})


def _load_paid_experience(experience_id, kind: str, *, missing_project_log_event: str, missing_project_log_extra: dict):
    """The product-agnostic prefix of `_load_experience` below, extracted
    so a second product (Song Poster's own live page) can reuse the
    EXACT SAME security checks — unguessable id, accessibility, paid
    order, project still exists — without a second, independently
    drifting copy of them. `_load_experience`'s own behaviour is
    unchanged by this extraction: it calls this helper for the same
    work it always did, byte-identical, and everything below the id
    lookup (which is AR/Love-Story-Timeline specific: `scene`, `level`,
    `targetUrl`) stays exactly where it was.

    `missing_project_log_event`/`missing_project_log_extra` are NOT
    hardcoded here — the original, pre-extraction code logged
    `"ar_experience_without_project"` with `extra={"ar_id": ...}`. Baking
    either into a now-shared helper would have silently changed what an
    existing dashboard or alert sees, for a change that was meant to be a
    pure refactor. The AR/LST caller below passes both unchanged; a new
    caller names its own.

    Returns `(experience, order, project, product_slug)`, or `None` for
    anything a caller must not be able to distinguish — same contract
    `_load_experience` itself documents, for the same reason.
    """
    from apps.delivery.models import PublicExperience

    try:
        experience = PublicExperience.objects.select_related(
            "entitlement__order__product",
            "entitlement__order__project",
        ).get(id=experience_id, kind=kind)
    except (PublicExperience.DoesNotExist, *_LOOKUP_FAILURES):
        return None

    if not experience.is_accessible:
        return None

    order = experience.entitlement.order
    if order.status != Order.STATUS_PAID:
        return None

    project = order.project
    if project is None:
        logger.warning(missing_project_log_event, extra=missing_project_log_extra)
        return None

    product_slug = order.product.slug if order.product else None
    return experience, order, project, product_slug


def _load_experience(ar_id, kind: str = "ar") -> dict | None:
    """Returns the scene payload, or None for anything a caller must not be
    able to distinguish.

    Returning `None` rather than raising distinct errors is the point: the
    view has one failure response, so there is no path by which a malformed
    id, an unknown id, a revoked experience and an unpaid order produce
    different observable behaviour.
    """
    loaded = _load_paid_experience(
        ar_id,
        kind,
        missing_project_log_event="ar_experience_without_project",
        missing_project_log_extra={"ar_id": str(ar_id)},
    )
    if loaded is None:
        return None
    return _build_ar_payload(*loaded)


def _build_ar_payload(experience, order, project, product_slug) -> dict | None:
    """The Love-Story-Timeline-specific tail of the original
    `_load_experience` — extracted alongside `_load_paid_experience` so
    `live_views.py` can load ONCE (`_load_paid_experience`) and dispatch
    to whichever product's own payload builder applies, rather than
    either duplicating the lookup or calling `_load_experience` a second
    time against the same row. `_load_experience` above still exists,
    unchanged in signature and behaviour, for AR's own caller.
    """
    # Normalized once: the scene payload and the level both read from it,
    # and validating here means a malformed project fails before anything
    # is served rather than halfway through a scene.
    from apps.delivery.product_renderers.love_story_timeline.data import validate_and_normalize

    try:
        timeline = validate_and_normalize(
            (project.data or {}).get("values", {}), (project.data or {}).get("themeSelections", {})
        )
    except Exception:  # noqa: BLE001
        logger.warning("ar_experience_invalid_project", extra={"ar_id": str(experience.id)})
        return None

    level = ar_level_for(timeline)

    return {
        "arId": str(experience.id),
        "target": experience.entitlement.target_id,
        "productId": product_slug,
        # §21c — the scene is a product module constant, not a customer
        # choice and not inferred from the data. Inference would mean a
        # timeline with no photos silently getting a different experience
        # from one with photos; the customer personalizes, the product
        # decides what that personalization does.
        "scene": ar_scene_for(product_slug or ""),
        # §15 — derived from the story, never chosen (see `ar_level_for`).
        # Sent so the client knows which behaviours to prepare rather than
        # inferring richness from the presence of fields, which would drift
        # from the backend's definition the moment either changed.
        "level": level,
        # §21i — which tracking target this experience uses.
        #
        # `null` means a SHARED target: the client uses the `.mind` shipped
        # with the app. A URL means a per-order card compiled from this
        # customer's own artwork.
        #
        # `needsTarget` is the fallback signal. It is true only when a
        # per-order card's checkout-time compilation did not complete, and
        # it tells the client to compile on the spot rather than showing a
        # card that will never track.
        "targetUrl": _target_url(experience),
        "needsTarget": experience.needs_target and _is_per_order_card(order),
        # Milestone video/audio are resolved to fresh, ownership-checked
        # URLs here — the same `get_asset_for_customer` +
        # `generate_asset_access_url` path `_build_song_poster_live_payload`
        # above already uses for its photo. This used to hand back the bare
        # asset id instead, on the promise that "the client resolves those
        # through the same ownership-checked path as everything else" — but
        # no such client-side path ever existed: `live-keepsake.tsx` and
        # `ar-scene.tsx` both assigned the id straight to a media element's
        # `src`, which a browser cannot load anything from. A customer's
        # recorded voice note was reaching this payload correctly and never
        # playing. Resolving it here, once, keeps every consumer of this
        # payload (both AR and the Live page, which dispatches here for
        # every product but Song Poster) working from a URL it can actually
        # load, without a second "resolve this id" round trip the way the
        # ids-only version implied one should exist. Background music is
        # NOT resolved this way: since §4 made it a shipped, selectable
        # preset rather than a customer upload, there is no ownership to
        # check and no customer file to protect — it is exactly as public
        # as the scene's own code.
        "media": {
            "backgroundMusic": preset_music_url(timeline.background_music_preset),
            "milestones": [
                {
                    "video": _resolve_milestone_asset_url(order.customer, event.video_asset_id),
                    "audio": _resolve_milestone_asset_url(order.customer, event.audio_asset_id),
                }
                for event in timeline.events
            ],
        },
        # Rendered fresh from the project every request — nothing is
        # snapshotted (§21e). The scene is built by the client from these
        # values, the same ones every other deliverable reads.
        "values": _with_fresh_milestone_photo_urls((project.data or {}).get("values", {}), timeline, order.customer),
        "themeSelections": (project.data or {}).get("themeSelections", {}),
        "locale": order.locale,
    }


def _is_per_order_card(order) -> bool:
    """Whether this purchase includes a card needing its own target.

    Read from the product's card registry rather than from the entitlement,
    because the entitlement records a SURFACE (`ar-card`) and the target
    model is a property of the CARD DESIGN — a product could offer a shared
    card and a personalized one behind the same surface.
    """
    from apps.delivery.ar_support import cards_available_for_order

    return any(not card.shared_target for card in cards_available_for_order(order))


def _with_fresh_milestone_photo_urls(values: dict, timeline, customer) -> dict:
    """Replaces each event's stored `photo.url` with a freshly generated
    one, the same ownership-checked path `_resolve_milestone_asset_url`
    already uses for video/audio and `_build_song_poster_live_payload`
    already uses for its own photo — applied here to close the one gap
    where Love Story Timeline's own photo was the sole remaining consumer
    of this payload trusting a URL out of stored `project.data` verbatim.

    THAT TRUST WAS WRONG FOR TWO REASONS, not one. The documented reason
    (see `_resolve_milestone_asset_url`'s own docstring and
    `_build_song_poster_live_payload`'s) is that a stored photo URL is a
    PRESIGNED, EXPIRING one — any URL saved once and reused forever goes
    stale eventually regardless of how it was produced. A second, sharper
    failure mode surfaced during a real sandbox test: the Studio's photo
    field writes a `blob:` object URL into `values.events[].photo.url` for
    an immediate local preview (standard practice — the real asset upload
    is still in flight), and an autosave mid-upload can persist that
    preview URL into `project.data` before it is ever replaced with the
    real one. A `blob:` URL is scoped to the browser tab that created it
    and cannot outlive that page, let alone reach a different visitor's
    browser on the live page — so a persisted one is not merely stale the
    way an expired presigned URL is, it is NEVER valid for anyone else,
    from the moment it is saved. Regenerating fresh here, from
    `photo_asset_id` (the actual durable reference — see `TimelineEvent`
    in this product's `data.py`), fixes both failure modes the same way:
    neither a stale presigned URL nor a stray client-only blob URL is ever
    read back out of storage and served as if it still worked.

    A missing or foreign asset id degrades to no photo for that milestone
    — never a broken image — same reasoning as `_resolve_milestone_asset_url`.
    """
    events = list(values.get("events") or [])
    if not events:
        return values

    from apps.assets.services import AssetAccessDenied, AssetNotFound, generate_asset_access_url, get_asset_for_customer

    fresh_events = []
    for index, event in enumerate(events):
        asset_id = timeline.events[index].photo_asset_id if index < len(timeline.events) else None
        fresh_event = dict(event)

        if not asset_id:
            fresh_event.pop("photo", None)
            fresh_events.append(fresh_event)
            continue

        try:
            asset = get_asset_for_customer(customer, asset_id)
            fresh_event["photo"] = {"url": generate_asset_access_url(asset)}
        except (AssetNotFound, AssetAccessDenied):
            logger.warning("live_experience_missing_milestone_photo", extra={"asset_id": str(asset_id)})
            fresh_event.pop("photo", None)

        fresh_events.append(fresh_event)

    return {**values, "events": fresh_events}


def _resolve_milestone_asset_url(customer, asset_id: str | None) -> str | None:
    """Turns a milestone's stored `video`/`audio` asset id into a fresh,
    playable URL, computed on every call and never persisted — the exact
    pattern `_build_song_poster_live_payload` above already uses for its
    photo (`get_asset_for_customer` then `generate_asset_access_url`).

    A missing or foreign asset id degrades to "no media for this
    milestone" rather than a broken experience, the same reasoning
    `_build_song_poster_live_payload`'s own photo lookup documents: cheap
    to re-check, and the alternative is trusting an invariant a data fix
    or a future erasure feature could quietly violate.
    """
    if not asset_id:
        return None

    from apps.assets.services import AssetAccessDenied, AssetNotFound, generate_asset_access_url, get_asset_for_customer

    try:
        asset = get_asset_for_customer(customer, asset_id)
        return generate_asset_access_url(asset)
    except (AssetNotFound, AssetAccessDenied):
        logger.warning("ar_experience_missing_milestone_media", extra={"asset_id": str(asset_id)})
        return None


def _target_url(experience) -> str | None:
    """The compiled target, if one has been stored."""
    if not experience.target_key:
        return None

    from apps.assets.storage import get_asset_storage

    try:
        # Same accessor as every other stored file — a second URL scheme
        # for targets would be one more thing to keep in step with R2's
        # configuration.
        return get_asset_storage().generate_access_url(experience.target_key)
    except Exception:  # noqa: BLE001
        # A missing URL degrades to "compile it now" rather than to a broken
        # experience — the fallback path exists for exactly this.
        logger.warning("ar_target_url_failed", extra={"experience": str(experience.id)})
        return None
