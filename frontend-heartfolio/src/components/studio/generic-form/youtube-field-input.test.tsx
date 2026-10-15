import { createContext, useContext, useEffect, useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { YouTubeFieldSchema } from "@/types/studio";

type Check = (url: string, signal: AbortSignal) => Promise<unknown>;
const harness = vi.hoisted(() => ({ ctx: null as unknown as React.Context<unknown>, check: null as unknown as Mock<Check> }));
vi.mock("@/lib/studio/product-state-context", () => ({ useProductState: () => useContext(harness.ctx) }));
vi.mock("@/lib/api/youtube", () => ({ checkYouTubeLink: (url: string, signal: AbortSignal) => harness.check(url, signal) }));

import { YouTubeFieldInput } from "./youtube-field-input";

/**
 * SONG POSTER'S YOUTUBE LINK. Until 15 Oct 2026 nothing called the backend
 * check, so the confirmed id was never set and no customer could reach
 * checkout. These pin the field that now does: it checks a recognised link
 * once, stores the confirmed id beside it, and never lets a confirmation
 * outlive the link it was for.
 */
harness.ctx = createContext<unknown>(null);
const FIELD: YouTubeFieldSchema = { id: "youtubeUrl", type: "youtube", label: "link", confirmedIdField: "youtubeVideoId", maxLength: 300 };
const A = "https://www.youtube.com/watch?v=KQetemT1sWc";
const B = "https://youtu.be/dQw4w9WgXcQ";
const found = (videoId: string, title = `Song ${videoId}`) => ({ valid: true, videoId, title, authorName: "Channel", thumbnailUrl: "https://i.ytimg.com/t.jpg" });

type Updater = (prev: Record<string, unknown>) => Record<string, unknown>;
/** What the Studio holds after each render, and a way to change it that
 * does not come from typing (the checkout's `replaceValues`, a restored
 * project): React renders such a change later than a keystroke, so it is the
 * path on which an answer can land before the old request is aborted. */
const probe: { state: Record<string, unknown>; updateFromElsewhere: (updater: Updater) => void } = {
  state: {},
  updateFromElsewhere: () => undefined,
};
function Harness({ initial, locale = "en" }: { initial: Record<string, unknown>; locale?: string }) {
  const [values, setValuesState] = useState(initial);
  const setValues = (updater: Updater) => setValuesState((prev) => updater(prev));
  useEffect(() => {
    probe.state = values;
    probe.updateFromElsewhere = setValues;
  });
  return (
    <harness.ctx.Provider value={{ values, setValues, locale }}>
      <YouTubeFieldInput id="yt" field={FIELD} t={(k) => k} inputClass="" />
    </harness.ctx.Provider>
  );
}

const input = () => document.getElementById("yt") as HTMLInputElement;
const type = (text: string) => act(() => void fireEvent.change(input(), { target: { value: text } }));
const statusOf = () => document.querySelector("[data-youtube-status]")!.getAttribute("data-youtube-status");
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 650)));

beforeEach(() => {
  harness.check = vi.fn(async (url: string) => {
    const id = url.includes("dQw4w9WgXcQ") ? "dQw4w9WgXcQ" : "KQetemT1sWc";
    return found(id);
  });
});
afterEach(() => vi.restoreAllMocks());

describe("a recognised link", () => {
  it("is checked once typing pauses, then confirmed with what YouTube found", async () => {
    render(<Harness initial={{ youtubeUrl: "" }} />);
    await type(A);
    expect(statusOf()).toBe("checking");
    expect(harness.check).not.toHaveBeenCalled(); // waits for the pause
    await settle();
    expect(harness.check).toHaveBeenCalledTimes(1);
    expect(harness.check.mock.calls[0]![0]).toBe(A); // the link exactly as typed
    expect(probe.state).toEqual({ youtubeUrl: A, youtubeVideoId: "KQetemT1sWc" });
    expect(statusOf()).toBe("confirmed");
    expect(screen.getByText("Song KQetemT1sWc")).toBeInTheDocument();
    expect(screen.getByText("Found on YouTube")).toBeInTheDocument();
  });

  it("is never checked per keystroke, and text that is not a link is never sent", async () => {
    render(<Harness initial={{ youtubeUrl: "" }} />);
    for (const partial of ["h", "https://", "https://www.youtube.com/watch?v=KQe", "not a link at all"]) await type(partial);
    await settle();
    expect(harness.check).not.toHaveBeenCalled();
    for (let n = 30; n <= A.length; n++) await type(A.slice(0, n));
    await settle();
    expect(harness.check).toHaveBeenCalledTimes(1);
  });

  it("checks only the link that stayed, when one replaces another within the pause", async () => {
    render(<Harness initial={{ youtubeUrl: "" }} />);
    await type(A);
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    await type(B);
    await settle();
    expect(harness.check).toHaveBeenCalledTimes(1);
    expect(harness.check.mock.calls[0]![0]).toBe(B);
  });
});

describe("a confirmation never outlives its link", () => {
  it("is cleared in the same edit that changes the video", async () => {
    render(<Harness initial={{ youtubeUrl: A, youtubeVideoId: "KQetemT1sWc" }} />);
    await type(B);
    expect(probe.state.youtubeVideoId).toBeUndefined(); // before any answer
    await settle();
    expect(probe.state.youtubeVideoId).toBe("dQw4w9WgXcQ");
  });

  it("survives an edit that keeps the same video (a share suffix added)", async () => {
    render(<Harness initial={{ youtubeUrl: A, youtubeVideoId: "KQetemT1sWc" }} />);
    await type(`${A}&t=42s`);
    await settle();
    expect(probe.state.youtubeVideoId).toBe("KQetemT1sWc");
    expect(harness.check).not.toHaveBeenCalled();
  });

  it("ignores a slow answer for a link that has since changed", async () => {
    let answerA: (value: unknown) => void = () => undefined;
    harness.check = vi.fn((url: string) => (url.includes("KQetemT1sWc") ? new Promise((resolve) => (answerA = resolve)) : Promise.resolve(found("dQw4w9WgXcQ"))));
    render(<Harness initial={{ youtubeUrl: "" }} />);
    await type(A);
    await settle(); // A asked, not answered
    await type(B);
    await settle(); // B answered
    await act(async () => answerA(found("KQetemT1sWc"))); // A's answer arrives last
    expect(probe.state).toEqual({ youtubeUrl: B, youtubeVideoId: "dQw4w9WgXcQ" });
    expect(statusOf()).toBe("confirmed");
  });

  it("does not remember a request it abandoned as 'could not check'", async () => {
    // A real browser abort REJECTS the request; that is not YouTube's answer.
    harness.check = vi.fn(
      (url: string, signal: AbortSignal) =>
        new Promise((resolve, reject) => {
          if (url.includes("dQw4w9WgXcQ")) return resolve({ valid: false, code: "unavailable" });
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          if (harness.check.mock.calls.length > 2) resolve(found("KQetemT1sWc"));
        })
    );
    render(<Harness initial={{ youtubeUrl: "" }} />);
    await type(A);
    await settle(); // A in flight
    await type(B); // abandons A
    await settle();
    await type(A); // back to A: it must be asked again, not shown as failed
    await settle();
    expect(harness.check).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(probe.state.youtubeVideoId).toBe("KQetemT1sWc"));
  });

  it("never stores an answer for the old link when it lands in the same moment as the edit", async () => {
    let answerA: (value: unknown) => void = () => undefined;
    harness.check = vi.fn((url: string) =>
      url.includes("KQetemT1sWc") ? new Promise((resolve) => (answerA = resolve)) : Promise.resolve({ valid: false, code: "unavailable" })
    );
    render(<Harness initial={{ youtubeUrl: "" }} />);
    await type(A);
    await settle(); // A asked
    await act(async () => {
      probe.updateFromElsewhere((prev) => ({ ...prev, youtubeUrl: B })); // the link becomes B...
      answerA(found("KQetemT1sWc")); // ...as A answers, before B has rendered
    });
    await settle(); // B turns out to be unavailable
    expect(probe.state.youtubeUrl).toBe(B);
    expect(probe.state.youtubeVideoId).toBeUndefined(); // never A's id beside B's link
  });

  it("does not confirm an answer about another video than the one asked about", async () => {
    harness.check = vi.fn(async () => found("dQw4w9WgXcQ"));
    render(<Harness initial={{ youtubeUrl: "" }} />);
    await type(A);
    await settle();
    expect(probe.state.youtubeVideoId).toBeUndefined();
    expect(statusOf()).toBe("checkFailed");
  });
});

describe("one check per link", () => {
  it("asks nothing when a link already checked comes back (A, then B, then A)", async () => {
    render(<Harness initial={{ youtubeUrl: "" }} />);
    await type(A);
    await settle();
    await type(B);
    await settle();
    await type(A);
    await settle();
    expect(harness.check).toHaveBeenCalledTimes(2);
    // ...and A is confirmed again, not left waiting for a check that never comes.
    expect(probe.state.youtubeVideoId).toBe("KQetemT1sWc");
    expect(statusOf()).toBe("confirmed");
  });

  it("asks nothing for a saved project whose link is already confirmed", async () => {
    render(<Harness initial={{ youtubeUrl: A, youtubeVideoId: "KQetemT1sWc" }} />);
    await settle();
    expect(harness.check).not.toHaveBeenCalled();
    expect(statusOf()).toBe("confirmed");
    expect(screen.getByText("Link confirmed")).toBeInTheDocument();
  });
});

describe("when a link cannot be confirmed", () => {
  it("says the video cannot be played elsewhere, stores nothing and offers no retry", async () => {
    harness.check = vi.fn(async () => ({ valid: false, code: "unavailable" }));
    render(<Harness initial={{ youtubeUrl: "" }} />);
    await type(A);
    await settle();
    expect(statusOf()).toBe("unavailable");
    expect(screen.getByText(/can't be played on other sites/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(probe.state.youtubeVideoId).toBeUndefined();
  });

  it("offers a retry when the check itself failed, and the retry can confirm it", async () => {
    harness.check = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue(found("KQetemT1sWc"));
    render(<Harness initial={{ youtubeUrl: "" }} />);
    await type(A);
    await settle();
    expect(statusOf()).toBe("checkFailed");
    expect(probe.state.youtubeVideoId).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await settle();
    expect(harness.check).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(probe.state.youtubeVideoId).toBe("KQetemT1sWc"));
  });

  it("speaks the customer's language", async () => {
    render(<Harness initial={{ youtubeUrl: "" }} locale="ar" />);
    await type(A);
    expect(screen.getByText("جارٍ التحقق من الرابط…")).toBeInTheDocument();
    expect(input()).toHaveAttribute("dir", "ltr"); // a link reads left to right even in Arabic
  });
});
