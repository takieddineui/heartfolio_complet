import type { ValidationResult } from "@/types/studio";
import type { SongPosterValues } from "./initial-state";
import { extractVideoId } from "./youtube";

/**
 * Domain rules the generic schema validator can't express — same
 * division of labour as `validateTimeline`'s own docstring describes:
 * "is this field filled in" is generic; "does this look like a real
 * YouTube link, and has it actually been confirmed" is this product's
 * own business.
 *
 * TWO SEPARATE CHECKS, ON PURPOSE. `youtubeUrl` not parsing as a video
 * id at all is catchable the instant someone finishes typing, with no
 * network call — `looksLikeYoutube` reports that. Whether THIS SPECIFIC
 * video is genuinely embeddable right now can only come from Google's
 * servers, so this function does not attempt it: `youtubeVideoId` is
 * set (or not) by whatever called `YouTubeValidateView` and stored the
 * result, and this validator just checks it is actually present before
 * treating the project as checkout-ready. A customer who edits the URL
 * after a successful check invalidates it implicitly, because nothing
 * here re-stamps `youtubeVideoId` — see `initial-state.ts`'s own note.
 */
export function validateSongPoster(values: SongPosterValues): ValidationResult {
  const errors: ValidationResult["errors"] = {};

  if (values.youtubeUrl && !extractVideoId(values.youtubeUrl)) {
    errors.youtubeUrl = { code: "notYoutube" };
  } else if (values.youtubeUrl && !values.youtubeVideoId) {
    errors.youtubeUrl = { code: "notValidated" };
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
