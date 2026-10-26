import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import ar from "./ar.json";
import en from "./en.json";
import fr from "./fr.json";

/**
 * ---------------------------------------------------------------------
 * COMMERCIAL TRUTH DOES NOT LIVE IN THE COPY (§13)
 * ---------------------------------------------------------------------
 * Every meta description used to end in "From $12 USD" — 22 strings across
 * three locales, quoting a figure that was already wrong (the cheapest live
 * pack is $8) and that no deploy would have corrected, because nothing
 * connected that number to the catalog.
 *
 * These tests exist because that class of bug is silent. A hardcoded price
 * renders perfectly, reads plausibly, and is only ever caught by someone
 * comparing a Google result against a checkout page. So the rule is
 * asserted mechanically instead: prices arrive through `{price}`, or the
 * string does not mention one.
 */

const LOCALES = { en, fr, ar } as const;

/** Any currency figure written directly into copy: "$12", "12 USD", "$8 USD". */
const HARDCODED_PRICE = /\$\s?\d|\d+\s?(USD|\$)/;

/**
 * "Prices are shown in USD" is a currency statement, not a price. It names
 * no amount, so it cannot go stale and is deliberately exempt.
 */
const CURRENCY_ONLY_KEYS = [
  "Footer.pricesNote",
  "ProductPage.offerings.note",
  "Legal.terms",
];

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function flatten(value: Json, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((item, i) => flatten(item, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      flatten(child as Json, path ? `${path}.${key}` : key)
    );
  }
  return [];
}

describe.each(Object.entries(LOCALES))("%s messages", (locale, messages) => {
  const entries = flatten(messages as unknown as Json);

  it("never writes a price into the copy", () => {
    const offenders = entries.filter(
      ([path, text]) =>
        HARDCODED_PRICE.test(text) && !CURRENCY_ONLY_KEYS.some((k) => path.startsWith(k))
    );

    expect(offenders.map(([path]) => path)).toEqual([]);
  });

  it("pairs every priced description with a price-free fallback", () => {
    // A cold-start outage leaves no price to interpolate. Without the
    // sibling key the page would either render the literal "{price}" or
    // fall back to a description that silently claims a price it does not
    // have — both worse than simply not quoting one.
    const priced = entries.filter(([path, text]) => path.endsWith(".description") && text.includes("{price}"));
    expect(priced.length).toBeGreaterThan(0);

    const byPath = new Map(entries);
    for (const [path] of priced) {
      const fallback = path.replace(/\.description$/, ".descriptionNoPrice");
      expect(byPath.get(fallback), `${locale}: missing ${fallback}`).toBeTruthy();
      expect(byPath.get(fallback)).not.toContain("{price}");
    }
  });

  it("keeps the active product's description priced", () => {
    // Guards against the fallback quietly becoming the only variant — which
    // would technically pass the rule above while losing the feature.
    const byPath = new Map(entries);
    expect(byPath.get("Products.loveStoryTimeline.meta.description")).toContain("{price}");
    expect(byPath.get("Collection.meta.description")).toContain("{price}");
  });
});

describe("page titles carry the brand once", () => {
  /**
   * The layout's title template appends " — Heartfolio" (" — هارتفوليو" on
   * /ar). Titles that also ended in "| Heartfolio" read "… | Heartfolio —
   * Heartfolio" in every tab and search result (25 Oct 2026).
   */
  it.each(Object.entries(LOCALES))("%s: no title ends with the brand", (_locale, messages) => {
    const branded = flatten(messages as unknown as Json).filter(
      ([path, text]) => path.endsWith(".title") && /(\||—|–|-)\s*(Heartfolio|هارتفوليو)\s*$/.test(text)
    );
    expect(branded.map(([path]) => path)).toEqual([]);
  });
});

describe("one name per product", () => {
  /**
   * French called Song Poster "Affiche musicale" on its card and "Affiche de
   * chanson" in its page title, and Love Story Timeline "Chronologie…" on its
   * card and receipt but "Frise…" everywhere else (fixed 26 Oct 2026). The
   * page title must use the product's own name. Arabic is left out: a name
   * like ملصق الأغنية takes its indefinite form (ملصق أغنية مخصّص) once
   * "personalized" follows, so the words legitimately differ.
   */
  it.each([["en", en], ["fr", fr]] as const)("%s: each product's page title uses its name", (_locale, messages) => {
    const products = messages.Products as unknown as Record<string, { name?: string; meta?: { title?: string } }>;
    const mismatched = Object.entries(products)
      .filter(([, p]) => p.name && p.meta?.title)
      .filter(([, p]) => !p.meta!.title!.toLowerCase().includes(p.name!.toLowerCase()))
      .map(([key, p]) => `${key}: "${p.name}" / "${p.meta!.title}"`);
    expect(mismatched).toEqual([]);
  });
});

describe("no wallpaper promise outside the pack labels", () => {
  /**
   * Wallpapers are not sold (every wallpaper pack is disabled, and the add-on
   * checkbox is hidden by `SHOW_WALLPAPER_ADDON`), yet the home page, the
   * pricing card and llms.txt promised them until 26 Oct 2026. Only the
   * labels a wallpaper pack would need if it were switched back on may
   * mention one.
   */
  const PACK_LABELS = [
    "Products.offerings.",
    "ProductPage.offerings.wallpaperAddon",
    "ProductPage.offeringDetails.wallpaperFiles",
  ];
  const WALLPAPER = /wallpaper|fonds? d['’]écran|خلفي/i;

  it.each(Object.entries(LOCALES))("%s", (_locale, messages) => {
    const offenders = flatten(messages as unknown as Json).filter(
      ([path, text]) => WALLPAPER.test(text) && !PACK_LABELS.some((p) => path.startsWith(p))
    );
    expect(offenders.map(([path]) => path)).toEqual([]);
  });
});

describe("locale parity", () => {
  it("gives every locale the same set of keys", () => {
    const keysFor = (m: unknown) => flatten(m as Json).map(([path]) => path).sort();
    const base = keysFor(en);
    expect(keysFor(fr)).toEqual(base);
    expect(keysFor(ar)).toEqual(base);
  });
});

/**
 * ---------------------------------------------------------------------
 * A PLACEHOLDER IS A CONTRACT WITH EVERY CALL SITE (§13, §29)
 * ---------------------------------------------------------------------
 * Turning `meta.description` into a `{price}` template silently broke a
 * caller that had no reason to change: the `Product` JSON-LD was still
 * calling `t("meta.description")` with no values. next-intl does not throw
 * for a missing interpolation value — it logs and returns the key path — so
 * the page would have rendered, the build would have passed, and Google
 * would have been served the literal string
 * "Products.loveStoryTimeline.meta.description" as the product description.
 *
 * Nothing about that failure is visible to a human reading the page, which
 * is exactly why it needs a test rather than a review.
 */
describe("parameterized messages", () => {
  it("formats a price into the description instead of returning the key", () => {
    // Typed loosely on purpose: next-intl infers message shapes from the
    // project's own messages, and this test exists to check runtime
    // formatting, not the generated types.
    const t = createTranslator({
      locale: "en",
      messages: en,
      namespace: "Products.loveStoryTimeline",
    } as Parameters<typeof createTranslator>[0]) as (
      key: string,
      values?: Record<string, string>
    ) => string;

    const withPrice = t("meta.description", { price: "$8 USD" });
    expect(withPrice).toContain("$8 USD");
    expect(withPrice).not.toContain("{price}");
    expect(withPrice).not.toContain("meta.description");
  });

  it("has no call site invoking a templated key with no values", () => {
    // `meta.description` exists in several namespaces and is only templated
    // in two of them — the per-product blocks and Collection. The legal
    // pages have their own untemplated `meta.description` and are correctly
    // left alone, so the scan is scoped by which namespace a file opens
    // rather than by the leaf key on its own.
    const TEMPLATED_NAMESPACES = ['namespace: `Products.${', 'namespace: "Collection"'];

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts")) files.push(full);
      }
    };
    walk("src");

    const offenders: string[] = [];
    for (const file of files) {
      // Comments are stripped first: the routes explain this exact hazard in
      // prose, and a scan that matched its own warning would be useless.
      const source = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      if (!TEMPLATED_NAMESPACES.some((ns) => source.includes(ns))) continue;
      // `t("meta.description")` — closing paren immediately after the key,
      // i.e. no values object passed.
      if (source.includes('t("meta.description")')) {
        offenders.push(`${file} -> bare t("meta.description")`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
