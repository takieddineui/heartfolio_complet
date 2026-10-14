import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  value: null as null | Record<string, unknown>,
}));
vi.mock("@/lib/studio/product-state-context", () => ({ useProductState: () => state.value }));

import { rendererRegistry } from "@/lib/studio/renderer-registry";
import "./preview-pane";

/**
 * Seam (c): a live-only product's Studio preview. The component renderer's
 * Artwork/Framed tabs are built around a printed object; a product that IS
 * its live page gets only its live preview, in a pane that is a containing
 * block, so nothing inside can cover the Studio around it.
 */
function LivePreviewProbe({ values, locale }: { values: Record<string, unknown>; locale: string }) {
  return (
    <p data-testid="probe">
      {String(values.name)} / {locale}
    </p>
  );
}

const session = (livePreview?: unknown) => ({
  module: { productId: "x", renderer: { kind: "live" }, livePreview },
});

describe("the live-only preview", () => {
  it("is registered beside the component renderer", () => {
    expect(rendererRegistry.live).toBeDefined();
    expect(rendererRegistry.component).toBeDefined();
  });

  it("mounts the module's live preview and nothing print-shaped", () => {
    state.value = { values: { name: "Hana" }, themeSelections: {}, locale: "fr", session: session({ component: LivePreviewProbe }) };
    const Live = rendererRegistry.live!;
    render(<Live config={{ kind: "live" }} session={state.value.session as never} />);

    expect(screen.getByTestId("probe").textContent).toBe("Hana / fr");
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByText(/preview\.modes/)).toBeNull();
  });

  it("is a containing block that clips, so nothing inside can cover the Studio", () => {
    state.value = { values: {}, themeSelections: {}, locale: "en", session: session({ component: LivePreviewProbe }) };
    const Live = rendererRegistry.live!;
    render(<Live config={{ kind: "live" }} session={state.value.session as never} />);

    const pane = screen.getByTestId("live-only-preview");
    expect(pane.style.contain).toBe("layout paint");
    expect(pane.style.overflow).toBe("clip"); // clipped AND unscrollable
    expect(pane.className).toMatch(/\boverflow-hidden\b/);
    expect(pane.className).toMatch(/\brelative\b/);
    expect(pane.contains(screen.getByTestId("probe"))).toBe(true);
  });

  it("renders nothing for a module without a live preview", () => {
    state.value = { values: {}, themeSelections: {}, locale: "en", session: session(undefined) };
    const Live = rendererRegistry.live!;
    const { container } = render(<Live config={{ kind: "live" }} session={state.value.session as never} />);
    expect(container.innerHTML).toBe("");
  });
});
