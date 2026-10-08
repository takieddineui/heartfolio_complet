import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpeningSequence } from "./opening-sequence";

/**
 * `useReducedMotion` (framer-motion) reads `window.matchMedia(
 * '(prefers-reduced-motion: reduce)')`, which jsdom does not implement
 * at all — every test here needs a real, controllable stand-in, not
 * jsdom's default `undefined`. Scoped to this file rather than added to
 * `vitest.setup.ts` globally: nothing else in this codebase currently
 * renders a component that calls this specific hook, and a global mock
 * for a need only one file has is a global change with no shared
 * benefit yet.
 */
function mockMatchMedia(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe("OpeningSequence", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the couple's real names and title, not placeholder text", () => {
    mockMatchMedia(false);
    render(<OpeningSequence names="Alex & Sam" title="Ten Years Together" onDone={() => {}} />);
    expect(screen.getByText("Alex & Sam")).toBeInTheDocument();
    expect(screen.getByText("Ten Years Together")).toBeInTheDocument();
  });

  it("shows the photo only when one is provided", () => {
    const { rerender, container } = render(
      <OpeningSequence names="A & B" title="T" onDone={() => {}} />
    );
    expect(container.querySelector("img")).toBeNull();

    mockMatchMedia(false);
    rerender(<OpeningSequence names="A & B" title="T" photoUrl="https://example.com/p.jpg" onDone={() => {}} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://example.com/p.jpg");
  });

  // The reduced-motion case lives in its own file,
  // opening-sequence.reduced-motion.test.tsx — see that file's own
  // note on why: framer-motion's `useReducedMotion` caches its first
  // read of `matchMedia` at the module level, so a later test in THIS
  // file changing the mock's return value has no effect once an
  // earlier test has already triggered the hook with a different one.
  // Vitest gives each test FILE its own fresh module registry, which
  // is what actually isolates this — reordering tests within one file
  // does not.

  it("the skip button calls onDone without waiting for the full sequence", async () => {
    mockMatchMedia(false);
    const onDone = vi.fn();
    // A long durationMs, so the ONLY way onDone can fire within this
    // test's timeout is via the skip click actually working — a real
    // regression here (skip silently doing nothing) would time out
    // rather than pass for the wrong reason.
    render(<OpeningSequence names="A & B" title="T" onDone={onDone} durationMs={60_000} />);

    const skip = screen.getByText("Skip");
    await act(async () => skip.click());

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("calls onDone on its own after the sequence, with no interaction", async () => {
    mockMatchMedia(false);
    const onDone = vi.fn();
    // A short real duration — framer-motion's exit transition runs on
    // actual animation frames, not `setTimeout`, so it does not
    // cooperate with fake timers; this keeps the test fast without
    // fighting that, the same reasoning `durationMs` was added for.
    render(<OpeningSequence names="A & B" title="T" onDone={onDone} durationMs={20} />);

    expect(onDone).not.toHaveBeenCalled();
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });
});
