import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedProductModuleConfig } from "@/types/studio";
import { assertModuleIntegrity } from "./module-integrity";

const moduleWith = (sections: ResolvedProductModuleConfig["formSchema"]["sections"]): ResolvedProductModuleConfig =>
  ({
    productId: "x",
    formSchema: { sections },
    themes: { axes: [] },
    renderer: { kind: "unset" },
    pricing: { currency: "USD", basePriceCents: 0, rules: [] },
    delivery: { mode: "export", export: { targets: {} } },
    messages: {},
    createInitialState: () => ({}),
    createInitialThemeSelections: () => ({}),
  }) as ResolvedProductModuleConfig;

const group = (id: string, ...itemIds: string[]) => ({
  id,
  type: "group" as const,
  label: id,
  minItems: 1,
  maxItems: 2,
  itemFields: itemIds.map((i) => ({ id: i, type: "text" as const, label: i })),
});

afterEach(() => vi.restoreAllMocks());

describe("assertModuleIntegrity - duplicate field ids", () => {
  it("allows the same item-field id in different groups (an item's keys are its own)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    assertModuleIntegrity("x", moduleWith([{ id: "s", title: "s", fields: [group("stops", "code"), group("goals", "code", "text")] }]));
    expect(warn).not.toHaveBeenCalled();
  });

  it("still flags two top-level fields that share an id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    assertModuleIntegrity("x", moduleWith([{ id: "s", title: "s", fields: [group("a", "x"), group("a", "y")] }]));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Duplicate field id "a"'));
  });

  it("still flags a repeated id inside one group", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    assertModuleIntegrity("x", moduleWith([{ id: "s", title: "s", fields: [group("a", "x", "x")] }]));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Duplicate field id "x"'));
  });
});
