import type { PrintOrientation } from "@/lib/studio/print-sizes";

/**
 * ---------------------------------------------------------------------
 * THE SIX COMPOSITIONS (§7)
 * ---------------------------------------------------------------------
 * Composition systems, not six separate products — §7 says so explicitly.
 * They share the story, the theme system, the packs and the export
 * pipeline; what differs is how the timeline is arranged.
 *
 * TWO OF THEM ARE LANDSCAPE, and that is the significant change. Until now
 * every layout was vertical, which is why §2's sizing model was built
 * portrait-only: I asked whether any layout was wide, established none was,
 * and the orientation lookup returned portrait for all five.
 *
 * That indirection was built for exactly this moment. `orientationFor()` in
 * `print-sizes.ts` reads from here, so adding two landscape compositions
 * needs no change to sizing, mounting, exports, packs or delivery naming —
 * an A4 simply renders the other way up for those two.
 *
 * `idealMin`/`idealMax` are RECOMMENDATIONS, never limits. §19 requires all
 * six to adapt across the whole range the Studio offers (`metadata.ts`); these
 * steer the customer toward the count a composition flatters, and drive
 * nothing else. Some `idealMax` values sit above the Studio's current cap of
 * five; they are inert until the cap rises again, and were left as designed.
 */

export interface TimelineLayout {
  id: string;
  orientation: PrintOrientation;
  idealMin: number;
  idealMax: number;
  /** Resolved as `layouts.<id>.name` / `.description` in module messages. */
  i18nKey: string;
}

export const TIMELINE_LAYOUTS: TimelineLayout[] = [
  {
    // Solid central spine, small heart nodes, Polaroids on one side and
    // dates on the other. The structured, formal one.
    id: "neat-stack",
    orientation: "portrait",
    idealMin: 4,
    idealMax: 6,
    i18nKey: "neatStack",
  },
  {
    // Photos alternate across the spine with a slight tilt. Expressive
    // rather than formal, and it needs room per milestone — which is why
    // it is strongest at the low end of the range.
    id: "alternating-tilt",
    orientation: "portrait",
    idealMin: 3,
    idealMax: 5,
    i18nKey: "alternatingTilt",
  },
  {
    // The timeline recedes and the photographs carry the composition.
    id: "overlapping-cascade",
    orientation: "portrait",
    idealMin: 4,
    idealMax: 6,
    i18nKey: "overlappingCascade",
  },
  {
    // Dotted spine with branches reaching toward each label. The most
    // decorative of the six.
    id: "dotted-branching",
    orientation: "portrait",
    idealMin: 4,
    idealMax: 6,
    i18nKey: "dottedBranching",
  },
  {
    // LANDSCAPE. Polaroids in a row along a horizontal spine.
    id: "horizontal-polaroid",
    orientation: "landscape",
    idealMin: 5,
    idealMax: 6,
    i18nKey: "horizontalPolaroid",
  },
  {
    // LANDSCAPE. Circular photos on a ticked horizontal axis — the most
    // modern, and the one that takes the highest counts comfortably
    // because a circle packs tighter than a Polaroid.
    id: "horizontal-circles",
    orientation: "landscape",
    idealMin: 5,
    idealMax: 7,
    i18nKey: "horizontalCircles",
  },
];

export const DEFAULT_LAYOUT_ID = "neat-stack";

export function getLayout(id: string | undefined | null): TimelineLayout {
  return TIMELINE_LAYOUTS.find((layout) => layout.id === id) ?? TIMELINE_LAYOUTS[0]!;
}

/** True when a layout is being used outside the range it flatters. Drives a
 *  hint in the Studio, never a block — §19 requires all counts to work. */
export function isOutsideIdealRange(layoutId: string, milestoneCount: number): boolean {
  const layout = getLayout(layoutId);
  return milestoneCount < layout.idealMin || milestoneCount > layout.idealMax;
}
