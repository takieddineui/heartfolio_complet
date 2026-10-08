"""
Small custom fields whose only purpose is to get the exact PostgreSQL
column type the approved schema specifies, in cases where Django's
built-in fields don't produce it. Not business logic — kept here because
more than one app needs one or both of these (`products` and `commerce`
both have `currency CHAR(3)` columns; `commerce.Order` has a
`guest_email CITEXT` column).
"""

from django.db import models


class CIEmailField(models.EmailField):
    """`EmailField` stored as a `citext` column instead of `varchar`.

    This mirrors the identical field already defined independently in
    `apps/customers/models.py` (Phase 3.2). It is intentionally
    duplicated here rather than imported from `customers`, so this app
    never depends on the already-approved, already-migrated `customers`
    model — each app's fields stand on their own.

    (`django.contrib.postgres.fields.CIEmailField` is not used because
    Django 5.x fully removed it as a usable model field — it's kept only
    for historical migration state and raises system check error
    fields.E906 if actually attached to a model.)
    """

    def db_type(self, connection):
        return "citext"


class FixedCharField(models.CharField):
    """`CharField` stored as PostgreSQL `CHAR(n)` instead of `VARCHAR(n)`,
    for the `currency CHAR(3)` columns the approved schema specifies.
    """

    def db_type(self, connection):
        return f"char({self.max_length})"
