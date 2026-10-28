"""The `uploads/<product>/<id>.<ext>` move and the removal of customers'
filenames (27 Oct 2026): `apps/assets/filenames.py`, project saves, and the
`move_assets_to_new_layout` command."""

from __future__ import annotations

import io
import uuid
from datetime import timedelta
from unittest.mock import patch

from django.core.management import call_command
from django.db import connection
from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from apps.customers.models import Customer
from apps.products.models import Product
from apps.projects.models import Project
from apps.projects.services import create_project, update_project

from .filenames import strip_media_filenames
from .models import Asset
from .storage import MockAssetStorage

COMMAND = "apps.assets.management.commands.move_assets_to_new_layout.get_asset_storage"
NAME = "Sarah_me_Paris_2019.jpg"


class StripMediaFilenamesTests(SimpleTestCase):
    def test_removes_filename_from_every_media_value_at_any_depth(self):
        data = {
            "version": 1,
            "values": {
                "photo": {"url": "blob:x", "mimeType": "image/jpeg", "filename": NAME, "assetId": "a"},
                "events": [{"title": "We met", "photo": {"url": "u", "mimeType": "image/png", "filename": "IMG_1.png"}}],
                "voices": [[{"url": "u", "mimeType": "audio/mp4", "filename": "voice-note.webm"}]],
            },
            "themeSelections": {},
        }
        stripped, removed = strip_media_filenames(data)
        self.assertEqual(removed, 3)
        self.assertNotIn("filename", stripped["values"]["photo"])
        self.assertEqual(stripped["values"]["photo"], {"url": "blob:x", "mimeType": "image/jpeg", "assetId": "a"})
        self.assertNotIn("filename", stripped["values"]["events"][0]["photo"])
        self.assertEqual(stripped["values"]["events"][0]["title"], "We met")
        self.assertNotIn("filename", stripped["values"]["voices"][0][0])
        # The input is not modified.
        self.assertEqual(data["values"]["photo"]["filename"], NAME)

    def test_a_field_called_filename_outside_a_media_value_is_kept(self):
        data = {"values": {"filename": "a customer's own text field"}}
        self.assertEqual(strip_media_filenames(data), (data, 0))


def _customer():
    return Customer.objects.create(email=f"guest-{uuid.uuid4().hex[:8]}@example.com")


def _product(slug):
    return Product.objects.get_or_create(
        slug=slug, defaults={"name_i18n_key": "x", "category": Product.CATEGORY_TIMELINE, "status": "available"}
    )[0]


def _data(*asset_ids, filename=NAME):
    return {
        "version": 1,
        "values": {"photos": [{"url": "u", "mimeType": "image/jpeg", "filename": filename, "assetId": str(a)} for a in asset_ids]},
        "themeSelections": {},
    }


class ProjectSaveStripsFilenamesTests(TestCase):
    def test_create_and_update_store_no_filename(self):
        _product("love-story-timeline")
        customer = _customer()
        project = create_project(customer, product_slug="love-story-timeline", data=_data("a"))
        self.assertNotIn("filename", Project.objects.get(id=project.id).data["values"]["photos"][0])

        update_project(customer, project.id, data=_data("a", "b", filename="PXL_20260514_190312345.jpg"))
        saved = Project.objects.get(id=project.id).data
        self.assertEqual(len(saved["values"]["photos"]), 2)
        self.assertTrue(all("filename" not in photo for photo in saved["values"]["photos"]))


class MoveAssetsCommandTests(TestCase):
    def setUp(self):
        self.storage = MockAssetStorage()
        self.customer = _customer()
        self.product = _product("love-story-timeline")

    def _old_asset(self, *, mime="image/jpeg", status=Asset.STATUS_UPLOADED, payload=b"photo-bytes", store=True):
        asset_id = uuid.uuid4()
        key = f"assets/{asset_id}/{NAME}"
        if store:
            self.storage.upload(key, io.BytesIO(payload), content_type=mime)
        return Asset.objects.create(
            id=asset_id, customer=self.customer, storage_key=key, original_filename="Sarah & me - Paris 2019.jpg",
            mime_type=mime, status=status,
        )

    def _project(self, *assets):
        return Project.objects.create(customer=self.customer, product=self.product, data=_data(*[a.id for a in assets]))

    def _run(self, *args, storage=None):
        out = io.StringIO()
        with patch(COMMAND, return_value=storage or self.storage):
            call_command("move_assets_to_new_layout", *args, stdout=out)
        return out.getvalue()

    def _backdate_moved(self, asset, hours):
        Asset.objects.filter(id=asset.id).update(moved_at=timezone.now() - timedelta(hours=hours))

    def test_dry_run_changes_nothing_and_prints_no_filename(self):
        asset = self._old_asset()
        self._project(asset)
        output = self._run()
        asset.refresh_from_db()
        self.assertTrue(asset.storage_key.startswith("assets/"))
        self.assertIsNotNone(asset.original_filename)
        self.assertIn("1 file(s) to move: love-story-timeline 1", output)
        self.assertIn("1 project(s) with filenames", output)
        self.assertIn("DRY RUN", output)
        self.assertNotIn("Sarah", output)
        self.assertIn("filename", Project.objects.get().data["values"]["photos"][0])

    def test_execute_copies_to_the_product_folder_and_keeps_the_old_object(self):
        asset = self._old_asset()
        self._project(asset)
        old_key = asset.storage_key
        output = self._run("--execute")
        asset.refresh_from_db()
        self.assertEqual(asset.storage_key, f"uploads/love-story-timeline/{asset.id}.jpg")
        self.assertEqual(self.storage.download(asset.storage_key), b"photo-bytes")
        self.assertTrue(self.storage.exists(old_key))  # kept for the grace period
        self.assertEqual(asset.previous_storage_key, old_key)
        self.assertIsNotNone(asset.moved_at)
        self.assertIsNone(asset.original_filename)
        self.assertNotIn("Sarah", output)

    def test_an_unreferenced_file_goes_to_unknown(self):
        asset = self._old_asset(mime="audio/mp4")
        self._run("--execute")
        asset.refresh_from_db()
        self.assertEqual(asset.storage_key, f"uploads/unknown/{asset.id}.m4a")

    def test_old_object_is_deleted_only_after_24_hours(self):
        asset = self._old_asset()
        old_key = asset.storage_key
        self._run("--execute")
        self._backdate_moved(asset, 23)
        self._run("--execute")
        self.assertTrue(self.storage.exists(old_key))
        self._backdate_moved(asset, 25)
        self._run("--execute")
        asset.refresh_from_db()
        self.assertFalse(self.storage.exists(old_key))
        self.assertTrue(self.storage.exists(asset.storage_key))
        self.assertIsNone(asset.previous_storage_key)
        self.assertIsNone(asset.moved_at)

    def test_old_object_of_a_file_deleted_during_the_grace_is_still_removed(self):
        asset = self._old_asset()
        old_key = asset.storage_key
        self._run("--execute")
        Asset.objects.filter(id=asset.id).update(status=Asset.STATUS_DELETED)
        self._backdate_moved(asset, 25)
        self._run("--execute")
        self.assertFalse(self.storage.exists(old_key))

    def test_a_second_run_moves_nothing_again(self):
        asset = self._old_asset()
        self._run("--execute")
        asset.refresh_from_db()
        first_key = asset.storage_key
        output = self._run("--execute")
        asset.refresh_from_db()
        self.assertEqual(asset.storage_key, first_key)
        self.assertIn("moved 0 file(s)", output)

    def test_a_file_changed_while_moving_is_left_alone_and_its_copy_removed(self):
        asset = self._old_asset()
        storage = self.storage
        original_copy = storage.copy

        def copy_then_customer_deletes(source, target):
            original_copy(source, target)
            Asset.objects.filter(id=asset.id).update(status=Asset.STATUS_DELETED)

        storage.copy = copy_then_customer_deletes
        output = self._run("--execute")
        asset.refresh_from_db()
        self.assertTrue(asset.storage_key.startswith("assets/"))
        self.assertIsNone(asset.previous_storage_key)
        self.assertFalse(storage.exists(f"uploads/unknown/{asset.id}.jpg"))
        self.assertIn("1 changed while moving", output)

    def test_a_copy_of_the_wrong_size_is_removed_and_the_row_kept(self):
        asset = self._old_asset()
        storage = self.storage
        real_size = storage.size
        storage.size = lambda key: 1 if key.startswith("uploads/") else real_size(key)
        self._run("--execute")
        asset.refresh_from_db()
        self.assertTrue(asset.storage_key.startswith("assets/"))
        self.assertFalse(any(key.startswith("uploads/") for key in storage._objects))

    def test_a_row_with_no_object_is_reported_and_left(self):
        asset = self._old_asset(store=False)
        output = self._run("--execute")
        asset.refresh_from_db()
        self.assertTrue(asset.storage_key.startswith("assets/"))
        self.assertIn(f"{asset.id}: no object at its key", output)

    def test_new_layout_and_deleted_files_are_not_moved_but_lose_their_filename(self):
        new = Asset.objects.create(customer=self.customer, storage_key=f"uploads/song-poster/{uuid.uuid4()}.jpg",
                                   mime_type="image/jpeg", original_filename="x.jpg")
        gone = self._old_asset(status=Asset.STATUS_DELETED, store=False)
        self._run("--execute")
        new.refresh_from_db(); gone.refresh_from_db()
        self.assertTrue(new.storage_key.startswith("uploads/song-poster/"))
        self.assertTrue(gone.storage_key.startswith("assets/"))
        self.assertIsNone(new.original_filename)
        self.assertIsNone(gone.original_filename)

    def test_project_filenames_are_removed_without_touching_updated_at(self):
        asset = self._old_asset()
        project = self._project(asset)
        # A draft last saved 300 days ago: the 12-month cleanup reads this.
        long_ago = timezone.now() - timedelta(days=300)
        with connection.cursor() as cursor:
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
            cursor.execute("ALTER TABLE projects DISABLE TRIGGER set_updated_at_projects")
            Project.objects.filter(id=project.id).update(updated_at=long_ago)
            cursor.execute("ALTER TABLE projects ENABLE TRIGGER set_updated_at_projects")
        self._run("--execute")
        project.refresh_from_db()
        self.assertNotIn("filename", project.data["values"]["photos"][0])
        self.assertEqual(project.data["values"]["photos"][0]["assetId"], str(asset.id))
        self.assertEqual(project.updated_at, long_ago)
        # And the trigger is back on for everything else.
        project.save()
        project.refresh_from_db()
        self.assertGreater(project.updated_at, long_ago)

    def test_limit_moves_only_that_many(self):
        first, second = self._old_asset(), self._old_asset()
        self._run("--execute", "--limit", "1")
        moved = Asset.objects.filter(storage_key__startswith="uploads/").count()
        self.assertEqual(moved, 1)


class MockStorageCopySizeTests(SimpleTestCase):
    def test_copy_and_size(self):
        storage = MockAssetStorage()
        storage.upload("a", io.BytesIO(b"12345"), content_type="image/jpeg")
        storage.copy("a", "b")
        self.assertEqual(storage.download("b"), b"12345")
        self.assertEqual(storage.size("b"), 5)
        self.assertIsNone(storage.size("missing"))


class R2CopySizeTests(SimpleTestCase):
    """The boto3 calls themselves, against a stub client (no network)."""

    def _storage(self, client):
        from .storage import R2Storage

        storage = R2Storage.__new__(R2Storage)
        storage._client = client
        storage._bucket = "bucket"
        return storage

    def test_copy_is_server_side_and_keeps_the_content_type(self):
        from unittest.mock import MagicMock

        client = MagicMock()
        self._storage(client).copy("assets/a/x.jpg", "uploads/p/a.jpg")
        client.copy_object.assert_called_once_with(
            Bucket="bucket", Key="uploads/p/a.jpg",
            CopySource={"Bucket": "bucket", "Key": "assets/a/x.jpg"}, MetadataDirective="COPY",
        )

    def test_size_reads_content_length_and_none_when_missing(self):
        from unittest.mock import MagicMock

        from botocore.exceptions import ClientError

        client = MagicMock()
        client.head_object.return_value = {"ContentLength": 42}
        self.assertEqual(self._storage(client).size("k"), 42)
        client.head_object.side_effect = ClientError({"Error": {"Code": "404"}}, "HeadObject")
        self.assertIsNone(self._storage(client).size("k"))
