import { describe, expect, it } from "vitest";
import { rendererRegistry, registerRenderer } from "./renderer-registry";
import type { RendererProps } from "./renderer-registry";

describe("rendererRegistry", () => {
  it("is a plain kind -> component lookup with no product-specific keys", () => {
    // The registry is keyed by RendererConfig["kind"] ("component",
    // "canvas", "svg", ...) — never by product slug. This is the
    // mechanism that keeps product-specific rendering out of the
    // shared Studio (see preview-pane.tsx, which looks up
    // rendererRegistry[session.module.renderer.kind] and never
    // branches on which product it's showing).
    for (const key of Object.keys(rendererRegistry)) {
      expect(["canvas", "svg", "webgl", "image", "unset", "component"]).toContain(key);
    }
  });

  it("registering a new renderer kind works generically", () => {
    function FakeRenderer(_props: RendererProps) {
      void _props;
      return null;
    }
    registerRenderer("svg", FakeRenderer);
    expect(rendererRegistry.svg).toBe(FakeRenderer);
    delete rendererRegistry.svg;
  });

  it("importing the component-renderer module registers the 'component' kind as a side effect", async () => {
    await import("@/components/studio/preview/component-renderer");
    expect(rendererRegistry.component).toBeDefined();
  });
});
