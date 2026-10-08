import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildProjectData, PROJECT_DATA_VERSION } from "@/lib/api/projects";
import { realProjectEngine } from "./project-engine";
import { resolveProjectProductId } from "@/lib/studio/project-lookup";
import { resolveProductEntry } from "@/hooks/use-product-entry";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function setCookie(value: string) {
  Object.defineProperty(document, "cookie", { value, writable: true, configurable: true });
}

const TIMELINE_VALUES = {
  partner1: "Amelia",
  partner2: "Youssef",
  posterTitle: "Our Story",
  events: [{ date: "2019-06-01", title: "We met", description: "A rainy Tuesday" }],
};

const SAVED_PROJECT = {
  id: "p-1",
  projectId: "p-1",
  productId: "heart-map",
  data: { version: 1, values: { partner1: "A" }, themeSelections: { palette: "dusk" } },
  status: "draft",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function requestBody(mock: { mock: { calls: unknown[][] } }, index = 0): Record<string, unknown> {
  const call = mock.mock.calls[index];
  if (!call) throw new Error("fetch was not called");
  return JSON.parse(String((call[1] as RequestInit).body));
}

describe("buildProjectData", () => {
  it("produces exactly the three top-level keys Django accepts", () => {
    const data = buildProjectData(TIMELINE_VALUES, { palette: "dusk" });
    expect(Object.keys(data).sort()).toEqual(["themeSelections", "values", "version"]);
    expect(data.version).toBe(PROJECT_DATA_VERSION);
  });

  it("passes product values through untouched — the backend treats them as opaque", () => {
    const data = buildProjectData(TIMELINE_VALUES, {});
    expect(data.values).toEqual(TIMELINE_VALUES);
  });
});

describe("projectEngine.save", () => {
  beforeEach(() => setCookie("csrftoken=t"));
  afterEach(() => vi.restoreAllMocks());

  it("creates a project when there is no id yet, sending the Django product slug", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ...SAVED_PROJECT, projectId: "new-1" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const result = await realProjectEngine.save(undefined, {
      productId: "heart-map",
      values: TIMELINE_VALUES,
      themeSelections: { palette: "dusk" },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/projects");
    expect(init.method).toBe("POST");
    expect(requestBody(fetchMock)).toEqual({
      productId: "heart-map",
      data: { version: 1, values: TIMELINE_VALUES, themeSelections: { palette: "dusk" } },
      status: "draft",
    });
    expect(result.projectId).toBe("new-1");
  });

  it("never sends the public slug to the API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SAVED_PROJECT, 201));
    vi.stubGlobal("fetch", fetchMock);

    await realProjectEngine.save(undefined, {
      productId: "heart-map",
      values: {},
      themeSelections: {},
    });

    expect(JSON.stringify(fetchMock.mock.calls[0])).not.toContain("where-we-met");
  });

  it("updates in place once the project exists, replacing data wholesale", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SAVED_PROJECT));
    vi.stubGlobal("fetch", fetchMock);

    await realProjectEngine.save("p-1", {
      productId: "heart-map",
      values: { partner1: "B" },
      themeSelections: {},
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/projects/p-1");
    expect(init.method).toBe("PATCH");
    // productId is not resent — a project cannot change product.
    expect(requestBody(fetchMock)).not.toHaveProperty("productId");
  });
});

describe("projectEngine.load", () => {
  beforeEach(() => setCookie("csrftoken=t"));
  afterEach(() => vi.restoreAllMocks());

  it("returns the product and the restored state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(SAVED_PROJECT)));

    const loaded = await realProjectEngine.load("p-1");

    expect(loaded?.productId).toBe("heart-map");
    expect(loaded?.state.values).toEqual({ partner1: "A" });
    expect(loaded?.state.themeSelections).toEqual({ palette: "dusk" });
  });

  it.each([
    ["missing", 404, "project_not_found"],
    ["owned by another guest", 403, "project_access_denied"],
    ["no guest identity yet", 401, "customer_identity_required"],
  ])("returns null when the project is %s", async (_label, status, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: { code, message: "" } }, status)));
    expect(await realProjectEngine.load("p-1")).toBeNull();
  });

  it("rethrows a server failure rather than pretending the project is gone", async () => {
    // Showing an empty Studio here would look like the customer's work
    // had been lost, which is worse than an honest error.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: { code: "server_error" } }, 500)));
    await expect(realProjectEngine.load("p-1")).rejects.toThrow();
  });
});

describe("/project/:id product resolution", () => {
  beforeEach(() => setCookie("csrftoken=t"));
  afterEach(() => vi.restoreAllMocks());

  it("resolves a saved project to its Django product id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(SAVED_PROJECT)));
    expect(await resolveProjectProductId("p-1")).toBe("heart-map");
  });

  it("returns null for an unavailable project so the route renders its error state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: { code: "project_not_found" } }, 404)));
    expect(await resolveProjectProductId("p-1")).toBeNull();
  });

  it("mounts the right Studio module from the Django id, without exposing it as a URL", () => {
    // Django stores the stable id; the URL must never show it.
    expect(resolveProductEntry("love-story-timeline")?.id).toBe("love-story-timeline");
    expect(resolveProductEntry("love-story-timeline")?.slug).toBe("love-story-timeline");
  });

  it("refuses to resume a project for a withdrawn product (§1, §14)", () => {
    // A saved Where We Met draft can no longer be reopened in the Studio,
    // by either identifier. That is intended: the product is not on sale,
    // so finishing the draft could only end at a checkout that must not
    // happen. Orders already placed are unaffected — `/orders/:id` reads
    // Django directly and never consults this registry.
    expect(resolveProductEntry("heart-map")).toBeUndefined();
    expect(resolveProductEntry("where-we-met")).toBeUndefined();
  });
});
