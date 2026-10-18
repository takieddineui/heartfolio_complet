"""
Phase 3.14 — cross-cutting production-hardening infrastructure that
doesn't belong to any single domain app: the health/readiness
endpoints, proof that the new scoped rate limiting actually works (not
just that settings exist), and proof that `config.settings.production`
itself actually behaves correctly — not just that its source code looks
right on inspection.
"""

import os
import subprocess
import sys
import threading
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

import psycopg
from django.core.cache import cache
from django.db import connection as default_connection
from django.test import TestCase
from rest_framework import status as http_status
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

from apps.common.test_helpers import login_as_guest
from config.db_backends.postgresql_patient.creation import PatientDatabaseCreation

_REPO_ROOT = Path(__file__).resolve().parents[2]


class HealthCheckTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_liveness_check_ok(self):
        response = self.client.get("/api/v1/health/")
        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "ok")

    def test_readiness_check_reports_database_reachable(self):
        response = self.client.get("/api/v1/health/ready/")
        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "ok")
        self.assertEqual(response.data["database"], "reachable")


# ------------------------------------------------------------------
# Rate limiting — proves the DEFAULT_THROTTLE_RATES/throttle_scope
# wiring genuinely blocks requests once a limit is hit, and that the
# Paddle webhook view is deliberately exempt (it must never be
# IP-rate-limited — that would be rate-limiting Paddle's own servers).
# ------------------------------------------------------------------

class HermeticTestRunnerTests(TestCase):
    """`config.test_runner`: tests never reach the outside world. Until 15 Oct
    2026 they inherited the container's real keys, so paid-order tests sent
    real Telegram alerts and tried real receipt emails."""

    def setUp(self):
        from config import test_runner

        self.guard = test_runner.active_guard
        self.assertIsNotNone(self.guard, "the suite must run under config.test_runner.HermeticTestRunner")

    def test_the_settings_that_message_people_are_blank_whatever_the_environment_says(self):
        from django.conf import settings

        from apps.common import telegram

        for name in ("RESEND_API_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"):
            self.assertEqual(getattr(settings, name), "", name)
        self.assertFalse(telegram.is_configured())

    def test_a_lookup_outside_this_machine_is_refused_and_recorded_against_the_test(self):
        import socket

        from config.test_runner import OutboundNetworkBlocked

        before = len(self.guard.attempts)
        with self.assertRaises(OutboundNetworkBlocked) as caught:
            socket.getaddrinfo("api.telegram.org", 443)
        self.assertIsInstance(caught.exception, socket.gaierror)  # callers see "network down"
        # This test made the attempt on purpose: take it back so the run passes.
        self.assertEqual(self.guard.attempts[before:], [("api.telegram.org", self.id())])
        del self.guard.attempts[before:]

    def test_a_numeric_public_address_is_refused_too(self):
        import socket

        from config.test_runner import OutboundNetworkBlocked

        before = len(self.guard.attempts)
        with self.assertRaises(OutboundNetworkBlocked):
            socket.create_connection(("1.1.1.1", 443), timeout=1)
        del self.guard.attempts[before:]

    def test_this_machine_and_the_database_stay_reachable(self):
        import socket

        from django.conf import settings

        before = len(self.guard.attempts)
        self.assertTrue(socket.getaddrinfo("localhost", 80))
        self.assertTrue(socket.getaddrinfo("127.0.0.1", 80))
        db_host = settings.DATABASES["default"].get("HOST")
        if db_host:
            self.assertTrue(socket.getaddrinfo(db_host, 5432))
        self.assertEqual(self.guard.attempts[before:], [])

    def test_a_run_with_any_blocked_attempt_fails(self):
        import io
        import unittest as std_unittest

        from config.test_runner import HermeticTestRunner

        runner = HermeticTestRunner(verbosity=0)
        clean = std_unittest.TestResult()
        self.assertEqual(runner.suite_result(None, clean), 0)
        self.guard.attempts.append(("api.resend.com", "some.test"))
        try:
            with patch("sys.stderr", new_callable=io.StringIO) as err:
                self.assertEqual(runner.suite_result(None, clean), 1)
            self.assertIn("api.resend.com  <-  some.test", err.getvalue())
        finally:
            self.guard.attempts.remove(("api.resend.com", "some.test"))


class YouTubeValidateViewTests(TestCase):
    """`POST /api/v1/youtube/validate/` with YouTube's oEmbed stubbed: every
    answer carries a `code` the Studio translates (`reason` is English, for
    logs). oEmbed's own "no" (400/401/403/404) is `unavailable`; anything
    that means "we could not check" is `checkFailed`, which the Studio
    offers to retry."""

    URL = "/api/v1/youtube/validate/"
    LINK = "https://youtu.be/KQetemT1sWc?si=abc"

    def setUp(self):
        cache.clear()  # the endpoint is throttled; no counts from other tests
        self.client = APIClient()

    def tearDown(self):
        cache.clear()

    def _oembed(self, status_code=200, payload=None, raises=None):
        from unittest.mock import MagicMock

        response = MagicMock(status_code=status_code)
        if isinstance(payload, Exception):
            response.json.side_effect = payload
        else:
            response.json.return_value = payload
        return patch("apps.common.youtube.requests.get", side_effect=raises, return_value=response)

    def test_a_playable_video_is_confirmed_with_its_title(self):
        payload = {"title": "Here Comes The Sun", "author_name": "TheBeatlesVEVO", "thumbnail_url": "https://i.ytimg.com/x.jpg"}
        with self._oembed(payload=payload) as get:
            response = self.client.post(self.URL, {"url": self.LINK}, format="json")
        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(
            response.data,
            {"valid": True, "videoId": "KQetemT1sWc", "title": "Here Comes The Sun", "authorName": "TheBeatlesVEVO", "thumbnailUrl": "https://i.ytimg.com/x.jpg"},
        )
        # The id is checked in its canonical form, whatever shape was pasted.
        self.assertEqual(get.call_args.kwargs["params"]["url"], "https://www.youtube.com/watch?v=KQetemT1sWc")

    def test_oembeds_refusals_are_unavailable(self):
        for status_code in (400, 401, 403, 404):
            with self.subTest(status_code=status_code), self._oembed(status_code=status_code):
                response = self.client.post(self.URL, {"url": self.LINK}, format="json")
                self.assertEqual((response.data["valid"], response.data["code"]), (False, "unavailable"))

    def test_anything_that_means_we_could_not_check_is_check_failed(self):
        import requests

        cases = {
            "server error": dict(status_code=500),
            "rate limited": dict(status_code=429),
            "network": dict(raises=requests.ConnectionError("down")),
            "timeout": dict(raises=requests.Timeout("slow")),
            "unreadable": dict(payload=ValueError("not json")),
            "no title": dict(payload={"author_name": "x"}),
        }
        for name, stub in cases.items():
            with self.subTest(name), self._oembed(**stub):
                response = self.client.post(self.URL, {"url": self.LINK}, format="json")
                self.assertEqual((response.data["valid"], response.data["code"]), (False, "checkFailed"))

    def test_no_link_and_not_youtube_never_reach_youtube(self):
        cases = {"": "empty", "   ": "empty", 123: "empty", None: "empty", "https://open.spotify.com/track/6dG": "notYoutube"}
        for raw, code in cases.items():
            with self.subTest(raw=raw), self._oembed() as get:
                response = self.client.post(self.URL, {"url": raw}, format="json")
                self.assertEqual(response.status_code, http_status.HTTP_200_OK)
                self.assertEqual((response.data["valid"], response.data["code"]), (False, code))
                get.assert_not_called()

    def test_a_returning_guest_with_a_session_can_check_a_link(self):
        """The Studio sends the CSRF token (`apiFetch`); a guest who already
        has a session must not be refused for it."""
        from apps.common.test_helpers import csrf_headers

        login_as_guest(self.client)
        with self._oembed(payload={"title": "T"}):
            response = self.client.post(self.URL, {"url": self.LINK}, format="json", **csrf_headers(self.client))
        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertTrue(response.data["valid"])


class RateLimitingTests(TestCase):
    """`ScopedRateThrottle.THROTTLE_RATES` (and `APIView.throttle_classes`)
    are captured once from `api_settings` at Django/module import time
    — `@override_settings(REST_FRAMEWORK=...)` does *not* retroactively
    change them (a well-known DRF testing gotcha), so these tests patch
    the actual live dict DRF reads from at request time instead.
    """

    def setUp(self):
        # Every test in this class deliberately patches the throttle
        # rate to something tiny — clear the shared LocMemCache first
        # so throttle counts from unrelated tests earlier in this same
        # process/run never bleed into these assertions.
        cache.clear()
        self.client = APIClient()

    def tearDown(self):
        cache.clear()

    def test_guest_identity_is_throttled_once_the_scoped_rate_is_exceeded(self):
        # 2/min allowed; the 3rd request within the window must be
        # rejected with 429, not silently served.
        with patch.dict(ScopedRateThrottle.THROTTLE_RATES, {"guest_identity": "2/min"}):
            r1 = self.client.get("/api/v1/guest/")
            r2 = self.client.get("/api/v1/guest/")
            r3 = self.client.get("/api/v1/guest/")

        self.assertEqual(r1.status_code, http_status.HTTP_200_OK)
        self.assertEqual(r2.status_code, http_status.HTTP_200_OK)
        self.assertEqual(r3.status_code, http_status.HTTP_429_TOO_MANY_REQUESTS)

    def test_paddle_webhook_view_is_never_scoped_and_so_never_throttled(self):
        """Even with every known scope pinned to an absurdly low rate,
        the webhook endpoint (which sets no `throttle_scope` at all)
        must keep accepting requests — `ScopedRateThrottle` is a no-op
        for a view with no scope, by design. A structured 400 for a
        bad/missing signature is fine and expected here; a 429 would
        mean Paddle's own delivery IP got rate-limited, which must
        never happen.
        """
        rates = {scope: "1/min" for scope in ScopedRateThrottle.THROTTLE_RATES}
        with patch.dict(ScopedRateThrottle.THROTTLE_RATES, rates):
            for _ in range(5):
                response = self.client.post(
                    "/api/v1/webhooks/paddle/", data=b"{}", content_type="application/json"
                )
                self.assertNotEqual(response.status_code, http_status.HTTP_429_TOO_MANY_REQUESTS)

    def test_health_check_is_never_throttled_either(self):
        """Same reasoning as the webhook test — the health/readiness
        endpoints set no `throttle_scope`, so an orchestrator polling
        them frequently is never blocked.
        """
        rates = {scope: "1/min" for scope in ScopedRateThrottle.THROTTLE_RATES}
        with patch.dict(ScopedRateThrottle.THROTTLE_RATES, rates):
            for _ in range(5):
                response = self.client.get("/api/v1/health/")
                self.assertEqual(response.status_code, http_status.HTTP_200_OK)


# ------------------------------------------------------------------
# Production settings — actually loaded in a real subprocess (a fresh
# Python process, not this already-running test process, which has
# `config.settings.development` permanently imported and cached), so
# these tests prove `config/settings/production.py` really behaves as
# documented rather than just reading correctly on inspection.
# ------------------------------------------------------------------

class ProductionSettingsLoadingTests(TestCase):
    _BASE_ENV = {
        "DJANGO_SETTINGS_MODULE": "config.settings.production",
        "DJANGO_SECRET_KEY": "subprocess-test-secret-key",
        "DJANGO_ALLOWED_HOSTS": "example.com",
        "CORS_ALLOWED_ORIGINS": "https://app.example.com",
        "DATABASE_URL": "postgres://postgres:postgres@localhost:5432/heartfolio",
        # `env = os.environ.copy()` below inherits the real container
        # environment first, so without this pin, a real
        # FREEMIUS_ENABLED=true sitting in .env.docker (unrelated to any
        # single test here) leaks into every subprocess and hits the
        # Freemius hard-fail block for the wrong reason. Same role as the
        # other pins above — a safe default every test gets unless it
        # deliberately opts into testing Freemius-enabled behavior.
        "FREEMIUS_ENABLED": "false",
    }

    def _load_settings(self, extra_env: dict, code: str | None = None) -> subprocess.CompletedProcess:
        # Inherit the full parent environment rather than
        # reconstructing a bare-PATH-only one — Windows specifically
        # needs SystemRoot/windir present for asyncio's `_overlapped`
        # extension to initialize Winsock (django → asgiref → asyncio
        # is imported transitively by `django.setup()` regardless of
        # whether this app ever uses async views). A stripped-down
        # environment reliably reproduces
        # `OSError: [WinError 10106] The requested service provider
        # could not be loaded or initialized` on Windows — that's a
        # bug in how this subprocess environment was built, not a
        # real Windows/Winsock/network fault, and is unrelated to
        # anything this test class is actually meant to verify.
        env = os.environ.copy()
        env.update(self._BASE_ENV)
        env.update(extra_env)
        return subprocess.run(
            [sys.executable, "-c", code or "import django; django.setup(); print('SETTINGS_LOADED_OK')"],
            cwd=str(_REPO_ROOT),
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )

    def test_missing_allowed_hosts_fails_loudly(self):
        env = dict(self._BASE_ENV)
        del env["DJANGO_ALLOWED_HOSTS"]
        # Re-supply everything else required so this fails for exactly
        # one reason.
        result = self._load_settings({**env, "DJANGO_ALLOWED_HOSTS": ""})
        # django-environ's env.list() with no default raises
        # ImproperlyConfigured for an empty/missing value.
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("SETTINGS_LOADED_OK", result.stdout)

    def test_mock_payment_provider_explicitly_forbidden_in_production(self):
        result = self._load_settings(
            {
                "PAYMENT_PROVIDER": "mock",
                "ASSET_STORAGE_BACKEND": "r2",
                "R2_ACCESS_KEY_ID": "test_id",
                "R2_SECRET_ACCESS_KEY": "test_secret_key",
                "R2_BUCKET_NAME": "test-bucket",
                "R2_ENDPOINT_URL": "https://example.r2.cloudflarestorage.com",
            }
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ImproperlyConfigured", result.stderr)
        self.assertIn("PAYMENT_PROVIDER=mock is not permitted", result.stderr)

    def test_unrecognized_payment_provider_fails_loudly_in_production(self):
        # The exact incident this closes: before this fix, an unrecognized
        # value here matched neither the "paddle" nor the "mock" branch and
        # skipped validation entirely, reaching `get_payment_provider()` at
        # request time, which (before its own matching fix) silently
        # returned `MockPaymentProvider` — a free, successful checkout for
        # a real customer. "fastspring" is no longer a usable example here
        # — it is now a recognized, validated value (see the two tests
        # below) — so this uses a genuinely unrecognized name instead.
        result = self._load_settings(
            {
                "PAYMENT_PROVIDER": "stripe",
                "ASSET_STORAGE_BACKEND": "r2",
                "R2_ACCESS_KEY_ID": "test_id",
                "R2_SECRET_ACCESS_KEY": "test_secret_key",
                "R2_BUCKET_NAME": "test-bucket",
                "R2_ENDPOINT_URL": "https://example.r2.cloudflarestorage.com",
            }
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ImproperlyConfigured", result.stderr)
        self.assertIn("Unrecognized PAYMENT_PROVIDER", result.stderr)

    def test_paddle_provider_with_missing_credentials_fails_loudly(self):
        result = self._load_settings(
            {
                "PAYMENT_PROVIDER": "paddle",
                "ASSET_STORAGE_BACKEND": "r2",
                "R2_ACCESS_KEY_ID": "test_id",
                "R2_SECRET_ACCESS_KEY": "test_secret_key",
                "R2_BUCKET_NAME": "test-bucket",
                "R2_ENDPOINT_URL": "https://example.r2.cloudflarestorage.com",
            }
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ImproperlyConfigured", result.stderr)
        self.assertIn("Production requires Paddle payment configuration", result.stderr)

    def test_fastspring_provider_with_missing_credentials_fails_loudly(self):
        # Mirrors the Paddle test above exactly — proves the new branch
        # actually validates rather than silently accepting
        # PAYMENT_PROVIDER=fastspring with nothing configured behind it.
        result = self._load_settings(
            {
                "PAYMENT_PROVIDER": "fastspring",
                "ASSET_STORAGE_BACKEND": "r2",
                "R2_ACCESS_KEY_ID": "test_id",
                "R2_SECRET_ACCESS_KEY": "test_secret_key",
                "R2_BUCKET_NAME": "test-bucket",
                "R2_ENDPOINT_URL": "https://example.r2.cloudflarestorage.com",
            }
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ImproperlyConfigured", result.stderr)
        self.assertIn("Production requires FastSpring payment configuration", result.stderr)

    def test_fastspring_provider_with_partial_credentials_still_fails_loudly(self):
        # Every required FASTSPRING_* value must be present individually —
        # supplying only some of them must not pass validation either.
        # FASTSPRING_STORE_ID/CHECKOUT_ID both have non-empty defaults in
        # base.py (the confirmed account values), so they are blanked out
        # here explicitly to prove they are genuinely checked too, not
        # just always-present-by-default and never actually exercised.
        result = self._load_settings(
            {
                "PAYMENT_PROVIDER": "fastspring",
                "FASTSPRING_API_USERNAME": "test_user",
                "FASTSPRING_API_PASSWORD": "test_pass",
                "FASTSPRING_STORE_ID": "",
                "FASTSPRING_CHECKOUT_ID": "",
                "ASSET_STORAGE_BACKEND": "r2",
                "R2_ACCESS_KEY_ID": "test_id",
                "R2_SECRET_ACCESS_KEY": "test_secret_key",
                "R2_BUCKET_NAME": "test-bucket",
                "R2_ENDPOINT_URL": "https://example.r2.cloudflarestorage.com",
            }
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ImproperlyConfigured", result.stderr)
        self.assertIn("Production requires FastSpring payment configuration", result.stderr)
        self.assertIn("FASTSPRING_ACCESS_KEY", result.stderr)
        self.assertIn("FASTSPRING_WEBHOOK_SECRET", result.stderr)
        self.assertIn("FASTSPRING_STORE_ID", result.stderr)
        self.assertIn("FASTSPRING_CHECKOUT_ID", result.stderr)

    def test_mock_asset_storage_explicitly_forbidden_in_production(self):
        result = self._load_settings({"ASSET_STORAGE_BACKEND": "mock"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ImproperlyConfigured", result.stderr)
        self.assertIn("ASSET_STORAGE_BACKEND=mock is not permitted", result.stderr)

    def test_r2_backend_with_missing_credentials_fails_loudly(self):
        result = self._load_settings({"ASSET_STORAGE_BACKEND": "r2"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ImproperlyConfigured", result.stderr)
        self.assertIn("Production requires R2 storage configuration", result.stderr)

    def test_fully_configured_production_settings_load_successfully(self):
        """The one success case: every required variable genuinely
        present. Proves the strict checks aren't so strict they can
        never actually pass.
        """
        result = self._load_settings(
            {
                "PAYMENT_PROVIDER": "paddle",
                "PADDLE_API_KEY": "test_key",
                "PADDLE_CLIENT_TOKEN": "test_token",
                "PADDLE_WEBHOOK_SECRET": "test_secret",
                "ASSET_STORAGE_BACKEND": "r2",
                "R2_ACCESS_KEY_ID": "test_id",
                "R2_SECRET_ACCESS_KEY": "test_secret_key",
                "R2_BUCKET_NAME": "test-bucket",
                "R2_ENDPOINT_URL": "https://example.r2.cloudflarestorage.com",
            }
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("SETTINGS_LOADED_OK", result.stdout)

    def test_fully_configured_fastspring_production_settings_load_successfully(self):
        """The FastSpring counterpart to the Paddle success case above —
        proves the new branch isn't so strict it can never actually pass,
        with STORE_ID/CHECKOUT_ID left at their base.py defaults
        (confirmed account values, not overridden here).
        """
        result = self._load_settings(
            {
                "PAYMENT_PROVIDER": "fastspring",
                "FASTSPRING_API_USERNAME": "test_user",
                "FASTSPRING_API_PASSWORD": "test_pass",
                "FASTSPRING_ACCESS_KEY": "test_access_key",
                "FASTSPRING_WEBHOOK_SECRET": "test_webhook_secret",
                "ASSET_STORAGE_BACKEND": "r2",
                "R2_ACCESS_KEY_ID": "test_id",
                "R2_SECRET_ACCESS_KEY": "test_secret_key",
                "R2_BUCKET_NAME": "test-bucket",
                "R2_ENDPOINT_URL": "https://example.r2.cloudflarestorage.com",
            }
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("SETTINGS_LOADED_OK", result.stdout)

    def test_debug_is_hardcoded_false_even_if_env_says_otherwise(self):
        """`DEBUG = False` in production.py is a plain assignment, not
        `env.bool("DJANGO_DEBUG", ...)` — proves a stray
        `DJANGO_DEBUG=True` in the production environment can never
        flip it back on.
        """
        result = self._load_settings(
            {
                "DJANGO_DEBUG": "True",
                "PAYMENT_PROVIDER": "paddle",
                "PADDLE_API_KEY": "test_key",
                "PADDLE_CLIENT_TOKEN": "test_token",
                "PADDLE_WEBHOOK_SECRET": "test_secret",
                "ASSET_STORAGE_BACKEND": "r2",
                "R2_ACCESS_KEY_ID": "test_id",
                "R2_SECRET_ACCESS_KEY": "test_secret_key",
                "R2_BUCKET_NAME": "test-bucket",
                "R2_ENDPOINT_URL": "https://example.r2.cloudflarestorage.com",
            }
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        check = self._load_settings(
            {
                "DJANGO_DEBUG": "True",
                "PAYMENT_PROVIDER": "paddle",
                "PADDLE_API_KEY": "test_key",
                "PADDLE_CLIENT_TOKEN": "test_token",
                "PADDLE_WEBHOOK_SECRET": "test_secret",
                "ASSET_STORAGE_BACKEND": "r2",
                "R2_ACCESS_KEY_ID": "test_id",
                "R2_SECRET_ACCESS_KEY": "test_secret_key",
                "R2_BUCKET_NAME": "test-bucket",
                "R2_ENDPOINT_URL": "https://example.r2.cloudflarestorage.com",
            },
            code="import django; django.setup(); from django.conf import settings; print(settings.DEBUG)",
        )
        self.assertEqual(check.stdout.strip(), "False")

    def test_secure_proxy_ssl_header_is_set_for_a_tls_terminating_proxy(self):
        """Without this, `SECURE_SSL_REDIRECT=True` (the production
        default) behind a TLS-terminating reverse proxy — a PaaS edge,
        or the nginx/Caddy a VPS would use — produces an infinite
        redirect loop: Django only ever sees the proxy-to-app
        connection, which is plain HTTP, so every request looks
        insecure and gets redirected, including ones that already
        arrived over HTTPS at the edge. Confirmed live against a real
        gunicorn process during this fix: without this setting, the
        health endpoint returned 301 even when called exactly as
        the proxy would call it (Railway's edge, at the time); with
        this setting, 200.
        """
        check = self._load_settings(
            {
                "PAYMENT_PROVIDER": "paddle",
                "PADDLE_API_KEY": "test_key",
                "PADDLE_CLIENT_TOKEN": "test_token",
                "PADDLE_WEBHOOK_SECRET": "test_secret",
                "ASSET_STORAGE_BACKEND": "r2",
                "R2_ACCESS_KEY_ID": "test_id",
                "R2_SECRET_ACCESS_KEY": "test_secret_key",
                "R2_BUCKET_NAME": "test-bucket",
                "R2_ENDPOINT_URL": "https://example.r2.cloudflarestorage.com",
            },
            code=(
                "import django; django.setup(); from django.conf import settings; "
                "print(settings.SECURE_PROXY_SSL_HEADER)"
            ),
        )
        self.assertEqual(check.returncode, 0, check.stderr)
        self.assertEqual(check.stdout.strip(), "('HTTP_X_FORWARDED_PROTO', 'https')")


# ------------------------------------------------------------------
# The Supavisor-pooler-tolerant test-database teardown (see
# config/db_backends/postgresql_patient/creation.py) — proven here
# against a genuine second Postgres connection actually holding the
# throwaway database open, not a mock. Plain `unittest.TestCase`
# (not Django's `TestCase`) deliberately, so nothing here runs inside
# an ambient transaction — `CREATE DATABASE`/`DROP DATABASE` can't
# execute inside one regardless, and this keeps that fact explicit
# rather than relying on `_nodb_cursor()`'s internal autocommit
# handling to paper over it.
# ------------------------------------------------------------------

class PatientDatabaseCreationTests(unittest.TestCase):
    def setUp(self):
        self.db_name = f"patient_backend_test_{uuid.uuid4().hex[:8]}"
        with default_connection.creation._nodb_cursor() as cursor:
            cursor.execute(f'CREATE DATABASE "{self.db_name}"')

    def tearDown(self):
        # Best-effort cleanup — if a test already dropped it (the
        # success-path test), this is expected to no-op/fail quietly.
        try:
            with default_connection.creation._nodb_cursor() as cursor:
                cursor.execute(f'DROP DATABASE IF EXISTS "{self.db_name}"')
        except Exception:
            pass

    def _connection_params(self) -> dict:
        settings_dict = default_connection.settings_dict
        return {
            "host": settings_dict.get("HOST") or None,
            "port": settings_dict.get("PORT") or None,
            "user": settings_dict.get("USER"),
            "password": settings_dict.get("PASSWORD"),
            "dbname": self.db_name,
        }

    def test_retries_and_eventually_succeeds_once_the_blocking_session_closes(self):
        """The core scenario this class exists for: something else is
        still connected to the target database when teardown first
        tries to drop it. Patches `time.sleep` (the retry loop's own
        wait) purely to prove a retry actually happened (via
        `mock_sleep.call_count`) and to avoid depending on wall-clock
        assertions for pass/fail — but the side effect below still
        performs a genuine short wait via `threading.Event.wait()`
        (deliberately not `time.sleep`, since patching
        `creation.time.sleep` patches the real global `time` module
        object, which would freeze that too) before closing the
        blocking connection. That real wait matters: closing a
        connection through Supabase's Supavisor pooler does not
        guarantee the corresponding backend session is released
        instantly (this is the exact mechanism `PatientDatabaseCreation`
        exists to tolerate — see creation.py's module docstring) — an
        immediately-following retry with zero elapsed time can lose
        that race even though the connection genuinely was closed,
        which is what the first version of this test did, and why it
        failed even though the production retry logic (2 real seconds
        between attempts) was working correctly.
        """
        blocking_conn = psycopg.connect(**self._connection_params())
        released = threading.Event()

        def close_blocking_connection_after_a_real_short_wait(*_args, **_kwargs):
            # Every invocation waits for real — not just the first.
            # The earlier version only waited once (guarded by the
            # same `released` check as the close itself), which meant
            # every attempt after the first fired back-to-back with
            # zero delay: strictly *less* real cumulative wait time
            # than production's actual retry loop gets (~2s before
            # every attempt, up to 12s total across 6 attempts) — the
            # opposite of what this test is supposed to simulate, and
            # why it kept losing the pooler-propagation race even
            # though the real, unmocked retry logic was succeeding in
            # the same test run.
            threading.Event().wait(timeout=3)
            if not released.is_set():
                blocking_conn.close()
                released.set()

        creation = PatientDatabaseCreation(default_connection)
        with patch(
            "config.db_backends.postgresql_patient.creation.time.sleep",
            side_effect=close_blocking_connection_after_a_real_short_wait,
        ) as mock_sleep:
            creation._destroy_test_db(self.db_name, verbosity=0)

        self.assertTrue(released.is_set(), "the blocking connection was never closed")
        self.assertGreaterEqual(mock_sleep.call_count, 1, "no retry actually happened")

    def test_unrelated_operational_error_is_not_retried(self):
        """A real failure — wrong database name entirely — must raise
        immediately, not be silently absorbed into the multi-second
        retry loop meant only for the one specific transient error
        this class targets. Asserts on whether `time.sleep` (the
        retry loop's wait) was ever called, not on elapsed wall-clock
        time — a single real `DROP DATABASE` round-trip to a remote
        pooled instance can itself take several seconds depending on
        network conditions, which a fixed time threshold can't
        reliably distinguish from an actual retry.
        """
        creation = PatientDatabaseCreation(default_connection)
        with patch("config.db_backends.postgresql_patient.creation.time.sleep") as mock_sleep:
            with self.assertRaises(Exception):
                creation._destroy_test_db(f"does_not_exist_{uuid.uuid4().hex[:8]}", verbosity=0)
        mock_sleep.assert_not_called()
