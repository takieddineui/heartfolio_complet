"""
Centralized DRF exception handling.

This module establishes *infrastructure only*: every exception DRF already
knows how to handle (validation errors, auth errors, 404s, throttling, ...)
gets reshaped into a single consistent envelope:

    {
        "error": {
            "code": "some_error_code",
            "message": "Human-readable message",
            "details": {}
        }
    }

No business-specific error codes are defined here. `code` is derived
generically from the exception class name (e.g. `ValidationError` ->
"validation_error"), which is enough structure for API consumers to branch
on without this module needing to know anything about products, orders,
or any other domain concept. Domain apps can raise their own
`APIException` subclasses later and this handler will format them
automatically — no changes needed here when that happens.

As of Phase 3.4, domain apps do exactly that: `apps/common/exceptions/api_errors.py`
defines named exceptions (`ProductNotFound`, `ProjectAccessDenied`, ...)
whose class names, run through the same camelCase-to-snake_case
conversion, already produce the exact stable error codes the API
contract calls for — no separate code registry needed. Those exceptions
may also carry a `.details` dict for structured extra context, which
this handler prefers over the generic fallback when present.
"""

import re

from rest_framework.views import exception_handler as drf_exception_handler

_CAMEL_TO_SNAKE_RE = re.compile(r"(?<!^)(?=[A-Z])")


def _error_code_from_exception(exc) -> str:
    """`NotAuthenticated` -> "not_authenticated", `ValidationError` -> "validation_error"."""
    class_name = exc.__class__.__name__
    snake_case = _CAMEL_TO_SNAKE_RE.sub("_", class_name).lower()
    return snake_case


def custom_exception_handler(exc, context):
    """Wraps DRF's default exception handler and reshapes its response
    body into the shared `{"error": {...}}` envelope. Returns `None` for
    anything DRF's default handler doesn't recognize (e.g. an unhandled
    Python exception), which lets Django's normal 500 handling proceed
    untouched rather than this module guessing at a response shape for
    errors it doesn't understand.
    """
    response = drf_exception_handler(exc, context)

    if response is None:
        return None

    detail = response.data

    if isinstance(detail, dict) and "detail" in detail and len(detail) == 1:
        message = str(detail["detail"])
        details = {}
    elif isinstance(detail, (list, dict)):
        message = str(exc)
        details = detail if isinstance(detail, dict) else {"errors": detail}
    else:
        message = str(detail)
        details = {}

    response.data = {
        "error": {
            "code": _error_code_from_exception(exc),
            "message": message,
            "details": getattr(exc, "details", None) or details,
        }
    }
    return response
