"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, Check, ChevronRight, Clock, Download } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Reveal, RevealGroup, RevealItem } from "@/components/motion/reveal";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { KeepsakeVisual } from "@/components/product/keepsake-visual";
import { OfferingVisual } from "@/components/product/offering-visual";
import { PRINT_SIZES } from "@/lib/studio/print-sizes";
import type { ApiPrintSize } from "@/lib/api/products";
import { formatPrice } from "@/lib/site-config";
import { SHOW_WALLPAPER_ADDON } from "@/lib/feature-flags";
import type { CatalogProduct } from "@/lib/products/catalog";
import { getProductPageOfferings } from "@/lib/products/catalog";
import { getCreateEntry, getOccasionsForProduct } from "@/lib/products/registry";
import { useProductContent } from "@/lib/products/use-product-content";

/**
 * The product *presentation* page (§10–§14). It exists to make someone
 * understand and want the keepsake — nothing more.
 *
 * Deliberately absent, per §13: radio buttons, dropdowns, quantity
 * pickers, variant selection, checkout, Paddle, Studio. Offerings are
 * shown with their prices; the only action on the page is one CTA.
 */
/** `ProductPage.included.items[2]`, the print-files line, which a live-only
 * product replaces (see `liveOnly`). */
export const LIVE_ONLY_REPLACED_ITEM = 2;

export function ProductView({
  product,
  catalogUnavailable = false,
  printSizes,
}: {
  product: CatalogProduct;
  /** True when Django could not be reached AND no previously-successful
   * catalog was held in memory, so there is no trustworthy commercial data
   * for this product. The page still renders — story, visuals, FAQ, copy —
   * but shows no purchasable offerings rather than falling back to a price
   * the frontend has no right to claim. See `lib/products/catalog-server.ts`. */
  catalogUnavailable?: boolean;
  /** §7d — dashboard-managed sizes. See `sizesToShow` below. */
  printSizes?: ApiPrintSize[];
}) {
  const router = useRouter();
  const t = useTranslations("ProductPage");
  const tOffer = useTranslations("Products.offerings");
  const tDetails = useTranslations("Products.offeringDetails");
  const tProduct = useTranslations(`Products.${product.i18nKey}`);
  const tOccasions = useTranslations("GiftOccasions");
  // Derived from the product's tags, never written into the copy (§16b).
  const occasions = getOccasionsForProduct(product);

  /**
   * §7d — the sizes shown come from the dashboard when Django supplied
   * them, and from the static definitions otherwise.
   *
   * The fallback is not a nicety. An outage, or a backend that predates
   * this field, would otherwise render a sizes section with nothing in it
   * on a page that is actively selling those sizes — a worse outcome than
   * showing the values the renderer actually produces, which is what the
   * static list is.
   *
   * Only the KEYS come from the database; the wording stays in the message
   * files, because a name typed into an admin form would be English on an
   * Arabic page.
   */
  const sizesToShow =
    printSizes && printSizes.length > 0
      ? printSizes.map((size) => ({ id: size.key }))
      : PRINT_SIZES.map((size) => ({ id: size.id }));
  const content = useProductContent(product);

  // The three primary editions (+ real wallpaper add-on deltas), not a
  // straight per-pack mapping — see `getProductPageOfferings`'s own doc
  // comment in catalog.ts for why this is a separate function from the
  // one the merchant feed and this page's own JSON-LD still use.
  const offerings = getProductPageOfferings(product);
  // Cheapest of the three cards actually shown below — deliberately NOT
  // Django's `startingPriceCents` (that stays wired to the meta
  // description/JSON-LD elsewhere) and NOT the old registry-level
  // `getStartingPrice`, which reads the unfiltered `offerings` array and
  // would keep quoting the now-hidden standalone wallpaper pack's price.
  const starting = offerings.length ? Math.min(...offerings.map((o) => o.price)) : null;

  /**
   * Product-specific Digital description, falling back to the shared
   * global copy (Pass A follow-up — the override data for Where We Met
   * and Love Story Timeline already existed in messages, but nothing
   * ever read it; every product rendered the same generic text).
   *
   * `tProduct` is already scoped to `Products.<i18nKey>`, so
   * `tProduct("offerings.<type>.description")` resolves exactly to
   * `Products.<i18nKey>.offerings.<type>.description`. `t.has()` checks
   * for that key without throwing; only Where We Met's and Love Story
   * Timeline's `digital` offering currently have one — every other
   * offering, on every product, is untouched and keeps using the shared
   * `Products.offerings.<type>.description` copy exactly as before.
   */
  function getOfferingDescription(offering: (typeof offerings)[number]): string {
    const overrideKey = `offerings.${offering.i18nKey}.description`;
    if (tProduct.has(overrideKey)) {
      return tProduct(overrideKey);
    }
    return tOffer(`${offering.i18nKey}.description`);
  }
  // Product-page CTA always enters the /create selection gateway with
  // this product preselected (Pass A §8) — it never jumps straight to
  // Studio or a waitlist form. What happens on Continue inside /create
  // still depends on `product.status`; that's `getStudioDestination()`,
  // used only by the Continue button itself (`create/product-card.tsx`).
  const entry = getCreateEntry(product);
  // Directional icons are mirrored with the `rtl:` variant (§24) rather
  // than by swapping components on a locale check — one code path, and it
  // stays correct if another RTL locale is added.


  /**
   * §16b: print sizes are only true of a product that actually sells a
   * printable file. `digital` (the live page) and `wallpaper` carry no print
   * deliverables, so the sizes block is suppressed rather than claiming
   * something the pack does not contain.
   */
  const hasPrintDeliverables = offerings.some(
    (offering) =>
      offering.type === "printable" ||
      offering.type === "printable_plus_digital" ||
      offering.type === "complete_pack"
  );
  /**
   * A LIVE-ONLY product: every pack it sells is the hosted page, with no print
   * file and no wallpaper (Reasons I Love You is the first). Computed from the
   * real packs, like `hasPrintDeliverables` above, so a product that sells a
   * printable pack (Love Story Timeline) is untouched. Without catalog data
   * (`offerings` empty) this is false and the shared copy stays.
   *
   * The shared copy below is written for products with files ("Download
   * it", "print-ready PNG and PDF files", "your print-ready file works with
   * any print shop"). For a live-only product those would promise files that
   * do not exist, so exactly those lines are swapped for `liveOnly.*` ones.
   * The swaps are BY POSITION (the last step, the third item), pinned in all
   * three languages by `product-view.test.tsx`.
   */
  const liveOnly =
    offerings.length > 0 &&
    offerings.every((offering) => offering.type === "digital" && !offering.wallpaperAddon?.available);
  const sharedSteps = t.raw("howItWorks.steps") as { title: string; description: string }[];
  const steps = liveOnly
    ? [...sharedSteps.slice(0, -1), t.raw("liveOnly.lastStep") as { title: string; description: string }]
    : sharedSteps;
  const sharedIncluded = t.raw("included.items") as string[];
  const included = liveOnly
    ? sharedIncluded.map((item, index) => (index === LIVE_ONLY_REPLACED_ITEM ? t("liveOnly.printItem") : item))
    : sharedIncluded;
  const faq = tProduct.raw("faq") as { question: string; answer: string }[];

  return (
    <main id="main-content" className="pb-20 md:pb-0">
      {/* ---------------- 1. Hero ---------------- */}
      <section className="bg-page pb-20 pt-12 sm:pb-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          {/* Breadcrumb — visible, and mirrored by BreadcrumbList JSON-LD */}
          <nav aria-label="Breadcrumb" className="text-sm text-body/60">
            <ol className="flex flex-wrap items-center gap-1.5">
              <li>
                <Link href="/" className="hover:text-heading">
                  {t("breadcrumbHome")}
                </Link>
              </li>
              <li aria-hidden="true">
                <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />
              </li>
              <li>
                <Link href="/products" className="hover:text-heading">
                  {t("breadcrumbProducts")}
                </Link>
              </li>
              <li aria-hidden="true">
                <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />
              </li>
              <li aria-current="page" className="text-heading">
                {content.name}
              </li>
            </ol>
          </nav>

          <div className="mt-10 grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <Reveal>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-champagne-gold">
                {t("eyebrow")}
              </p>
              <h1 className="mt-4 font-serif text-4xl leading-[1.1] text-heading sm:text-5xl md:text-6xl">
                {content.name}
              </h1>
              <p className="mt-5 font-serif text-xl italic text-dusty-terracotta">
                {content.shortDescription}
              </p>
              <p className="mt-6 max-w-lg text-lg leading-relaxed text-body/75">
                {content.fullDescription}
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
                {starting !== null && (
                  <p className="font-serif text-2xl text-heading">
                    {t("from", { price: formatPrice(starting, product.currency) })}
                  </p>
                )}
                {product.status === "waitlist" && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-subtle/50 px-3 py-1 text-xs font-medium tracking-wide text-body">
                    <Clock className="h-3.5 w-3.5" strokeWidth={2} />
                    {t("statusWaitlist")}
                  </span>
                )}
                {(product.status === "coming_soon" || product.status === "disabled") && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-subtle/50 px-3 py-1 text-xs font-medium tracking-wide text-body">
                    {t("comingSoon")}
                  </span>
                )}
              </div>

              <div className="mt-8">
                <ProductCta href={entry.href} t={t} />
              </div>

              <p className="mt-6 inline-flex items-start gap-2 text-sm text-body/65">
                {/*
                  TODO(HEARTFOLIO-PREDEPLOY):
                  Re-evaluate small Digital/download visual cues during
                  final product presentation pass (same flag as the icon
                  in featured-keepsakes.tsx). Do not change the
                  digitalNotice copy or remove the icon now — only the
                  small icon treatment is flagged for later review.
                */}
                <Download className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
                {liveOnly ? t("liveOnly.digitalNotice") : t("digitalNotice")}
              </p>
            </Reveal>

            <Reveal delay={0.1}>
              <div className="aspect-[4/5] overflow-hidden rounded-[var(--radius-xl)] shadow-[var(--shadow-float)]">
                <KeepsakeVisual productId={product.id} detailed />
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---------------- 2. The story ---------------- */}
      <section className="bg-card py-20 sm:py-24">
        <div className="mx-auto max-w-3xl px-5 text-center sm:px-8">
          <Reveal>
            <h2 className="font-serif text-3xl leading-tight text-heading sm:text-4xl">
              {tProduct("storyTitle")}
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-body/75">{tProduct("story")}</p>

            {/*
              §16b — who it's for, and the occasions it's for.

              The prose is written per product. The occasion list is NOT: it
              is derived from the product's own tags, so this page can only
              claim occasions the product is genuinely tagged for. Writing
              them by hand is how a page ends up advertising "perfect for a
              new baby" for something tagged anniversary and wedding — the
              same mismatch §11 removed from the homepage, where occasion
              cards led to empty grids.

              The labels come from the `GiftOccasions` namespace rather than
              a second set of strings, so an occasion is worded identically
              wherever it appears.
            */}
            <div className="mt-12 border-t border-subtle pt-10 text-start">
              <h3 className="font-serif text-2xl leading-tight text-heading">
                {tProduct("audience.title")}
              </h3>
              <p className="mt-4 text-[15px] leading-relaxed text-body/75">
                {tProduct("audience.body")}
              </p>
              {occasions.length > 0 && (
                <p className="mt-6 text-sm text-body/65">
                  <span className="font-medium text-heading">{t("audience.occasionsLabel")}: </span>
                  {occasions.map((key: string) => tOccasions(`items.${key}.label`)).join(" · ")}
                </p>
              )}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------- 3. How it works ---------------- */}
      <section className="bg-page py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <Reveal className="max-w-xl">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-champagne-gold">
              {t("howItWorks.eyebrow")}
            </p>
            <h2 className="mt-4 font-serif text-3xl leading-tight text-heading sm:text-4xl">
              {t("howItWorks.title")}
            </h2>
          </Reveal>
          <RevealGroup className="mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, i) => (
              <RevealItem key={step.title} className="border-t border-subtle pt-6">
                <span className="font-mono text-xs text-champagne-gold">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-3 font-serif text-lg text-heading">{step.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-body/70">
                  {step.description}
                </p>
              </RevealItem>
            ))}
          </RevealGroup>
        </div>
      </section>

      {/* ---------------- 4. Available versions + prices ---------------- */}
      {/* §11: only the offerings this product actually has are rendered.
          §12: each one shows its price. §14: presented as experiences,
          not as a SaaS pricing table — one panel per version, with the
          file detail kept quiet underneath. */}
      <section id="versions" className="bg-card py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <Reveal className="max-w-xl">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-champagne-gold">
              {t("offerings.eyebrow")}
            </p>
            <h2 className="mt-4 font-serif text-3xl leading-tight text-heading sm:text-4xl">
              {t("offerings.title")}
            </h2>
            <p className="mt-5 text-base leading-relaxed text-body/75">
              {liveOnly ? t("liveOnly.offeringsSubtitle") : t("offerings.subtitle")}
            </p>
          </Reveal>

          {catalogUnavailable && offerings.length === 0 ? (
            /* Same section, same rhythm — just the honest answer in place of
               the cards. Uses the page's existing type scale and the standard
               secondary Button; no new visual treatment was introduced. */
            <Reveal className="mt-14">
              <div className="rounded-[var(--radius-xl)] border border-subtle bg-page p-8 shadow-[var(--shadow-whisper)] sm:p-12">
                <p className="text-base leading-relaxed text-body/75">
                  {t("offerings.unavailable")}
                </p>
                <Button variant="secondary" className="mt-6" onClick={() => router.refresh()}>
                  {t("offerings.unavailableRetry")}
                </Button>
              </div>
            </Reveal>
          ) : (
          <div className="mt-14 space-y-8">
            {offerings.map((offering, i) => (
              <Reveal key={offering.type} delay={(i % 3) * 0.06}>
                <article
                  className={`grid overflow-hidden rounded-[var(--radius-xl)] border border-subtle bg-page shadow-[var(--shadow-whisper)] md:grid-cols-2 ${
                    i % 2 === 1 ? "md:[&>*:first-child]:order-2" : ""
                  }`}
                >
                  <div className="min-h-[280px]">
                    <OfferingVisual type={offering.type} productId={product.id} />
                  </div>
                  <div className="flex flex-col justify-center p-8 sm:p-12">
                    <h3 className="font-serif text-2xl text-heading">
                      {tOffer(`${offering.i18nKey}.name`)}
                    </h3>
                    <p className="mt-3 text-[15px] leading-relaxed text-body/75">
                      {getOfferingDescription(offering)}
                    </p>
                    {offering.detailsKey && (
                      <p className="mt-4 font-mono text-xs uppercase tracking-[0.08em] text-body/55">
                        {tDetails(offering.detailsKey)}
                      </p>
                    )}
                    <p className="mt-6 font-serif text-2xl text-heading">
                      {formatPrice(offering.price, offering.currency)}
                    </p>
                    {/* Real database delta (combo pack price minus this
                        one's), never a hardcoded number — see
                        `getProductPageOfferings` in catalog.ts. Absent
                        entirely for Complete, which already includes
                        wallpaper targets, and hidden if the combo pack
                        itself isn't currently sellable. Additionally gated
                        by `SHOW_WALLPAPER_ADDON` (lib/feature-flags.ts) so
                        this never advertises an add-on the checkout
                        cannot sell. */}
                    {SHOW_WALLPAPER_ADDON && offering.wallpaperAddon?.available && (
                      <p className="mt-2 text-sm text-body/60">
                        {t("offerings.wallpaperAddon", {
                          price: formatPrice(offering.wallpaperAddon.price, offering.currency),
                        })}
                      </p>
                    )}
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
          )}

          {!catalogUnavailable && (
            <Reveal delay={0.1} className="mt-10">
              <p className="text-sm leading-relaxed text-body/60">{t("offerings.note")}</p>
            </Reveal>
          )}
        </div>
      </section>

      {/* ---------------- 5. What's included ---------------- */}
      {/*
        TODO(HEARTFOLIO-PREDEPLOY):
        This section (and its `included.items`/`included.note` copy in
        messages) intentionally makes no claim about permanent access,
        accounts, or lifetime redownloads — that was removed in Pass A and
        must not be reintroduced here. Current approved claims are only:
        customization/preview as many times as desired before purchase,
        and download of the finished keepsake after purchase. Do not add
        account or "redownload forever" language during future copy edits
        without an explicit product/business decision to support it.
      */}
      <section className="bg-page py-20 sm:py-24">
        <div className="mx-auto max-w-3xl px-5 sm:px-8">
          <Reveal>
            <h2 className="font-serif text-3xl leading-tight text-heading sm:text-4xl">
              {t("included.title")}
            </h2>
            <ul className="mt-8 space-y-4">
              {included.map((item) => (
                <li key={item} className="flex items-start gap-3 text-[15px] text-body/80">
                  <Check
                    className="mt-1 h-4 w-4 shrink-0 text-champagne-gold"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-8 border-t border-subtle pt-6 text-sm leading-relaxed text-body/60">
              {liveOnly ? t("liveOnly.includedNote") : t("included.note")}
            </p>

            {/*
              §16b — sizes and formats, stated as crawlable text.

              Rendered from PRINT_SIZES rather than a hand-written list, so
              the page cannot advertise a size the renderer does not produce.
              Adding or removing a size changes this section automatically;
              `deliverable-names.test.ts` fails if a size exists without copy
              to describe it, which is the other half of the same guarantee.

              Shown only when the product actually has a printable or
              complete offering — a live-only product has no print sizes, and
              listing them anyway would be a promise it cannot keep.
            */}
            {hasPrintDeliverables && (
              <div className="mt-12 border-t border-subtle pt-10">
                <h3 className="font-serif text-2xl leading-tight text-heading">
                  {t("formats.title")}
                </h3>
                <p className="mt-4 text-[15px] leading-relaxed text-body/75">
                  {t("formats.intro")}
                </p>
                <ul className="mt-6 space-y-3">
                  {sizesToShow.map((size) => (
                    <li
                      key={size.id}
                      className="flex items-start gap-3 text-[15px] text-body/80"
                    >
                      <Check
                        className="mt-1 h-4 w-4 shrink-0 text-champagne-gold"
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                      {t(`formats.sizes.${size.id}`)}
                    </li>
                  ))}
                </ul>
                <p className="mt-6 text-sm leading-relaxed text-body/65">
                  {t("formats.variants")}
                </p>
                <p className="mt-4 text-sm leading-relaxed text-body/60">
                  {t("formats.note")}
                </p>
              </div>
            )}
          </Reveal>
        </div>
      </section>

      {/* ---------------- 6. FAQ ---------------- */}
      <section className="bg-card py-20 sm:py-24">
        <div className="mx-auto max-w-3xl px-5 sm:px-8">
          <Reveal>
            <h2 className="font-serif text-3xl leading-tight text-heading sm:text-4xl">
              {t("faq.title")}
            </h2>
          </Reveal>
          <Reveal delay={0.05} className="mt-8">
            <Accordion type="single" collapsible className="w-full">
              {faq.map((item, i) => (
                <AccordionItem key={item.question} value={`item-${i}`}>
                  <AccordionTrigger>{item.question}</AccordionTrigger>
                  <AccordionContent>{item.answer}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Reveal>
          <Reveal delay={0.1} className="mt-8">
            <Link
              href="/contact"
              className="text-sm text-body/70 underline decoration-champagne-gold decoration-1 underline-offset-4 hover:text-heading"
            >
              {t("faq.contactLink")}
            </Link>
          </Reveal>
        </div>
      </section>

      {/* ---------------- 7. Final CTA ---------------- */}
      <section className="bg-ink-navy py-24 text-parchment sm:py-30">
        <div className="mx-auto max-w-3xl px-5 text-center sm:px-8">
          <h2 className="font-serif text-3xl leading-tight sm:text-4xl md:text-5xl">
            {t("finalCta.title", { name: content.name })}
          </h2>
          <p className="mx-auto mt-5 max-w-md text-base leading-relaxed text-parchment/70">
            {t("finalCta.subtitle")}
          </p>
          <div className="mt-10 flex justify-center">
            <ProductCta href={entry.href} t={t} variant="onDark" />
          </div>
        </div>
      </section>
    </main>
  );
}

/**
 * The single action on the page (§13). Always enters `/create` with this
 * product preselected — never Studio, never a waitlist form directly,
 * regardless of `product.status` (Pass A §8). Whether that product is
 * actually available, waitlisted, or still coming soon is decided on
 * `/create` itself, once someone is standing in the selection gateway
 * rather than reading a single product's page — see `getStudioDestination`
 * and the Continue button in `create/product-card.tsx`.
 *
 * Declared at module scope rather than inside `ProductView`: a component
 * created during render is a new type on every render, which remounts its
 * subtree and loses focus.
 */
function ProductCta({
  href,
  t,
  variant = "primary",
}: {
  href: string;
  t: ReturnType<typeof useTranslations<"ProductPage">>;
  variant?: "primary" | "onDark";
}) {
  return (
    <Button size="lg" variant={variant} asChild>
      <Link href={href}>
        {t("createYours")}
        {/* Directional icon, mirrored for Arabic (§24) — a forward arrow
            points left in an RTL layout. */}
        <ArrowRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.75} aria-hidden="true" />
      </Link>
    </Button>
  );
}
