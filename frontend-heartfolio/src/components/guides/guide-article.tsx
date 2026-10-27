import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { GuideCapture } from "./guide-capture";
import { getProductById } from "@/lib/products/registry";
import type { GuideBlock, GuideTranslation } from "@/lib/guides/types";
import { typeset } from "@/lib/guides/typeset";

/**
 * A guide's body (`lib/guides`). Server-rendered and plain: headings,
 * paragraphs, lists, the products' real capture loops (`GuideCapture`), and
 * product cards linking to the PRODUCT page, never the Studio (a reader deciding
 * belongs on the page that explains it). No prices here: they live on the
 * product page and change; copy that quoted one would go stale.
 */
export async function GuideArticle({ translation, locale }: { translation: GuideTranslation; locale: string }) {
  const tProducts = await getTranslations({ locale, namespace: "Products" });
  const tGuides = await getTranslations({ locale, namespace: "Guides" });

  const render = (block: GuideBlock, index: number) => {
    switch (block.type) {
      case "h2":
        return (
          <h2 key={index} className="mt-14 font-serif text-2xl leading-snug text-heading sm:text-3xl">
            {typeset(block.text, locale)}
          </h2>
        );
      case "h3":
        return (
          <h3 key={index} className="mt-9 font-serif text-xl leading-snug text-heading">
            {typeset(block.text, locale)}
          </h3>
        );
      case "p":
        return (
          <p key={index} className="mt-5 text-[17px] leading-relaxed text-body/85">
            {typeset(block.text, locale)}
          </p>
        );
      case "list":
        return (
          <ul key={index} className="mt-5 list-disc space-y-2.5 ps-6 text-[17px] leading-relaxed text-body/85 marker:text-champagne-gold">
            {block.items.map((item) => (
              <li key={item}>{typeset(item, locale)}</li>
            ))}
          </ul>
        );
      case "capture": {
        const product = getProductById(block.product);
        if (!product) return null;
        return <GuideCapture key={index} product={product.id} name={tProducts(`${product.i18nKey}.name`)} caption={typeset(block.caption, locale)} />;
      }
      case "product": {
        const product = getProductById(block.product);
        if (!product) return null;
        const name = tProducts(`${product.i18nKey}.name`);
        // The keepsake itself is shown by the section's capture block; the
        // card says why it fits and leads to its page.
        return (
          <aside key={index} className="mt-6 rounded-[var(--radius-lg)] bg-card p-5 shadow-[var(--shadow-whisper)] sm:p-6">
            <p className="font-serif text-xl text-heading">{name}</p>
            <p className="mt-2 text-[15px] leading-relaxed text-body/75">{typeset(block.note, locale)}</p>
            <Link
              href={`/products/${product.slug}`}
              className="group mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-heading hover:text-champagne-gold"
            >
              {typeset(tGuides("seeProduct", { name }), locale)}
              <ArrowRight className="h-3.5 w-3.5 transition-transform rtl:rotate-180 ltr:group-hover:translate-x-1 rtl:group-hover:-translate-x-1" aria-hidden="true" />
            </Link>
          </aside>
        );
      }
    }
  };

  return (
    <div>
      <p className="text-lg leading-relaxed text-body/85 sm:text-xl">{typeset(translation.intro, locale)}</p>
      {translation.blocks.map(render)}
    </div>
  );
}

/** A guide's date in its own language, as a calendar day. */
export function formatGuideDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}
