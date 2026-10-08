"""
Public, read-only product catalog endpoints. No authentication/session
required — anyone can browse the catalog.
"""

from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.feedback.published import published_reviews, rating_summary

from .models import Occasion, PrintSize
from .serializers import (
    DeliveryPackSerializer,
    OccasionSerializer,
    PrintSizeSerializer,
    ProductSerializer,
)
from .services import get_available_product_by_slug, list_active_delivery_packs_for_product, list_available_products


class ProductListView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        """The catalog, plus the taxonomy the storefront needs to render it.

        §7d — occasions and print sizes are now editable entities, and every
        page that needs them already fetches this endpoint. Returning them
        here costs one round trip instead of a second request per render.

        SHAPE CHANGE, AND WHY IT IS SAFE. This used to return a bare array.
        The frontend and backend deploy independently (they were separate
        hosts, Vercel and Railway, when this was written; the two images
        still ship separately), so one will be ahead of the other for a few minutes — and a
        storefront that returns no products during that window is a real
        outage. The frontend therefore accepts BOTH shapes: an array, as
        before, or this object. That tolerance is what makes the change
        deployable in either order, and it can be removed once both sides
        have been live for a while.
        """
        products = list_available_products()
        return Response(
            {
                "products": ProductSerializer(products, many=True).data,
                "occasions": OccasionSerializer(
                    Occasion.objects.filter(is_active=True), many=True
                ).data,
                "printSizes": PrintSizeSerializer(
                    PrintSize.objects.filter(is_active=True), many=True
                ).data,
                # §7c — published reviews ACROSS EVERY PRODUCT. Only ever
                # `is_published=True`; nothing here can make one public.
                #
                # NO SLUG IS PASSED, UNLIKE `ProductDetailView` below. This
                # block was copied from there, `product.slug` and all — but
                # this is the catalog LIST, where the local name is
                # `products` and no single `product` exists. Every request
                # to this endpoint raised `NameError` and returned 500. It
                # went unnoticed because the product *detail* endpoint,
                # which the Studio and checkout actually call, has a real
                # `product` and works.
                #
                # Site-wide is the right scope here, not merely a way to
                # make the name error go away: `published_reviews()`
                # documents its no-argument form as "reviews across
                # everything, which is what the homepage shows", and this
                # endpoint feeds the catalog and homepage — pages about no
                # product in particular.
                "reviews": [
                    {
                        "id": review.id,
                        "rating": review.rating,
                        "message": review.message,
                        "displayName": review.display_name,
                        "createdAt": review.created_at,
                    }
                    for review in published_reviews()
                ],
                # None when nothing is published, which is what stops an
                # empty AggregateRating reaching Google.
                "ratingSummary": (
                    {"average": summary.average, "count": summary.count}
                    if (summary := rating_summary())
                    else None
                ),
            }
        )


class ProductDetailView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, slug):
        product = get_available_product_by_slug(slug)
        delivery_packs = list_active_delivery_packs_for_product(product)
        return Response(
            {
                "product": ProductSerializer(product).data,
                "deliveryPacks": DeliveryPackSerializer(delivery_packs, many=True).data,
                # §7d — the product page lists print sizes, and it reads this
                # endpoint rather than the list. Without them here, sizes
                # would be editable in the dashboard and ignored by the site,
                # which is worse than not making them editable at all.
                "printSizes": PrintSizeSerializer(
                    PrintSize.objects.filter(is_active=True), many=True
                ).data,
                # §7c — published reviews for this product. Only ever
                # `is_published=True`; nothing here can make one public.
                "reviews": [
                    {
                        "id": review.id,
                        "rating": review.rating,
                        "message": review.message,
                        "displayName": review.display_name,
                        "createdAt": review.created_at,
                    }
                    for review in published_reviews(product.slug)
                ],
                # None when nothing is published, which is what stops an
                # empty AggregateRating reaching Google.
                "ratingSummary": (
                    {"average": summary.average, "count": summary.count}
                    if (summary := rating_summary(product.slug))
                    else None
                ),
            }
        )
