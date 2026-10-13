"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * One voice message at a time. Starting a second stops the first; a message
 * that ends, errors or is unmounted releases its element. The audio file is
 * the organiser's upload re-encoded to AAC/MP4 by the backend, so a plain
 * <audio> plays it in every browser including iOS Safari.
 */
export function useVoice() {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const stop = useCallback(() => {
    const element = audio.current;
    audio.current = null;
    if (element) {
      element.onended = null;
      element.onerror = null;
      element.pause();
    }
    setPlayingId(null);
  }, []);

  const toggle = useCallback(
    (id: string, url: string) => {
      if (audio.current && playingId === id) {
        stop();
        return;
      }
      stop();
      const element = new Audio(url);
      element.onended = () => stop();
      element.onerror = () => stop();
      audio.current = element;
      setPlayingId(id);
      void element.play().catch(() => stop());
    },
    [playingId, stop]
  );

  useEffect(() => stop, [stop]);

  // Stable identity unless something changed, so the journey context built
  // from it is not rebuilt on every render.
  return useMemo(() => ({ playingId, toggle, stop }), [playingId, toggle, stop]);
}
