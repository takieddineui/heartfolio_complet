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
vi.mock("@/components/live-graduation/live-graduation", () => ({ LiveGraduation: () => null }));

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

describe("LivePage - payload dispatch", () => {
  const payload = (body: unknown) =>
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })));

  it("renders the graduation keepsake for a graduation payload, in a full-viewport frame, with its own values", async () => {
    payload({
      productId: "graduation-keepsake",
      locale: "fr",
      values: { gradName: "Maya" },
      themeSelections: { journey: "airline" },
    });

    const element = (await LivePage({ params: params("g1") })) as React.ReactElement<{
      style: { height: string };
      children: React.ReactElement<{ values: unknown; themeSelections: unknown; locale: string }>;
    }>;

    // `dvh`, not `vh`: a phone's address bar must not hide the bottom of it.
    expect(element.props.style.height).toBe("100dvh");
    const keepsake = element.props.children;
    expect(keepsake.props.values).toEqual({ gradName: "Maya" });
    expect(keepsake.props.themeSelections).toEqual({ journey: "airline" });
    expect(keepsake.props.locale).toBe("fr");
  });

  it("still gives a Love Story Timeline payload to the original keepsake", async () => {
    payload({
      productId: "love-story-timeline",
      locale: "en",
      scene: "s",
      level: "l",
      values: {},
      themeSelections: {},
      media: { backgroundMusic: null, milestones: [] },
    });
    const element = (await LivePage({ params: params("l1") })) as React.ReactElement;
    expect((element.type as { name?: string }).name).toBe("LiveKeepsake");
  });
});
