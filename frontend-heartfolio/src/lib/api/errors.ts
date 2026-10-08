/**
 * Django returns every recognised error through one envelope
 * (`apps/common/exceptions/handlers.py`):
 *
 *   { "error": { "code": "project_access_denied", "message": "...", "details": {} } }
 *
 * `code` is stable and derived from the backend's own exception class names,
 * so it — not the HTTP status and never the human-readable message — is what
 * frontend logic should branch on. `ApiError` preserves all three plus the
 * status, so a caller can handle a specific case precisely and still have
 * something sensible to show when it doesn't.
 */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(params: { code: string; message: string; status: number; details?: Record<string, unknown> }) {
    super(params.message);
    this.name = "ApiError";
    this.code = params.code;
    this.status = params.status;
    this.details = params.details ?? {};
  }

  /** The guest session is missing or expired — the caller needs to establish
   * an identity (`POST /guest/`) before retrying. Raised by every
   * session-owned endpoint: projects, assets, orders, entitlements. */
  get isIdentityRequired(): boolean {
    return this.code === "customer_identity_required" || this.status === 401;
  }

  /** The resource exists but belongs to a different guest. Distinct from a
   * 404 on purpose — the backend deliberately does not collapse the two. */
  get isAccessDenied(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** Nothing the customer did wrong and nothing a retry of the same request
   * will fix differently — used to decide between "try again" and "something
   * went wrong on our side" messaging. */
  get isServerError(): boolean {
    return this.status >= 500;
  }
}

/** The network never reached the API at all (offline, DNS, proxy down).
 * Separate from `ApiError` because there is no status or code to reason
 * about, and because the right UI response is usually different. */
export class ApiNetworkError extends Error {
  constructor(message = "Could not reach the Heartfolio service.") {
    super(message);
    this.name = "ApiNetworkError";
  }
}

interface DjangoErrorEnvelope {
  error?: { code?: unknown; message?: unknown; details?: unknown };
  detail?: unknown;
}

/**
 * Builds an `ApiError` from a failed response body, degrading safely: a
 * proxy/gateway failure or an unhandled 500 may return HTML or nothing at
 * all, and that must not itself throw while constructing the error.
 */
export function toApiError(status: number, body: unknown): ApiError {
  const envelope = (body ?? {}) as DjangoErrorEnvelope;
  const error = envelope.error;

  const code = typeof error?.code === "string" ? error.code : fallbackCode(status);
  const message =
    typeof error?.message === "string"
      ? error.message
      : typeof envelope.detail === "string"
        ? envelope.detail
        : fallbackMessage(status);
  const details =
    error?.details && typeof error.details === "object" ? (error.details as Record<string, unknown>) : {};

  return new ApiError({ code, message, status, details });
}

function fallbackCode(status: number): string {
  if (status === 401) return "customer_identity_required";
  if (status === 403) return "access_denied";
  if (status === 404) return "not_found";
  if (status === 429) return "throttled";
  return status >= 500 ? "server_error" : "request_failed";
}

function fallbackMessage(status: number): string {
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  return status >= 500
    ? "Something went wrong on our side. Please try again."
    : "That request could not be completed.";
}
