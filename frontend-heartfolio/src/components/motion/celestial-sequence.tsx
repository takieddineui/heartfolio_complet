"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";

interface Star {
  x: number;
  y: number;
  r: number;
  delay: number;
}

interface Heart {
  x: number;
  size: number;
  delay: number;
  duration: number;
}

/** Small deterministic PRNG so server/client markup always matches. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function makeStars(seed: number, count: number): Star[] {
  const rand = seeded(seed);
  return Array.from({ length: count }, () => ({
    x: rand() * 100,
    y: rand() * 65, // keep stars in the upper portion, leaving room for the moon
    r: 0.4 + rand() * 1.1,
    delay: rand() * 1.6,
  }));
}

function makeHearts(seed: number, count: number): Heart[] {
  const rand = seeded(seed);
  return Array.from({ length: count }, () => ({
    x: 10 + rand() * 80,
    size: 4 + rand() * 3.5,
    delay: 2.6 + rand() * 3,
    duration: 7 + rand() * 4,
  }));
}

/**
 * CelestialSequence — the brand's signature "goosebumps moment":
 * stars shine in first, a small moon rises and glows softly, then a few
 * hearts drift upward and fade, looping gently forever after. Built as one
 * deterministic SVG so it renders identically on server and client.
 */
export function CelestialSequence({
  className,
  seed = 11,
  starCount = 90,
  heartCount = 5,
}: {
  className?: string;
  seed?: number;
  starCount?: number;
  heartCount?: number;
}) {
  const stars = useMemo(() => makeStars(seed, starCount), [seed, starCount]);
  const hearts = useMemo(() => makeHearts(seed + 1, heartCount), [seed, heartCount]);

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={className}
    >
      {/* Phase 1 — stars shine in, then twinkle continuously */}
      {stars.map((star, i) => (
        <motion.circle
          key={`star-${i}`}
          cx={star.x}
          cy={star.y}
          r={star.r}
          fill="var(--color-champagne-gold)"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{
            opacity: [0, 0.95, 0.35, 0.95, 0.35],
            scale: [0.6, 1, 0.85, 1, 0.85],
          }}
          transition={{
            duration: 3.6,
            delay: star.delay,
            times: [0, 0.18, 0.4, 0.7, 1],
            repeat: Infinity,
            repeatDelay: 0.4,
            ease: "easeInOut",
          }}
        />
      ))}

      {/* Phase 2 — a small moon rises softly after the stars settle */}
      <motion.g
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.4, delay: 1.9, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.g
          animate={{ opacity: [0.85, 1, 0.85] }}
          transition={{ duration: 4.5, delay: 1.9, repeat: Infinity, ease: "easeInOut" }}
        >
          <circle cx="82" cy="16" r="7" fill="var(--color-champagne-gold)" opacity="0.08" />
          <path
            d="M84 10a8 8 0 1 0 6 11 6.2 6.2 0 0 1-6-11Z"
            fill="var(--color-champagne-gold)"
            opacity="0.9"
          />
        </motion.g>
      </motion.g>

      {/* Phase 3 — hearts drift upward and fade, looping gently forever */}
      {hearts.map((heart, i) => (
        <motion.path
          key={`heart-${i}`}
          d={`M0 ${1.1} c-${heart.size * 0.45} -${heart.size * 0.5}, -${heart.size * 1.2} ${
            heart.size * 0.05
          }, -${heart.size * 0.15} ${heart.size * 0.9}C${heart.size * 0.5} ${
            heart.size * 1.5
          }, ${heart.size * 0.5} ${heart.size * 1.5}, ${heart.size * 1.35} ${
            heart.size * 0.9
          }c${heart.size * 1.05} -${heart.size * 0.85}, ${heart.size * 0.3} -${
            heart.size * 1.5
          }, -${heart.size * 0.2} -${heart.size * 0.9}Z`}
          fill="var(--color-dusty-terracotta)"
          initial={{ opacity: 0, x: heart.x, y: 100 }}
          animate={{
            opacity: [0, 0.75, 0.75, 0],
            y: [100, 70, 40, 10],
          }}
          transition={{
            duration: heart.duration,
            delay: heart.delay,
            times: [0, 0.15, 0.75, 1],
            repeat: Infinity,
            repeatDelay: 1.2,
            ease: "easeInOut",
          }}
        />
      ))}
    </svg>
  );
}
