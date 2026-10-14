"""
Renderer abstraction connecting a `Project` to a delivered output.

No actual product-specific rendering is implemented in this phase —
see `registry.py`, which is what every product currently resolves to
(`NotImplementedRenderer`, below). Real renderers (Moon Phase, Love
Story Timeline, ...) are registered there in a later phase without
changing this interface.

Designed so a future Live Preview feature can reuse the exact same
registered renderer this phase wires up for paid delivery: `render()`
is the only method Phase 3.8 calls end-to-end, but `preview()` is part
of the interface now so it doesn't need to change shape later (see the
README's "Live Preview compatibility" section). Nothing in Phase 3.8
calls `preview()` — it exists purely so the interface is ready.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, Union

from apps.common.exceptions.api_errors import RendererNotAvailable


@dataclass(frozen=True)
class TemporaryFileResult:
    """A short-lived, in-memory output. Never persisted to R2, never
    written to any database table or the filesystem by this layer —
    "temporary" here means "exists only for the duration of this HTTP
    response," not "written somewhere and cleaned up later." See the
    README's "Temporary output strategy" section for how this could
    grow into a real ephemeral-object-store result later without this
    dataclass needing to change.
    """

    content: bytes
    content_type: str
    filename: str


@dataclass(frozen=True)
class DigitalDeliveryResult:
    """A hosted, shareable Digital Product experience URL. Building the
    actual hosted gift page is explicitly a future phase (see the
    README) — this dataclass is just the shape a real Digital renderer
    will eventually return.
    """

    url: str


DeliveryResult = Union[TemporaryFileResult, DigitalDeliveryResult]


class ProductRenderer(Protocol):
    """What a future product-specific renderer implements.

    Phase 3.9 addition: `target_id` was added to `render()` — Phase 3.8
    only passed the coarse `delivery_type` (e.g. `"social"`), but that's
    not enough to render correctly. Inspecting the real Love Story
    Timeline catalog showed multiple distinct targets share one
    `DeliveryType` with different dimensions (`"story-png"` 1080x1920
    vs `"square-png"` 1080x1080, both `SOCIAL`) — a renderer needs to
    know exactly which target it's producing, not just its category.
    This is an additive, backward-compatible-in-spirit change (new
    required parameter, not a removed one); every existing call site
    and test double was updated alongside it — see the Phase 3.9
    report.
    """

    def render(
        self, project, delivery_type: str, delivery_pack, target_id: str, locale: str = "en"
    ) -> DeliveryResult:
        """`project` may be `None` — an `Order` can exist without a
        `Project` (Phase 3.4 Rule 18: `Order.project` is nullable).
        `locale` is the language the order was placed in, recorded on
        `Order.locale` at checkout. It is passed to every renderer rather
        than only the HTML one because any renderer producing text or
        markup needs it, and defaulted so a renderer that has no use for
        it can ignore the argument entirely.

        Every real renderer will need to decide how to handle that
        case; this phase doesn't need to, since no renderer is
        implemented yet (see `NotImplementedRenderer`, which raises
        before ever touching `project`).
        """
        ...

    def preview(self, project) -> DeliveryResult:
        """Reserved for the future Live Preview architecture — not
        called by anything in Phase 3.8/3.9.
        """
        ...

    # `validate_project_data(self, values, theme_selections) -> None` is
    # an OPTIONAL, deliberately un-Protocol-declared method: a renderer
    # implements it only if it wants `apps.commerce.services.create_order`
    # to reject a project it would refuse to render, before any payment
    # step. `create_order` looks it up with `getattr(renderer,
    # "validate_project_data", None)` rather than requiring it here, so
    # a renderer that doesn't define one (including `NotImplementedRenderer`
    # below) is simply not checked — see that renderer's own docstring for
    # which products this currently covers.


class NotImplementedRenderer:
    """What every product without a registered renderer resolves to
    (as of this phase: Star Map). Always raises a structured
    application error; never fabricates output.

    Deliberately has no `validate_project_data` — an order for a product
    with no renderer at all is undeliverable for every target except
    `__live__` (`render()` here always raises, and only `__live__` is
    answered before a renderer is consulted), so there is nothing an
    order-creation check could add; the gap is that no product-data
    validation happens for this product at any point, not specifically at
    order creation. That `__live__` exception is why a LIVE-ONLY product
    must still be registered (see `ReasonsILoveYouRenderer`): otherwise it
    would land here, be sold, and never be validated.
    """

    def __init__(self, product_slug: str, delivery_type: str):
        self.product_slug = product_slug
        self.delivery_type = delivery_type

    def render(
        self, project, delivery_type: str, delivery_pack, target_id: str, locale: str = "en"
    ) -> DeliveryResult:
        raise RendererNotAvailable(
            f"No renderer is implemented yet for product '{self.product_slug}' "
            f"and delivery type '{self.delivery_type}'."
        )

    def preview(self, project) -> DeliveryResult:
        raise RendererNotAvailable(f"No preview renderer is implemented yet for product '{self.product_slug}'.")
