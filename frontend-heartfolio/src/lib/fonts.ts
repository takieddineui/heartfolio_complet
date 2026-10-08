import localFont from "next/font/local";

/**
 * ---------------------------------------------------------------------
 * FONTS (§34 — performance, and a brand bug)
 * ---------------------------------------------------------------------
 * `globals.css` has always asked for "Fraunces" and "Inter", but nothing
 * ever loaded them — no <link>, no @font-face, no next/font. Every
 * visitor was seeing the fallbacks (Georgia and the system UI font), so
 * the site has never actually rendered in its own typefaces.
 *
 * These are self-hosted variable woff2 files, loaded through next/font so
 * Next inlines the @font-face rules, preloads the files from our own
 * origin (no request to Google, no third-party round trip) and applies
 * `font-display: swap` — text paints immediately in the fallback and
 * swaps, rather than blocking on the font.
 *
 * `adjustFontFallback` keeps the fallback metrically close, which is what
 * stops the swap from shifting layout (CLS).
 */

export const fontSerif = localFont({
  src: [{ path: "../../public/fonts/fraunces-latin.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-heartfolio-serif",
  display: "swap",
  fallback: ["Georgia", "serif"],
  preload: true,
});

export const fontSans = localFont({
  src: [{ path: "../../public/fonts/inter-latin.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-heartfolio-sans",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "sans-serif"],
  preload: true,
});

/**
 * Arabic gets its own pair rather than being forced through a Latin face
 * with a fallback (§24 — Arabic should look intentionally designed, not
 * mechanically substituted). Kufi carries the display voice that Fraunces
 * carries in Latin; Naskh is the reading face.
 *
 * `preload: false` on purpose: these are only ever applied on /ar, so
 * preloading them on every page would cost English and French visitors
 * ~240KB for nothing. Next still inlines the @font-face, so /ar loads
 * them on first paint.
 */
export const fontArabicDisplay = localFont({
  src: [{ path: "../../public/fonts/noto-kufi-arabic.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-heartfolio-arabic-display",
  display: "swap",
  fallback: ["Segoe UI", "Tahoma", "sans-serif"],
  preload: false,
});

export const fontArabicBody = localFont({
  src: [{ path: "../../public/fonts/noto-naskh-arabic.woff2", weight: "400 700", style: "normal" }],
  variable: "--font-heartfolio-arabic-body",
  display: "swap",
  fallback: ["Segoe UI", "Tahoma", "serif"],
  preload: false,
});

/** The font variables to put on <html> for a given locale. */
export function fontClassNames(locale: string) {
  const latin = `${fontSerif.variable} ${fontSans.variable}`;
  if (locale === "ar") {
    return `${latin} ${fontArabicDisplay.variable} ${fontArabicBody.variable} font-arabic`;
  }
  return latin;
}
