// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import sitemap from "@/app/sitemap";
import { routing } from "@/i18n/routing";
import { getAllProducts } from "@/lib/products/registry";
import { SITE_URL } from "@/lib/site-config";
import { GUIDES, GUIDE_VIDEO_BUDGET, featuredGuides, findGuide, guideCovers, guideAlternates, guideIndexLocales, guidesIn, moreGuides } from "./registry";
import { getProductCaptures } from "@/lib/captures/manifest";
import { typeset } from "./typeset";
import { GUIDE_INDEX_LOCALES } from "./published-locales";
import type { GuideLocale, GuideTranslation } from "./types";

/**
 * THE CONTENT SECTION'S RULES (27 Oct 2026; plan in CLAUDE.md). Every guide
 * and every translation is checked, drafts included, so a draft is ready the
 * day it is published.
 */
const translations = GUIDES.flatMap((guide) =>
  (Object.entries(guide.translations) as [GuideLocale, GuideTranslation][]).map(([locale, translation]) => ({ guide, locale, translation }))
);
const label = (row: (typeof translations)[number]) => `${row.guide.id}/${row.locale}`;
const visible = new Set(getAllProducts().map((product) => product.id));
const TITLE_SUFFIX: Record<string, string> = { en: " — Heartfolio", fr: " — Heartfolio", ar: " — هارتفوليو" };
const allText = (t: GuideTranslation) =>
  [t.title, t.description, t.intro, ...t.blocks.flatMap(blockText)].join("\n");
function blockText(b: GuideTranslation["blocks"][number]): string[] {
  if (b.type === "list") return b.items;
  if (b.type === "product") return [b.note];
  if (b.type === "capture") return [b.caption];
  return [b.text];
}

afterEach(() => vi.unstubAllEnvs());

describe("every guide", () => {
  it("has a unique id, at least one translation, and only visible products", () => {
    expect(new Set(GUIDES.map((g) => g.id)).size).toBe(GUIDES.length);
    for (const guide of GUIDES) {
      expect(Object.keys(guide.translations).length, guide.id).toBeGreaterThan(0);
      expect(guide.products.length, guide.id).toBeGreaterThan(0);
      for (const product of guide.products) expect(visible.has(product), `${guide.id} links ${product}`).toBe(true);
    }
  });

  it.each(translations.map((row) => [label(row), row] as const))("%s: fits a search result, dates and slug in order", (_, { locale, translation }) => {
    expect((translation.metaTitle + TITLE_SUFFIX[locale]).length).toBeLessThanOrEqual(60);
    expect(translation.description.length).toBeLessThanOrEqual(160);
    expect(translation.description.length).toBeGreaterThanOrEqual(50);
    expect(translation.title.length).toBeLessThanOrEqual(110);
    expect(translation.slug).toMatch(/^[\p{Ll}\p{Lo}\p{N}]+(-[\p{Ll}\p{Lo}\p{N}]+)*$/u);
    const today = new Date().toISOString().slice(0, 10);
    for (const date of [translation.published, translation.updated]) expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(translation.published <= translation.updated).toBe(true);
    expect(translation.updated <= today).toBe(true);
    expect(["draft", "published"]).toContain(translation.status);
  });

  it.each(translations.map((row) => [label(row), row] as const))("%s: shows every product it is about, and only those", (_, { guide, translation }) => {
    const shown = translation.blocks.flatMap((b) => (b.type === "product" ? [b.product] : []));
    expect([...new Set(shown)].sort()).toEqual([...guide.products].sort());
    expect(translation.blocks.filter((b) => b.type === "h2").length).toBeGreaterThanOrEqual(2);
  });

  it.each(translations.map((row) => [label(row), row] as const))("%s: shows every product it leads to, as a real capture in its own language", (_, { locale, translation }) => {
    const leadsTo = new Set(translation.blocks.flatMap((b) => (b.type === "product" ? [b.product] : [])));
    const captured = translation.blocks.flatMap((b) => (b.type === "capture" ? [b] : []));
    expect(new Set(captured.map((b) => b.product))).toEqual(leadsTo);
    for (const block of captured) {
      const captures = getProductCaptures(block.product, locale);
      expect(captures?.loop && captures.poster, `${block.product} captured in ${locale}`).toBeTruthy();
      expect(block.caption.length, `${block.product}: a short caption`).toBeGreaterThan(10);
      expect(block.caption.length).toBeLessThanOrEqual(140);
    }
  });

  it.each(translations.map((row) => [label(row), row] as const))("%s: its loops stay within the guide's video budget", (_, { locale, translation }) => {
    const loops = translation.blocks.flatMap((b) => (b.type === "capture" ? [getProductCaptures(b.product, locale)!.loop!] : []));
    expect(loops.length).toBeLessThanOrEqual(GUIDE_VIDEO_BUDGET.loops);
    expect(loops.reduce((sum, loop) => sum + loop.bytes, 0)).toBeLessThanOrEqual(GUIDE_VIDEO_BUDGET.bytes);
  });

  it.each(translations.map((row) => [label(row), row] as const))("%s: quotes no price (it would go stale)", (_, { translation }) => {
    expect(allText(translation)).not.toMatch(/[$€£]\s?\d|\d\s?(USD|EUR|€)|\b\d+[.,]\d{2}\b/);
  });

  it("slugs are unique within each language", () => {
    for (const locale of routing.locales) {
      const slugs = translations.filter((row) => row.locale === locale).map((row) => row.translation.slug);
      expect(new Set(slugs).size, locale).toBe(slugs.length);
    }
  });
});

describe("drafts and publishing", () => {
  it("a production build never shows a draft: not routed, not listed, not in the sitemap", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const { locale, translation } of translations.filter((row) => row.translation.status === "draft")) {
      expect(findGuide(locale, translation.slug), translation.slug).toBeNull();
      expect(guidesIn(locale).map((g) => g.translation.slug)).not.toContain(translation.slug);
      expect(sitemap().map((e) => e.url)).not.toContain(`${SITE_URL}/${locale}/guides/${translation.slug}`);
    }
  });

  it("a development server shows drafts, for review", () => {
    vi.stubEnv("NODE_ENV", "development");
    for (const { locale, translation } of translations) expect(findGuide(locale, translation.slug)).not.toBeNull();
  });

  it("a slug from another language is not found (each language has its own words)", () => {
    for (const { guide, locale, translation } of translations) {
      for (const other of routing.locales.filter((l) => l !== locale) as GuideLocale[]) {
        // Found only if that language's OWN translation happens to share it.
        const found = findGuide(other, translation.slug);
        expect(found === null || found.translation === guide.translations[other], `${translation.slug} on /${other}`).toBe(true);
      }
    }
  });

  it("the footer's list of languages with guides matches the published guides", () => {
    expect([...GUIDE_INDEX_LOCALES].sort()).toEqual([...guideIndexLocales()].sort());
  });
});

describe("hreflang and the sitemap", () => {
  it("links only the translations that are published, x-default only when English is", () => {
    for (const { guide, locale, translation } of translations) {
      const alternates = guideAlternates(guide, locale);
      expect(alternates.canonical).toBe(`${SITE_URL}/${locale}/guides/${translation.slug}`);
      const published = (Object.entries(guide.translations) as [string, GuideTranslation][]).filter(([, t]) => t.status === "published");
      const expected = Object.fromEntries(published.map(([l, t]) => [l, `${SITE_URL}/${l}/guides/${t.slug}`]));
      if (expected.en) expected["x-default"] = expected.en;
      expect(alternates.languages).toEqual(expected);
    }
  });

  it("lists every published translation, dated by its own `updated`, and its language's index", () => {
    const entries = sitemap();
    for (const { guide, locale, translation } of translations.filter((row) => row.translation.status === "published")) {
      const entry = entries.find((e) => e.url === `${SITE_URL}/${locale}/guides/${translation.slug}`);
      expect(entry, translation.slug).toBeDefined();
      expect(String(entry!.lastModified)).toBe(`${translation.updated}T00:00:00.000Z`);
      expect(entry!.alternates?.languages).toEqual(guideAlternates(guide, locale).languages);
      expect(entries.some((e) => e.url === `${SITE_URL}/${locale}/guides`)).toBe(true);
    }
    // No index for a language without a published guide.
    for (const locale of routing.locales.filter((l) => !guideIndexLocales().includes(l as GuideLocale))) {
      expect(entries.some((e) => e.url === `${SITE_URL}/${locale}/guides`), locale).toBe(false);
    }
  });
});

describe("the routes", () => {
  const APP = "src/app/[locale]/guides";
  it("answer a real 404 for anything they do not know: no loading skeleton above them", () => {
    for (const dir of [APP, `${APP}/[slug]`]) expect(existsSync(`${dir}/loading.tsx`), dir).toBe(false);
    expect(readFileSync(`${APP}/[slug]/page.tsx`, "utf8")).toMatch(/if \(!found\) notFound\(\);/);
    expect(readFileSync(`${APP}/page.tsx`, "utf8")).toMatch(/if \(guides\.length === 0\) notFound\(\);/);
  });

  it("embed captures with the home page's loop: on screen only, never preloaded, pausable, stills under reduced motion", () => {
    // The rules themselves are pinned on CaptureLoop (capture-media.test.tsx).
    const block = readFileSync("src/components/guides/guide-capture.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(block).toContain("<CaptureLoop captures={captures}");
    expect(block).toContain('mode="inView"');
    expect(block).not.toMatch(/<video|autoPlay|preload=/);
  });

  it("carry Article and breadcrumb structured data, and link products to their pages, never the Studio", () => {
    const page = readFileSync(`${APP}/[slug]/page.tsx`, "utf8");
    expect(page).toContain('"@type": "Article"');
    expect(page).toContain('"@type": "BreadcrumbList"');
    // The index shares the site's card (it has none of its own).
    expect(readFileSync(`${APP}/page.tsx`, "utf8")).toContain("...pageShareMetadata(locale, \"/guides\"");
    const article = readFileSync("src/components/guides/guide-article.tsx", "utf8");
    expect(article).toContain("href={`/products/${product.slug}`}");
    expect(article).not.toMatch(/\/studio/);
  });
});

describe("French typography", () => {
  it("keeps the space before : ; ? ! and inside guillemets from breaking, in French only", () => {
    const NBSP = "\u00A0";
    const NARROW = "\u202F";
    expect(typeset("Bonjour : « oui » ; non ? si !", "fr")).toBe(`Bonjour${NBSP}: «${NBSP}oui${NBSP}»${NARROW}; non${NARROW}? si${NARROW}!`);
    expect(typeset("Hello: yes? no!", "en")).toBe("Hello: yes? no!");
  });
});

/**
 * WHERE THE GUIDES ARE SURFACED (27 Oct 2026): the header's "Gift ideas"
 * link, the home page's "Need ideas?" and a guide's "More ideas". Published
 * guides only, appearing in a language as soon as it has one.
 */
describe("guides surfaced on other pages", () => {
  it("only published guides, at most three on the home page, never the guide being read", () => {
    vi.stubEnv("NODE_ENV", "development"); // drafts would be visible here
    for (const locale of routing.locales) {
      const published = guidesIn(locale, { includeDrafts: false }).map((g) => g.guide.id);
      const featured = featuredGuides(locale).map((g) => g.guide.id);
      expect(featured.length).toBeLessThanOrEqual(3);
      for (const id of featured) expect(published).toContain(id);
      for (const id of published) {
        const others = moreGuides(id, locale).map((g) => g.guide.id);
        expect(others).not.toContain(id);
        expect(others.sort()).toEqual(published.filter((p) => p !== id).sort());
      }
    }
  });

  it("nothing at all in a language without a published guide", () => {
    for (const locale of routing.locales.filter((l) => !guideIndexLocales().includes(l as GuideLocale))) {
      expect(featuredGuides(locale), locale).toEqual([]);
    }
  });

  it("each surface hides itself when there is nothing to show", () => {
    const header = readFileSync("src/components/layout/header.tsx", "utf8");
    expect(header).toMatch(/GUIDE_INDEX_LOCALES\.includes\(locale\) \? \[\{ label: t\("guides"\), href: "\/guides" \}\] : \[\]/);
    expect(readFileSync("src/components/sections/need-ideas.tsx", "utf8")).toContain("if (guides.length === 0) return null;");
    expect(readFileSync("src/app/[locale]/guides/[slug]/page.tsx", "utf8")).toContain("{more.length > 0 && (");
    const home = readFileSync("src/app/[locale]/(home)/page.tsx", "utf8");
    expect(home.indexOf("<NeedIdeas locale={locale} />")).toBeGreaterThan(0);
    expect(home.indexOf("<NeedIdeas")).toBeLessThan(home.indexOf("<Faq />"));
  });
});

describe("guide covers on the home page", () => {
  it("a different keepsake for each guide where the guides allow it, always one the guide is about", () => {
    const covers = guideCovers(GUIDES.map((guide) => ({ guide })));
    for (const guide of GUIDES) expect(guide.products).toContain(covers.get(guide.id));
    const distinctPossible = new Set(GUIDES.flatMap((g) => g.products)).size >= GUIDES.length;
    if (distinctPossible) expect(new Set(covers.values()).size).toBe(GUIDES.length);
  });
});
