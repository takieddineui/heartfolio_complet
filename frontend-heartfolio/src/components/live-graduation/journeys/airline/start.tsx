"use client";

import { useRef, useState } from "react";
import styles from "./airline.module.css";
import { fill } from "../../model";
import type { StartProps } from "../types";
import { AIRLINE_WORDS } from "./words";
import { PlaneIcon } from "./plane";

/**
 * The opening: a boarding pass with a tear-off stub. Tapping it tears the stub
 * away (a scripted effect, so it only runs when motion is allowed) and the
 * page opens behind it. The whole pass is one real <button>, so it is reachable
 * and operable from the keyboard.
 */
export function AirlineStart({ ctx, onBegin }: StartProps) {
  const { story, copy } = ctx;
  const words = AIRLINE_WORDS[story.lang];
  const flight = story.flight;
  const stubRef = useRef<HTMLSpanElement | null>(null);
  const mainRef = useRef<HTMLSpanElement | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (busy) return;
    setBusy(true);
    ctx.sfx.play("start");
    const stub = stubRef.current;
    if (ctx.motionAllowed && stub && typeof stub.animate === "function") {
      const dir = story.dir === "rtl" ? -1 : 1;
      mainRef.current?.animate?.([{ opacity: 1 }, { opacity: 0, transform: "translateY(-30px)" }], {
        duration: 500,
        delay: 900,
        fill: "both",
      });
      await stub
        .animate(
          [
            { transform: "none" },
            { transform: `rotate(${4 * dir}deg) translateY(6px)`, offset: 0.3 },
            { transform: `rotate(${24 * dir}deg) translate(${30 * dir}px, 120vh)` },
          ],
          { duration: 1100, easing: "cubic-bezier(.5,0,.8,.4)", fill: "both" }
        )
        .finished.catch(() => undefined);
    }
    await onBegin();
  };

  const fromCode = flight.fromCode || "KID";
  const toCode = flight.toCode || "NXT";
  const airline = flight.airline || words.defaultAirline;

  return (
    <section className={styles.start} aria-label={words.start}>
      <div className={styles.gateTop}>
        <strong>{fill(words.welcome, { name: story.grad.name })}</strong>
        <span>{[airline, story.grad.school].filter(Boolean).join(" · ")}</span>
      </div>
      <button type="button" className={styles.pass} onClick={() => void go()} disabled={busy}>
        <span ref={mainRef} className={styles.passMain}>
          <span className={styles.airlineRow}>
            <span>{airline}</span>
            <PlaneIcon />
          </span>
          <span className={styles.route}>
            <span>
              <span className={styles.code}>{fromCode}</span>
              <span className={styles.city}>{flight.fromPlace || words.defaultFromPlace}</span>
            </span>
            <span className={styles.arrow} aria-hidden="true">
              <PlaneIcon />
            </span>
            <span className={styles.routeTo}>
              <span className={styles.code}>{toCode}</span>
              <span className={styles.city}>{flight.toPlace || words.defaultToPlace}</span>
            </span>
          </span>
          <span className={styles.grid3}>
            <span className={styles.wide}>
              <small>{copy.passenger}</small>
              <b>{story.grad.fullName.toUpperCase()}</b>
            </span>
            <span>
              <small>{copy.flight}</small>
              <b>{flight.number || `NC ${story.grad.year ?? ""}`.trim()}</b>
            </span>
            <span>
              <small>{copy.seat}</small>
              <b>{flight.seat || words.defaultSeat}</b>
            </span>
            <span>
              <small>{copy.boarding}</small>
              <b>{story.grad.dateLabel}</b>
            </span>
            <span className={styles.wide}>
              <small>{copy.cabin}</small>
              <b>{flight.cabin || words.defaultCabin}</b>
            </span>
            <span className={styles.wide}>
              <small>{copy.gate}</small>
              <b>{story.grad.school}</b>
            </span>
          </span>
        </span>
        <span ref={stubRef} className={styles.passStub}>
          <span className={styles.barcode} aria-hidden="true" />
          <span className={styles.tear}>
            <span aria-hidden="true">✂ </span>
            {words.start}
          </span>
        </span>
      </button>
    </section>
  );
}
