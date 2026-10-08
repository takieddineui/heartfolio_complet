"""Operational state for the common app (§9)."""

from django.db import models


class ServiceAlertState(models.Model):
    """The last known status of one service, for alert deduplication (§9).

    Exists so alerts fire on CHANGES rather than on every scheduled run. A
    service down overnight should send one message, not one per polling
    interval — alerts that arrive every five minutes get muted, and the one
    that mattered arrives silenced.

    In the database rather than memory or a file because a redeployed
    container starts with a fresh filesystem: anything else would forget
    on every deploy and re-alert on everything already known about.
    """

    service_key = models.CharField(max_length=50, primary_key=True)
    #: "ok" or "failing". Empty means never observed — the first healthy
    #: reading of a new service is not news and is recorded silently.
    last_status = models.CharField(max_length=20, blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "service_alert_state"

    def __str__(self) -> str:
        return f"{self.service_key}: {self.last_status or 'unknown'}"
