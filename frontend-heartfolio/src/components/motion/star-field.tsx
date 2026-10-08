"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";

interface Star {
  x: number;
  y: number;
  r: number;
  delay: number;
}

function makeStars(seed: number, count: number): Star[] {
  // Small deterministic pseudo-random generator so server/client match.
  let s = seed;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  return Array.from({ length: count }, () => ({
    x: rand() * 100,
    y: rand() * 100,
    r: 0.4 + rand() * 1.1,
    delay: rand() * 2.2,
  }));
}

/**
 * StarField — the "goosebumps moment" from the UX doc, rendered as an
 * ambient hero backdrop: stars appear one by one, like a sky slowly
 * developing rather than a spinner loading.
 */
export function StarField({
  count = 90,
  className,
  seed = 7,
  twinkle = false,
}: {
  count?: number;
  className?: string;
  seed?: number;
  /** When true, stars twinkle continuously instead of settling once — used
   * where we want a livelier, "alive" feel (product cards, mood previews). */
  twinkle?: boolean;
}) {
  const stars = useMemo(() => makeStars(seed, count), [seed, count]);

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={className}
    >
      {stars.map((star, i) =>
        twinkle ? (
          <motion.circle
            key={i}
            cx={star.x}
            cy={star.y}
            r={star.r}
            fill="var(--color-champagne-gold)"
            initial={{ opacity: 0.3 }}
            animate={{ opacity: [0.3, 0.95, 0.3], scale: [0.85, 1.15, 0.85] }}
            transition={{
              duration: 2.4 + (star.delay % 2),
              delay: star.delay * 0.6,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        ) : (
          <motion.circle
            key={i}
            cx={star.x}
            cy={star.y}
            r={star.r}
            fill="var(--color-champagne-gold)"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.9, 0.55] }}
            transition={{
              duration: 1.8,
              delay: star.delay,
              ease: "easeOut",
              times: [0, 0.6, 1],
            }}
          />
        )
      )}
    </svg>
  );
}
