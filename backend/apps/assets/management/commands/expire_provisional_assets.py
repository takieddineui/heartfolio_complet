"""§7 — deletes provisional media assets whose retention window has passed.

Run on a schedule (any scheduler; daily is plenty given a multi-day
retention window):

    python manage.py expire_provisional_assets

THIS IS THE OTHER HALF OF THE DEFERRED-MEDIA-STORAGE DESIGN. An asset gets
`expires_at` set at upload (video/audio only — see the `Asset.expires_at`
docstring) and cleared by `promote_media_assets_for_order` the moment a
paid order actually needs it. Anything still carrying a past `expires_at`
when this runs was never purchased for a delivery that needed it, and is
safe to delete — that is the entire cost-control mechanism §7 exists for.

SAME DELETE ORDER AS THE CUSTOMER-FACING `delete_asset`: storage first,
database second. If the R2 delete fails, the row is left untouched and
will simply be picked up again on the next run — safely retryable, nothing
silently lost. If storage succeeds but the DB update fails, the object is
genuinely gone from R2 but the row could still claim otherwise; this is the
same narrow, documented, accepted window `delete_asset` already has, not a
new risk this command introduces.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.utils import timezone


class Command(BaseCommand):
    help = "Deletes provisional (unpurchased) video/audio assets past their retention window."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="List what would be deleted without deleting anything.",
        )

    def handle(self, *args, **options):
        from apps.assets.models import Asset
        from apps.assets.storage import AssetStorageError, get_asset_storage

        expired = Asset.objects.filter(
            expires_at__isnull=False,
            expires_at__lte=timezone.now(),
        ).exclude(status=Asset.STATUS_DELETED)

        count = expired.count()
        if count == 0:
            self.stdout.write("No provisional assets are past their retention window.")
            return

        if options["dry_run"]:
            for asset in expired:
                self.stdout.write(f"would delete {asset.id} ({asset.mime_type}, expired {asset.expires_at})")
            self.stdout.write(f"{count} asset(s) would be deleted. Re-run without --dry-run to delete them.")
            return

        storage = get_asset_storage()
        deleted, failed = 0, 0

        for asset in expired:
            try:
                storage.delete(asset.storage_key)
            except AssetStorageError:
                # Left untouched — picked up again on the next scheduled
                # run rather than treated as a fatal error for the whole
                # sweep. One bad object must not block every other one.
                failed += 1
                continue

            asset.status = Asset.STATUS_DELETED
            asset.save(update_fields=["status", "updated_at"])
            deleted += 1

        self.stdout.write(f"Deleted {deleted} provisional asset(s).")
        if failed:
            self.stdout.write(self.style.WARNING(f"{failed} could not be deleted from storage and will retry next run."))
