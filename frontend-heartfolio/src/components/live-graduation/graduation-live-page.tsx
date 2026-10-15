"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { API_BASE_PATH } from "@/lib/api/client";
import type { GraduationExperienceData } from "./experience-data";
import { GraduationKeepsake } from "./graduation-keepsake";

/**
 * The purchased `/live/<id>` page for Graduation Keepsake.
 *
 * Every photo, drawing and voice message is a presigned link that lasts five
 * minutes (`R2_PRESIGNED_URL_EXPIRY_SECONDS`), and this page is long: photos
 * load lazily as the graduate scrolls, and a voice message loads when it is
 * played. When one fails, this asks the backend for the same payload again
 * (same-origin proxy, no trailing slash: the rewrite adds it) and swaps the
 * fresh links in, keeping everything the graduate has opened. At most once
 * every 20 seconds, so a file that is genuinely gone cannot loop. The same
 * rule as Reasons I Love You's page.
 */
const REFRESH_COOLDOWN_MS = 20_000;

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

export function GraduationLivePage({ liveId, initial, locale }: { liveId: string; initial: GraduationExperienceData; locale: string }) {
  const [data, setData] = useState(initial);
  const shareUrl = useSyncExternalStore(subscribeNever, cleanLocation, () => null);
  const lastRefresh = useRef(0);

  const refreshMedia = useCallback(async () => {
    const now = Date.now();
    if (now - lastRefresh.current < REFRESH_COOLDOWN_MS) return;
    lastRefresh.current = now;
    try {
      const response = await fetch(`${API_BASE_PATH}/live/${encodeURIComponent(liveId)}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { values?: GraduationExperienceData };
      // The words cannot change after purchase; only the links are swapped,
      // so nothing the graduate has opened resets.
      if (payload.values?.grad) setData(payload.values);
    } catch {
      /* the words are still there; the file stays as it is */
    }
  }, [liveId]);

  return <GraduationKeepsake data={data} locale={locale} fill="viewport" shareUrl={shareUrl} onMediaError={() => void refreshMedia()} />;
}
