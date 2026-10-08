"""
Customer model.

This is the approved `customers` table from the Phase 3 database schema
review, implemented exactly as specified — no additional fields:

    id         UUID PK
    email      CITEXT NOT NULL UNIQUE
    created_at TIMESTAMPTZ
    updated_at TIMESTAMPTZ

No username, password, display_name, status, or profile fields. This is
guest identity, not an account system.

Django's own `django.contrib.postgres.fields.CIEmailField` would have
been the obvious way to get the approved CITEXT column type, but as of
Django 5.x it is fully removed as a usable model field (kept only for
historical migration state — using it raises system check error
fields.E906). Django's suggested replacement is `EmailField(db_collation=...)`
with a non-deterministic ICU collation, but that stores the column as
plain text with a special collation rather than as `CITEXT`, which is a
different physical type than the one specified in the approved schema.

To honor the approved schema exactly, `CIEmailField` below is a minimal
local field (~3 lines) that reuses Django's built-in `EmailField` for
Python-level validation and only overrides `db_type()` to emit `citext`
at the database level. This is the direct, literal implementation of
the approved `email CITEXT NOT NULL UNIQUE` column, not a workaround.
"""

import uuid

from django.db import models


class CIEmailField(models.EmailField):
    """`EmailField` stored as a `citext` column instead of `varchar`."""

    def db_type(self, connection):
        return "citext"


class Customer(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = CIEmailField(unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "customers"
        indexes = [
            models.Index(fields=["created_at"], name="idx_customers_created_at"),
        ]

    def __str__(self) -> str:
        return str(self.id)
