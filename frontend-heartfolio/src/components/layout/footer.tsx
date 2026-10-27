"use client";

import { useLocale, useTranslations } from "next-intl";
import { Logo } from "@/components/brand/logo";
import { Link } from "@/i18n/navigation";
import { reopenConsent } from "@/components/analytics/analytics";
import { getAllProducts } from "@/lib/products/registry";
import { enabledIntents } from "@/lib/products/gift-intents";
import { GUIDE_INDEX_LOCALES } from "@/lib/guides/published-locales";
import { useProductContent } from "@/lib/products/use-product-content";
import { SUPPORT_EMAIL } from "@/lib/site-config";
import type { ProductEntry } from "@/lib/products/types";

/**
 * Rewritten (§19, §20). Every footer link used to be `href="#"` or point
 * at the homepage — including "Privacy" and "Terms". For a site that will
 * go through Paddle's merchant review, dead policy links are a hard
 * blocker, and for a customer trying to find a refund policy they are
 * just bad manners.
 *
 * Now: Shop is generated from the product registry, Legal points at four
 * real pages, and Support exposes a real address rather than a link to
 * nowhere. Nothing links to a page that does not exist — the newsletter
 * form and the invented "Reviews"/"Sustainability"/"Track My Order"
 * columns are gone, since none of them are backed by anything.
 */
/**
 * Where Heartfolio lives elsewhere.
 *
 * ICONS ARE INLINE PATHS, not an icon library. lucide-react carries
 * Instagram but neither Pinterest nor TikTok, and one library glyph beside
 * two hand-drawn ones gives three icons that do not match. These share a
 * viewBox and a weight.
 *
 * `rel="me"` asserts these accounts are the same entity as this site,
 * which is what lets a profile link verify back. `noopener` because each
 * opens a new tab.
 */
const SOCIALS = [
  {
    label: "Instagram",
    href: "https://www.instagram.com/heartfolioapp",
    path: "M12 2.2c3.2 0 3.6 0 4.9.07 1.2.05 1.8.25 2.2.42.6.2 1 .47 1.4.9.4.4.7.8.9 1.4.17.4.37 1 .42 2.2.06 1.3.07 1.7.07 4.9s0 3.6-.07 4.9c-.05 1.2-.25 1.8-.42 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.17-1 .37-2.2.42-1.3.06-1.7.07-4.9.07s-3.6 0-4.9-.07c-1.2-.05-1.8-.25-2.2-.42-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.17-.4-.37-1-.42-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.07-4.9c.05-1.2.25-1.8.42-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.17 1-.37 2.2-.42C8.4 2.2 8.8 2.2 12 2.2Zm0 5.1a4.7 4.7 0 1 0 0 9.4 4.7 4.7 0 0 0 0-9.4Zm0 7.75a3.05 3.05 0 1 1 0-6.1 3.05 3.05 0 0 1 0 6.1Zm5.99-7.94a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0Z",
  },
  {
    label: "Pinterest",
    href: "https://www.pinterest.com/heartfolioapp/",
    path: "M12 2a10 10 0 0 0-3.65 19.31c-.05-.78-.01-1.72.19-2.57.18-.78 1.2-5.09 1.2-5.09s-.3-.6-.3-1.49c0-1.4.81-2.44 1.82-2.44.86 0 1.27.64 1.27 1.42 0 .86-.55 2.15-.83 3.35-.24 1 .5 1.82 1.49 1.82 1.79 0 3.16-1.89 3.16-4.61 0-2.41-1.73-4.1-4.21-4.1-2.86 0-4.55 2.15-4.55 4.37 0 .87.33 1.8.75 2.3.08.1.09.19.07.29-.08.32-.25.99-.28 1.13-.04.18-.15.22-.34.13-1.25-.58-2.03-2.4-2.03-3.87 0-3.15 2.29-6.04 6.6-6.04 3.46 0 6.16 2.47 6.16 5.77 0 3.44-2.17 6.21-5.18 6.21-1.01 0-1.96-.53-2.29-1.15l-.62 2.38c-.22.87-.83 1.96-1.24 2.62A10 10 0 1 0 12 2Z",
  },
  {
    label: "TikTok",
    href: "https://www.tiktok.com/@heartfolioapp",
    path: "M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 1 1-1.79-2.46V9.8a5.66 5.66 0 1 0 4.88 5.6V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3a4.3 4.3 0 0 1-3.24-1.48Z",
  },
];

function SocialLinks() {
  return (
    <ul className="mt-8 flex items-center gap-3">
      {SOCIALS.map((social) => (
        <li key={social.label}>
          <a
            href={social.href}
            target="_blank"
            rel="me noopener noreferrer"
            aria-label={social.label}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-parchment/15 text-parchment/70 transition-colors hover:border-champagne-gold/60 hover:text-champagne-gold"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-4 w-4">
              <path d={social.path} />
            </svg>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function SiteFooter() {
  const t = useTranslations("Footer");
  const tIntents = useTranslations("GiftIntents");
  const products = getAllProducts();
  // The gift pages (`/gifts/<slug>`) had no link anywhere, so the sitemap
  // listed a page no visitor or crawler could reach by following links
  // (27 Oct 2026).
  const intents = enabledIntents();

  const locale = useLocale();
  const companyLinks = [
    { href: "/products", label: t("company.collection") },
    // Only in a language that has published guides (`/guides` is a 404
    // in the others).
    ...(GUIDE_INDEX_LOCALES.includes(locale) ? [{ href: "/guides", label: t("company.guides") }] : []),
    { href: "/#how-it-works", label: t("company.howItWorks") },
    { href: "/#faq", label: t("company.faq") },
  ];

  const tFeedback = useTranslations("FeedbackPage");

  const legalLinks = [
    { href: "/terms", label: t("legal.terms") },
    { href: "/privacy", label: t("legal.privacy") },
    { href: "/refunds", label: t("legal.refunds") },
    { href: "/contact", label: t("legal.contact") },
    // §7c — general site feedback. Sits with the legal/contact links
    // rather than as a floating tab: this is where someone already looks
    // when they want to reach a person, and a persistent widget would
    // compete with the buy button on every page.
    { href: "/feedback", label: tFeedback("footerLink") },
  ];

  return (
    <footer className="bg-ink-navy pb-28 pt-20 text-parchment md:pb-20 md:pt-30">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="grid gap-14 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <p className="font-serif text-2xl text-parchment">
              {/* Same reasoning as the header: the real mark, not a font glyph. */}
              <Logo variant="mark" title={null} className="mr-2 inline-block h-6 w-6 align-[-0.2em]" />
              Heartfolio
            </p>
            <p className="mt-3 max-w-[260px] text-sm leading-relaxed text-parchment/65">
              {t("tagline")}
            </p>
            {/*
              WAS `ConstellationMark` — a decorative glyph sitting directly
              under the wordmark and tagline, which read as a second, older
              logo stacked beneath the real one. One brand mark per column;
              the social links are what belongs in that space.
            */}
            <SocialLinks />
          </div>

          <FooterColumn title={t("shop.title")}>
            {products.map((product) => (
              <ProductFooterLink key={product.id} product={product} />
            ))}
            {intents.map((intent) => (
              <li key={intent.slug}>
                <Link href={`/gifts/${intent.slug}`} className="footer-link text-sm text-parchment/70 transition-colors hover:text-parchment">
                  {tIntents(`${intent.i18nKey}.navLabel`)}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/products" className="footer-link text-sm text-parchment/70 transition-colors hover:text-parchment">
                {t("shop.all")}
              </Link>
            </li>
          </FooterColumn>

          <FooterColumn title={t("company.title")}>
            {companyLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-sm text-parchment/70 transition-colors hover:text-parchment">
                  {link.label}
                </Link>
              </li>
            ))}
          </FooterColumn>

          <FooterColumn title={t("legal.title")}>
            {legalLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-sm text-parchment/70 transition-colors hover:text-parchment">
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              {/* Asks the cookie question again, so a visitor can change
                  their answer without clearing the site's data. */}
              <button
                type="button"
                onClick={reopenConsent}
                className="text-start text-sm text-parchment/70 transition-colors hover:text-parchment"
              >
                {t("legal.cookieSettings")}
              </button>
            </li>
          </FooterColumn>
        </div>

        {/* Digital-goods clarity, stated in the footer of every page (§17) */}
        <div className="mt-16 border-t border-parchment/10 pt-10">
          <p className="max-w-2xl text-sm leading-relaxed text-parchment/65">
            {t("digitalNotice")}
          </p>
          <p className="mt-4 text-sm text-parchment/65">
            {t("supportLine")}{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="text-parchment underline decoration-champagne-gold decoration-1 underline-offset-4"
            >
              {SUPPORT_EMAIL}
            </a>
          </p>
        </div>

        <div className="mt-12 flex flex-col-reverse items-center gap-4 border-t border-parchment/10 pt-8 text-xs text-parchment/50 sm:flex-row sm:justify-between">
          <p>{t("copyright", { year: new Date().getFullYear() })}</p>
          <p>{t("pricesNote")}</p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <nav aria-label={title}>
      <h2 className="text-xs font-medium uppercase tracking-[0.08em] text-champagne-gold/90">
        {title}
      </h2>
      <ul className="mt-5 space-y-3.5">{children}</ul>
    </nav>
  );
}

/** Own component so the translation hook runs at a stable top level. */
function ProductFooterLink({ product }: { product: ProductEntry }) {
  const content = useProductContent(product);
  return (
    <li>
      <Link
        href={`/products/${product.slug}`}
        className="text-sm text-parchment/70 transition-colors hover:text-parchment"
      >
        {content.name}
      </Link>
    </li>
  );
}
