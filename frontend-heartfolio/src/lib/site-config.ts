/**
 * Single source of truth for site-wide constants that were previously
 * hardcoded (and, in the case of the domain, hardcoded *wrong*) across
 * layout metadata, sitemap, robots and JSON-LD.
 */

/** The live canonical origin. NOTE: the previous code used
 * `https://www.heartfolio.com` in four places — that is not the live
 * domain, which broke every canonical URL, OG url and sitemap entry. */
export const SITE_URL = "https://www.theheartfolio.com";

export const SITE_NAME = "Heartfolio";

/** Bare hostname, for places that need the domain as *text* rather than a
 * link — currently the pre-payment preview watermark (§20). Derived from
 * SITE_URL so the two cannot drift apart. */
export const SITE_DOMAIN = SITE_URL.replace(/^https?:\/\//, "");

/**
 * Attribution on web surfaces Heartfolio serves — the AR page, the live
 * keepsake — as opposed to files the customer bought and framed, which
 * carry the bare domain only.
 *
 * Mirrors `WEB_MARK` in `apps/delivery/attribution.py`.
 */
export const WEB_MARK = `Made with Heartfolio · ${SITE_DOMAIN}`;

/**
 * Support inbox for the current development/landing-page phase.
 * Approved in Pass A (§17) — explicitly NOT the domain address, which can
 * come later once a domain-hosted inbox actually exists and is monitored.
 *
 * TODO(HEARTFOLIO-PREDEPLOY):
 * Future purchase recovery/re-delivery flow has not been finalized.
 * Current approved concept: purchased files are intended to be delivered
 * by email; there is no account system, and input/source assets stored in
 * R2 may eventually be deleted after roughly 15 days, so the digital/web
 * experience is not necessarily permanently available after that. Do not
 * add authentication, account functionality, or claims of permanent
 * access / lifetime redownloads anywhere in the app. A recovery mechanism
 * (support-ticket based or otherwise) will be decided later — this
 * address is where that will land in the meantime.
 */
export const SUPPORT_EMAIL = "heartfolioapp@gmail.com";

/** Public prices are quoted in USD only (see brief §15). */
export const PRICE_CURRENCY = "USD";

/** Format a numeric USD amount the way the brand shows it: `$12 USD`. */
export function formatPrice(amount: number, currency: string = PRICE_CURRENCY): string {
  const value = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return `$${value} ${currency}`;
}
