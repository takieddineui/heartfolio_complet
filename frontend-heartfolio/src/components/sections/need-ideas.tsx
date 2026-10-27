import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { CaptureStill, PhoneFrame } from "@/components/captures/capture-media";
import { getProductCaptures } from "@/lib/captures/manifest";
import { featuredGuides, guideCovers } from "@/lib/guides/registry";
import { getProductById } from "@/lib/products/registry";
import { typeset } from "@/lib/guides/typeset";

/**
 * "Need ideas?" on the home page, just before the FAQ (27 Oct 2026): up to
 * three published guides, each with the still of a keepsake it is about
 * (a different one per card, `guideCovers`), and a link to all of them. Deliberately modest (small stills, no
 * loops, no button), so it helps someone undecided without pulling anyone
 * away from buying. Drawn only in a language with published guides.
 */
export async function NeedIdeas({ locale }: { locale: string }) {
  const guides = featuredGuides(locale);
  if (guides.length === 0) return null;
  const covers = guideCovers(guides);
  const t = await getTranslations({ locale, namespace: "NeedIdeas" });
  const tProducts = await getTranslations({ locale, namespace: "Products" });
  const tCaptures = await getTranslations({ locale, namespace: "Captures" });
  const productName = (id: string) => {
    const product = getProductById(id);
    return product ? tProducts(`${product.i18nKey}.name`) : "";
  };

  return (
    <section id="ideas" aria-labelledby="need-ideas" className="bg-page py-16 sm:py-20">
      <div className="mx-auto max-w-5xl px-5 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="need-ideas" className="font-serif text-2xl text-heading sm:text-3xl">
              {typeset(t("title"), locale)}
            </h2>
            <p className="mt-2 text-[15px] text-body/70">{typeset(t("subtitle"), locale)}</p>
          </div>
          <Link href="/guides" className="group inline-flex items-center gap-1.5 text-sm font-medium text-heading hover:text-champagne-gold">
            {t("all")}
            <ArrowRight className="h-3.5 w-3.5 transition-transform rtl:rotate-180 ltr:group-hover:translate-x-1 rtl:group-hover:-translate-x-1" aria-hidden="true" />
          </Link>
        </div>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {guides.map(({ guide, translation }) => {
            const product = covers.get(guide.id)!;
            const still = getProductCaptures(product, locale)?.poster;
            return (
              <li key={guide.id}>
                <Link
                  href={`/guides/${translation.slug}`}
                  className="flex h-full items-center gap-4 rounded-[var(--radius-lg)] bg-card p-4 shadow-[var(--shadow-whisper)] transition-shadow hover:shadow-[var(--shadow-lift)]"
                >
                  {still && (
                    <PhoneFrame className="w-14 shrink-0">
                      <CaptureStill still={still} alt={tCaptures("phoneAlt", { name: productName(product) })} />
                    </PhoneFrame>
                  )}
                  <span className="font-serif text-[17px] leading-snug text-heading">{typeset(translation.title, locale)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
