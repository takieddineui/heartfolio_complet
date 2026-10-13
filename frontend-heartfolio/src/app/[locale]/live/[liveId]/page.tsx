import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { LiveKeepsake } from "@/components/live/live-keepsake";
import { SongLiveKeepsake } from "@/components/live-song/song-live-keepsake";
import { LiveGraduation } from "@/components/live-graduation/live-graduation";
import { getBackendOrigin } from "@/lib/backend-origin";


/**
 * §10 — the Digital keepsake.
 *
 * A hosted page rather than the self-contained HTML file it used to be.
 * That changed because §5's media cannot be embedded: a 50MB clip becomes
 * roughly 67MB of base64, and eight of them make a file nothing will open.
 *
 * Same access model as the AR page (§21f): no session, one generic 404 for
 * every failure, `noindex`, not linked from anywhere. The person opening it
 * is the gift recipient, who has no Heartfolio account and never will.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Heartfolio",
  robots: { index: false, follow: false, nocache: true },
};

type Params = Promise<{ locale: string; liveId: string }>;

/**
 * TWO PAYLOAD SHAPES, matching `live_views.py`'s own dispatch exactly
 * (`_build_ar_payload` vs `_build_song_poster_live_payload`) — not one
 * shape with optional fields for whichever product didn't send them.
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

/**
 * Graduation Keepsake: the Studio's own `values` shape (flat keys, groups as
 * arrays) with every media value already turned into a fresh `{ url }` by the
 * backend (`graduation_keepsake/live_payload.py`), plus the chosen journey.
 * Not Love Story Timeline's shape and not Song Poster's: a third one.
 */
interface GraduationLivePayload {
  productId: "graduation-keepsake";
  locale: string;
  values: Record<string, unknown>;
  themeSelections: { journey: string };
}

type LivePayload = LoveStoryTimelinePayload | SongPosterLivePayload | GraduationLivePayload;

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

function isGraduationPayload(payload: LivePayload): payload is GraduationLivePayload {
  return payload.productId === "graduation-keepsake";
}

/**
 * SERVER-SIDE FETCH, SO IT CANNOT USE `apiFetch`.
 *
 * `apiFetch` builds a RELATIVE url (`/api/backend/...`) because it exists
 * for the browser, where that path is same-origin and carries the guest
 * session cookie first-party. This page is a server component
 * (`force-dynamic`), and on the server a relative url has no origin to
 * resolve against — `fetch` throws immediately, the `catch` below calls
 * `notFound()`, and the recipient sees "this page wandered off" for a
 * keepsake that exists and was paid for. The request never leaves the frontend's server,
 * which is why nothing appears in the browser's network tab or in
 * Django's access log.
 *
 * Same reasoning and same constant as `catalog-server.ts`: go to the
 * backend origin directly. There is no cookie to forward — the live
 * endpoint is `AllowAny` and deliberately session-less (§21f), since the
 * person opening it is the gift recipient, who has no Heartfolio account.
 */
const REQUEST_TIMEOUT_MS = 8000;

async function fetchLivePayload(origin: string, liveId: string): Promise<LivePayload> {
  const response = await fetch(
    `${origin}/api/v1/live/${encodeURIComponent(liveId)}/`,
    {
      headers: { Accept: "application/json" },
      // Never cache a keepsake: the values can be corrected after purchase.
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }
  );
  if (!response.ok) {
    throw new Error(`Live experience request failed: ${response.status}`);
  }
  return (await response.json()) as LivePayload;
}

export default async function LivePage({ params }: { params: Params }) {
  const { locale, liveId } = await params;
  setRequestLocale(locale);

  // Resolved BEFORE the try, on purpose. The catch below turns every failure
  // into a 404 — correct for "this keepsake is unavailable" (it must not reveal
  // which of several reasons, §21f), and exactly wrong for a missing
  // BACKEND_API_ORIGIN, which would show every recipient "this page wandered
  // off" for a keepsake that exists. A configuration error is the same for every
  // id, so throwing it reveals nothing about any of them.
  const origin = getBackendOrigin();

  let payload: LivePayload;
  try {
    payload = await fetchLivePayload(origin, liveId);
  } catch {
    // One outcome for every failure, matching Django's single 404 —
    // distinguishing them here would leak the same information one layer
    // up (§21f).
    notFound();
  }

  // Dispatched by `productId`, matching `live_views.py`'s own dispatch
  // exactly (`_build_ar_payload` vs `_build_song_poster_live_payload`) —
  // Song Poster's own digital keepsake is a genuinely different
  // component, not a themed variant of `LiveKeepsake`, the same way its
  // backend payload is a genuinely different shape, not `LiveKeepsake`'s
  // shape with fields left empty.
  if (isSongPosterPayload(payload)) {
    return <SongLiveKeepsake values={payload.values} />;
  }

  if (isGraduationPayload(payload)) {
    // The keepsake is a self-contained frame that fills whatever height it is
    // given (it is also embedded in the Studio, where the preview pane gives it
    // one), so on this page that height is the whole viewport. `dvh`, not `vh`:
    // on a phone the address bar must not hide the bottom of the keepsake.
    return (
      <div style={{ height: "100dvh" }}>
        <LiveGraduation
          values={payload.values}
          themeSelections={payload.themeSelections}
          // The keepsake's own language (chosen by the creator) wins inside
          // the component; this is only the fallback when none was chosen.
          locale={payload.locale}
        />
      </div>
    );
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
