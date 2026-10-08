"""
Product -> renderer registry/factory.

Nothing outside this module should ever write
`if product_slug == "love-story-timeline": ...` — a real product
renderer is registered here once it exists. As of Phase 3.9, exactly
one is: Love Story Timeline (see
`apps/delivery/product_renderers/love_story_timeline/`).

`apps/delivery/services.py` and everything above it only ever calls
`get_renderer()` — it has no knowledge of which products have real
renderers registered.
"""

from __future__ import annotations

from .product_renderers.love_story_timeline.renderer import LoveStoryTimelineRenderer
from .product_renderers.song_poster.renderer import SongPosterRenderer
from .product_renderers.where_we_met_map.renderer import WhereWeMetMapRenderer
from .renderers import NotImplementedRenderer, ProductRenderer

# Real product slugs (not module folder names — "where-we-met-map" is
# the frontend's internal module directory naming, but the actual
# catalog/database product slug is "heart-map"; see
# apps/delivery/product_renderers/where_we_met_map/data.py's docstring).
_REGISTRY: dict[str, ProductRenderer] = {
    "love-story-timeline": LoveStoryTimelineRenderer(),
    "heart-map": WhereWeMetMapRenderer(),
    # Registered, matching the frontend's own `productModuleRegistry`
    # entry — inert until a real `Product`/`DeliveryPack` row exists in
    # `seed_catalog.py`. No order can reference this slug before then,
    # so registering the renderer changes nothing customer-visible; it
    # is what makes the slug resolvable the moment that catalog entry
    # is deliberately created.
    "song-poster": SongPosterRenderer(),
}


def get_renderer(product_slug: str, delivery_type: str) -> ProductRenderer:
    renderer = _REGISTRY.get(product_slug)
    if renderer is not None:
        return renderer
    return NotImplementedRenderer(product_slug, delivery_type)
