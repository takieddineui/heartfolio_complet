"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { API_BASE_PATH } from "@/lib/api/client";
import type { ReasonsExperienceData } from "./experience-data";
import { ReasonsKeepsake } from "./reasons-keepsake";

/**
 * The purchased `/live/<id>` page for Reasons I Love You.
 *
 * WHY THIS WRAPPER EXISTS: a reason's photo is a presigned link that lasts
 * five minutes (`R2_PRESIGNED_URL_EXPIRY_SECONDS`), and the photos here load
 * lazily, only when their reason is opened. A recipient who takes their time
 * would open reason seven after its link has died. Love Story Timeline's live
 * page never meets this, because it loads every photo with the page.
 *
 * So when a photo fails to load, this asks the backend once for the same
 * payload again, through the same-origin proxy (no trailing slash: the
 * rewrite adds it), with fresh links and the same access rules, and swaps
 * the links in. At most once every 20 seconds, so a photo that is genuinely
 * gone cannot loop.
 */
const REFRESH_COOLDOWN_MS = 20_000;

/** The page's own address, without query or fragment: the link the share
 * button shares. Read through `useSyncExternalStore` because it exists only in
 * the browser; the server renders no link, and hydration does not mismatch. */
function cleanLocation(): string {
  try {
    const url = new URL(window.location.href);
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch {
    return window.location.href;
  }
}
const subscribeNever = () => () => undefined;

export function ReasonsLivePage({ liveId, initial, locale }: { liveId: string; initial: ReasonsExperienceData; locale: string }) {
  const [data, setData] = useState(initial);
  const shareUrl = useSyncExternalStore(subscribeNever, cleanLocation, () => null);
  const lastRefresh = useRef(0);

  const refreshPhotos = useCallback(async () => {
    const now = Date.now();
    if (now - lastRefresh.current < REFRESH_COOLDOWN_MS) return;
    lastRefresh.current = now;
    try {
      const response = await fetch(`${API_BASE_PATH}/live/${encodeURIComponent(liveId)}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { values?: ReasonsExperienceData };
      const fresh = payload.values?.reasons;
      if (!Array.isArray(fresh)) return;
      setData((current) => ({
        ...current,
        reasons: current.reasons.map((reason, index) => ({ ...reason, photo: fresh[index]?.photo ?? null })),
      }));
    } catch {
      /* the photo stays as it is; the reason's words are still there */
    }
  }, [liveId]);

  return <ReasonsKeepsake data={data} locale={locale} fill="viewport" shareUrl={shareUrl} onPhotoError={() => void refreshPhotos()} />;
}
