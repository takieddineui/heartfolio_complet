import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * "STARTING AT —" IS GONE (25 Oct 2026). Every Studio header, the home
 * page's pricing section and every product share card took their starting
 * price from the registry's offerings, which hold no prices, so the header
 * read "Starting at —" and the other two silently showed none. They now use
 * Django's prices: the packs the checkout sells (Studio), and the catalog's
 * starting prices (share cards). The home page's pricing section was removed
 * in the redesign (27 Oct 2026); each collection card shows its own price.
 */
const state = vi.hoisted(() => ({ packs: null as null | { priceCents: number; currency: string }[] }));

vi.mock("@/lib/studio/product-state-context", () => ({
  useProductState: () => ({ packs: state.packs, locale: "en" }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return { ...actual, motion: new Proxy({}, { get: (_t, tag: string) => (props: Record<string, unknown>) => {
    const { children, ...rest } = props as { children?: ReactNode };
    const clean = Object.fromEntries(Object.entries(rest).filter(([key]) => !/^(initial|animate|whileInView|viewport|transition|variants|exit|whileHover)$/.test(key)));
    const Tag = tag as unknown as React.ElementType;
    return <Tag {...clean}>{children}</Tag>;
  } }) };
});

import { ProductHeader } from "@/components/studio/product-header";
import { lowestCatalogStartingPrice, type CatalogProduct } from "@/lib/products/catalog";
import { getProductBySlug } from "@/lib/products/registry";

const en = JSON.parse(readFileSync("src/messages/en.json", "utf8"));
const wrap = (ui: ReactNode) => render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);

afterEach(() => {
  cleanup();
  state.packs = null;
});

describe("the Studio header's starting price", () => {
  const product = getProductBySlug("song-poster")!;

  it("is the cheapest pack the checkout sells", () => {
    state.packs = [
      { priceCents: 2299, currency: "USD" },
      { priceCents: 1599, currency: "USD" },
      { priceCents: 3599, currency: "USD" },
    ];
    wrap(<ProductHeader product={product} />);
    expect(screen.getByText("Starting at $15.99")).toBeTruthy();
  });

  it("is left out, never a dash, while the packs load or when there are none", () => {
    wrap(<ProductHeader product={product} />);
    expect(screen.queryByText(/Starting at/)).toBeNull();
    cleanup();
    state.packs = [];
    wrap(<ProductHeader product={product} />);
    expect(screen.queryByText(/Starting at/)).toBeNull();
  });
});

describe("the catalog's lowest starting price", () => {
  const catalog = (cents: (number | null)[]) =>
    cents.map((startingPriceCents) => ({ isLive: true, startingPriceCents, currency: "USD", offerings: [] }) as unknown as CatalogProduct);

  it("is the lowest of the catalog's starting prices", () => {
    expect(lowestCatalogStartingPrice(catalog([2299, 1599, null]))).toEqual({ amount: 15.99, currency: "USD" });
    expect(lowestCatalogStartingPrice(catalog([null]))).toBeNull();
  });
});
