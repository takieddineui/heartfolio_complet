import { MOUNTINGS, PRINT_SIZES, printTargetId, type Mounting } from "@/lib/studio/print-sizes";
import { WALLPAPER_DEVICES, wallpaperTargetId } from "@/lib/studio/wallpaper-devices";

/**
 * ---------------------------------------------------------------------
 * WHAT THE CUSTOMER IS TOLD THEY RECEIVED (§2)
 * ---------------------------------------------------------------------
 * Internal target ids — `print-png`, `story-png`, `print-a4-frameless` —
 * must never reach a customer as-is. Until now they did: the downloads list
 * on the order page rendered `entitlement.targetId` directly, so someone who
 * had just paid saw a row labelled "print-png".
 *
 * This is the one place that translates an id into something a person would
 * recognise. It is deliberately total — every id an entitlement can carry
 * resolves to a message key, including the legacy ids below, because the
 * failure mode of a gap here is a paying customer staring at a slug.
 *
 * LEGACY IDS ARE STILL MAPPED, NOT DELETED. Entitlements are rows in Django
 * with a `target_id` recorded at purchase time. Orders placed before the §2
 * rework still reference `print-png` and the social/wallpaper shapes, and
 * those files must keep downloading with a sensible name for as long as
 * those orders exist. Removing them here would rename a past purchase to
 * nothing.
 */

export const LIVE_DELIVERABLE_KEY = "deliverables.live";

/**
 * Ids that predate the §2 sizing model. Kept resolvable for existing orders;
 * not offered in any new pack. See `exports.ts` for why they also remain in
 * the export target registry.
 */
const LEGACY_TARGET_KEYS: Record<string, string> = {
  "print-png": "deliverables.legacy.print",
  "story-png": "deliverables.legacy.story",
  "square-png": "deliverables.legacy.square",
  "landscape-png": "deliverables.legacy.landscape",
  "portrait-png": "deliverables.legacy.portrait",
};

export interface DeliverableName {
  /** Message key for the size, e.g. "A4 / A3". */
  sizeKey: string;
  /** Message key for the mounting, e.g. "For glass mounting". Absent for
   *  deliverables where the frameless/edged distinction does not apply. */
  mountingKey?: string;
}

const PRINT_TARGET_NAMES: Record<string, DeliverableName> = Object.fromEntries(
  PRINT_SIZES.flatMap((size) =>
    MOUNTINGS.map((mounting: Mounting) => [
      printTargetId(size.id, mounting),
      { sizeKey: `deliverables.${size.labelKey}`, mountingKey: `deliverables.mounting.${mounting}` },
    ])
  )
);

const WALLPAPER_TARGET_NAMES: Record<string, DeliverableName> = Object.fromEntries(
  WALLPAPER_DEVICES.map((device) => [
    wallpaperTargetId(device.id),
    // No mounting line: frameless-vs-edged is about physical print
    // products, and a wallpaper has no frame to sit in (§3).
    { sizeKey: `deliverables.${device.labelKey}` },
  ])
);

/**
 * Resolves a target id to the message keys describing it.
 *
 * Returns `null` only for an id this build has never heard of — a target
 * added by a newer deploy and downloaded by an older client, or a corrupted
 * row. Callers show the raw id in that case, which is ugly but honest;
 * inventing a name for an unknown file would be worse.
 */
export function deliverableNameFor(targetId: string): DeliverableName | null {
  if (targetId in PRINT_TARGET_NAMES) return PRINT_TARGET_NAMES[targetId]!;
  if (targetId in WALLPAPER_TARGET_NAMES) return WALLPAPER_TARGET_NAMES[targetId]!;
  if (targetId in LEGACY_TARGET_KEYS) return { sizeKey: LEGACY_TARGET_KEYS[targetId]! };
  return null;
}
