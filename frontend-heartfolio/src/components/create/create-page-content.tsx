"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Reveal, RevealGroup, RevealItem } from "@/components/motion/reveal";
import { ProductCard, ProductContinueButton } from "@/components/create/product-card";
import type { CatalogProduct } from "@/lib/products/catalog";

/**
 * The Create page's UI, unchanged from when it lived in
 * `app/[locale]/create/page.tsx` — same markup, same classes, same Reveal
 * animations, same Suspense boundary for `useSearchParams`.
 *
 * Two things changed, both plumbing:
 *  - `products` arrives as a prop from the Server Component instead of being
 *    read synchronously from the static registry, so the grid shows Django's
 *    real availability and prices.
 *  - the preselected product is resolved from that same list rather than via
 *    `getProductBySlug`, so a preselection can never carry different
 *    commercial data than the card next to it.
 */
function CreateContent({ products }: { products: CatalogProduct[] }) {
  const t = useTranslations("Create");
  const searchParams = useSearchParams();
  const preselectedSlug = searchParams.get("product");
  const preselected = products.find((p) => p.slug === preselectedSlug);

  const [selectedSlug, setSelectedSlug] = useState<string | undefined>(preselected?.slug);
  const selected = products.find((p) => p.slug === selectedSlug);

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-24">
      <Reveal className="text-center">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-champagne-gold">
          {t("eyebrow")}
        </p>
        <h1 className="mt-4 font-serif text-3xl text-heading sm:text-4xl">{t("title")}</h1>
        <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-body/75">
          {t("subtitle")}
        </p>
      </Reveal>

      <RevealGroup className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {products.map((product) => (
          <RevealItem key={product.id}>
            <ProductCard
              product={product}
              selected={selectedSlug === product.slug}
              onSelect={() => setSelectedSlug(product.slug)}
            />
          </RevealItem>
        ))}
      </RevealGroup>

      <div className="mt-14 flex justify-center">
        <ProductContinueButton product={selected} />
      </div>
    </main>
  );
}

export function CreatePageContent({ products }: { products: CatalogProduct[] }) {
  return (
    <Suspense fallback={null}>
      <CreateContent products={products} />
    </Suspense>
  );
}
