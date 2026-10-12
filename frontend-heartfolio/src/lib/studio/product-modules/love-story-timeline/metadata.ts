/**
 * Milestone bounds (§4): three to eight.
 *
 * The floor is three because a "timeline" with one point is not a timeline:
 * every one of the six compositions is a sequence, and a single milestone
 * renders as a lone dot with nothing to connect it to.
 *
 * The ceiling is eight, the same as the backend's `MAX_EVENTS` in the
 * renderer's data.py. §19 requires every layout to adapt across the whole
 * range rather than being designed around one count; each composition also
 * declares the range it is strongest at (see `layouts.ts`), which is a
 * recommendation shown to the customer, not a limit.
 *
 * The Studio offered only three from 20 Sep to 12 Oct 2026. When that was
 * revisited, four of the six previews (Neat Stack, Alternating Tilt,
 * Overlapping Cascade, Dotted Branching) cut milestones off past the third,
 * and all six prints had layout problems at five or eight milestones. All
 * six were fixed and checked at three, five and eight, in the preview and in
 * every print size (PRINT-RENDERER-GUIDE.md sections 7 to 11), the AR scene
 * was made to space its photographs for the count, and the cap was raised.
 */
export const timelineMetadata = {
  minEvents: 3,
  maxEvents: 8,
};
