"""
`LoveStoryTimelineRenderer` — the product-specific implementation of
`apps.delivery.renderers.ProductRenderer` for Love Story Timeline.
Registered against the product slug `"love-story-timeline"` in
`apps/delivery/registry.py`.

This is the only place that combines the generic delivery contract
(`project`, `delivery_type`, `delivery_pack`, `target_id`) with Love
Story Timeline's own data validation and format-specific renderers —
no branch anywhere in `apps/delivery/services.py` or `registry.py`
knows this product exists.
"""

from __future__ import annotations

from apps.common.exceptions.api_errors import LoveStoryTimelineRenderFailed
from apps.delivery.delivery_types import DeliveryType
from apps.delivery.renderers import DeliveryResult, TemporaryFileResult

from apps.delivery.ar_support import CARD_TARGET_ID
from apps.delivery.wallpaper_devices import parse_moment_target

from .data import validate_and_normalize
from .html_renderer import render_html
from .png_renderer import TARGET_DIMENSIONS, render_png

_RASTER_DELIVERY_TYPES = {DeliveryType.PRINTABLE, DeliveryType.SOCIAL, DeliveryType.WALLPAPER}


class LoveStoryTimelineRenderer:
    def render(
        self, project, delivery_type: str, delivery_pack, target_id: str, locale: str = "en"
    ) -> DeliveryResult:
        if project is None:
            # An Order can exist without a Project (Phase 3.4 Rule 18),
            # but there is nothing to render without one — a project
            # is what actually holds partner1/partner2/events/etc.
            raise LoveStoryTimelineRenderFailed(
                "This order has no associated project — there is nothing to render."
            )

        timeline = validate_and_normalize(
            project.data.get("values", {}), project.data.get("themeSelections", {})
        )
        customer = project.customer  # existing, already-ownership-verified relationship (Project.customer FK)

        # §21i — an AR entitlement delivers the printed CARD.
        #
        # Routed before the raster branch because the card is neither a
        # print size nor a device: its dimensions come from the card model,
        # and the target id `ar-card` is a SURFACE while the artwork target
        # is a render. Keeping them distinct is what lets a product offer
        # more than one card behind one surface.
        if delivery_type == DeliveryType.AR:
            content = render_png(timeline, target_id=CARD_TARGET_ID, customer=customer, locale=locale)
            return TemporaryFileResult(
                content=content, content_type="image/png", filename="ar-card.png"
            )

        if delivery_type in _RASTER_DELIVERY_TYPES:
            # §13 — per-milestone wallpapers (`wallpaper-phone-moment-3`)
            # are resolved from the story at delivery time, so they are
            # deliberately absent from the static `TARGET_DIMENSIONS` map.
            # `render_png` already handles them (it checks
            # `parse_moment_target` before consulting TARGET_DIMENSIONS),
            # but this guard did not, so every moment wallpaper was
            # rejected here and logged as `moment_wallpaper_failed` before
            # the renderer that supports them was ever called.
            if target_id not in TARGET_DIMENSIONS and parse_moment_target(target_id) is None:
                raise LoveStoryTimelineRenderFailed(
                    f"'{target_id}' is not a supported Love Story Timeline export target."
                )
            content = render_png(timeline, target_id=target_id, customer=customer, locale=locale)
            return TemporaryFileResult(content=content, content_type="image/png", filename=f"{target_id}.png")

        if delivery_type == DeliveryType.DIGITAL:
            content = render_html(timeline, customer=customer, locale=locale)
            # A real hosted/shareable URL requires the future public
            # gift-page architecture (explicitly deferred — see the
            # README). For now the generated HTML experience itself is
            # the delivered artifact, returned the same way the raster
            # outputs are — a temporary file, not a permanent link.
            return TemporaryFileResult(content=content, content_type="text/html", filename="gift.html")

        raise LoveStoryTimelineRenderFailed(f"Delivery type '{delivery_type}' is not supported yet.")

    def preview(self, project) -> DeliveryResult:
        """Reserved for the future Live Preview architecture (see
        apps/delivery/renderers.py's module docstring) — not called by
        anything in Phase 3.9. Implemented as a thin, honest wrapper
        around the digital HTML renderer (the closest existing analog
        to "show me what this looks like") rather than left entirely
        unimplemented, since it costs nothing extra and keeps the
        interface genuinely usable if something calls it early.
        """
        if project is None:
            raise LoveStoryTimelineRenderFailed("Nothing to preview — no project.")
        timeline = validate_and_normalize(
            project.data.get("values", {}), project.data.get("themeSelections", {})
        )
        content = render_html(timeline, customer=project.customer)
        return TemporaryFileResult(content=content, content_type="text/html", filename="preview.html")

    def validate_project_data(self, values, theme_selections) -> None:
        """Optional hook `apps.commerce.services.create_order` calls
        before an order can be created, so a project that would fail
        here at delivery time (e.g. a milestone photo saved without an
        uploaded `assetId`) is rejected before any payment step instead
        of after. Deliberately the exact same call `render()` above
        makes — there is no separate "is this orderable" rule, only
        "is this renderable", checked earlier.
        """
        validate_and_normalize(values, theme_selections)
