import { describe, expect, it } from "vitest";
import {
  allPrintTargets,
  dimensionsFor,
  MOUNTINGS,
  orientationFor,
  PRINT_SIZES,
  printTargetId,
} from "@/lib/studio/print-sizes";
import { deliverableNameFor } from "./deliverable-names";
import { TIMELINE_LAYOUTS } from "@/lib/studio/product-modules/love-story-timeline/layouts";
import { allWallpaperTargets } from "@/lib/studio/wallpaper-devices";
import { getAllProductsIncludingHidden, getOccasionsForProduct } from "./registry";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";
import { timelineExports, CURRENT_EXPORT_TARGET_IDS } from "@/lib/studio/product-modules/love-story-timeline/exports";

describe("print sizes (§2)", () => {
  it("offers one universal list, not a per-orientation list", () => {
    // The whole point of the model: a print size is a paper size. There is
    // no separate "landscape A4" entry to keep in sync.
    expect(PRINT_SIZES.map((s) => s.id)).toEqual(["a4", "classic", "poster"]);
  });

  it("matches the stated ratios", () => {
    const ratioOf = (id: string) => {
      const size = PRINT_SIZES.find((s) => s.id === id)!;
      return size.baseHeight / size.baseWidth;
    };
    expect(ratioOf("a4")).toBeCloseTo(1.414, 2); // A-series, 1:√2
    expect(ratioOf("classic")).toBeCloseTo(1.25, 2); // 4:5, i.e. 8×10
    expect(ratioOf("poster")).toBeCloseTo(1.5, 2); // 2:3, i.e. 12×18
  });

  it("declares a ratio that agrees with its own pixel dimensions", () => {
    // Guards the pair going out of sync — a plausible edit is to change one
    // and forget the other, which no other test would notice.
    for (const size of PRINT_SIZES) {
      expect(size.baseHeight / size.baseWidth).toBeCloseTo(size.ratio, 2);
    }
  });

  it("reads orientation from the layout registry, not a hardcoded map", () => {
    /**
     * THIS TEST WAS SILENTLY VACUOUS FOR A MOMENT, which is worth recording.
     *
     * It used to assert that five named layouts — standard, alternating,
     * centered, journal, cards — all rendered portrait. §7 replaced those
     * with six new compositions, so those ids stopped existing. The test
     * kept passing because `getLayout` falls back to the default layout for
     * an unknown id, and the default happens to be portrait. It was
     * asserting the fallback, not the layouts.
     *
     * Driving it from the registry means a layout cannot be added, removed
     * or renamed without this test following it.
     */
    for (const layout of TIMELINE_LAYOUTS) {
      expect(orientationFor(layout.id)).toBe(layout.orientation);
    }
  });

  it("has both portrait and landscape compositions (§7)", () => {
    // The change §2's sizing model was deliberately built to absorb: it was
    // portrait-only because no wide layout existed, with the orientation
    // lookup as the seam. Two now exist.
    const orientations = new Set(TIMELINE_LAYOUTS.map((layout) => layout.orientation));
    expect(orientations).toEqual(new Set(["portrait", "landscape"]));
  });

  it("swaps the page for a landscape layout", () => {
    // The whole payoff: an A4 renders the other way up, with no change to
    // sizing, mounting, exports or delivery naming.
    const a4 = PRINT_SIZES.find((size) => size.id === "a4")!;
    const landscape = TIMELINE_LAYOUTS.find((layout) => layout.orientation === "landscape")!;

    expect(dimensionsFor(a4, orientationFor(landscape.id))).toEqual({
      width: a4.baseHeight,
      height: a4.baseWidth,
    });
  });

  it("defaults an unknown layout to portrait rather than guessing", () => {
    expect(orientationFor("some-future-layout")).toBe("portrait");
    expect(orientationFor(undefined)).toBe("portrait");
  });

  it("swaps dimensions for landscape without needing a second size list", () => {
    const a4 = PRINT_SIZES.find((s) => s.id === "a4")!;
    expect(dimensionsFor(a4, "portrait")).toEqual({ width: 2480, height: 3508 });
    expect(dimensionsFor(a4, "landscape")).toEqual({ width: 3508, height: 2480 });
  });
});

describe("mounting variants (§3)", () => {
  it("pairs every size with both variants", () => {
    const targets = allPrintTargets();
    expect(targets).toHaveLength(PRINT_SIZES.length * MOUNTINGS.length);

    for (const size of PRINT_SIZES) {
      const forSize = targets.filter((t) => t.size.id === size.id).map((t) => t.mounting);
      expect(forSize.sort()).toEqual(["edged", "frameless"]);
    }
  });

  it("keeps the print- prefix Django classifies on", () => {
    // `infer_delivery_type` falls back to this prefix for bundle packs like
    // "complete", which have no single delivery type of their own. Renaming
    // these would silently misclassify every bundle purchase.
    for (const target of allPrintTargets()) {
      expect(target.id.startsWith("print-")).toBe(true);
    }
    expect(printTargetId("a4", "frameless")).toBe("print-a4-frameless");
  });
});

describe("customer-facing names (§2)", () => {
  it("never returns an internal id as a display name", () => {
    for (const target of allPrintTargets()) {
      const name = deliverableNameFor(target.id)!;
      expect(name).not.toBeNull();
      expect(name.sizeKey).not.toContain(target.id);
      expect(name.mountingKey).toBeDefined();
    }
  });

  it("still names deliverables from orders placed before this model", () => {
    // Entitlements are rows recorded at purchase time. A past order naming
    // `print-png` must keep downloading with a sensible label, not a slug.
    for (const legacy of ["print-png", "story-png", "square-png", "landscape-png", "portrait-png"]) {
      expect(deliverableNameFor(legacy)?.sizeKey).toBeTruthy();
    }
  });

  it("returns null for an id it has never heard of", () => {
    expect(deliverableNameFor("print-a2-holographic")).toBeNull();
  });
});

describe("export registry", () => {
  it("can still resolve every legacy target to pixels", () => {
    // Re-downloading a past purchase goes through this registry. Dropping a
    // legacy target here would break it for orders that already exist.
    const ids = timelineExports.targets.default!.map((t) => t.id);
    for (const legacy of ["print-png", "story-png", "square-png", "landscape-png", "portrait-png"]) {
      expect(ids).toContain(legacy);
    }
  });

  it("offers only current targets to new packs", () => {
    // Prints (§2/§3) and wallpapers (§4). Legacy ids stay resolvable for
    // existing orders but must never be sold again.
    expect(CURRENT_EXPORT_TARGET_IDS).toEqual([
      ...allPrintTargets().map((t) => t.id),
      ...allWallpaperTargets().map((t) => t.id),
    ]);
    for (const legacy of ["print-png", "story-png", "landscape-png", "portrait-png"]) {
      expect(CURRENT_EXPORT_TARGET_IDS).not.toContain(legacy);
    }
  });

  it("gives every wallpaper device a real render, not a resize (§4)", () => {
    const targets = allWallpaperTargets();
    expect(targets.map((t) => t.id)).toEqual([
      "wallpaper-phone",
      "wallpaper-tablet",
      "wallpaper-desktop",
    ]);

    // Three genuinely different shapes. Identical aspect ratios would mean
    // one design scaled three ways, which is what §4 rules out.
    const ratios = targets.map(({ device }) => (device.width / device.height).toFixed(3));
    expect(new Set(ratios).size).toBe(3);
  });

  it("keeps a safe zone on every device", () => {
    // The reason a wallpaper is its own composition: the OS draws its clock,
    // dock and icons on top. A device with no safe zone would be a resize.
    for (const { device } of allWallpaperTargets()) {
      expect(device.safeTop + device.safeBottom).toBeGreaterThan(0);
    }
  });

  it("names every wallpaper without exposing an internal id", () => {
    for (const { id } of allWallpaperTargets()) {
      const name = deliverableNameFor(id);
      expect(name).not.toBeNull();
      expect(name!.sizeKey).not.toContain(id);
      // A wallpaper has no frame to sit in, so no mounting line (§3).
      expect(name!.mountingKey).toBeUndefined();
    }
  });

  it("gives every offered target a label that is a key, not a slug", () => {
    for (const target of timelineExports.targets.default!) {
      expect(target.label).toMatch(/^exports\./);
      expect(target.label).not.toBe(target.id);
    }
  });
});

/**
 * ---------------------------------------------------------------------
 * THE PRODUCT PAGE CANNOT ADVERTISE A SIZE THAT DOES NOT EXIST (§16b)
 * ---------------------------------------------------------------------
 * `product-view.tsx` renders the sizes block by iterating `PRINT_SIZES` and
 * resolving `formats.sizes.<id>` for each. That makes the model the single
 * source of truth for *which* sizes are listed — but the copy describing
 * each one still lives in the message files, so a size added without copy
 * would render a raw message key on the live storefront, in every locale.
 *
 * These close that gap from the other direction. The previous version of
 * this copy is why it matters: it promised "a print-ready PDF at 300 DPI"
 * for a renderer that has never produced a PDF.
 */
describe("sizes and formats copy (§16b)", () => {
  // Typed loosely: these are the project's real message files, and the
  // assertions below are about their runtime shape, not their generated
  // types.
  type Messages = {
    ProductPage: {
      formats: { sizes: Record<string, string> };
      included: { items: string[] };
    };
  };
  const LOCALES: Record<string, Messages> = {
    en: en as unknown as Messages,
    fr: fr as unknown as Messages,
    ar: ar as unknown as Messages,
  };

  it("describes every size the model offers, in every locale", () => {
    for (const [locale, messages] of Object.entries(LOCALES)) {
      const sizes = messages.ProductPage.formats.sizes;

      for (const size of PRINT_SIZES) {
        expect(sizes[size.id], `${locale} is missing formats.sizes.${size.id}`).toBeTruthy();
      }
    }
  });

  it("describes no size the model does not offer", () => {
    // The reverse drift: a size removed from the model leaving orphaned copy
    // that nothing renders, which then gets translated and maintained for
    // nothing.
    const known = new Set(PRINT_SIZES.map((s) => s.id));
    for (const [locale, messages] of Object.entries(LOCALES)) {
      const sizes = messages.ProductPage.formats.sizes;
      for (const id of Object.keys(sizes)) {
        expect(known.has(id), `${locale} describes unknown size ${id}`).toBe(true);
      }
    }
  });

  it("quotes the dimensions the renderer actually produces", () => {
    // English only — this asserts the numbers, and the numbers are the same
    // in every locale even where the digits are rendered in Arabic-Indic.
    const sizes = LOCALES.en!.ProductPage.formats.sizes;

    for (const size of PRINT_SIZES) {
      expect(sizes[size.id]).toContain(String(size.baseWidth));
      expect(sizes[size.id]).toContain(String(size.baseHeight));
    }
  });

  it("names both formats wherever it describes what a print buyer receives", () => {
    /**
     * THIS TEST REVERSED ITS OWN MEANING, and the history matters.
     *
     * Originally it asserted that NO locale mentioned a PDF, because the
     * site was promising one and the pipeline produced none — a false claim
     * on a paid product page, found in four places across three locales.
     *
     * §18c then made PDFs real: printable images are delivered as PDF in
     * addition to PNG, because print shops prefer it. So the copy may say
     * PDF again, and now it must — understating what a customer receives is
     * a smaller failure than overstating it, but it is still wrong.
     *
     * The guard therefore checks the claim is ACCURATE rather than absent:
     * anywhere the copy describes a printable deliverable, it names both
     * formats. Deleting the test outright would have left the original bug
     * class unguarded.
     */
    const printableClaims = [
      (m: Messages) => m.ProductPage.included.items[2]!,
      (m: Messages) => (m as unknown as { Faq: { items: { printing: { answer: string } } } }).Faq.items.printing.answer,
      (m: Messages) =>
        (m as unknown as { Products: { offeringDetails: { printableFiles: string } } }).Products
          .offeringDetails.printableFiles,
    ];

    for (const [locale, messages] of Object.entries(LOCALES)) {
      for (const claim of printableClaims) {
        const text = claim(messages).toUpperCase();
        expect(text, `${locale} omits PNG`).toContain("PNG");
        expect(text, `${locale} omits PDF`).toContain("PDF");
      }
    }
  });
});

/**
 * ---------------------------------------------------------------------
 * A PRODUCT PAGE CANNOT ADVERTISE AN OCCASION IT IS NOT FOR (§16b, §11)
 * ---------------------------------------------------------------------
 * The occasion list on a product page is derived from the product's tags
 * rather than written into the copy, so it cannot promise something the
 * catalog does not back. This is the same failure §11 fixed on the
 * homepage, where five occasion cards led to grids with nothing in them.
 */
describe("product occasions (§16b)", () => {
  const bySlug = (slug: string) =>
    getAllProductsIncludingHidden().find((p) => p.slug === slug)!;

  it("lists only occasions the product is tagged for", () => {
    const product = bySlug("love-story-timeline");
    expect(getOccasionsForProduct(product)).toEqual(["anniversary", "wedding"]);
  });

  it("never returns an occasion whose tags the product lacks", () => {
    for (const product of getAllProductsIncludingHidden()) {
      const tags = new Set(product.tags ?? []);
      for (const key of getOccasionsForProduct(product)) {
        // Every returned occasion must be justified by at least one tag.
        const justified = { anniversary: ["anniversary"], wedding: ["wedding"], newBaby: ["birth"], inMemory: ["memorial"], newChapter: ["housewarming"] }[key] ?? [];
        expect(justified.some((tag) => tags.has(tag))).toBe(true);
      }
    }
  });

  it("returns nothing for a product with no occasion tags", () => {
    const untagged = { ...bySlug("love-story-timeline"), tags: ["timeline", "photos"] };
    expect(getOccasionsForProduct(untagged)).toEqual([]);
  });

  it("gives every returned occasion a label to render", () => {
    // The page resolves `GiftOccasions.items.<key>.label`. A derived key
    // with no label would render a raw message key on a live product page.
    const labels = (en as unknown as {
      GiftOccasions: { items: Record<string, { label: string }> };
    }).GiftOccasions.items;

    for (const product of getAllProductsIncludingHidden()) {
      for (const key of getOccasionsForProduct(product)) {
        expect(labels[key]?.label, `no label for ${key}`).toBeTruthy();
      }
    }
  });
});
