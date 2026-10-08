"""
Retries the final `DROP DATABASE` step of `manage.py test` teardown
instead of failing immediately on
`OperationalError: database "..." is being accessed by other users`.

Root cause this works around: this project's Postgres connection goes
through Supabase's Supavisor pooler in session mode (not a direct
connection — Supabase's direct hostname is IPv6-only unless you pay
for their IPv4 add-on, which isn't assumed here). In session mode, the
pooler holds a dedicated backend session open for the lifetime of a
client connection. Closing the *client* side (Django's
`connection.close()`, called correctly and promptly by every
concurrency test — see apps/delivery/tests.py and apps/commerce/tests.py)
does not guarantee the pooler has released the corresponding backend
session on the real Postgres instance by the time the very next
statement (`DROP DATABASE`, which requires zero other sessions) runs.
That's a proxy-layer timing gap, not a connection leak in this
codebase — confirmed by two consecutive full Windows test runs against
this same database where the fix from the *previous* investigation
(stuck-thread detection, `connections.close_all()`) made no difference
here, because it was already correctly closing every connection this
application code opens.

This is deliberately narrow: only `_destroy_test_db` is overridden,
which the Django test runner is the only caller of. Every other code
path — normal request handling, migrations, `manage.py check`, the
tests themselves — is byte-for-byte identical to
`django.db.backends.postgresql`, since this class subclasses it and
changes nothing else.
"""

from __future__ import annotations

import time

from django.db.backends.postgresql.creation import DatabaseCreation as PostgresDatabaseCreation
from django.db.utils import OperationalError

# Session-mode pooler session release has been observed to lag
# anywhere from under a second to (on a degraded connection) beyond
# the previous, tighter budget this constant used to have — real
# Windows runs against this project's Supabase pooler have shown
# total suite runtime varying from ~8 to ~17 minutes session to
# session, so this is deliberately generous rather than tuned to the
# common case.
_MAX_ATTEMPTS = 10
_RETRY_DELAY_SECONDS = 3


class PatientDatabaseCreation(PostgresDatabaseCreation):
    def _destroy_test_db(self, test_database_name, verbosity):
        last_error: OperationalError | None = None
        for attempt in range(1, _MAX_ATTEMPTS + 1):
            try:
                return super()._destroy_test_db(test_database_name, verbosity)
            except OperationalError as exc:
                # Only retry the specific, known-transient failure this
                # class exists for. Anything else (bad credentials, a
                # genuinely unreachable host, a real permissions error)
                # should fail immediately and loudly, not be masked by
                # a multi-second retry loop.
                if "being accessed by other users" not in str(exc):
                    raise
                last_error = exc
                if verbosity >= 1:
                    print(
                        f"...test database still has active sessions "
                        f"(attempt {attempt}/{_MAX_ATTEMPTS}), waiting "
                        f"{_RETRY_DELAY_SECONDS}s for the pooler to release them..."
                    )
                if attempt < _MAX_ATTEMPTS:
                    time.sleep(_RETRY_DELAY_SECONDS)
        # Every retry exhausted — surface the real error rather than
        # swallowing it. A test run that gets here has a genuine
        # problem worth seeing, not one this workaround should hide.
        raise last_error
