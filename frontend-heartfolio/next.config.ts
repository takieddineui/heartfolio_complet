import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { routing } from "./src/i18n/routing";
import { getAllProducts } from "./src/lib/products/registry";
import { getBackendOrigin } from "./src/lib/backend-origin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * Permanent redirects for renamed product slugs (Pass A §2). Driven by
 * `previousSlugs` on each registry entry rather than listed by hand here —
 * `heart-map` → `where-we-met` today, and any future rename just needs a
 * `previousSlugs` entry in `registry.ts`, not a second edit in this file.
 * One redirect per old slug, per locale, so an indexed or bookmarked
 * `/fr/products/heart-map` still resolves instead of 404ing.
 */
function productSlugRedirects() {
  const redirects: { source: string; destination: string; permanent: boolean }[] = [];
  for (const product of getAllProducts()) {
    for (const oldSlug of product.previousSlugs ?? []) {
      for (const locale of routing.locales) {
        redirects.push({
          source: `/${locale}/products/${oldSlug}`,
          destination: `/${locale}/products/${product.slug}`,
          permanent: true,
        });
      }
    }
  }
  return redirects;
}

/**
 * ---------------------------------------------------------------------
 * SAME-ORIGIN API PROXY (Phase 2)
 * ---------------------------------------------------------------------
 * Heartfolio's guest identity is a Django *session cookie*, not a token.
 * The frontend and the API can sit on different registrable domains (they
 * did — Vercel and Railway), which makes that cookie third-party: `SameSite=Lax` would never
 * send it, and `SameSite=None` is blocked outright by Safari's ITP and
 * Firefox's Total Cookie Protection. Guest identity — and therefore
 * projects, orders, entitlements and downloads — would fail for a large
 * share of real customers while appearing to work in Chrome.
 *
 * So the browser only ever talks to its own origin: it calls
 * `/api/backend/...`, and Next rewrites that to the backend server-side. The
 * session cookie comes back without a `Domain` attribute and is therefore
 * scoped to whatever origin is serving the app — first-party on localhost,
 * on preview deployments, and in production alike, with no DNS work and no
 * per-environment cookie configuration.
 *
 * The backend origin is server-side config, NOT `NEXT_PUBLIC_` — the
 * browser never needs to know it, and keeping it private means the API's
 * real address isn't baked into the client bundle.
 *
 * `/api/waitlist` is a genuine Next route handler (Supabase) and is
 * deliberately NOT under `/api/backend`, so the two never collide.
 *
 * TRAILING SLASH: every Django URL pattern ends in `/`, and Django will not
 * `APPEND_SLASH`-redirect a POST (it raises rather than silently dropping
 * the body). But Next normalises incoming paths by 308-redirecting
 * `/api/backend/guest/` to `/api/backend/guest`, stripping exactly the
 * slash Django needs — verified against a live Django, not assumed. So the
 * destination re-adds it: the browser calls the clean, un-slashed path that
 * Next considers canonical, and Django receives `/api/v1/guest/`. Doing it
 * here rather than with `skipTrailingSlashRedirect: true` keeps the fix
 * scoped to the API — that flag is global and would change how every
 * marketing URL behaves.
 */
// REQUIRED, WITH NO DEFAULT. This used to fall back to a hardcoded URL on
// Railway, a host this project no longer uses — so an unset BACKEND_API_ORIGIN
// silently pointed the storefront at the wrong backend and, in a Docker build,
// froze that into .next/routes-manifest.json for good. `getBackendOrigin()` now
// throws, which stops `next dev` / `next build` immediately with a message that
// names the variable (see src/lib/backend-origin.ts).
//
// An EMPTY value counts as unset: a Docker ARG with no default and no
// `--build-arg` becomes an empty string when turned into an ENV, never
// undefined — the case that once produced an origin-less destination
// ("/api/v1/:path*/", no host at all).
const BACKEND_ORIGIN = getBackendOrigin();

const nextConfig: NextConfig = {
  /**
   * Standalone output for Docker only.
   *
   * `standalone` traces exactly the node_modules the app imports and emits a
   * self-contained `server.js`, which is what the Dockerfile runs. Vercel (the
   * former host) builds its own serverless output and does not need it.
   *
   * Gated on an env var rather than set unconditionally so a non-Docker build
   * (Vercel's, formerly) is byte-for-byte what it was before this file gained a Docker path —
   * a deployment target that has been working is not worth perturbing to
   * save one line.
   */
  output: process.env.DOCKER_BUILD === "1" ? "standalone" : undefined,

  reactStrictMode: true,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
    /**
     * WITHOUT THIS, A LARGE PACK DOWNLOAD 500s IN THE BROWSER WHILE DJANGO
     * STILL RETURNS 200. Next's own proxy (`http-proxy`, used by `rewrites()`
     * for an external destination like `BACKEND_ORIGIN` above) defaults this
     * to 30000ms — read directly from the shipped source
     * (`node_modules/next/dist/server/lib/router-utils/proxy-request.js`:
     * `proxyTimeout: proxyTimeout === null ? undefined : proxyTimeout ||
     * 30000`), not assumed. It is a Node socket-IDLE timeout
     * (`req.setTimeout()`), not a hard deadline — but
     * `OrderPackDownloadView` (apps/delivery/views.py) currently builds the
     * whole zip into memory and returns it in one `HttpResponse`, so ZERO
     * bytes reach this proxy for the entire render (~40-45s for a Love Story
     * Timeline Complete pack) — idle time and total time are the same thing
     * here, and 40-45s > 30s tears the connection down before Django's
     * response ever arrives. Confirmed via `docker compose logs web -t`
     * showing "Failed to proxy ... socket hang up (ECONNRESET)" for the
     * exact order id Django's own access log shows completing with 200.
     *
     * Set to match (not exceed by a wide margin) gunicorn's own
     * `--timeout 120` in backend/Dockerfile — the single sync worker kills
     * itself at 120s regardless, so a longer proxy timeout would only ever
     * wait for a response that gunicorn itself already gave up on.
     *
     * READ AT BUILD TIME, NOT RUNTIME, for a `standalone` output image
     * (confirmed via `router-server.js`, which reads
     * `config.experimental.proxyTimeout` from the config snapshot
     * `next build` writes into `required-server-files.json` — the
     * standalone server never re-reads `next.config.ts`). Changing this
     * value requires rebuilding the `web` image, the same constraint
     * `BACKEND_API_ORIGIN`'s own build-arg above already has.
     *
     * PROVEN in an isolated stack: rebuilt with this value baked in, then a
     * genuinely 34.2s / 224MB render reached the browser as a clean 200
     * (see PROJECT-STATE.md).
     *
     * DOES NOT COVER EVERY CAUSE OF THE SAME SYMPTOM. The identical
     * `ECONNRESET`/"socket hang up" can also come from gunicorn's single
     * worker being OOM-killed mid-render (confirmed separately, by
     * constraining a worker to 512MB and watching it die at ~75% while
     * rendering — see PROJECT-STATE.md) — that failure is a memory limit,
     * not a timeout, and raising this value further does nothing for it.
     */
    proxyTimeout: 120000,
  },
  async redirects() {
    return productSlugRedirects();
  },
  async rewrites() {
    return [
      {
        source: "/api/backend/:path*",
        destination: `${BACKEND_ORIGIN}/api/v1/:path*/`,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
