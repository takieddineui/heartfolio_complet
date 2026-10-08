"""Tests for Telegram alerting (§9).

The concern throughout is that an alerting system fails in two directions,
and both are bad: too quiet and you are not told, too loud and you mute it
and are also not told. Most of these are about the second.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, override_settings

from apps.common import telegram


def result(key, status, label=None, detail=""):
    return SimpleNamespace(key=key, status=status, label=label or key, detail=detail)


class SendAlertTests(SimpleTestCase):
    @override_settings(TELEGRAM_BOT_TOKEN="", TELEGRAM_CHAT_ID="")
    def test_unconfigured_is_skipped_not_an_error(self):
        # Development and CI have no token. Nothing should need stubbing and
        # no local run should message a real phone.
        self.assertFalse(telegram.is_configured())
        self.assertFalse(telegram.send_alert("test"))

    @override_settings(TELEGRAM_BOT_TOKEN="t", TELEGRAM_CHAT_ID="1")
    def test_a_telegram_outage_never_raises(self):
        # This runs inside the payment webhook path. An exception escaping
        # would turn a Telegram outage into a failed payment confirmation,
        # inverting the priority entirely.
        with patch.object(telegram.requests, "post", side_effect=Exception("network")):
            self.assertFalse(telegram.send_alert("test"))

    @override_settings(TELEGRAM_BOT_TOKEN="t", TELEGRAM_CHAT_ID="1")
    def test_a_rejected_alert_is_reported_not_raised(self):
        with patch.object(telegram.requests, "post", return_value=MagicMock(status_code=400, text="bad chat")):
            self.assertFalse(telegram.send_alert("test"))

    @override_settings(TELEGRAM_BOT_TOKEN="t", TELEGRAM_CHAT_ID="1")
    def test_messages_are_sent_as_plain_text(self):
        # Markdown parsing fails on unescaped underscores and brackets, which
        # appear in target ids, order UUIDs and error strings — exactly what
        # an alert contains. A rejected alert is worse than an unformatted one.
        with patch.object(telegram.requests, "post", return_value=MagicMock(status_code=200)) as post:
            telegram.send_alert("print_a4_edged [failed]")
        payload = post.call_args.kwargs["json"]
        self.assertNotIn("parse_mode", payload)


class TransitionAlertTests(SimpleTestCase):
    """Alerting on changes rather than states — see the module docstring."""

    databases = {"default"}

    def setUp(self):
        from apps.common.models import ServiceAlertState

        ServiceAlertState.objects.all().delete()

    def _run(self, results):
        with patch.object(telegram, "send_alert", return_value=True) as send:
            telegram.alert_service_transitions(results)
        return [call.args[0] for call in send.call_args_list]

    def test_a_service_going_down_alerts_once_not_every_run(self):
        """The whole point. A service down overnight sends one message, not
        one per polling interval — alerts arriving every five minutes get
        muted, and the one that matters arrives silenced."""
        failing = [result("database", "failing", "Supabase", "connection refused")]

        first = self._run(failing)
        self.assertEqual(len(first), 1)
        self.assertIn("DOWN", first[0])

        second = self._run(failing)
        self.assertEqual(second, [])

    def test_recovery_is_alerted(self):
        # "Is it back?" is the question immediately after "is it down?".
        self._run([result("database", "failing", "Supabase")])
        messages = self._run([result("database", "ok", "Supabase")])
        self.assertEqual(len(messages), 1)
        self.assertIn("RECOVERED", messages[0])

    def test_a_healthy_service_seen_for_the_first_time_is_not_news(self):
        self.assertEqual(self._run([result("backend", "ok", "Backend")]), [])

    def test_unknown_never_alerts(self):
        # An unconfigured service in staging is not an outage, and alerting
        # on it would train the reader to ignore the channel.
        self.assertEqual(self._run([result("payments", "unknown", "Paddle")]), [])

    def test_state_is_recorded_even_when_the_send_fails(self):
        """Otherwise a Telegram outage during an incident would re-alert on
        every run once it came back — the storm this exists to prevent."""
        from apps.common.models import ServiceAlertState

        with patch.object(telegram, "send_alert", return_value=False):
            telegram.alert_service_transitions([result("database", "failing", "Supabase")])

        self.assertEqual(ServiceAlertState.objects.get(service_key="database").last_status, "failing")

    def test_each_service_is_tracked_independently(self):
        # One service flapping must not suppress an alert for another.
        self._run([result("database", "failing", "Supabase")])
        messages = self._run(
            [result("database", "failing", "Supabase"), result("storage", "failing", "R2")]
        )
        self.assertEqual(len(messages), 1)
        self.assertIn("R2", messages[0])
