import styles from "./ending-spark.module.css";

/**
 * A single, slow, endless drift-and-glow — the actual answer to §10's
 * "continued rather than stopped," which the fade-in on the text above
 * it cannot provide by itself: a `Reveal` settles into stillness once
 * it arrives, which is correct for arrival, and is the wrong shape for
 * an ending that is supposed to feel like it keeps going.
 *
 * THE EXACT SPARK FROM THE BRAND MARK, not a new decoration —
 * `components/brand/logo.tsx`'s own accent shape, copied for the same
 * reason `opening-sequence.tsx`'s `MARK_PATHS` copies the mark's own
 * ribbon strokes rather than importing/modifying `Logo`: that component
 * is deliberately static everywhere else it is used, and giving it an
 * animation mode for one caller is a bigger change than duplicating one
 * small path with a comment tying it back to its source.
 */
export function EndingSpark() {
  return (
    <div className={styles.wrap}>
      <svg className={styles.spark} viewBox="43 6 16 17" aria-hidden="true">
        <path fill="currentColor" d="M51 7 L52.8 13.2 L59 15 L52.8 16.8 L51 23 L49.2 16.8 L43 15 L49.2 13.2 Z" />
      </svg>
    </div>
  );
}
