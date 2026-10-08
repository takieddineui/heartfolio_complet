"""
`SongPosterRenderer` — the product-specific implementation of
`apps.delivery.renderers.ProductRenderer` for Song Poster. Registered
against the product slug `"song-poster"` in `apps/delivery/registry.py`.

Same shape as `LoveStoryTimelineRenderer`, deliberately: one place that
combines the generic delivery contract (`project`, `delivery_type`,
`delivery_pack`, `target_id`) with this product's own validation and
raster renderer — no branch anywhere in `apps/delivery/services.py` or
`registry.py` knows this product exists.

NO `DeliveryType.DIGITAL` BRANCH, unlike Love Story Timeline. Song
Poster's "digital" experience is the live, interactive Player component
itself — a real invisible YouTube player the customer already sees and
uses in the Studio (`player-theme.tsx`, `use-youtube-player.ts`) — not
a server-rendered HTML page. There is nothing for this backend renderer
to generate for that case; a request for it fails loudly below rather
than silently returning something.
"""

from __future__ import annotations

from apps.common.exceptions.api_errors import SongPosterRenderFailed
from apps.delivery.delivery_types import DeliveryType
from apps.delivery.renderers import DeliveryResult, TemporaryFileResult

from .data import validate_and_normalize
from .png_renderer import render_png

_RASTER_DELIVERY_TYPES = {DeliveryType.PRINTABLE, DeliveryType.WALLPAPER}


class SongPosterRenderer:
    def render(
        self, project, delivery_type: str, delivery_pack, target_id: str, locale: str = "en"
    ) -> DeliveryResult:
        if project is None:
            raise SongPosterRenderFailed(
                "This order has no associated project — there is nothing to render."
            )

        song = validate_and_normalize(
            project.data.get("values", {}), project.data.get("themeSelections", {})
        )
        customer = project.customer  # existing, already-ownership-verified relationship

        if delivery_type in _RASTER_DELIVERY_TYPES:
            content = render_png(song, target_id=target_id, customer=customer)
            return TemporaryFileResult(content=content, content_type="image/png", filename=f"{target_id}.png")

        raise SongPosterRenderFailed(f"Delivery type '{delivery_type}' is not supported for Song Poster.")

    def preview(self, project) -> DeliveryResult:
        """Reserved, matching `LoveStoryTimelineRenderer.preview`'s own
        note — nothing in the current delivery flow calls this. Left
        genuinely unimplemented rather than given a fake HTML wrapper:
        Song Poster has no server-rendered "digital" artifact the way
        Love Story Timeline's `render_html` is one — its live preview
        already exists, client-side, in the Studio itself."""
        raise SongPosterRenderFailed("Preview is not implemented for Song Poster.")

    def validate_project_data(self, values, theme_selections) -> None:
        """Optional hook `apps.commerce.services.create_order` calls
        before an order can be created — see
        `LoveStoryTimelineRenderer.validate_project_data`'s docstring
        for why this is the same call `render()` makes, just earlier.
        """
        validate_and_normalize(values, theme_selections)
