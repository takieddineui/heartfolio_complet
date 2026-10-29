"use client";

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { INTRO_DONE_EVENT, INTRO_STATE_ID, LIVE_READY_EVENT } from "./live-intro-ids";

/**
 * Whether the shared intro (`live-intro.tsx`) has handed over. The intro is
 * driven by two small inline scripts, not by React, so it plays from first
 * paint and never waits on hydration; they record its state on the
 * `#hf-intro-state` marker ("playing", then "done") and fire
 * `heartfolio:intro-done` on the window. A product starts its own opening
 * when this turns true (`useLiveIntroDone`).
 *
 * Without the intro (the dev capture page, the Studio's preview) nothing is
 * waited for: the hook is true at once.
 */
const IntroPresent = createContext(false);


function subscribe(onChange: () => void) {
  window.addEventListener(INTRO_DONE_EVENT, onChange);
  return () => window.removeEventListener(INTRO_DONE_EVENT, onChange);
}

function introIsDone() {
  return document.getElementById(INTRO_STATE_ID)?.getAttribute("data-s") !== "playing";
}

export function useLiveIntroDone(): boolean {
  const present = useContext(IntroPresent);
  // On the server, and while hydrating, the intro is assumed to be playing
  // wherever it is present; React then reads the marker and re-renders.
  return useSyncExternalStore(subscribe, introIsDone, () => !present);
}

/**
 * Wraps a live page. `present`: the intro is rendered in front of it. The
 * READY signal is sent once React has hydrated the page under the intro,
 * which is what the intro holds for (`live-intro.tsx`).
 */
export function LiveIntroFrame({ present, children }: { present: boolean; children: ReactNode }) {
  useEffect(() => {
    if (!present) return;
    (window as unknown as { __hfLiveReady?: boolean }).__hfLiveReady = true;
    window.dispatchEvent(new Event(LIVE_READY_EVENT));
  }, [present]);
  return <IntroPresent.Provider value={present}>{children}</IntroPresent.Provider>;
}
