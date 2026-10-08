import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * jsdom does not implement `IntersectionObserver` at all. `RevealGroup`
 * (components/motion/reveal.tsx) uses Framer Motion's `whileInView`,
 * which needs one internally — any test that renders a `RevealGroup`
 * (directly, or through a component that uses one, like this file's own
 * `song-live-keepsake.test.tsx`) throws `ReferenceError:
 * IntersectionObserver is not defined` without this.
 *
 * GLOBAL rather than scoped to one file — unlike the `matchMedia` mock
 * in `opening-sequence.reduced-motion.test.tsx` (needed by exactly one
 * hook, in exactly one file, when it was added), `RevealGroup` is used
 * across seven-plus files site-wide, and this is only the FIRST test to
 * actually exercise one — every future test of a `RevealGroup`-wrapped
 * component hits the identical failure without this.
 *
 * A minimal stand-in, not a real implementation: nothing in this
 * codebase's tests asserts on actual intersection timing (there is no
 * jsdom layout engine for a real one to measure against anyway) — only
 * that `whileInView` mounts and animates without crashing. Framer
 * Motion calls `.observe()`/`.disconnect()`; that is all this needs to
 * provide.
 */
class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = "";
  readonly thresholds: ReadonlyArray<number> = [];
  observe() {
    /* no-op */
  }
  unobserve() {
    /* no-op */
  }
  disconnect() {
    /* no-op */
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

globalThis.IntersectionObserver = MockIntersectionObserver;

/**
 * Unmount between tests.
 *
 * This was missing, so every `render()` in a file accumulated in the same
 * document. Existing tests passed only because each happened to assert on
 * text unique to itself — the isolation was accidental, not designed.
 *
 * It surfaced when two tests in one file rendered the same component with
 * different props and a query matched both: "Found multiple elements".
 * Without this, a test can also pass because of something an EARLIER test
 * rendered, which is the worse failure of the two because nothing looks
 * wrong.
 */
afterEach(cleanup);
