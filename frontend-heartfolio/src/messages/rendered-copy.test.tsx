import { render } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { NextIntlClientProvider, useTranslations } from "next-intl";
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
// Decorative artwork only; it has no copy.
vi.mock("@/components/product/keepsake-visual", () => ({ KeepsakeVisual: () => null }));
vi.mock("@/components/product/offering-visual", () => ({ OfferingVisual: () => null }));

import { ProductView } from "@/components/product/product-view";
import { LegalPage, type LegalKey } from "@/components/legal/legal-page";
import type { ApiDeliveryPack, ApiProductDetail } from "@/lib/api/products";
import { toCatalogProduct } from "@/lib/products/catalog";
import { getAllProducts } from "@/lib/products/registry";

/**
 * EVERY PAGE RENDERS ITS COPY, NOT ITS KEYS (25 Oct 2026).
 *
 * The pre-launch audit found two raw keys on public pages, in every language:
 * - "Products.songPoster.audience.title" (and `.body`) on Song Poster's
 *   product page: the copy was missing from ALL THREE message files, so
 *   `messages.test.ts`'s parity check (same keys in every locale) had nothing
 *   to compare;
 * - "Legal.contact.intro" on the contact page: the message is a template
 *   (`{email}`) and was rendered without a value, under a namespace built at
 *   runtime (`Legal.${legalKey}`), which no source scan can resolve.
 *
 * next-intl never throws for either: it reports the error and prints the key.
 * So these pages are rendered here with the REAL message files, every visible
 * product with its real seeded packs, and any error next-intl reports (a
 * missing message, a template without its values) fails the test, as does
 * any text that still looks like a key path.
 */
const LOCALES = ["en", "fr", "ar"] as const;
type Locale = (typeof LOCALES)[number];
const MESSAGES = Object.fromEntries(
  LOCALES.map((locale) => [locale, JSON.parse(readFileSync(`src/messages/${locale}.json`, "utf8"))])
) as Record<Locale, Record<string, unknown>>;

/** "Products.songPoster.audience.title": a capitalised namespace and at least
 *  two more dotted segments, as next-intl prints a key it could not render. */
const KEY_PATH = /\b[A-Z][A-Za-z]+(\.[A-Za-z0-9_]+){2,}\b/;

function renderCollectingErrors(locale: Locale, ui: ReactNode) {
  const errors: string[] = [];
  const { container } = render(
    <NextIntlClientProvider
      locale={locale}
      messages={MESSAGES[locale] as never}
      onError={(error) => errors.push(`${error.code}: ${error.message}`)}
    >
      {ui}
    </NextIntlClientProvider>
  );
  return { errors, text: container.textContent ?? "" };
}

function backendRoot(): string {
  const configured = process.env.HEARTFOLIO_BACKEND_PATH;
  const candidates = [
    ...(configured ? [isAbsolute(configured) ? configured : join(process.cwd(), configured)] : []),
    join(process.cwd(), "..", "backend"),
    join(process.cwd(), "..", "..", "backend", "backend"),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "seed_catalog.py"))) return candidate;
  }
  throw new Error(`Cannot locate the Django backend. Set HEARTFOLIO_BACKEND_PATH. Tried: ${candidates.join(" | ")}`);
}

/** Each product's ACTIVE packs from `seed_catalog.py`, as the storefront gets
 *  them. Targets there are helper calls, so they are reduced to what the page
 *  decides on: a print target, a wallpaper target, the live sentinel. */
function seededActivePacks(): Map<string, ApiDeliveryPack[]> {
  const source = readFileSync(join(backendRoot(), "seed_catalog.py"), "utf8");
  const products = new Map<string, ApiDeliveryPack[]>();
  for (const chunk of source.split(/\n {8}"slug": "/).slice(1)) {
    const slug = chunk.slice(0, chunk.indexOf('"'));
    const packsAt = chunk.indexOf('"packs": [');
    if (packsAt === -1) continue;
    const packs = [...chunk.slice(packsAt).matchAll(/\(\s*"([a-z0-9-]+)",\s*(\d+),\s*([\s\S]*?),\s*"(active|disabled)",?\s*\)/g)]
      .filter((m) => m[4] === "active")
      .map((m) => {
        const targets = m[3]!;
        const includedTargets = [
          ...(/print/i.test(targets) ? ["print-a4-frameless"] : []),
          ...(/wallpaper/i.test(targets) ? ["wallpaper-iphone"] : []),
          ...(/live/i.test(targets) ? ["__live__"] : []),
        ];
        return {
          id: `${slug}-${m[1]}`,
          productId: slug,
          slug: m[1]!,
          nameKey: `packs.${m[1]}.name`,
          descriptionKey: `packs.${m[1]}.description`,
          priceCents: Number(m[2]),
          currency: "USD",
          includedTargets,
          status: "active",
        } as ApiDeliveryPack;
      });
    products.set(slug, packs);
  }
  return products;
}

const SEEDED = seededActivePacks();
const VISIBLE = getAllProducts();

function catalogProduct(slug: string) {
  const entry = VISIBLE.find((product) => product.slug === slug)!;
  const detail: ApiProductDetail = {
    product: { id: `uuid-${slug}`, slug, i18nKey: entry.i18nKey, category: entry.category, status: "available", startingPriceCents: 1599, order: 1, tags: entry.tags } as ApiProductDetail["product"],
    deliveryPacks: SEEDED.get(slug) ?? [],
  };
  return toCatalogProduct(entry, detail);
}

describe("the inputs, as read here", () => {
  it("finds every visible product, each with active packs in the seed", () => {
    expect(VISIBLE.map((product) => product.slug)).toEqual(
      expect.arrayContaining(["love-story-timeline", "song-poster", "reasons-i-love-you", "graduation-keepsake"])
    );
    for (const product of VISIBLE) expect(SEEDED.get(product.slug)?.length, product.slug).toBeGreaterThan(0);
  });

  it("would catch both bugs it was written for", () => {
    // A key absent from every file, and a template rendered without its value.
    const missing = renderCollectingErrors("en", <Probe keyPath="Products.songPoster.noSuchSection" />);
    expect(missing.errors.join()).toContain("MISSING_MESSAGE");
    const unformatted = renderCollectingErrors("en", <Probe keyPath="Legal.contact.intro" />);
    expect(unformatted.errors.join()).toContain("FORMATTING_ERROR");
  });
});

function Probe({ keyPath }: { keyPath: string }) {
  const t = useTranslations();
  return <p>{t(keyPath as never)}</p>;
}

describe.each(LOCALES)("%s", (locale) => {
  it.each(VISIBLE.map((product) => product.slug))("the %s product page renders every message", (slug) => {
    const { errors, text } = renderCollectingErrors(locale, <ProductView product={catalogProduct(slug)} />);
    expect(errors).toEqual([]);
    expect(text.match(KEY_PATH)?.[0]).toBeUndefined();
  });

  it.each(["privacy", "terms", "refunds", "contact"] as LegalKey[])("the %s page renders every message", (legalKey) => {
    const { errors, text } = renderCollectingErrors(locale, <LegalPage legalKey={legalKey} />);
    expect(errors).toEqual([]);
    expect(text.match(KEY_PATH)?.[0]).toBeUndefined();
  });
});
