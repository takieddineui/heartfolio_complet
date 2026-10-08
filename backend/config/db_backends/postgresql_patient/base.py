"""
A database ENGINE that is `django.db.backends.postgresql` with exactly
one change: test-database teardown retries on a specific transient
error instead of failing immediately. See `creation.py` for why.

Django resolves `ENGINE = "config.db_backends.postgresql_patient"` to
this module's `DatabaseWrapper` — nothing else in the codebase
references this package directly.
"""

from django.db.backends.postgresql.base import DatabaseWrapper as PostgresDatabaseWrapper

from .creation import PatientDatabaseCreation


class DatabaseWrapper(PostgresDatabaseWrapper):
    creation_class = PatientDatabaseCreation
