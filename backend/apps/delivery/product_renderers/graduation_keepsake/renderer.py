"""
`GraduationKeepsakeRenderer` — the `ProductRenderer` for Graduation Keepsake,
registered against the product slug `"graduation-keepsake"` in
`apps/delivery/registry.py`.

THIS PRODUCT HAS NO PRINT, YET. Its only deliverable is the hosted live page,
reached through the `__live__` target — and `apps/delivery/services.py`
short-circuits `__live__` to the live URL before any renderer is asked for
anything. So `render()` has no real work to do: it is reached only for a
non-live target, which no pack grants today, and it says so loudly rather
than fabricating output. When a printable pack arrives, the print renderer
goes here, with its own `TARGET_DIMENSIONS`, and `supported_targets` in
`seed_catalog.py` and `apps/products/admin.py` grow to match.

What this class IS for today is `validate_project_data`: the gate
`create_order` calls before any payment step, so a project the live page
could not serve is rejected while the customer can still fix it, not after
they have paid.
"""

from __future__ import annotations

from apps.common.exceptions.api_errors import GraduationKeepsakeRenderFailed
from apps.delivery.renderers import DeliveryResult

from .data import validate_and_normalize


class GraduationKeepsakeRenderer:
    def render(
        self, project, delivery_type: str, delivery_pack, target_id: str, locale: str = "en"
    ) -> DeliveryResult:
        raise GraduationKeepsakeRenderFailed(
            f"Graduation Keepsake has no file output for target '{target_id}' — "
            "its only deliverable is the hosted live page."
        )

    def preview(self, project) -> DeliveryResult:
        raise GraduationKeepsakeRenderFailed("Preview is not implemented for Graduation Keepsake.")

    def validate_project_data(self, values, theme_selections) -> None:
        """Optional hook `apps.commerce.services.create_order` calls before an
        order can be created — see `SongPosterRenderer.validate_project_data`."""
        validate_and_normalize(values, theme_selections)
