import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeliveryPack } from "@/types/commerce";

vi.mock("next-intl", () => ({ useLocale: () => "en" }));
// checkout-flow imports the locale-aware router at module scope; the selector
// under test never navigates, so a stub is enough.
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { resolveShellText } from "@/lib/studio/i18n";
import { PackSelector } from "./checkout-flow";

function pack(id: string, priceCents: number): DeliveryPack {
  return {
    id,
    productId: "love-story-timeline",
    nameKey: `packs.${id}.name`,
    descriptionKey: `packs.${id}.description`,
    priceCents,
    currency: "USD",
    includedTargets: [],
  };
}

// The real Love Story Timeline catalog: $22.99, $15.99, and the combo.
const LST_PACKS = [
  pack("printable", 2299),
  pack("live", 1599),
  pack("printable-plus-digital", 3599),
];

const NAMES: Record<string, string> = {
  "packs.printable.name": "Printable Pack",
  "packs.live.name": "Digital",
  "packs.printable-plus-digital.name": "Printable + Digital",
  "packs.complete.name": "Complete Pack",
};
const moduleT = (key: string) => NAMES[key] ?? key;
const st = (key: string, params?: Record<string, string | number>) => resolveShellText(key, "en", params);

function renderSelector(packs: DeliveryPack[], selectedPack: DeliveryPack | null = null) {
  const onSelect = vi.fn();
  render(
    <PackSelector
      packs={packs}
      selectedPack={selectedPack}
      onSelect={onSelect}
      moduleT={moduleT}
      st={st}
      locale="en"
    />
  );
  return onSelect;
}

const box = (name: RegExp) => screen.getByRole("checkbox", { name });
const continueButton = () => screen.getByRole("button", { name: /^continue$/i });

afterEach(cleanup);

describe("PackSelector — unit toggle (a product that sells the combo)", () => {
  it("shows Printable and Digital as toggles, with the real prices, and no Complete card", () => {
    renderSelector(LST_PACKS);
    expect(box(/printable pack/i)).toBeTruthy();
    expect(box(/digital/i)).toBeTruthy();
    expect(screen.getByText("$22.99")).toBeTruthy();
    expect(screen.getByText("$15.99")).toBeTruthy();
    expect(screen.queryByText(/complete/i)).toBeNull();
  });

  it("cannot continue until something is ticked", () => {
    renderSelector(LST_PACKS);
    expect((continueButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/choose at least one/i)).toBeTruthy();
  });

  it("selects the base pack for one unit — Digital resolves to `live`", () => {
    const onSelect = renderSelector(LST_PACKS);
    fireEvent.click(box(/digital/i));
    // Once in the row, once as the total.
    expect(screen.getAllByText("$15.99")).toHaveLength(2);
    fireEvent.click(continueButton());
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0].id).toBe("live");
  });

  it("selects the combo pack for both, shows its price, and states the saving", () => {
    const onSelect = renderSelector(LST_PACKS);
    fireEvent.click(box(/printable pack/i));
    fireEvent.click(box(/digital/i));

    expect(screen.getByText("$35.99")).toBeTruthy();
    // $22.99 + $15.99 − $35.99
    expect(screen.getByText(/together you save \$2\.99/i)).toBeTruthy();

    fireEvent.click(continueButton());
    expect(onSelect.mock.calls[0]?.[0].id).toBe("printable-plus-digital");
  });

  it("states no saving for a single unit", () => {
    renderSelector(LST_PACKS);
    fireEvent.click(box(/printable pack/i));
    expect(screen.queryByText(/you save/i)).toBeNull();
  });

  it("returns to a single unit when one box is unticked again", () => {
    const onSelect = renderSelector(LST_PACKS);
    fireEvent.click(box(/printable pack/i));
    fireEvent.click(box(/digital/i));
    fireEvent.click(box(/printable pack/i));
    fireEvent.click(continueButton());
    expect(onSelect.mock.calls[0]?.[0].id).toBe("live");
  });

  it("reopens with the right boxes ticked when the customer comes Back", () => {
    renderSelector(LST_PACKS, LST_PACKS.find((p) => p.id === "printable-plus-digital") ?? null);
    expect((box(/printable pack/i) as HTMLInputElement).checked).toBe(true);
    expect((box(/digital/i) as HTMLInputElement).checked).toBe(true);
    expect((continueButton() as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("PackSelector — plain cards (a product with no combo pack)", () => {
  // Where We Met's real shape: Printable and Complete, nothing to toggle.
  const HEART_MAP = [pack("printable", 1800), pack("complete", 2400)];

  it("keeps the cards, unchanged, instead of a toggle that could not honour 'both'", () => {
    const onSelect = renderSelector(HEART_MAP);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);

    fireEvent.click(screen.getByText("Complete Pack"));
    expect(onSelect.mock.calls[0]?.[0].id).toBe("complete");
  });

  it("does the same for a product whose combo pack is not seeded", () => {
    renderSelector([pack("printable", 2299), pack("live", 1599), pack("complete", 3999)]);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByText("Complete Pack")).toBeTruthy();
  });
});
