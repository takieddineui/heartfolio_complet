/**
 * The content section (`/[locale]/guides/[slug]`, 27 Oct 2026; plan in
 * CLAUDE.md, "Still open"). One guide is one topic; each language is its own
 * translation, WRITTEN in that language rather than translated, with its own
 * slug in its own words. A language without a translation simply has no page:
 * hreflang links only the translations that exist.
 */

export type GuideLocale = "en" | "fr" | "ar";

/** The body, as typed blocks rather than Markdown: no parser to trust, and
 *  a product mention is a real link to its page, checked by the guards. */
export type GuideBlock =
  | { type: "h2"; text: string }
  | { type: "p"; text: string }
  | { type: "list"; items: string[] }
  /** A keepsake the section is about: its name, why it fits here (`note`)
   *  and a link to its PRODUCT page (never the Studio). */
  | { type: "product"; product: string; note: string }
  /** The product's REAL capture loop, in the guide's language, in a phone
   *  frame with a caption (`components/guides/guide-capture.tsx`): what the
   *  section describes, actually happening. Every product a translation
   *  shows needs one; the guide's loops together stay within
   *  `GUIDE_VIDEO_BUDGET` (`guides.test.ts`). */
  | { type: "capture"; product: string; caption: string };

export interface GuideTranslation {
  /** In the language's own words: `/<locale>/guides/<slug>`. */
  slug: string;
  /** The H1 and the Article headline. */
  title: string;
  /** The `<title>`, before the layout's " — Heartfolio": at most 47
   *  characters so the rendered title fits 60 (`guides.test.ts`). */
  metaTitle: string;
  /** At most 160 characters. */
  description: string;
  /** YYYY-MM-DD. `updated` is the sitemap's `lastmod`: change it when the
   *  text changes in substance. */
  published: string;
  updated: string;
  /** A draft is reachable on a development server only (for review), and is
   *  never in a production build, the sitemap, the index or a link. */
  status: "draft" | "published";
  intro: string;
  blocks: GuideBlock[];
}

export interface Guide {
  /** Stable, never shown: ties the translations together. */
  id: string;
  /** Every product the guide is about, in order; each must appear in a
   *  `product` block of every translation, and be visible. */
  products: string[];
  translations: Partial<Record<GuideLocale, GuideTranslation>>;
}
