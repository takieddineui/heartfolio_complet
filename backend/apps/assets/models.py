"""
`assets` app owns `Asset` — metadata only; the binary lives in external
object storage (added in a later phase). No upload handling, R2
integration, signed URLs, image processing, or virus scanning here.
"""

import uuid

from django.db import models

from apps.customers.models import Customer


class Asset(models.Model):
    STATUS_PENDING = "pending"
    STATUS_UPLOADED = "uploaded"
    STATUS_FAILED = "failed"
    STATUS_DELETED = "deleted"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_UPLOADED, "Uploaded"),
        (STATUS_FAILED, "Failed"),
        (STATUS_DELETED, "Deleted"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    customer = models.ForeignKey(
        Customer,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="assets",
        db_index=False,  # explicit named index below
        # Django's on_delete is application-level only — the actual
        # PostgreSQL FK constraint it creates carries no ON DELETE
        # clause (defaults to NO ACTION), so SET_NULL would only be
        # enforced when a delete goes through the Django ORM. The
        # approved schema requires DB-level enforcement independent of
        # application code, so Django's own FK constraint is suppressed
        # here (db_constraint=False) and replaced with a hand-written
        # one carrying an explicit ON DELETE SET NULL — see the RunSQL
        # in this app's migration.
        db_constraint=False,
    )
    storage_provider = models.CharField(max_length=50, default="r2")
    storage_key = models.TextField()
    original_filename = models.CharField(max_length=500, null=True, blank=True)
    mime_type = models.CharField(max_length=100)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_UPLOADED)
    #: §7 — when this asset should be swept if no paid order needs it.
    #:
    #: NULL means permanent — every photo, always (photos are needed by
    #: every pack, including Printable-only, so deferring them would cost
    #: nothing and risk a broken preview for no reason). Set at upload for
    #: video and audio specifically: those are only needed by Digital, AR
    #: or Complete (§5), so most uploads of them are never purchased, and
    #: storing every one forever is the real cost this field exists to
    #: bound.
    #:
    #: Cleared (set back to NULL) by `promote_media_assets_for_order` the
    #: moment a paid order's pack actually needs the asset — in the same
    #: transaction that grants entitlements, the same pattern already used
    #: for AR's `PublicExperience` row. A provisional asset that is never
    #: promoted is deleted by the `expire_provisional_assets` management
    #: command once this timestamp passes.
    expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "assets"
        indexes = [
            models.Index(fields=["customer"], name="idx_assets_customer_id"),
            models.Index(fields=["status"], name="idx_assets_status"),
            # For the expiry sweep's own query — finding provisional
            # assets past their TTL without a full table scan as this
            # table grows.
            models.Index(fields=["expires_at"], name="idx_assets_expires_at"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["storage_provider", "storage_key"],
                name="uq_assets_storage_provider_key",
            ),
            models.CheckConstraint(
                check=models.Q(status__in=["pending", "uploaded", "failed", "deleted"]),
                name="ck_assets_status_valid",
            ),
        ]

    def __str__(self) -> str:
        return str(self.id)
