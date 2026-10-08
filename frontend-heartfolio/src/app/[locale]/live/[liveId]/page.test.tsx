import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The live keepsake page turns EVERY fetch failure into a 404 (§21f: one
 * generic outcome, so a stranger learns nothing). That is right for "this
 * keepsake is unavailable" and wrong for a missing BACKEND_API_ORIGIN, which
 * would show every gift recipient "this page wandered off" for a keepsake that
 * exists. The origin is therefore resolved before the try/catch, and these pin
 * that the two cases stay distinguishable.
 */

class NotFoundSignal extends Error {}

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundSignal("NEXT_NOT_FOUND");
  },
}));
vi.mock("next-intl/server", () => ({ setRequestLocale: () => {} }));
// The page's own components are irrelevant to the fetch path under test.
vi.mock("@/components/live/live-keepsake", () => ({ LiveKeepsake: () => null }));
vi.mock("@/components/live-song/song-live-keepsake", () => ({ SongLiveKeepsake: () => null }));

import LivePage from "./page";

const params = (liveId = "abc") => Promise.resolve({ locale: "en", liveId });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("LivePage — backend origin", () => {
  it("throws a configuration error, NOT a 404, when BACKEND_API_ORIGIN is unset", async () => {
    vi.stubEnv("BACKEND_API_ORIGIN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = LivePage({ params: params() });

    await expect(result).rejects.toThrow(/BACKEND_API_ORIGIN is not set/);
    await expect(result).rejects.not.toBeInstanceOf(NotFoundSignal);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still returns the generic 404 when the origin is set and the keepsake is unavailable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(LivePage({ params: params("some id") })).rejects.toBeInstanceOf(NotFoundSignal);

    // And it asked the configured origin, with the id encoded.
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://backend.test/api/v1/live/some%20id/");
  });

  it("still returns the generic 404 when the origin is set but unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    await expect(LivePage({ params: params() })).rejects.toBeInstanceOf(NotFoundSignal);
  });
});
