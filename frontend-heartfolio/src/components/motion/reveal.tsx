"use client";

import { motion, type Variants } from "framer-motion";
import type { ReactNode } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

interface RevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  as?: "div" | "span";
  once?: boolean;
}

const variants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

/**
 * Reveal — the marketing-site "fade and drift" pattern from the
 * Heartfolio motion philosophy. Never a slide, never a bounce:
 * elements settle into place like light finding a room.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 16,
  once = true,
}: RevealProps) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once, margin: "-80px" }}
      variants={{
        hidden: { opacity: 0, y },
        visible: { opacity: 1, y: 0 },
      }}
      transition={{ duration: 0.8, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

interface RevealGroupProps {
  children: ReactNode;
  className?: string;
  stagger?: number;
  /** False holds the group hidden (a live page under the shared intro);
   * it reveals once true and in view. Default true. */
  active?: boolean;
}

/** Wrap a set of Reveal children to stagger them 80–120ms apart. */
export function RevealGroup({ children, className, stagger = 0.1, active = true }: RevealGroupProps) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      {...(active ? { whileInView: "visible", viewport: { once: true, margin: "-80px" } } : { animate: "hidden" })}
      transition={{ staggerChildren: stagger }}
    >
      {children}
    </motion.div>
  );
}

export function RevealItem({
  children,
  className,
  y = 16,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  y?: number;
  /** Mirrors `Reveal`'s own `as` prop — added because `live-keepsake.
   *  tsx`'s ending section needed its dedication/endingText/colophon to
   *  stay `<p>` elements, not become `<div>`s just for the stagger
   *  animation. Defaults to `"div"`, so every existing caller (the
   *  marketing sections, `create-page-content.tsx`, `product-view.tsx`)
   *  is unaffected. `"h1"`/`"h2"` added when `checkout-flow.tsx`'s
   *  success screen first tried to use this without them — collapsing
   *  a real `<h2>` into a styled `<span>` to fit the original `"div" |
   *  "p" | "span"` union would have been a genuine accessibility
   *  regression at exactly the moment a screen reader heading matters
   *  most: confirming a payment actually succeeded. */
  as?: "div" | "p" | "span" | "h1" | "h2";
}) {
  const Component = motion[as];
  return (
    <Component
      className={className}
      variants={{
        hidden: { opacity: 0, y },
        visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
      }}
    >
      {children}
    </Component>
  );
}

export { variants as revealVariants };
