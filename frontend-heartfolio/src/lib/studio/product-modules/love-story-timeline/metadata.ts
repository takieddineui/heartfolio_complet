/**
 * Milestone bounds (§4): three to five in the Studio.
 *
 * The floor is three because a "timeline" with one point is not a timeline:
 * every one of the six compositions is a sequence, and a single milestone
 * renders as a lone dot with nothing to connect it to.
 *
 * The ceiling is five. That is a product decision (12 Oct 2026), not a
 * technical limit: all six compositions were fixed and checked at three, five
 * and eight milestones, in the preview and in every print size
 * (PRINT-RENDERER-GUIDE.md sections 7 to 11), and the renderers still handle
 * eight. History: the Studio offered three from 20 Sep 2026; a cap of eight
 * was committed on 12 Oct 2026 and the same day dialled back to five.
 *
 * It is deliberately lower than the backend's `MAX_EVENTS` (eight, in the
 * renderer's data.py), which is what keeps a saved project or a paid order made
 * with six to eight milestones renderable and downloadable. This cap only stops
 * the Studio from ADDING past five; it never removes a customer's milestones.
 *
 * Each composition also declares the range it is strongest at (see
 * `layouts.ts`); that is a recommendation shown to the customer, not a limit.
 */
export const timelineMetadata = {
  minEvents: 3,
  maxEvents: 5,
};
