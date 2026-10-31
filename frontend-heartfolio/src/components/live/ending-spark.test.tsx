import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SPARK_PATH } from "@/lib/brand/mark";
import { EndingSpark } from "./ending-spark";

describe("EndingSpark", () => {
  it("renders the exact spark path from the brand mark, not a redrawn shape", () => {
    const { container } = render(<EndingSpark />);
    const path = container.querySelector("path");
    expect(path?.getAttribute("d")).toBe(SPARK_PATH);
  });

  it("is decorative — hidden from assistive tech, no accessible name to announce", () => {
    const { container } = render(<EndingSpark />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});
