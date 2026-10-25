import { headers } from "next/headers";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";

/**
 * Root 404 — every URL no route matches, including the products and Studio
 * pages of a product that is not published (the proxy rewrites those here,
 * `proxy.ts`), so it answers with a real 404 status.
 *
 * `[locale]/not-found.tsx` only catches routes that already matched and
 * called `notFound()`. Everything else lands here, which was Next's unstyled
 * default page and then an English-only one on /fr and /ar too.
 *
 * IN THE URL'S LANGUAGE (25 Oct 2026): next-intl's proxy puts the locale on
 * the request (`X-NEXT-INTL-LOCALE`), read here; a request with none (a path
 * with no locale at all) gets English. Self-contained, with its own <html>,
 * because no locale layout wraps it.
 */
export default async function RootNotFound() {
  const requested = (await headers()).get("x-next-intl-locale") ?? "";
  const locale = (routing.locales as readonly string[]).includes(requested) ? requested : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: "NotFound" });
  const rtl = locale === "ar";

  return (
    <html lang={locale} dir={rtl ? "rtl" : "ltr"}>
      <head>
        <title>{`${t("metaTitle")} — ${rtl ? "هارتفوليو" : "Heartfolio"}`}</title>
        <meta name="robots" content="noindex" />
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#F7F1E6",
          color: "#141B2E",
          fontFamily: rtl ? "'Segoe UI', Tahoma, sans-serif" : "Georgia, 'Times New Roman', serif",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: "28rem" }}>
          <h1 style={{ fontSize: "2rem", margin: "0 0 12px", fontWeight: 400 }}>{t("title")}</h1>
          <p style={{ margin: "0 0 28px", lineHeight: 1.6, opacity: 0.75 }}>{t("body")}</p>
          <Link
            href={`/${locale}`}
            style={{
              display: "inline-block",
              background: "#141B2E",
              color: "#F7F1E6",
              padding: "12px 28px",
              borderRadius: "8px",
              textDecoration: "none",
            }}
          >
            {t("back")}
          </Link>
        </div>
      </body>
    </html>
  );
}
