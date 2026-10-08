import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OpeningSequence } from "./opening-sequence";

/**
 * ITS OWN FILE, DELIBERATELY — not folded into `opening-sequence.
 * test.tsx` alongside the other cases. Framer Motion's `useReducedMotion`
 * reads `window.matchMedia` once and caches the result at the module
 * level; once an earlier test in the SAME file has triggered the hook
 * with one value, a later test's `matchMedia` mock returning a
 * different value has no effect — confirmed directly: this exact test
 * passed when run alone and failed when run after the other cases in
 * the same file. Vitest gives each test FILE its own fresh module
 * registry, which is what actually isolates this; reordering tests
 * within one file does not.
 */
function mockReducedMotion() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: true,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe("OpeningSequence — reduced motion", () => {
  it("calls onDone immediately and renders nothing — not a shorter sequence, no sequence", async () => {
    mockReducedMotion();
    const onDone = vi.fn();
    render(<OpeningSequence names="A & B" title="T" onDone={onDone} />);

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("A & B")).not.toBeInTheDocument();
    expect(screen.queryByText("Skip")).not.toBeInTheDocument();
  });
});
