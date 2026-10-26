import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/**
 * "Cookie settings" (26 Oct 2026): the footer reopens the cookie question,
 * and a "No thanks" after an earlier "Allow" really withdraws. Before, the
 * only way to change the answer was to clear the site's data, and nothing
 * stopped a GA that had already loaded.
 */
const GA_ID = "G-TEST123";

async function load() {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_GA_ID", GA_ID);
  return import("./analytics");
}

function clearCookies() {
  for (const pair of document.cookie.split(";")) {
    const name = (pair.split("=")[0] ?? "").trim();
    if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  }
}

/** Node's own `localStorage` global (undefined without a storage file)
 *  shadows jsdom's here, so the test brings a plain one. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}

describe("changing the cookie choice", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
    clearCookies();
    delete (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`];
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reopens the question: the stored answer is forgotten and listeners hear it", async () => {
    const { readConsent, reopenConsent, writeConsent } = await load();
    writeConsent("granted");
    expect(readConsent()).toBe("granted");

    const heard = vi.fn();
    window.addEventListener("heartfolio-consent", heard);
    reopenConsent();
    window.removeEventListener("heartfolio-consent", heard);

    expect(readConsent()).toBe("undecided");
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("withdraws a grant: GA's opt-out flag, a consent update, and its cookies gone", async () => {
    const { writeConsent } = await load();
    writeConsent("granted");
    document.cookie = "_ga=GA1.1.123.456;path=/";
    document.cookie = `_ga_${GA_ID.slice(2)}=GS1.1.789;path=/`;
    document.cookie = "theme=dark;path=/";
    const gtag = vi.fn();
    (window as unknown as { gtag: unknown }).gtag = gtag;

    writeConsent("denied");

    expect((window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`]).toBe(true);
    expect(gtag).toHaveBeenCalledWith("consent", "update", { analytics_storage: "denied" });
    expect(document.cookie).not.toMatch(/_ga/);
    expect(document.cookie).toContain("theme=dark");
    delete (window as unknown as { gtag?: unknown }).gtag;
  });

  it("names every domain GA may have set its cookies on", async () => {
    // GA writes to the widest domain it can (`.theheartfolio.com` from
    // `www.theheartfolio.com`); a deletion that names only the host leaves it.
    const { cookieDomainAttributes } = await load();
    expect(cookieDomainAttributes("www.theheartfolio.com")).toEqual([
      "",
      ";domain=www.theheartfolio.com",
      ";domain=.www.theheartfolio.com",
      ";domain=theheartfolio.com",
      ";domain=.theheartfolio.com",
    ]);
    expect(cookieDomainAttributes("localhost")).toEqual([""]);
  });

  it("lifts the opt-out when the visitor allows again", async () => {
    const { writeConsent } = await load();
    writeConsent("denied");
    writeConsent("granted");
    expect((window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`]).toBe(false);
  });
});

describe("the footer offers it", () => {
  it("has a Cookie settings button wired to reopenConsent", () => {
    const footer = readFileSync("src/components/layout/footer.tsx", "utf8");
    expect(footer).toContain("onClick={reopenConsent}");
    expect(footer).toContain('t("legal.cookieSettings")');
  });
});
