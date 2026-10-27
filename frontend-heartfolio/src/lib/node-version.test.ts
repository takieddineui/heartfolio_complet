// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * ONE NODE VERSION, NAMED THE SAME EVERYWHERE (27 Oct 2026).
 *
 * The web image ran node:20-slim while the dependencies wanted 22 or 24, and
 * `npm ci` failed outright once the lockfile came from a different npm than
 * the image's. Every Dockerfile stage, `.nvmrc` and `engines` must agree, and
 * the lockfile must have been regenerated after `engines` changed (CLAUDE.md:
 * regenerate it with the image's own npm).
 */
const dockerfile = readFileSync("Dockerfile", "utf8");
const nvmrc = readFileSync(".nvmrc", "utf8").trim();
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));

const stages = [...dockerfile.matchAll(/^FROM node:(\d+)-slim\b/gm)].map((m) => m[1]);

describe("the Node version", () => {
  it("is the same in every Dockerfile stage, and an LTS line", () => {
    expect(stages.length).toBe(3);
    expect(new Set(stages).size).toBe(1);
    expect(Number(stages[0]) % 2).toBe(0);
    expect(dockerfile).not.toMatch(/^FROM node:(?!\d+-slim\b)/m);
  });

  it("is what .nvmrc and engines name", () => {
    expect(nvmrc).toBe(stages[0]);
    expect(pkg.engines?.node).toMatch(new RegExp(`\\^${stages[0]}\\.`));
  });

  it("is recorded in the lockfile too (regenerated after engines changed)", () => {
    expect(lock.packages[""].engines).toEqual(pkg.engines);
  });
});
