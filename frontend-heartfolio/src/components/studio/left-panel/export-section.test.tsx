import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

/**
 * Seam (d): a hosted (live-only) product's delivery note is translated. It
 * used to print its `description` verbatim, with an English fallback, so
 * French and Arabic customers read English in an otherwise translated sidebar.
 */
const state = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
vi.mock("@/lib/studio/product-state-context", () => ({ useProductState: () => state.value }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => `shell:${key}` }));

import { ExportSection } from "./export-section";

const withDelivery = (delivery: unknown) => ({
  session: { module: { delivery } },
  t: (key: string) => `module:${key}`,
  themeSelections: {},
});

describe("a hosted product's delivery note", () => {
  it("resolves the module's description as a translation key", () => {
    state.value = withDelivery({ mode: "hosted", hosted: { description: "delivery.hosted" } });
    render(<ExportSection />);
    expect(screen.getByText("module:delivery.hosted")).toBeTruthy();
  });

  it("falls back to the Shell's own translated sentence, not hard-coded English", () => {
    state.value = withDelivery({ mode: "hosted", hosted: {} });
    render(<ExportSection />);
    expect(screen.getByText("shell:hosted")).toBeTruthy();
  });

  it("exists in all three languages", () => {
    for (const locale of ["en", "fr", "ar"]) {
      const messages = JSON.parse(readFileSync(`src/messages/${locale}.json`, "utf8"));
      expect(messages.Studio.panels.export.hosted, locale).toBeTruthy();
    }
  });
});
