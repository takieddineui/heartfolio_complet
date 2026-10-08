"""
Model/database-layer tests for `Project`.
"""

import uuid

from django.conf import settings
from django.db import IntegrityError, connection, transaction
from django.test import SimpleTestCase, TestCase
from rest_framework import status as http_status
from rest_framework.test import APIClient

from apps.commerce.models import Order
from apps.common.test_helpers import csrf_headers, login_as_guest
from apps.customers.models import Customer
from apps.products.models import DeliveryPack, Product

from .models import Project
from .serializers import ProjectCreateInputSerializer, ProjectUpdateInputSerializer


def make_customer(**overrides) -> Customer:
    defaults = {"email": f"guest-{uuid.uuid4().hex[:8]}@example.com"}
    defaults.update(overrides)
    return Customer.objects.create(**defaults)


def make_product(**overrides) -> Product:
    defaults = {
        "slug": f"product-{uuid.uuid4().hex[:8]}",
        "name_i18n_key": "product.name",
        "category": Product.CATEGORY_OTHER,
    }
    defaults.update(overrides)
    return Product.objects.create(**defaults)


class ProjectModelTests(TestCase):
    def test_uuid_pk_is_generated(self):
        project = Project.objects.create(customer=make_customer(), product=make_product())
        self.assertIsInstance(project.id, uuid.UUID)

    def test_customer_and_product_relationships(self):
        customer = make_customer()
        product = make_product()
        project = Project.objects.create(customer=customer, product=product)
        self.assertIn(project, customer.projects.all())
        self.assertIn(project, product.projects.all())

    def test_default_data_structure(self):
        project = Project.objects.create(customer=make_customer(), product=make_product())
        self.assertEqual(project.data, {"version": 1, "values": {}, "themeSelections": {}})

    def test_default_status_is_draft(self):
        project = Project.objects.create(customer=make_customer(), product=make_product())
        self.assertEqual(project.status, Project.STATUS_DRAFT)

    def test_invalid_status_rejected_at_db_level(self):
        project = Project(customer=make_customer(), product=make_product(), status="not-a-real-status")
        with transaction.atomic(), self.assertRaises(IntegrityError):
            project.save()

    def test_data_must_be_json_object_at_db_level(self):
        project = Project(customer=make_customer(), product=make_product(), data=["not", "an", "object"])
        with transaction.atomic(), self.assertRaises(IntegrityError):
            project.save()

    def test_data_missing_required_top_level_key_rejected_at_db_level(self):
        project = Project(
            customer=make_customer(),
            product=make_product(),
            data={"version": 1, "values": {}},  # missing "themeSelections"
        )
        with transaction.atomic(), self.assertRaises(IntegrityError):
            project.save()

    def test_data_with_extra_top_level_keys_still_allowed_by_db_constraint(self):
        """The DB constraint only requires the three keys to be *present*
        — it doesn't forbid extra ones. The approved contract that
        top-level keys stay exactly {version, values, themeSelections}
        is an application-level rule (nothing in this codebase writes
        extra keys), not something the CHECK constraint itself blocks.
        This test documents that boundary rather than asserting
        behavior the schema doesn't actually enforce.
        """
        project = Project.objects.create(
            customer=make_customer(),
            product=make_product(),
            data={"version": 1, "values": {}, "themeSelections": {}, "somethingElse": True},
        )
        project.refresh_from_db()
        self.assertIn("somethingElse", project.data)

    def test_deleting_customer_cascades_to_projects_at_db_level(self):
        """Raw SQL DELETE, bypassing the Django ORM entirely — proves
        ON DELETE CASCADE is enforced by PostgreSQL itself, not only by
        Django's application-level collector.
        """
        customer = make_customer()
        project = Project.objects.create(customer=customer, product=make_product())

        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM customers WHERE id = %s", [str(customer.id)])

        self.assertFalse(Project.objects.filter(id=project.id).exists())

    def test_deleting_product_is_restricted_by_project(self):
        product = make_product()
        Project.objects.create(customer=make_customer(), product=product)
        with self.assertRaises(Exception):
            product.delete()


class ProjectAPITests(TestCase):
    """`POST/GET/PATCH/DELETE /api/v1/projects/...` — session-owned."""

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)

    def _create_available_product(self, slug="love-story-timeline"):
        return Product.objects.create(
            slug=slug,
            name_i18n_key="product.name",
            category=Product.CATEGORY_TIMELINE,
            status=Product.STATUS_AVAILABLE,
        )

    def test_create_project(self):
        product = self._create_available_product()
        login_as_guest(self.client)

        response = self.client.post(
            "/api/v1/projects/",
            {"productId": product.slug, "data": {"version": 1, "values": {"a": 1}, "themeSelections": {}}},
            format="json",
            **csrf_headers(self.client),
        )

        self.assertEqual(response.status_code, http_status.HTTP_201_CREATED)
        self.assertEqual(response.data["productId"], product.slug)
        self.assertEqual(response.data["status"], "draft")
        self.assertEqual(response.data["data"]["values"], {"a": 1})

    def test_create_project_without_data_uses_default(self):
        product = self._create_available_product()
        login_as_guest(self.client)

        response = self.client.post(
            "/api/v1/projects/", {"productId": product.slug}, format="json", **csrf_headers(self.client)
        )

        self.assertEqual(response.status_code, http_status.HTTP_201_CREATED)
        self.assertEqual(response.data["data"], {"version": 1, "values": {}, "themeSelections": {}})

    def test_get_project(self):
        product = self._create_available_product()
        login_as_guest(self.client)
        create_response = self.client.post(
            "/api/v1/projects/", {"productId": product.slug}, format="json", **csrf_headers(self.client)
        )
        project_id = create_response.data["id"]

        response = self.client.get(f"/api/v1/projects/{project_id}/")
        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response.data["id"], project_id)

    def test_update_project(self):
        product = self._create_available_product()
        login_as_guest(self.client)
        create_response = self.client.post(
            "/api/v1/projects/", {"productId": product.slug}, format="json", **csrf_headers(self.client)
        )
        project_id = create_response.data["id"]

        response = self.client.patch(
            f"/api/v1/projects/{project_id}/",
            {"data": {"version": 1, "values": {"updated": True}, "themeSelections": {}}, "status": "completed"},
            format="json",
            **csrf_headers(self.client),
        )

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "completed")
        self.assertEqual(response.data["data"]["values"], {"updated": True})

    def _valid_love_story_timeline_data(self, **event_overrides):
        events = [
            {"date": d, "title": t, "photo": {"assetId": f"asset-{i}"}}
            for i, (d, t) in enumerate(
                [("2019-04-12", "We met"), ("2020-06-01", "First trip"), ("2022-09-03", "Moved in")], start=1
            )
        ]
        return {
            "version": 1,
            "values": {
                "storyType": "couple",
                "people": [{"name": "Alex"}, {"name": "Sam"}],
                "events": events,
                **event_overrides,
            },
            "themeSelections": {"palette": "midnight", "typography": "script", "layout": "neat-stack", "scale": 100},
        }

    def _create_project_with_paid_order(self, product, data=None):
        customer_id, _ = login_as_guest(self.client)
        create_response = self.client.post(
            "/api/v1/projects/",
            {"productId": product.slug, **({"data": data} if data else {})},
            format="json",
            **csrf_headers(self.client),
        )
        project_id = create_response.data["id"]
        pack = DeliveryPack.objects.create(
            product=product,
            slug="printable",
            name_i18n_key="pack.name",
            description_i18n_key="pack.description",
            price_cents=1200,
            included_targets=["print-png"],
        )
        Order.objects.create(
            customer_id=customer_id,
            project_id=project_id,
            product=product,
            delivery_pack=pack,
            guest_email="does-not-matter@example.com",
            subtotal_cents=1200,
            discount_cents=0,
            total_cents=1200,
            status=Order.STATUS_PAID,
        )
        return project_id

    def test_update_allowed_on_a_paid_project_when_the_edit_keeps_it_renderable(self):
        """Not a flat lock: an edit that leaves a paid project genuinely
        renderable (here, an unchanged re-save — the shape a SECOND
        checkout for the same project makes on every attempt, per
        `checkout-engine.ts`'s `prepareOrder`) must still go through.
        """
        product = self._create_available_product()
        valid_data = self._valid_love_story_timeline_data()
        project_id = self._create_project_with_paid_order(product, data=valid_data)

        response = self.client.patch(
            f"/api/v1/projects/{project_id}/",
            {"data": valid_data},
            format="json",
            **csrf_headers(self.client),
        )

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["values"]["storyType"], "couple")

    def test_update_rejected_on_a_paid_project_when_the_edit_would_make_it_unrenderable(self):
        """The replacement for the old flat lock: an edit that would make
        an already-paid-for project unrenderable is rejected — reusing
        the exact validator `apps.commerce.services.create_order` and the
        real renderer both already use, and the existing error shape.
        """
        product = self._create_available_product()
        valid_data = self._valid_love_story_timeline_data()
        project_id = self._create_project_with_paid_order(product, data=valid_data)

        broken_data = self._valid_love_story_timeline_data()
        del broken_data["values"]["events"][0]["photo"]["assetId"]  # strips the required photo reference

        response = self.client.patch(
            f"/api/v1/projects/{project_id}/",
            {"data": broken_data},
            format="json",
            **csrf_headers(self.client),
        )

        self.assertEqual(response.status_code, http_status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["error"]["code"], "love_story_timeline_invalid_data")

        # The rejected edit must not have partially applied.
        from .models import Project

        project = Project.objects.get(id=project_id)
        self.assertEqual(project.data, valid_data)

    def test_update_allowed_on_a_paid_project_with_a_genuine_still_valid_edit(self):
        """The re-validation gate checks renderability, not "did anything
        change" — a real edit (not just an identical re-save) that keeps
        the project valid must still go through, e.g. buying a second
        pack for the same project after tweaking the dedication text.
        """
        product = self._create_available_product()
        valid_data = self._valid_love_story_timeline_data()
        project_id = self._create_project_with_paid_order(product, data=valid_data)

        edited_data = self._valid_love_story_timeline_data()
        edited_data["values"]["dedication"] = "A whole new dedication"

        response = self.client.patch(
            f"/api/v1/projects/{project_id}/",
            {"data": edited_data},
            format="json",
            **csrf_headers(self.client),
        )

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["values"]["dedication"], "A whole new dedication")

    def test_update_still_allowed_with_only_a_pending_order(self):
        """The renderer re-validation gate only applies once a PAID order
        exists — a pending/failed order's checkout is resumable (see
        `checkout-engine.ts`'s own "steps are resumable" docstring), and
        that resumability depends on the project still being editable,
        with no extra validation, on retry.
        """
        product = self._create_available_product()
        customer_id, _ = login_as_guest(self.client)
        create_response = self.client.post(
            "/api/v1/projects/", {"productId": product.slug}, format="json", **csrf_headers(self.client)
        )
        project_id = create_response.data["id"]
        pack = DeliveryPack.objects.create(
            product=product,
            slug="printable",
            name_i18n_key="pack.name",
            description_i18n_key="pack.description",
            price_cents=1200,
            included_targets=["print-png"],
        )
        Order.objects.create(
            customer_id=customer_id,
            project_id=project_id,
            product=product,
            delivery_pack=pack,
            guest_email="does-not-matter@example.com",
            subtotal_cents=1200,
            discount_cents=0,
            total_cents=1200,
            status=Order.STATUS_PENDING,
        )

        response = self.client.patch(
            f"/api/v1/projects/{project_id}/",
            {"data": {"version": 1, "values": {"retried": True}, "themeSelections": {}}, "status": "completed"},
            format="json",
            **csrf_headers(self.client),
        )

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)

    def test_delete_project(self):
        product = self._create_available_product()
        login_as_guest(self.client)
        create_response = self.client.post(
            "/api/v1/projects/", {"productId": product.slug}, format="json", **csrf_headers(self.client)
        )
        project_id = create_response.data["id"]

        response = self.client.delete(f"/api/v1/projects/{project_id}/", **csrf_headers(self.client))
        self.assertEqual(response.status_code, http_status.HTTP_204_NO_CONTENT)
        self.assertFalse(Project.objects.filter(id=project_id).exists())

    def test_no_session_rejected(self):
        response = self.client.get(f"/api/v1/projects/{uuid.uuid4()}/")
        self.assertEqual(response.status_code, http_status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(response.data["error"]["code"], "customer_identity_required")

    def test_guest_a_cannot_read_guest_b_project(self):
        product = self._create_available_product()

        client_a = APIClient(enforce_csrf_checks=True)
        login_as_guest(client_a)
        create_response = client_a.post(
            "/api/v1/projects/", {"productId": product.slug}, format="json", **csrf_headers(client_a)
        )
        project_id = create_response.data["id"]

        client_b = APIClient(enforce_csrf_checks=True)
        login_as_guest(client_b)
        response = client_b.get(f"/api/v1/projects/{project_id}/")

        self.assertEqual(response.status_code, http_status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["error"]["code"], "project_access_denied")

    def test_guest_a_cannot_modify_guest_b_project(self):
        product = self._create_available_product()

        client_a = APIClient(enforce_csrf_checks=True)
        login_as_guest(client_a)
        create_response = client_a.post(
            "/api/v1/projects/", {"productId": product.slug}, format="json", **csrf_headers(client_a)
        )
        project_id = create_response.data["id"]

        client_b = APIClient(enforce_csrf_checks=True)
        login_as_guest(client_b)
        response = client_b.patch(
            f"/api/v1/projects/{project_id}/",
            {"status": "completed"},
            format="json",
            **csrf_headers(client_b),
        )

        self.assertEqual(response.status_code, http_status.HTTP_403_FORBIDDEN)

    def test_guest_a_cannot_delete_guest_b_project(self):
        product = self._create_available_product()

        client_a = APIClient(enforce_csrf_checks=True)
        login_as_guest(client_a)
        create_response = client_a.post(
            "/api/v1/projects/", {"productId": product.slug}, format="json", **csrf_headers(client_a)
        )
        project_id = create_response.data["id"]

        client_b = APIClient(enforce_csrf_checks=True)
        login_as_guest(client_b)
        response = client_b.delete(f"/api/v1/projects/{project_id}/", **csrf_headers(client_b))

        self.assertEqual(response.status_code, http_status.HTTP_403_FORBIDDEN)
        self.assertTrue(Project.objects.filter(id=project_id).exists())

    def test_product_slug_resolves_correctly(self):
        product = self._create_available_product(slug="heart-map")
        login_as_guest(self.client)
        response = self.client.post(
            "/api/v1/projects/", {"productId": "heart-map"}, format="json", **csrf_headers(self.client)
        )
        created = Project.objects.get(id=response.data["id"])
        self.assertEqual(created.product_id, product.id)
        self.assertEqual(response.data["productId"], "heart-map")

    def test_invalid_product_rejected(self):
        login_as_guest(self.client)
        response = self.client.post(
            "/api/v1/projects/", {"productId": "does-not-exist"}, format="json", **csrf_headers(self.client)
        )
        self.assertEqual(response.status_code, http_status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.data["error"]["code"], "product_not_found")

    def test_malformed_data_rejected(self):
        product = self._create_available_product()
        login_as_guest(self.client)
        response = self.client.post(
            "/api/v1/projects/",
            {"productId": product.slug, "data": {"version": 1, "values": {}}},  # missing themeSelections
            format="json",
            **csrf_headers(self.client),
        )
        self.assertEqual(response.status_code, http_status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["error"]["code"], "invalid_project_data")

    def test_response_includes_project_id_alias(self):
        product = self._create_available_product()
        login_as_guest(self.client)
        response = self.client.post(
            "/api/v1/projects/", {"productId": product.slug}, format="json", **csrf_headers(self.client)
        )
        self.assertEqual(response.data["projectId"], response.data["id"])

    def test_data_shape_is_exactly_version_values_theme_selections(self):
        """Phase 3.6 Rule 4 — no matter what's requested, the persisted
        top-level JSON keys are exactly these three.
        """
        product = self._create_available_product()
        login_as_guest(self.client)
        response = self.client.post(
            "/api/v1/projects/",
            {"productId": product.slug, "data": {"version": 1, "values": {"x": 1}, "themeSelections": {"y": 2}}},
            format="json",
            **csrf_headers(self.client),
        )
        self.assertEqual(set(response.data["data"].keys()), {"version", "values", "themeSelections"})


class ProjectDataSizeLimitTests(SimpleTestCase):
    """§22b — a ceiling on the opaque `data` payload.

    `Project.data` is never inspected by the backend, which is a deliberate
    boundary — and it also meant nothing bounded it. The only limit in effect
    was Django's `DATA_UPLOAD_MAX_MEMORY_SIZE`, which applies to the whole
    request body and was never configured as a decision about this field.
    """

    def _payload(self, kb):
        # A single long string is the simplest way to hit a byte target, and
        # is also the realistic abuse shape: one enormous personalization
        # field rather than many small ones.
        return {"version": 1, "values": {"note": "x" * (kb * 1024)}}

    def test_a_normal_project_is_accepted(self):
        serializer = ProjectUpdateInputSerializer(
            data={"data": {"version": 1, "values": {"title": "Our story"}, "themeSelections": {}}}
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_an_oversized_payload_is_rejected(self):
        serializer = ProjectUpdateInputSerializer(
            data={"data": self._payload(settings.MAX_PROJECT_DATA_KB + 8)}
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("data", serializer.errors)

    def test_the_limit_applies_on_create_as_well_as_update(self):
        # Both paths write the same column; guarding only one would leave the
        # ceiling trivially bypassable.
        serializer = ProjectCreateInputSerializer(
            data={
                "productId": "love-story-timeline",
                "data": self._payload(settings.MAX_PROJECT_DATA_KB + 8),
            }
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("data", serializer.errors)

    def test_omitting_data_entirely_is_still_allowed(self):
        serializer = ProjectUpdateInputSerializer(data={"status": "draft"})
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_the_check_does_not_inspect_the_payload_shape(self):
        # The boundary this must not cross: an unfamiliar structure is fine
        # so long as it is small. The backend does not know, and must not
        # learn, what a given product's state looks like.
        serializer = ProjectUpdateInputSerializer(
            data={"data": {"anything": [1, 2, {"nested": True}], "unknownKey": "fine"}}
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_the_limit_is_measured_in_bytes_not_characters(self):
        # Multi-byte characters cost what they actually cost. A limit
        # measured in `len(str)` would let a payload of Arabic or emoji run
        # to twice or four times the intended size.
        under_in_chars = {"values": {"note": "\u0623" * (settings.MAX_PROJECT_DATA_KB * 700)}}
        serializer = ProjectUpdateInputSerializer(data={"data": under_in_chars})
        self.assertFalse(serializer.is_valid())
