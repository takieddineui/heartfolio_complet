import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { timelineMetadata } from "./metadata";
import { timelineSchema } from "./schema";

/**
 * The Studio's milestone cap (`maxEvents`, a product decision) and the
 * backend's `MAX_EVENTS` (what the renderers accept) are DIFFERENT numbers on
 * purpose, and these tests pin the relationship rather than either value
 * alone:
 *
 * - the Studio's form must use the cap, so "(n/5)" and the hidden add button
 *   cannot drift from it;
 * - the backend must accept AT LEAST the cap, or the Studio would let a
 *   customer build a story that fails at download after they have paid;
 * - and it must accept more than the cap while a project made under a higher
 *   cap can still exist, which is why lowering the cap does not lower it.
 */
function backendDataPy(): string {
  const configured = process.env.HEARTFOLIO_BACKEND_PATH;
  const roots = [
    ...(configured ? [isAbsolute(configured) ? configured : join(process.cwd(), configured)] : []),
    join(process.cwd(), "..", "backend"),
    join(process.cwd(), "..", "..", "backend", "backend"),
  ];
  for (const root of roots) {
    const file = join(root, "apps", "delivery", "product_renderers", "love_story_timeline", "data.py");
    if (existsSync(file)) return readFileSync(file, "utf8");
  }
  // Throws rather than skipping, like the parity test: a skipped comparison
  // would report a mismatch between the two caps as green.
  throw new Error("Cannot locate the backend's data.py. Set HEARTFOLIO_BACKEND_PATH. Tried: " + roots.join(" | "));
}

function backendConstant(name: string): number {
  const match = backendDataPy().match(new RegExp(`^${name}\\s*=\\s*(\\d+)`, "m"));
  if (!match) throw new Error(`data.py has no ${name}`);
  return parseInt(match[1]!, 10);
}

describe("milestone cap", () => {
  const events = timelineSchema.sections.flatMap((section) => section.fields).find((field) => field.id === "events");

  it("is three to five in the Studio", () => {
    expect(timelineMetadata).toEqual({ minEvents: 3, maxEvents: 5 });
  });

  it("is what the milestones form uses, so the counter and the add button follow it", () => {
    expect(events).toMatchObject({
      type: "group",
      minItems: timelineMetadata.minEvents,
      maxItems: timelineMetadata.maxEvents,
    });
  });

  it("never exceeds what the backend renderers accept", () => {
    expect(backendConstant("MIN_EVENTS")).toBe(timelineMetadata.minEvents);
    expect(backendConstant("MAX_EVENTS")).toBeGreaterThanOrEqual(timelineMetadata.maxEvents);
  });

  it("leaves the backend accepting what an earlier, higher cap allowed", () => {
    // Projects and paid orders made with six to eight milestones exist (the
    // Studio allowed up to eight until 20 Sep 2026), and must keep rendering.
    expect(backendConstant("MAX_EVENTS")).toBe(8);
  });
});
