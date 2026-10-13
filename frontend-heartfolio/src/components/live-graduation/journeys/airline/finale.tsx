"use client";

import { useRef, useState } from "react";
import styles from "./airline.module.css";
import type { FinaleProps } from "../types";
import { AIRLINE_WORDS } from "./words";

/**
 * The finale: the plane rolls down the runway and takes off, then the ending
 * message arrives. Under reduced motion (or if the browser cannot animate) the
 * plane stays put and the message appears straight away.
 */
export function AirlineFinale({ ctx, onDone, done, ending }: FinaleProps) {
  const words = AIRLINE_WORDS[ctx.story.lang];
  const jetRef = useRef<SVGSVGElement | null>(null);
  const [busy, setBusy] = useState(false);

  const takeOff = async () => {
    if (busy || done) return;
    setBusy(true);
    ctx.sfx.play("finale");
    const jet = jetRef.current;
    if (ctx.motionAllowed && jet && typeof jet.animate === "function") {
      // Direction-aware: the plane flies toward the END of the line, so it
      // leaves left in Arabic, and its nose tilts the matching way.
      const dir = ctx.story.dir === "rtl" ? -1 : 1;
      await jet
        .animate(
          [
            { transform: "translate(0, 0)" },
            { transform: `translate(${220 * dir}px, 0)`, offset: 0.45 },
            { transform: `translate(${380 * dir}px, -60px) rotate(${-12 * dir}deg)`, offset: 0.75 },
            { transform: `translate(${640 * dir}px, -260px) rotate(${-18 * dir}deg)` },
          ],
          { duration: 2600, easing: "cubic-bezier(.5,0,.6,1)", fill: "both" }
        )
        .finished.catch(() => undefined);
    }
    onDone();
  };

  return (
    <section className={`${styles.finale} ${done ? styles.finaleDone : ""}`} aria-label={words.finale}>
      <div className={styles.scene} aria-hidden="true">
        <div className={styles.runway} />
        <svg ref={jetRef} className={styles.jet} viewBox="0 -8 148 40" focusable="false">
          <path
            d="M0 22 Q10 12 40 12 H120 Q138 12 146 20 Q138 30 120 30 H40 Q14 30 0 22Z"
            fill="#fffaf1"
            stroke="#0f2742"
            strokeWidth="2"
          />
          <path d="M70 20 L50 -6 H64 L96 20Z" fill="#ff6b4a" />
          <path d="M6 20 L0 2 H12 L22 18Z" fill="#ff6b4a" />
        </svg>
      </div>
      <button type="button" className={styles.takeoff} onClick={() => void takeOff()} disabled={busy || done}>
        <span aria-hidden="true">✈ </span>
        {words.finale}
      </button>
      <div className={styles.endingBox} inert={!done} aria-hidden={!done}>
        {ending}
      </div>
    </section>
  );
}
