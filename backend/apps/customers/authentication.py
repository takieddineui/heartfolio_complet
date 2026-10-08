"""
DRF's `SessionAuthentication.enforce_csrf()` only runs when it has
already resolved an authenticated Django auth `user` — see its
`authenticate()` implementation. Heartfolio's guest flow deliberately
never creates or logs in a Django auth user (see apps/customers/models.py
and the Phase 3.2 report), so with plain `SessionAuthentication`, CSRF
enforcement silently never triggers for the guest endpoint's POST — the
exact opposite of the "keep CSRF protection, don't disable it" 
requirement.

`CsrfEnforcedSessionAuthentication` runs the same CSRF check
unconditionally, independent of whether a Django auth user exists.
"""

from rest_framework.authentication import SessionAuthentication


class CsrfEnforcedSessionAuthentication(SessionAuthentication):
    def authenticate(self, request):
        self.enforce_csrf(request)
        return None
