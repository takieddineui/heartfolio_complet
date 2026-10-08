/**
 * LIVE INTEGRATION TEST — runs the real client code against a real Django.
 *
 * Skipped unless `HEARTFOLIO_INTEGRATION_BASE` is set, so the normal suite
 * stays hermetic:
 *
 *     HEARTFOLIO_INTEGRATION_BASE=http://localhost:3000 npx vitest run integration
 *
 * This is deliberately not a mocked test. It exercises `apiFetch`,
 * `identifyGuest` and `realProjectEngine` exactly as the browser does —
 * through the same-origin `/api/backend` proxy, with a real session cookie
 * and a real CSRF token — because the parts most likely to break in this
 * integration (cookie handling, CSRF, the trailing-slash rewrite, the
 * `data` shape Django's CHECK constraints enforce) are invisible to a test
 * that stubs `fetch`.
 *
 * Node's fetch has no cookie jar and jsdom's `document.cookie` is not wired
 * to it, so the shim below plays the part of the browser: it stores
 * `Set-Cookie`, replays it, and mirrors it into `document.cookie` where the
 * client reads the CSRF token from.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { identifyGuest, getGuestIdentity } from "@/lib/api/guest";
import { realProjectEngine } from "@/lib/studio/engines/project-engine";
import { getProject } from "@/lib/api/projects";
import { ApiError } from "@/lib/api/errors";

const BASE = process.env.HEARTFOLIO_INTEGRATION_BASE;
const suite = BASE ? describe : describe.skip;

function installBrowserLikeFetch(base: string) {
  const jar = new Map<string, string>();
  const realFetch = globalThis.fetch;

  const shim: typeof fetch = async (input, init) => {
    const path = String(input);
    const url = path.startsWith("http") ? path : `${base}${path}`;

    const headers = new Headers(init?.headers as HeadersInit | undefined);
    if (jar.size > 0) {
      headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    }
    // Browsers send Origin on same-origin unsafe requests; Django's CSRF
    // check compares it against CSRF_TRUSTED_ORIGINS.
    headers.set("origin", base);

    const response = await realFetch(url, { ...init, headers });

    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const [pair] = cookie.split(";");
      const [name, ...rest] = (pair ?? "").split("=");
      if (!name) continue;
      const value = rest.join("=");
      jar.set(name.trim(), value);
      document.cookie = `${name.trim()}=${value}`;
    }
    return response;
  };

  globalThis.fetch = shim;
  return () => {
    globalThis.fetch = realFetch;
    jar.clear();
  };
}

let restoreFetch = () => {};

const TIMELINE_VALUES = {
  partner1: "Amelia",
  partner2: "Youssef",
  posterTitle: "Our Story",
  showDuration: true,
  events: [
    { date: "2019-06-01", title: "We met", description: "A rainy Tuesday in Lyon" },
    { date: "2021-09-14", title: "We moved in", description: "Two suitcases and a plant" },
  ],
};

const MAP_VALUES = {
  partner1: "Amelia",
  partner2: "Youssef",
  date: "2019-06-01",
  locationLabel: "Lyon, France",
  coordinates: { lat: 45.764043, lng: 4.835659 },
  message: "Where it started",
};

suite("Studio ↔ Django project persistence (live)", () => {
  beforeAll(() => {
    restoreFetch = installBrowserLikeFetch(BASE!);
  });
  afterAll(() => restoreFetch());

  it("rejects project creation before a guest identity exists", async () => {
    // Establishes the CSRF cookie without creating a customer.
    const identity = await getGuestIdentity();
    expect(identity.customerId).toBeNull();

    const error = await realProjectEngine
      .save(undefined, { productId: "love-story-timeline", values: {}, themeSelections: {} })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isIdentityRequired).toBe(true);
  });

  it.each([
    ["love-story-timeline", TIMELINE_VALUES, { palette: "dusk", layout: "standard" }],
    ["heart-map", MAP_VALUES, { palette: "ivory", frame: "thin" }],
  ])("round-trips %s: create → update → reload with identical data", async (productId, values, themes) => {
    const email = `step7-${productId}-${Date.now()}@heartfolio.test`;
    const identity = await identifyGuest(email);
    expect(identity.customerId).toBeTruthy();

    // CREATE
    const created = await realProjectEngine.save(undefined, {
      productId,
      values: values as Record<string, unknown>,
      themeSelections: themes,
    });
    expect(created.projectId).toBeTruthy();

    // RELOAD — same data comes back
    const loaded = await realProjectEngine.load(created.projectId);
    expect(loaded).not.toBeNull();
    expect(loaded!.productId).toBe(productId);
    expect(loaded!.state.values).toEqual(values);
    expect(loaded!.state.themeSelections).toEqual(themes);

    // UPDATE
    const edited = { ...(values as Record<string, unknown>), partner1: "Amélie" };
    const saved = await realProjectEngine.save(created.projectId, {
      productId,
      values: edited,
      themeSelections: { ...themes, palette: "midnight" },
    });
    expect(saved.projectId).toBe(created.projectId); // updates in place, no duplicate row

    // RELOAD AGAIN — the edit persisted
    const reloaded = await realProjectEngine.load(created.projectId);
    expect(reloaded!.state.values).toEqual(edited);
    expect(reloaded!.state.themeSelections.palette).toBe("midnight");

    // The stored envelope is exactly what Django's constraints require.
    const raw = await getProject(created.projectId);
    expect(Object.keys(raw.data).sort()).toEqual(["themeSelections", "values", "version"]);
    expect(raw.status).toBe("draft");
  });

  it("preserves non-ASCII and nested product state byte-for-byte", async () => {
    await identifyGuest(`step7-i18n-${Date.now()}@heartfolio.test`);

    const values = {
      partner1: "أميرة",
      partner2: "Amélie",
      posterTitle: "قصتنا",
      events: [{ date: "2020-02-02", title: "بداية", description: "Café de Flore — 8h" }],
    };
    const created = await realProjectEngine.save(undefined, {
      productId: "love-story-timeline",
      values,
      themeSelections: {},
    });

    const loaded = await realProjectEngine.load(created.projectId);
    expect(loaded!.state.values).toEqual(values);
  });

  it("does not let one guest read another guest's project", async () => {
    await identifyGuest(`step7-owner-${Date.now()}@heartfolio.test`);
    const created = await realProjectEngine.save(undefined, {
      productId: "love-story-timeline",
      values: { partner1: "Owner" },
      themeSelections: {},
    });

    // A different email is a different customer on the same session.
    await identifyGuest(`step7-intruder-${Date.now()}@heartfolio.test`);
    expect(await realProjectEngine.load(created.projectId)).toBeNull();
  });

  it("refuses a product that is not in the Django catalog", async () => {
    await identifyGuest(`step7-badproduct-${Date.now()}@heartfolio.test`);

    const error = await realProjectEngine
      .save(undefined, { productId: "star-map", values: {}, themeSelections: {} })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("product_not_found");
  });

  it("refuses the public slug, proving the slug boundary is real", async () => {
    await identifyGuest(`step7-slug-${Date.now()}@heartfolio.test`);

    const error = await realProjectEngine
      .save(undefined, { productId: "where-we-met", values: {}, themeSelections: {} })
      .catch((e: unknown) => e);

    expect((error as ApiError).code).toBe("product_not_found");
  });
});
