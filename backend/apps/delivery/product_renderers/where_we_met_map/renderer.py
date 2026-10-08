"""
`WhereWeMetMapRenderer` — the product-specific implementation of
`apps.delivery.renderers.ProductRenderer` for Where We Met Map.
Registered against the real product slug `"heart-map"` (not
`"where-we-met-map"` — see data.py's module docstring) in
`apps/delivery/registry.py`.

Unlike Love Story Timeline, this product's real export catalog
(exports.ts) has no `__live__`/digital target at all — only four PNG
targets. `render()` therefore only ever dispatches to `render_png`;
there is no digital branch to build.
"""

from __future__ import annotations

from apps.common.exceptions.api_errors import WhereWeMetMapRenderFailed
from apps.delivery.delivery_types import DeliveryType
from apps.delivery.renderers import DeliveryResult, TemporaryFileResult

from .data import validate_and_normalize
from .png_renderer import TARGET_DIMENSIONS, render_png

_RASTER_DELIVERY_TYPES = {DeliveryType.PRINTABLE, DeliveryType.SOCIAL, DeliveryType.WALLPAPER}


class WhereWeMetMapRenderer:
    def render(
        self, project, delivery_type: str, delivery_pack, target_id: str, locale: str = "en"
    ) -> DeliveryResult:
        if project is None:
            raise WhereWeMetMapRenderFailed(
                "This order has no associated project — there is nothing to render."
            )

        map_data = validate_and_normalize(
            project.data.get("values", {}), project.data.get("themeSelections", {})
        )
        customer = project.customer  # existing, already-ownership-verified relationship (Project.customer FK)

        if delivery_type in _RASTER_DELIVERY_TYPES:
            if target_id not in TARGET_DIMENSIONS:
                raise WhereWeMetMapRenderFailed(
                    f"'{target_id}' is not a supported Where We Met Map export target."
                )
            content = render_png(map_data, target_id=target_id, customer=customer)
            return TemporaryFileResult(content=content, content_type="image/png", filename=f"{target_id}.png")

        # No digital/__live__ target exists in the real catalog for
        # this product — see the module docstring.
        raise WhereWeMetMapRenderFailed(f"Delivery type '{delivery_type}' is not supported for this product.")

    def preview(self, project) -> DeliveryResult:
        """Reserved for the future Live Preview architecture (see
        apps/delivery/renderers.py's module docstring) — not called by
        anything in Phase 3.9/3.10/3.11. No digital/HTML output exists
        for this product to reuse as a preview medium (unlike Love
        Story Timeline's `preview()`), so this intentionally raises
        rather than fabricating one.
        """
        raise WhereWeMetMapRenderFailed("Preview rendering is not implemented for this product.")

    def validate_project_data(self, values, theme_selections) -> None:
        """Optional hook `apps.commerce.services.create_order` calls
        before an order can be created — see
        `LoveStoryTimelineRenderer.validate_project_data`'s docstring
        for why this is the same call `render()` makes, just earlier.
        """
        validate_and_normalize(values, theme_selections)
