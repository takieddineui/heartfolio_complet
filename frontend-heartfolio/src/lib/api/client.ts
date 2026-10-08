/**
 * ---------------------------------------------------------------------
 * THE ONE PLACE THE FRONTEND TALKS TO DJANGO
 * ---------------------------------------------------------------------
 * Nothing else in the app calls `fetch` against the backend directly. Every
 * request goes through here so that three things are guaranteed rather than
 * remembered at each call site:
 *
 * 1. `credentials: "include"` — the guest identity is Django's own session
 *    cookie (`sessionid`). Omit this on a single request and that request
 *    silently becomes a different, anonymous guest.
 * 2. `X-CSRFToken` on every unsafe method — the backend enforces CSRF on
 *    all of them (`CsrfEnforcedSessionAuthentication`), not just on login,
 *    because guests are never Django auth users and DRF's stock session
 *    auth would otherwise skip the check entirely.
 * 3. Errors arrive as a typed `ApiError` carrying Django's stable `code`.
 *
 * REQUESTS ARE SAME-ORIGIN BY DESIGN. The browser calls `/api/backend/...`
 * on its own origin and `next.config.ts` rewrites that to the backend
 * server-side. That keeps `sessionid` a first-party cookie: a cross-site
 * call would need `SameSite=None`, which Safari's ITP and Firefox's Total
 * Cookie Protection block outright — guest identity would work in Chrome
 * and fail for a large share of real customers. See the rewrite block in
 * `next.config.ts` for the full reasoning.
 */

import { ApiError, ApiNetworkError, toApiError } from "./errors";

/** Same-origin path, not the backend's real address — see the note above.
 * Overridable only for unusual local setups; the default is correct for
 * localhost, preview deployments and production alike. */
export const API_BASE_PATH = process.env.NEXT_PUBLIC_API_BASE_PATH ?? "/api/backend";

const CSRF_COOKIE = "csrftoken";
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

/**
 * §12 — appends a magic-link token as a PATH SEGMENT, matching AR (§21f)
 * and the Live keepsake (§10): `/orders/<id>/<token>`, not
 * `/orders/<id>?token=<token>`.
 *
 * THIS USED TO BE A QUERY STRING, and it was the one bearer credential in
 * the system built that way — AR's and Live's own tokens were path-based
 * from the start specifically to avoid this. The practical difference is
 * not really about browser history or the `Referer` header: most browsers
 * default to `strict-origin-when-cross-origin`, which sends neither a
 * path nor a query string to a different origin anyway, so that specific
 * worry is smaller than it sounds. The real, concrete risk is a CDN or
 * reverse proxy configured to cache by PATH ONLY, ignoring the query
 * string — a common, simple default. Under that misconfiguration, every
 * request to `/orders/<id>` would be served the SAME cached response
 * regardless of the token in the query string, meaning whoever's request
 * got cached first leaks their order to everyone after them. A path-based
 * token makes every credential its own cache key, so that class of bug
 * cannot happen even if a cache is naively configured — the same reason
 * AR's and Live's credentials were shaped this way originally.
 *
 * Was two byte-identical copies of this exact function, one in orders.ts
 * and one in delivery.ts — consolidated here while making this change, so
 * there is one place to change it correctly rather than two places that
 * could quietly drift out of step again.
 */
/**
 * THE TOKEN IS APPENDED RAW, NOT PERCENT-ENCODED.
 *
 * This used to call `encodeURIComponent(token)`. A Django `TimestampSigner`
 * token is `<value>:<timestamp>:<signature>`, so encoding turned each `:`
 * into `%3A` — and the same-origin `/api/backend/*` rewrite in
 * `next.config.ts` then encoded that `%` in turn, so Django received
 * `%253A`, decoded it once to a literal `%3A`, and rejected the signature.
 * Every emailed magic link failed with "order not found".
 *
 * Appending raw is safe rather than merely convenient: the signer's output
 * alphabet is URL-path-safe by construction — the signed value is a UUID,
 * the timestamp is base62, and the signature is URL-safe base64 (`-` and
 * `_`, no padding). The only other character is the `:` separator, which
 * is legal in a path segment. Nothing a token can contain needs escaping.
 */
export function withToken(path: string, token?: string): string {
  return token ? `${path}/${token}` : path;
}

interface RequestOptions {
  method?: HttpMethod;
  /** JSON-serialisable body. Mutually exclusive with `formData`. */
  body?: unknown;
  /** For `multipart/form-data` (asset upload). The browser must set the
   * boundary itself, so no Content-Type is sent when this is used. */
  formData?: FormData;
  signal?: AbortSignal;
  /** `json` (default), `blob` for binary bodies, `none` for 204s, or
   * `response` to receive the raw Response — needed by downloads, which
   * must read `Content-Disposition` and `Content-Type` before deciding
   * how to treat the body. */
  parse?: "json" | "blob" | "none" | "response";
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/**
 * Django only issues the CSRF cookie when something calls `get_token()`.
 * `GET /guest/` does exactly that (deliberately — see the backend's
 * `GuestIdentityView` docstring), and creates neither a Customer row nor a
 * persisted session, so it is safe to call for a purely anonymous visitor.
 * That makes it the correct bootstrap for a first unsafe request.
 *
 * Paths passed to this module carry NO trailing slash — the rewrite in
 * `next.config.ts` appends the one Django requires. See the note there.
 */
async function ensureCsrfToken(signal?: AbortSignal): Promise<string | null> {
  const existing = readCookie(CSRF_COOKIE);
  if (existing) return existing;

  try {
    await fetch(`${API_BASE_PATH}/guest`, { method: "GET", credentials: "include", signal });
  } catch {
    // Surfaced by the real request that follows; nothing useful to add here.
  }
  return readCookie(CSRF_COOKIE);
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, formData, signal, parse = "json" } = options;

  if (body !== undefined && formData !== undefined) {
    throw new Error("apiFetch: pass either `body` or `formData`, not both.");
  }

  const headers: Record<string, string> = {};
  if (parse === "json") headers.Accept = "application/json";
  if (body !== undefined) headers["Content-Type"] = "application/json";

  if (UNSAFE_METHODS.has(method)) {
    const token = await ensureCsrfToken(signal);
    if (token) headers["X-CSRFToken"] = token;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_PATH}${path}`, {
      method,
      headers,
      credentials: "include",
      signal,
      body: formData ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiNetworkError();
  }

  if (!response.ok) {
    throw toApiError(response.status, await readBodySafely(response));
  }

  if (parse === "response") return response as T;
  if (parse === "none" || response.status === 204) return undefined as T;
  if (parse === "blob") return (await response.blob()) as T;

  return (await readBodySafely(response)) as T;
}

/** A body can be empty, HTML (proxy/gateway error) or malformed. Parsing it
 * must never throw over the top of the real error being reported. */
async function readBodySafely(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (!text) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export { ApiError, ApiNetworkError };
