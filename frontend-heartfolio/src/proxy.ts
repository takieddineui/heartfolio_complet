import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { getProductById, getProductBySlug } from "./lib/products/registry";
import { captureModeEnabled } from "./lib/captures/capture-mode";

const intlMiddleware = createMiddleware(routing);

type SiteLocale = (typeof routing.locales)[number];

export const LOCALE_COOKIE = "NEXT_LOCALE";
const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * ---------------------------------------------------------------------
 * LOCALE DETECTION (brief §21, §22)
 * ---------------------------------------------------------------------
 * Rewritten. The previous implementation guessed language from
 * `x-vercel-ip-country`: anyone outside a hardcoded list of
 * English-speaking countries was sent to French, and Arabic was
 * unreachable by detection at all. That is exactly the behaviour the
 * brief rules out — a visitor in Algeria with an English browser was
 * being handed a French site, and an Arabic-speaking visitor anywhere
 * was never offered Arabic.
 *
 * Now: country is ignored entirely. Only the browser's Accept-Language
 * preference decides, and only on the first visit.
 *
 *   ar-*      -> /ar
 *   fr-*      -> /fr
 *   anything  -> /en
 *
 * Once a locale is resolved it is written to a cookie, so detection runs
 * once per visitor rather than on every navigation. An explicit choice in
 * the language switcher overwrites that cookie and is never second-guessed
 * afterwards — a French-browser visitor who picks English stays on English.
 */
function detectLocaleFromBrowser(request: NextRequest): SiteLocale {
  const header = request.headers.get("accept-language");
  if (!header) return routing.defaultLocale;

  // Accept-Language is a q-weighted list: "fr-CH, fr;q=0.9, en;q=0.8".
  // Walk it in preference order and take the first tag we publish.
  const entries = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="))
        ?.slice(2);
      return { tag: (tag ?? "").trim().toLowerCase(), q: q ? Number(q) : 1 };
    })
    .filter((e) => e.tag && !Number.isNaN(e.q))
    .sort((a, b) => b.q - a.q);

  for (const { tag } of entries) {
    const base = tag.split("-")[0] ?? "";
    if (base === "ar") return "ar";
    if (base === "fr") return "fr";
    if (base === "en") return "en";
  }

  return routing.defaultLocale;
}

/**
 * A REAL 404 FOR A PRODUCT THAT IS NOT PUBLISHED (25 Oct 2026).
 * `/products/<slug>` and `/studio/<slug>` for a hidden or unknown product
 * answered 200 with `index, follow`: the `[locale]` loading boundary starts
 * streaming before the page's own `notFound()` runs, so the status is
 * already sent. Checked here, before rendering, against the same visible
 * registry the pages use; the request is rewritten to a path no route
 * matches, which Next answers with the root not-found page and a 404 status,
 * in the URL's language (the locale header `app/not-found.tsx` reads).
 */
const PRODUCT_ROUTE = /^\/[a-z]{2}\/(products|studio)\/([^/]+)/;

function unpublishedProductPath(pathname: string, locale: SiteLocale) {
  const match = PRODUCT_ROUTE.exec(pathname);
  if (!match) return null;
  const slug = decodeURIComponent(match[2]!);
  const published = match[1] === "studio" ? getProductBySlug(slug) ?? getProductById(slug) : getProductBySlug(slug);
  if (published) return null;
  return (request: NextRequest) => {
    const headers = new Headers(request.headers);
    headers.set("X-NEXT-INTL-LOCALE", locale);
    return NextResponse.rewrite(new URL(`/${locale}/__not-found__`, request.url), { request: { headers } });
  };
}

/**
 * The dev-only capture page (`app/[locale]/capture/[product]`, for the
 * storefront's product captures) is a real 404 unless the server was started
 * for captures: the same rewrite as an unpublished product, because a
 * `notFound()` inside the page would already have streamed a 200.
 */
const CAPTURE_ROUTE = /^\/[a-z]{2}\/capture(\/|$)/;

function lockedCapturePath(pathname: string) {
  return CAPTURE_ROUTE.test(pathname) && !captureModeEnabled();
}

function rewriteToNotFound(request: NextRequest, locale: SiteLocale) {
  const headers = new Headers(request.headers);
  headers.set("X-NEXT-INTL-LOCALE", locale);
  return NextResponse.rewrite(new URL(`/${locale}/__not-found__`, request.url), { request: { headers } });
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  const hasValidCookie = Boolean(
    cookieLocale && (routing.locales as readonly string[]).includes(cookieLocale)
  );

  const pathnameLocale = routing.locales.find(
    (loc) => pathname === `/${loc}` || pathname.startsWith(`/${loc}/`)
  );

  // An explicit locale in the URL always wins — a shared /ar link opens in
  // Arabic for everyone, regardless of cookie or browser. Detection is
  // NOT re-run here (§22: no automatic detection on every navigation).
  if (pathnameLocale) {
    const missing = unpublishedProductPath(pathname, pathnameLocale);
    if (missing) return missing(request);
    if (lockedCapturePath(pathname)) return rewriteToNotFound(request, pathnameLocale);
    return intlMiddleware(request);
  }

  // Un-prefixed path: resolve once — saved preference first, browser
  // preference second — and redirect to the prefixed equivalent.
  const resolved: SiteLocale = hasValidCookie
    ? (cookieLocale as SiteLocale)
    : detectLocaleFromBrowser(request);

  const url = request.nextUrl.clone();
  url.pathname = `/${resolved}${pathname === "/" ? "" : pathname}`;

  const response = NextResponse.redirect(url);
  if (!hasValidCookie) {
    response.cookies.set(LOCALE_COOKIE, resolved, {
      path: "/",
      maxAge: ONE_YEAR,
      sameSite: "lax",
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!api|trpc|_next|_vercel|.*\\..*).*)"],
};
