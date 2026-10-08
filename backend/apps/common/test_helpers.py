"""
Shared by any app's tests that need an authenticated guest session
(`apps/projects`, `apps/commerce`) — establishes it through the real
`/api/v1/guest/` endpoint, the same way the frontend would, rather than
writing to `client.session` directly.
"""

import uuid


def login_as_guest(client, email: str | None = None) -> tuple[str, str]:
    """Returns (customerId, email). `client` must be a
    `rest_framework.test.APIClient` — cookies persist on it across
    calls, so subsequent requests using the same `client` are
    authenticated as this guest.
    """
    email = email or f"guest-{uuid.uuid4().hex[:8]}@example.com"
    client.get("/api/v1/guest/")
    token = client.cookies["csrftoken"].value
    response = client.post("/api/v1/guest/", {"email": email}, format="json", HTTP_X_CSRFTOKEN=token)
    return response.data["customerId"], email


def csrf_headers(client) -> dict:
    """CSRF header for a follow-up state-changing request on a `client`
    that already has a csrftoken cookie (e.g. after `login_as_guest`).
    """
    token = client.cookies["csrftoken"].value
    return {"HTTP_X_CSRFTOKEN": token}
