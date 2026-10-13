"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import styles from "./live-graduation.module.css";
import { buildStory, fill } from "./model";
import { SHARED_COPY } from "./copy";
import { hasJourney, JOURNEY_LOADERS } from "./journeys/registry";
import type { JourneyContext, JourneyDefinition } from "./journeys/types";
import { SfxEngine } from "./shared/sfx";
import { useParticles } from "./shared/use-particles";
import { useVoice } from "./shared/use-voice";
import { Dialog } from "./shared/dialog";

/**
 * ---------------------------------------------------------------------
 * THE GRADUATION KEEPSAKE - the shell every journey runs inside
 * ---------------------------------------------------------------------
 * One story, told by whichever JOURNEY the creator chose. This component owns
 * what no journey should reimplement: the flow (start -> page -> finale), the
 * overlays (photo viewer, particles, toast, controls), sound on/off, voice
 * playback and the "start again" reset. A journey (`journeys/<id>/`) owns how
 * each moment looks, sounds and moves.
 *
 * THE PURCHASED /live/<id> PAGE AND THE STUDIO'S LIVE TAB ARE THIS SAME
 * COMPONENT. Because the Studio embeds it, nothing here may assume it owns the
 * window: everything is positioned inside `.frame` (never `position: fixed`),
 * nothing touches <html> or <body>, and scroll effects use observers rooted at
 * the frame's own scroller. The parent gives the frame a height (the live route
 * wraps it in 100dvh; the Studio's preview pane already has one).
 *
 * Motion: scripted effects (particles, the tear, the plane) run only when
 * `useReducedMotion() === false`, so an undecided preference never triggers
 * one; CSS motion is also switched off by the module's reduced-motion rule.
 * Sound: effects only, synthesised, started only by the visitor's own tap, and
 * the graduate can mute them. No background music.
 */

export interface LiveGraduationProps {
  values: Record<string, unknown>;
  themeSelections: Record<string, string | number>;
  /** The site locale: the fallback keepsake language when the creator chose none. */
  locale: string;
  /** True inside the Studio's Live tab. */
  embedded?: boolean;
}

const LEAVE_MS = 700;

export function LiveGraduation({ values, themeSelections, locale, embedded = false }: LiveGraduationProps) {
  const story = useMemo(() => buildStory(values, locale), [values, locale]);
  const copy = SHARED_COPY[story.lang];

  const requested = typeof themeSelections.journey === "string" ? themeSelections.journey : "airline";
  const journeyId = hasJourney(requested) ? requested : "airline";

  // `loaded` carries the id it was loaded for, so a journey change shows the
  // loading state for an instant rather than the previous journey's page.
  const [loaded, setLoaded] = useState<{ id: string; definition: JourneyDefinition } | null>(null);
  useEffect(() => {
    let cancelled = false;
    JOURNEY_LOADERS[journeyId]!().then(
      (definition) => {
        if (!cancelled) setLoaded({ id: journeyId, definition });
      },
      () => undefined
    );
    return () => {
      cancelled = true;
    };
  }, [journeyId]);
  const journey = loaded?.id === journeyId ? loaded.definition : null;

  const motionAllowed = useReducedMotion() === false;
  // Elements held in state (callback refs), not ref objects: the journey
  // context carries them to observers and particle bursts, and a render-time
  // value that closes over `ref.current` is exactly what must not be passed
  // down.
  const [frameEl, setFrameEl] = useState<HTMLDivElement | null>(null);
  const [scrollerEl, setScrollerEl] = useState<HTMLDivElement | null>(null);

  const [runKey, setRunKey] = useState(0);
  const [started, setStarted] = useState(false);
  const [startLeaving, setStartLeaving] = useState(false);
  const [finaleDone, setFinaleDone] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const sfx = useMemo(() => new SfxEngine(), []);
  const soundAllowed = soundOn && story.options.sound;
  useEffect(() => {
    sfx.setEnabled(soundAllowed);
  }, [sfx, soundAllowed]);
  useEffect(() => {
    if (journey) sfx.setKit(journey.kit);
  }, [journey, sfx]);
  useEffect(() => () => sfx.dispose(), [sfx]);

  const voice = useVoice();
  const { canvasRef, burstAt, cheer, clear } = useParticles(
    frameEl,
    journey?.particle,
    journey?.particleColors ?? [],
    motionAllowed
  );

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    []
  );

  const leaveTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    },
    []
  );

  const reset = useCallback(() => {
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    voice.stop();
    clear();
    setLightbox(null);
    setStarted(false);
    setStartLeaving(false);
    setFinaleDone(false);
    setRunKey((key) => key + 1);
  }, [voice, clear]);

  // A different journey (the Studio's picker) is a different story-telling:
  // start it from its opening.
  const previousJourney = useRef(journeyId);
  useEffect(() => {
    if (previousJourney.current !== journeyId) {
      previousJourney.current = journeyId;
      reset();
    }
  }, [journeyId, reset]);

  const begin = useCallback(async () => {
    setStarted(true);
    // The opening fades out over the page rather than vanishing - unless the
    // visitor prefers reduced motion, in which case it is gone at once.
    if (!motionAllowed) return;
    setStartLeaving(true);
    leaveTimer.current = window.setTimeout(() => setStartLeaving(false), LEAVE_MS);
  }, [motionAllowed]);

  const share = useCallback(async () => {
    let url = "";
    try {
      const target = new URL(window.location.href);
      target.hash = "";
      url = target.toString();
    } catch {
      url = window.location.href;
    }
    const data = {
      title: fill(copy.pageLabel, { name: story.grad.fullName, year: story.grad.year ?? "" }),
      text: story.ending.sub || story.ending.line,
      url,
    };
    if (typeof navigator.share === "function") {
      try {
        await navigator.share(data);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast(copy.copied);
    } catch {
      showToast(copy.copyFailed);
    }
  }, [copy, story, showToast]);

  const ctx: JourneyContext | null = useMemo(
    () =>
      journey
        ? {
            story,
            lang: story.lang,
            copy,
            sfx,
            motionAllowed,
            embedded,
            burstAt,
            openLightbox: setLightbox,
            voice,
            scrollEl: scrollerEl,
          }
        : null,
    [journey, story, copy, sfx, motionAllowed, embedded, burstAt, voice, scrollerEl]
  );

  const onFinaleDone = useCallback(() => {
    setFinaleDone(true);
    sfx.play("win");
    cheer();
  }, [sfx, cheer]);

  const stops = story.path.stops;
  const lightboxStop = lightbox !== null ? stops[((lightbox % stops.length) + stops.length) % stops.length] : null;

  const showShare = story.options.share && !embedded;

  const ending = (
    <div className={styles.ending}>
      <h2 className={styles.endingLine}>{story.ending.line}</h2>
      {story.ending.sub ? <p className={styles.endingSub}>{story.ending.sub}</p> : null}
      <div className={styles.actions}>
        {showShare ? (
          <button type="button" className={styles.btnPrimary} onClick={() => void share()}>
            {copy.share}
          </button>
        ) : null}
        <button type="button" className={styles.btnGhost} onClick={reset}>
          {copy.again}
        </button>
      </div>
      {story.options.branding ? <p className={styles.brand}>Made with Heartfolio</p> : null}
    </div>
  );

  const Start = journey?.Start;
  const Page = journey?.Page;
  const Finale = journey?.Finale;

  return (
    <div
      ref={setFrameEl}
      className={`${styles.frame} ${journey?.rootClass ?? ""}`}
      lang={story.lang}
      dir={story.dir}
      data-journey={journeyId}
      data-started={started ? "true" : "false"}
      aria-busy={journey ? undefined : true}
    >
      {ctx && Page && Finale ? (
        <div
          key={`page-${runKey}`}
          ref={setScrollerEl}
          className={styles.scroller}
          data-hidden={started ? undefined : "true"}
          // The page is rendered before it is started so its images load, but
          // it must not be reachable (tab order, assistive tech) until it opens.
          inert={!started || lightbox !== null}
          role="region"
          aria-label={fill(copy.pageLabel, { name: story.grad.fullName, year: story.grad.year ?? "" })}
        >
          <Page ctx={ctx} started={started} />
          <Finale ctx={ctx} onDone={onFinaleDone} done={finaleDone} ending={ending} />
        </div>
      ) : null}

      {ctx && Start && (!started || startLeaving) ? (
        <div key={`start-${runKey}`} className={styles.startLayer} data-leaving={startLeaving ? "true" : undefined}>
          <Start ctx={ctx} onBegin={begin} />
          <div className={styles.startFoot}>
            {story.options.sound ? (
              <button
                type="button"
                className={styles.chip}
                aria-pressed={soundOn}
                onClick={() => setSoundOn((value) => !value)}
              >
                {soundOn ? copy.soundOn : copy.soundOff}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {started ? (
        <div className={styles.controls}>
          {story.options.sound ? (
            <button
              type="button"
              className={styles.iconButton}
              aria-pressed={soundOn}
              aria-label={soundOn ? copy.soundOn : copy.soundOff}
              onClick={() => setSoundOn((value) => !value)}
            >
              <span aria-hidden="true">{soundOn ? "🔊" : "🔈"}</span>
            </button>
          ) : null}
          {showShare ? (
            <button type="button" className={styles.iconButton} aria-label={copy.share} onClick={() => void share()}>
              <span aria-hidden="true">↗</span>
            </button>
          ) : null}
        </div>
      ) : null}

      <canvas ref={canvasRef} className={styles.fx} aria-hidden="true" />

      <Dialog
        open={lightbox !== null && lightboxStop !== null}
        label={lightboxStop ? `${lightboxStop.year} ${lightboxStop.caption}`.trim() : ""}
        onClose={() => setLightbox(null)}
        backdropClassName={styles.lightbox}
        className={styles.lightboxPanel}
      >
        {lightboxStop ? (
          <figure className={styles.lightboxFigure}>
            {lightboxStop.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={lightboxStop.photo} alt={lightboxStop.caption} decoding="async" />
            ) : null}
            <figcaption>{[lightboxStop.year, lightboxStop.caption].filter(Boolean).join(" · ")}</figcaption>
          </figure>
        ) : null}
        <button type="button" className={styles.lightboxClose} onClick={() => setLightbox(null)} aria-label={copy.close}>
          <span aria-hidden="true">✕</span>
        </button>
        {stops.length > 1 ? (
          <>
            <button
              type="button"
              className={`${styles.lightboxNav} ${styles.lightboxPrev}`}
              onClick={() => setLightbox((index) => (index ?? 0) - 1)}
              aria-label={copy.prevPhoto}
            >
              <span aria-hidden="true">‹</span>
            </button>
            <button
              type="button"
              className={`${styles.lightboxNav} ${styles.lightboxNext}`}
              onClick={() => setLightbox((index) => (index ?? 0) + 1)}
              aria-label={copy.nextPhoto}
            >
              <span aria-hidden="true">›</span>
            </button>
          </>
        ) : null}
      </Dialog>

      <div className={styles.toast} role="status" aria-live="polite" data-show={toast ? "true" : undefined}>
        {toast}
      </div>
    </div>
  );
}
