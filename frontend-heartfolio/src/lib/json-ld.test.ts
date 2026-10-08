import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { jsonLdScript } from "./json-ld";

/**
 * ---------------------------------------------------------------------
 * §22 — the one place the frontend writes raw HTML
 * ---------------------------------------------------------------------
 * §22's closing note requires any new customer-facing HTML surface to
 * follow the escaping pattern proven in the `__live__` renderer rather than
 * reinventing one. Structured data is the frontend's only such surface: it
 * must be emitted as text inside a script tag, so React's escaping does not
 * apply.
 */
describe("jsonLdScript", () => {
  it("prevents a value from closing the script tag", () => {
    // `JSON.stringify` alone passes "<" through, so a value containing
    // "</script>" ends the block early and everything after it is parsed as
    // markup. That is script injection, not a rendering quirk.
    const payload = { name: "Nice</script><script>alert(1)</script>" };
    expect(JSON.stringify(payload)).toContain("</script>");
    expect(jsonLdScript(payload)).not.toContain("</script>");
  });

  it("also neutralises an HTML comment opener", () => {
    // "<!--" inside a script block starts a comment state in the HTML
    // tokenizer and can swallow the rest of the document.
    expect(jsonLdScript({ name: "a <!-- b" })).not.toContain("<!--");
  });

  it("still produces valid JSON with the original values intact", () => {
    // The escape is resolved by any JSON parser, so consumers — Google
    // included — read exactly what was passed in.
    const payload = { name: "Timeline <3", nested: { note: "</script>" } };
    expect(JSON.parse(jsonLdScript(payload))).toEqual(payload);
  });

  it("leaves ordinary content untouched", () => {
    expect(JSON.parse(jsonLdScript({ a: "Love Story Timeline" }))).toEqual({
      a: "Love Story Timeline",
    });
  });
});

describe("no raw structured data anywhere (§22)", () => {
  it("never passes JSON.stringify straight into dangerouslySetInnerHTML", () => {
    /**
     * The guard, not the fix. Three pages had this and were corrected; the
     * risk is a fourth being added later by copying one of the originals.
     *
     * It matters more over time, not less: §7c stores customer-written
     * feedback built to be publishable, and publishing reviews puts
     * customer text into product JSON-LD — exactly this position.
     */
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts")) {
          const source = readFileSync(full, "utf8");
          if (/__html:\s*JSON\.stringify/.test(source)) offenders.push(full);
        }
      }
    };
    walk("src");

    expect(offenders).toEqual([]);
  });

  it("keeps the AR scene free of raw HTML injection", () => {
    // §22 names §21's AR pages specifically. They render no text today, so
    // nothing is unescaped — this asserts that stays true rather than
    // relying on someone remembering.
    for (const file of [
      "src/components/ar/ar-scene.tsx",
      "src/app/[locale]/ar/[arId]/page.tsx",
    ]) {
      expect(readFileSync(file, "utf8")).not.toContain("dangerouslySetInnerHTML");
    }
  });
});
