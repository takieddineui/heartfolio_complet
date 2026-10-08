"""
Product/DeliveryPack catalog service functions.
"""

from __future__ import annotations

from apps.common.exceptions.api_errors import ProductNotFound

from .models import DeliveryPack, Product


def list_available_products():
    """Public catalog listing — only `available` products, per the
    "only expose active products/packs through public catalog
    endpoints" rule. `waitlist`/`coming_soon`/`disabled` products are
    real rows (the frontend's product registry references them by
    slug), just not publicly listed yet.
    """
    return Product.objects.filter(status=Product.STATUS_AVAILABLE).order_by("order", "slug")


def get_product_by_slug(slug: str) -> Product:
    """Resolves a product by its public slug identifier — the only
    identifier the frontend ever sends. Any status; used by
    project/order creation, which only needs the product to exist, not
    necessarily be publicly catalog-visible.
    """
    try:
        return Product.objects.get(slug=slug)
    except Product.DoesNotExist as exc:
        raise ProductNotFound() from exc


def get_available_product_by_slug(slug: str) -> Product:
    """Like `get_product_by_slug`, but for the public catalog detail
    endpoint: a non-available product is reported as not-found rather
    than distinguishing "doesn't exist" from "not public yet", so the
    catalog endpoint doesn't leak the existence of unlisted products.
    """
    product = get_product_by_slug(slug)
    if product.status != Product.STATUS_AVAILABLE:
        raise ProductNotFound()
    return product


def list_active_delivery_packs_for_product(product: Product):
    return (
        product.delivery_packs.filter(status=DeliveryPack.STATUS_ACTIVE)
        .select_related("product")
        .order_by("slug")
    )
