"""
`GraduationKeepsakeRenderer` — registered against `"graduation-keepsake"` in
`apps/delivery/registry.py`, and a renderer IN NAME ONLY, exactly like
`ReasonsILoveYouRenderer` (read that module's docstring for the reasoning).

Live-only: no print, no wallpaper, no file. The registry is the one place
`apps.commerce.services` finds a product's pre-payment check
(`validate_project_data`); `render()` is never reached for a real order,
because this product's only pack grants `__live__`, which delivery answers
with the hosted page before looking up a renderer.
"""

from __future__ import annotations

from apps.common.exceptions.api_errors import RendererNotAvailable
from apps.delivery.renderers import DeliveryResult

from .data import validate_and_normalize


class GraduationKeepsakeRenderer:
    def render(
        self, project, delivery_type: str, delivery_pack, target_id: str, locale: str = "en"
    ) -> DeliveryResult:
        raise RendererNotAvailable(
            f"Graduation Keepsake is live-only; it has no '{target_id}' output to render."
        )

    def preview(self, project) -> DeliveryResult:
        raise RendererNotAvailable("Graduation Keepsake is previewed in the Studio, not rendered by the backend.")

    def validate_project_data(self, values, theme_selections) -> None:
        """The pre-payment check. The same validation the live page runs."""
        validate_and_normalize(values, theme_selections)
