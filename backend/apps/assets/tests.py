"""
Model/database-layer tests for `Asset`, plus service/storage/API tests
for the Phase 3.5 upload flow.
"""

import io
import uuid
from unittest.mock import patch

from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from apps.common.exceptions.api_errors import AssetTooLarge, InvalidAssetType
from django.db import IntegrityError, connection, transaction
from django.test import SimpleTestCase, TestCase
from rest_framework import status as http_status
from rest_framework.test import APIClient

from apps.common.test_helpers import csrf_headers, login_as_guest
from apps.customers.models import Customer

from .models import Asset
from .services import (
    delete_asset,
    generate_asset_access_url,
    generate_storage_key,
    get_asset_for_customer,
    upload_asset,
    sanitize_image,
    validate_uploaded_file,
)
from .storage import AssetStorageError, MockAssetStorage


def make_customer(**overrides) -> Customer:
    defaults = {"email": f"guest-{uuid.uuid4().hex[:8]}@example.com"}
    defaults.update(overrides)
    return Customer.objects.create(**defaults)


def make_asset(**overrides) -> Asset:
    defaults = {
        "storage_key": f"assets/{uuid.uuid4().hex}.png",
        "mime_type": "image/png",
    }
    defaults.update(overrides)
    return Asset.objects.create(**defaults)


class AssetModelTests(TestCase):
    def test_customer_is_nullable(self):
        asset = make_asset(customer=None)
        self.assertIsNone(asset.customer_id)

    def test_storage_provider_default(self):
        asset = make_asset()
        self.assertEqual(asset.storage_provider, "r2")

    def test_status_default(self):
        asset = make_asset()
        self.assertEqual(asset.status, Asset.STATUS_UPLOADED)

    def test_invalid_status_rejected_at_db_level(self):
        asset = Asset(storage_key="x", mime_type="image/png", status="not-a-real-status")
        with transaction.atomic(), self.assertRaises(IntegrityError):
            asset.save()

    def test_storage_provider_and_key_uniqueness_enforced_at_db_level(self):
        make_asset(storage_provider="r2", storage_key="assets/dup.png")
        with transaction.atomic(), self.assertRaises(IntegrityError):
            make_asset(storage_provider="r2", storage_key="assets/dup.png")

    def test_same_key_allowed_across_different_providers(self):
        make_asset(storage_provider="r2", storage_key="assets/shared-name.png")
        # Should not raise — uniqueness is scoped to (storage_provider, storage_key).
        make_asset(storage_provider="s3", storage_key="assets/shared-name.png")

    def test_deleting_customer_sets_asset_customer_to_null_at_db_level(self):
        """Raw SQL DELETE, bypassing the Django ORM entirely — proves
        ON DELETE SET NULL is enforced by PostgreSQL itself.
        """
        customer = make_customer()
        asset = make_asset(customer=customer)

        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM customers WHERE id = %s", [str(customer.id)])

        asset.refresh_from_db()
        self.assertIsNone(asset.customer_id)


class _FailingStorage:
    """Test double simulating an R2 failure — never used in production
    code; see MockAssetStorage in storage.py for the real dev/test
    default, which always succeeds.
    """

    def upload(self, key, file_obj, *, content_type):
        raise AssetStorageError("simulated upload failure")

    def delete(self, key):
        raise AssetStorageError("simulated delete failure")

    def generate_access_url(self, key, *, expires_in=None):
        return "mock://should-not-be-called"


def _encode_image(fmt="JPEG", dimensions=(64, 64)) -> bytes:
    """Real, decodable image bytes."""
    buffer = io.BytesIO()
    Image.new("RGB", dimensions, (200, 120, 90)).save(buffer, format=fmt)
    return buffer.getvalue()


def _image_file(name="photo.jpg", content_type="image/jpeg", fmt="JPEG") -> SimpleUploadedFile:
    """A genuine image.

    This fixture used to be `b"\x00" * 1024` with an `image/jpeg` label — a
    file that is not an image in any sense — and it passed the upload path
    untouched. That is precisely the gap §22a describes: nothing ever opened
    an upload to see what it was, so the project's own tests were exercising
    the pipeline with bytes no decoder would accept.
    """
    return SimpleUploadedFile(name, _encode_image(fmt), content_type=content_type)


def _oversized_file(name="huge.jpg", content_type="image/jpeg", size=1024) -> SimpleUploadedFile:
    """Non-image bytes, for tests about size rather than content — the size
    check runs before the decode, so these never reach Pillow."""
    return SimpleUploadedFile(name, b"\x00" * size, content_type=content_type)


class StorageKeyTests(TestCase):
    def test_key_uses_asset_uuid_and_is_collision_resistant(self):
        asset_id = uuid.uuid4()
        key = generate_storage_key(asset_id, "photo.jpg")
        self.assertTrue(key.startswith(f"assets/{asset_id}/"))

    def test_path_traversal_in_filename_is_stripped(self):
        asset_id = uuid.uuid4()
        key = generate_storage_key(asset_id, "../../etc/passwd")
        self.assertNotIn("..", key)
        self.assertNotIn("/etc/", key)
        self.assertEqual(key, f"assets/{asset_id}/passwd")

    def test_windows_style_path_in_filename_is_stripped(self):
        asset_id = uuid.uuid4()
        key = generate_storage_key(asset_id, r"C:\Windows\System32\evil.exe")
        self.assertNotIn("\\", key)
        self.assertNotIn(":", key)

    def test_empty_filename_falls_back_to_safe_default(self):
        asset_id = uuid.uuid4()
        key = generate_storage_key(asset_id, "")
        self.assertEqual(key, f"assets/{asset_id}/file")


class UploadAssetServiceTests(TestCase):
    def test_successful_upload_creates_uploaded_asset(self):
        customer = make_customer()
        asset = upload_asset(customer, _image_file())

        self.assertEqual(asset.status, Asset.STATUS_UPLOADED)
        self.assertEqual(asset.customer_id, customer.id)
        self.assertEqual(asset.mime_type, "image/jpeg")
        self.assertEqual(asset.original_filename, "photo.jpg")
        self.assertTrue(asset.storage_key.startswith(f"assets/{asset.id}/"))
        self.assertTrue(Asset.objects.filter(id=asset.id, status=Asset.STATUS_UPLOADED).exists())

    def test_upload_failure_does_not_leave_asset_marked_uploaded(self):
        customer = make_customer()
        with patch("apps.assets.services.get_asset_storage", return_value=_FailingStorage()):
            with self.assertRaises(Exception):  # AssetUploadFailed
                upload_asset(customer, _image_file())

        # The row exists (diagnostic record) but is never left claiming
        # a successful upload that didn't actually happen.
        asset = Asset.objects.get(customer=customer)
        self.assertEqual(asset.status, Asset.STATUS_FAILED)

    def test_oversized_file_rejected_before_reaching_storage(self):
        from django.conf import settings

        customer = make_customer()
        oversized = _oversized_file(size=(settings.MAX_ASSET_SIZE_MB * 1024 * 1024) + 1)
        with self.assertRaises(Exception):  # AssetTooLarge
            validate_uploaded_file(oversized)
        with self.assertRaises(Exception):
            upload_asset(customer, oversized)
        self.assertEqual(Asset.objects.filter(customer=customer).count(), 0)

    def test_unsupported_mime_type_rejected(self):
        customer = make_customer()
        bad_file = _image_file(name="script.js", content_type="application/javascript")
        with self.assertRaises(Exception):  # InvalidAssetType
            upload_asset(customer, bad_file)
        self.assertEqual(Asset.objects.filter(customer=customer).count(), 0)

    def test_missing_file_rejected(self):
        customer = make_customer()
        with self.assertRaises(Exception):  # MissingAssetFile
            upload_asset(customer, None)


class DeleteAssetServiceTests(TestCase):
    def test_owner_can_delete_and_storage_delete_is_actually_called(self):
        customer = make_customer()
        asset = upload_asset(customer, _image_file())

        with patch("apps.assets.services.get_asset_storage") as mock_get_storage:
            storage = MockAssetStorage()
            storage.upload(asset.storage_key, _image_file(), content_type="image/jpeg")
            mock_get_storage.return_value = storage
            self.assertTrue(storage.exists(asset.storage_key))

            delete_asset(customer, asset.id)

            # The storage abstraction's delete() was genuinely invoked
            # — not just a DB-only soft delete.
            self.assertFalse(storage.exists(asset.storage_key))

        asset.refresh_from_db()
        self.assertEqual(asset.status, Asset.STATUS_DELETED)

    def test_deleted_asset_is_not_retrievable(self):
        customer = make_customer()
        asset = upload_asset(customer, _image_file())
        delete_asset(customer, asset.id)

        with self.assertRaises(Exception):  # AssetNotFound
            get_asset_for_customer(customer, asset.id)

    def test_delete_failure_leaves_asset_row_untouched(self):
        customer = make_customer()
        asset = upload_asset(customer, _image_file())

        with patch("apps.assets.services.get_asset_storage", return_value=_FailingStorage()):
            with self.assertRaises(Exception):  # AssetDeleteFailed
                delete_asset(customer, asset.id)

        asset.refresh_from_db()
        self.assertEqual(asset.status, Asset.STATUS_UPLOADED)  # unchanged — safely retryable


class AccessUrlTests(TestCase):
    def test_access_url_is_never_persisted(self):
        customer = make_customer()
        asset = upload_asset(customer, _image_file())

        url_1 = generate_asset_access_url(asset)
        url_2 = generate_asset_access_url(asset)

        # Computed on demand each time — nothing URL-shaped lives on the
        # model, only storage_key does.
        self.assertNotIn("url", [f.name for f in Asset._meta.get_fields()])
        self.assertIsInstance(url_1, str)
        self.assertIsInstance(url_2, str)

    def test_mock_backend_never_produces_a_public_looking_url_by_accident(self):
        customer = make_customer()
        asset = upload_asset(customer, _image_file())
        url = generate_asset_access_url(asset)
        self.assertTrue(url.startswith("mock://"))

    def test_no_url_ever_persisted_in_the_raw_database_row(self):
        """Phase 3.6 Rule 6 — direct proof, not just an ORM-field-name
        check: queries the actual row's text columns for anything
        URL-shaped after generating (and discarding) an access URL.
        """
        customer = make_customer()
        asset = upload_asset(customer, _image_file())
        generate_asset_access_url(asset)  # generated, deliberately not stored anywhere

        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT storage_provider, storage_key, original_filename, mime_type, status "
                "FROM assets WHERE id = %s",
                [str(asset.id)],
            )
            row = cursor.fetchone()

        for value in row:
            if value:
                self.assertNotIn("http", str(value))
                self.assertNotIn("mock://", str(value))


class AssetAPITests(TestCase):
    """`POST /api/v1/assets/`, `GET/DELETE /api/v1/assets/<uuid>/`."""

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)

    def test_upload_via_api(self):
        login_as_guest(self.client)
        response = self.client.post(
            "/api/v1/assets/", {"file": _image_file()}, format="multipart", **csrf_headers(self.client)
        )

        self.assertEqual(response.status_code, http_status.HTTP_201_CREATED)
        self.assertEqual(response.data["mimeType"], "image/jpeg")
        self.assertEqual(response.data["filename"], "photo.jpg")
        self.assertEqual(response.data["id"], response.data["assetId"])
        self.assertIn("url", response.data)
        # No storage credentials/internal details ever appear in the response.
        self.assertNotIn("storage_key", str(response.data))
        self.assertNotIn("R2_SECRET", str(response.data))

    def test_get_asset_by_owner(self):
        login_as_guest(self.client)
        upload_response = self.client.post(
            "/api/v1/assets/", {"file": _image_file()}, format="multipart", **csrf_headers(self.client)
        )
        asset_id = upload_response.data["id"]

        response = self.client.get(f"/api/v1/assets/{asset_id}/")
        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response.data["id"], asset_id)

    def test_another_guest_cannot_retrieve_asset(self):
        client_a = APIClient(enforce_csrf_checks=True)
        login_as_guest(client_a)
        upload_response = client_a.post(
            "/api/v1/assets/", {"file": _image_file()}, format="multipart", **csrf_headers(client_a)
        )
        asset_id = upload_response.data["id"]

        client_b = APIClient(enforce_csrf_checks=True)
        login_as_guest(client_b)
        response = client_b.get(f"/api/v1/assets/{asset_id}/")

        self.assertEqual(response.status_code, http_status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["error"]["code"], "asset_access_denied")

    def test_another_guest_cannot_delete_asset(self):
        client_a = APIClient(enforce_csrf_checks=True)
        login_as_guest(client_a)
        upload_response = client_a.post(
            "/api/v1/assets/", {"file": _image_file()}, format="multipart", **csrf_headers(client_a)
        )
        asset_id = upload_response.data["id"]

        client_b = APIClient(enforce_csrf_checks=True)
        login_as_guest(client_b)
        response = client_b.delete(f"/api/v1/assets/{asset_id}/", **csrf_headers(client_b))

        self.assertEqual(response.status_code, http_status.HTTP_403_FORBIDDEN)
        self.assertTrue(Asset.objects.get(id=asset_id).status, Asset.STATUS_UPLOADED)

    def test_owner_can_delete_via_api(self):
        login_as_guest(self.client)
        upload_response = self.client.post(
            "/api/v1/assets/", {"file": _image_file()}, format="multipart", **csrf_headers(self.client)
        )
        asset_id = upload_response.data["id"]

        response = self.client.delete(f"/api/v1/assets/{asset_id}/", **csrf_headers(self.client))
        self.assertEqual(response.status_code, http_status.HTTP_204_NO_CONTENT)

        get_response = self.client.get(f"/api/v1/assets/{asset_id}/")
        self.assertEqual(get_response.status_code, http_status.HTTP_404_NOT_FOUND)

    def test_oversized_file_rejected_via_api(self):
        from django.conf import settings

        login_as_guest(self.client)
        oversized = _oversized_file(size=(settings.MAX_ASSET_SIZE_MB * 1024 * 1024) + 1)
        response = self.client.post(
            "/api/v1/assets/", {"file": oversized}, format="multipart", **csrf_headers(self.client)
        )
        self.assertEqual(response.status_code, http_status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["error"]["code"], "asset_too_large")

    def test_unsupported_mime_type_rejected_via_api(self):
        login_as_guest(self.client)
        response = self.client.post(
            "/api/v1/assets/",
            {"file": _image_file(name="script.js", content_type="application/javascript")},
            format="multipart",
            **csrf_headers(self.client),
        )
        self.assertEqual(response.status_code, http_status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["error"]["code"], "invalid_asset_type")

    def test_missing_file_rejected_via_api(self):
        login_as_guest(self.client)
        response = self.client.post("/api/v1/assets/", {}, format="multipart", **csrf_headers(self.client))
        self.assertEqual(response.status_code, http_status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["error"]["code"], "missing_asset_file")

    def test_no_session_rejected(self):
        self.client.get("/api/v1/guest/")  # CSRF cookie only, no login
        response = self.client.post(
            "/api/v1/assets/", {"file": _image_file()}, format="multipart", **csrf_headers(self.client)
        )
        self.assertEqual(response.status_code, http_status.HTTP_401_UNAUTHORIZED)


class ProjectAssetReferenceTests(TestCase):
    """Confirms an asset reference can live inside the existing opaque
    `data.values` JSON without the backend touching the JSONB contract
    at all — see the Phase 3.5 report for why automatic
    assetId-ownership validation nested inside `values` was NOT
    implemented (it would require parsing supposedly-opaque,
    product-module-owned JSON).
    """

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)

    def test_project_can_reference_asset_id_inside_values(self):
        from apps.products.models import Product

        product = Product.objects.create(
            slug="love-story-timeline", name_i18n_key="x", category=Product.CATEGORY_TIMELINE, status="available"
        )
        login_as_guest(self.client)
        upload_response = self.client.post(
            "/api/v1/assets/", {"file": _image_file()}, format="multipart", **csrf_headers(self.client)
        )
        asset_id = upload_response.data["id"]
        asset_url = upload_response.data["url"]

        project_response = self.client.post(
            "/api/v1/projects/",
            {
                "productId": product.slug,
                "data": {
                    "version": 1,
                    "values": {
                        "photo": {
                            "assetId": asset_id,
                            "url": asset_url,
                            "mimeType": "image/jpeg",
                            "filename": "photo.jpg",
                        }
                    },
                    "themeSelections": {},
                },
            },
            format="json",
            **csrf_headers(self.client),
        )

        self.assertEqual(project_response.status_code, http_status.HTTP_201_CREATED)
        # Structure remains exactly version/values/themeSelections — no
        # new top-level "assets" key was introduced.
        self.assertEqual(set(project_response.data["data"].keys()), {"version", "values", "themeSelections"})
        self.assertEqual(project_response.data["data"]["values"]["photo"]["assetId"], asset_id)


class NoGeneratedOutputStorageTests(TestCase):
    """Documents/asserts the boundary from the phase brief: this API has
    no concept of "output" vs "input" assets, no endpoint accepts a
    purpose/kind flag, and nothing in the upload path is reachable from
    the export engine — R2 involvement stops at user-uploaded input.
    """

    def test_upload_endpoint_accepts_no_purpose_or_kind_field(self):
        import inspect

        from .views import AssetUploadView

        source = inspect.getsource(AssetUploadView)
        for forbidden in ("purpose", "kind", "output", "export", "generated"):
            self.assertNotIn(forbidden, source.lower())

    def test_asset_model_has_no_output_distinguishing_field(self):
        field_names = {f.name for f in Asset._meta.get_fields()}
        self.assertNotIn("kind", field_names)
        self.assertNotIn("purpose", field_names)
        self.assertNotIn("is_output", field_names)


class ImageContentVerificationTests(SimpleTestCase):
    """§22a — uploads are opened and decoded, not taken on trust.

    Before this, `validate_uploaded_file` read the client-declared
    `Content-Type` header and the byte size and nothing else. Any file
    renamed to `.png`, or posted with a forged header, was accepted and
    then served back under whatever type the client had claimed.
    """

    def test_a_real_image_passes_and_reports_its_true_type(self):
        for fmt, mime in (("JPEG", "image/jpeg"), ("PNG", "image/png"), ("WEBP", "image/webp")):
            uploaded = SimpleUploadedFile(f"photo.{fmt.lower()}", _encode_image(fmt), content_type=mime)
            self.assertEqual(validate_uploaded_file(uploaded), mime)

    def test_non_image_bytes_are_rejected_however_they_are_labelled(self):
        # The exact file the old fixture used, and the exact case that used
        # to sail through.
        disguised = SimpleUploadedFile("photo.jpg", b"\x00" * 1024, content_type="image/jpeg")
        with self.assertRaises(InvalidAssetType):
            validate_uploaded_file(disguised)

    def test_a_renamed_executable_is_rejected(self):
        payload = SimpleUploadedFile("photo.png", b"MZ\x90\x00" + b"\x00" * 512, content_type="image/png")
        with self.assertRaises(InvalidAssetType):
            validate_uploaded_file(payload)

    def test_html_renamed_as_an_image_is_rejected(self):
        payload = SimpleUploadedFile(
            "photo.png", b"<html><script>alert(1)</script></html>", content_type="image/png"
        )
        with self.assertRaises(InvalidAssetType):
            validate_uploaded_file(payload)

    def test_a_truncated_image_is_rejected(self):
        # Structurally broken rather than the wrong type — `verify()` is what
        # catches this, and a size/header check never would.
        truncated = _encode_image("PNG")[: len(_encode_image("PNG")) // 3]
        uploaded = SimpleUploadedFile("photo.png", truncated, content_type="image/png")
        with self.assertRaises(InvalidAssetType):
            validate_uploaded_file(uploaded)

    def test_a_decodable_but_unsupported_format_is_rejected(self):
        # A valid BMP declared as PNG. It decodes perfectly, which is why the
        # detected format has to be checked against the allowed list rather
        # than merely confirming that *something* decoded.
        uploaded = SimpleUploadedFile("photo.png", _encode_image("BMP"), content_type="image/png")
        with self.assertRaises(InvalidAssetType):
            validate_uploaded_file(uploaded)

    def test_the_detected_type_wins_over_the_declared_one(self):
        # PNG bytes declared as JPEG. Storing and serving the declared type
        # would mean serving content under a header its bytes contradict.
        uploaded = SimpleUploadedFile("photo.jpg", _encode_image("PNG"), content_type="image/jpeg")
        self.assertEqual(validate_uploaded_file(uploaded), "image/png")

    def test_file_is_rewound_so_the_upload_still_gets_every_byte(self):
        # `verify()` consumes the file object. Without the seek afterwards
        # the storage upload would write a truncated or empty object, and
        # nothing else in the pipeline would notice.
        data = _encode_image("PNG")
        uploaded = SimpleUploadedFile("photo.png", data, content_type="image/png")
        validate_uploaded_file(uploaded)
        self.assertEqual(uploaded.read(), data)

    def test_a_decompression_bomb_is_rejected_as_too_large(self):
        # Small on disk, enormous in memory. The byte-size check cannot see
        # this, because the file passed it by being compressed.
        with patch.object(Image, "open", side_effect=Image.DecompressionBombError("boom")):
            uploaded = SimpleUploadedFile("photo.png", _encode_image("PNG"), content_type="image/png")
            with self.assertRaises(AssetTooLarge):
                validate_uploaded_file(uploaded)


class UploadSanitizationTests(SimpleTestCase):
    """§22c — uploads are rewritten from their pixels, not stored as sent.

    The property under test is an absence: whatever was in the file that was
    not image data must not be in what gets stored.
    """

    def _encode_with_trailer(self, trailer: bytes, fmt="PNG") -> bytes:
        return _encode_image(fmt) + trailer

    def test_data_appended_after_the_image_does_not_survive(self):
        """The classic polyglot: a valid image with a payload stapled on.

        It decodes perfectly, so §22a's verification passes it — correctly,
        because it IS an image. What stops it mattering is that the stored
        file is rebuilt from pixels and the trailer is never copied.
        """
        payload = b"<?php system($_GET['c']); ?>"
        uploaded = SimpleUploadedFile("photo.png", self._encode_with_trailer(payload), content_type="image/png")

        cleaned = sanitize_image(uploaded, "image/png")
        self.assertNotIn(payload, cleaned.read())

    def test_exif_is_stripped(self):
        # A privacy improvement in its own right: phone photographs carry
        # GPS coordinates, and a keepsake product had no reason to store
        # where its customers live.
        from PIL import Image

        buffer = io.BytesIO()
        image = Image.new("RGB", (32, 32), (10, 20, 30))
        exif = image.getexif()
        exif[271] = "SecretCameraMake"
        image.save(buffer, format="JPEG", exif=exif)

        uploaded = SimpleUploadedFile("photo.jpg", buffer.getvalue(), content_type="image/jpeg")
        self.assertIn(b"SecretCameraMake", buffer.getvalue())

        cleaned = sanitize_image(uploaded, "image/jpeg")
        self.assertNotIn(b"SecretCameraMake", cleaned.read())

    def test_the_result_is_still_a_valid_image_of_the_same_format(self):
        # The stored `mime_type` must stay truthful — re-encoding a PNG as
        # JPEG would make every recorded type a lie.
        from PIL import Image

        for fmt, mime in (("PNG", "image/png"), ("JPEG", "image/jpeg"), ("WEBP", "image/webp")):
            uploaded = SimpleUploadedFile(f"p.{fmt.lower()}", _encode_image(fmt), content_type=mime)
            cleaned = sanitize_image(uploaded, mime)
            with Image.open(io.BytesIO(cleaned.read())) as img:
                self.assertEqual(img.format, fmt)

    def test_the_image_content_is_preserved(self):
        # Sanitizing must not visibly damage what the customer uploaded.
        from PIL import Image

        buffer = io.BytesIO()
        Image.new("RGB", (64, 64), (200, 120, 90)).save(buffer, format="PNG")
        uploaded = SimpleUploadedFile("p.png", buffer.getvalue(), content_type="image/png")

        cleaned = sanitize_image(uploaded, "image/png")
        with Image.open(io.BytesIO(cleaned.read())) as img:
            self.assertEqual(img.size, (64, 64))
            self.assertEqual(img.convert("RGB").getpixel((10, 10)), (200, 120, 90))

    def test_a_truncated_file_raises_rather_than_storing_a_partial_image(self):
        # `Image.open` is lazy; without the explicit load() a file that fails
        # partway through would be saved as a truncated image instead of
        # being rejected.
        data = _encode_image("PNG")
        uploaded = SimpleUploadedFile("p.png", data[: len(data) // 3], content_type="image/png")
        with self.assertRaises(Exception):
            sanitize_image(uploaded, "image/png")


class MediaUploadTests(SimpleTestCase):
    """§5 — optional milestone video and audio.

    Video is probed and stored as-received; audio is re-encoded like an
    image. Most of these assert the difference between those two guarantees,
    because it is the part most likely to be forgotten.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.video = cls._make(["-f", "lavfi", "-i", "testsrc=size=160x120:rate=10", "-t", "2",
                               "-pix_fmt", "yuv420p"], ".mp4")
        cls.long_video = cls._make(["-f", "lavfi", "-i", "testsrc=size=160x120:rate=10", "-t", "35",
                                    "-pix_fmt", "yuv420p"], ".mp4")
        cls.audio = cls._make(["-f", "lavfi", "-i", "sine=frequency=440", "-t", "2", "-c:a", "aac"], ".m4a")

    @staticmethod
    def _make(args, suffix):
        import subprocess
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
            subprocess.run(["ffmpeg", "-y", "-v", "error", *args, handle.name], check=True)
            handle.seek(0)
            return open(handle.name, "rb").read()

    def _upload(self, data, name, content_type):
        return SimpleUploadedFile(name, data, content_type=content_type)

    def test_a_short_video_is_accepted(self):
        from apps.assets.media import validate_media

        duration = validate_media(self._upload(self.video, "c.mp4", "video/mp4"), "video/mp4")
        self.assertLess(duration, 5)

    def test_a_long_video_is_rejected(self):
        # The 30s cap. Enforced against what the container CLAIMS — see the
        # module docstring on why a stream-level check is not done.
        from apps.assets.media import validate_media

        with self.assertRaises(InvalidAssetType):
            validate_media(self._upload(self.long_video, "c.mp4", "video/mp4"), "video/mp4")

    def test_a_video_cannot_be_uploaded_through_the_audio_path(self):
        """Otherwise the video rules could be skipped entirely by changing
        one header — the declared type is a claim, not a fact."""
        from apps.assets.media import validate_media

        with self.assertRaises(InvalidAssetType):
            validate_media(self._upload(self.video, "c.m4a", "audio/mp4"), "audio/mp4")

    def test_an_audio_file_declared_as_video_is_rejected(self):
        from apps.assets.media import validate_media

        with self.assertRaises(InvalidAssetType):
            validate_media(self._upload(self.audio, "c.mp4", "video/mp4"), "video/mp4")

    def test_a_non_media_file_is_rejected(self):
        from apps.assets.media import validate_media

        with self.assertRaises(InvalidAssetType):
            validate_media(self._upload(b"not a video at all" * 100, "c.mp4", "video/mp4"), "video/mp4")

    def test_audio_is_re_encoded_and_loses_everything_that_is_not_audio(self):
        """Audio keeps the same guarantee images have.

        There was no reason for it to carry video's weaker one: audio files
        are small enough to rewrite inline with no queue.
        """
        from apps.assets.media import reencode_audio

        tainted = self.audio + b"<?php system($_GET['c']); ?>"
        cleaned = reencode_audio(self._upload(tainted, "c.m4a", "audio/mp4")).read()
        self.assertNotIn(b"<?php", cleaned)

    def test_audio_may_run_a_minute_but_not_longer(self):
        """60 seconds for audio (Graduation Keepsake's voice messages), while
        video keeps its 30: a 45-second voice message is accepted, a
        65-second one is refused."""
        from apps.assets.media import MAX_AUDIO_SECONDS, MAX_MEDIA_SECONDS, validate_media

        self.assertEqual((MAX_AUDIO_SECONDS, MAX_MEDIA_SECONDS), (60, 30))
        ok = self._make(["-f", "lavfi", "-i", "sine=frequency=330", "-t", "45", "-c:a", "aac"], ".m4a")
        self.assertGreater(validate_media(self._upload(ok, "v.m4a", "audio/x-m4a"), "audio/x-m4a"), 40)
        too_long = self._make(["-f", "lavfi", "-i", "sine=frequency=330", "-t", "65", "-c:a", "aac"], ".m4a")
        with self.assertRaises(InvalidAssetType):
            validate_media(self._upload(too_long, "v.m4a", "audio/x-m4a"), "audio/x-m4a")

    def test_a_video_still_stops_at_thirty_seconds_even_under_a_minute(self):
        from apps.assets.media import validate_media

        with self.assertRaises(InvalidAssetType):
            validate_media(self._upload(self.long_video, "c.mp4", "video/mp4"), "video/mp4")

    def test_a_whatsapp_voice_note_is_accepted_and_rewritten_as_aac(self):
        """Ogg Opus, as a WhatsApp voice note arrives, whichever type the
        browser declares for it; stored as AAC in MP4 like every audio file."""
        import subprocess
        import tempfile

        from apps.assets.media import reencode_audio, validate_media

        opus = self._make(["-f", "lavfi", "-i", "sine=frequency=500", "-t", "3", "-c:a", "libopus"], ".ogg")
        for declared in ("audio/ogg", "audio/opus"):
            self.assertLess(validate_media(self._upload(opus, "PTT-20270702.opus", declared), declared), 5)
        rewritten = reencode_audio(self._upload(opus, "PTT-20270702.opus", "audio/ogg")).read()
        with tempfile.NamedTemporaryFile(suffix=".m4a") as handle:
            handle.write(rewritten)
            handle.flush()
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", handle.name],
                capture_output=True, text=True, check=True,
            )
        self.assertEqual(probe.stdout.strip(), "aac")

    def test_a_re_encode_never_keeps_more_than_a_minute(self):
        """The cap applied to the samples, not the container's claim."""
        import subprocess
        import tempfile

        from apps.assets.media import reencode_audio

        long_audio = self._make(["-f", "lavfi", "-i", "sine=frequency=330", "-t", "70", "-c:a", "aac"], ".m4a")
        rewritten = reencode_audio(self._upload(long_audio, "v.m4a", "audio/mp4")).read()
        with tempfile.NamedTemporaryFile(suffix=".m4a") as handle:
            handle.write(rewritten)
            handle.flush()
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", handle.name],
                capture_output=True, text=True, check=True,
            )
        self.assertLessEqual(float(probe.stdout.strip()), 60.5)

    def test_media_gets_the_larger_size_ceiling(self):
        # An image limit applied to video would reject three seconds of
        # phone footage; a media limit applied to images would allow 50MB
        # of PNG per milestone.
        from django.conf import settings

        self.assertGreater(settings.MAX_MEDIA_SIZE_MB, settings.MAX_ASSET_SIZE_MB)

    def test_probing_cannot_hang_a_worker(self):
        # A crafted file that made ffprobe hang would hold a request worker
        # open — a denial of service needing no exploit.
        import inspect

        from apps.assets import media

        source = inspect.getsource(media.probe_media)
        self.assertIn("timeout=", source)
        self.assertIn("TimeoutExpired", source)


class ExpiresAtTests(TestCase):
    """§7 — provisional retention, set at upload for video/audio only.

    These need a real database (real `Asset`/`Customer` rows), unlike
    `MediaPromotionTests` in apps/commerce/tests.py, which mocks the same
    decision logic to run without one. Joins the existing pile of
    DB-backed tests in this project that have never executed in this
    sandbox — ready to run wherever Postgres is available.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        import subprocess
        import tempfile

        def make(args, suffix):
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
                subprocess.run(["ffmpeg", "-y", "-v", "error", *args, handle.name], check=True)
                handle.seek(0)
                return open(handle.name, "rb").read()

        cls.audio_bytes = make(["-f", "lavfi", "-i", "sine=frequency=440", "-t", "2", "-c:a", "aac"], ".m4a")

    def test_a_photo_upload_gets_no_expiry(self):
        customer = make_customer()
        asset = upload_asset(customer, _image_file())
        self.assertIsNone(asset.expires_at)

    def test_received_voice_files_upload_end_to_end_and_are_stored_as_aac(self):
        """Through `upload_asset`, where the allow-lists and the audio path
        decide: a WhatsApp Ogg Opus and an iPhone .m4a, whichever type the
        browser declares, are accepted, re-encoded and stored as AAC/MP4
        with an expiry (paid orders keep theirs)."""
        import subprocess
        import tempfile

        from django.core.files.uploadedfile import SimpleUploadedFile

        with tempfile.NamedTemporaryFile(suffix=".ogg") as handle:
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=500", "-t", "3", "-c:a", "libopus", handle.name], check=True)
            opus = open(handle.name, "rb").read()
        customer = make_customer()
        for name, data, declared in (
            ("PTT-WA0001.opus", opus, "audio/ogg"),
            ("PTT-WA0002.opus", opus, "audio/opus"),
            ("Voice Memo.m4a", self.audio_bytes, "audio/x-m4a"),
            ("message.mp3", self.audio_bytes, "audio/mp3"),
        ):
            with self.subTest(declared=declared):
                asset = upload_asset(customer, SimpleUploadedFile(name, data, content_type=declared))
                self.assertEqual(asset.mime_type, "audio/mp4")
                self.assertIsNotNone(asset.expires_at)

    def test_an_audio_upload_gets_a_future_expiry(self):
        from django.conf import settings
        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.utils import timezone

        customer = make_customer()
        upload = SimpleUploadedFile("voice.m4a", self.audio_bytes, content_type="audio/mp4")
        asset = upload_asset(customer, upload)

        self.assertIsNotNone(asset.expires_at)
        self.assertGreater(asset.expires_at, timezone.now())
        # Roughly the configured window — not brittle to the exact second.
        expected = timezone.now() + settings.MEDIA_PROVISIONAL_RETENTION
        self.assertLess(abs((asset.expires_at - expected).total_seconds()), 60)

    def test_promotion_clears_expiry_only_when_the_order_needs_it(self):
        """End-to-end version of `MediaPromotionTests`' mocked logic — a
        real Asset row, really cleared, via the real ORM call the mocked
        tests only asserted the shape of."""
        from django.core.files.uploadedfile import SimpleUploadedFile
        from unittest.mock import MagicMock

        from apps.commerce.media_promotion import promote_media_assets_for_order

        customer = make_customer()
        upload = SimpleUploadedFile("voice.m4a", self.audio_bytes, content_type="audio/mp4")
        asset = upload_asset(customer, upload)
        self.assertIsNotNone(asset.expires_at)

        order = MagicMock()
        order.customer = customer
        order.delivery_pack.included_targets = ["__live__"]
        # BACKGROUND MUSIC IS NOT AN ASSET ANY MORE. §4 made it a shipped
        # preset id, so `_media_asset_ids` deliberately stops collecting it
        # — this fixture referenced a key promotion no longer reads, so
        # nothing was collected, nothing was promoted, and the test failed
        # against correct code. A milestone voice note is the real case:
        # a genuine upload, with a real expiry to clear.
        order.project.data = {
            "values": {"events": [{"audio": {"assetId": str(asset.id)}}]}
        }

        promote_media_assets_for_order(order)

        asset.refresh_from_db()
        self.assertIsNone(asset.expires_at)

    def test_promotion_does_not_clear_expiry_for_a_printable_only_order(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from unittest.mock import MagicMock

        from apps.commerce.media_promotion import promote_media_assets_for_order

        customer = make_customer()
        upload = SimpleUploadedFile("voice.m4a", self.audio_bytes, content_type="audio/mp4")
        asset = upload_asset(customer, upload)

        order = MagicMock()
        order.customer = customer
        order.delivery_pack.included_targets = ["print-a4-edged"]
        # Same §4 correction as above: a real media reference, so this test
        # proves the pack check refuses it rather than passing because the
        # fixture referenced nothing collectable.
        order.project.data = {
            "values": {"events": [{"audio": {"assetId": str(asset.id)}}]}
        }

        promote_media_assets_for_order(order)

        asset.refresh_from_db()
        self.assertIsNotNone(asset.expires_at, "a Printable-only order must not promote audio")


class ExpireProvisionalAssetsCommandTests(TestCase):
    """§7 — the scheduled sweep."""

    def test_deletes_an_expired_asset_from_storage_and_marks_it_deleted(self):
        from datetime import timedelta
        from io import StringIO

        from django.core.management import call_command
        from django.utils import timezone

        customer = make_customer()
        storage = MockAssetStorage()
        with patch("apps.assets.storage.get_asset_storage", return_value=storage):
            asset = make_asset(customer=customer, expires_at=timezone.now() - timedelta(days=1))
            storage.upload(asset.storage_key, __import__("io").BytesIO(b"x"), content_type="audio/mp4")

            call_command("expire_provisional_assets", stdout=StringIO())

        asset.refresh_from_db()
        self.assertEqual(asset.status, Asset.STATUS_DELETED)
        self.assertNotIn(asset.storage_key, storage._objects)

    def test_leaves_a_not_yet_expired_asset_untouched(self):
        from datetime import timedelta
        from io import StringIO

        from django.core.management import call_command
        from django.utils import timezone

        customer = make_customer()
        asset = make_asset(customer=customer, expires_at=timezone.now() + timedelta(days=3))
        call_command("expire_provisional_assets", stdout=StringIO())

        asset.refresh_from_db()
        self.assertEqual(asset.status, Asset.STATUS_UPLOADED)

    def test_leaves_a_permanent_asset_untouched(self):
        from io import StringIO

        from django.core.management import call_command

        customer = make_customer()
        asset = make_asset(customer=customer, expires_at=None)
        call_command("expire_provisional_assets", stdout=StringIO())

        asset.refresh_from_db()
        self.assertEqual(asset.status, Asset.STATUS_UPLOADED)

    def test_dry_run_deletes_nothing(self):
        from datetime import timedelta
        from io import StringIO

        from django.core.management import call_command
        from django.utils import timezone

        customer = make_customer()
        asset = make_asset(customer=customer, expires_at=timezone.now() - timedelta(days=1))
        call_command("expire_provisional_assets", "--dry-run", stdout=StringIO())

        asset.refresh_from_db()
        self.assertEqual(asset.status, Asset.STATUS_UPLOADED)

    def test_a_storage_failure_leaves_the_row_untouched_for_retry(self):
        from datetime import timedelta
        from io import StringIO

        from django.core.management import call_command
        from django.utils import timezone

        customer = make_customer()
        asset = make_asset(customer=customer, expires_at=timezone.now() - timedelta(days=1))
        with patch(
            "apps.assets.storage.get_asset_storage",
            return_value=_FailingStorage(),
        ):
            call_command("expire_provisional_assets", stdout=StringIO())

        asset.refresh_from_db()
        self.assertEqual(asset.status, Asset.STATUS_UPLOADED, "must remain retryable, not silently lost")


class EnvExampleUploadTypesTests(SimpleTestCase):
    """`.env.example` once set `ALLOWED_ASSET_MIME_TYPES` to the three image
    types. Any environment copied from it refused every voice note and video
    at the server. The example must leave the setting to base.py's default."""

    def test_the_example_env_does_not_set_the_upload_types(self):
        from pathlib import Path

        example = Path(__file__).resolve().parents[2] / ".env.example"
        active = [
            line for line in example.read_text(encoding="utf-8").splitlines()
            if line.strip().startswith("ALLOWED_ASSET_MIME_TYPES")
        ]
        self.assertEqual(active, [], "set it only from base.py's full default list, never in the example")

    def test_the_default_accepts_audio_and_video(self):
        from django.conf import settings

        from apps.assets.media import AUDIO_MIME_TYPES, VIDEO_MIME_TYPES

        for mime_type in (*AUDIO_MIME_TYPES, *VIDEO_MIME_TYPES):
            self.assertIn(mime_type, settings.ALLOWED_ASSET_MIME_TYPES)

