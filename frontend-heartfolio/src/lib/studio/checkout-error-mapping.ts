import { ApiError } from "@/lib/api/errors";
import { PartialUploadFailure } from "@/lib/studio/media-values";

/**
 * Error codes `create_order` can return (see `apps/commerce/services.py`)
 * when a project is missing something its renderer requires — currently
 * always a photo's `assetId`, across every product with a real renderer.
 * Their raw messages are written for a developer (e.g. "events[0].photo
 * is required and must include a non-empty string 'assetId'.") and are
 * mapped to `checkout.incompletePhotos` instead of shown as-is. Reachable
 * only as defense in depth — the frontend's own upload gate
 * (`PartialUploadFailure`, below) should already have stopped checkout
 * before a project like this ever reaches `create_order` — but a project
 * restored from an EARLIER session that hit this exact bug, before the
 * fix, could still have one saved with a photo missing its `assetId`.
 */
const INCOMPLETE_PROJECT_ERROR_CODES = new Set([
  "love_story_timeline_invalid_data",
  "song_poster_invalid_data",
  "where_we_met_map_invalid_data",
]);

/**
 * Which translated Shell message (see `lib/studio/i18n.ts`) fits a
 * checkout failure, or `null` for "no special case — show the backend's
 * own 4xx message as-is, or the generic one for a 5xx". Kept
 * framework-free (no component/router/next-intl imports) so it can be
 * unit-tested directly without dragging in everything `checkout-flow.tsx`
 * needs to render.
 *
 * Two distinct messages for a failed upload, not one, because the right
 * next step differs: `PartialUploadFailure.needsRepick` is true only when
 * at least one photo has no file left to retry (see that class's own
 * docstring) — the customer must re-select it. Otherwise every failure
 * was transient (a dropped request, a timeout) and the SAME files are
 * still queued to retry automatically on the next attempt; telling them
 * to "add a photo" when their photo is already sitting there, picked and
 * visible, would be actively confusing.
 */
export function checkoutErrorMessageKey(cause: unknown): "checkout.incompletePhotos" | "checkout.uploadFailedRetry" | null {
  if (cause instanceof PartialUploadFailure) {
    return cause.needsRepick ? "checkout.incompletePhotos" : "checkout.uploadFailedRetry";
  }
  if (cause instanceof ApiError && INCOMPLETE_PROJECT_ERROR_CODES.has(cause.code)) {
    return "checkout.incompletePhotos";
  }
  return null;
}
