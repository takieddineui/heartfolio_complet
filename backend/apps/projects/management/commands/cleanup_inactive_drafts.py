"""Delete unbought drafts inactive for 12 months, with their uploads.
DRY RUN unless --execute.

    python manage.py cleanup_inactive_drafts                 # what would go
    python manage.py cleanup_inactive_drafts --execute       # delete (daily cron)

What qualifies, and which uploads go with a draft: apps/projects/draft_cleanup.py.
Nothing linked to an order, paid or not, is ever touched.

Safety, for a job that runs unattended:
- `--months` cannot go below 12, the privacy policy's promise.
- `--max-drafts` (default 200): if more drafts qualify than that, nothing is
  deleted and an alert is sent. A sudden flood more likely means something
  is wrong (dates reset, a filter broken) than that 200 drafts all turned
  12 months old on the same day.
- Each draft is checked again, under a row lock, just before it is deleted.
- Uploads are deleted from storage (R2) FIRST, then marked deleted, as
  `expire_provisional_assets` does. If any upload of a draft cannot be
  deleted from storage, that draft is kept, and the next run retries it.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.assets.models import Asset
from apps.assets.storage import AssetStorageError, get_asset_storage
from apps.common.telegram import send_alert
from apps.projects.draft_cleanup import MINIMUM_MONTHS, build_plan, still_qualifies
from apps.projects.models import Project


class Command(BaseCommand):
    help = "Delete unbought drafts inactive for 12 months, and their uploads (dry run unless --execute)."

    def add_arguments(self, parser):
        parser.add_argument("--months", type=int, default=MINIMUM_MONTHS, help="Inactivity window (at least 12).")
        parser.add_argument("--execute", action="store_true", help="Actually delete. Without it, nothing changes.")
        parser.add_argument("--max-drafts", type=int, default=200, help="Refuse to delete anything if more drafts qualify.")

    def handle(self, *args, **options):
        months = options["months"]
        if months < MINIMUM_MONTHS:
            raise CommandError(f"--months must be at least {MINIMUM_MONTHS}: the privacy policy promises 12 months.")

        plans, unreferenced = build_plan(months)
        asset_count = sum(len(plan.assets) for plan in plans)
        for plan in plans:
            self.stdout.write(
                f"{plan.project.id}  {plan.project.product_id}  last saved {plan.project.updated_at:%Y-%m-%d}  "
                f"{len(plan.assets)} upload(s)"
            )
        self.stdout.write(f"{len(plans)} draft(s) inactive for {months}+ months, with {asset_count} upload(s).")
        self.stdout.write(f"{unreferenced} upload(s) belong to no project at all; this command never touches them.")

        if not options["execute"]:
            self.stdout.write("DRY RUN: nothing was deleted. Add --execute to delete.")
            return
        if len(plans) > options["max_drafts"]:
            send_alert(
                "DRAFT CLEANUP REFUSED\n"
                f"{len(plans)} drafts qualify, more than --max-drafts {options['max_drafts']}.\n"
                "Nothing was deleted. Check the dry run before raising the cap."
            )
            raise CommandError(
                f"{len(plans)} drafts qualify, more than --max-drafts {options['max_drafts']}. Nothing was deleted."
            )

        storage = get_asset_storage()
        deleted_drafts = deleted_assets = kept_drafts = 0
        for plan in plans:
            with transaction.atomic():
                project = Project.objects.select_for_update().filter(id=plan.project.id).first()
                if project is None or not still_qualifies(project.id, months):
                    kept_drafts += 1
                    continue
                failed = False
                for asset in plan.assets:
                    try:
                        storage.delete(asset.storage_key)
                    except AssetStorageError:
                        failed = True
                        continue
                    Asset.objects.filter(id=asset.id).update(status=Asset.STATUS_DELETED, updated_at=timezone.now())
                    deleted_assets += 1
                if failed:
                    kept_drafts += 1
                    continue
                project.delete()
                deleted_drafts += 1

        self.stdout.write(
            self.style.SUCCESS(f"Deleted {deleted_drafts} draft(s) and {deleted_assets} upload(s).")
        )
        if kept_drafts:
            self.stdout.write(
                self.style.WARNING(f"{kept_drafts} draft(s) kept: no longer qualifying, or an upload could not be deleted (retried next run).")
            )
