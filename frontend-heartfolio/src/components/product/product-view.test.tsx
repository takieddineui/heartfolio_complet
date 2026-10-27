import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }) }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));
// Decorative artwork only; irrelevant to the copy under test.
vi.mock("@/components/product/offering-visual", () => ({ OfferingVisual: () => null }));

import type { ApiDeliveryPack, ApiProductDetail } from "@/lib/api/products";
import { toCatalogProduct } from "@/lib/products/catalog";
import { getProductBySlug } from "@/lib/products/registry";
import { LIVE_ONLY_REPLACED_ITEM, ProductView } from "./product-view";

/**
 * THE PRODUCT PAGE DOES NOT PROMISE FILES A LIVE-ONLY PRODUCT DOES NOT HAVE.
 *
 * The shared copy is written for products with files ("Download it",
 * "print-ready PNG and PDF files", "your print-ready file works with any print
 * shop"). Reasons I Love You sells only the hosted page, so for it exactly
 * those lines are swapped (`liveOnly` in product-view.tsx), decided from the
 * real packs. Love Story Timeline sells printable packs and must read exactly
 * as before. Checked in all three languages with the real message files.
 */
type Messages = { ProductPage: Record<string, unknown> & { liveOnly: Record<string, unknown> } };
const MESSAGES = Object.fromEntries(
  (["en", "fr", "ar"] as const).map((locale) => [locale, JSON.parse(readFileSync(`src/messages/${locale}.json`, "utf8")) as Messages])
) as Record<"en" | "fr" | "ar", Messages>;

const pp = (locale: "en" | "fr" | "ar") => MESSAGES[locale].ProductPage as unknown as {
  digitalNotice: string;
  howItWorks: { steps: { title: string; description: string }[] };
  included: { items: string[]; note: string };
  offerings: { subtitle: string };
  liveOnly: {
    digitalNotice: string;
    lastStep: { title: string; description: string };
    printItem: string;
    includedNote: string;
    offeringsSubtitle: string;
  };
};

const pack = (productId: string, slug: string, priceCents: number, includedTargets: string[], status: "active" | "disabled" = "active"): ApiDeliveryPack =>
  ({
    id: `${productId}-${slug}`,
    productId,
    slug,
    nameKey: `packs.${slug}.name`,
    descriptionKey: `packs.${slug}.description`,
    priceCents,
    currency: "USD",
    includedTargets,
    status,
  }) as ApiDeliveryPack;

function product(slug: string, packs: ApiDeliveryPack[]) {
  const entry = getProductBySlug(slug)!;
  const detail: ApiProductDetail = {
    product: { id: `uuid-${slug}`, slug, i18nKey: entry.i18nKey, category: entry.category, status: "available", startingPriceCents: 1599, order: 1, tags: [] } as ApiProductDetail["product"],
    deliveryPacks: packs,
  };
  return toCatalogProduct(entry, detail);
}

const REASONS = () => product("reasons-i-love-you", [pack("reasons-i-love-you", "live", 1599, ["__live__"])]);
const LOVE_STORY = () =>
  product("love-story-timeline", [
    pack("love-story-timeline", "printable", 2299, ["print-a4-frameless"]),
    pack("love-story-timeline", "live", 1599, ["__live__"]),
    pack("love-story-timeline", "printable-plus-digital", 3599, ["print-a4-frameless", "__live__"]),
  ]);

function renderPage(locale: "en" | "fr" | "ar", catalogProduct: ReturnType<typeof product>, catalogUnavailable = false) {
  const { container } = render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale] as never}>
      <ProductView product={catalogProduct} catalogUnavailable={catalogUnavailable} />
    </NextIntlClientProvider>
  );
  return container.textContent ?? "";
}

const LOCALES = ["en", "fr", "ar"] as const;

describe("a live-only product's page (Reasons I Love You)", () => {
  it.each(LOCALES)("%s: swaps exactly the lines that promise files, and keeps the rest", (locale) => {
    const text = renderPage(locale, REASONS());
    const shared = pp(locale);
    const live = shared.liveOnly;

    // The four main swaps and the versions heading.
    expect(text).toContain(live.digitalNotice);
    expect(text).not.toContain(shared.digitalNotice);
    expect(text).toContain(live.lastStep.title);
    expect(text).toContain(live.lastStep.description);
    expect(text).not.toContain(shared.howItWorks.steps.at(-1)!.description);
    expect(text).toContain(live.printItem);
    expect(text).not.toContain(shared.included.items[LIVE_ONLY_REPLACED_ITEM]!);
    expect(text).toContain(live.includedNote);
    expect(text).not.toContain(shared.included.note);
    expect(text).toContain(live.offeringsSubtitle);
    expect(text).not.toContain(shared.offerings.subtitle);

    // Everything that was true stays.
    for (const step of shared.howItWorks.steps.slice(0, -1)) expect(text).toContain(step.title);
    shared.included.items.forEach((item, index) => {
      if (index !== LIVE_ONLY_REPLACED_ITEM) expect(text).toContain(item);
    });
  });
});

describe("a product with printable packs (Love Story Timeline) is untouched", () => {
  it.each(LOCALES)("%s: the shared copy, and none of the live-only lines", (locale) => {
    const text = renderPage(locale, LOVE_STORY());
    const shared = pp(locale);
    expect(text).toContain(shared.digitalNotice);
    expect(text).toContain(shared.howItWorks.steps.at(-1)!.title);
    expect(text).toContain(shared.included.items[LIVE_ONLY_REPLACED_ITEM]!);
    expect(text).toContain(shared.included.note);
    expect(text).toContain(shared.offerings.subtitle);
    const live = shared.liveOnly;
    for (const line of [live.digitalNotice, live.lastStep.title, live.printItem, live.includedNote, live.offeringsSubtitle]) {
      expect(text).not.toContain(line);
    }
  });
});

describe("live-only is decided from the real packs", () => {
  it("is not live-only when the Digital pack sells wallpapers as an add-on (those are files)", () => {
    const withWallpapers = product("reasons-i-love-you", [
      pack("reasons-i-love-you", "live", 1599, ["__live__"]),
      pack("reasons-i-love-you", "digital-plus-wallpaper", 2099, ["__live__", "wallpaper-phone"]),
    ]);
    const text = renderPage("en", withWallpapers);
    expect(text).toContain(pp("en").digitalNotice);
    expect(text).not.toContain(pp("en").liveOnly.digitalNotice);
  });

  it("keeps the shared copy when there is no pack data at all (catalog unreachable)", () => {
    const text = renderPage("en", product("reasons-i-love-you", []), true);
    expect(text).toContain(pp("en").digitalNotice);
    expect(text).not.toContain(pp("en").liveOnly.digitalNotice);
  });
});

describe("the swaps replace the right lines in every language", () => {
  // The swaps are by position. If a translation reorders the shared steps or
  // items, these fail before a live-only page loses the wrong line.
  it.each([
    ["en", /files/i, /PNG/],
    ["fr", /fichiers/i, /PNG/],
    ["ar", /ملفات/, /PNG/],
  ] as const)("%s: the last step is the download step and the replaced item is the print-files one", (locale, filesWord, png) => {
    expect(pp(locale).howItWorks.steps).toHaveLength(4);
    expect(pp(locale).howItWorks.steps.at(-1)!.description).toMatch(filesWord);
    expect(pp(locale).included.items[LIVE_ONLY_REPLACED_ITEM]).toMatch(png);
  });

  it.each(LOCALES)("%s: no live-only line itself promises a file", (locale) => {
    const live = pp(locale).liveOnly;
    const lines = [live.digitalNotice, live.lastStep.title, live.lastStep.description, live.printItem, live.includedNote, live.offeringsSubtitle];
    for (const line of lines) {
      expect(line, line).not.toMatch(/PNG|PDF|DPI|download|télécharg|تنزيل|نزّل/i);
    }
  });

  it.each(LOCALES)("%s: the FAQ no longer says there is nothing to download", (locale) => {
    const faq = JSON.parse(readFileSync(`src/messages/${locale}.json`, "utf8")).Products.reasonsILoveYou.faq[2].answer as string;
    expect(faq).not.toMatch(/nothing to download|Rien à télécharger|لا شيء للتنزيل/);
    expect(faq).toMatch(/no file to print or frame|Aucun fichier à imprimer ni à encadrer|لا يوجد ملف للطباعة أو التأطير/);
  });
});
