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
 * The split is between *marketing* and *customer flow*:
 *
 *   Crawlable — the homepage, `/products`, each product page, and the legal
 *   pages. These are the pages that should rank, and nothing here is
 *   `noindex`ed (verified: the only `robots` metadata in the app sets
 *   `index: true, follow: true`, on the layout and the four legal routes).
 *
 *   Excluded — `/create`, `/studio`, `/project`, `/orders`. These are
 *   working surfaces scoped to a guest session cookie. A crawler reaching
 *   them sees an empty editor or an error state, so indexing them can only
 *   produce thin, session-dependent results competing with the real pages.
 *
 * LOCALE PREFIXES: every URL on this site is locale-prefixed, so a bare
 * `/studio` rule would match nothing in production. Rules are generated per
 * locale from `routing.locales` — adding a fourth language keeps this
 * correct without a second edit. The unprefixed forms are listed too: the
 * middleware redirects them, and a disallowed redirect target is cleaner
 * than letting a crawler follow the hop first.
 *
 * PREFIX SEMANTICS: because these rules have no trailing slash, a future
 * route sharing a prefix — `/projects` alongside `/project` — would be
 * caught too. None exists today; if one is added, give it a distinct first
 * segment or switch these to explicit `$`-anchored pairs.
 *
 * DELIBERATELY NOT ALSO `noindex`: a `Disallow` prevents fetching, and a
 * crawler that never fetches the page never reads a `noindex` on it. Pairing
 * the two is a well-known way to get a URL indexed without a description
 * rather than excluded. One mechanism, chosen on purpose — robots.txt, which
 * is what §16d asks for.
 */
const PRIVATE_PATHS = ["/create", "/studio", "/project", "/orders"];

function disallowedPaths(): string[] {
  const rules = new Set<string>(["/api/"]);

  for (const path of PRIVATE_PATHS) {
    // NO trailing slash. robots.txt matches by prefix, so `/en/studio/` would
    // match `/en/studio/love-story-timeline` but NOT `/en/studio` itself —
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
