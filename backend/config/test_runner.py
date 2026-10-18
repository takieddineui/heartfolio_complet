"""
The test runner: tests never reach the outside world.

WHY THIS EXISTS (found 15 Oct 2026). `docker compose exec api python manage.py
test` inherits the container's real environment (`.env.docker`), and the
documented test command only redirects the database and storage. So every
test that marked an order paid really called Resend (the receipt email) and
Telegram (the "PAID" alert to the owner's phone), and the reconciliation tests
sent real mismatch alerts. A flag on the command line would have to be
remembered; this runner makes it impossible to forget, whatever the
environment holds:

1. THE SETTINGS THAT PUSH MESSAGES TO PEOPLE ARE BLANKED for the whole run
   (`_SILENCED`). Code reads them as "not configured" and skips the send. A
   test that needs a configured key sets a fake one with `override_settings`
   and stubs the HTTP call, as the email and Telegram tests already do.

2. EVERY NON-LOCAL CONNECTION IS REFUSED, as a name lookup that fails
   (`OutboundNetworkBlocked`, a `socket.gaierror`). Code under test sees it as
   the network being down, which every caller here already handles. The
   attempt is recorded with the test that made it, and a run that recorded
   any FAILS, listing them. Allowed: loopback (the R2-stall tests' own local
   servers), the database host, and Django's `testserver`.

Not covered: `manage.py test --parallel` workers record in their own process,
so a blocked attempt there still fails that test's network call but is not
listed at the end. This project does not run tests in parallel.
"""

from __future__ import annotations

import inspect
import ipaddress
import socket
import sys
import unittest

from django.conf import settings
from django.test.runner import DiscoverRunner

#: Blanked for every test run: each one makes the code send a real message to
#: a person (an email to a customer, an alert to the owner's phone).
_SILENCED = ("RESEND_API_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID")


class OutboundNetworkBlocked(socket.gaierror):
    """A test tried to reach a host outside this machine."""


class OutboundGuard:
    """Replaces `socket.getaddrinfo` while installed. Every connection by name
    (and by IP, since `create_connection` resolves numeric hosts too) passes
    through it."""

    def __init__(self, allowed_hosts: set[str]):
        self.allowed_hosts = {host.lower() for host in allowed_hosts if host}
        self.attempts: list[tuple[str, str]] = []
        self._real = None

    def is_local(self, host) -> bool:
        if host is None:
            return True
        name = host.decode() if isinstance(host, bytes) else str(host)
        name = name.strip("[]").lower()
        if name in self.allowed_hosts:
            return True
        try:
            return ipaddress.ip_address(name).is_loopback or name == "0.0.0.0"
        except ValueError:
            return False

    def _lookup(self, host, *args, **kwargs):
        if self.is_local(host):
            return self._real(host, *args, **kwargs)
        name = host.decode() if isinstance(host, bytes) else str(host)
        self.attempts.append((name, _current_test()))
        raise OutboundNetworkBlocked(f"Tests may not reach {name}: blocked by config.test_runner.")

    def install(self) -> None:
        if self._real is None:
            self._real = socket.getaddrinfo
            socket.getaddrinfo = self._lookup

    def uninstall(self) -> None:
        if self._real is not None:
            socket.getaddrinfo = self._real
            self._real = None


def _current_test() -> str:
    for frame_info in inspect.stack():
        candidate = frame_info.frame.f_locals.get("self")
        if isinstance(candidate, unittest.TestCase):
            return candidate.id()
    return "<outside any test>"


#: The guard of the run in progress, so a test can check it is in place.
active_guard: OutboundGuard | None = None


class HermeticTestRunner(DiscoverRunner):
    def setup_test_environment(self, **kwargs):
        global active_guard
        super().setup_test_environment(**kwargs)
        for name in _SILENCED:
            setattr(settings, name, "")
        database_hosts = {str(db.get("HOST") or "") for db in settings.DATABASES.values()}
        active_guard = OutboundGuard({"localhost", "testserver", *database_hosts})
        active_guard.install()

    def teardown_test_environment(self, **kwargs):
        if active_guard is not None:
            active_guard.uninstall()
        super().teardown_test_environment(**kwargs)

    def suite_result(self, suite, result, **kwargs):
        failures = super().suite_result(suite, result, **kwargs)
        attempts = active_guard.attempts if active_guard is not None else []
        if attempts:
            sys.stderr.write(f"\nBLOCKED {len(attempts)} attempt(s) to reach the outside world:\n")
            for host, test in attempts:
                sys.stderr.write(f"  {host}  <-  {test}\n")
            sys.stderr.write("Stub the call (and set any key with override_settings); tests never use the network.\n")
        return failures + len(attempts)
