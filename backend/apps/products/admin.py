"""
Admin registration for the product catalog.

Added in the frontend-integration phase for one specific, bounded reason:
the launch catalog (`Product` + `DeliveryPack` rows) has to be entered into
a fresh database, and the approved approach is hand-entry through the admin
rather than a seed migration or a management command.

Scope discipline — this file deliberately does NOT:
  - add, remove or alter any model field, constraint or migration
  - expose `customers`, `projects`, `assets`, `orders`, `payments` or
    `entitlements` (transactional, customer-owned data with real ownership
    rules enforced in the service layer; a staff UI over those rows is a
    separate decision with its own audit/privacy questions, not something
    to grant as a side effect of needing to type in a price)
  - change any API contract, serializer or business rule

The one piece of real logic here is `DeliveryPackForm.clean_included_targets`,
which exists because `included_targets` is a free-form JSON array. A typo in
it (`"landscpae-png"`, or selling `"landscape-png"` for a product whose
renderer has no such size) is not caught anywhere else in the system: the
row saves fine, the product sells fine, Paddle charges fine, and the failure
only surfaces as a 501 when a customer who has already paid clicks download.
Validating at entry turns that into an immediate, readable form error.
"""

from django import forms
from django.contrib import admin

from .catalog_entities import SizeNotRenderable, assert_size_can_be_sold
from .models import DeliveryPack, Occasion, PrintSize, Product


def _supported_targets(product_slug: str) -> set[str] | None:
    """Returns the delivery targets a product's registered renderer can
    actually produce, or `None` if no real renderer is registered for it
    (in which case nothing is validated — a future product can be entered
    here before its renderer exists, exactly as `NotImplementedRenderer`
    already allows).

    Imported lazily so this module — loaded on every admin request — never
    pulls Pillow and the renderer graph into processes that don't need it.
    The values are read from the renderers themselves rather than
    re-listed here, so this can never drift from what the backend can
    genuinely render.
    """
    from apps.delivery.ar_support import supported_ar_targets
    from apps.delivery.delivery_types import LIVE_TARGET_SENTINEL
    from apps.delivery.print_sizes import print_target_dimensions
    from apps.delivery.product_renderers.love_story_timeline.png_renderer import (
        TARGET_DIMENSIONS as LOVE_STORY_TIMELINE_TARGETS,
    )
    from apps.delivery.product_renderers.where_we_met_map.png_renderer import (
        TARGET_DIMENSIONS as WHERE_WE_MET_MAP_TARGETS,
    )
    from apps.delivery.wallpaper_devices import wallpaper_target_dimensions

    supported = {
        # Love Story Timeline additionally has a real HTML (digital)
        # renderer, reached through the `__live__` sentinel target.
        "love-story-timeline": set(LOVE_STORY_TIMELINE_TARGETS) | {LIVE_TARGET_SENTINEL},
        # Where We Met Map is PNG-only — no digital/HTML renderer exists,
        # so `__live__` is deliberately absent here.
        "heart-map": set(WHERE_WE_MET_MAP_TARGETS),
        # The shared print and wallpaper catalog plus the hosted page, the
        # same set `seed_catalog.supported_targets` uses. It used to be
        # missing here, so `supported` was `None` and the admin form validated
        # nothing for Song Poster's packs. `CatalogTargetMapParityTests` now
        # keeps the two maps equal for every seeded product.
        "song-poster": set(print_target_dimensions()) | set(wallpaper_target_dimensions()) | {LIVE_TARGET_SENTINEL},
        # Live-only: the hosted page is the whole product (seed_catalog.py
        # lists the same).
        "reasons-i-love-you": {LIVE_TARGET_SENTINEL},
        # Live-only, the same as Reasons I Love You.
        "graduation-keepsake": {LIVE_TARGET_SENTINEL},
    }
    if product_slug not in supported:
        return None

    # §21b — AR targets are delivered by their own endpoint, not by the PNG
    # or HTML renderers, so they are legitimately absent from the lists
    # above and this guard was correctly rejecting them. They are added per
    # product from an explicit opt-in rather than by loosening the check —
    # a product with no declared AR support still cannot sell an AR target.
    return supported[product_slug] | supported_ar_targets(product_slug)


class DeliveryPackForm(forms.ModelForm):
    class Meta:
        model = DeliveryPack
        fields = "__all__"

    def clean_included_targets(self):
        targets = self.cleaned_data["included_targets"]

        if not isinstance(targets, list):
            raise forms.ValidationError('Included targets must be a JSON array, e.g. ["print-png"].')
        if not targets:
            raise forms.ValidationError(
                "A delivery pack with no targets grants nothing on purchase — add at least one."
            )
        if not all(isinstance(target, str) and target.strip() for target in targets):
            raise forms.ValidationError("Every included target must be a non-empty string.")
        if len(set(targets)) != len(targets):
            raise forms.ValidationError("The same target is listed more than once.")

        product = self.cleaned_data.get("product")
        if product is None:
            return targets  # product is separately required; nothing to validate against yet

        supported = _supported_targets(product.slug)
        if supported is None:
            return targets

        unsupported = [target for target in targets if target not in supported]
        if unsupported:
            raise forms.ValidationError(
                "This product's renderer cannot produce: {bad}. Supported targets are: {good}.".format(
                    bad=", ".join(sorted(unsupported)),
                    good=", ".join(sorted(supported)),
                )
            )

        return targets


class DeliveryPackInline(admin.TabularInline):
    model = DeliveryPack
    form = DeliveryPackForm
    extra = 0
    fields = ("slug", "name_i18n_key", "description_i18n_key", "price_cents", "currency", "included_targets", "status")


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    inlines = [DeliveryPackInline]
    list_display = ("slug", "name_i18n_key", "category", "status", "starting_price_cents", "order")
    list_filter = ("status", "category")
    search_fields = ("slug", "name_i18n_key")
    ordering = ("order", "slug")
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(DeliveryPack)
class DeliveryPackAdmin(admin.ModelAdmin):
    form = DeliveryPackForm
    list_display = ("product", "slug", "price_cents", "currency", "status")
    list_filter = ("status", "product")
    search_fields = ("slug", "name_i18n_key")
    ordering = ("product__order", "slug")
    readonly_fields = ("id", "created_at", "updated_at")


# ---------------------------------------------------------------------
# §7d — catalog entities managed from the dashboard
# ---------------------------------------------------------------------

@admin.register(Occasion)
class OccasionAdmin(admin.ModelAdmin):
    """Occasions are pure metadata, so this is unrestricted (§7d, §11).

    Adding "New Home" requires nothing of the renderer or the storefront —
    it filters products that already exist. Nothing here can produce a file
    that cannot be delivered, which is why it has none of the guards the
    print sizes below need.
    """

    list_display = ("key", "tags", "order", "is_active", "matching_products")
    list_editable = ("order", "is_active")
    search_fields = ("key",)

    @admin.display(description="Products matching")
    def matching_products(self, obj):
        """Shows the consequence of the tags at a glance.

        An occasion whose tags match nothing renders an empty grid on the
        storefront — the exact failure §11 removed from the homepage. Seeing
        "0" while editing is what stops that being shipped.
        """
        tags = set(obj.tags or [])
        if not tags:
            return "0 — no tags set"
        matches = [
            product.slug
            for product in Product.objects.all()
            if tags & set(product.tags or [])
        ]
        return f"{len(matches)}: {', '.join(matches)}" if matches else "0 — nothing matches these tags"


class PrintSizeForm(forms.ModelForm):
    class Meta:
        model = PrintSize
        fields = "__all__"

    def clean(self):
        """Blocks activating a size no renderer can produce (§7d).

        A size may be CREATED, renamed and reordered freely — that is the
        manageability §7d asks for. What it may not do is become active,
        because active is what makes it sellable, and selling a file that
        does not exist means charging a customer for a download that 501s.
        Nothing later in the chain catches that: the row saves, the pack
        sells, Paddle charges, and the failure surfaces after payment.

        The check reads the renderers themselves rather than a list kept
        here, so it cannot drift from what the backend genuinely produces.
        """
        cleaned = super().clean()
        if not cleaned.get("is_active"):
            return cleaned

        try:
            assert_size_can_be_sold(
                cleaned.get("key") or "",
                cleaned.get("base_width_px") or 0,
                cleaned.get("base_height_px") or 0,
            )
        except SizeNotRenderable as exc:
            raise forms.ValidationError({"is_active": str(exc)})
        return cleaned


@admin.register(PrintSize)
class PrintSizeAdmin(admin.ModelAdmin):
    form = PrintSizeForm
    list_display = ("key", "dimensions", "aspect_ratio", "order", "is_active", "sellable")
    list_editable = ("order",)
    search_fields = ("key",)

    @admin.display(description="Pixels @300dpi")
    def dimensions(self, obj):
        return f"{obj.base_width_px} × {obj.base_height_px}"

    @admin.display(description="Ratio")
    def aspect_ratio(self, obj):
        return f"1 : {obj.ratio:.3f}"

    @admin.display(boolean=True, description="Renderer ready")
    def sellable(self, obj):
        return obj.is_sellable
