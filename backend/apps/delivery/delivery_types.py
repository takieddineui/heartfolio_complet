"""
Delivery type classification for a single `Entitlement`.

Determined entirely from data the approved schema already stores — no
new column or table. See the Phase 3.8 report for the full reasoning,
summarized here:

`Entitlement.target_id` alone is **not** a reliable signal. Inspecting
the real frontend catalog (`src/lib/studio/product-modules/love-story-
timeline/{exports,delivery-packs}.ts`) shows the same target id can
legitimately mean different things depending on which pack it was
purchased through — `"story-png"` (a 1080x1920 PNG) appears as an item
in *both* the `"social"` pack (an Instagram Story image) and the
`"wallpaper"` pack (a phone wallpaper). The export format itself is
just a pixel shape; "what this delivery is for" is a packaging
decision made at the `DeliveryPack` level, not a property of the
target id string.

Resolution used here: prefer the *purchasing* `DeliveryPack`'s own slug
when it maps directly to one of the four types (`"printable"`,
`"social"`, `"wallpaper"`, `"live"` -> DIGITAL). This is available for
free via `entitlement.order.delivery_pack` — no schema change needed.
Only for a pack whose slug doesn't map directly (a bundle like
`"complete"`, or any future/unrecognized pack slug) does this fall back
to classifying the bare target id by its own naming convention — which
is where the genuine, currently-unresolved ambiguity remains (see
`infer_delivery_type`'s docstring). This is a documented limitation,
not silently papered over.
"""

from __future__ import annotations

from apps.common.exceptions.api_errors import UnsupportedDeliveryType


class DeliveryType:
    PRINTABLE = "printable"
    SOCIAL = "social"
    WALLPAPER = "wallpaper"
    DIGITAL = "digital"
    #: §21 — AR is its own type, deliberately NOT folded into DIGITAL.
    #:
    #: `__live__` is an HTML version of the printable artwork; an AR
    #: experience is camera-driven with its own targets, triggers and
    #: scenes. Sharing a type would mean every branch that asks "is this
    #: digital?" silently answering for both, and the two need different
    #: delivery, different access rules and different lifetimes.
    AR = "ar"

    CHOICES = (PRINTABLE, SOCIAL, WALLPAPER, DIGITAL, AR)


# The existing hosted/interactive entitlement sentinel, already used
# throughout commerce (Phase 3.4) — reused here, not redefined.
LIVE_TARGET_SENTINEL = "__live__"

# Direct pack-slug -> delivery-type mapping, matching the real frontend
# catalog's pack ids exactly (love-story-timeline/delivery-packs.ts).
# Deliberately does NOT include "complete" — a bundle pack has no
# single type; its targets fall through to the naming-convention
# fallback below.
_PACK_SLUG_TO_TYPE = {
    "printable": DeliveryType.PRINTABLE,
    "social": DeliveryType.SOCIAL,
    "wallpaper": DeliveryType.WALLPAPER,
    "live": DeliveryType.DIGITAL,
}

_PRINTABLE_TARGET_PREFIXES = ("print-",)
_SOCIAL_TARGET_PREFIXES = ("story-", "square-")
_WALLPAPER_TARGET_PREFIXES = ("landscape-", "portrait-", "wallpaper-")
#: §21b — `ar-card`, `ar-screen`, and `ar-print` reserved but never
#: included in a v1 pack. Additive: no existing target starts with `ar-`,
#: so this cannot reclassify anything already sold.
_AR_TARGET_PREFIXES = ("ar-",)


def infer_delivery_type(*, target_id: str, delivery_pack_slug: str | None = None) -> str:
    """Classifies a single entitlement target into one of the four
    delivery types.

    `__live__` is always DIGITAL, unambiguously, regardless of pack.

    Otherwise, `delivery_pack_slug` (the entitlement's originating
    `order.delivery_pack.slug`) is checked first — this is what
    correctly resolves the `"story-png"` example above: purchased via
    the `"wallpaper"` pack, it classifies as WALLPAPER; purchased via
    `"social"`, as SOCIAL.

    Only when the pack slug doesn't map directly (bundle packs like
    `"complete"`, or an unrecognized slug) does this fall back to the
    bare target id's own naming convention — at which point the
    `"story-png"`-style ambiguity is genuinely unresolved from data
    alone, and this function makes a best-effort, documented default
    guess (`story-`/`square-` -> SOCIAL, `landscape-`/`portrait-`/
    `wallpaper-` -> WALLPAPER) rather than silently picking one without
    saying so.
    """
    if target_id == LIVE_TARGET_SENTINEL:
        return DeliveryType.DIGITAL

    # §21 — checked BEFORE the pack-slug map, unlike every other prefix.
    #
    # An `ar-card` bought through a bundle pack is still AR. The pack map
    # exists to disambiguate targets whose type genuinely depends on how
    # they were sold (`story-png` is social or wallpaper depending on the
    # pack); an AR target has no such ambiguity, and letting a pack slug
    # override it would misclassify AR as printable the moment someone
    # adds `ar-card` to the printable pack.
    if target_id.startswith(_AR_TARGET_PREFIXES):
        return DeliveryType.AR

    if delivery_pack_slug in _PACK_SLUG_TO_TYPE:
        return _PACK_SLUG_TO_TYPE[delivery_pack_slug]

    if target_id.startswith(_PRINTABLE_TARGET_PREFIXES):
        return DeliveryType.PRINTABLE
    if target_id.startswith(_SOCIAL_TARGET_PREFIXES):
        return DeliveryType.SOCIAL
    if target_id.startswith(_WALLPAPER_TARGET_PREFIXES):
        return DeliveryType.WALLPAPER

    raise UnsupportedDeliveryType(
        f"Cannot classify target '{target_id}' (pack slug: {delivery_pack_slug!r}) into a known delivery type."
    )
