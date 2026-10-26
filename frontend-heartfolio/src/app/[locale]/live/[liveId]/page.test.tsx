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
// The incoming request's headers, as Caddy hands them to Next.
const requestHeaders = vi.hoisted(() => ({ current: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders.current }));
// The page's own components are irrelevant to the fetch path under test.
vi.mock("@/components/live/live-keepsake", () => ({ LiveKeepsake: () => null }));
vi.mock("@/components/live-song/song-live-keepsake", () => ({ SongLiveKeepsake: () => null }));
vi.mock("@/components/live-reasons/reasons-live-page", () => ({ ReasonsLivePage: () => null }));
vi.mock("@/components/live-graduation/graduation-live-page", () => ({ GraduationLivePage: () => null }));

import LivePage from "./page";
import { LiveKeepsake } from "@/components/live/live-keepsake";
import { ReasonsLivePage } from "@/components/live-reasons/reasons-live-page";
import { GraduationLivePage } from "@/components/live-graduation/graduation-live-page";
import { LivePayloadView } from "@/components/live/live-payload";

type Element = { type: unknown; props: Record<string, unknown> };

/** The page hands the payload to `LivePayloadView` (shared with the dev-only
 *  capture page); this follows it to the product's own component. */
async function rendered(page: Promise<unknown>): Promise<Element> {
  const element = (await page) as Element;
  expect(element.type).toBe(LivePayloadView);
  return (LivePayloadView as (props: never) => Element)(element.props as never);
}

const params = (liveId = "abc") => Promise.resolve({ locale: "en", liveId });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  requestHeaders.current = new Headers();
});

describe("LivePage — the visitor's address", () => {
  /** Django throttles the live endpoint per `X-Forwarded-For`. Without it,
   *  every recipient was the web container: one shared bucket (26 Oct 2026). */
  it("passes the visitor's X-Forwarded-For on to Django", async () => {
    requestHeaders.current = new Headers({ "x-forwarded-for": "203.0.113.7" });
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(LivePage({ params: params() })).rejects.toBeInstanceOf(NotFoundSignal);

    const sent = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(sent.get("x-forwarded-for")).toBe("203.0.113.7");
  });

  it("sends none when the request had none, rather than inventing one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(LivePage({ params: params() })).rejects.toBeInstanceOf(NotFoundSignal);

    const sent = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(sent.has("x-forwarded-for")).toBe(false);
  });
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

describe("LivePage — Reasons I Love You", () => {
  const values = {
    gift: "deck",
    toName: "Hana",
    fromName: "Theo",
    title: "",
    reasons: [{ text: "Your laugh.", memory: "", photo: null }],
    finaleTeaser: "",
    finaleLine: "You are you.",
    signature: "",
    letter: null,
    music: true,
    share: true,
  };

  it("hands a Reasons payload to the Reasons page, with the ORDER's locale and the id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ productId: "reasons-i-love-you", locale: "ar", values }), { status: 200 }))
    );

    const element = await rendered(LivePage({ params: params("xyz") }));

    expect(element.type).toBe(ReasonsLivePage);
    expect(element.type).not.toBe(LiveKeepsake);
    expect(element.props.liveId).toBe("xyz");
    expect(element.props.locale).toBe("ar");
    expect(element.props.initial).toEqual(values);
  });

  it("still sends Love Story Timeline's payload to its own page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ productId: "love-story-timeline", locale: "en", scene: "", level: "", values: {}, themeSelections: {}, media: { backgroundMusic: null, milestones: [] } }),
          { status: 200 }
        )
      )
    );

    const element = await rendered(LivePage({ params: params() }));

    expect(element.type).toBe(LiveKeepsake);
  });
});

describe("LivePage — Graduation Keepsake", () => {
  it("hands a Graduation payload to its own page, with the ORDER's locale and the id", async () => {
    const values = { journey: "summit", grad: { name: "Maya" } };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ productId: "graduation-keepsake", locale: "fr", values }), { status: 200 }))
    );

    const element = await rendered(LivePage({ params: params("grad1") }));

    expect(element.type).toBe(GraduationLivePage);
    expect(element.type).not.toBe(ReasonsLivePage);
    expect(element.props).toMatchObject({ liveId: "grad1", locale: "fr", initial: values });
  });
});
