import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductModuleConfig, StudioSession } from "@/types/studio";

const state = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/studio/product-state-context", () => ({ useProductState: () => state.current }));

import { PreviewPane } from "./preview-pane";

/**
 * Which preview tabs a product offers is the PRODUCT's decision
 * (`previewModes`), not something the Shell infers from a product id. A
 * product whose only deliverable is the hosted page has no poster to show flat
 * or framed, so it asks for the Live tab alone and the tab strip disappears.
 */

const Flat = () => <div data-testid="flat">poster</div>;
const Live = () => <div data-testid="live">page</div>;

function moduleWith(extra: Partial<ProductModuleConfig<unknown>>): StudioSession["module"] {
  return {
    productId: "p",
    formSchema: { sections: [] },
    themes: { axes: [] },
    renderer: { kind: "component", component: Flat, intrinsicSize: () => ({ width: 100, height: 100 }) },
    pricing: { currency: "USD", basePriceCents: 0, rules: [] },
    delivery: { mode: "export", export: { targets: {} } },
    messages: {},
    createInitialState: () => ({}),
    createInitialThemeSelections: () => ({}),
    livePreview: { component: Live },
    ...extra,
  } as StudioSession["module"];
}

function mount(module: StudioSession["module"]) {
  const session = { module } as StudioSession;
  state.current = {
    session,
    values: {},
    tokens: {},
    themeSelections: {},
    locale: "en",
    t: (key: string) => key,
    registerExportTarget: () => {},
  };
  return render(<PreviewPane session={session} />);
}

beforeEach(() => {
  state.current = null;
  // `ScaleToFit` measures its container; jsdom has no ResizeObserver.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

/** The mode strip is always the first tablist in the preview. */
const modeStrip = (container: HTMLElement) => container.querySelector<HTMLElement>('[role="tablist"]')!;

describe("previewModes", () => {
  it("a live-only product opens on the live page, with no tab strip and no poster", () => {
    const { container } = mount(moduleWith({ previewModes: ["live"] }));
    expect(screen.getByTestId("live")).toBeInTheDocument();
    expect(screen.queryByTestId("flat")).not.toBeInTheDocument();
    // The strip is in the DOM (the sub-tabs share its container) but hidden:
    // a single mode is not a choice.
    expect(modeStrip(container).hidden).toBe(true);
  });

  it("every other product is unchanged: flat first, with flat, framed and live tabs", () => {
    const { container } = mount(moduleWith({}));
    expect(screen.getByTestId("flat")).toBeInTheDocument();
    expect(screen.queryByTestId("live")).not.toBeInTheDocument();
    expect(modeStrip(container).hidden).toBe(false);
    expect(modeStrip(container).querySelectorAll('[role="tab"]')).toHaveLength(3);
  });

  it("a product without a live preview keeps just flat and framed", () => {
    const { container } = mount(moduleWith({ livePreview: undefined }));
    expect(modeStrip(container).querySelectorAll('[role="tab"]')).toHaveLength(2);
  });
});
