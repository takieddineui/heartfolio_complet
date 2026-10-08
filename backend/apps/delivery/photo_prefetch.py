"""
Which photos does an order's pack render from, and warm them up together.

The renderers read each photo through `get_asset_bytes_for_customer`; this
module only works out WHICH photos they are about to ask for, so
`prefetch_asset_bytes` can fetch them concurrently instead of one at a time.
It is a hint, not a contract: a photo it misses (or a product it does not
know) is simply read on demand, as it always was.
"""

from __future__ import annotations

from apps.assets.services import prefetch_asset_bytes


def photo_asset_ids(project) -> list[str]:
    """Every `assetId` held under a `photo` key in the project's values.

    That is the shape all three products use for a picture —
    `events[].photo.assetId` (Love Story Timeline), `photo.assetId` (Song
    Poster, Where We Met) — so one walk covers them without importing each
    product's validator, and keeps working for a project whose data does not
    validate cleanly (this must never be a second, stricter validator).

    DELIBERATELY NOT every `assetId`: a milestone's `video`/`audio` carry one
    too, and a print or wallpaper render never reads them — prefetching a
    50MB video to warm a poster would be pure waste.
    """
    values = ((project.data or {}) if project is not None else {}).get("values") or {}
    found: list[str] = []

    def walk(node, key=None):
        if isinstance(node, dict):
            asset_id = node.get("assetId")
            if key == "photo" and isinstance(asset_id, str) and asset_id:
                found.append(asset_id)
            for child_key, child in node.items():
                walk(child, child_key)
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(values)
    return found


def prefetch_order_photos(order) -> int:
    """Warms the active `asset_bytes_cache()` with this order's photos.
    Returns how many it warmed (0 when there was nothing worth doing)."""
    project = order.project
    if project is None:
        return 0
    return prefetch_asset_bytes(project.customer, photo_asset_ids(project))
