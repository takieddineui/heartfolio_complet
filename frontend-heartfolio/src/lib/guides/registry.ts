import { routing } from "@/i18n/routing";
import { SITE_URL } from "@/lib/site-config";
import { anniversaryIdeasGuide } from "@/content/guides/anniversary-ideas";
import { reasonsGuide } from "@/content/guides/reasons-i-love-you";
import type { Guide, GuideLocale, GuideTranslation } from "./types";

/**
 * Every guide, in the order the index lists them. To add one: a folder under
 * `src/content/guides/<id>/` with an `index.ts` (the `Guide`) and one file
 * per language, then a line here. `guides.test.ts` checks the rest.
 */
export const GUIDES: Guide[] = [anniversaryIdeasGuide, reasonsGuide];

/**
 * A guide's capture loops together, per translation (`guides.test.ts`).
 * Each loop downloads only when its phone is on screen, so this is the cost
 * of reading the whole guide, not of opening it. At most three loops: Love
 * Story Timeline's is the heaviest (about 515 KB), so three of the current
 * ones fit with room.
 */
export const GUIDE_VIDEO_BUDGET = { bytes: 900 * 1024, loops: 3 };

/** Drafts are visible only on a development server, for review. */
export function showsDrafts(): boolean {
  return process.env.NODE_ENV !== "production";
}

function visible(translation: GuideTranslation | undefined, includeDrafts = showsDrafts()): translation is GuideTranslation {
  return Boolean(translation) && (translation!.status === "published" || includeDrafts);
}

export function guideLocale(locale: string): GuideLocale | null {
  return (routing.locales as readonly string[]).includes(locale) ? (locale as GuideLocale) : null;
}

/** The guide and its translation for a URL, or null (a real 404). */
export function findGuide(locale: string, slug: string): { guide: Guide; translation: GuideTranslation } | null {
  const lang = guideLocale(locale);
  if (!lang) return null;
  for (const guide of GUIDES) {
    const translation = guide.translations[lang];
    if (visible(translation) && translation.slug === slug) return { guide, translation };
  }
  return null;
}

/** The guides a language has, newest change first. */
export function guidesIn(locale: string, { includeDrafts = showsDrafts() } = {}): { guide: Guide; translation: GuideTranslation }[] {
  const lang = guideLocale(locale);
  if (!lang) return [];
  return GUIDES.flatMap((guide) => {
    const translation = guide.translations[lang];
    return visible(translation, includeDrafts) ? [{ guide, translation }] : [];
  }).sort((a, b) => b.translation.updated.localeCompare(a.translation.updated));
}

/** The published guides about a product, in a language. */
export function guidesForProduct(productId: string, locale: string) {
  return guidesIn(locale, { includeDrafts: false }).filter(({ guide }) => guide.products.includes(productId));
}

/** The languages that have at least one published guide (the index exists
 *  in those only). */
export function guideIndexLocales(): GuideLocale[] {
  return (routing.locales as readonly GuideLocale[]).filter((locale) => guidesIn(locale, { includeDrafts: false }).length > 0);
}

/**
 * hreflang between the translations that EXIST (published), and `x-default`
 * only when there is an English one; the canonical is the page itself.
 */
export function guideAlternates(guide: Guide, locale: GuideLocale) {
  const languages: Record<string, string> = {};
  for (const [lang, translation] of Object.entries(guide.translations) as [GuideLocale, GuideTranslation][]) {
    if (translation.status === "published") languages[lang] = `${SITE_URL}/${lang}/guides/${translation.slug}`;
  }
  if (languages.en) languages["x-default"] = languages.en;
  const own = guide.translations[locale]!;
  return { canonical: `${SITE_URL}/${locale}/guides/${own.slug}`, languages };
}

/** The index's hreflang: the languages with guides, `x-default` English. */
export function guideIndexAlternates(locale: string) {
  const languages: Record<string, string> = Object.fromEntries(guideIndexLocales().map((lang) => [lang, `${SITE_URL}/${lang}/guides`]));
  if (languages.en) languages["x-default"] = languages.en;
  return { canonical: `${SITE_URL}/${locale}/guides`, languages };
}
