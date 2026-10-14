import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedProductModuleConfig } from "@/types/studio";
import { assertModuleIntegrity } from "./module-integrity";
import { reasonsILoveYouModule } from "./product-modules/reasons-i-love-you";

const moduleWith = (sections: ResolvedProductModuleConfig["formSchema"]["sections"]): ResolvedProductModuleConfig =>
  ({
    productId: "x",
    formSchema: { sections },
    themes: { axes: [] },
    pricing: { currency: "USD", basePriceCents: 0, rules: [] },
  }) as unknown as ResolvedProductModuleConfig;

const group = (id: string, ...itemIds: string[]) => ({
  id,
  type: "group" as const,
  label: id,
  minItems: 1,
  maxItems: 2,
  itemFields: itemIds.map((itemId) => ({ id: itemId, type: "text" as const, label: itemId })),
});

afterEach(() => vi.restoreAllMocks());

describe("assertModuleIntegrity: duplicate field ids, per scope", () => {
  it("allows the same item-field id in two groups (an item's keys are its own)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    assertModuleIntegrity("x", moduleWith([{ id: "s", title: "s", fields: [group("reasons", "text"), group("letter", "text", "note")] }]));
    expect(warn).not.toHaveBeenCalled();
  });

  it("still flags two top-level fields that share an id, across sections too", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    assertModuleIntegrity("x", moduleWith([{ id: "a", title: "a", fields: [group("same", "x")] }, { id: "b", title: "b", fields: [group("same", "y")] }]));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Duplicate field id "same"'));
  });

  it("still flags a duplicate inside one group", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    assertModuleIntegrity("x", moduleWith([{ id: "s", title: "s", fields: [group("g", "text", "text")] }]));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Duplicate field id "text"'));
  });

  it("raises no warning for Reasons I Love You, which has `text` in two groups", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    assertModuleIntegrity("reasons-i-love-you", { ...reasonsILoveYouModule, productId: "reasons-i-love-you" } as unknown as ResolvedProductModuleConfig);
    expect(warn).not.toHaveBeenCalled();
  });
});
