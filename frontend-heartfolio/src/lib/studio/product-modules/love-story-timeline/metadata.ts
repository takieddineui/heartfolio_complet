/**
 * Milestone bounds (§4).
 *
 * CHANGED FROM 1–5 TO 3–8, and both ends matter.
 *
 * The floor moved from 1 to 3 because a "timeline" with one point is not a
 * timeline — every one of the six compositions is a sequence, and a single
 * milestone renders as a lone dot with nothing to connect it to.
 *
 * The ceiling moved from 5 to 8. §19 requires every layout to adapt
 * intelligently across the whole range rather than being designed around
 * one count, which is why each composition also declares the range it is
 * strongest at — see `layouts.ts`. Those are recommendations shown to the
 * customer, not limits: all six must render all six counts.
 */
export const timelineMetadata = {
  minEvents: 3,
  // EXACTLY THREE, as a product decision rather than a technical limit.
  // The print layout gives each milestone a full band of the page; at
  // eight they compress to strips and the keepsake reads as a list.
  //
  // THE BACKEND STILL ACCEPTS 3-8 on purpose (MAX_EVENTS in the renderer's
  // data.py). Tightening validation there would make any project already
  // saved with more than three fail at render — after payment, which is
  // the worst possible moment. The Studio simply stops offering a fourth.
  maxEvents: 3,
  /** Where most stories land, used to steer layout recommendations (§4). */
  recommendedMin: 4,
  recommendedMax: 6,
};
