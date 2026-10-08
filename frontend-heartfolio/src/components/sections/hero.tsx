"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { ArrowDown, ArrowRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { CelestialSequence } from "@/components/motion/celestial-sequence";
import { KeepsakeVisual } from "@/components/product/keepsake-visual";

const EASE = [0.22, 1, 0.36, 1] as const;

export function Hero() {
  const t = useTranslations("Hero");
  const headlineLines = t("headline").split("\n");

  return (
    <section
      id="hero"
      className="relative flex min-h-[92vh] flex-col justify-end overflow-hidden bg-ink-navy text-parchment"
    >
      {/* Night gradient + candlelight vignette (Design System §4) */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 15% 100%, rgba(201,162,75,0.10), transparent 60%), linear-gradient(180deg, #141b2e 0%, #1d2540 55%, #141b2e 100%)",
        }}
      />
      {/*
        Pass B §14/§15: the star field previously covered the entire hero
        at full density (130 stars) plus 5 drifting hearts, scattered
        directly over the headline and the plain-language definition line —
        competing with the words for attention rather than sitting quietly
        behind the artwork. It was also the source of an ugly artifact: a
        heart path stretched by `preserveAspectRatio="none"` across a wide,
        short viewport reads as a distorted maroon blob, not a heart.
        Reduced density, dropped the hearts entirely here (they add nothing
        the headline doesn't already say), and masked so the stars fade out
        over the text column and stay concentrated behind the artwork —
        texture for the composition, not noise over the copy.

        `hidden lg:block`: the mask assumes the two-column desktop layout
        (text on one side, artwork on the other) and fades out accordingly.
        Below `lg` the text runs full-width with no separate art column for
        the stars to sit behind — the mask's "visible" zone landed squarely
        on top of the headline instead, moon included. The plain gradient
        above already gives mobile its night backdrop; verified on a real
        390px viewport (Pass B §19).
      */}
      <div
        className="pointer-events-none absolute inset-0 hidden h-full w-full opacity-70 [mask-image:linear-gradient(90deg,transparent_0%,transparent_30%,black_62%)] [-webkit-mask-image:linear-gradient(90deg,transparent_0%,transparent_30%,black_62%)] rtl:[mask-image:linear-gradient(270deg,transparent_0%,transparent_30%,black_62%)] rtl:[-webkit-mask-image:linear-gradient(270deg,transparent_0%,transparent_30%,black_62%)] lg:block"
      >
        <CelestialSequence starCount={46} heartCount={0} className="h-full w-full" />
      </div>

      {/*
        ONE PRODUCT, PRESENTED HONESTLY (§1, §14).

        This was a three-piece composition — Love Story Timeline dominant,
        Where We Met and Song Poster as smaller glimpses behind it — built
        to say "Heartfolio is a collection, not a star map generator".

        All three supporting products are now withdrawn (§1), and §14 is
        explicit that a hidden product must not survive as *imagery* either,
        not just as a card or a link. So the glimpses are gone rather than
        re-pointed at some other product: there is no other product. The
        mobile strip below them went for the same reason — its entire job
        was to say "there is more than one of these", which is currently
        untrue, and a strip repeating the same keepsake four times would
        say something worse.

        WHAT THIS COSTS, stated rather than hidden: the hero is now a single
        floating piece in a space art-directed for three, so the right-hand
        composition reads emptier than it was designed to. That is a visual
        call to make deliberately, not something to paper over by quietly
        keeping a withdrawn product on the homepage.

        TODO (§7): the final art-directed hero — originally specced as
        "three keepsakes in a warm minimal interior" — needs re-briefing for
        a single-product storefront before that photography is commissioned.
      */}
      <div
        className="pointer-events-none absolute end-[4%] top-[12%] hidden h-[420px] w-[400px] lg:block"
        aria-hidden="true"
      >
        {/* The dominant piece — Love Story Timeline, not Star Map (Pass A §4).
            Previously framed with a gold border + backdrop-blur + a pure
            60px glow shadow (`--shadow-candle`) — no offset, no direction,
            which reads as a notification badge or an "active" UI state, not
            as a lit, photographed object (Pass B §3). Replaced with a
            plain elevated shadow and a solid mat border the way a real
            print sits inside a frame — the artwork now does the work
            instead of the chrome around it. */}
        <motion.div
          animate={{ y: [0, -12, 0], rotate: [2, -1, 2] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          className="absolute end-0 top-16 w-[230px] rounded-[var(--radius-lg)] border border-candle-white/15 bg-candle-white p-3 shadow-[var(--shadow-float)]"
        >
          <div className="aspect-[4/5] overflow-hidden rounded-[var(--radius-sm)]">
            <KeepsakeVisual productId="love-story-timeline" detailed />
          </div>
        </motion.div>
      </div>

      <div className="relative mx-auto w-full max-w-7xl px-5 pb-24 pt-40 sm:px-8 md:pb-32">
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE }}
          className="text-xs font-medium uppercase tracking-[0.2em] text-champagne-gold/90"
        >
          {t("eyebrow")}
        </motion.p>

        <h1 className="mt-6 max-w-3xl font-serif text-[40px] leading-[1.08] text-parchment sm:text-6xl md:text-7xl">
          {headlineLines.map((line, i) => (
            <motion.span
              key={line}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: EASE, delay: 0.15 + i * 0.15 }}
              className="block text-balance"
            >
              {line}
            </motion.span>
          ))}
        </h1>

        {/* The plain-language definition (Pass A §7). The headline above
            is deliberately emotional rather than descriptive, which meant
            nothing on the page stated in ordinary words what Heartfolio
            actually is — a person skimming, or a model summarising the
            page, had to infer it from context. This says it directly. */}
        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.4 }}
          className="mt-4 max-w-lg font-serif text-xl text-champagne-gold"
        >
          {t("definition")}
        </motion.p>

        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.55 }}
          className="mt-7 max-w-lg text-lg leading-relaxed text-parchment/75"
        >
          {t("subhead")}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.75 }}
          className="mt-10 flex flex-wrap items-center gap-5"
        >
          {/* The hero now sends people to the collection, not straight
              into a picker — see the product first, create second. */}
          <Button variant="onDark" size="lg" asChild>
            <Link href="/products">
              {t("cta")}
              <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
            </Link>
          </Button>
          <Link
            href="/#how-it-works"
            className="group flex items-center gap-2 text-[15px] text-parchment/75 transition-colors hover:text-parchment"
          >
            {t("ctaSecondary")}
            <ArrowDown className="h-4 w-4 transition-transform group-hover:translate-y-0.5" />
          </Link>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 1 }}
          className="mt-8 text-xs uppercase tracking-[0.12em] text-parchment/45"
        >
          {t("trust")}
        </motion.p>

      </div>
    </section>
  );
}
