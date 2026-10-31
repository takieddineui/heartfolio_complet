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
 * The colophon every deliverable carries (owner, 27 Oct 2026): the name and
 * the address, never translated. Mirrors `PRINT_MARK` in
 * `apps/delivery/attribution.py` (pinned by `site-config.test.ts`). The
 * address is the bare domain, without the canonical origin's "www.".
 */
export const COLOPHON_DOMAIN = SITE_DOMAIN.replace(/^www\./, "");
export const COLOPHON = `${SITE_NAME} · ${COLOPHON_DOMAIN}`;

/**
 * The older attribution line of the AR page. Mirrors `WEB_MARK` in
 * `apps/delivery/attribution.py`.
 */
export const WEB_MARK = `Made with Heartfolio · ${SITE_DOMAIN}`;

/**
 * Support inbox: the domain address (owner's decision, 19 Oct 2026, before
 * launch; it replaced the development-phase Gmail inbox). Read by
 * the footer, the legal pages and the Organization/contactPoint JSON-LD. The
 * backend's receipt email sets the same address as its reply-to
 * (`RESEND_REPLY_TO_EMAIL`), since it tells customers to reply.
 *
 * RECOVERY (updated 26 Oct 2026; this was a TODO that predated it): there
 * are no accounts. A customer who loses their order link writes here, and
 * the ops resend screen (`/api/v1/ops/resend/`) sends a fresh 30-day link.
 * A paid order stays deliverable indefinitely: photos never expire and
 * the artwork renders on demand. Only unpaid uploads are deleted: voice
 * and video files a week after upload, and unbought drafts with their
 * uploads after 12 months of inactivity (the privacy page's promise). Do
 * not add accounts or "redownload forever" wording without a decision to
 * support it.
 */
export const SUPPORT_EMAIL = "support@theheartfolio.com";

/**
 * Pinterest's domain verification (owner, 31 Oct 2026): a `<meta
 * name="p:domain_verify">` in the head of every page, through the locale
 * layout's metadata (`siteVerificationMetadata` in `lib/seo.ts`). The owner
 * verifies the domain in Pinterest once theheartfolio.com is live
 * (DEPLOYMENT-VPS.md).
 */
export const PINTEREST_DOMAIN_VERIFY = "7be136160ca05f467042f9f7e5c8cfeb";

/**
 * The facts the legal pages need that only the owner can supply, in one
 * place rather than in six translations. `legal-page.tsx` substitutes them
 * for `{controller}`, `{hosting}` and `{updated}` in the Terms, Refund and
 * Privacy pages, in every language.
 *
 * TODO(HEARTFOLIO-PREDEPLOY): fill in before the legal pages go live
 * (DEPLOYMENT-VPS.md, section 1). `LEGAL_CONTROLLER` is the business (or
 * person) that sells and is responsible for customer data: legal name,
 * postal address, country. `HOSTING_PROVIDER` is the VPS company.
 * `LEGAL_LAST_UPDATED` is the day the pages go live, as YYYY-MM-DD; it is
 * shown in each language's own date format.
 */
export const LEGAL_CONTROLLER = "[legal name], [postal address], [country]";
export const HOSTING_PROVIDER = "[hosting provider]";
export const LEGAL_LAST_UPDATED: string | null = null;

/** Public prices are quoted in USD only (see brief §15). */
export const PRICE_CURRENCY = "USD";

/** Format a numeric USD amount the way the brand shows it: `$12 USD`. */
export function formatPrice(amount: number, currency: string = PRICE_CURRENCY): string {
  const value = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return `$${value} ${currency}`;
}
