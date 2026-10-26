import { LiveKeepsake } from "@/components/live/live-keepsake";
import { SongLiveKeepsake } from "@/components/live-song/song-live-keepsake";
import { ReasonsLivePage } from "@/components/live-reasons/reasons-live-page";
import type { ReasonsExperienceData } from "@/components/live-reasons/experience-data";
import { GraduationLivePage } from "@/components/live-graduation/graduation-live-page";
import type { GraduationExperienceData } from "@/components/live-graduation/experience-data";

/*
 * The live keepsake's payload and the one place that turns it into a page.
 * Moved out of `app/[locale]/live/[liveId]/page.tsx` (26 Oct 2026) so the
 * dev-only capture page (`app/[locale]/capture/[product]`) renders exactly
 * what a recipient sees, through the same dispatch, instead of a copy of it.
 */

/**
 * ONE PAYLOAD SHAPE PER PRODUCT, matching `live_views.py`'s own dispatch
 * exactly (`_build_ar_payload`, `_build_song_poster_live_payload`,
 * `_build_reasons_live_payload`) — not one shape with optional fields for
 * whichever product didn't send them.
 * Song Poster's own payload has none of Love Story Timeline's AR-era
 * fields (`arId`, `scene`, `level`, `targetUrl`) at all; giving it the
 * same interface with those marked optional would let a bug silently
 * type-check (reading `payload.scene` on a Song Poster response is a
 * real mistake this union catches at compile time that an all-optional
 * shape would not).
 */
interface LoveStoryTimelinePayload {
  productId: string | null;
  scene: string;
  level: string;
  locale: string;
  values: Record<string, unknown>;
  themeSelections: Record<string, string | number>;
  media: {
    backgroundMusic: string | null;
    milestones: { video: string | null; audio: string | null }[];
  };
}

interface SongPosterLivePayload {
  productId: "song-poster";
  locale: string;
  values: {
    track: string;
    artist: string;
    dedication?: string;
    photo?: { url: string } | null;
    youtubeVideoId: string | null;
  };
}

/** Reasons I Love You: `values` is already the experience's own shape, with
 * fresh photo links (`experience-data.ts`). */
interface ReasonsLivePayload {
  productId: "reasons-i-love-you";
  locale: string;
  values: ReasonsExperienceData;
}

/** Graduation Keepsake: likewise the experience's own shape, with fresh
 * links for every photo, drawing and voice message. */
interface GraduationLivePayload {
  productId: "graduation-keepsake";
  locale: string;
  values: GraduationExperienceData;
}

export type LivePayload = LoveStoryTimelinePayload | SongPosterLivePayload | ReasonsLivePayload | GraduationLivePayload;

/**
 * An EXPLICIT type predicate, not a bare `payload.productId ===
 * "song-poster"` check inline — TypeScript's own discriminated-union
 * narrowing does not reliably narrow here, because
 * `LoveStoryTimelinePayload.productId` is the wide `string | null`
 * rather than a literal: TS cannot rule out that a value of that wide
 * type might also equal `"song-poster"`, so an inline check narrows to
 * a union of BOTH payload shapes' `values` instead of just Song
 * Poster's. A user-defined type guard sidesteps that by telling
 * TypeScript directly how to narrow, rather than asking it to infer
 * that two differently-typed discriminants are meant to be disjoint.
 */
function isSongPosterPayload(payload: LivePayload): payload is SongPosterLivePayload {
  return payload.productId === "song-poster";
}

/** Same reason for an explicit predicate as `isSongPosterPayload` above. */
function isGraduationPayload(payload: LivePayload): payload is GraduationLivePayload {
  return payload.productId === "graduation-keepsake";
}

function isReasonsPayload(payload: LivePayload): payload is ReasonsLivePayload {
  return payload.productId === "reasons-i-love-you";
}

/** Renders a live payload as the recipient's page. `liveId` is what the
 *  Reasons and Graduation pages ask for again when a photo link expires. */
export function LivePayloadView({ payload, liveId }: { payload: LivePayload; liveId: string }) {
  // Dispatched by `productId`, matching `live_views.py`'s own dispatch
  // exactly (`_build_ar_payload` vs `_build_song_poster_live_payload`) —
  // Song Poster's own digital keepsake is a genuinely different
  // component, not a themed variant of `LiveKeepsake`, the same way its
  // backend payload is a genuinely different shape, not `LiveKeepsake`'s
  // shape with fields left empty.
  if (isSongPosterPayload(payload)) {
    return <SongLiveKeepsake values={payload.values} locale={payload.locale} />;
  }

  if (isGraduationPayload(payload)) {
    // The order's locale, as for every live page.
    return <GraduationLivePage liveId={liveId} initial={payload.values} locale={payload.locale} />;
  }

  if (isReasonsPayload(payload)) {
    // The order's locale, for the same reason as `LiveKeepsake` below.
    return <ReasonsLivePage liveId={liveId} initial={payload.values} locale={payload.locale} />;
  }

  return (
    <LiveKeepsake
      values={payload.values}
      themeSelections={payload.themeSelections}
      media={payload.media}
      // The locale the ORDER was placed in, not the URL's. A recipient
      // opening an Arabic keepsake from an English link should see the
      // keepsake they were given (§12's same reasoning for receipts).
      locale={payload.locale}
    />
  );
}
