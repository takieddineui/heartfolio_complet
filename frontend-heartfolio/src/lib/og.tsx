import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { WORDMARK } from "@/lib/brand/mark";
import { COLOPHON_DOMAIN } from "@/lib/site-config";

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
  const [display, body, wordmark] = await Promise.all([
    readFile(join(FONT_DIR, displayFile)),
    readFile(join(FONT_DIR, locale === "ar" ? "noto-kufi-600.ttf" : "inter-400.ttf")),
    // The site's wordmark face at the site's weight (`WORDMARK`): a static
    // instance of `public/fonts/fraunces-latin.woff2` at wght 400, made with
    // fontTools' instancer (Satori reads neither WOFF2 nor variable fonts).
    readFile(join(FONT_DIR, "fraunces-400.ttf")),
  ]);

  return [
    { name: "Display", data: display, weight: 600 as const, style: "normal" as const },
    { name: "Body", data: body, weight: 400 as const, style: "normal" as const },
    { name: "Wordmark", data: wordmark, weight: WORDMARK.weight, style: "normal" as const },
  ];
}

/** The site's own mark, `src/app/icon.svg`, as the card draws it. */
let markDataUrl: Promise<string> | null = null;
function siteMarkDataUrl(): Promise<string> {
  markDataUrl ??= readFile(join(process.cwd(), "src/app/icon.svg")).then(
    (svg) => `data:image/svg+xml;base64,${svg.toString("base64")}`
  );
  return markDataUrl;
}

/**
 * A product's capture still (`public/captures`, the real live page with a
 * fictional sample) as a data URL for the card. JPEG: Satori does not decode
 * AVIF. Null for a product without captures.
 */
export async function captureStillDataUrl(productId: string, locale: string): Promise<string | null> {
  const language = locale === "fr" || locale === "ar" ? locale : "en";
  try {
    const bytes = await readFile(join(process.cwd(), "public", "captures", language, `${productId}.jpg`));
    return `data:image/jpeg;base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Phones beside the text: one large for a product, a row for several. */
function OgPhones({ stills }: { stills: string[] }) {
  const height = stills.length === 1 ? 486 : 220;
  const width = Math.round(height * (600 / 1298));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      {stills.map((src, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            padding: 7,
            borderRadius: stills.length === 1 ? 34 : 24,
            background: "#0d1322",
            boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
            marginTop: stills.length > 1 && i % 2 === 1 ? 40 : 0,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders plain <img> only */}
          <img src={src} width={width} height={height} style={{ borderRadius: stills.length === 1 ? 27 : 18 }} alt="" />
        </div>
      ))}
    </div>
  );
}

export async function renderOgImage({
  locale,
  eyebrow,
  title,
  subtitle,
  footnote,
  stills = [],
}: {
  locale: string;
  eyebrow: string;
  title: string;
  subtitle?: string;
  footnote?: string;
  /** Capture stills (`captureStillDataUrl`) shown beside the text: the real
   *  product, not a drawing (26 Oct 2026). */
  stills?: string[];
}) {
  const [fonts, mark] = await Promise.all([loadFonts(locale), siteMarkDataUrl()]);
  const isRtl = locale === "ar";
  const textWidth = stills.length === 0 ? undefined : stills.length === 1 ? 700 : 560;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "56px 72px",
          background:
            "radial-gradient(120% 90% at 15% 100%, rgba(201,162,75,0.16), transparent 60%), linear-gradient(160deg, #141b2e 0%, #1d2540 60%, #141b2e 100%)",
          color: "#f7f1e6",
          fontFamily: "Body",
          direction: isRtl ? "rtl" : "ltr",
          textAlign: isRtl ? "right" : "left",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%", width: textWidth ?? "100%" }}>
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
              fontSize: stills.length > 1 ? 50 : title.length > 34 ? 60 : 72,
              lineHeight: 1.1,
              color: "#f7f1e6",
            }}
          >
            {title}
          </div>
          {subtitle ? (
            <div style={{ display: "block", fontSize: stills.length > 1 ? 24 : 30, lineHeight: 1.4, color: "rgba(247,241,230,0.72)", maxWidth: 900, lineClamp: 3 }}>
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
          {/* The site's lockup (`lib/brand/mark.ts`): its own mark from
              `icon.svg`, 1.4x the word and 0.5em from it, then "Heartfolio" in
              the wordmark face and tracking, then the address (`COLOPHON`). */}
          <div style={{ display: "flex", alignItems: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- Satori draws <img>, not next/image. */}
            <img src={mark} width={Math.round(24 * WORDMARK.markToTextRatio)} height={Math.round(24 * WORDMARK.markToTextRatio)} alt="" />
            <span
              style={{
                fontFamily: "Wordmark",
                fontWeight: WORDMARK.weight,
                letterSpacing: `${WORDMARK.trackingEm}em`,
                color: "#f7f1e6",
                marginLeft: Math.round(24 * WORDMARK.gapEm),
              }}
            >
              {WORDMARK.text}
            </span>
            <span style={{ fontFamily: "Body", fontSize: 20, marginLeft: 12 }}>· {COLOPHON_DOMAIN}</span>
          </div>
          <div style={{ display: "flex" }}>{footnote ?? ""}</div>
        </div>
        </div>
        {stills.length > 0 ? <OgPhones stills={stills} /> : null}
      </div>
    ),
    { ...OG_SIZE, fonts }
  );
}
