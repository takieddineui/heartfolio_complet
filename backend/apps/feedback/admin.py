from django.contrib import admin

from .models import Feedback


@admin.register(Feedback)
class FeedbackAdmin(admin.ModelAdmin):
    """The inbox (§7c, §9).

    §9 puts "browsing the full feedback inbox" on the desktop side of the
    dashboard, where plain Django admin is explicitly fine. So this is plain
    Django admin — no custom UI for something read at a desk.

    Everything a customer wrote is READ-ONLY here. Editing a submission
    would mean the record no longer says what they said, and the only reason
    to do it is to make it nicer before publishing — which is exactly the
    thing that must not be possible silently. `is_published` and
    `display_name` are the only editable fields, because they are staff
    decisions rather than customer content.
    """

    list_display = ("created_at", "rating", "target", "has_message", "is_published")
    list_filter = ("is_published", "rating", "created_at")
    search_fields = ("message", "email", "order__id", "product__slug")
    date_hierarchy = "created_at"
    list_editable = ("is_published",)

    readonly_fields = ("id", "rating", "message", "email", "order", "product", "created_at", "updated_at")
    fields = readonly_fields + ("is_published", "display_name")

    @admin.display(description="About")
    def target(self, obj):
        return obj.product.slug if obj.product else "General site feedback"

    @admin.display(boolean=True, description="Note")
    def has_message(self, obj):
        return bool(obj.message)

    def has_add_permission(self, request):
        # Feedback comes from customers, never from staff typing it in.
        return False
