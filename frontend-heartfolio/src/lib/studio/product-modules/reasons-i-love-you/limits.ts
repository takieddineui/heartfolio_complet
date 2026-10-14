/**
 * REASONS I LOVE YOU: THE LIMITS, NAMED ONCE ON THIS SIDE.
 *
 * The backend validates the same numbers in
 * `apps/delivery/product_renderers/reasons_i_love_you/data.py`, and
 * `limits.test.ts` reads that file and fails if the two disagree. The Studio's
 * own `maxLength`s are the customer's guide; the backend's are the gate.
 *
 * Every cap borrows the nearest field Heartfolio already has, so nothing here
 * is a new invented number except the letter paragraph:
 *  - names and signature: 24, Love Story Timeline's person name;
 *  - title, greeting, teaser, sign-off: 40, its poster title and ending text;
 *  - memory line: 60, its subtitle;
 *  - reason: 160, the spec's own "reads best" length, between a milestone
 *    description (140) and a dedication (180);
 *  - final message: 180, the dedication;
 *  - letter paragraph: 500, NO precedent (nothing else here is long-form).
 */
export const REASONS_LIMITS = {
  minReasons: 1,
  /** Also the deck's size: the cards run Ace to 10 of Hearts. */
  maxReasons: 10,
  minParagraphs: 1,
  maxParagraphs: 5,
  nameMaxLength: 24,
  titleMaxLength: 40,
  reasonMaxLength: 160,
  memoryMaxLength: 60,
  teaserMaxLength: 40,
  finaleLineMaxLength: 180,
  signatureMaxLength: 24,
  greetingMaxLength: 40,
  paragraphMaxLength: 500,
  signoffMaxLength: 40,
} as const;
