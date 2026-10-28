"""Move uploads stored before 27 Oct 2026 to the `uploads/<product>/<id>.<ext>`
layout, and remove customers' filenames. DRY RUN unless --execute.

    python manage.py move_assets_to_new_layout              # what it would do
    python manage.py move_assets_to_new_layout --execute    # do it
    python manage.py move_assets_to_new_layout --execute    # again, 24h later

WHY. Older keys end in the customer's own filename (`assets/<id>/<name>`), and
every presigned link carries the key, so a gift's recipient could read the
buyer's filename. New uploads already use the new layout
(`apps.assets.services.generate_storage_key`).

WHAT --execute DOES, in this order. Each step is safe to re-run; a run that
stops halfway is finished by the next one.

1. DELETES THE OLD OBJECTS of files moved more than 24 hours ago
   (`Asset.previous_storage_key`), then clears the bookkeeping. 24 hours
   because a live page open at the moment of the move holds a five-minute
   link to the old key, and Love Story Timeline's and Song Poster's pages do
   not fetch a fresh one.
2. MOVES each uploaded file still under an old key: server-side copy to the
   new key, check the copy's size equals the original's, then, under a row
   lock and only if the row still points at the old key, point it at the new
   one and record the old key for step 1. If the row changed meanwhile
   (deleted by the customer or a cleanup job), the copy is deleted instead.
   The product folder is the product of a project that references the file;
   a file no project references goes to `uploads/unknown/`.
3. CLEARS `original_filename` on every asset row.
4. REMOVES `filename` from the media values saved in every project
   (`apps/assets/filenames.py`), with the `updated_at` trigger disabled for
   that one transaction: the trigger would otherwise stamp every project as
   active today, and `updated_at` is what the 12-month draft cleanup reads.

Nothing that reads assets changes: every reader goes through
`Asset.storage_key`, so a file is served from its old key until the moment
its row points at the new one. The output never prints a key or a filename,
only asset ids and counts.
"""

from __future__ import annotations

from collections import Counter
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import connection, transaction
from django.utils import timezone

from apps.assets.filenames import strip_media_filenames
from apps.assets.models import Asset
from apps.assets.services import UPLOADS_PREFIX, generate_storage_key
from apps.assets.storage import AssetStorageError, get_asset_storage
from apps.projects.draft_cleanup import referenced_asset_ids
from apps.projects.models import Project

#: How long an old object survives its move. See step 1 in the docstring.
OLD_KEY_GRACE = timedelta(hours=24)


def _product_by_asset() -> dict[str, str]:
    """Asset id -> the slug of a product whose project references it. An
    asset reused by several projects of one customer is in one product's
    folder; any of them is right, since the key is only a location."""
    found: dict[str, str] = {}
    for slug, data in Project.objects.values_list("product__slug", "data").order_by("created_at"):
        for asset_id in referenced_asset_ids(data):
            found.setdefault(asset_id, slug)
    return found


class Command(BaseCommand):
    help = "Move uploads to uploads/<product>/<id>.<ext> and remove customers' filenames (dry run unless --execute)."

    def add_arguments(self, parser):
        parser.add_argument("--execute", action="store_true", help="Actually move and delete. Without it, nothing changes.")
        parser.add_argument("--limit", type=int, default=None, help="Move at most this many files in this run (a trial run).")

    def handle(self, *args, **options):
        execute = options["execute"]
        now = timezone.now()
        storage = get_asset_storage()

        due = Asset.objects.filter(previous_storage_key__isnull=False, moved_at__lte=now - OLD_KEY_GRACE)
        waiting = Asset.objects.filter(previous_storage_key__isnull=False, moved_at__gt=now - OLD_KEY_GRACE).count()
        to_move = list(
            Asset.objects.filter(status=Asset.STATUS_UPLOADED)
            .exclude(storage_key__startswith=UPLOADS_PREFIX)
            .order_by("created_at")
        )
        if options["limit"] is not None:
            to_move = to_move[: options["limit"]]
        products = _product_by_asset()
        named = Asset.objects.exclude(original_filename__isnull=True).count()
        projects_with_names = [
            project_id
            for project_id, data in Project.objects.values_list("id", "data")
            if strip_media_filenames(data)[1]
        ]

        by_product = Counter(products.get(str(asset.id), "unknown") for asset in to_move)
        self.stdout.write(f"{due.count()} old object(s) past the {OLD_KEY_GRACE} grace, to delete.")
        self.stdout.write(f"{waiting} old object(s) still inside the grace, kept for now.")
        self.stdout.write(f"{len(to_move)} file(s) to move: " + (", ".join(f"{slug} {n}" for slug, n in sorted(by_product.items())) or "none"))
        self.stdout.write(f"{named} asset row(s) with an original filename to clear.")
        self.stdout.write(f"{len(projects_with_names)} project(s) with filenames in their saved data.")

        if not execute:
            for asset in to_move:
                self.stdout.write(f"  would move {asset.id} -> {generate_storage_key(asset.id, asset.mime_type, products.get(str(asset.id)))}")
            self.stdout.write("DRY RUN: nothing was changed. Add --execute to do it.")
            return

        deleted, delete_failed = self._delete_old_objects(storage, due)
        moved, move_failed, raced = self._move(storage, to_move, products)
        cleared = Asset.objects.exclude(original_filename__isnull=True).update(original_filename=None)
        stripped = self._strip_project_filenames(projects_with_names)

        self.stdout.write(self.style.SUCCESS(
            f"Deleted {deleted} old object(s); moved {moved} file(s); cleared {cleared} filename(s) on assets; "
            f"removed filenames from {stripped} project(s)."
        ))
        if delete_failed or move_failed or raced:
            self.stdout.write(self.style.WARNING(
                f"{delete_failed} old object(s) could not be deleted, {move_failed} file(s) could not be moved, "
                f"{raced} changed while moving (left as they were). Run again to retry."
            ))
        if moved:
            self.stdout.write(f"Run --execute again after {OLD_KEY_GRACE} to delete the {moved} old object(s) just moved.")

    def _delete_old_objects(self, storage, due):
        deleted = failed = 0
        for asset in due:
            try:
                storage.delete(asset.previous_storage_key)
            except AssetStorageError:
                failed += 1
                continue
            Asset.objects.filter(id=asset.id, previous_storage_key=asset.previous_storage_key).update(
                previous_storage_key=None, moved_at=None
            )
            deleted += 1
        return deleted, failed

    def _move(self, storage, to_move, products):
        moved = failed = raced = 0
        for asset in to_move:
            old_key = asset.storage_key
            new_key = generate_storage_key(asset.id, asset.mime_type, products.get(str(asset.id)))
            try:
                original_size = storage.size(old_key)
                if original_size is None:
                    # No object behind the row: nothing to copy. Reported,
                    # never "fixed" by pointing the row somewhere else.
                    self.stdout.write(self.style.WARNING(f"  {asset.id}: no object at its key; left as it was."))
                    failed += 1
                    continue
                storage.copy(old_key, new_key)
                if storage.size(new_key) != original_size:
                    storage.delete(new_key)
                    self.stdout.write(self.style.WARNING(f"  {asset.id}: the copy's size differs; copy removed, left as it was."))
                    failed += 1
                    continue
            except AssetStorageError:
                self.stdout.write(self.style.WARNING(f"  {asset.id}: storage error; left as it was."))
                failed += 1
                continue

            with transaction.atomic():
                updated = (
                    Asset.objects.select_for_update()
                    .filter(id=asset.id, status=Asset.STATUS_UPLOADED, storage_key=old_key)
                    .update(storage_key=new_key, previous_storage_key=old_key, moved_at=timezone.now(), original_filename=None)
                )
            if updated:
                moved += 1
                continue
            # Deleted or changed between the read and the lock: the copy is
            # nobody's, and the row's own key is left to its own jobs.
            raced += 1
            try:
                storage.delete(new_key)
            except AssetStorageError:
                self.stdout.write(self.style.WARNING(f"  {asset.id}: changed while moving, and its copy could not be removed."))
        return moved, failed, raced

    def _strip_project_filenames(self, project_ids) -> int:
        if not project_ids:
            return 0
        stripped = 0
        with transaction.atomic():
            # `.update()` sends no `updated_at`, but the database trigger would
            # set it anyway; disabled for this transaction only (it takes a
            # brief exclusive lock on `projects`), as the cleanup tests do.
            # Constraints are checked immediately in this transaction: with a
            # deferred foreign-key check pending, Postgres refuses the ALTER
            # that switches the trigger back on.
            with connection.cursor() as cursor:
                cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
                cursor.execute("ALTER TABLE projects DISABLE TRIGGER set_updated_at_projects")
            for project in Project.objects.select_for_update().filter(id__in=project_ids):
                data, removed = strip_media_filenames(project.data)
                if removed:
                    Project.objects.filter(id=project.id).update(data=data)
                    stripped += 1
            with connection.cursor() as cursor:
                cursor.execute("ALTER TABLE projects ENABLE TRIGGER set_updated_at_projects")
        return stripped
