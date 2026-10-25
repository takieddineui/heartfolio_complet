import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE RECEIPT NAMES A PRODUCT AS THE STOREFRONT DOES (25 Oct 2026). The
 * receipt email is now in the order's language, and the backend keeps its
 * own copy of each product's name per language
 * (`backend/apps/commerce/email_copy.py`, `PRODUCT_NAMES`). This reads that
 * table and fails if any name differs from `Products.<key>.name` in this
 * locale's message file. Lives here because the frontend tests can read the
 * backend (as the parity tests do), not the other way round.
 */
function backendRoot(): string {
  const configured = process.env.HEARTFOLIO_BACKEND_PATH;
  const candidates = [
    ...(configured ? [isAbsolute(configured) ? configured : join(process.cwd(), configured)] : []),
    join(process.cwd(), "..", "backend"),
    join(process.cwd(), "..", "..", "backend", "backend"),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "apps", "commerce", "email_copy.py"))) return candidate;
  }
  throw new Error(`Cannot locate the Django backend. Set HEARTFOLIO_BACKEND_PATH. Tried: ${candidates.join(" | ")}`);
}

const source = readFileSync(join(backendRoot(), "apps", "commerce", "email_copy.py"), "utf8");
const table = source.slice(source.indexOf("PRODUCT_NAMES = {"), source.indexOf("\n}\n", source.indexOf("PRODUCT_NAMES = {")));
const NAMES = Object.fromEntries(
  [...table.matchAll(/"(\w+)": \{"en": "([^"]+)", "fr": "([^"]+)", "ar": "([^"]+)"\}/g)].map((m) => [
    m[1]!,
    { en: m[2]!, fr: m[3]!, ar: m[4]! },
  ])
) as Record<string, Record<"en" | "fr" | "ar", string>>;

const MESSAGES = Object.fromEntries(
  (["en", "fr", "ar"] as const).map((locale) => [locale, JSON.parse(readFileSync(`src/messages/${locale}.json`, "utf8"))])
) as Record<"en" | "fr" | "ar", { Products: Record<string, { name: string }> }>;

describe("the receipt's product names", () => {
  it("reads every product from the backend's table", () => {
    expect(Object.keys(NAMES).sort()).toEqual(
      ["graduationKeepsake", "loveStoryTimeline", "reasonsILoveYou", "songPoster", "whereWeMet"].sort()
    );
  });

  it.each(["en", "fr", "ar"] as const)("%s: each matches the storefront's name", (locale) => {
    for (const [key, names] of Object.entries(NAMES)) {
      expect(names[locale], key).toBe(MESSAGES[locale].Products[key]!.name);
    }
  });
});
