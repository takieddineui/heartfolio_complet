/**
 * GRADUATION KEEPSAKE: THE LIMITS, NAMED ONCE ON THIS SIDE.
 *
 * The backend validates the same numbers in
 * `apps/delivery/product_renderers/graduation_keepsake/data.py`, and
 * `graduation-module.test.ts` reads that file and fails if the two disagree.
 * The Studio's own `maxLength`s are the customer's guide; the backend's are
 * the gate.
 *
 * Approved 14 Oct 2026 from precedent and from measuring the prototype at
 * 360x640 and 375x550:
 *  - names, labels, signatures: 24 (Love Story Timeline's person name);
 *  - full name 40, degree and school 60: fit every journey's opening;
 *  - path texts 140 (a milestone description), stop caption 40 (its title);
 *  - achievement title 26 (the spec), detail 40, place 16;
 *  - message 300 (the spec) and an untimed voice caption of the same;
 *  - letter as Reasons: greeting 40, paragraph 500, sign-off 40;
 *  - VOICE MESSAGES AND DRAWINGS: 5 EACH PER KEEPSAKE, across every group and
 *    person. With at most 15 photos (main, then, next, 12 stops) a keepsake
 *    uploads at most 25 files at checkout, under production's 30-a-minute
 *    upload limit with room for a retry. Stops keep the spec's full 1-12.
 */
export const GRADUATION_LIMITS = {
  nameMaxLength: 24,
  fullNameMaxLength: 40,
  degreeMaxLength: 60,
  schoolMaxLength: 60,
  pathYearMaxLength: 12,
  pathTextMaxLength: 140,
  stopCaptionMaxLength: 40,
  minStops: 1,
  maxStops: 12,
  minAchievements: 1,
  maxAchievements: 10,
  achievementTitleMaxLength: 26,
  achievementDetailMaxLength: 40,
  achievementPlaceMaxLength: 16,
  minGroups: 1,
  maxGroups: 3,
  groupLabelMaxLength: 24,
  minPeople: 1,
  maxPeople: 12,
  personNameMaxLength: 24,
  messageMaxLength: 300,
  voiceCaptionMaxLength: 300,
  maxVoices: 5,
  maxDrawings: 5,
  /** Seconds. The backend's own audio cap is the same 60. */
  voiceMaxSeconds: 60,
  minGoals: 1,
  maxGoals: 10,
  goalMaxLength: 60,
  greetingMaxLength: 40,
  minParagraphs: 1,
  maxParagraphs: 6,
  paragraphMaxLength: 500,
  signoffMaxLength: 40,
  minSignatures: 1,
  maxSignatures: 12,
  signatureMaxLength: 24,
  endingLineMaxLength: 40,
  endingSubMaxLength: 80,
  flightAirlineMaxLength: 24,
  flightNumberMaxLength: 8,
  flightSeatMaxLength: 4,
  flightCabinMaxLength: 24,
  flightCityMaxLength: 16,
} as const;
