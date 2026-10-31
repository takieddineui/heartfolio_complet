import { SPARK_PATH, SPARK_VIEWBOX } from "@/lib/brand/mark";
import styles from "./ending-spark.module.css";

/**
 * A single, slow, endless drift-and-glow — the actual answer to §10's
 * "continued rather than stopped," which the fade-in on the text above
 * it cannot provide by itself: a `Reveal` settles into stillness once
 * it arrives, which is correct for arrival, and is the wrong shape for
 * an ending that is supposed to feel like it keeps going.
 *
 * THE EXACT SPARK FROM THE BRAND MARK, not a new decoration: its
 * geometry comes from `lib/brand/mark.ts`, the one source of the mark (31 Oct
 * 2026). Its colour is the page's accent on purpose: it is part of the
 * keepsake's palette here, not the logo.
 */
export function EndingSpark() {
  return (
    <div className={styles.wrap}>
      <svg className={styles.spark} viewBox={SPARK_VIEWBOX} aria-hidden="true">
        <path fill="currentColor" d={SPARK_PATH} />
      </svg>
    </div>
  );
}
