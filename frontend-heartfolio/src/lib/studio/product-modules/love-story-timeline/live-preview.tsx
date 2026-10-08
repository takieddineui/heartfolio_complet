"use client";

import { LiveKeepsake } from "@/components/live/live-keepsake";
import type { ThemeSelections } from "@/types/studio";
import type { TimelineValues } from "./initial-state";
import { presetMusicUrl } from "./music-presets";

/**
 * §16 — the Live Pack preview, wired into `ProductModuleConfig.livePreview`.
 *
 * A thin adapter and nothing more. `LiveKeepsake` is the exact component
 * the real, purchased `/live/<id>` page renders — it needs `values`,
 * `themeSelections`, a resolved `media` map and a `locale`, none of which
 * requires an order or an entitlement to exist. The only piece missing in
 * the Studio is `media` in the SHAPE `LiveKeepsake` expects (plain resolved
 * URLs), because Studio state stores `{ assetId, url }` objects instead —
 * this reads `.url` off whatever the customer has already added and passes
 * the rest straight through unchanged.
 *
 * NOTHING IS UPLOADED OR FETCHED TO SHOW THIS. Every URL used here is
 * already sitting in Studio state from whenever the photo/video/audio was
 * added during editing (§7's upload-immediately behaviour, unchanged by
 * the deferred-storage work) — this preview is a pure, local render.
 */
export function TimelineLivePreview({
  values,
  themeSelections,
  locale,
}: {
  values: TimelineValues;
  themeSelections: ThemeSelections;
  locale: string;
}) {
  const media = {
    // §4 — a preset id, resolved to its (currently nonexistent, by
    // decision) static file URL the same way the server does for the real
    // /live/<id> and /ar/<id> payloads — see `presetMusicUrl`'s docstring
    // for why the two must compute the same path.
    backgroundMusic: presetMusicUrl(values.backgroundMusic),
    milestones: values.events.map((event) => ({
      video: event.video?.url ?? null,
      audio: event.audio?.url ?? null,
    })),
  };

  return (
    <LiveKeepsake
      values={values as unknown as Record<string, unknown>}
      themeSelections={themeSelections}
      media={media}
      locale={locale}
    />
  );
}
