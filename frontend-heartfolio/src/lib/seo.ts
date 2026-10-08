import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import { SITE_URL } from "@/lib/site-config";

/**
 * Builds a correct per-locale `alternates` block.
 *
 * The previous implementation set `canonical: "/"` on *every* page in
 * every locale and listed the same three language URLs regardless of
 * which page you were on — meaning /fr/products/song-poster claimed the
 * homepage as its canonical. That is the single most damaging SEO bug in
 * the codebase. Each page now points at itself, in its own locale, and
 * declares a full hreflang set including `x-default`.
 *
 * @param locale current locale
 * @param path   locale-agnostic path with a leading slash, "" for home
 */
export function buildAlternates(locale: string, path: string = ""): Metadata["alternates"] {
  const clean = path === "/" ? "" : path;
  const languages: Record<string, string> = {};

  for (const loc of routing.locales) {
    languages[loc] = `${SITE_URL}/${loc}${clean}`;
  }
  // x-default points at English — the fallback for any language we do
  // not publish, not a claim that English outranks the others.
  languages["x-default"] = `${SITE_URL}/${routing.defaultLocale}${clean}`;

  return {
    canonical: `${SITE_URL}/${locale}${clean}`,
    languages,
  };
}

/** OG locale strings — `en_US` style, plus the other locales as alternates. */
export function ogLocales(locale: string) {
  const map: Record<string, string> = { en: "en_US", fr: "fr_FR", ar: "ar_AR" };
  return {
    locale: map[locale] ?? "en_US",
    alternateLocale: routing.locales
      .filter((l) => l !== locale)
      .map((l) => map[l])
      .filter((l): l is string => Boolean(l)),
  };
}

/** Absolute URL for an OG image path under /public. */
export function absoluteUrl(path: string) {
  return path.startsWith("http") ? path : `${SITE_URL}${path}`;
}
