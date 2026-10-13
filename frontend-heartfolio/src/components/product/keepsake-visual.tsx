"use client";

import { motion } from "framer-motion";

/**
 * Bespoke, deterministic artwork per product — moved out of
 * `featured-keepsakes.tsx` so the landing collection, the product index
 * and each product page all render the same piece instead of three
 * near-copies. Presentation only: the registry drives the data.
 *
 * `dateLine` / `captionLine` let a larger surface (a product hero) show
 * more of the artwork's detail than a small card does.
 *
 * TODO(HEARTFOLIO-PREDEPLOY):
 * Replace this temporary generated SVG artwork with final Heartfolio
 * product artwork before deployment. These pieces were enriched during
 * Pass B (richer gradients, vignettes, denser linework) so they no longer
 * read as flat placeholders, but they are still generated illustration,
 * not a finished keepsake. Do this during the pre-deployment product-art
 * phase, for every product that exists at that stage, including ones not
 * yet in this file: Love Story Timeline, Where We Met, Moon Phase, Star
 * Map, Song Poster, Birth Poster, Wedding Keepsake, Pet Memorial, and any
 * others added later. The target feel is premium / artistic / emotional /
 * editorial / luxurious / calm / modern — a real finished Heartfolio
 * keepsake, not an AI/SaaS illustration. Swap the relevant branch below
 * for real artwork (or an <Image>) per product; the aspect-ratio wrappers
 * around this component elsewhere already hold either way.
 */
export function KeepsakeVisual({
  productId,
  detailed = false,
  className,
}: {
  productId: string;
  detailed?: boolean;
  className?: string;
}) {
  const wrapper = `relative flex h-full w-full items-center justify-center overflow-hidden ${className ?? ""}`;

  if (productId === "song-poster") {
    return (
      <div
        className={wrapper}
        style={{ background: "linear-gradient(155deg, #f8f1e5 0%, #ecdfc7 60%, #e6d5b8 100%)" }}
      >
        {/* Soft vignette — the difference between "flat color fill" and a
            surface that has been lit and photographed (Pass B §3, §6). */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 50% 15%, transparent 45%, rgba(20,27,46,0.10) 100%)",
          }}
        />
        <svg
          viewBox="0 0 200 200"
          className="absolute inset-0 h-full w-full opacity-[0.1]"
          aria-hidden="true"
          preserveAspectRatio="none"
        >
          <path
            d="M0 170 C 60 140, 140 200, 200 150"
            stroke="#141b2e"
            strokeWidth="3"
            strokeDasharray="10 8"
            fill="none"
          />
        </svg>
        {/* A faint echo of the waveform sits behind the main one, the way a
            printed poster has visible ink depth rather than one flat line. */}
        <svg viewBox="0 0 200 60" className="absolute h-2/5 w-[85%] text-ink-navy/10" aria-hidden="true">
          {Array.from({ length: 34 }).map((_, i) => {
            const h = 5 + Math.abs(Math.sin(i * 0.6 + 0.4)) * 34;
            return <rect key={i} x={i * 6 + 2} y={30 - h / 2} width="2" rx="1" height={h} fill="currentColor" />;
          })}
        </svg>
        <motion.svg
          viewBox="0 0 200 60"
          className="h-1/2 w-4/5 text-dusty-terracotta"
          initial="rest"
          whileHover="hover"
          aria-hidden="true"
        >
          {Array.from({ length: 34 }).map((_, i) => {
            const h = 6 + Math.abs(Math.sin(i * 0.6)) * 40;
            return (
              <motion.rect
                key={i}
                x={i * 6}
                width="2.4"
                rx="1.2"
                fill="currentColor"
                opacity={0.92}
                variants={{
                  rest: { height: h, y: 30 - h / 2 },
                  hover: { height: h * 1.15, y: 30 - (h * 1.15) / 2 },
                }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: i * 0.008 }}
              />
            );
          })}
        </motion.svg>
      </div>
    );
  }

  if (productId === "heart-map") {
    return (
      <div
        className={wrapper}
        style={{ background: "linear-gradient(160deg, #f7f1e6 0%, #ede2cd 100%)" }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 50% 20%, transparent 40%, rgba(20,27,46,0.10) 100%)",
          }}
        />
        <svg viewBox="0 0 160 160" className="h-2/3 w-2/3 text-ink-navy" aria-hidden="true">
          {/* A denser street pattern reads as a real, considered map rather
              than two lonely lines (Pass B §1) — still quiet, still fine
              linework, just more of it. */}
          <path
            d="M-4 118 C 20 108, 32 96, 46 92 S 70 70, 78 52"
            stroke="currentColor"
            strokeWidth="0.7"
            fill="none"
            opacity="0.22"
          />
          <path
            d="M10 140 C 40 120, 30 90, 60 80 S 100 40, 90 20"
            stroke="currentColor"
            strokeWidth="1.2"
            fill="none"
            opacity="0.55"
          />
          <path
            d="M20 30 C 40 45, 55 55, 60 80 S 110 95, 140 84"
            stroke="currentColor"
            strokeWidth="0.7"
            fill="none"
            opacity="0.22"
          />
          <path
            d="M60 90 L60 130 M40 100 L100 100"
            stroke="currentColor"
            strokeWidth="0.6"
            opacity="0.32"
          />
          <circle cx="60" cy="90" r="1.4" fill="currentColor" opacity="0.35" />
          <circle cx="90" cy="20" r="1.2" fill="currentColor" opacity="0.3" />
          <motion.path
            d="M80 66c-8-9-22-9-27 1-5 10 3 19 27 34 24-15 32-24 27-34-5-10-19-10-27-1Z"
            fill="var(--color-dusty-terracotta)"
            initial={{ scale: 0.9 }}
            animate={{ scale: [0.9, 1.05, 0.9] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
            style={{ transformOrigin: "80px 90px" }}
          />
        </svg>
      </div>
    );
  }

  if (productId === "graduation-keepsake") {
    // A boarding pass with a tear-off stub: the airline journey, the first
    // one built. Static on purpose - this is a card thumbnail, and a
    // storefront image should not move.
    return (
      <div
        className={wrapper}
        style={{ background: "linear-gradient(155deg, #0f2742 0%, #173a5e 60%, #e9845f 100%)" }}
      >
        <svg viewBox="0 0 200 120" className="h-3/5 w-5/6" aria-hidden="true">
          <rect x="14" y="22" width="172" height="76" rx="8" fill="#fffaf1" />
          <line x1="132" y1="22" x2="132" y2="98" stroke="#0f2742" strokeWidth="1" strokeDasharray="3 3" opacity="0.4" />
          <text x="26" y="48" fontSize="18" fontWeight="800" fill="#0f2742" fontFamily="system-ui, sans-serif">
            KID
          </text>
          <text x="92" y="48" fontSize="18" fontWeight="800" fill="#0f2742" fontFamily="system-ui, sans-serif">
            NXT
          </text>
          <path d="M70 41h14M80 37l5 4-5 4" stroke="#ff6b4a" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <rect x="26" y="62" width="84" height="4" rx="2" fill="#0f2742" opacity="0.18" />
          <rect x="26" y="72" width="56" height="4" rx="2" fill="#0f2742" opacity="0.18" />
          <g fill="#0f2742">
            {Array.from({ length: 12 }).map((_, i) => (
              <rect key={i} x={142 + i * 3.4} y="32" width={i % 3 === 0 ? 1.8 : 1} height="34" />
            ))}
          </g>
          <circle cx="132" cy="22" r="4" fill="#173a5e" />
          <circle cx="132" cy="98" r="4" fill="#173a5e" />
        </svg>
      </div>
    );
  }

  if (productId === "love-story-timeline") {
    // A horizontal spine with five marked moments — the shape of the
    // product, readable at card size and at hero size.
    return (
      <div
        className={wrapper}
        style={{ background: "linear-gradient(155deg, #f8f1e5 0%, #ecdfc7 60%, #e6d5b8 100%)" }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 50% 15%, transparent 45%, rgba(20,27,46,0.10) 100%)",
          }}
        />
        <svg viewBox="0 0 200 120" className="h-3/5 w-5/6 text-ink-navy" aria-hidden="true">
          {/* A soft glow behind the centre moment — the one the whole piece
              is organised around — rather than a flat dot on a flat line. */}
          <circle cx="100" cy="60" r="10" fill="var(--color-dusty-terracotta)" opacity="0.14" />
          <line
            x1="10"
            y1="60"
            x2="190"
            y2="60"
            stroke="currentColor"
            strokeWidth="0.9"
            opacity="0.4"
          />
          {[26, 66, 100, 138, 176].map((x, i) => (
            <g key={x}>
              <motion.circle
                cx={x}
                cy={60}
                r={i === 2 ? 5 : 3.2}
                fill={i === 2 ? "var(--color-dusty-terracotta)" : "var(--color-champagne-gold)"}
                initial={{ opacity: 0.6 }}
                animate={{ opacity: [0.6, 1, 0.6] }}
                transition={{ duration: 3.4, repeat: Infinity, delay: i * 0.4 }}
              />
              <line
                x1={x}
                y1={i % 2 === 0 ? 60 : 42}
                x2={x}
                y2={i % 2 === 0 ? 78 : 60}
                stroke="currentColor"
                strokeWidth="0.7"
                opacity="0.38"
              />
              <rect
                x={x - 11}
                y={i % 2 === 0 ? 82 : 28}
                width="22"
                height="10"
                rx="2"
                fill="currentColor"
                opacity="0.12"
              />
            </g>
          ))}
        </svg>
      </div>
    );
  }

  return (
    <div
      className={`h-full w-full ${className ?? ""}`}
      style={{ background: "linear-gradient(160deg, #1d2540 0%, #3a2a22 100%)" }}
    />
  );
}
