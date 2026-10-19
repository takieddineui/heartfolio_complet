import { describe, expect, it } from "vitest";
import { lineDirection } from "./line-direction";

/** The print's rule: a line's direction is its first strong letter's. */
describe("lineDirection", () => {
  it.each([
    ["Here Comes the Sun", "ltr"],
    ["أحبك أكثر من أي شيء", "rtl"],
    ["ماجد المهندس · HEARTFOLIO", "rtl"],
    ["Layla & عمر", "ltr"],
    ["1975 أحبك", "rtl"],
    ["« أحبك »", "rtl"],
    ["אהבה", "rtl"],
    ["Éléonore", "ltr"],
  ])("%s is %s", (text, direction) => {
    expect(lineDirection(text)).toBe(direction);
  });

  it.each(["", " ", "1975", "— …", null, undefined])("has no direction for %j, so the poster's left-to-right holds", (text) => {
    expect(lineDirection(text)).toBeUndefined();
  });
});
