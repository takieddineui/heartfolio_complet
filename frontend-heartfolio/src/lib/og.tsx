import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * ---------------------------------------------------------------------
 * OPEN GRAPH IMAGES (§32)
 * ---------------------------------------------------------------------
 * Every page previously pointed at `/og-image.png`, which does not exist
 * in this repository — so every share, every WhatsApp preview and every
 * Slack unfurl of a Heartfolio link showed a broken or blank card.
 *
 * These are generated at build time instead of waiting on artwork:
 * each product page gets a card carrying its own name, its own line and
 * its own starting price, in the brand's colours and typeface. Localised,
 * so an Arabic link shares an Arabic card.
 *
 * They are a real answer, not a permanent one — the brief asks for
 * per-product photography eventually. When that exists, drop the file in
 * and point `ogImage` in the registry at it; these routes then only serve
 * whatever has no photograph yet.
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const FONT_DIR = join(process.cwd(), "src/assets/og-fonts");

/**
 * ⚠️ ARABIC: the renderer behind `next/og` (satori) does not do Arabic
 * shaping or bidirectional reordering. Rendering Arabic through it
 * produces letters in their isolated forms, in the wrong visual order —
 * I generated one and looked at it, and it is unreadable, not merely
 * imperfect.
 *
 * So Arabic pages share the ENGLISH card for the same product: correct
 * brand, correct product, correct price, in Latin script. A card in the
 * wrong language is a small cost; a card that looks like broken Arabic to
 * an Arabic reader is a much larger one.
 *
 * To fix properly, generate Arabic cards from a real text engine
 * (headless browser screenshot, or Resvg with a shaped SVG) and point
 * `ogImage` in the registry at the results.
 */
export function ogTextLocale(locale: string) {
  return locale === "ar" ? "en" : locale;
}

async function loadFonts(locale: string) {
  // Arabic is not covered by the Latin faces — without its own font the
  // card renders as empty boxes, which is worse than no card at all.
  const displayFile = locale === "ar" ? "noto-kufi-600.ttf" : "fraunces-600.ttf";
  const [display, body] = await Promise.all([
    readFile(join(FONT_DIR, displayFile)),
    readFile(join(FONT_DIR, locale === "ar" ? "noto-kufi-600.ttf" : "inter-400.ttf")),
  ]);

  return [
    { name: "Display", data: display, weight: 600 as const, style: "normal" as const },
    { name: "Body", data: body, weight: 400 as const, style: "normal" as const },
  ];
}

export async function renderOgImage({
  locale,
  eyebrow,
  title,
  subtitle,
  footnote,
}: {
  locale: string;
  eyebrow: string;
  title: string;
  subtitle?: string;
  footnote?: string;
}) {
  const fonts = await loadFonts(locale);
  const isRtl = locale === "ar";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background:
            "radial-gradient(120% 90% at 15% 100%, rgba(201,162,75,0.16), transparent 60%), linear-gradient(160deg, #141b2e 0%, #1d2540 60%, #141b2e 100%)",
          color: "#f7f1e6",
          fontFamily: "Body",
          direction: isRtl ? "rtl" : "ltr",
          textAlign: isRtl ? "right" : "left",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 24,
              letterSpacing: isRtl ? 0 : 4,
              textTransform: isRtl ? "none" : "uppercase",
              color: "#c9a24b",
            }}
          >
            {eyebrow}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              fontFamily: "Display",
              fontSize: title.length > 34 ? 64 : 78,
              lineHeight: 1.1,
              color: "#f7f1e6",
            }}
          >
            {title}
          </div>
          {subtitle ? (
            <div style={{ fontSize: 30, lineHeight: 1.4, color: "rgba(247,241,230,0.72)", maxWidth: 900 }}>
              {subtitle}
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 24,
            color: "rgba(247,241,230,0.6)",
          }}
        >
          {/* Wordmark only — the ♥ from the site's logotype is not in the
              subsetted font and renders as nothing, so it is left out here
              rather than shipped as an invisible glyph. */}
          <div style={{ display: "flex", fontFamily: "Display", color: "#f7f1e6" }}>Heartfolio</div>
          <div style={{ display: "flex" }}>{footnote ?? ""}</div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts }
  );
}
