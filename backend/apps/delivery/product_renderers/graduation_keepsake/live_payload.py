"""
Graduation Keepsake's live payload: what `/api/v1/live/<id>/` returns for a
paid keepsake, dispatched from `live_views._LIVE_PAYLOAD_BUILDERS`.

THE SAME SHAPE THE STUDIO PREVIEW DRAWS (`GraduationExperienceData` in
`components/live-graduation/experience-data.ts`), so one component renders
both. Validated with the same `validate_and_normalize` the pre-payment check
ran; a project that stopped being valid returns the generic 404, never half
a keepsake. A chapter switched off is `null`.

EVERY MEDIA URL IS FRESH, generated here from the stored `assetId` and
ownership-checked against the PAYING customer, never read from the stored
value (a presigned link long expired). Unlike the other live pages, a
graduation keepsake can reference up to 25 files (15 photos, 5 drawings,
5 voice messages), so they are fetched in ONE query rather than one per file.
A missing, deleted or foreign asset means that photo, drawing or voice is
absent (`null`), never a broken link. The links last
`R2_PRESIGNED_URL_EXPIRY_SECONDS`; the live page asks for this payload again
when one fails (`graduation-live-page.tsx`).
"""

from __future__ import annotations

import logging
import uuid

from .data import NormalizedGraduation, validate_and_normalize

logger = logging.getLogger("apps.delivery.live_views")


def _asset_ids(grad: NormalizedGraduation) -> list[str]:
    ids: list[str | None] = [grad.graduate.photo_asset_id]
    if grad.path:
        ids += [grad.path.then_photo_asset_id, grad.path.next_photo_asset_id]
        ids += [stop.photo_asset_id for stop in grad.path.stops]
    for group in grad.messages or ():
        for person in group.people:
            ids += [person.voice_asset_id, person.drawing_asset_id]
    return [asset_id for asset_id in ids if asset_id]


def _media_urls(customer, asset_ids: list[str]) -> dict[str, str]:
    """`{asset id: fresh URL}` for the customer's own, not-deleted assets."""
    from apps.assets.models import Asset
    from apps.assets.services import generate_asset_access_url

    valid = []
    for asset_id in asset_ids:
        try:
            valid.append(uuid.UUID(asset_id))
        except (ValueError, TypeError, AttributeError):
            continue
    if not valid:
        return {}
    assets = Asset.objects.filter(id__in=valid, customer=customer).exclude(status=Asset.STATUS_DELETED)
    return {str(asset.id): generate_asset_access_url(asset) for asset in assets}


def build_graduation_live_payload(experience, order, project, product_slug) -> dict | None:
    try:
        grad = validate_and_normalize(
            (project.data or {}).get("values", {}), (project.data or {}).get("themeSelections", {})
        )
    except Exception:  # noqa: BLE001
        logger.warning("live_experience_invalid_project", extra={"experience_id": str(experience.id)})
        return None

    wanted = _asset_ids(grad)
    urls = _media_urls(order.customer, wanted)
    if len(urls) < len(set(wanted)):
        logger.warning("live_experience_missing_photo", extra={"experience_id": str(experience.id)})

    def media(asset_id: str | None) -> dict | None:
        url = urls.get(str(uuid.UUID(asset_id))) if _is_uuid(asset_id) else None
        return {"url": url} if url else None

    graduate = grad.graduate
    path = grad.path
    letter = grad.letter
    flight = grad.flight
    return {
        "productId": product_slug,
        "locale": order.locale,
        "values": {
            "journey": grad.journey,
            "grad": {
                "name": graduate.name,
                "fullName": graduate.full_name,
                "year": graduate.year,
                "degree": graduate.degree,
                "school": graduate.school,
                "date": graduate.date,
                "photo": media(graduate.photo_asset_id),
            },
            "path": (
                {
                    "then": {"year": path.then_year, "text": path.then_text, "photo": media(path.then_photo_asset_id)},
                    "stops": [
                        {"year": stop.year, "caption": stop.caption, "code": stop.code, "photo": media(stop.photo_asset_id)}
                        for stop in path.stops
                    ],
                    "now": {"year": path.now_year, "text": path.now_text},
                    "next": {"text": path.next_text, "photo": media(path.next_photo_asset_id)},
                }
                if path
                else None
            ),
            "achievements": (
                [{"title": a.title, "detail": a.detail, "place": a.place} for a in grad.achievements]
                if grad.achievements is not None
                else None
            ),
            "messages": (
                [
                    {
                        "label": group.label,
                        "people": [
                            {
                                "name": person.name,
                                "color": person.colour,
                                "emoji": person.emoji,
                                "message": person.message,
                                "voice": media(person.voice_asset_id),
                                "voiceCaption": person.voice_caption,
                                "drawing": media(person.drawing_asset_id),
                            }
                            for person in group.people
                        ],
                    }
                    for group in grad.messages
                ]
                if grad.messages is not None
                else None
            ),
            "goals": [{"text": g.text, "code": g.code} for g in grad.goals] if grad.goals is not None else None,
            "letter": (
                {
                    "greeting": letter.greeting,
                    "paragraphs": list(letter.paragraphs),
                    "signoff": letter.signoff,
                    "signatures": list(letter.signatures),
                }
                if letter
                else None
            ),
            "ending": {"line": grad.ending_line, "sub": grad.ending_sub},
            "flight": {
                "airline": flight.airline,
                "number": flight.number,
                "seat": flight.seat,
                "cabin": flight.cabin,
                "fromCode": flight.from_code,
                "fromCity": flight.from_city,
                "toCode": flight.to_code,
                "toCity": flight.to_city,
            },
            "sound": grad.sound,
            "share": grad.show_share,
        },
    }


def _is_uuid(value) -> bool:
    try:
        uuid.UUID(value)
        return True
    except (ValueError, TypeError, AttributeError):
        return False
