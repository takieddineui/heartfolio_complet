import styles from "./milestone-spark.module.css";
import { SPARK_PATH, SPARK_VIEWBOX } from "./live-motion";

/**
 * One spark, caught once at a milestone's node the first time the reader
 * reaches it: the brand's own accent shape (the one the opening pops in), not a
 * burst and not a loop. It scales up, holds, and fades; the CSS animation runs
 * once (`both`) and the element then stays invisible, so scrolling back and
 * forth never replays it.
 *
 * The caller mounts it only when motion is allowed (`useReducedMotion`), and the
 * stylesheet hides it under `prefers-reduced-motion` as well: a scripted effect
 * must not rely on the global CSS rule, which shortens CSS animations but cannot
 * stop script from creating one.
 *
 * CENTRED BY FLEX, NOT BY OFFSETS: it fills its positioned parent and centres
 * its mark with `align-items`/`justify-content`, so it sits on the node in both
 * left-to-right and right-to-left pages with no direction-specific code.
 */
export function MilestoneSpark() {
  return (
    <span className={styles.spark} aria-hidden="true">
      <svg className={styles.mark} viewBox={SPARK_VIEWBOX} focusable="false">
        <path fill="currentColor" d={SPARK_PATH} />
      </svg>
    </span>
  );
}
