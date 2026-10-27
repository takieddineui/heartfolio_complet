import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The hero's text paints with the page (owner, 27 Oct 2026). Its paragraph is
 * the phone's largest contentful paint, and the old entrance animation (start
 * hidden, fade in after a delay) held it back about 1.4 s. Other sections keep
 * their reveal animations.
 */
const hero = readFileSync("src/components/sections/hero.tsx", "utf8");

describe("the home hero's text", () => {
  it("has no entrance animation", () => {
    expect(hero).not.toMatch(/<motion\./);
    expect(hero).not.toMatch(/initial=\{/);
    expect(hero).not.toMatch(/opacity:\s*0/);
  });
});
