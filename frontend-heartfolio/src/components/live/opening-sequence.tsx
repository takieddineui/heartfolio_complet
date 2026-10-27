"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
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
 * FOUR BEATS, ~4.6s: the mark draws itself in (a real SVG path
 * animation — `pathLength` on the same four strokes `Logo`'s mark is
 * built from, not a copy that has drifted from it, see `MARK_PATHS`
 * below), the sparkle catches, the couple's own names and title settle
 * in beneath it, and — if there is one — the FIRST MILESTONE'S OWN
 * PHOTO appears as a glimpse before the whole overlay clears.
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

/** The exact four stroke paths `components/brand/logo.tsx` draws its
 *  mark from, at that component's own `variant="mark"` viewBox (0 0 64
 *  64) — copied rather than imported, because `Logo` is deliberately a
 *  static, always-instant component used in headers and footers
 *  everywhere, and adding a draw-in mode to every place it is already
 *  used is a bigger, riskier change than duplicating four path strings
 *  with a comment explaining why they must stay identical to their
 *  source. */
const MARK_PATHS = [
  "M32 22 A 10 10 0 0 0 14 31.5 L32 50",
  "M41 23 L23 40.5",
  "M23 23 L41 40.5",
  "M32 22 A 10 10 0 0 1 50 31.5 L32 50",
] as const;

export interface OpeningSequenceProps {
  names: string;
  title: string;
  photoUrl?: string;
  onDone: () => void;
  /** The skip button's word, in the order's language (`live-copy.ts`). */
  skipLabel?: string;
  /** The real sequence length in production — overridable ONLY so
   *  tests don't need a genuine 4.6-second real-time wait per case.
   *  Framer Motion's exit transitions run on real animation frames, not
   *  `setTimeout`, so they don't cooperate with fake timers; this prop
   *  is the actual, correct fix for that, not a workaround bolted onto
   *  the test file. */
  durationMs?: number;
}

export function OpeningSequence({ names, title, photoUrl, onDone, skipLabel = "Skip", durationMs = 4600 }: OpeningSequenceProps) {
  const reduceMotion = useReducedMotion();
  const [visible, setVisible] = useState(true);

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

    const timer = setTimeout(() => setVisible(false), durationMs);
    return () => clearTimeout(timer);
  }, [reduceMotion, onDone, durationMs]);

  if (reduceMotion) return null;

  return (
    <AnimatePresence onExitComplete={onDone}>
      {visible && (
        <motion.div
          className={styles.overlay}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.6, ease: EASE } }}
        >
          <motion.svg
            className={styles.mark}
            viewBox="0 0 64 64"
            aria-hidden="true"
            initial="hidden"
            animate="drawn"
          >
            <g fill="none" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor">
              {MARK_PATHS.map((d, i) => (
                <motion.path
                  key={d}
                  d={d}
                  variants={{ hidden: { pathLength: 0, opacity: 0.4 }, drawn: { pathLength: 1, opacity: 1 } }}
                  transition={{ duration: 0.9, ease: EASE, delay: i * 0.12 }}
                />
              ))}
            </g>
            <motion.path
              fill="currentColor"
              stroke="none"
              d="M51 7 L52.8 13.2 L59 15 L52.8 16.8 L51 23 L49.2 16.8 L43 15 L49.2 13.2 Z"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5, ease: EASE, delay: 0.85 }}
              style={{ transformOrigin: "51px 15px" }}
            />
          </motion.svg>

          <motion.p
            className={styles.names}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE, delay: 1.3 }}
          >
            {names}
          </motion.p>

          <motion.h1
            className={styles.title}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE, delay: 1.55 }}
          >
            {title}
          </motion.h1>

          {photoUrl && (
            <motion.div
              className={styles.photo}
              initial={{ opacity: 0, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.9, ease: EASE, delay: 2.3 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element --
                  same reasoning as every other photo in this live page:
                  a private, per-order URL, not a candidate for a shared
                  image CDN cache. */}
              <img src={photoUrl} alt="" />
            </motion.div>
          )}

          <motion.button
            type="button"
            className={styles.skip}
            onClick={() => setVisible(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.7 }}
            transition={{ duration: 0.5, delay: 0.6 }}
          >
            {skipLabel}
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
