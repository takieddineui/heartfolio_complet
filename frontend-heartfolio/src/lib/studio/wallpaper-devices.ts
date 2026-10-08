/**
 * ---------------------------------------------------------------------
 * WALLPAPER DEVICES (§4)
 * ---------------------------------------------------------------------
 * Three dedicated renders — phone, desktop, tablet — not scaled copies of
 * the print designs. §4 is explicit that a wallpaper is its own composition,
 * and the reason is the safe zones below: a print has none, a phone screen
 * is mostly occupied by things the OS draws on top.
 *
 * Watch faces were considered and explicitly skipped.
 *
 * SAFE ZONES ARE THE WHOLE POINT
 * ------------------------------
 * A wallpaper that puts a couple's names behind the lock-screen clock is
 * worse than a scaled print — it fails at the one thing it was made for.
 * Each device therefore declares the fraction of the canvas that must stay
 * clear of anything that matters:
 *
 *   phone   — the clock and date sit high on the lock screen, and the home
 *             indicator plus the first icon row eat the bottom. Generous on
 *             both, because this is the device people actually use.
 *   tablet  — same idea, smaller proportions: the screen is bigger so the
 *             furniture occupies less of it.
 *   desktop — a menu bar at the top, a dock at the bottom, and a column of
 *             desktop icons down the leading edge. The leading inset is
 *             expressed logically, not as "left", because an Arabic desktop
 *             places that column on the right (§15).
 *
 * THESE NUMBERS WANT A REAL DEVICE. §4 defers the pixel spec deliberately
 * ("not something to spec pixel-by-pixel now"), so these are defensible
 * starting values chosen from where OS furniture actually sits — not
 * measured against a screenshot. They are in one place so correcting them
 * after looking at a real phone is a single edit.
 */

export interface WallpaperDevice {
  id: string;
  /** Portrait-or-landscape as the device is actually held. */
  width: number;
  height: number;
  /** Fractions of the canvas to keep clear of meaningful content. */
  safeTop: number;
  safeBottom: number;
  /** Leading edge — left in LTR, right in RTL. Desktop icon column. */
  safeLeading: number;
  labelKey: string;
}

export const WALLPAPER_DEVICES: WallpaperDevice[] = [
  {
    // 19.5:9, the shape most modern phones actually are.
    id: "phone",
    width: 1290,
    height: 2796,
    safeTop: 0.18,
    safeBottom: 0.12,
    safeLeading: 0,
    labelKey: "wallpaper.phone",
  },
  {
    // 3:4, matching a large tablet held upright.
    id: "tablet",
    width: 2048,
    height: 2732,
    safeTop: 0.12,
    safeBottom: 0.08,
    safeLeading: 0,
    labelKey: "wallpaper.tablet",
  },
  {
    // 16:9 at 4K. Downscales cleanly to every common desktop resolution;
    // upscaling from 1080p would not.
    id: "desktop",
    width: 3840,
    height: 2160,
    safeTop: 0.06,
    safeBottom: 0.1,
    safeLeading: 0.1,
    labelKey: "wallpaper.desktop",
  },
];

/**
 * Target ids keep the `wallpaper-` prefix: Django's `infer_delivery_type`
 * classifies by prefix when a bundle pack has no single delivery type of
 * its own, exactly as `print-` does for the print targets.
 */
export function wallpaperTargetId(deviceId: string): string {
  return `wallpaper-${deviceId}`;
}

export function allWallpaperTargets(): { id: string; device: WallpaperDevice }[] {
  return WALLPAPER_DEVICES.map((device) => ({ id: wallpaperTargetId(device.id), device }));
}
