"""
Delivery service layer: answers "what is this customer entitled to
receive, and what does receiving it produce." Reuses existing
infrastructure rather than duplicating it —
`apps.customers.services.get_current_customer` for session resolution
(called by the view, not re-implemented here), and `Order.status`
(Phase 3.4/3.7) as the sole source of "is this paid" truth.
"""

from __future__ import annotations

from typing import Iterator

from django.conf import settings

from apps.commerce.order_access import verify_order_access_token
from apps.commerce.models import Entitlement, Order

from .delivery_types import LIVE_TARGET_SENTINEL, infer_delivery_type
from .models import PublicExperience
from .registry import get_renderer
from .renderers import DeliveryResult, DigitalDeliveryResult

from apps.common.exceptions.api_errors import (
    EntitlementAccessDenied,
    EntitlementNotFound,
    OrderNotFound,
    RendererNotAvailable,
)


def get_entitlement_for_customer(customer, entitlement_id) -> Entitlement:
    """Ownership + validity check in one place, mirroring the identical
    pattern used for projects/orders/assets in earlier phases.

    `Entitlement` has no direct `customer` field — ownership is always
    through `entitlement.order.customer`, so that's what's checked
    here rather than duplicating a second ownership concept.

    An entitlement whose order is not (or is no longer) `paid` is
    treated as not-found (404), same as a genuinely missing row. In
    practice this can't currently happen through the normal purchase
    flow — `grant_entitlements` (Phase 3.4/3.7) is only ever called
    strictly after `Order.STATUS_PAID` is set, in the same atomic
    transaction — but this is still checked explicitly as a defensive
    guarantee rather than an assumption baked silently into the
    absence of a check.
    """
    try:
        entitlement = (
            Entitlement.objects.select_related(
                "order",
                "order__customer",
                "order__product",
                "order__delivery_pack",
                "order__project",
                "order__project__customer",
            )
            .get(id=entitlement_id)
        )
    except (Entitlement.DoesNotExist, ValueError, TypeError):
        raise EntitlementNotFound()

    if entitlement.order.customer_id != customer.id:
        raise EntitlementAccessDenied()

    if entitlement.order.status != Order.STATUS_PAID:
        raise EntitlementNotFound()

    return entitlement


def get_entitlement_by_order_token(entitlement_id, token: str) -> Entitlement:
    """Entitlement access via a magic-link token (§12).

    Same checks as the session path, with ownership proved by the token
    instead of a cookie: the token must be valid *for the order this
    entitlement belongs to*. A token for a different order fails, so a
    forwarded receipt cannot be used to fish for other people's files.

    Every failure returns `EntitlementNotFound` — bad token, wrong order,
    unpaid order, missing row. A stranger probing ids learns nothing about
    which of those it was.
    """
    try:
        entitlement = (
            Entitlement.objects.select_related(
                "order",
                "order__customer",
                "order__product",
                "order__delivery_pack",
                "order__project",
                "order__project__customer",
            )
            .get(id=entitlement_id)
        )
    except (Entitlement.DoesNotExist, ValueError, TypeError):
        raise EntitlementNotFound()

    if not verify_order_access_token(token, order_id=entitlement.order_id):
        raise EntitlementNotFound()

    if entitlement.order.status != Order.STATUS_PAID:
        raise EntitlementNotFound()

    return entitlement


def get_paid_order_by_access_token(order_id, token: str):
    """The whole-pack download, via a magic-link token. Mirrors
    `get_paid_order_for_delivery`, with the token standing in for the
    session."""
    if not verify_order_access_token(token, order_id=order_id):
        raise OrderNotFound()

    try:
        order = Order.objects.select_related("product", "delivery_pack", "project").get(id=order_id)
    except (Order.DoesNotExist, ValueError, TypeError):
        raise OrderNotFound()

    if order.status != Order.STATUS_PAID:
        raise OrderNotFound()

    return order


def get_delivery_for_entitlement(entitlement: Entitlement) -> DeliveryResult:
    """Resolves the correct renderer and produces the delivery result.

    `entitlement.order.project.data` (opaque `values`/`themeSelections`)
    is handed to the renderer completely unchanged — this function
    never reads or interprets it. `entitlement.order.project` may be
    `None` (an order can exist without a project); it's passed through
    as-is and it's the renderer's job to decide what to do with that,
    not this generic layer's.

    THE DIGITAL TARGET SHORT-CIRCUITS BEFORE THE RENDERER. §10's Digital
    keepsake is a hosted page (`/live/<experience id>`), not a file: the
    milestone video and audio it needs cannot be embedded, so the
    self-contained HTML the renderer still produces is the older design.
    Returning that file meant the customer downloaded `gift.html` while
    the real hosted page — already provisioned by `grant_entitlements`
    and already served by `LiveExperienceView` — was never linked.

    This is resolved here rather than inside the renderer because the
    URL depends on the `PublicExperience` row, and `render()` is given
    only the project, pack, target and locale. It has no entitlement,
    and so no way to know which link to build.
    """
    order = entitlement.order

    if entitlement.target_id == LIVE_TARGET_SENTINEL:
        experience = getattr(entitlement, "public_experience", None)
        if experience is None or experience.status != PublicExperience.STATUS_ACTIVE:
            # Provisioning failed, or the link was revoked. Falling back
            # to the downloadable file would quietly hand over a
            # different product than the one that was bought.
            raise RendererNotAvailable(
                "The live keepsake for this entitlement is not available."
            )
        return DigitalDeliveryResult(
            url=f"{settings.FRONTEND_URL}/{order.locale}/live/{experience.id}"
        )

    delivery_type = infer_delivery_type(
        target_id=entitlement.target_id,
        delivery_pack_slug=order.delivery_pack.slug if order.delivery_pack_id else None,
    )
    renderer = get_renderer(order.product.slug, delivery_type)
    return renderer.render(
        order.project,
        delivery_type,
        order.delivery_pack,
        entitlement.target_id,
        # Recorded at checkout, not read from the current request — a
        # re-download months later in a different browser language must
        # return the same artifact the customer originally bought.
        order.locale,
    )

def get_paid_order_for_delivery(customer, order_id) -> Order:
    """Ownership + paid check for a whole-pack delivery.

    Deliberately mirrors `get_entitlement_for_customer` rather than
    inventing a second authorization concept: ownership is checked by
    the existing `get_order_for_customer` (which raises OrderNotFound /
    OrderAccessDenied), and an order that is not `paid` is then
    reported as *not found* — never as "exists but unpaid" — so this
    endpoint cannot be used to probe which order ids exist or which
    have been paid.
    """
    from apps.commerce.services import get_order_for_customer

    order = get_order_for_customer(customer, order_id)

    if order.status != Order.STATUS_PAID:
        raise OrderNotFound()

    return order


def pack_has_archivable_entitlements(order) -> bool:
    """Whether the paid pack grants anything beyond the digital
    (`__live__`) entitlement — answerable without rendering anything, so
    `OrderPackDownloadView` can raise its "nothing archivable" error
    before it starts streaming a response. Once a `StreamingHttpResponse`
    has yielded even one chunk, the status code is already committed to
    the client and can no longer become a 501.

    Mirrors the real rule (`isinstance(result, TemporaryFileResult)`
    after render) rather than approximating it independently: the only
    delivery type that ever resolves to a URL instead of bytes is
    DIGITAL, and `__live__` is the only target_id that maps to it (see
    `delivery_types.infer_delivery_type`) — so an order with any other
    target_id is guaranteed to produce at least one real file, and an
    order with only `__live__` is guaranteed to produce none.

    Raises `EntitlementNotFound` for an order with no entitlements at
    all — same as `get_pack_deliveries_for_order` — rather than treating
    that as "nothing archivable" too; those are different customer-facing
    errors (404 vs. 501) and the caller relies on that distinction.
    """
    target_ids = list(Entitlement.objects.filter(order=order).values_list("target_id", flat=True))
    if not target_ids:
        raise EntitlementNotFound()
    return any(target_id != LIVE_TARGET_SENTINEL for target_id in target_ids)


def get_pack_deliveries_for_order(order) -> Iterator[tuple[Entitlement, DeliveryResult]]:
    """Every deliverable the paid pack grants, rendered on demand, one at
    a time.

    One entitlement per `DeliveryPack.included_targets` entry already
    exists (`grant_entitlements`); this simply renders each of them
    through the same `get_delivery_for_entitlement` path a single-file
    download uses. No new rendering, no new authorization, and nothing
    is persisted.

    A GENERATOR, not a list: a Complete pack's renders are large (a
    poster-sized canvas plus its source photos can run to hundreds of MB
    transiently — see PROJECT-STATE.md's download-memory measurement),
    and the eager `list` this used to build held every one of them at
    once before the caller could write or discard any of them. Every
    current caller (the four download views in views.py) already writes
    each `(entitlement, result)` to a zip and moves on without needing a
    second pass, so laziness costs them nothing.

    Ordered by `target_id` so the same purchase always produces the
    same archive contents in the same order.

    Raises `EntitlementNotFound` on the FIRST call to `next()`, not when
    this function is called — nothing here runs until the caller starts
    iterating, since the whole body is a generator.
    """
    entitlements = (
        Entitlement.objects.filter(order=order)
        .select_related("order", "order__product", "order__delivery_pack", "order__project")
        .order_by("target_id")
    )

    if not entitlements:
        raise EntitlementNotFound()

    for entitlement in entitlements:
        yield (entitlement, get_delivery_for_entitlement(entitlement))
