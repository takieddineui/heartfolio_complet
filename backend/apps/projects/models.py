"""
`projects` app owns `Project` — generic, product-agnostic personalization
state. No product-specific columns or branches: `data.values` and
`data.themeSelections` are opaque to the backend, interpreted only by
the frontend's Product Modules.
"""

import uuid

from django.db import models

from apps.customers.models import Customer
from apps.products.models import Product


def default_project_data() -> dict:
    """The one and only approved shape for `projects.data`. A function
    (not a literal) so Django doesn't share one mutable dict instance
    as the default across every unsaved `Project`.
    """
    return {"version": 1, "values": {}, "themeSelections": {}}


class Project(models.Model):
    STATUS_DRAFT = "draft"
    STATUS_COMPLETED = "completed"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_COMPLETED, "Completed"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    customer = models.ForeignKey(
        Customer,
        on_delete=models.CASCADE,
        related_name="projects",
        db_index=False,  # explicit named index below
        # See the identical note in apps/assets/models.py: Django's
        # on_delete is application-level only. DB-level ON DELETE
        # CASCADE is added via RunSQL in this app's migration instead.
        db_constraint=False,
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.RESTRICT,
        related_name="projects",
        db_index=False,  # explicit named index below
    )
    # Exactly {"version": 1, "values": {}, "themeSelections": {}} at the
    # top level — no "content"/"style"/"layout"/"assets"/"metadata"
    # keys, and no separate "theme"/"layout" columns. `values` and
    # `themeSelections` are opaque product-module state; see the
    # database-level CHECK constraints added in the migration for the
    # object-shape and required-keys enforcement Django's ORM can't
    # express directly.
    data = models.JSONField(default=default_project_data)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "projects"
        indexes = [
            models.Index(fields=["customer"], name="idx_projects_customer_id"),
            models.Index(fields=["product"], name="idx_projects_product_id"),
            models.Index(fields=["status"], name="idx_projects_status"),
            models.Index(fields=["created_at"], name="idx_projects_created_at"),
        ]
        constraints = [
            models.CheckConstraint(
                check=models.Q(status__in=["draft", "completed"]),
                name="ck_projects_status_valid",
            ),
        ]

    def __str__(self) -> str:
        return str(self.id)
