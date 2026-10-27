import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { guidesForProduct } from "@/lib/guides/registry";

/**
 * On a product page: the published guides about this product, in the page's
 * language (the guides link to the product; this links back). Nothing is
 * drawn when there are none.
 */
export async function RelatedGuides({ productId, locale }: { productId: string; locale: string }) {
  const guides = guidesForProduct(productId, locale);
  if (guides.length === 0) return null;
  const t = await getTranslations({ locale, namespace: "Guides" });
  return (
    <section aria-labelledby="related-guides" className="bg-page py-16 sm:py-20">
      <div className="mx-auto max-w-3xl px-5 sm:px-8">
        <h2 id="related-guides" className="font-serif text-2xl text-heading sm:text-3xl">
          {t("related")}
        </h2>
        <ul className="mt-6 space-y-3">
          {guides.map(({ guide, translation }) => (
            <li key={guide.id}>
              <Link href={`/guides/${translation.slug}`} className="group inline-flex items-center gap-2 text-[17px] text-heading hover:text-champagne-gold">
                {translation.title}
                <ArrowRight className="h-4 w-4 transition-transform rtl:rotate-180 ltr:group-hover:translate-x-1 rtl:group-hover:-translate-x-1" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
