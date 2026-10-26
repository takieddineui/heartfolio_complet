/**
 * The storefront's product captures are recorded from the REAL live pages,
 * rendered by a dev-only capture page (`app/[locale]/capture/[product]`)
 * with fictional sample payloads that the backend's real builders produced
 * (`render_marketing_samples`). See `scripts/captures/record.mjs`.
 *
 * LOCKED: the page, its photo route and the proxy all answer 404 unless the
 * dev server was started with `HEARTFOLIO_CAPTURE=1`, and never in a
 * production build, whatever the environment says. Nothing here may become
 * reachable on the live site.
 */
export function captureModeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.HEARTFOLIO_CAPTURE === "1" && env.NODE_ENV !== "production";
}

/** Where `record.mjs` unpacks the backend's bundle (git-ignored). */
export const CAPTURE_WORK_DIR = ".captures-work";

export const CAPTURE_PRODUCTS = [
  "love-story-timeline",
  "reasons-i-love-you",
  "graduation-keepsake",
  "song-poster",
] as const;
export type CaptureProduct = (typeof CAPTURE_PRODUCTS)[number];

export const CAPTURE_LOCALES = ["en", "fr", "ar"] as const;

export function isCaptureProduct(value: string): value is CaptureProduct {
  return (CAPTURE_PRODUCTS as readonly string[]).includes(value);
}

/** A file name the photo route will serve: no paths, no surprises. */
export const CAPTURE_ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
