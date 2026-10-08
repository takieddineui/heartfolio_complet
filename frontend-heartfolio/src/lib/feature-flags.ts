/**
 * Launch flags — things that are built, tested and deliberately not
 * switched on yet.
 *
 * A flag here is NOT a feature toggle to be read at runtime or flipped per
 * customer. It is a single constant that several files must agree on, so
 * that "is this released?" has exactly one answer rather than one per
 * place that happens to render something.
 */

/**
 * Milestone VIDEO — withheld for now.
 *
 * Read by two places that would otherwise disagree:
 *   - the Studio schema, which decides whether the upload field exists
 *   - the live keepsake, which decides whether a player is rendered
 *
 * Hiding only the input would still leave a player for any project that
 * already has a video, and hiding only the player would let customers
 * upload one that never appears. Both read this.
 *
 * NOTHING ELSE IS DISABLED. Uploading, validation, storage, promotion to
 * permanent on payment, and AR playback are all in place and exercised by
 * tests; the AR scene plays milestone video today. Flip this to `true` to
 * release, and nothing else needs changing.
 */
export const SHOW_MILESTONE_VIDEO = false;

/**
 * "Add wallpapers" add-on — withheld while Freemius is the only checkout.
 *
 * The add-on is not a line item: it selects a DIFFERENT pack
 * (`printable-plus-wallpaper` / `digital-plus-wallpaper`), and neither combo
 * has a Freemius plan in `FREEMIUS_PLAN_MAPPING`. Offering it would let a
 * customer pick something that fails at the staging step
 * (`FreemiusPlanNotConfigured`).
 *
 * Read by the two places that would otherwise disagree:
 *   - the checkout pack selector, which decides whether the checkbox renders
 *   - the product page, which decides whether it advertises the add-on and
 *     its price
 * Hiding only the checkbox would leave the product page promising something
 * the checkout cannot sell.
 *
 * NOTHING ELSE IS DISABLED. `WALLPAPER_ADDON_FOR` in `pack-presentation.ts`,
 * the catalog's `wallpaperAddon` data and the backend combo packs are all
 * untouched. To restore: add Freemius plans + mapping entries for both
 * combos, then flip this to `true`.
 */
export const SHOW_WALLPAPER_ADDON = false;
