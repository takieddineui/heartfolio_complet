import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { SITE_URL } from "@/lib/site-config";

/**
 * ---------------------------------------------------------------------
 * CRAWLABILITY (§16d)
 * ---------------------------------------------------------------------
 * Previously this disallowed only `/api/`, on the reasoning that "nothing
 * here is private; the Studio route does not exist yet". Both halves of that
 * are now out of date: the Studio exists, and so do the project, checkout and
 * order routes behind it.
 *
 * THE STUDIO IS CRAWLED BUT NOT INDEXED (27 Oct 2026). `/create`, `/studio`
 * and `/project` used to be disallowed here while their pages said
 * `index, follow` with the HOME page as canonical. Blocked, Google never
 * read those tags, and could still index the bare addresses from the link
 * on every product page. Now they are crawlable and carry `noindex` with
 * their own canonical (`noindexMetadata` in `lib/seo.ts`), Google's own
 * advice for keeping a page out of results; `seo-status.test.ts` pins both
 * halves.
 *
 * STILL DISALLOWED: `/api/`, and `/orders`, whose links carry a signed
 * access token: a crawler that found one (pasted somewhere public) would
 * otherwise fetch a customer's order. The order page is also `noindex`.
 *
 * LOCALE PREFIXES: every URL on this site is locale-prefixed, so a bare
 * `/orders` rule would match nothing in production. Rules are generated per
 * locale from `routing.locales` — adding a fourth language keeps this
 * correct without a second edit. The unprefixed forms are listed too: the
 * middleware redirects them, and a disallowed redirect target is cleaner
 * than letting a crawler follow the hop first.
 *
 * PREFIX SEMANTICS: because these rules have no trailing slash, a future
 * route sharing a prefix — `/orders-history` alongside `/orders` — would be
 * caught too. None exists today; if one is added, give it a distinct first
 * segment or switch these to explicit `$`-anchored pairs.
 */
const PRIVATE_PATHS = ["/orders"];

function disallowedPaths(): string[] {
  const rules = new Set<string>(["/api/"]);

  for (const path of PRIVATE_PATHS) {
    // NO trailing slash. robots.txt matches by prefix, so `/en/orders/` would
    // match `/en/orders/<id>` but NOT `/en/orders` itself —
    // leaving the bare route crawlable, which is the one most likely to be
    // linked. Without the slash a single rule covers the route and everything
    // beneath it. Checked against the generated file, not assumed.
    rules.add(path);
    for (const locale of routing.locales) {
      rules.add(`/${locale}${path}`);
    }
  }
  return [...rules];
}

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: disallowedPaths(),
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
