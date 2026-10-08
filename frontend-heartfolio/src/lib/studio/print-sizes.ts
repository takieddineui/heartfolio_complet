/**
 * ---------------------------------------------------------------------
 * PRINT SIZES AND MOUNTING VARIANTS (§2, §3)
 * ---------------------------------------------------------------------
 * One universal list of print sizes, each rendered in whichever orientation
 * the chosen layout uses. A print size is a paper size — it is not
 * inherently tall or wide — so there is no separate "landscape A4" product
 * to define. That is what resolves the "do I just rotate A4?" question: yes,
 * same paper, the layout decides which way up.
 *
 * ORIENTATION IS PORTRAIT EVERYWHERE, FOR NOW, and that is a statement about
 * the renderer rather than a design preference. All five Love Story Timeline
 * layouts are the same vertical column of milestones — they differ in text
 * alignment, borders and card styling, not in axis. There is no wide layout
 * to select, so `orientationFor()` currently returns portrait for every one.
 * The indirection exists so that adding a horizontal composition later is a
 * one-line change here plus the layout's own CSS, not a rework of sizing,
 * exports, packs and delivery naming.
 *
 * RESOLUTION: each size renders at its *base* dimensions at 300dpi, and the
 * larger stated size is the same file printed bigger. 12×18in at 300dpi is
 * 3600×5400 (19.4 megapixels); 24×36in at 300dpi would be 7200×10800, which
 * is 78 megapixels and roughly 311MB uncompressed — beyond what a browser
 * canvas will reliably produce. Printing the base file at 24×36 lands at
 * 150dpi, which is normal practice for a poster of that size and viewing
 * distance. The alternative — quietly rendering something smaller and
 * calling it 24×36 — would be worse.
 */

import { getLayout } from "./product-modules/love-story-timeline/layouts";

export type PrintOrientation = "portrait" | "landscape";

export interface PrintSize {
  id: string;
  /** Long edge ÷ short edge. Same in both orientations. */
  ratio: number;
  /** Base render, in pixels, in PORTRAIT. Swapped for landscape. */
  baseWidth: number;
  baseHeight: number;
  /** Resolved against the `Deliverables` message namespace. */
  labelKey: string;
}

/**
 * §3's two variants, which are two different physical print products rather
 * than two styles of the same one:
 *
 *   frameless — printed on transparent/photo stock for glass or acrylic
 *   mounting, with no visible border at all.
 *
 *   edged — a standard paper print with a border/mat, sized to drop into an
 *   ordinary picture frame.
 *
 * Both are always included in any pack containing static images. Not a
 * Studio choice, not an add-on, and each is its own real render rather than
 * a crop or scale of the other.
 *
 * NAMED `mounting`, NOT `frame`, on purpose. This module already has a
 * `frame` theme axis — none / thin-black / gallery / wood / vintage — which
 * is a decorative border drawn *into* the artwork. That is a different
 * concept from which physical product the file is for, and two things called
 * "frame" in one product module would be read wrong by the next person and
 * by the renderer.
 */
export type Mounting = "frameless" | "edged";

export const MOUNTINGS: Mounting[] = ["frameless", "edged"];

export const PRINT_SIZES: PrintSize[] = [
  {
    // A4 and A3 are the same 1:√2 ratio, so one render serves both — A3 is
    // A4 printed larger, not a different shape.
    id: "a4",
    ratio: 1.414,
    baseWidth: 2480,
    baseHeight: 3508,
    labelKey: "sizes.a4",
  },
  {
    // 8×10in, scaling to 16×20.
    id: "classic",
    ratio: 1.25,
    baseWidth: 2400,
    baseHeight: 3000,
    labelKey: "sizes.classic",
  },
  {
    // 12×18in, scaling to 24×36.
    id: "poster",
    ratio: 1.5,
    baseWidth: 3600,
    baseHeight: 5400,
    labelKey: "sizes.poster",
  },
];

/**
 * The orientation a given layout renders in.
 *
 * NO LONGER ALWAYS PORTRAIT. This used to be a hardcoded map returning
 * portrait for all five layouts, with a note saying the indirection existed
 * so a horizontal composition could be added later as a one-line change.
 *
 * §7 added two: `horizontal-polaroid` and `horizontal-circles`. This is
 * that one-line change — the layout registry now owns orientation, and
 * sizing, mounting, exports, packs and delivery naming all follow without
 * modification. An A4 simply renders the other way up for those two.
 */
export function orientationFor(layoutId: string | undefined): PrintOrientation {
  return getLayout(layoutId).orientation;
}

/** Pixel dimensions for a size in a given orientation. */
export function dimensionsFor(
  size: PrintSize,
  orientation: PrintOrientation
): { width: number; height: number } {
  return orientation === "landscape"
    ? { width: size.baseHeight, height: size.baseWidth }
    : { width: size.baseWidth, height: size.baseHeight };
}

/**
 * The stable target id for one deliverable.
 *
 * Keeps the `print-` prefix deliberately: Django's `infer_delivery_type`
 * classifies an entitlement by that prefix when the purchasing pack is a
 * bundle (`complete`) and has no single type of its own. Renaming these to
 * something like `a4-frameless` would silently break that classification for
 * every bundle purchase, so the prefix stays and no backend change is needed
 * to keep delivery typing correct.
 */
export function printTargetId(sizeId: string, mounting: Mounting): string {
  return `print-${sizeId}-${mounting}`;
}

/** Every print deliverable, in display order: size major, mounting minor. */
export function allPrintTargets(): { id: string; size: PrintSize; mounting: Mounting }[] {
  return PRINT_SIZES.flatMap((size) =>
    MOUNTINGS.map((mounting) => ({ id: printTargetId(size.id, mounting), size, mounting }))
  );
}
