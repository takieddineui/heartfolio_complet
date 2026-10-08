import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, API_BASE_PATH } from "./client";
import { ApiError, ApiNetworkError } from "./errors";
import { getGuestIdentity, identifyGuest, isIdentified } from "./guest";

/** `mock.calls[n]` is `T | undefined` under `noUncheckedIndexedAccess`.
 * These read a call's arguments and fail the test loudly if the call never
 * happened, rather than scattering non-null assertions through the specs. */
function callArgs(mock: { mock: { calls: unknown[][] } }, index = 0): [string, RequestInit] {
  const call = mock.mock.calls[index];
  if (!call) throw new Error(`Expected fetch call #${index}, but it was never made.`);
  return [call[0] as string, (call[1] ?? {}) as RequestInit];
}

function callHeaders(mock: { mock: { calls: unknown[][] } }, index = 0): Record<string, string> {
  return (callArgs(mock, index)[1].headers ?? {}) as Record<string, string>;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setCookie(value: string) {
  Object.defineProperty(document, "cookie", { value, writable: true, configurable: true });
}

describe("apiFetch", () => {
  beforeEach(() => setCookie(""));
  afterEach(() => vi.restoreAllMocks());

  it("calls the same-origin proxy path, never the backend origin directly", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/products");

    const [url] = callArgs(fetchMock);
    expect(url).toBe(`${API_BASE_PATH}/products`);
    // The backend origin must never appear in a browser request — that is
    // what would make the session cookie third-party.
    expect(url).not.toContain("backend.test");
    expect(url).not.toContain("railway.app");
    expect(url).not.toMatch(/^https?:\/\//);
  });

  it("always sends credentials, so the guest session cookie travels with every request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/products");

    expect(callArgs(fetchMock)[1].credentials).toBe("include");
  });

  it("sends the CSRF token from the cookie on unsafe methods", async () => {
    setCookie("csrftoken=abc123");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/projects", { method: "POST", body: { productId: "x" } });

    expect(callHeaders(fetchMock)["X-CSRFToken"]).toBe("abc123");
  });

  it("does not send a CSRF token on GET", async () => {
    setCookie("csrftoken=abc123");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/products");

    expect(callHeaders(fetchMock)["X-CSRFToken"]).toBeUndefined();
  });

  it("bootstraps the CSRF cookie via GET /guest/ when it is missing, then makes the real request", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      // Django issues the cookie during the bootstrap GET.
      if (url.endsWith("/guest")) {
        setCookie("csrftoken=bootstrapped");
        return jsonResponse({ customerId: null, email: null });
      }
      return jsonResponse({ id: "1" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/orders", { method: "POST", body: {} });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(callArgs(fetchMock, 0)[0]).toBe(`${API_BASE_PATH}/guest`);
    expect(callArgs(fetchMock, 1)[0]).toBe(`${API_BASE_PATH}/orders`);
    expect(callHeaders(fetchMock, 1)["X-CSRFToken"]).toBe("bootstrapped");
  });

  it("turns Django's error envelope into a typed ApiError carrying the stable code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { error: { code: "project_access_denied", message: "Not yours.", details: { projectId: "p1" } } },
          403
        )
      )
    );

    const error = await apiFetch("/projects/p1").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.code).toBe("project_access_denied");
    expect(apiError.status).toBe(403);
    expect(apiError.isAccessDenied).toBe(true);
    expect(apiError.details).toEqual({ projectId: "p1" });
  });

  it("flags a missing guest session distinctly, so callers can re-identify rather than show a generic failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ error: { code: "customer_identity_required", message: "Identity required." } }, 401)
      )
    );

    const error = (await apiFetch("/projects").catch((e: unknown) => e)) as ApiError;
    expect(error.isIdentityRequired).toBe(true);
  });

  it("degrades safely when an error response is not JSON (proxy or gateway failure)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>502 Bad Gateway</html>", { status: 502 })));

    const error = (await apiFetch("/products").catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.isServerError).toBe(true);
    expect(error.message).toBeTruthy();
  });

  it("distinguishes an unreachable API from an API that answered with an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error = await apiFetch("/products").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiNetworkError);
  });

  it("returns undefined for a 204, rather than trying to parse an empty body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    setCookie("csrftoken=t");

    await expect(apiFetch("/projects/p1", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("sends FormData without a Content-Type, so the browser sets the multipart boundary", async () => {
    setCookie("csrftoken=t");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ assetId: "a1" }));
    vi.stubGlobal("fetch", fetchMock);

    const formData = new FormData();
    formData.append("file", new Blob(["x"]), "photo.jpg");
    await apiFetch("/assets", { method: "POST", formData });

    const init = callArgs(fetchMock)[1];
    expect(callHeaders(fetchMock)["Content-Type"]).toBeUndefined();
    expect(init.body).toBe(formData);
  });
});

describe("guest identity", () => {
  beforeEach(() => setCookie("csrftoken=t"));
  afterEach(() => vi.restoreAllMocks());

  it("reads the identity attached to the current session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ customerId: "c-1", email: "a@b.com" })));

    const identity = await getGuestIdentity();

    expect(identity).toEqual({ customerId: "c-1", email: "a@b.com" });
    expect(isIdentified(identity)).toBe(true);
  });

  it("reports an anonymous visitor as unidentified", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ customerId: null, email: null })));

    expect(isIdentified(await getGuestIdentity())).toBe(false);
  });

  it("submits a trimmed email and never sends a client-chosen customer id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ customerId: "c-2", email: "a@b.com" }));
    vi.stubGlobal("fetch", fetchMock);

    await identifyGuest("  a@b.com  ");

    const body = JSON.parse(String(callArgs(fetchMock)[1].body));
    expect(body).toEqual({ email: "a@b.com" });
    expect(body).not.toHaveProperty("customerId");
  });
});
