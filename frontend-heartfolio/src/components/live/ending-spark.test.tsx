import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EndingSpark } from "./ending-spark";

describe("EndingSpark", () => {
  it("renders the exact spark path from the brand mark, not a redrawn shape", () => {
    const { container } = render(<EndingSpark />);
    const path = container.querySelector("path");
    expect(path?.getAttribute("d")).toBe("M51 7 L52.8 13.2 L59 15 L52.8 16.8 L51 23 L49.2 16.8 L43 15 L49.2 13.2 Z");
  });

  it("is decorative — hidden from assistive tech, no accessible name to announce", () => {
    const { container } = render(<EndingSpark />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});
