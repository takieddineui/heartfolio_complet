import { describe, expect, it } from "vitest";
import { getProductModuleLoader, productModuleRegistry } from "./registry";

describe("productModuleRegistry", () => {
  it("resolves the Love Story Timeline loader (N.1)", () => {
    const loader = getProductModuleLoader("love-story-timeline");
    expect(loader).toBeDefined();
  });

  it("resolves the Where We Met Map loader", () => {
    const loader = getProductModuleLoader("heart-map");
    expect(loader).toBeDefined();
  });

  it("returns undefined for an unregistered product slug", () => {
    expect(getProductModuleLoader("does-not-exist")).toBeUndefined();
  });

  it("the Love Story Timeline loader resolves a real module with a component renderer", async () => {
    const loader = getProductModuleLoader("love-story-timeline")!;
    const resolvedModule = await loader();
    expect(resolvedModule.renderer.kind).toBe("component");
    expect(resolvedModule.formSchema.sections.length).toBeGreaterThan(0);
  });

  it("adding a mock product module requires no change to any shared file (N.6)", async () => {
    // Mutates the registry's own exported object directly, in-test —
    // module-loader.ts, renderer-registry.ts, and every shared Studio
    // component are completely untouched by this test.
    const mockModule = {
      formSchema: { sections: [] },
      themes: { axes: [] },
      renderer: { kind: "unset" as const },
      pricing: { currency: "USD", basePriceCents: 999, rules: [] },
      delivery: { mode: "export" as const, export: { targets: {} } },
      messages: {},
      createInitialState: () => ({ mock: true }),
      createInitialThemeSelections: () => ({}),
    };

    productModuleRegistry["__test_mock_product__"] = async () => mockModule;
    try {
      const loader = getProductModuleLoader("__test_mock_product__");
      expect(loader).toBeDefined();
      const resolved = await loader!();
      expect(resolved).toBe(mockModule);
    } finally {
      delete productModuleRegistry["__test_mock_product__"];
    }
  });
});
