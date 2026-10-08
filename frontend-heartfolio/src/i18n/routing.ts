import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "fr", "ar"],
  defaultLocale: "en",
  /**
   * "always" — every locale gets its own prefix, including English.
   * The brief (§21, §27) specifies /en, /fr and /ar as the three public
   * URL spaces; the previous "as-needed" setting left English on bare
   * paths, which made hreflang and canonical pairs inconsistent (the
   * English page lived at "/" while claiming "/en" as an alternate).
   */
  localePrefix: "always",
  // Detection is handled in `proxy.ts` — browser Accept-Language only,
  // never geo-IP, and only on a visitor's first request (§21, §22).
  localeDetection: false,
});

export type AppLocale = (typeof routing.locales)[number];
