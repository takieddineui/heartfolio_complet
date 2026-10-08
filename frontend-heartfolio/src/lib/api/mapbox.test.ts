import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * §6 — the milestone location field, on the Search Box API.
 *
 * UNTESTED AGAINST A LIVE MAPBOX TOKEN. These mock `fetch` against
 * Mapbox's documented Search Box response shapes; nothing here proves the
 * real API still matches them. Verify with a real token before shipping.
 *
 * Ported from the Geocoding v5 suite these replaced. The coordinate-order
 * and small-place cases are carried over deliberately — the endpoint
 * changed, but the mistakes worth guarding against did not.
 */
describe("Search Box suggest/retrieve", () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = originalToken;
    vi.resetModules();
  });

  it("returns nothing without a configured token, and never calls fetch", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "";
    vi.resetModules();
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { suggestMapboxPlaces } = await import("./mapbox");
    const results = await suggestMapboxPlaces("Lisbon", "session-1");

    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports whether a token is configured", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "pk.test";
    vi.resetModules();
    const { isMapboxConfigured } = await import("./mapbox");
    expect(isMapboxConfigured()).toBe(true);
  });

  it("maps suggestions to id/name/context", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "pk.test";
    vi.resetModules();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        suggestions: [
          {
            mapbox_id: "dXJuOm1ieHBvaTo0Mg",
            name: "Café A Brasileira",
            place_formatted: "Rua Garrett 120, Lisboa, Portugal",
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const { suggestMapboxPlaces } = await import("./mapbox");
    const [suggestion] = await suggestMapboxPlaces("Brasileira", "session-1");

    expect(suggestion!.id).toBe("dXJuOm1ieHBvaTo0Mg");
    expect(suggestion!.name).toBe("Café A Brasileira");
    expect(suggestion!.context).toBe("Rua Garrett 120, Lisboa, Portugal");
  });

  it("sends the session token on suggest, so the exchange bills as one session", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "pk.test";
    vi.resetModules();
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ suggestions: [] }) });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { suggestMapboxPlaces } = await import("./mapbox");
    await suggestMapboxPlaces("Lisbon", "session-abc");

    const url = String(fetchSpy.mock.calls[0]![0]);
    expect(url).toContain("session_token=session-abc");
    expect(url).toContain("/search/searchbox/v1/suggest");
  });

  it("transposes retrieve's [lng, lat] coordinates correctly, not swapped", async () => {
    /**
     * GeoJSON orders coordinates [lng, lat] — the reverse of how most
     * people say them out loud, and an easy thing to silently transpose.
     * Lisbon is roughly (38.7 N, 9.1 W): if lat and lng were swapped,
     * this catches it immediately rather than surfacing as "the pin
     * landed in the Indian Ocean" on a printed keepsake.
     */
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "pk.test";
    vi.resetModules();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          {
            geometry: { coordinates: [-9.1393, 38.7223] },
            properties: { mapbox_id: "place.123", name: "Lisboa", place_formatted: "Portugal" },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const { retrieveMapboxPlace } = await import("./mapbox");
    const place = await retrieveMapboxPlace("place.123", "session-1");

    expect(place!.lat).toBeCloseTo(38.7223);
    expect(place!.lng).toBeCloseTo(-9.1393);
    expect(place!.id).toBe("place.123");
    expect(place!.name).toBe("Lisboa, Portugal");
  });

  it("returns null when retrieve resolves to no usable feature", async () => {
    // Rather than inventing coordinates, which would put a wrong pin on
    // something the customer prints.
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "pk.test";
    vi.resetModules();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ features: [] }),
    }) as unknown as typeof fetch;

    const { retrieveMapboxPlace } = await import("./mapbox");
    expect(await retrieveMapboxPlace("nope", "session-1")).toBeNull();
  });

  it("does not search on a one-character query", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "pk.test";
    vi.resetModules();
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { suggestMapboxPlaces } = await import("./mapbox");
    await suggestMapboxPlaces("L", "session-1");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("asks for POIs as well as small-place types", () => {
    /**
     * The whole reason for leaving Geocoding v5: it no longer returns
     * POIs, and a milestone location is usually a POI. §6 also requires
     * precise locations including small towns, so a village that only
     * resolves as "locality" or "neighborhood" must stay findable.
     */
    const source = readFileSync("src/lib/api/mapbox.ts", "utf8");
    expect(source).toContain("poi");
    expect(source).toContain("locality");
    expect(source).toContain("neighborhood");
  });

  it("surfaces a non-OK response as an error rather than swallowing it", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "pk.test";
    vi.resetModules();
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch;

    const { suggestMapboxPlaces } = await import("./mapbox");
    await expect(suggestMapboxPlaces("Lisbon", "session-1")).rejects.toThrow("401");
  });

  it("generates a distinct session token each time", async () => {
    const { newMapboxSessionToken } = await import("./mapbox");
    expect(newMapboxSessionToken()).not.toBe(newMapboxSessionToken());
  });
});
