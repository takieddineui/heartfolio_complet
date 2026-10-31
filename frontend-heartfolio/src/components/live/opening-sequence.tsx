"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useLiveIntroDone } from "./live-intro-state";
import styles from "./opening-sequence.module.css";

/**
 * ---------------------------------------------------------------------
 * THE LIVE PAGE'S OPENING — §10 asked for one explicitly, and got a
 * static block with no entrance instead. This is the actual "opening
 * section," built as its own overlay rather than more markup bolted
 * onto `.opening`, so it can cleanly unmount and hand off to the real,
 * static section underneath rather than needing to BE the real section
 * permanently mid-animation.
 * ---------------------------------------------------------------------
 *
 * THREE BEATS, 3s (27 Oct 2026): the couple's own names and title settle
 * in, and — if there is one — the FIRST MILESTONE'S OWN PHOTO appears as a
 * glimpse before the whole overlay clears. It used to open with the
 * Heartfolio mark drawing itself (4.6s in all); the shared intro in front of
 * every live page (`live-intro.tsx`) draws the mark now, and this starts when
 * it hands over (`useLiveIntroDone`), so the two never play at once.
 *
 * THE PHOTO IS A PRELUDE, NOT A PREVIEW OF WHAT FOLLOWS. The static
 * `.opening` section underneath has never shown a photo at all — the
 * first one properly belongs to its milestone card, further down the
 * page. Showing it once here, briefly, then letting it go, is the same
 * thing a film's title card does with an image that never reappears
 * verbatim: it is allowed to be its own moment. The alternative — never
 * showing a photo here because the page beneath doesn't — would mean
 * "use the couple's own photo" (what was actually asked for) never
 * happens at all.
 *
 * REDUCED MOTION SKIPS ENTIRELY, not just shortens. `useReducedMotion`
 * is checked before the sequence starts; if it is set, `onDone` fires
 * on the next tick and nothing here ever paints. A shortened version of
 * a five-second forced sequence is still a forced sequence.
 *
 * PLAYS ON EVERY FRESH VISIT, no session/localStorage flag to suppress
 * repeat viewings — deliberate, not an oversight. A keepsake is
 * something people return to; the opening is the ceremony, not a
 * one-time onboarding tip to dismiss forever. The always-visible Skip
 * control is the actual answer to "I don't want to watch this again
 * right now," not a remembered preference guessing on the visitor's
 * behalf.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

export interface OpeningSequenceProps {
  names: string;
  title: string;
  photoUrl?: string;
  /** The photo's web copies (`live-photo.ts`): the glimpse is at most 320px. */
  photoSrcSet?: string;
  onDone: () => void;
  /** The skip button's word, in the order's language (`live-copy.ts`). */
  skipLabel?: string;
  /** The real sequence length in production — overridable ONLY so
   *  tests don't need a genuine 3-second real-time wait per case.
   *  Framer Motion's exit transitions run on real animation frames, not
   *  `setTimeout`, so they don't cooperate with fake timers; this prop
   *  is the actual, correct fix for that, not a workaround bolted onto
   *  the test file. */
  durationMs?: number;
}

export function OpeningSequence({ names, title, photoUrl, photoSrcSet, onDone, skipLabel = "Skip", durationMs = 3000 }: OpeningSequenceProps) {
  const reduceMotion = useReducedMotion();
  const [visible, setVisible] = useState(true);
  // Starts when the shared intro hands over; at once where there is none.
  const started = useLiveIntroDone();

  useEffect(() => {
    if (reduceMotion) {
      // Not a shorter version of the sequence — no sequence. See this
      // file's own note on why "shortened" is still the wrong answer.
      // No `setVisible` call needed here: this component returns
      // `null` unconditionally below whenever `reduceMotion` is true,
      // so `visible` state is never read in that branch at all.
      onDone();
      return;
    }
    if (!started) return;

    const timer = setTimeout(() => setVisible(false), durationMs);
    return () => clearTimeout(timer);
  }, [reduceMotion, onDone, durationMs, started]);

  if (reduceMotion) return null;

  return (
    <AnimatePresence onExitComplete={onDone}>
      {visible && (
        <motion.div
          className={styles.overlay}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.6, ease: EASE } }}
        >
          <motion.p
            className={styles.names}
            initial={{ opacity: 0, y: 16 }}
            animate={started ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.7, ease: EASE, delay: 0 }}
          >
            {names}
          </motion.p>

          <motion.h1
            className={styles.title}
            initial={{ opacity: 0, y: 16 }}
            animate={started ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.7, ease: EASE, delay: 0.25 }}
          >
            {title}
          </motion.h1>

          {photoUrl && (
            <motion.div
              className={styles.photo}
              initial={{ opacity: 0, scale: 1.04 }}
              animate={started ? { opacity: 1, scale: 1 } : undefined}
              transition={{ duration: 0.9, ease: EASE, delay: 1.0 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element --
                  same reasoning as every other photo in this live page:
                  a private, per-order URL, not a candidate for a shared
                  image CDN cache. */}
              <img src={photoUrl} srcSet={photoSrcSet} sizes={photoSrcSet ? "(min-width: 500px) 320px, 64vw" : undefined} alt="" />
            </motion.div>
          )}

          <motion.button
            type="button"
            className={styles.skip}
            onClick={() => setVisible(false)}
            initial={{ opacity: 0 }}
            animate={started ? { opacity: 0.7 } : undefined}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            {skipLabel}
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
