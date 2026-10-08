"""Per-milestone wallpapers, expanded at delivery time (§13).

WHY THESE ARE NOT IN THE PACK'S `included_targets`
---------------------------------------------------
A `DeliveryPack` is a catalog row. It is defined before any customer exists
and cannot know how many milestones a particular story will have — and the
count varies from three to eight per §4.

So the pack grants "wallpapers", and how many FILES that means is resolved
here, from the story, at the moment of download. The alternative would be
writing eight moment targets into every pack and rendering blanks for the
ones a given story does not use, which would put files a customer cannot
explain into their download.

Only produced for a pack that actually grants wallpapers. A Printable-only
customer does not silently receive them.
"""

from __future__ import annotations

import logging

from apps.common.telegram import send_alert
from apps.delivery.wallpaper_devices import WALLPAPER_DEVICES, moment_target_id

logger = logging.getLogger("heartfolio")


def moment_wallpapers_for_order(order):
    """Yields `(target_id, content, filename)` for each memory wallpaper.

    A generator so a large story does not hold every rendered file in memory
    at once: eight milestones across three devices is 24 images, and a
    desktop one is 3840x2160.
    """
    targets = list(order.delivery_pack.included_targets or [])
    if not any(t.startswith("wallpaper-") for t in targets):
        return

    project = order.project
    if project is None:
        # §21e's situation: orders outlive projects by design.
        return

    milestones = ((project.data or {}).get("values") or {}).get("events") or []
    if not milestones:
        return

    from apps.delivery.registry import get_renderer
    from apps.delivery.delivery_types import DeliveryType

    # `get_renderer` always returns something — a NotImplementedRenderer
    # for an unknown product — so the guard is on the render call below
    # rather than on a None that never comes.
    renderer = get_renderer(
        order.product.slug if order.product else "", DeliveryType.WALLPAPER
    )

    for device in WALLPAPER_DEVICES.values():
        for index in range(len(milestones)):
            target_id = moment_target_id(device.id, index)
            try:
                result = renderer.render(
                    project,
                    delivery_type=DeliveryType.WALLPAPER,
                    delivery_pack=order.delivery_pack,
                    target_id=target_id,
                    locale=order.locale,
                )
            except Exception as exc:  # noqa: BLE001
                # One unrenderable memory must not cost the customer the
                # other twenty-three.
                logger.exception(
                    "moment_wallpaper_failed",
                    extra={"order_id": str(order.id), "target_id": target_id},
                )
                # §9 — this failure is invisible to the customer (they
                # simply receive fewer files than they paid for) and
                # invisible to us unless someone reads the logs, which is
                # exactly the case alerting exists for. Deliberately one
                # alert per failed target rather than a batched summary:
                # this loop already `continue`s, so there is no later point
                # that knows what failed.
                send_alert(
                    "RENDER FAILED (moment wallpaper)\n"
                    f"order: {order.id}\n"
                    f"target: {target_id}\n"
                    f"reason: {exc}"
                )
                continue
            if result and getattr(result, "content", None):
                yield target_id, result.content, getattr(result, "filename", f"{target_id}.png")
