import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_COPY, liveCopy } from "./live-copy";

/**
 * Love Story Timeline's live page said "Skip", "♪ on" and "Open photo" in
 * English on /fr and /ar. The words now come from `live-copy.ts`, in the
 * order's language.
 */
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const page = strip(readFileSync("src/components/live/live-keepsake.tsx", "utf8"));
const opening = strip(readFileSync("src/components/live/opening-sequence.tsx", "utf8"));

describe("live page copy", () => {
  it("has every word in every language, each its own", () => {
    for (const key of Object.keys(LIVE_COPY.en) as (keyof typeof LIVE_COPY.en)[]) {
      for (const locale of ["fr", "ar"] as const) {
        expect(LIVE_COPY[locale][key], `${locale}.${key}`).toBeTruthy();
        expect(LIVE_COPY[locale][key], `${locale}.${key}`).not.toBe(LIVE_COPY.en[key]);
      }
    }
    expect(LIVE_COPY.ar.skip).not.toMatch(/[a-z]/i);
  });

  it("falls back to English for any other language", () => {
    expect(liveCopy("de")).toBe(LIVE_COPY.en);
    expect(liveCopy(undefined)).toBe(LIVE_COPY.en);
    expect(liveCopy("fr")).toBe(LIVE_COPY.fr);
  });

  it("is what the page uses: no English words left in its markup", () => {
    expect(page).toContain("liveCopy(locale)");
    for (const literal of ['"Open photo"', '"♪ on"', '"♪ off"']) expect(page).not.toContain(literal);
    expect(page).toContain("skipLabel={copy.skip}");
    expect(opening).toContain("{skipLabel}");
    expect(opening).not.toMatch(/>\s*Skip\s*</);
  });
});
