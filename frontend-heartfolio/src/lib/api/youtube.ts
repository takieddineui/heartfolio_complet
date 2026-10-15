/**
 * Song Poster's YouTube check — `POST /api/v1/youtube/validate/`
 * (`apps/common/views.py`'s `YouTubeValidateView`).
 *
 * SERVER-SIDE ON PURPOSE: YouTube's oEmbed answer carries no CORS header, so
 * the browser cannot ask YouTube itself (see `apps/common/youtube.py`).
 *
 * Every refusal carries a `code` the Studio translates; the backend's
 * `reason` is English and only for logs, so it is not read here.
 */

import { apiFetch } from "./client";

export type YouTubeRefusalCode = "empty" | "notYoutube" | "unavailable" | "checkFailed";

export type YouTubeCheck =
  | { valid: true; videoId: string; title: string; authorName: string; thumbnailUrl: string }
  | { valid: false; code: YouTubeRefusalCode };

const KNOWN_CODES: ReadonlySet<string> = new Set(["empty", "notYoutube", "unavailable", "checkFailed"]);

export async function checkYouTubeLink(url: string, signal?: AbortSignal): Promise<YouTubeCheck> {
  const answer = await apiFetch<Record<string, unknown>>("/youtube/validate", { method: "POST", body: { url }, signal });
  if (answer.valid === true && typeof answer.videoId === "string" && answer.videoId) {
    return {
      valid: true,
      videoId: answer.videoId,
      title: typeof answer.title === "string" ? answer.title : "",
      authorName: typeof answer.authorName === "string" ? answer.authorName : "",
      thumbnailUrl: typeof answer.thumbnailUrl === "string" ? answer.thumbnailUrl : "",
    };
  }
  // An answer this client does not recognise is never treated as a yes.
  const code = typeof answer.code === "string" && KNOWN_CODES.has(answer.code) ? answer.code : "checkFailed";
  return { valid: false, code: code as YouTubeRefusalCode };
}
