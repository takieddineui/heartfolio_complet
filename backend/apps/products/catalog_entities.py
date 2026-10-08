"""Manageable catalog entities (§7d, and the architecture note in §11).

Until now, occasions were a hardcoded tag map in the frontend and print
sizes were constants in two files. §7d asks for both to be created and
edited from the dashboard, and §11 flags that they need to be real entities
first rather than loose tags and fixed choices.

THE TWO ARE NOT THE SAME KIND OF THING, and the models reflect that.

An **Occasion** is pure metadata. Adding "New Home" requires nothing of the
renderer, the storefront or anyone else — it filters products that already
exist. It can be created freely.

A **PrintSize** is a promise about pixels. `print-a2-frameless` only exists
if a renderer produces those dimensions at that ratio with correct margins,
the naming layer has a label for it in three languages, and the safe-zone
logic handles it. A size row can therefore be created, renamed, reordered
and disabled freely — but `is_sellable` is computed from what the renderers
can actually produce, and a size that is not sellable cannot enter a pack.

WHY THAT GUARD EXISTS AT ALL
-----------------------------
Without it the failure chain is: a size is added, it appears in a pack, the
product page advertises it, Paddle charges for it, and the customer clicks
download and gets a 501 — after paying. Nothing earlier catches it. That is
the same chain `_supported_targets` in `apps/products/admin.py` was written
to prevent for `included_targets`, and this is the same defence one level up.

The result is full manageability with one thing blocked: selling a file that
does not exist yet.
"""

import uuid

from django.db import models


class Occasion(models.Model):
    """A gift occasion — anniversary, wedding, new baby (§7d, §11).

    Products are matched by TAG rather than by a foreign key, deliberately.
    A product belongs to an occasion because of what it is, and the same tag
    ("anniversary") legitimately drives the homepage cards, the product
    page's own occasion line and the gift-intent pages. A join table would
    mean re-linking every product each time an occasion is added, which is
    exactly the manual work §7d is trying to remove.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    #: Stable key. Used in URLs (`/products?occasion=<key>`) and to resolve
    #: copy, so renaming the display text never breaks a link.
    key = models.SlugField(max_length=50, unique=True)
    #: Product tags that place a product in this occasion. Any match counts.
    tags = models.JSONField(default=list)
    order = models.IntegerField(default=0)
    #: Off rather than deleted: an occasion with live links pointing at it
    #: should stop being offered without those links 404ing mid-campaign.
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "occasions"
        ordering = ["order", "key"]

    def __str__(self) -> str:
        return self.key


class PrintSize(models.Model):
    """A print size offered to customers (§7d).

    Dimensions are stored in PIXELS at 300dpi, matching how the renderer
    thinks, rather than in inches or millimetres. Storing physical units
    would mean a rounding step between the admin and the renderer, and a
    size whose stated dimensions and produced file disagree is worse than
    one that is simply absent.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    key = models.SlugField(max_length=50, unique=True)
    base_width_px = models.PositiveIntegerField()
    base_height_px = models.PositiveIntegerField()
    order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "print_sizes"
        ordering = ["order", "key"]

    def __str__(self) -> str:
        return f"{self.key} ({self.base_width_px}x{self.base_height_px})"

    @property
    def ratio(self) -> float:
        return self.base_height_px / self.base_width_px if self.base_width_px else 0.0

    @property
    def target_ids(self) -> list[str]:
        """The delivery targets this size implies — one per mounting (§3)."""
        from apps.delivery.print_sizes import MOUNTINGS, print_target_id

        return [print_target_id(self.key, mounting) for mounting in MOUNTINGS]

    @property
    def is_sellable(self) -> bool:
        """True only when a renderer can actually produce every one of this
        size's targets.

        Computed, never stored: a stored flag would be a second source of
        truth that goes stale the moment a renderer changes, and going stale
        in the permissive direction is what lets an unsellable size be sold.
        """
        from apps.delivery.product_renderers.love_story_timeline.png_renderer import (
            TARGET_DIMENSIONS,
        )

        return all(target in TARGET_DIMENSIONS for target in self.target_ids)

    @property
    def unsellable_reason(self) -> str:
        if self.is_sellable:
            return ""
        missing = [t for t in self.target_ids if not self.is_sellable]
        return (
            "No renderer produces "
            + ", ".join(missing)
            + " — this size can be edited and reordered, but cannot be added to a pack "
            "until a renderer supports it."
        )


class SizeNotRenderable(Exception):
    """Raised when a size is being made sellable that no renderer produces."""


def assert_size_can_be_sold(key: str, base_width_px: int, base_height_px: int) -> None:
    """The §7d guard, as a plain function.

    Extracted from the admin form so it can be tested without a database —
    a `ModelForm` runs a uniqueness query before it reaches `clean()`, which
    would make the one test that matters here dependent on Postgres being
    available. It is also the better shape: the rule belongs to the catalog,
    not to one particular form.
    """
    probe = PrintSize(key=key, base_width_px=base_width_px, base_height_px=base_height_px)
    if not probe.is_sellable:
        raise SizeNotRenderable(
            "No renderer produces this size yet, so it cannot be sold. Save it "
            "inactive — you can still edit and reorder it — and activate it once "
            "the renderer supports " + ", ".join(probe.target_ids) + "."
        )
