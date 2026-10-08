import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SITE_DOMAIN } from "@/lib/site-config";
import { PreviewWatermark } from "./preview-watermark";

/**
 * ---------------------------------------------------------------------
 * §20 — the watermark, and the one property that must not break
 * ---------------------------------------------------------------------
 * The visual details here are cosmetic and can change freely. What cannot
 * change is that the watermark stays outside the node registered as an
 * export target: `exportTargets` has no consumer today, but it exists for a
 * client-side export that has not been written, and the failure mode of
 * getting this wrong is a watermark baked into a keepsake someone paid for.
 *
 * That is a silent failure — nothing throws, nothing looks wrong in the
 * Studio, and it would surface as a customer complaint about a delivered
 * file. Hence a test rather than a comment.
 */

describe("PreviewWatermark", () => {
  it("repeats the site domain across the canvas", () => {
    render(<PreviewWatermark width={800} height={1200} />);
    expect(screen.getAllByText(SITE_DOMAIN).length).toBeGreaterThan(10);
  });

  it("is hidden from assistive technology and cannot be clicked", () => {
    // Anti-theft decoration, not content. It must not be announced, and it
    // must not intercept a click meant for the artwork beneath it.
    const { container } = render(<PreviewWatermark width={800} height={1200} />);
    const overlay = container.querySelector("[data-testid='preview-watermark']")!;

    expect(overlay.getAttribute("aria-hidden")).toBe("true");
    expect(overlay.className).toContain("pointer-events-none");
  });

  it("scales the mark with the canvas rather than using a fixed size", () => {
    // A phone wallpaper and a 12×18 poster differ by an order of magnitude;
    // a fixed size would be illegible on one and overwhelming on the other.
    const small = render(<PreviewWatermark width={400} height={600} />);
    const smallSize = (small.container.querySelector("span") as HTMLElement).style.fontSize;
    small.unmount();

    const large = render(<PreviewWatermark width={3600} height={5400} />);
    const largeSize = (large.container.querySelector("span") as HTMLElement).style.fontSize;

    expect(parseFloat(largeSize)).toBeGreaterThan(parseFloat(smallSize));
  });

  it("stays legible on a very small canvas", () => {
    // The proportional size has a floor; without it a small preview would
    // watermark itself with sub-pixel text and offer no protection at all.
    const { container } = render(<PreviewWatermark width={120} height={160} />);
    const fontSize = parseFloat((container.querySelector("span") as HTMLElement).style.fontSize);
    expect(fontSize).toBeGreaterThanOrEqual(11);
  });
});

describe("watermark containment (§20)", () => {
  it("renders outside the node registered as an export target", async () => {
    // The load-bearing assertion. Rebuilt here rather than mounting the whole
    // Studio, so the test states the structural rule directly: whatever node
    // is handed to `registerExportTarget` must not contain the watermark.
    const { ComponentRendererTestHarness, registered } = await buildHarness();

    render(<ComponentRendererTestHarness />);

    const exportNode = registered.node!;
    expect(exportNode).toBeTruthy();
    expect(exportNode.querySelector("[data-testid='preview-watermark']")).toBeNull();

    // ...while still being present in the preview the customer sees.
    expect(screen.getAllByText(SITE_DOMAIN).length).toBeGreaterThan(0);
  });

  it("holds in the real ComponentRenderer, not just this harness", () => {
    // The harness above states the rule; this checks the actual component
    // obeys it. Without this, someone could nest the watermark inside the
    // export node and the harness test would keep passing happily.
    const source = readFileSync("src/components/studio/preview/component-renderer.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

    const registerIndex = source.indexOf("registerExportTarget(");
    expect(registerIndex).toBeGreaterThan(-1);

    // The export-target div must be closed before the watermark appears.
    const exportDivCloses = source.indexOf("</div>", registerIndex);
    const watermarkAt = source.indexOf("<PreviewWatermark");

    expect(watermarkAt).toBeGreaterThan(-1);
    expect(exportDivCloses).toBeGreaterThan(-1);
    expect(watermarkAt).toBeGreaterThan(exportDivCloses);
  });
});

/**
 * Mirrors `ComponentRenderer`'s structure without dragging in the product
 * state context, the renderer registry or a real product module. If that
 * component's nesting changes, this harness must be updated to match — and
 * the point of the assertion is that doing so should require thinking about
 * why.
 */
async function buildHarness() {
  const registered: { node: HTMLElement | null } = { node: null };
  const registerExportTarget = vi.fn((_id: string, node: HTMLElement | null) => {
    if (node) registered.node = node;
  });

  const width = 800;
  const height = 1200;

  function ComponentRendererTestHarness() {
    return (
      <div style={{ width, height, position: "relative" }}>
        <div ref={(node) => registerExportTarget("default", node)} style={{ width, height }}>
          <p>artwork</p>
        </div>
        <PreviewWatermark width={width} height={height} />
      </div>
    );
  }

  return { ComponentRendererTestHarness, registered };
}
