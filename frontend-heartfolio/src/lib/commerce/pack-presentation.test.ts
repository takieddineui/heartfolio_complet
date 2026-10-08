import { describe, expect, it } from "vitest";
import type { DeliveryPack } from "@/types/commerce";
import {
  PRIMARY_PACK_SLUGS,
  groupPacksForPresentation,
  isWallpaperComboOf,
  packForUnits,
  unitSavingsCents,
  unitSelectionModel,
  unitsForPack,
} from "./pack-presentation";

/**
 * The five packs currently active in the DB, per the approved catalog
 * state. Built here rather than imported from anywhere, because this
 * function must work from the shape the API actually returns — a plain
 * array, backend order, no grouping — not from a fixture that already
 * assumes the grouping this file is responsible for producing.
 */
function pack(id: string, priceCents: number): DeliveryPack {
  return {
    id,
    productId: "love-story-timeline",
    nameKey: `packs.${id}.name`,
    descriptionKey: `packs.${id}.description`,
    priceCents,
    currency: "USD",
    includedTargets: [],
  };
}

const ALL_ACTIVE_PACKS = [
  pack("complete", 2999),
  pack("digital-plus-wallpaper", 1499),
  pack("live", 1099),
  pack("printable", 1799),
  pack("printable-plus-wallpaper", 2199),
];

describe("groupPacksForPresentation", () => {
  it("returns exactly the three primary packs, in fixed order", () => {
    const { primary } = groupPacksForPresentation(ALL_ACTIVE_PACKS);
    expect(primary.map((p) => p.id)).toEqual(["printable", "live", "complete"]);
  });

  it("never includes a combo pack in primary", () => {
    const { primary } = groupPacksForPresentation(ALL_ACTIVE_PACKS);
    expect(primary.some((p) => p.id.endsWith("-plus-wallpaper"))).toBe(false);
  });

  it("maps live to digital-plus-wallpaper, not live-plus-wallpaper", () => {
    /**
     * The one gotcha this whole file exists to prevent. The Digital pack's
     * DB slug stayed "live" while its combo pack was named for the
     * customer-facing label instead. A naive `${slug}-plus-wallpaper`
     * derivation would look for a pack that does not exist and silently
     * produce no wallpaper checkbox on Digital at all.
     */
    const { wallpaperAddonFor } = groupPacksForPresentation(ALL_ACTIVE_PACKS);
    expect(wallpaperAddonFor.live?.id).toBe("digital-plus-wallpaper");
  });

  it("maps printable to printable-plus-wallpaper", () => {
    const { wallpaperAddonFor } = groupPacksForPresentation(ALL_ACTIVE_PACKS);
    expect(wallpaperAddonFor.printable?.id).toBe("printable-plus-wallpaper");
  });

  it("gives complete no wallpaper add-on at all", () => {
    // It already includes wallpaper targets — there is nothing to offer,
    // and no checkbox should ever render for it.
    const { wallpaperAddonFor } = groupPacksForPresentation(ALL_ACTIVE_PACKS);
    expect("complete" in wallpaperAddonFor).toBe(false);
  });

  it("degrades gracefully when a combo pack is missing from the API response", () => {
    // A pack fetch mid-migration, or a product with no wallpaper combos at
    // all, must not crash the checkout — it should just show no checkbox.
    const withoutCombos = ALL_ACTIVE_PACKS.filter((p) => !p.id.endsWith("-plus-wallpaper"));
    const { primary, wallpaperAddonFor } = groupPacksForPresentation(withoutCombos);
    expect(primary).toHaveLength(3);
    expect(Object.keys(wallpaperAddonFor)).toHaveLength(0);
  });

  it("excludes any pack that is neither a known primary nor a known combo", () => {
    // Includes the disabled standalone wallpaper pack, if it were ever
    // returned by mistake — this is the backstop, not the only defense
    // (the API already filters status=active before this runs).
    const withStrays = [...ALL_ACTIVE_PACKS, pack("wallpaper", 800), pack("some-future-pack", 500)];
    const { primary, wallpaperAddonFor } = groupPacksForPresentation(withStrays);
    const allShown = [...primary, ...Object.values(wallpaperAddonFor)].map((p) => p!.id);
    expect(allShown).not.toContain("wallpaper");
    expect(allShown).not.toContain("some-future-pack");
  });

  it("PRIMARY_PACK_SLUGS has exactly four entries", () => {
    expect(PRIMARY_PACK_SLUGS).toHaveLength(4);
  });

  it("puts the Printable + Digital combo between Digital and Complete when it exists", () => {
    const { primary } = groupPacksForPresentation([
      ...ALL_ACTIVE_PACKS,
      pack("printable-plus-digital", 3599),
    ]);
    expect(primary.map((p) => p.id)).toEqual(["printable", "live", "printable-plus-digital", "complete"]);
  });
});

/**
 * The unit toggle. Prices are the real catalog's, so the savings assertion
 * checks the arithmetic against numbers a reader can verify by eye:
 * $22.99 + $15.99 = $38.98, less $35.99 = $2.99.
 */
const CATALOG_PACKS = [
  pack("printable", 2299),
  pack("live", 1599),
  pack("printable-plus-digital", 3599),
  pack("printable-plus-wallpaper", 2799),
  pack("digital-plus-wallpaper", 2099),
];

describe("unitSelectionModel", () => {
  it("offers Printable then Digital when the product sells both and their combo", () => {
    const model = unitSelectionModel(CATALOG_PACKS);
    expect(model?.map((option) => option.unit)).toEqual(["printable", "digital"]);
    // Digital's rows come from the `live` pack — its DB slug.
    expect(model?.map((option) => option.pack.id)).toEqual(["printable", "live"]);
  });

  it("returns null when the combo pack is not in the catalog", () => {
    // A toggle whose "both" has nothing to buy must not render — the product
    // keeps the plain pack cards instead.
    const withoutCombo = CATALOG_PACKS.filter((p) => p.id !== "printable-plus-digital");
    expect(unitSelectionModel(withoutCombo)).toBeNull();
  });

  it("returns null for a product with only one base unit", () => {
    expect(unitSelectionModel([pack("printable", 1800), pack("complete", 2400)])).toBeNull();
  });
});

describe("packForUnits", () => {
  it("maps a single unit to its own base pack", () => {
    expect(packForUnits(CATALOG_PACKS, ["printable"])?.id).toBe("printable");
    // The gotcha: Digital's pack is `live`.
    expect(packForUnits(CATALOG_PACKS, ["digital"])?.id).toBe("live");
  });

  it("maps both units to the combo pack, whichever order they were ticked in", () => {
    expect(packForUnits(CATALOG_PACKS, ["printable", "digital"])?.id).toBe("printable-plus-digital");
    expect(packForUnits(CATALOG_PACKS, ["digital", "printable"])?.id).toBe("printable-plus-digital");
  });

  it("returns null for an empty selection", () => {
    expect(packForUnits(CATALOG_PACKS, [])).toBeNull();
  });

  it("returns null when the pack for a combination is missing from the response", () => {
    const withoutCombo = CATALOG_PACKS.filter((p) => p.id !== "printable-plus-digital");
    expect(packForUnits(withoutCombo, ["printable", "digital"])).toBeNull();
  });
});

describe("unitsForPack", () => {
  it("is the inverse of packForUnits", () => {
    expect(unitsForPack(pack("printable", 2299))).toEqual(["printable"]);
    expect(unitsForPack(pack("live", 1599))).toEqual(["digital"]);
    expect(unitsForPack(pack("printable-plus-digital", 3599))).toEqual(["printable", "digital"]);
  });

  it("returns nothing for a pack that is not a base unit or a known combo", () => {
    expect(unitsForPack(pack("complete", 3999))).toEqual([]);
    expect(unitsForPack(pack("printable-plus-wallpaper", 2799))).toEqual([]);
    expect(unitsForPack(null)).toEqual([]);
  });
});

describe("unitSavingsCents", () => {
  it("is the two base prices minus the combo price", () => {
    expect(unitSavingsCents(CATALOG_PACKS, ["printable", "digital"])).toBe(299);
  });

  it("is zero for a single unit", () => {
    expect(unitSavingsCents(CATALOG_PACKS, ["printable"])).toBe(0);
    expect(unitSavingsCents(CATALOG_PACKS, [])).toBe(0);
  });

  it("is never negative, even if the combo were priced above its parts", () => {
    const overpriced = [pack("printable", 1000), pack("live", 1000), pack("printable-plus-digital", 2500)];
    expect(unitSavingsCents(overpriced, ["printable", "digital"])).toBe(0);
  });

  it("is zero when the combination has no pack", () => {
    const withoutCombo = CATALOG_PACKS.filter((p) => p.id !== "printable-plus-digital");
    expect(unitSavingsCents(withoutCombo, ["printable", "digital"])).toBe(0);
  });
});

describe("isWallpaperComboOf", () => {
  const printable = pack("printable", 1799);
  const printablePlusWallpaper = pack("printable-plus-wallpaper", 2199);
  const live = pack("live", 1099);
  const digitalPlusWallpaper = pack("digital-plus-wallpaper", 1499);

  it("recognizes a pack's real combo", () => {
    expect(isWallpaperComboOf(printablePlusWallpaper, printable)).toBe(true);
    expect(isWallpaperComboOf(digitalPlusWallpaper, live)).toBe(true);
  });

  it("rejects a mismatched pairing", () => {
    // Printable's combo is not Digital's combo — a deep link landing on
    // the wrong pack must not show the checkbox as checked.
    expect(isWallpaperComboOf(digitalPlusWallpaper, printable)).toBe(false);
    expect(isWallpaperComboOf(printablePlusWallpaper, live)).toBe(false);
  });
});
