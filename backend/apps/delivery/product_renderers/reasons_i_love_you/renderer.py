"""
`ReasonsILoveYouRenderer` — registered against `"reasons-i-love-you"` in
`apps/delivery/registry.py`, and a renderer IN NAME ONLY.

This is the first live-only product: there is no print, no wallpaper and no
file, so there is nothing to render. It is registered anyway because the
registry is the one place `apps.commerce.services` looks for a product's
pre-payment check (`validate_project_data`, an optional hook). Without an
entry, a malformed project would be accepted and paid for, then fail on the
live page.

`render()` is never reached for a real order: this product's only pack grants
`__live__`, and `apps.delivery.services.get_delivery_for_entitlement` answers
that target with the hosted page's URL BEFORE looking up a renderer. A
`render()` call can only mean a pack was given a target this product cannot
produce, so it fails loudly rather than returning something.
"""

from __future__ import annotations

from apps.common.exceptions.api_errors import RendererNotAvailable
from apps.delivery.renderers import DeliveryResult

from .data import validate_and_normalize


class ReasonsILoveYouRenderer:
    def render(
        self, project, delivery_type: str, delivery_pack, target_id: str, locale: str = "en"
    ) -> DeliveryResult:
        raise RendererNotAvailable(
            f"Reasons I Love You is live-only; it has no '{target_id}' output to render."
        )

    def preview(self, project) -> DeliveryResult:
        raise RendererNotAvailable("Reasons I Love You is previewed in the Studio, not rendered by the backend.")

    def validate_project_data(self, values, theme_selections) -> None:
        """The pre-payment check (see the module docstring for why this class
        exists at all). The same validation the live page runs."""
        validate_and_normalize(values, theme_selections)
