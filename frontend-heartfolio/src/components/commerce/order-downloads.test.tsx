import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const download = vi.hoisted(() => ({ pack: vi.fn(), category: vi.fn() }));

vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/lib/api/delivery", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/delivery")>("@/lib/api/delivery");
  return {
    ...actual,
    downloadOrderPack: download.pack,
    downloadOrderCategory: download.category,
  };
});

import { DownloadIncompleteError } from "@/lib/api/delivery";
import { OrderDownloads } from "./order-downloads";

const entitlements = [
  { id: "e1", orderId: "o1", productId: "p1", targetId: "print-a4-frameless", createdAt: "2026-01-01T00:00:00Z" },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OrderDownloads — truncated archives", () => {
  it("tells the customer the download didn't finish and nothing was saved, rather than that it never started", async () => {
    download.pack.mockRejectedValue(new DownloadIncompleteError());
    render(<OrderDownloads orderId="o1" entitlements={entitlements} />);

    fireEvent.click(screen.getByRole("button", { name: /download your keepsake/i }));

    expect(await screen.findByText(/didn't finish, so nothing was saved/i)).toBeTruthy();
    expect(screen.queryByText(/didn't start/i)).toBeNull();
  });

  it("keeps the generic message for any other failure", async () => {
    download.pack.mockRejectedValue(new TypeError("network error"));
    render(<OrderDownloads orderId="o1" entitlements={entitlements} />);

    fireEvent.click(screen.getByRole("button", { name: /download your keepsake/i }));

    expect(await screen.findByText(/didn't start/i)).toBeTruthy();
  });

  it("lets the customer retry straight away", async () => {
    download.pack.mockRejectedValueOnce(new DownloadIncompleteError()).mockResolvedValueOnce({ filename: "x.zip", bytes: 1 });
    render(<OrderDownloads orderId="o1" entitlements={entitlements} />);
    const button = () => screen.getByRole("button", { name: /download your keepsake/i });

    fireEvent.click(button());
    await screen.findByText(/didn't finish/i);
    fireEvent.click(button());

    await vi.waitFor(() => expect(download.pack).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(screen.queryByText(/didn't finish/i)).toBeNull());
  });
});

describe("OrderDownloads — QR cards", () => {
  const withLive = [
    ...entitlements,
    { id: "e2", orderId: "o1", productId: "p1", targetId: "__live__", createdAt: "2026-01-01T00:00:00Z" },
  ];
  const qrButtons = () => screen.queryAllByRole("button", { name: /qr/i });

  it("offers ONE QR download", () => {
    render(<OrderDownloads orderId="o1" entitlements={withLive} />);

    expect(qrButtons()).toHaveLength(1);
    expect(screen.getByRole("button", { name: /download qr cards/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /their qr/i })).toBeNull();
  });

  it("previews ONLY the recipient's card — the buyer's is gone", () => {
    render(<OrderDownloads orderId="o1" entitlements={withLive} />);

    const sources = screen.getAllByRole("img").map((img) => img.getAttribute("src"));
    expect(sources).toHaveLength(1);
    expect(sources[0]?.endsWith("/orders/o1/qr/recipient/")).toBe(true);
    // The buyer's endpoint must not be requested by any image on the page.
    expect(sources.some((src) => src?.endsWith("/orders/o1/qr/"))).toBe(false);
  });

  it("labels the remaining card as the recipient's", () => {
    render(<OrderDownloads orderId="o1" entitlements={withLive} />);

    expect(screen.getByText("Recipient's QR")).toBeTruthy();
    expect(screen.queryByText(/your qr/i)).toBeNull();
    expect(screen.queryByText(/their qr/i)).toBeNull();
  });

  it("captions the card on its own terms, with no comparison to a card that is no longer shown", () => {
    render(<OrderDownloads orderId="o1" entitlements={withLive} />);

    const caption = screen.getByText("Give this to them — it opens the keepsake directly.");
    expect(caption).toBeTruthy();
    // The old wording contrasted it with "your order"; there is nothing to contrast with now.
    expect(caption.textContent).not.toMatch(/order|this one/i);
  });

  it("no longer offers the buyer's caption or an 'open your live page' link", () => {
    render(<OrderDownloads orderId="o1" entitlements={withLive} />);

    expect(screen.queryByText(/scan to open it on a phone/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /live page/i })).toBeNull();
    expect(screen.queryByText(/open your live page/i)).toBeNull();
  });

  it("carries the magic-link token on the recipient's preview", () => {
    render(<OrderDownloads orderId="o1" entitlements={withLive} accessToken="tok" />);

    const [src] = screen.getAllByRole("img").map((img) => img.getAttribute("src"));
    expect(src?.endsWith("/orders/o1/qr/recipient/tok/")).toBe(true);
  });

  it("shows no QR card at all for an order with no live page", () => {
    render(<OrderDownloads orderId="o1" entitlements={entitlements} />);

    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("requests the single merged category — and no other — when pressed", async () => {
    download.category.mockResolvedValue({ filename: "x.zip", bytes: 1 });
    render(<OrderDownloads orderId="o1" entitlements={withLive} accessToken="tok" />);

    fireEvent.click(screen.getByRole("button", { name: /download qr cards/i }));

    await vi.waitFor(() => expect(download.category).toHaveBeenCalledTimes(1));
    expect(download.category).toHaveBeenCalledWith("o1", "live-cards", undefined, "tok");
  });

  it("shows no QR download for an order with no live page", () => {
    render(<OrderDownloads orderId="o1" entitlements={entitlements} />);

    expect(qrButtons()).toHaveLength(0);
  });
});

/**
 * ---------------------------------------------------------------------
 * SUMMARY (success screen) vs FULL (order page), per pack type
 * ---------------------------------------------------------------------
 * The entitlements below are the real targets each pack grants (see
 * `seed_catalog.py`). What is shown is derived from exactly two checks on the
 * order's entitlements — is there anything to archive, is there a live page —
 * plus the print prefix for the "Printable files" zip. These pin the visible
 * controls for each pack in each variant, so a pack can never be shown a button
 * for something it did not buy.
 *
 * Buttons and links are listed separately on purpose: "Download gift QR" is a
 * link (a plain download of the one card), everything else is a button.
 */
const PRINTS = [
  "print-a4-frameless",
  "print-a4-edged",
  "print-classic-frameless",
  "print-classic-edged",
  "print-poster-frameless",
  "print-poster-edged",
];
const LEGACY_EXTRAS = ["wallpaper-phone", "wallpaper-tablet", "wallpaper-desktop"];
const LIVE = "__live__";

const PACKS = {
  printable: PRINTS,
  digital: [LIVE],
  printablePlusDigital: [...PRINTS, LIVE],
  // Retired (disabled) — but past orders still open the order page.
  legacyComplete: [...PRINTS, ...LEGACY_EXTRAS, LIVE],
} as const;

function entitlementsFor(targets: readonly string[]) {
  return targets.map((targetId, i) => ({
    id: `e${i}`,
    orderId: "o1",
    productId: "p1",
    targetId,
    createdAt: "2026-01-01T00:00:00Z",
  }));
}

function controls() {
  const text = (el: HTMLElement) => el.textContent?.trim() ?? "";
  return {
    buttons: screen.queryAllByRole("button").map(text),
    links: screen.queryAllByRole("link").map(text),
    cards: screen.queryAllByRole("img").length,
    hasFilesHeading: screen.queryByRole("heading", { name: "Download individual files" }) !== null,
  };
}

describe("OrderDownloads — summary variant (the success screen)", () => {
  const show = (targets: readonly string[], token?: string) =>
    render(
      <OrderDownloads orderId="o1" entitlements={entitlementsFor(targets)} variant="summary" accessToken={token} />
    );

  it("Printable: just the archive — no QR, no individual zips", () => {
    show(PACKS.printable);
    expect(controls()).toEqual({
      buttons: ["Download your keepsake"],
      links: [],
      cards: 0,
      hasFilesHeading: false,
    });
  });

  it("Digital-only: no archive exists, so the gift QR card IS the primary action", () => {
    show(PACKS.digital);
    expect(controls()).toEqual({
      buttons: [],
      links: ["Download gift QR"],
      cards: 1,
      hasFilesHeading: false,
    });
    // Primary treatment: the filled, full-width button style — not the quiet text link.
    const link = screen.getByRole("link", { name: /download gift qr/i });
    expect(link.className).toContain("bg-ink-navy");
    expect(link.className).toContain("w-full");
  });

  it("Printable + Digital: the archive and the gift card, nothing duplicated", () => {
    show(PACKS.printablePlusDigital);
    expect(controls()).toEqual({
      buttons: ["Download your keepsake"],
      links: ["Download gift QR"],
      cards: 1,
      hasFilesHeading: false,
    });
    // Beside the archive the gift download is a quiet link, not a second primary.
    expect(screen.getByRole("link", { name: /download gift qr/i }).className).not.toContain("bg-ink-navy");
  });

  it("legacy Complete: the same short set as Printable + Digital — its extra category moves to the order page", () => {
    show(PACKS.legacyComplete);
    expect(controls()).toEqual({
      buttons: ["Download your keepsake"],
      links: ["Download gift QR"],
      cards: 1,
      hasFilesHeading: false,
    });
  });

  it("never offers the zips that the archive already contains", () => {
    show(PACKS.printablePlusDigital);
    for (const name of [/printable files/i, /bonuses/i, /download qr cards/i, /wallpapers/i]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("still starts the whole-pack download, with the magic-link token when there is one", async () => {
    download.pack.mockResolvedValue({ filename: "x.zip", bytes: 1 });
    show(PACKS.printablePlusDigital, "tok");

    fireEvent.click(screen.getByRole("button", { name: /download your keepsake/i }));

    await vi.waitFor(() => expect(download.pack).toHaveBeenCalledTimes(1));
    expect(download.pack).toHaveBeenCalledWith("o1", undefined, "tok");
  });
});

describe("OrderDownloads — full variant (the order page)", () => {
  const show = (targets: readonly string[]) =>
    render(<OrderDownloads orderId="o1" entitlements={entitlementsFor(targets)} variant="full" />);

  it("Printable: the archive, then the individual zips it actually has", () => {
    show(PACKS.printable);
    expect(controls()).toEqual({
      buttons: ["Download your keepsake", "Printable files", "Bonuses"],
      links: [],
      cards: 0,
      hasFilesHeading: true,
    });
  });

  it("Digital-only: the gift card as primary, then the thank-you zip and the QR zip — no print files", () => {
    show(PACKS.digital);
    expect(controls()).toEqual({
      buttons: ["Bonuses", "Download QR cards"],
      links: ["Download gift QR"],
      cards: 1,
      hasFilesHeading: true,
    });
  });

  it("Printable + Digital: every individual zip, under the heading", () => {
    show(PACKS.printablePlusDigital);
    expect(controls()).toEqual({
      buttons: ["Download your keepsake", "Printable files", "Bonuses", "Download QR cards"],
      links: ["Download gift QR"],
      cards: 1,
      hasFilesHeading: true,
    });
  });

  it("legacy Complete: keeps its extra category button, so past orders lose nothing", () => {
    show(PACKS.legacyComplete);
    expect(controls().buttons).toEqual([
      "Download your keepsake",
      "Printable files",
      "Wallpapers",
      "Bonuses",
      "Download QR cards",
    ]);
  });

  it("is the default — a caller that names no variant keeps every download", () => {
    render(<OrderDownloads orderId="o1" entitlements={entitlementsFor(PACKS.printablePlusDigital)} />);
    expect(controls().buttons).toEqual([
      "Download your keepsake",
      "Printable files",
      "Bonuses",
      "Download QR cards",
    ]);
  });

  it("groups the individual zips under the heading, not loose beside the archive", () => {
    show(PACKS.printablePlusDigital);
    const section = screen.getByRole("region", { name: "Download individual files" });
    const inside = Array.from(section.querySelectorAll("button")).map((b) => b.textContent?.trim());
    expect(inside).toEqual(["Printable files", "Bonuses", "Download QR cards"]);
    // The archive button is outside it.
    expect(section.textContent).not.toContain("Download your keepsake");
  });
});

describe("OrderDownloads — the gift QR download", () => {
  it("is a plain download of the ONE recipient card, via the same endpoint as the preview", () => {
    render(<OrderDownloads orderId="o1" entitlements={entitlementsFor(PACKS.digital)} variant="summary" />);

    const link = screen.getByRole("link", { name: /download gift qr/i });
    const preview = screen.getByRole("img");
    expect(link.getAttribute("href")).toBe(preview.getAttribute("src"));
    expect(link.getAttribute("href")?.endsWith("/orders/o1/qr/recipient/")).toBe(true);
    expect(link.getAttribute("download")).toBe("heartfolio-gift-qr.png");
  });

  it("carries the magic-link token, so it works on a device with no session", () => {
    render(
      <OrderDownloads orderId="o1" entitlements={entitlementsFor(PACKS.digital)} variant="summary" accessToken="tok" />
    );

    expect(screen.getByRole("link", { name: /download gift qr/i }).getAttribute("href")?.endsWith(
      "/orders/o1/qr/recipient/tok/"
    )).toBe(true);
  });

  it("is absent for an order with no live page", () => {
    render(<OrderDownloads orderId="o1" entitlements={entitlementsFor(PACKS.printable)} variant="summary" />);
    expect(screen.queryByRole("link", { name: /gift qr/i })).toBeNull();
  });
});
