"use client";

import { useTranslations } from "next-intl";
import { Check, Download } from "lucide-react";
import { motion } from "framer-motion";
import { Reveal } from "@/components/motion/reveal";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { getAllProducts, getStartingPrice } from "@/lib/products/registry";
import { formatPrice } from "@/lib/site-config";

/**
 * ---------------------------------------------------------------------
 * DERIVED STARTING PRICE (Pass A §10)
 * ---------------------------------------------------------------------
 * Previously `Pricing.single.price` was the literal string "$12" —
 * hardcoded three sections above product pages that show four prices up
 * to $30. That contradiction is gone: the figure shown here is the
 * minimum `getStartingPrice()` across every product currently in the
 * registry, so it can never drift from what the product pages actually
 * charge. Add a cheaper offering anywhere and this number updates itself.
 */
function useOverallStartingPrice(): { amount: number; currency: string } | null {
  const products = getAllProducts();
  let lowest: { amount: number; currency: string } | null = null;
  for (const product of products) {
    const price = getStartingPrice(product);
    if (price === null) continue;
    if (lowest === null || price < lowest.amount) {
      lowest = { amount: price, currency: product.currency };
    }
  }
  return lowest;
}

export function Pricing() {
  const t = useTranslations("Pricing");
  const features = t.raw("single.features") as string[];
  const startingPrice = useOverallStartingPrice();

  return (
    <section id="pricing" className="relative overflow-hidden bg-page py-24 sm:py-30">
      <div className="mx-auto max-w-5xl px-5 sm:px-8">
        <Reveal className="mx-auto max-w-xl text-center">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-champagne-gold">
            {t("eyebrow")}
          </p>
          <h2 className="mt-4 font-serif text-3xl leading-tight text-heading sm:text-4xl md:text-5xl">
            {t("title")
              .split("\n")
              .map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
          </h2>
          <p className="mx-auto mt-5 max-w-md text-base leading-relaxed text-body/75">
            {t("subtitle")}
          </p>
        </Reveal>

        <Reveal delay={0.1} className="mx-auto mt-14 max-w-xl">
          <div className="relative overflow-hidden rounded-[var(--radius-lg)] bg-ink-navy p-10 text-parchment shadow-[var(--shadow-float)] sm:p-12">
            <div
              className="pointer-events-none absolute inset-0 opacity-40"
              style={{
                background:
                  "radial-gradient(70% 60% at 85% 0%, rgba(201,162,75,0.18), transparent 60%)",
              }}
            />
            <div className="relative flex flex-col items-center text-center">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-champagne-gold/15 px-3 py-1 text-[11px] font-medium tracking-wide text-champagne-gold">
                <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t("single.badge")}
              </span>

              {startingPrice !== null && (
                <p className="mt-6 font-serif text-6xl">
                  {t("from", { price: formatPrice(startingPrice.amount, startingPrice.currency) })}
                </p>
              )}
              <p className="mt-2 text-sm uppercase tracking-[0.12em] text-parchment/55">
                {t("single.priceNote")}
              </p>

              <p className="mt-6 max-w-sm text-[15px] leading-relaxed text-parchment/75">
                {t("single.description")}
              </p>

              <ul className="mt-8 grid w-full max-w-sm gap-3 text-start sm:grid-cols-2">
                {features.map((f, i) => (
                  <motion.li
                    key={f}
                    initial={{ opacity: 0, x: -8 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
                    className="flex items-start gap-2.5 text-sm text-parchment/85"
                  >
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-champagne-gold" strokeWidth={1.75} />
                    {f}
                  </motion.li>
                ))}
              </ul>

              {/* Links to /products, not /create (Pass A §10) — this section
                  states the pricing model, not a single purchasable SKU;
                  the actual prices per keepsake live on each product page. */}
              <Button variant="onDark" size="lg" className="mt-9 w-full max-w-xs" asChild>
                <Link href="/products">{t("single.cta")}</Link>
              </Button>
              <p className="mt-4 text-xs text-parchment/50">{t("single.reassurance")}</p>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.15} className="mt-8 text-center">
          <p className="text-sm text-body/55">{t("note")}</p>
        </Reveal>
      </div>
    </section>
  );
}
