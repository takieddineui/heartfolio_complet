import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { CaptureStill, PhoneFrame } from "@/components/captures/capture-media";
import { getProductCaptures } from "@/lib/captures/manifest";
import { getProductById } from "@/lib/products/registry";
import type { GuideBlock, GuideTranslation } from "@/lib/guides/types";

/**
 * A guide's body (`lib/guides`). Server-rendered and plain: headings,
 * paragraphs, lists, and product cards that show the keepsake's real
 * capture and link to its PRODUCT page, never the Studio (a reader deciding
 * belongs on the page that explains it). No prices here: they live on the
 * product page and change; copy that quoted one would go stale.
 */
export async function GuideArticle({ translation, locale }: { translation: GuideTranslation; locale: string }) {
  const tProducts = await getTranslations({ locale, namespace: "Products" });
  const tGuides = await getTranslations({ locale, namespace: "Guides" });
  const tCaptures = await getTranslations({ locale, namespace: "Captures" });

  const render = (block: GuideBlock, index: number) => {
    switch (block.type) {
      case "h2":
        return (
          <h2 key={index} className="mt-14 font-serif text-2xl leading-snug text-heading sm:text-3xl">
            {block.text}
          </h2>
        );
      case "p":
        return (
          <p key={index} className="mt-5 text-[17px] leading-relaxed text-body/85">
            {block.text}
          </p>
        );
      case "list":
        return (
          <ul key={index} className="mt-5 list-disc space-y-2.5 ps-6 text-[17px] leading-relaxed text-body/85 marker:text-champagne-gold">
            {block.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        );
      case "product": {
        const product = getProductById(block.product);
        if (!product) return null;
        const name = tProducts(`${product.i18nKey}.name`);
        const still = getProductCaptures(product.id, locale)?.poster;
        return (
          <aside key={index} className="mt-8 flex items-center gap-6 rounded-[var(--radius-lg)] bg-card p-5 shadow-[var(--shadow-whisper)] sm:p-6">
            {still && (
              <PhoneFrame className="w-24 shrink-0 sm:w-28">
                <CaptureStill still={still} alt={tCaptures("phoneAlt", { name })} />
              </PhoneFrame>
            )}
            <div>
              <p className="font-serif text-xl text-heading">{name}</p>
              <p className="mt-2 text-[15px] leading-relaxed text-body/75">{block.note}</p>
              <Link
                href={`/products/${product.slug}`}
                className="group mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-heading hover:text-champagne-gold"
              >
                {tGuides("seeProduct", { name })}
                <ArrowRight className="h-3.5 w-3.5 transition-transform rtl:rotate-180 ltr:group-hover:translate-x-1 rtl:group-hover:-translate-x-1" aria-hidden="true" />
              </Link>
            </div>
          </aside>
        );
      }
    }
  };

  return (
    <div>
      <p className="text-lg leading-relaxed text-body/85 sm:text-xl">{translation.intro}</p>
      {translation.blocks.map(render)}
    </div>
  );
}

/** A guide's date in its own language, as a calendar day. */
export function formatGuideDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}
