import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { backendRoot } from "../../test/backend-root";
import { fontCodePoints } from "../../test/font-cmap";
import { COLOPHON, COLOPHON_DOMAIN } from "./site-config";

/**
 * The colophon (owner, 27 Oct 2026): every deliverable carries
 * "Heartfolio · theheartfolio.com". The prints, QR cards, PDFs and the
 * receipt email draw `PRINT_MARK` from the backend's `attribution.py`; the
 * share cards and the live pages draw `COLOPHON` from here. One wording.
 */
describe("the colophon", () => {
  it("is the backend's PRINT_MARK, word for word", () => {
    const source = readFileSync(join(backendRoot(), "apps/delivery/attribution.py"), "utf8");
    const domain = /^SITE_DOMAIN = "([^"]+)"/m.exec(source)?.[1];
    expect(domain).toBe(COLOPHON_DOMAIN);
    expect(source).toMatch(/^PRINT_MARK = f"Heartfolio (\u00b7|·) \{SITE_DOMAIN\}"/m);
    expect(COLOPHON).toBe("Heartfolio · theheartfolio.com");
  });

  it("is drawn on the share cards in faces that have every character of it", () => {
    const dir = join(process.cwd(), "src/assets/og-fonts");
    for (const [file, text] of [["fraunces-600.ttf", "Heartfolio"], ["inter-400.ttf", `· ${COLOPHON_DOMAIN}`]] as const) {
      const covered = fontCodePoints(join(dir, file));
      const missing = [...text].filter((ch) => ch !== " " && !covered.has(ch.codePointAt(0)!));
      expect(missing, file).toEqual([]);
    }
  });
});
