// @vitest-environment node
import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import { routing } from "@/i18n/routing";
import { getAllProducts } from "@/lib/products/registry";
import { enabledIntents } from "@/lib/products/gift-intents";
import { SITE_URL } from "@/lib/site-config";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

/**
 * EVERY INDEXABLE PAGE'S TITLE AND DESCRIPTION FIT IN A SEARCH RESULT
 * (27 Oct 2026). Eleven descriptions ran to 165-236 characters and five
 * titles past 60 (the French Reasons title was 84), so Google cut them off.
 * Limits: a title of at most 60 characters AS RENDERED (with the layout's
 * " — Heartfolio"), a description of at most 160 with a price filled in.
 * Every page the sitemap lists is checked, in every language, so a new page
 * cannot skip it.
 */
const MESSAGES = { en, fr, ar } as Record<string, Record<string, unknown>>;
const TITLE_SUFFIX: Record<string, string> = { en: " — Heartfolio", fr: " — Heartfolio", ar: " — هارتفوليو" };
/** As wide as any starting price is likely to be. */
const PRICE = "$99.99 USD";
const TITLE_MAX = 60;
const DESCRIPTION_MAX = 160;

function message(locale: string, path: string): string {
  const value = path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], MESSAGES[locale]);
  if (typeof value !== "string") throw new Error(`${locale}: no message ${path}`);
  return value;
}

/** The message keys a sitemap path takes its title and descriptions from;
 *  `templated` when the layout appends the site name. */
function metaKeys(path: string): { title: string; descriptions: string[]; templated: boolean } {
  if (path === "") return { title: "Meta.title", descriptions: ["Meta.description"], templated: false };
  if (path === "/products") {
    return { title: "Collection.meta.title", descriptions: ["Collection.meta.description", "Collection.meta.descriptionNoPrice"], templated: true };
  }
  const product = getAllProducts().find((p) => path === `/products/${p.slug}`);
  if (product) {
    const base = `Products.${product.i18nKey}.meta`;
    return { title: `${base}.title`, descriptions: [`${base}.description`, `${base}.descriptionNoPrice`], templated: true };
  }
  const intent = enabledIntents().find((i) => path === `/gifts/${i.slug}`);
  if (intent) return { title: `GiftIntents.${intent.i18nKey}.meta.title`, descriptions: [`GiftIntents.${intent.i18nKey}.meta.description`], templated: true };
  const legal = /^\/(terms|privacy|refunds|contact)$/.exec(path);
  if (legal) return { title: `Legal.${legal[1]}.meta.title`, descriptions: [`Legal.${legal[1]}.meta.description`], templated: true };
  if (path === "/feedback") return { title: "FeedbackPage.meta.title", descriptions: ["FeedbackPage.meta.description"], templated: true };
  throw new Error(`No title/description mapping for sitemap page "${path}": add it here.`);
}

const paths = [...new Set(sitemap().map((entry) => entry.url.replace(`${SITE_URL}/${routing.defaultLocale}`, "")))].filter(
  (path) => !routing.locales.some((l) => path.startsWith(`${SITE_URL}/${l}`))
);

describe("titles and descriptions fit a search result", () => {
  it("covers every page the sitemap lists", () => {
    expect(paths.length).toBeGreaterThanOrEqual(12);
    for (const path of paths) expect(() => metaKeys(path), path).not.toThrow();
  });

  describe.each(routing.locales)("%s", (locale) => {
    it.each(paths)("%s", (path) => {
      const keys = metaKeys(path);
      const title = message(locale, keys.title) + (keys.templated ? TITLE_SUFFIX[locale] : "");
      expect(title.length, `title "${title}"`).toBeLessThanOrEqual(TITLE_MAX);
      for (const key of keys.descriptions) {
        const description = message(locale, key).replace("{price}", PRICE);
        expect(description.length, `${key}: "${description}"`).toBeLessThanOrEqual(DESCRIPTION_MAX);
        expect(description.length, `${key} is a real description`).toBeGreaterThanOrEqual(50);
      }
    });
  });
});
