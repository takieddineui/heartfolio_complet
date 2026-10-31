"""What an uploaded photo becomes (owner, 31 Oct 2026; `apps/assets/images.py`):
upright, sRGB, no metadata, capped at what prints need, with WebP copies for
the live pages that every delete path removes too."""

from __future__ import annotations

import io
import struct
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase
from PIL import Image, ImageCms

from apps.assets import images
from apps.assets.images import MASTER_LONG_EDGE, MASTER_SHORT_EDGE, master_size, prepare_master, web_copy_key
from apps.assets.models import Asset
from apps.assets.services import delete_asset, photo_payload, upload_asset
from apps.assets.storage import AssetStorageError, get_asset_storage
from apps.customers.models import Customer

GPS = {1: "N", 2: (48.0, 51.0, 24.12), 3: "E", 4: (2.0, 21.0, 3.48)}


def _s15(value):
    return struct.pack(">i", round(value * 65536))


def display_p3_profile() -> bytes:
    """A matrix/TRC Display P3 profile (Apple's D50 colorants, the sRGB curve),
    as every recent iPhone embeds."""
    def xyz(x, y, z):
        return b"XYZ " + b"\0" * 4 + _s15(x) + _s15(y) + _s15(z)

    curve = b"para" + b"\0" * 4 + struct.pack(">HH", 3, 0) + b"".join(
        _s15(v) for v in (2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045)
    )
    text = b"Display P3\0"
    desc = b"desc" + b"\0" * 4 + struct.pack(">I", len(text)) + text + b"\0" * 79
    tags = [
        (b"desc", desc), (b"wtpt", xyz(0.9642, 1.0, 0.8249)),
        (b"rXYZ", xyz(0.515121, 0.241196, -0.001053)), (b"gXYZ", xyz(0.291977, 0.692245, 0.041885)),
        (b"bXYZ", xyz(0.157104, 0.066574, 0.784073)), (b"rTRC", curve), (b"gTRC", curve), (b"bTRC", curve),
        (b"cprt", b"text" + b"\0" * 4 + b"none\0"),
    ]
    offset = 128 + 4 + 12 * len(tags)
    table, data = b"", b""
    for signature, body in tags:
        while (offset + len(data)) % 4:
            data += b"\0"
        table += signature + struct.pack(">II", offset + len(data), len(body))
        data += body
    body = struct.pack(">I", len(tags)) + table + data
    header = (
        struct.pack(">I", 128 + len(body)) + b"lcms" + bytes([2, 0x10, 0, 0]) + b"mntrRGB XYZ " + b"\0" * 12
        + b"acspAPPL" + b"\0" * 24 + _s15(0.9642) + _s15(1.0) + _s15(0.8249) + b"\0" * 48
    )
    return header + body


def phone_jpeg(width, height, *, orientation=1, icc=None, colour=(200, 80, 60), mark=True) -> bytes:
    """A JPEG as a phone writes it: `width` x `height` STORED pixels, an
    orientation tag, GPS, a camera make; a dark block in the stored image's
    top-left corner so the tests can see where it went."""
    image = Image.new("RGB", (width, height), colour)
    if mark:
        image.paste((0, 0, 0), (0, 0, width // 4, height // 4))
    exif = Image.Exif()
    exif[0x010F], exif[0x0112] = "samsung", orientation
    exif[0x8825] = GPS
    buffer = io.BytesIO()
    options = {"icc_profile": icc} if icc else {}
    image.save(buffer, format="JPEG", quality=95, exif=exif.tobytes(), **options)
    return buffer.getvalue()


def as_upload(data: bytes, name="photo.jpg", content_type="image/jpeg"):
    return SimpleUploadedFile(name, data, content_type=content_type)


def opened(data: bytes) -> Image.Image:
    image = Image.open(io.BytesIO(data))
    image.load()
    return image


class MasterTests(TestCase):
    def test_a_sideways_phone_photo_is_stored_upright(self):
        # Orientation 6: stored landscape, shown rotated 90 degrees clockwise.
        # The stored top-left block must end up top-RIGHT once upright.
        master = opened(prepare_master(as_upload(phone_jpeg(800, 600, orientation=6)), "image/jpeg").content)
        self.assertEqual(master.size, (600, 800))
        self.assertLess(sum(master.getpixel((590, 10))), 60, "the corner block is where the phone showed it")
        self.assertGreater(sum(master.getpixel((10, 10))), 250)

    def test_every_orientation_comes_out_as_the_phone_showed_it(self):
        for orientation in range(1, 9):
            with self.subTest(orientation=orientation):
                data = phone_jpeg(800, 600, orientation=orientation)
                expected = Image.open(io.BytesIO(data))
                from PIL import ImageOps

                expected = ImageOps.exif_transpose(expected)
                master = opened(prepare_master(as_upload(data), "image/jpeg").content)
                self.assertEqual(master.size, expected.size)

    def test_no_metadata_survives_gps_above_all(self):
        source = opened(phone_jpeg(800, 600, orientation=6, icc=display_p3_profile()))
        self.assertEqual(source.getexif().get_ifd(0x8825)[1], "N", "the test file really carries GPS")

        master = opened(prepare_master(as_upload(phone_jpeg(800, 600, orientation=6, icc=display_p3_profile())), "image/jpeg").content)

        self.assertEqual(dict(master.getexif()), {})
        self.assertEqual(master.getexif().get_ifd(0x8825), {})
        self.assertIsNone(master.info.get("icc_profile"))
        self.assertIsNone(master.info.get("exif"))

    def test_a_display_p3_photo_is_converted_to_srgb(self):
        intended = (200, 80, 60)
        p3 = display_p3_profile()
        in_p3 = ImageCms.profileToProfile(
            Image.new("RGB", (64, 64), intended), ImageCms.createProfile("sRGB"),
            ImageCms.ImageCmsProfile(io.BytesIO(p3)), outputMode="RGB",
        )
        buffer = io.BytesIO()
        in_p3.save(buffer, format="JPEG", quality=100, subsampling=0, icc_profile=p3)
        stored_numbers = in_p3.getpixel((32, 32))
        self.assertGreater(max(abs(a - b) for a, b in zip(stored_numbers, intended)), 8, "P3 numbers differ from sRGB's")

        master = opened(prepare_master(as_upload(buffer.getvalue()), "image/jpeg").content)

        got = master.getpixel((32, 32))
        self.assertLessEqual(max(abs(a - b) for a, b in zip(got, intended)), 3, f"{got} is not {intended}")

    def test_the_size_is_capped_at_what_prints_need_and_never_upscaled(self):
        self.assertEqual(master_size(4032, 3024), (4032, 3024), "a 12 MP phone photo keeps every pixel")
        self.assertEqual(master_size(4000, 6000), (3072, 4608))
        self.assertEqual(master_size(8160, 6120), (4096, 3072))
        self.assertEqual(master_size(12000, 2000), (6144, 1024), "a panorama is held by its long edge")
        self.assertEqual(master_size(800, 600), (800, 600))
        self.assertEqual((MASTER_SHORT_EDGE, MASTER_LONG_EDGE), (3072, 6144))

        master = opened(prepare_master(as_upload(phone_jpeg(8160, 6120, orientation=6, mark=False)), "image/jpeg").content)
        self.assertEqual(master.size, (3072, 4096), "capped after turning upright")

    def test_jpeg_keeps_quality_92(self):
        with patch.object(Image.Image, "save", autospec=True, side_effect=Image.Image.save) as save:
            prepare_master(as_upload(phone_jpeg(400, 300)), "image/jpeg")
        self.assertEqual(save.call_args.kwargs["quality"], 92)
        self.assertNotIn("exif", save.call_args.kwargs)

    def test_a_png_cut_out_keeps_its_transparency_and_format(self):
        image = Image.new("RGBA", (5000, 3500), (10, 200, 30, 0))
        image.paste((10, 200, 30, 255), (1000, 1000, 2000, 2000))
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")

        master = opened(prepare_master(as_upload(buffer.getvalue(), "cut.png", "image/png"), "image/png").content)

        self.assertEqual((master.format, master.mode), ("PNG", "RGBA"))
        self.assertEqual(master.size, (4389, 3072))
        self.assertEqual(master.getpixel((5, 5))[3], 0)


class WebCopyTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(email="web-copies@example.com")
        self.storage = get_asset_storage()

    def _upload(self, width, height, **kwargs):
        return upload_asset(self.customer, as_upload(phone_jpeg(width, height, **kwargs)), product_slug=None)

    def test_an_upload_stores_its_copies_beside_the_master(self):
        asset = self._upload(4032, 3024, orientation=6)

        self.assertEqual((asset.width, asset.height), (3024, 4032))
        self.assertEqual(asset.web_widths, [480, 960, 1600])
        for width in (480, 960, 1600):
            key = web_copy_key(asset.storage_key, width)
            self.assertEqual(key, asset.storage_key.removesuffix(".jpg") + f".w{width}.webp")
            copy = opened(self.storage.download(key))
            self.assertEqual((copy.format, copy.width), ("WEBP", width))
            self.assertEqual(copy.height, round(4032 * width / 3024))
        reloaded = Asset.objects.get(id=asset.id)
        self.assertEqual((reloaded.width, reloaded.height, reloaded.web_widths), (3024, 4032, [480, 960, 1600]))

    def test_a_narrow_photo_gets_only_the_copies_it_can_fill(self):
        self.assertEqual(self._upload(1200, 900).web_widths, [480, 960])
        self.assertEqual(self._upload(400, 300).web_widths, [])

    def test_a_copy_that_fails_to_store_never_fails_the_upload(self):
        real = type(self.storage).upload

        def failing(storage, key, file_obj, *, content_type):
            if key.endswith(".w960.webp"):
                raise AssetStorageError("down")
            return real(storage, key, file_obj, content_type=content_type)

        with patch.object(type(self.storage), "upload", failing):
            asset = self._upload(2000, 1500)
        self.assertEqual(asset.status, Asset.STATUS_UPLOADED)
        self.assertEqual(asset.web_widths, [480, 1600])

    def test_media_get_no_size_and_no_copies(self):
        asset = Asset.objects.create(customer=self.customer, storage_key="uploads/x/a.m4a", mime_type="audio/mp4")
        self.assertEqual(photo_payload(asset), {"url": self.storage.generate_access_url("uploads/x/a.m4a")})

    def test_the_payload_offers_every_copy_and_the_size(self):
        asset = self._upload(4032, 3024)
        payload = photo_payload(asset)
        self.assertEqual(payload["url"], self.storage.generate_access_url(web_copy_key(asset.storage_key, 960)))
        self.assertEqual(
            payload["srcset"],
            ", ".join(f"{self.storage.generate_access_url(web_copy_key(asset.storage_key, w))} {w}w" for w in (480, 960, 1600)),
        )
        self.assertEqual((payload["width"], payload["height"]), (4032, 3024))

    def test_a_photo_stored_before_copies_existed_is_served_as_before(self):
        asset = Asset.objects.create(customer=self.customer, storage_key="assets/x/a.jpg", mime_type="image/jpeg")
        self.assertEqual(photo_payload(asset), {"url": self.storage.generate_access_url("assets/x/a.jpg")})

    def test_the_studio_previews_the_largest_copy(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.post("/api/v1/guest/", {"email": "studio-preview@example.com"}, format="json")
        response = client.post("/api/v1/assets/", {"file": as_upload(phone_jpeg(4032, 3024))}, format="multipart")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(response.data["previewUrl"].endswith(".w1600.webp"))
        self.assertTrue(response.data["url"].endswith(".jpg"))

    def test_deleting_an_asset_deletes_its_copies(self):
        asset = self._upload(2000, 1500)
        keys = [asset.storage_key, *(web_copy_key(asset.storage_key, w) for w in asset.web_widths)]
        self.assertTrue(all(self.storage.exists(key) for key in keys))

        delete_asset(self.customer, asset.id)

        self.assertEqual([key for key in keys if self.storage.exists(key)], [])

    def test_the_provisional_media_sweep_uses_the_same_deletion(self):
        from django.utils import timezone

        asset = self._upload(2000, 1500)
        Asset.objects.filter(id=asset.id).update(expires_at=timezone.now())
        call_command("expire_provisional_assets", stdout=io.StringIO())
        self.assertFalse(self.storage.exists(web_copy_key(asset.storage_key, 960)))


class MakeWebCopiesCommandTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(email="copies-command@example.com")
        self.storage = get_asset_storage()

    def _old_photo(self, width=2000, height=1500, key=None):
        """A photo as stored before 31 Oct 2026: a master, no copies, no size."""
        asset = upload_asset(self.customer, as_upload(phone_jpeg(width, height)), product_slug=None)
        for w in asset.web_widths:
            self.storage.delete(web_copy_key(asset.storage_key, w))
        if key:
            self.storage.copy(asset.storage_key, key)
        Asset.objects.filter(id=asset.id).update(web_widths=[], width=None, height=None, **({"storage_key": key} if key else {}))
        return Asset.objects.get(id=asset.id)

    def _run(self, *args):
        out = io.StringIO()
        call_command("make_web_copies", *args, stdout=out)
        return out.getvalue()

    def test_the_dry_run_changes_nothing(self):
        asset = self._old_photo()
        output = self._run()
        self.assertIn("1 photo(s) to make web copies for.", output)
        self.assertIn("DRY RUN", output)
        self.assertEqual(Asset.objects.get(id=asset.id).web_widths, [])
        self.assertFalse(self.storage.exists(web_copy_key(asset.storage_key, 480)))
        self.assertNotIn(asset.storage_key, output, "never prints a key")

    def test_execute_makes_the_copies_and_records_the_size_once(self):
        asset = self._old_photo()
        self.assertIn("Made web copies for 1 photo(s).", self._run("--execute"))

        asset.refresh_from_db()
        self.assertEqual((asset.web_widths, asset.width, asset.height), ([480, 960, 1600], 2000, 1500))
        self.assertTrue(all(self.storage.exists(web_copy_key(asset.storage_key, w)) for w in (480, 960, 1600)))
        self.assertIn("0 photo(s) to make web copies for.", self._run("--execute"), "safe to re-run")

    def test_a_photo_narrower_than_any_copy_is_handled_once(self):
        asset = self._old_photo(400, 300)
        self._run("--execute")
        asset.refresh_from_db()
        self.assertEqual((asset.web_widths, asset.width), ([], 400))
        self.assertIn("0 photo(s) to make web copies for.", self._run())

    def test_a_photo_under_an_old_key_waits_for_the_move(self):
        asset = self._old_photo(key="assets/legacy/IMG_0001.jpg")
        output = self._run("--execute")
        self.assertIn("1 photo(s) still under an old key, skipped", output)
        self.assertEqual(Asset.objects.get(id=asset.id).web_widths, [])
        self.assertFalse(self.storage.exists(web_copy_key("assets/legacy/IMG_0001.jpg", 480)))

    def test_a_failed_copy_is_taken_back_and_retried_next_run(self):
        asset = self._old_photo()
        real = type(self.storage).upload

        def failing(storage, key, file_obj, *, content_type):
            if key.endswith(".w960.webp"):
                raise AssetStorageError("down")
            return real(storage, key, file_obj, content_type=content_type)

        with patch.object(type(self.storage), "upload", failing):
            output = self._run("--execute")
        self.assertIn("1 photo(s) could not be read or copied", output)
        self.assertEqual(Asset.objects.get(id=asset.id).web_widths, [])
        self.assertFalse(self.storage.exists(web_copy_key(asset.storage_key, 480)), "partial copies are taken back")
        self.assertIn("Made web copies for 1 photo(s).", self._run("--execute"))

    def test_a_photo_deleted_meanwhile_keeps_no_copies(self):
        asset = self._old_photo()
        real = images.make_web_copies

        def delete_then_copy(image):
            Asset.objects.filter(id=asset.id).update(status=Asset.STATUS_DELETED)
            return real(image)

        with patch("apps.assets.services.make_web_copies", delete_then_copy):
            output = self._run("--execute")
        self.assertIn("1 changed meanwhile", output)
        self.assertFalse(self.storage.exists(web_copy_key(asset.storage_key, 480)))


class MigrationOrderTests(TestCase):
    def test_code_from_before_the_new_columns_can_still_insert_assets(self):
        """`assets.0003` may be applied before the code that knows its
        columns is deployed: an INSERT that names none of them must work."""
        from django.db import connection

        customer = Customer.objects.create(email="old-code@example.com")
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO assets (id, customer_id, storage_provider, storage_key, mime_type, status, created_at, updated_at) "
                "VALUES (gen_random_uuid(), %s, 'r2', 'uploads/x/old.jpg', 'image/jpeg', 'uploaded', now(), now())",
                [customer.id],
            )
        asset = Asset.objects.get(storage_key="uploads/x/old.jpg")
        self.assertEqual((asset.web_widths, asset.width, asset.height), ([], None, None))
