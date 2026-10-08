"""
Focused tests for guest identity — the behaviors listed in the Phase
3.2 spec, nothing beyond that. All of these require a real database
(Customer is a model, and the guest endpoint reads/writes sessions,
which are also DB-backed by default) — see the Phase 3.2 report for
which of these could actually be executed in the sandbox.
"""

from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from .models import Customer
from .services import get_or_create_guest_customer


class GuestIdentityServiceTests(TestCase):
    """Model/service-level behavior, independent of the HTTP layer."""

    def test_new_guest_identity_can_be_established(self):
        customer, created = get_or_create_guest_customer("guest@example.com")
        self.assertTrue(created)
        self.assertEqual(Customer.objects.count(), 1)
        self.assertEqual(customer.email, "guest@example.com")

    def test_repeated_calls_with_same_email_resolve_to_same_customer(self):
        first, _ = get_or_create_guest_customer("guest@example.com")
        second, created = get_or_create_guest_customer("guest@example.com")
        self.assertFalse(created)
        self.assertEqual(first.id, second.id)
        self.assertEqual(Customer.objects.count(), 1)

    def test_customer_uniqueness_is_case_insensitive(self):
        first, _ = get_or_create_guest_customer("Guest@Example.com")
        second, created = get_or_create_guest_customer("guest@example.com")
        self.assertFalse(created)
        self.assertEqual(first.id, second.id)
        self.assertEqual(Customer.objects.count(), 1)


class GuestIdentityEndpointTests(TestCase):
    """HTTP-level behavior of `GET/POST /api/v1/guest/`."""

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)

    def _csrf_headers(self):
        # Mirrors the frontend pattern the view is built for: GET first
        # to obtain the CSRF cookie, then echo it back as a header.
        self.client.get("/api/v1/guest/")
        token = self.client.cookies["csrftoken"].value
        return {"HTTP_X_CSRFTOKEN": token}

    def test_get_with_no_prior_identity_returns_empty_identity(self):
        response = self.client.get("/api/v1/guest/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, {"customerId": None, "email": None})
        # No Customer row should have been created just from visiting.
        self.assertEqual(Customer.objects.count(), 0)

    def test_post_with_email_establishes_identity_and_persists_across_requests(self):
        headers = self._csrf_headers()
        post_response = self.client.post(
            "/api/v1/guest/", {"email": "guest@example.com"}, format="json", **headers
        )
        self.assertEqual(post_response.status_code, status.HTTP_200_OK)
        customer_id = post_response.data["customerId"]
        self.assertIsNotNone(customer_id)
        self.assertEqual(post_response.data["email"], "guest@example.com")

        # Same session (same test client, cookies persisted) -> same guest.
        get_response = self.client.get("/api/v1/guest/")
        self.assertEqual(get_response.data["customerId"], customer_id)
        self.assertEqual(get_response.data["email"], "guest@example.com")

    def test_post_without_csrf_token_is_rejected(self):
        # Establishes the session cookie but deliberately omits the
        # X-CSRFToken header — CSRF protection must still apply.
        self.client.get("/api/v1/guest/")
        response = self.client.post(
            "/api/v1/guest/", {"email": "guest@example.com"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_guest_session_does_not_expose_another_customers_data(self):
        headers = self._csrf_headers()
        self.client.post(
            "/api/v1/guest/", {"email": "first@example.com"}, format="json", **headers
        )

        # A second, unrelated client (fresh cookies == fresh session)
        # must never see the first guest's identity.
        other_client = APIClient(enforce_csrf_checks=True)
        other_response = other_client.get("/api/v1/guest/")
        self.assertEqual(
            other_response.data, {"customerId": None, "email": None}
        )

    def test_session_cookie_is_httponly(self):
        headers = self._csrf_headers()
        self.client.post(
            "/api/v1/guest/", {"email": "guest@example.com"}, format="json", **headers
        )
        session_cookie = self.client.cookies.get("sessionid")
        self.assertIsNotNone(session_cookie)
        self.assertTrue(session_cookie["httponly"])
