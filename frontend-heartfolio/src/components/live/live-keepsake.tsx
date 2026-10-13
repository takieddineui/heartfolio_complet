"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./live-keepsake.module.css";

import { useReducedMotion } from "framer-motion";
import { SHOW_MILESTONE_VIDEO } from "@/lib/feature-flags";
import { OpeningSequence } from "./opening-sequence";
import { EndingSpark } from "./ending-spark";
import { liveThemeStyle } from "./live-theme";
import { liveMotionStyle } from "./live-motion";
import { MilestoneSpark } from "./milestone-spark";
import { RevealGroup, RevealItem } from "@/components/motion/reveal";

/**
 * ---------------------------------------------------------------------
 * §10 — THE DIGITAL KEEPSAKE
 * ---------------------------------------------------------------------
 * "Printable = keepsake you look at. Digital = story you experience."
 *
 * So this is not the poster rendered in HTML. §10 asks for an opening
 * section, an animated chronological journey with milestones activating as
 * the reader progresses, a photo lightbox, optional media, and an ending
 * that feels continued rather than stopped.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not reproduce the poster's geometry. §10 says not to force the
 * physical layout onto the web — a vertical composition becomes vertical
 * scrolling, which is what a phone already is.
 *
 * Music NEVER autoplays. §10 requires it user-controlled, and browsers
 * block autoplay anyway — but the reason to build it this way is that a
 * keepsake opening with unexpected sound, possibly in public, is a bad
 * first moment for a gift.
 *
 * The duration counter shows years, months and days. §10 is explicit that
 * exact minutes should not be the default merely because it is possible —
 * "4 years, 2 months" is meaningful; "2,247,840 minutes" is a novelty.
 *
 * ---------------------------------------------------------------------
 * TODO (deferred, not forgotten) — a different live experience per
 * PRINT LAYOUT, not the one universal one above.
 * ---------------------------------------------------------------------
 * This component is deliberately the same for all six of `TIMELINE_
 * LAYOUTS` (`layouts.ts`: neat-stack, alternating-tilt, overlapping-
 * cascade, dotted-branching, horizontal-polaroid, horizontal-circles)
 * — the "does not reproduce the poster's geometry" principle a few
 * lines up IS that decision, not an accident. Recorded here as a real
 * to-do rather than only said in conversation, matching the identical
 * note in Song Poster's own `song-live-keepsake.tsx` — that product's
 * live page currently has the SAME "one experience for every theme"
 * shape, for the SAME borrowed reasoning this file's own principle
 * supplied.
 *
 * WHAT WOULD ACTUALLY CHANGE:
 * - The live payload would need `themeSelections.layout` included
 *   (already IS sent today — this component already receives it,
 *   just never reads it for anything beyond nothing; check before
 *   assuming a payload change is even needed here, unlike Song
 *   Poster's live payload, which drops `theme` on purpose today).
 * - This component would become a dispatcher, or would grow real
 *   per-layout branches inside it — six small differences, or six
 *   variants, not necessarily six separate files; `horizontal-
 *   polaroid`/`horizontal-circles` are the two layouts furthest from
 *   this component's own vertical-scroll assumption and are likely
 *   where the real design thinking starts.
 * - EACH LAYOUT NEEDS ITS OWN ANSWER to what "digital = experience,
 *   not the poster's geometry" means for it specifically — this is
 *   the actual work. A horizontal print laid out as a scroll story is
 *   not obviously wrong exactly as this component already does it
 *   today; the six layouts may turn out to warrant real per-layout
 *   difference, or may turn out not to. That determination has not
 *   been made, which is the point of leaving this as a TODO rather
 *   than a decision already reached.
 *
 * MOTION. How a milestone arrives, how its photograph settles and the one
 * spark at its node are named in `live-motion.ts` and described in
 * `milestone-spark.tsx`; they extend the restrained style of the opening and the
 * ending, and never a scroll listener (the observer below is the only trigger).
 * Photograph parallax, particles, an animated accent, cursor/tilt effects and
 * time-of-day mood are deferred on purpose (CLAUDE.md): the photographs are
 * delivered unsized, so nothing may transform them heavily yet.
 *
 * NOT STARTED HERE. Flagging the shape of the question, not answering
 * it — this is real design work across six layouts, not a mechanical
 * follow-up to Song Poster's own version of the same to-do.
 */

interface Milestone {
  date?: string;
  title?: string;
  description?: string;
  location?: string;
  photo?: { url?: string };
}

export function LiveKeepsake({
  values,
  themeSelections,
  media,
  locale,
}: {
  values: Record<string, unknown>;
  themeSelections: Record<string, string | number>;
  media: { backgroundMusic: string | null; milestones: { video: string | null; audio: string | null }[] };
  locale: string;
}) {
  const milestones = (values.events as Milestone[] | undefined) ?? [];
  const people = ((values.people as { name: string }[] | undefined) ?? []).map((p) => p.name);
  const [active, setActive] = useState(0);
  // Milestones the reader has actually reached (crossed the middle of the
  // screen), for the one-time spark at each node. Not `active`: that starts at 0
  // with nothing reached, and only ever names the latest one.
  const [reached, setReached] = useState<ReadonlySet<number>>(() => new Set());
  // A SCRIPTED effect needs its own check: the global reduced-motion rule only
  // shortens CSS animations, it cannot stop script from creating one. `=== false`
  // so an unknown preference (before the client has read it) never sparks.
  const motionAllowed = useReducedMotion() === false;
  const [openingDone, setOpeningDone] = useState(false);
  // A STABLE identity, not the inline `() => setOpeningDone(true)` this
  // used to be passed as directly. `OpeningSequence`'s own effect
  // depends on `onDone` (correctly, per its own exhaustive-deps fix) —
  // a fresh function every render of THIS component (which happens for
  // reasons that have nothing to do with the opening: `active`
  // changing as the reader scrolls, `lightbox` opening) would restart
  // that effect and, with it, the whole 4.6s timer, silently
  // preventing the sequence from ever completing on a page with any
  // scroll activity during its own play.
  const handleOpeningDone = useCallback(() => setOpeningDone(true), []);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [musicOn, setMusicOn] = useState(false);
  const stepRefs = useRef<(HTMLElement | null)[]>([]);
  const musicRef = useRef<HTMLAudioElement | null>(null);

  /**
   * How many of the reader's voice notes are playing right now.
   *
   * A count rather than a boolean because two clips can overlap — the
   * reader can start a second before the first ends, and a boolean would
   * let the first one's `ended` bring the music back up underneath the
   * second.
   */
  const [voicesPlaying, setVoicesPlaying] = useState(0);

  /**
   * §10 — background music, wired up.
   *
   * WHAT WAS HERE BEFORE: a toggle that flipped `musicOn` and changed its
   * own label, and nothing else. No audio element existed anywhere in this
   * component, so selecting a preset in the Studio and shipping the mp3
   * could never have produced sound.
   *
   * THE FADE IS NOT DECORATION. Music arriving at full volume on a page
   * someone is reading quietly is startling, and cutting out mid-note
   * sounds broken rather than finished. One second each way is enough to
   * read as intentional.
   *
   * DUCKING UNDER VOICE NOTES: a recorded message is the point of the
   * keepsake and the music is the background to it, so the music fades out
   * and pauses whenever a voice note is playing, then fades back in when
   * the last one stops — but only if the reader still has music on.
   *
   * `play()` is only ever called in the wake of the toggle, which is a real
   * user gesture; browsers refuse autoplay otherwise, which is exactly why
   * §10 makes music opt-in and why the toggle starts off.
   */
  useEffect(() => {
    const element = musicRef.current;
    if (!element) return;

    const shouldPlay = musicOn && voicesPlaying === 0;
    const FADE_MS = 1000;
    const STEP_MS = 50;
    let cancelled = false;

    if (shouldPlay) {
      element.volume = 0;
      void element.play().catch(() => {
        // Refused playback is not worth an error state: the keepsake reads
        // perfectly without sound, and the toggle still reflects intent.
      });
    }

    const from = element.volume;
    const to = shouldPlay ? 1 : 0;
    const startedAt = Date.now();

    const timer = window.setInterval(() => {
      if (cancelled) return;
      const progress = Math.min(1, (Date.now() - startedAt) / FADE_MS);
      element.volume = Math.max(0, Math.min(1, from + (to - from) * progress));
      if (progress >= 1) {
        window.clearInterval(timer);
        // Paused only after the fade completes, never before, or the last
        // of the sound is cut off instead of fading.
        if (!shouldPlay) element.pause();
      }
    }, STEP_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [musicOn, voicesPlaying]);

  /**
   * Scroll-triggered progression (§10).
   *
   * `IntersectionObserver` rather than a scroll handler: a scroll listener
   * fires on every frame and would run layout maths on a phone for the
   * whole length of the story. The observer wakes only when a milestone
   * actually crosses the threshold.
   */
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const index = stepRefs.current.indexOf(entry.target as HTMLElement);
            if (index >= 0) {
              setActive(index);
              if (motionAllowed) setReached((seen) => (seen.has(index) ? seen : new Set(seen).add(index)));
            }
          }
        }
      },
      // Triggers when a milestone reaches the middle of the screen, so the
      // one being read is the one marked active — not the one just entering
      // from the bottom.
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
    );

    for (const node of stepRefs.current) if (node) observer.observe(node);
    return () => observer.disconnect();
  }, [milestones.length, motionAllowed]);

  /** §10 — years, months and days. See the note above on why not minutes. */
  const duration = useMemo(() => {
    const dates = milestones.map((m) => m.date).filter(Boolean).sort() as string[];
    if (dates.length < 2) return null;
    const from = new Date(dates[0]!);
    const to = new Date(dates[dates.length - 1]!);
    if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf())) return null;

    let years = to.getFullYear() - from.getFullYear();
    let months = to.getMonth() - from.getMonth();
    let days = to.getDate() - from.getDate();
    if (days < 0) {
      months -= 1;
      days += new Date(to.getFullYear(), to.getMonth(), 0).getDate();
    }
    if (months < 0) {
      years -= 1;
      months += 12;
    }
    return { years, months, days };
  }, [milestones]);

  const formatDate = (value?: string) => {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.valueOf())
      ? value
      : date.toLocaleDateString(locale, { year: "numeric", month: "long" });
  };

  return (
    // Colours and fonts come from the Studio's own palette and typography
    // tokens (`live-theme.ts`), so all eight palettes and all four type
    // choices reach the recipient. `data-palette` stays as a hook for tests
    // and any future per-palette tweak; it styles nothing by itself.
    <main className={styles.root} data-palette={themeSelections.palette} style={{ ...liveThemeStyle(themeSelections), ...liveMotionStyle() }}>
      {!openingDone && (
        <OpeningSequence
          names={people.join(" & ")}
          title={String(values.posterTitle ?? "")}
          photoUrl={milestones[0]?.photo?.url}
          onDone={handleOpeningDone}
        />
      )}

      {/* --- opening ------------------------------------------------- */}
      <section className={styles.opening}>
        <p className={styles.names}>
          {/*
            §3 — "&" is the ONLY separator, at every count, never a
            translated word and never a middle dot. This page previously
            joined with " · ", a third independent implementation that had
            drifted from the rule entirely — not a locale bug, but a real
            inconsistency found while looking for one.
          */}
          {people.join(" & ")}
        </p>
        <h1 className={styles.title}>{String(values.posterTitle ?? "")}</h1>
        {Boolean(values.subtitle) && <p className={styles.subtitle}>{String(values.subtitle)}</p>}
        {duration && (
          <p className={styles.duration}>
            {duration.years > 0 && `${duration.years}y `}
            {duration.months > 0 && `${duration.months}m `}
            {duration.days > 0 && `${duration.days}d`}
          </p>
        )}
        <span className={styles.scrollHint} aria-hidden="true" />
      </section>

      {/* --- the journey --------------------------------------------- */}
      <ol className={styles.journey}>
        {milestones.map((milestone, index) => (
          <li
            key={index}
            ref={(node) => {
              stepRefs.current[index] = node;
            }}
            className={index <= active ? `${styles.step} ${styles.stepActive}` : styles.step}
          >
            <div className={styles.spine} aria-hidden="true">
              <span className={styles.node} />
              {/* One spark, the first time the reader reaches this milestone. */}
              {reached.has(index) && <MilestoneSpark />}
            </div>

            <div className={styles.stepBody}>
              <p className={styles.stepDate}>{formatDate(milestone.date)}</p>
              <h2 className={styles.stepTitle}>{milestone.title}</h2>
              {milestone.description && <p className={styles.stepText}>{milestone.description}</p>}
              {milestone.location && <p className={styles.stepPlace}>{milestone.location}</p>}

              {milestone.photo?.url && (
                <button
                  type="button"
                  className={styles.photoButton}
                  onClick={() => setLightbox(index)}
                  aria-label={milestone.title ?? "Open photo"}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={milestone.photo.url} alt="" className={styles.photo} />
                </button>
              )}

              {/*
                §5 media. Rendered only where it exists — §14's rule that
                the story is complete without it applies here too, so a
                milestone with no video is not a milestone with an empty
                player.

                `preload="none"`: eight clips would otherwise begin
                downloading the moment the page opens, on a phone, before
                the reader has reached any of them.
              */}
              {/*
                VIDEO IS WITHHELD FOR NOW — deliberately, and the logic is
                kept rather than deleted so re-enabling it is one constant.
                Everything else about video still works: it is uploaded,
                validated, stored, promoted on payment, and played by the
                AR scene.
              */}
              {SHOW_MILESTONE_VIDEO && media.milestones[index]?.video && (
                <video
                  className={styles.media}
                  controls
                  playsInline
                  preload="none"
                  src={media.milestones[index]!.video!}
                  onPlay={() => setVoicesPlaying((n) => n + 1)}
                  onPause={() => setVoicesPlaying((n) => Math.max(0, n - 1))}
                  onEnded={() => setVoicesPlaying((n) => Math.max(0, n - 1))}
                />
              )}
              {media.milestones[index]?.audio && (
                <audio
                  className={styles.media}
                  controls
                  preload="none"
                  /*
                    THE `src` WAS MISSING. This element rendered whenever a
                    milestone had a voice note, with controls and no source
                    — so a customer who paid for Digital or Complete, and
                    recorded a message, got a player that did nothing at
                    all. The data was reaching this component the whole
                    time; it just never reached the element.
                  */
                  src={media.milestones[index]!.audio!}
                  onPlay={() => setVoicesPlaying((n) => n + 1)}
                  onPause={() => setVoicesPlaying((n) => Math.max(0, n - 1))}
                  onEnded={() => setVoicesPlaying((n) => Math.max(0, n - 1))}
                />
              )}
            </div>
          </li>
        ))}
      </ol>

      {/* --- ending --------------------------------------------------- */}
      <section className={styles.ending}>
        <RevealGroup>
          {Boolean(values.dedication) && (
            <RevealItem as="p" className={styles.dedication}>
              {String(values.dedication)}
            </RevealItem>
          )}
          <RevealItem as="p" className={styles.endingText}>
            {String(values.endingText ?? "")}
          </RevealItem>
          <RevealItem as="p" className={styles.colophon}>
            <a href="https://theheartfolio.com">Made with Heartfolio · theheartfolio.com</a>
          </RevealItem>
        </RevealGroup>
        <EndingSpark />
      </section>

      {/*
        §10 — music is opt-in and stays opt-in. The control is always
        visible so turning it OFF is as easy as turning it on, which
        matters more: someone may open this somewhere they cannot have
        sound.
      */}
      {/*
        The music itself. Hidden: the toggle above is its entire interface,
        and a second set of native controls would invite two sources of
        truth for one sound. `loop` because a keepsake is read at whatever
        pace the reader chooses, and silence halfway through reads as a
        fault.

        `preload="auto"`, NOT "none". With "none" the file was not fetched
        until the toggle was pressed, so the one-second fade ran to full
        volume against silence while the download was still in flight and
        the music arrived late and abruptly — the opposite of the fade's
        purpose. The cost is real and accepted: a few megabytes fetched on
        every open, including for readers who never turn music on.

        The milestone players below stay `preload="none"` deliberately —
        eight clips would otherwise all download at once.
      */}
      {media.backgroundMusic && (
        <audio ref={musicRef} src={media.backgroundMusic} loop preload="auto" hidden />
      )}

      {media.backgroundMusic && (
        <button
          type="button"
          className={styles.musicToggle}
          aria-pressed={musicOn}
          onClick={() => setMusicOn((on) => !on)}
        >
          {musicOn ? "♪ on" : "♪ off"}
        </button>
      )}

      {/* --- lightbox ------------------------------------------------- */}
      {lightbox !== null && milestones[lightbox]?.photo?.url && (
        <div
          className={styles.lightbox}
          role="dialog"
          aria-modal="true"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={milestones[lightbox]!.photo!.url} alt={milestones[lightbox]!.title ?? ""} />
          <button type="button" className={styles.lightboxClose} onClick={() => setLightbox(null)}>
            ×
          </button>
        </div>
      )}
    </main>
  );
}
