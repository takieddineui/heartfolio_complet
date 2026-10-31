"""Make the live pages' WebP copies for photos stored before 31 Oct 2026.
DRY RUN unless --execute.

    python manage.py make_web_copies              # what it would do
    python manage.py make_web_copies --execute    # do it

WHY. Since 31 Oct 2026 every uploaded photo gets WebP copies at
`WEB_COPY_WIDTHS` beside its master (`apps.assets.images`), and the live
pages download those instead of the full photo: about 90 KB on a phone
instead of 3-4 MB. Photos stored earlier have none, so their pages keep
downloading the full file until this runs. Nothing breaks without it: a
photo with no copies is served as before.

RUN IT AFTER `move_assets_to_new_layout --execute` (its first run). It only
handles photos already under `uploads/`, so the copies land beside the new
keys; a photo still under an old key is counted and skipped.

WHAT --execute DOES, for each uploaded photo with no copies yet: reads the
stored file, writes the copies beside it, then, under a row lock and only if
the row still points at that file, records the copies' widths and the
photo's size. If the photo was deleted meanwhile, the copies are deleted
again. Safe to re-run: a photo that has its copies is skipped.

STORED FILES ARE NOT REWRITTEN. Their orientation and colour profile were
already lost at upload, so re-encoding them would fix nothing, and a smaller
file would change the prints of orders already paid.

The output never prints a key, only asset ids and counts.
"""

from __future__ import annotations

import io

from django.core.management.base import BaseCommand
from django.db import transaction
from PIL import Image, UnidentifiedImageError

from apps.assets.images import web_copy_key, web_copy_widths
from apps.assets.models import Asset
from apps.assets.services import UPLOADS_PREFIX, store_web_copies
from apps.assets.storage import AssetStorageError, get_asset_storage

PHOTO_TYPES = ("image/jpeg", "image/png", "image/webp")


def _decoded(data: bytes) -> Image.Image:
    with Image.open(io.BytesIO(data)) as image:
        image.load()
        has_alpha = image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info)
        return image.convert("RGBA" if has_alpha else "RGB")


class Command(BaseCommand):
    help = "Make WebP web copies for photos stored before 31 Oct 2026 (dry run unless --execute)."

    def add_arguments(self, parser):
        parser.add_argument("--execute", action="store_true", help="Actually make the copies. Without it, nothing changes.")
        parser.add_argument("--limit", type=int, default=None, help="Handle at most this many photos in this run (a trial run).")

    def handle(self, *args, **options):
        # `width` is set once a photo has been handled: one narrower than the
        # smallest copy has none and must not come back on every run.
        without_copies = Asset.objects.filter(
            status=Asset.STATUS_UPLOADED, mime_type__in=PHOTO_TYPES, web_widths=[], width__isnull=True
        )
        old_layout = without_copies.exclude(storage_key__startswith=UPLOADS_PREFIX).count()
        todo = list(without_copies.filter(storage_key__startswith=UPLOADS_PREFIX).order_by("created_at"))
        if options["limit"] is not None:
            todo = todo[: options["limit"]]

        self.stdout.write(f"{len(todo)} photo(s) to make web copies for.")
        if old_layout:
            self.stdout.write(self.style.WARNING(
                f"{old_layout} photo(s) still under an old key, skipped: run move_assets_to_new_layout --execute first."
            ))

        if not options["execute"]:
            for asset in todo:
                self.stdout.write(f"  would make copies for {asset.id}")
            self.stdout.write("DRY RUN: nothing was changed. Add --execute to do it.")
            return

        storage = get_asset_storage()
        made = failed = raced = 0
        for asset in todo:
            try:
                image = _decoded(storage.download(asset.storage_key))
            except (AssetStorageError, UnidentifiedImageError, OSError, ValueError) as exc:
                failed += 1
                self.stdout.write(self.style.WARNING(f"  {asset.id}: could not read the photo ({type(exc).__name__})"))
                continue

            widths = store_web_copies(storage, asset.storage_key, image)
            complete = widths == web_copy_widths(image.width)
            with transaction.atomic():
                current = Asset.objects.select_for_update().filter(id=asset.id).first()
                unchanged = (
                    current is not None
                    and current.status == Asset.STATUS_UPLOADED
                    and current.storage_key == asset.storage_key
                )
                if not (complete and unchanged):
                    # Deleted or moved meanwhile, or a copy failed to store:
                    # take back what was written, so a later run starts clean.
                    for width in widths:
                        try:
                            storage.delete(web_copy_key(asset.storage_key, width))
                        except AssetStorageError:
                            pass
                    if unchanged:
                        failed += 1
                        self.stdout.write(self.style.WARNING(f"  {asset.id}: a copy could not be stored"))
                    else:
                        raced += 1
                    continue
                current.web_widths = widths
                current.width, current.height = image.size
                current.save(update_fields=["web_widths", "width", "height", "updated_at"])
            made += 1

        self.stdout.write(self.style.SUCCESS(f"Made web copies for {made} photo(s)."))
        if failed or raced:
            self.stdout.write(self.style.WARNING(
                f"{failed} photo(s) could not be read or copied, {raced} changed meanwhile (left as they were). Run again to retry."
            ))
