import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HTML_LIMITED_BOTS, NEXT_DEFAULT_HTML_LIMITED_BOTS } from "./html-limited-bots";

/**
 * Pinterest reads `p:domain_verify` from the <head>. Next streams a dynamic
 * page's metadata into the body unless the crawler is "HTML-limited", so
 * Pinterest is added to that list (31 Oct 2026). The option replaces Next's
 * own list: this fails if Next's default changes and ours stops matching it.
 */
describe("crawlers that get metadata in the head", () => {
  it("is Next's own list, unchanged, plus Pinterest", () => {
    const source = readFileSync(join(process.cwd(), "node_modules/next/dist/shared/lib/router/utils/html-bots.js"), "utf8");
    const nextDefault = /HTML_LIMITED_BOT_UA_RE = \/(.+)\/i/.exec(source)?.[1];
    expect(nextDefault).toBe(NEXT_DEFAULT_HTML_LIMITED_BOTS);
    expect(HTML_LIMITED_BOTS.flags).toContain("i");
  });

  it("matches Pinterest's crawlers and the others, not a browser", () => {
    for (const ua of ["Pinterest/0.2 (+https://www.pinterest.com/bot.html)", "Pinterestbot/1.0", "Twitterbot/1.0", "facebookexternalhit/1.1"]) {
      expect(HTML_LIMITED_BOTS.test(ua), ua).toBe(true);
    }
    expect(HTML_LIMITED_BOTS.test("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1")).toBe(false);
  });

  it("next.config uses it", () => {
    expect(readFileSync(join(process.cwd(), "next.config.ts"), "utf8")).toContain("htmlLimitedBots: HTML_LIMITED_BOTS");
  });
});
