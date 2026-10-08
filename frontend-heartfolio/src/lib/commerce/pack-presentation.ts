import type { DeliveryPack } from "@/types/commerce";

/**
 * ---------------------------------------------------------------------
 * HOW THE FIVE ACTIVE PACKS BECOME A PRESENTATION HIERARCHY
 * ---------------------------------------------------------------------
 * The backend returns five equal-weight rows — `printable`, `live`,
 * `printable-plus-wallpaper`, `digital-plus-wallpaper`, `complete` — with
 * no ordering or grouping information, because a `DeliveryPack` is commerce
 * data, not presentation data (§ DB-is-sole-price-source, confirmed across
 * every prior audit in this project). This file is where the two meet:
 * pure functions that turn the flat list into "primary" and "wallpaper
 * add-on", with nothing here touching a price or inventing one.
 *
 * WHY THIS IS ITS OWN FILE RATHER THAN LOGIC INSIDE THE CHECKOUT COMPONENT
 * `checkout-flow.tsx` is a large stateful component with no test file of
 * its own. The one piece of genuinely new business logic in this
 * change — which base pack maps to which wallpaper-combo pack — deserves
 * to be a plain, individually testable function, not something proven
 * correct only by clicking through the UI.
 */

/**
 * The packs shown as primary, equal-weight purchasing choices on the product
 * page, in display order. Wallpaper is never in this list — see
 * `WALLPAPER_ADDON_FOR` below.
 *
 * `printable-plus-digital` is the combo of the two base units below. It is
 * listed here so the product page advertises it; the CHECKOUT does not walk
 * this list for a product that sells it, but builds a unit toggle instead
 * (`unitSelectionModel`). `complete` stays for products that still sell it.
 */
export const PRIMARY_PACK_SLUGS = ["printable", "live", "printable-plus-digital", "complete"] as const;

/**
 * Maps a primary pack's slug to the slug of its wallpaper-combo pack.
 *
 * DELIBERATELY EXPLICIT, not derived by string concatenation. The obvious
 * implementation — `${baseSlug}-plus-wallpaper` — is wrong for exactly one
 * entry: the Digital pack's DB slug stayed `live` (kept on purpose so
 * `delivery_types.py`'s `_PACK_SLUG_TO_TYPE` mapping didn't need touching),
 * while its combo pack was named for the CUSTOMER-FACING label instead —
 * `digital-plus-wallpaper`, not `live-plus-wallpaper`. A derived lookup
 * would silently fail to find it. `complete` has no entry: it already
 * includes wallpaper targets, so there is nothing to add.
 */
const WALLPAPER_ADDON_FOR: Partial<Record<(typeof PRIMARY_PACK_SLUGS)[number], string>> = {
  printable: "printable-plus-wallpaper",
  live: "digital-plus-wallpaper",
};

export interface PackPresentation {
  /** The three primary packs, in the fixed order above — never the
   *  backend's alphabetical order, and never including a combo pack. */
  primary: DeliveryPack[];
  /** For a primary pack's slug, its wallpaper-combo pack if the backend
   *  actually returned one. Absent (not just falsy) when there is nothing
   *  to offer — checked with `in`, not truthiness, in the component. */
  wallpaperAddonFor: Partial<Record<string, DeliveryPack>>;
}

/**
 * Groups the flat pack list into what the checkout actually shows.
 *
 * A pack that is neither a known primary slug nor a known combo slug is
 * silently excluded rather than falling into a catch-all "other" bucket.
 * That is deliberate: this function's whole job is to keep an
 * unpresentable row — like the disabled `wallpaper` pack, or anything
 * added later without updating this file — from ever reaching the
 * checkout UI by accident. An omission here is a prompt to update this
 * file, not a bug users see.
 */
export function groupPacksForPresentation(packs: DeliveryPack[]): PackPresentation {
  const bySlug = new Map(packs.map((pack) => [pack.id, pack]));

  const primary = PRIMARY_PACK_SLUGS.map((slug) => bySlug.get(slug)).filter(
    (pack): pack is DeliveryPack => pack !== undefined
  );

  const wallpaperAddonFor: Partial<Record<string, DeliveryPack>> = {};
  for (const [baseSlug, comboSlug] of Object.entries(WALLPAPER_ADDON_FOR)) {
    const combo = bySlug.get(comboSlug);
    if (combo) wallpaperAddonFor[baseSlug] = combo;
  }

  return { primary, wallpaperAddonFor };
}

/**
 * Whether `candidate` is the wallpaper-combo version of `base`.
 *
 * Used to decide whether the wallpaper checkbox should render as checked
 * when a pack is already selected — e.g. arriving at checkout with a combo
 * pack pre-selected from a deep link should show the box ticked, not
 * unchecked with the wrong pack silently selected underneath it.
 */
export function isWallpaperComboOf(candidate: DeliveryPack, base: DeliveryPack): boolean {
  return WALLPAPER_ADDON_FOR[base.id as (typeof PRIMARY_PACK_SLUGS)[number]] === candidate.id;
}

/**
 * ---------------------------------------------------------------------
 * THE UNIT TOGGLE: BASE UNITS, AND THE ONE PACK EACH COMBINATION IS
 * ---------------------------------------------------------------------
 * A customer picks base units — Printable, Digital — singly or together.
 * `Order.delivery_pack` is a single foreign key, so a combination is not a
 * line-item order: it is the ONE pack that IS that combination, with its own
 * price and its own Freemius plan. This section is the mapping from "which
 * units are ticked" to "which pack that means", and nothing here touches or
 * invents a price.
 *
 * EXPLICIT TABLES, not string concatenation, for the same reason as
 * `WALLPAPER_ADDON_FOR`: Digital's DB slug is `live`, but its combo is named
 * for the customer-facing label (`printable-plus-digital`), so deriving the
 * slug from the units would silently find nothing.
 *
 * ADDING A UNIT LATER (e.g. AR): add it to `BaseUnit`, `BASE_UNIT_ORDER` and
 * `BASE_UNIT_PACK_SLUG`, then one `COMBO_PACK_SLUG` row per combination that
 * is actually sold. Existing rows do not change. A combination with no row
 * simply cannot be selected — the toggle reports it as unavailable.
 */
export type BaseUnit = "printable" | "digital";

/** Fixed display and key order — a selection is always read in this order. */
const BASE_UNIT_ORDER: readonly BaseUnit[] = ["printable", "digital"];

/** The DB slug of the pack that sells each unit on its own. */
const BASE_UNIT_PACK_SLUG: Record<BaseUnit, string> = {
  printable: "printable",
  digital: "live",
};

/** Combination (units in `BASE_UNIT_ORDER`, joined by "+") -> its pack's slug. */
const COMBO_PACK_SLUG: Record<string, string> = {
  "printable+digital": "printable-plus-digital",
};

function orderedUnits(selected: Iterable<BaseUnit>): BaseUnit[] {
  const chosen = new Set(selected);
  return BASE_UNIT_ORDER.filter((unit) => chosen.has(unit));
}

export interface UnitOption {
  unit: BaseUnit;
  /** The pack that sells this unit alone — supplies its name, description
   *  and price for the toggle row. */
  pack: DeliveryPack;
}

/**
 * The toggle's rows, or `null` when this product should keep the plain
 * pack list instead.
 *
 * Non-null only when the product has at least two base units AND a pack that
 * sells all of them together. A product with one unit has nothing to toggle,
 * and one whose combo pack is not in the catalog has no way to honour a
 * "both" selection — either would render a control that cannot be used, so
 * they fall back to `groupPacksForPresentation`'s cards, unchanged.
 */
export function unitSelectionModel(packs: DeliveryPack[]): UnitOption[] | null {
  const bySlug = new Map(packs.map((pack) => [pack.id, pack]));

  const options: UnitOption[] = [];
  for (const unit of BASE_UNIT_ORDER) {
    const pack = bySlug.get(BASE_UNIT_PACK_SLUG[unit]);
    if (pack) options.push({ unit, pack });
  }

  if (options.length < 2) return null;
  return packForUnits(packs, options.map((option) => option.unit)) ? options : null;
}

/**
 * The one pack that sells exactly these units, or `null` when nothing is
 * selected or no pack sells that combination.
 */
export function packForUnits(packs: DeliveryPack[], selected: Iterable<BaseUnit>): DeliveryPack | null {
  const units = orderedUnits(selected);
  const [only] = units;
  if (only === undefined) return null;

  const slug = units.length === 1 ? BASE_UNIT_PACK_SLUG[only] : COMBO_PACK_SLUG[units.join("+")];
  return slug ? (packs.find((pack) => pack.id === slug) ?? null) : null;
}

/**
 * Which units a pack sells — the inverse of `packForUnits`. Lets the toggle
 * reopen with the right boxes ticked when the customer comes Back from the
 * email step. Empty for a pack that is not a base unit or a known combo.
 */
export function unitsForPack(pack: DeliveryPack | null): BaseUnit[] {
  if (!pack) return [];
  const single = BASE_UNIT_ORDER.find((unit) => BASE_UNIT_PACK_SLUG[unit] === pack.id);
  if (single) return [single];
  const combo = Object.entries(COMBO_PACK_SLUG).find(([, slug]) => slug === pack.id);
  return combo ? (combo[0].split("+") as BaseUnit[]) : [];
}

/**
 * What a combination saves against buying its units separately: the sum of
 * the base packs' real prices minus the combo pack's real price. Display
 * only — the charge is the pack's own price, computed by Django. Never
 * negative, and zero for a single unit or an unavailable combination.
 */
export function unitSavingsCents(packs: DeliveryPack[], selected: Iterable<BaseUnit>): number {
  const units = orderedUnits(selected);
  if (units.length < 2) return 0;

  const combo = packForUnits(packs, units);
  if (!combo) return 0;

  let separately = 0;
  for (const unit of units) {
    const base = packForUnits(packs, [unit]);
    if (!base) return 0;
    separately += base.priceCents;
  }
  return Math.max(0, separately - combo.priceCents);
}
