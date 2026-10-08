"""
Public catalog serializers. Read-only — this is not a CRUD surface, and
there is no admin/authoring API for products in this phase.

Field naming was checked directly against the frontend's real
TypeScript contracts (Phase 3.6):

- `ProductEntry.i18nKey` (src/lib/products/types.ts) — not
  `nameI18nKey`. Fixed below.
- `ProductEntry.startingPrice` is a pre-formatted display string
  (e.g. `"$12"`), not cents. This backend deliberately keeps exposing
  `startingPriceCents` (a raw integer, matching the approved
  `starting_price_cents` column) instead — baking currency/locale
  formatting into the backend would invent presentation logic the
  approved schema was never meant to own, and no locale/currency
  context exists server-side to do it correctly. Left as a documented
  deviation, not silently "fixed" to match.
- `ProductEntry.thumbnail` / `.icon` / `.featured` / `.badgeKey` are
  not exposed. They have no corresponding column in the approved
  8-table schema; adding them would be a schema change, which this
  phase must not make. This file's own header comment ("mirrored from
  the Marketing App") suggests these are presentational/CMS fields
  outside this backend's transactional-catalog responsibility, not an
  oversight — flagged for confirmation rather than invented.
- `DeliveryPack.nameKey` / `.descriptionKey` (src/types/commerce.ts) —
  not `nameI18nKey`/`descriptionI18nKey`. Fixed below.
- `DeliveryPack.productId` — added below for direct structural parity,
  even though the product is already identified once at the parent
  `product.slug` level in the detail response.
"""

from rest_framework import serializers

from .models import DeliveryPack, Occasion, PrintSize, Product


class DeliveryPackSerializer(serializers.ModelSerializer):
    productId = serializers.CharField(source="product.slug")
    nameKey = serializers.CharField(source="name_i18n_key")
    descriptionKey = serializers.CharField(source="description_i18n_key")
    priceCents = serializers.IntegerField(source="price_cents")
    includedTargets = serializers.JSONField(source="included_targets")

    class Meta:
        model = DeliveryPack
        fields = [
            "id",
            "productId",
            "slug",
            "nameKey",
            "descriptionKey",
            "priceCents",
            "currency",
            "includedTargets",
            "status",
        ]
        read_only_fields = fields


class ProductSerializer(serializers.ModelSerializer):
    i18nKey = serializers.CharField(source="name_i18n_key")
    startingPriceCents = serializers.IntegerField(source="starting_price_cents")

    class Meta:
        model = Product
        fields = ["id", "slug", "i18nKey", "category", "status", "startingPriceCents", "order", "tags"]
        read_only_fields = fields


class ProductDetailSerializer(serializers.Serializer):
    product = ProductSerializer()
    deliveryPacks = DeliveryPackSerializer(many=True)


class OccasionSerializer(serializers.ModelSerializer):
    """§7d — occasions as data the storefront reads, not a hardcoded map."""

    class Meta:
        model = Occasion
        fields = ["key", "tags", "order"]
        read_only_fields = fields


class PrintSizeSerializer(serializers.ModelSerializer):
    """§7d — print sizes as data.

    `key` and pixel dimensions only. The customer-facing NAME stays in the
    frontend message files: it needs translating into three languages, and a
    name typed into an admin form would be English-only on an Arabic page.
    Sizes are managed here; how they are worded is a translation concern.
    """

    baseWidthPx = serializers.IntegerField(source="base_width_px", read_only=True)
    baseHeightPx = serializers.IntegerField(source="base_height_px", read_only=True)

    class Meta:
        model = PrintSize
        fields = ["key", "baseWidthPx", "baseHeightPx", "order"]
        read_only_fields = fields
