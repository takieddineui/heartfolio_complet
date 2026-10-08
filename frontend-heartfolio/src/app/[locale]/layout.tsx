import type { Metadata } from "next";
import Script from "next/script";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { ThemeProvider } from "@/components/theme/theme-provider";
// Server-safe on purpose — see theme-constants.ts. Importing this from
// theme-provider.tsx (a "use client" file) instead of here meant the
// inline anti-flash <Script> rendered with no content in production: not
// a crash, just a silent theme flash on every page load.
import { NO_FLASH_SCRIPT } from "@/components/theme/theme-constants";
import { Analytics } from "@/components/analytics/analytics";
import { CookieConsent } from "@/components/analytics/cookie-consent";
import { SITE_NAME, SITE_URL } from "@/lib/site-config";
import { buildAlternates, ogLocales } from "@/lib/seo";
import { fontClassNames } from "@/lib/fonts";
import "../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });

  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: t("title"),
      template: `%s — ${SITE_NAME}`,
    },
    description: t("description"),
    // Per-locale canonical + full hreflang set. Pages that need their own
    // canonical (products, policies) override `alternates` themselves.
    alternates: buildAlternates(locale, ""),
    openGraph: {
      title: t("title"),
      description: t("description"),
      url: `${SITE_URL}/${locale}`,
      siteName: SITE_NAME,
      // No explicit `images` here on purpose: the `opengraph-image` file
      // convention alongside this route generates the card, and an
      // explicit entry would override it (and point at /og-image.png,
      // which does not exist in this repository).
      type: "website",
      ...ogLocales(locale),
    },
    twitter: {
      card: "summary_large_image",
      title: t("title"),
      description: t("description"),
    },
    robots: { index: true, follow: true },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }

  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Meta" });
  const dir = locale === "ar" ? "rtl" : "ltr";

  /**
   * Preload only the faces this locale will actually use. The @font-face
   * blocks in globals.css are `unicode-range`-gated, so the browser would
   * never request the Arabic files on /en — but a preload hint is NOT
   * gated by unicode-range, so preloading all four would force every
   * visitor to download ~240 KB of script they cannot read. Two files per
   * locale, chosen here. */
  const preloadFonts =
    locale === "ar"
      ? ["/fonts/noto-kufi-arabic.woff2", "/fonts/noto-naskh-arabic.woff2"]
      : ["/fonts/fraunces-latin.woff2", "/fonts/inter-latin.woff2"];

  return (
    <html lang={locale} dir={dir} className={fontClassNames(locale)} suppressHydrationWarning>
      <head>
        {preloadFonts.map((href) => (
          <link
            key={href}
            rel="preload"
            href={href}
            as="font"
            type="font/woff2"
            crossOrigin="anonymous"
          />
        ))}
      </head>
      <body className="paper-grain min-h-screen bg-page font-sans text-body antialiased">
        <Script id="theme-no-flash" strategy="beforeInteractive">
          {NO_FLASH_SCRIPT}
        </Script>
        <ThemeProvider>
          <NextIntlClientProvider>
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-ink-navy focus:px-4 focus:py-2 focus:text-parchment"
            >
              {t("skipToContent")}
            </a>
            {children}
            {/*
              Inside NextIntlClientProvider because the banner is translated.
              After {children} so neither is in the tab order before the page
              content — an optional choice should not be the first thing a
              keyboard user reaches.
            */}
            <CookieConsent />
            <Analytics />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
