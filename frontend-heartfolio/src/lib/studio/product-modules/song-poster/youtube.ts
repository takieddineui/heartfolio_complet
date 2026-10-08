/**
 * Client-side mirror of the backend's `extract_video_id` in
 * `apps/common/youtube.py` — same reasoning as `waveform.ts`'s
 * relationship to `waveform.py`, but for a different purpose: not print
 * parity, INSTANT feedback. "That doesn't look like a YouTube link" is
 * knowable the moment someone finishes pasting, with no network round
 * trip. Whether the specific video is actually embeddable right now is
 * NOT something this file can answer — that needs Google's servers, via
 * `YouTubeValidateView`, and stays a real network call.
 *
 * Kept as a genuine second implementation rather than one shared module
 * imported by both runtimes, because Python and TypeScript cannot share
 * source — same constraint `seeded_random.py`/`waveform.ts` already
 * live with. See that pair's docstrings for why parity between two
 * independent implementations has to be proven, not assumed.
 */

const PATH_ID_RE = /^\/(?:shorts\/|embed\/|live\/)?([A-Za-z0-9_-]{11})\/?$/;
const BARE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function extractVideoId(rawUrl: string): string | null {
  let url = (rawUrl || "").trim();
  if (!url) return null;

  if (BARE_ID_RE.test(url)) return url;

  if (!url.includes("://")) url = `https://${url}`;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");

  if ((host === "youtube.com" || host === "music.youtube.com") && parsed.pathname === "/watch") {
    const videoId = parsed.searchParams.get("v");
    return videoId && BARE_ID_RE.test(videoId) ? videoId : null;
  }

  if (host === "youtube.com" || host === "music.youtube.com" || host === "youtu.be") {
    const match = PATH_ID_RE.exec(parsed.pathname);
    if (match) return match[1]!;
  }

  return null;
}
