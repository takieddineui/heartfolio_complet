"""§7 — promoting provisional media on payment (part of the deferred-media
storage design).

WHY THIS LIVES HERE AND NOT IN apps/assets
--------------------------------------------
Deciding WHICH assets a paid order needs is a commerce-domain question — it
reads `DeliveryPack.included_targets` and the timeline's own JSON shape,
neither of which `apps/assets` should know about. `apps/assets` owns what
an asset IS and how its bytes are stored; it should not need to understand
one product's milestone schema to answer "is this asset still needed."
That split mirrors the one already drawn throughout delivery: renderers own
shape, `apps/assets` owns bytes, `apps/commerce` owns money and the paid
event.

CALLED FROM THE SAME PLACE, THE SAME WAY, AS §21h's AR PROVISIONING
---------------------------------------------------------------------
`grant_entitlements` already creates a `PublicExperience` row in the same
transaction that grants entitlements, reasoning explicitly that a separate
step would be "a second place for a paid order to end up half-provisioned."
This is that same principle applied to media: promotion happens inside
`grant_entitlements`, in the same transaction, keyed off the same
`delivery_pack.included_targets` the entitlement loop already reads.
"""

from __future__ import annotations

import logging

logger = logging.getLogger("heartfolio")


def promote_media_assets_for_order(order) -> None:
    """Clears `expires_at` on every video/audio asset this order needs.

    "Needs" is decided the same way §21h decides whether an order needs an
    AR access row and the way `moment_wallpapers_for_order` decides whether
    an order needs wallpaper files: read `included_targets`, never the pack
    slug — a renamed or newly-combined pack changes nothing here.

    PHOTOS ARE NEVER TOUCHED. They have no `expires_at` to clear — see the
    `Asset.expires_at` docstring for why they are permanent from upload.

    Failures are logged and swallowed, not raised. A missing or already-
    deleted asset must not roll back payment confirmation — the customer
    has paid; a broken media reference is a delivery-quality problem to
    surface separately (the ops lookup screen would show it), not a reason
    to fail the transaction that already took their money.
    """
    needs_media = _order_needs_media(order)
    if not needs_media:
        return

    project = order.project
    if project is None:
        # §21e's situation: orders can outlive projects by design.
        return

    asset_ids = _media_asset_ids(project)
    if not asset_ids:
        return

    from apps.assets.models import Asset

    try:
        updated = Asset.objects.filter(
            id__in=asset_ids, customer=order.customer, expires_at__isnull=False
        ).update(expires_at=None)
        logger.info(
            "media_assets_promoted",
            extra={"order_id": str(order.id), "count": updated, "candidates": len(asset_ids)},
        )
    except Exception:  # noqa: BLE001
        logger.exception("media_asset_promotion_failed", extra={"order_id": str(order.id)})


def _order_needs_media(order) -> bool:
    """Whether this order's pack includes anything that plays video/audio.

    `__live__` and `ar-*` are the only targets that ever read a
    milestone's video/audio/backgroundMusic — every print and wallpaper
    target is a static image. Prefix/membership checks against the pack's
    own targets, never the pack's slug or name, so this stays correct
    however packs get renamed or combined (the wallpaper-combo packs are
    exactly this: two targets folded into one pack under a slug that
    matches neither source).
    """
    targets = order.delivery_pack.included_targets or []
    return "__live__" in targets or any(t.startswith("ar-") for t in targets)


def _media_asset_ids(project) -> list[str]:
    """Every video/audio asset id referenced by a project.

    Reads the SAME keys the Love Story Timeline validator reads
    (`_optional_asset_id(raw_event, "video"/"audio", ...)` in data.py) —
    deliberately not imported from there, because this needs to tolerate a
    project whose data does not validate cleanly (a draft, a stale shape)
    without raising. Promotion is a best-effort backend/cost concern; it
    must not become a second, stricter validator that can fail a payment.

    BACKGROUND MUSIC IS NEVER COLLECTED HERE. It used to be — before §4
    made it a shipped preset selection rather than a customer upload, it
    was an `Asset` reference like any other and needed the same deferred-
    storage treatment. It is not an asset anymore: `values.backgroundMusic`
    is a plain preset id (`_choice_field`-validated against `MUSIC_PRESETS`
    in data.py), with nothing in R2 for a paid order to promote.
    """
    values = (project.data or {}).get("values") or {}
    asset_ids: list[str] = []

    for event in values.get("events") or []:
        if not isinstance(event, dict):
            continue
        for key in ("video", "audio"):
            media = event.get(key)
            if isinstance(media, dict) and isinstance(media.get("assetId"), str):
                asset_ids.append(media["assetId"])

    return asset_ids
