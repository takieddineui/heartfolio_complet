import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORT_EMAIL } from "./site-config";

/**
 * THE SUPPORT ADDRESS IS THE DOMAIN'S (19 Oct 2026, before launch). It was
 * heartfolioapp@gmail.com through development; the footer, the legal pages and
 * the JSON-LD all read `SUPPORT_EMAIL`, so this pins it and makes sure no copy
 * or component writes an address of its own.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(tsx?|json|txt|md)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("the support address", () => {
  it("is support@theheartfolio.com", () => {
    expect(SUPPORT_EMAIL).toBe("support@theheartfolio.com");
  });

  it("is written nowhere else: no Gmail address in the source, the copy or public files", () => {
    const offenders = [...files("src"), ...files("public")].filter((file) => /@gmail\.com/i.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
