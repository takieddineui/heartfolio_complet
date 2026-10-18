"""Tests for the ops status checks (§7b).

The thing this page exists for is being trustworthy when other things are
broken, so most of these are about failure: that a down service reports down,
that an unconfigured one does not cry wolf, and above all that nothing can
make the page itself fall over.
"""

from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, override_settings

from apps.common import service_health as sh


class ServiceHealthTests(SimpleTestCase):
    def test_a_check_that_raises_cannot_bring_down_the_page(self):
        """The property that matters most.

        A status page that 500s when a service is down is useless at exactly
        the moment it is opened. `CHECKS` is patched rather than an
        individual function because it holds direct references captured at
        import — patching `sh.check_database` would leave the real one in
        the tuple and silently test nothing.
        """
        def exploding_check():
            raise RuntimeError("boom")

        with patch.object(sh, "CHECKS", (sh.check_backend, exploding_check)):
            results = sh.run_all_checks()

        self.assertEqual(len(results), 2)
        self.assertEqual(results[0].status, sh.OK)
        self.assertEqual(results[1].status, sh.FAILING)
        self.assertIn("Check crashed", results[1].detail)

    # Every outside service unconfigured: this test is about the CHECKS tuple,
    # and with the environment's real keys it probed the real R2 bucket (found
    # 15 Oct 2026; tests never reach the network, see config/test_runner.py).
    @override_settings(R2_BUCKET_NAME="", R2_ACCESS_KEY_ID="", PADDLE_API_KEY="", FRONTEND_URL="")
    def test_every_registered_check_returns_a_result(self):
        # Guards the tuple and the functions staying in step — a check added
        # to the module but not to CHECKS would never run, and nothing else
        # would notice.
        results = sh.run_all_checks()
        self.assertEqual(len(results), len(sh.CHECKS))
        self.assertEqual(len({r.key for r in results}), len(results))

    def test_unconfigured_services_report_unknown_not_failing(self):
        # Paddle has no key locally and R2 has no bucket. Reporting those as
        # red would train the reader to ignore red.
        with override_settings(PADDLE_API_KEY="", R2_BUCKET_NAME="", R2_ACCESS_KEY_ID=""):
            self.assertEqual(sh.check_payments().status, sh.UNKNOWN)
            self.assertEqual(sh.check_storage().status, sh.UNKNOWN)

    @override_settings(PADDLE_API_KEY="key", PADDLE_ENVIRONMENT="sandbox")
    def test_a_rejected_paddle_key_reports_failing(self):
        # The case a naive ping would miss: Paddle is up, the key is revoked,
        # and every real payment is being refused.
        with patch.object(sh.requests, "get", return_value=MagicMock(status_code=403)):
            result = sh.check_payments()
        self.assertEqual(result.status, sh.FAILING)
        self.assertIn("rejected", result.detail)

    @override_settings(PADDLE_API_KEY="key", PADDLE_ENVIRONMENT="sandbox")
    def test_a_working_paddle_key_reports_ok_with_the_environment(self):
        # Sandbox vs production is worth seeing at a glance — "green" against
        # sandbox while believing you are live is its own kind of outage.
        with patch.object(sh.requests, "get", return_value=MagicMock(status_code=200)):
            result = sh.check_payments()
        self.assertEqual(result.status, sh.OK)
        self.assertIn("sandbox", result.detail)

    @override_settings(FRONTEND_URL="https://example.test")
    def test_a_5xx_storefront_reports_failing(self):
        with patch.object(sh.requests, "get", return_value=MagicMock(status_code=503)):
            self.assertEqual(sh.check_frontend().status, sh.FAILING)

    @override_settings(FRONTEND_URL="https://example.test")
    def test_an_unreachable_storefront_reports_failing_rather_than_raising(self):
        with patch.object(sh.requests, "get", side_effect=Exception("dns")):
            self.assertEqual(sh.check_frontend().status, sh.FAILING)

    def test_the_backend_reports_itself_up(self):
        # Trivially true, and listed anyway: a service missing from a status
        # page reads as an oversight.
        self.assertEqual(sh.check_backend().status, sh.OK)

    def test_overall_is_red_if_anything_is_failing(self):
        results = [
            sh.ServiceStatus("a", "A", sh.OK, ""),
            sh.ServiceStatus("b", "B", sh.FAILING, ""),
            sh.ServiceStatus("c", "C", sh.UNKNOWN, ""),
        ]
        self.assertEqual(sh.overall_status(results), sh.FAILING)

    def test_unknown_alone_does_not_make_the_headline_red(self):
        # An unconfigured service in staging is not an outage. A headline
        # that cries wolf stops being read.
        results = [sh.ServiceStatus("a", "A", sh.OK, ""), sh.ServiceStatus("b", "B", sh.UNKNOWN, "")]
        self.assertEqual(sh.overall_status(results), sh.UNKNOWN)

    def test_everything_green_is_green(self):
        results = [sh.ServiceStatus("a", "A", sh.OK, ""), sh.ServiceStatus("b", "B", sh.OK, "")]
        self.assertEqual(sh.overall_status(results), sh.OK)

    def test_details_are_truncated_so_one_error_cannot_flood_the_page(self):
        with override_settings(FRONTEND_URL="https://example.test"):
            with patch.object(sh.requests, "get", side_effect=Exception("x" * 5000)):
                self.assertLessEqual(len(sh.check_frontend().detail), 200)
