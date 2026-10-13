"""The live page payload for Graduation Keepsake.

Dispatched from `apps/delivery/live_views.py`. NOT `_build_ar_payload` reused
— that builder is Love Story Timeline's, and importing its validator here
would 404 every graduation keepsake.

The payload carries the SAME `values` shape the Studio module produces (flat
keys, repeatable groups as arrays), cleaned by `validate_and_normalize`, with
one change: every media value `{ assetId }` becomes `{ url }`, a FRESH URL
generated for this request. A stored URL is a presigned, expiring one (or a
`blob:` that was never valid for anyone else), so nothing from
`project.data` is ever passed through. Because the shape is identical, the
purchased page and the Studio's Live tab render with one component.
"""

from __future__ import annotations

import logging

from .data import media_asset_ids, validate_and_normalize

logger = logging.getLogger(__name__)


def _resolve_urls(customer, asset_ids: list[str]) -> dict[str, str]:
    """`{asset id: fresh access URL}` for every asset that is this customer's
    and not deleted — ONE query for all of them, however many there are (a
    keepsake can reference ~50: photos, drawings and voice messages).

    An id that is missing, deleted or someone else's is simply absent from
    the result; the caller renders without it. It is never an error and never
    reveals which of those it was, the same rule `get_asset_for_customer`
    enforces one asset at a time.
    """
    from apps.assets.models import Asset
    from apps.assets.services import generate_asset_access_url

    if not asset_ids:
        return {}
    assets = Asset.objects.filter(id__in=set(asset_ids), customer=customer).exclude(status=Asset.STATUS_DELETED)
    return {str(asset.id): generate_asset_access_url(asset) for asset in assets}


def _swap_media(node, urls: dict[str, str]):
    if isinstance(node, list):
        return [_swap_media(item, urls) for item in node]
    if isinstance(node, dict):
        if set(node) == {"assetId"}:
            url = urls.get(node["assetId"])
            return {"url": url} if url else None
        return {key: _swap_media(value, urls) for key, value in node.items()}
    return node


def build_graduation_live_payload(experience, order, project, product_slug) -> dict | None:
    data = project.data or {}
    try:
        graduation = validate_and_normalize(data.get("values", {}), data.get("themeSelections", {}))
    except Exception:  # noqa: BLE001
        logger.warning("live_experience_invalid_project", extra={"experience_id": str(experience.id)})
        return None

    urls = _resolve_urls(order.customer, media_asset_ids(graduation.values))
    if len(urls) < len(set(media_asset_ids(graduation.values))):
        logger.warning("live_experience_missing_media", extra={"experience_id": str(experience.id)})

    return {
        "productId": product_slug,
        "locale": order.locale,
        "values": _swap_media(graduation.values, urls),
        "themeSelections": {"journey": graduation.journey},
    }
