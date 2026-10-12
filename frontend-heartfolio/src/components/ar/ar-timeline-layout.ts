/**
 * Where the AR timeline puts its milestone photographs (§21i).
 *
 * The photographs run down a card 0.84 units tall, evenly spaced from the
 * first to the last. They used to be a fixed 0.26 units square, which is
 * clear of each other only up to four milestones: from five the spacing is
 * smaller than the photograph, and the later photographs (which also rise
 * further off the card as they appear) covered the earlier ones. At eight
 * the spacing is 0.12, so each photograph covered more than half of the
 * one above it. The Studio only offered three milestones until it was
 * raised to eight, so nobody had seen it.
 *
 * The photograph is now the usual 0.26 whenever that fits and shrinks to
 * the spacing less a small gap when it does not.
 */
export const AR_SPAN = 0.84;
export const AR_PHOTO_SIZE = 0.26;
/** Clear space kept between two neighbouring photographs. */
export const AR_PHOTO_GAP = 0.02;

/** The distance between two neighbouring milestones, for `count` of them. */
export function milestoneSpacing(count: number): number {
  return AR_SPAN / Math.max(1, count - 1 || 1);
}

/** The side of a milestone's photograph, for `count` milestones. */
export function milestonePhotoSize(count: number): number {
  return Math.min(AR_PHOTO_SIZE, milestoneSpacing(count) - AR_PHOTO_GAP);
}
