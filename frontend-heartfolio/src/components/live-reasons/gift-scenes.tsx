"use client";

import { useId, type CSSProperties, type KeyboardEvent } from "react";
import type { GiftId } from "@/lib/studio/product-modules/reasons-i-love-you/gifts";
import styles from "./reasons-keepsake.module.css";

/**
 * THE FOUR GIFTS' OBJECTS: the jar, the daisy, the deck and the plate of
 * cookies. Ported from the prototype's `GIFT.<id>.html()`, element for element.
 *
 * Elements the animations move carry `data-part` (and `data-index` where there
 * is one per reason), because CSS-module class names are hashed. The parent
 * queries them INSIDE ITS OWN ROOT, never the document, so two experiences on
 * one page (or the Studio around one) can never reach each other's parts.
 */

export const NOTE_COLOURS = ["#fff3c9", "#ffd9cc", "#d9ecff", "#e3f5d6", "#f1dcff", "#ffe6b3", "#d6f1ef", "#ffd6e5", "#efe7d2", "#dfe6ff"];
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

/** The prototype's deterministic scatter, so a reason's note always lands in
 * the same place in the jar. */
export const scatter = (i: number, k: number) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** A percentage for a style, to two decimals. The page is rendered on the
 * server and then in the browser: a 16-digit value comes back from the
 * browser's style parser shorter (a hydration mismatch), and `Math.sin`'s
 * last digits may even differ between the server's engine and a phone's. */
const percent = (value: number) => `${Math.round(value * 100) / 100}%`;

export interface SceneProps {
  count: number;
  opened: ReadonlySet<number>;
  goldReady: boolean;
  toName: string;
  tapLabel: string;
  specialLabel: string;
  onDraw: (index?: number) => void;
  onSpecial: () => void;
}

function activateOnKey(event: KeyboardEvent, action: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
}

function Jar({ count, opened, goldReady, toName, tapLabel, onDraw }: SceneProps) {
  return (
    <button type="button" className={styles.jar} data-part="jar" aria-label={tapLabel} onClick={() => onDraw()}>
      <span className={styles.glass}>
        {Array.from({ length: count }, (_, i) =>
          opened.has(i) ? null : (
            <span
              key={i}
              className={styles.fold}
              data-part="fold"
              data-index={i}
              style={
                {
                  "--fc": NOTE_COLOURS[i % 10],
                  "--r": `${Math.round(scatter(i, 1) * 80 - 40)}deg`,
                  insetInlineStart: percent(12 + scatter(i, 2) * 62),
                  bottom: percent(6 + Math.floor(i / 3) * 13 + scatter(i, 3) * 6),
                } as CSSProperties
              }
            />
          )
        )}
        {goldReady && (
          <span
            className={`${styles.fold} ${styles.gold}`}
            data-part="special"
            style={{ "--r": "-8deg", insetInlineStart: "40%", bottom: "8%" } as CSSProperties}
          />
        )}
      </span>
      <span className={styles.cloth} />
      <span className={styles.lid} />
      <span className={styles.twine} />
      <span className={styles.label}>{toName}</span>
    </button>
  );
}

function Daisy({ count, opened, goldReady, tapLabel, specialLabel, onDraw, onSpecial }: SceneProps) {
  const seeds = useId().replace(/:/g, "");
  const cx = 180;
  const cy = 180;
  const petal = `M${cx} ${cy - 30} C ${cx - 26} ${cy - 70}, ${cx - 22} ${cy - 140}, ${cx} ${cy - 150} C ${cx + 22} ${cy - 140}, ${cx + 26} ${cy - 70}, ${cx} ${cy - 30}Z`;
  return (
    <svg className={styles.daisy} viewBox="0 0 360 540" role="group" aria-label={tapLabel}>
      <defs>
        <pattern id={seeds} width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="4" cy="4" r="1.4" fill="#c98a00" />
        </pattern>
      </defs>
      <g className={styles.stem}>
        <path d="M180 210 Q170 380 190 540" stroke="#4f8a5b" strokeWidth="8" fill="none" />
        <path d="M184 400 Q240 360 260 380 Q230 410 186 412Z" fill="#5d9a68" />
        {Array.from({ length: count }, (_, i) =>
          opened.has(i) ? null : (
            <g
              key={i}
              className={styles.petal}
              data-part="petal"
              data-index={i}
              transform={`rotate(${(i / count) * 360} ${cx} ${cy})`}
              role="button"
              tabIndex={0}
              aria-label={tapLabel}
              onClick={() => onDraw(i)}
              onKeyDown={(event) => activateOnKey(event, () => onDraw(i))}
            >
              <path d={petal} />
            </g>
          )
        )}
        {goldReady ? (
          <g
            className={`${styles.core} ${styles.bloom}`}
            data-part="special"
            role="button"
            tabIndex={0}
            aria-label={specialLabel}
            onClick={onSpecial}
            onKeyDown={(event) => activateOnKey(event, onSpecial)}
          >
            <circle cx={cx} cy={cy} r="42" fill="#f2b705" />
            <path
              d={`M${cx} ${cy + 22} C ${cx - 40} ${cy - 4}, ${cx - 24} ${cy - 40}, ${cx} ${cy - 18} C ${cx + 24} ${cy - 40}, ${cx + 40} ${cy - 4}, ${cx} ${cy + 22}Z`}
              fill="#e2445c"
            />
          </g>
        ) : (
          <>
            <circle className={styles.core} cx={cx} cy={cy} r="36" fill="#f2b705" />
            <circle cx={cx} cy={cy} r="36" fill={`url(#${seeds})`} />
          </>
        )}
      </g>
    </svg>
  );
}

function Deck({ count, opened, goldReady, tapLabel, onDraw }: SceneProps) {
  const left = Math.max(count - opened.size, 0);
  return (
    <button type="button" className={styles.deck} data-part="deck" aria-label={tapLabel} onClick={() => onDraw()}>
      {Array.from({ length: left }, (_, k) => (
        <span key={k} className={styles.deckCard} data-part="card" style={{ "--k": k } as CSSProperties} />
      ))}
      {goldReady && <span className={`${styles.deckCard} ${styles.queen}`} data-part="special" style={{ "--k": 0 } as CSSProperties} />}
    </button>
  );
}

function CookieArt({ golden = false }: { golden?: boolean }) {
  return (
    <svg viewBox="0 0 120 92" aria-hidden="true">
      <path
        className={styles.half}
        data-part="half-a"
        d="M60 86 C 22 86, 4 60, 10 38 C 16 18, 40 10, 60 30 Z"
        fill={golden ? "#f6cf55" : "#e8b45d"}
        stroke="#c98a37"
        strokeWidth="2"
      />
      <path
        className={styles.half}
        data-part="half-b"
        d="M60 86 C 98 86, 116 60, 110 38 C 104 18, 80 10, 60 30 Z"
        fill={golden ? "#f6cf55" : "#efc26e"}
        stroke="#c98a37"
        strokeWidth="2"
      />
      <path d="M30 46 Q60 70 90 46" stroke="#c98a37" strokeWidth="2" fill="none" opacity=".6" />
    </svg>
  );
}

function Cookies({ count, opened, goldReady, tapLabel, specialLabel, onDraw, onSpecial }: SceneProps) {
  return (
    <div className={styles.plate}>
      {goldReady ? (
        <button type="button" className={`${styles.cookie} ${styles.gold}`} data-part="special" aria-label={specialLabel} onClick={onSpecial}>
          <CookieArt golden />
        </button>
      ) : (
        Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            type="button"
            className={`${styles.cookie} ${opened.has(i) ? styles.gone : ""}`}
            data-part="cookie"
            data-index={i}
            aria-label={tapLabel}
            disabled={opened.has(i)}
            onClick={() => onDraw(i)}
          >
            <CookieArt />
          </button>
        ))
      )}
    </div>
  );
}

export const SCENES: Record<GiftId, (props: SceneProps) => React.JSX.Element> = { jar: Jar, daisy: Daisy, deck: Deck, cookies: Cookies };

type Frames = Keyframe[];

/** How each gift's reveal card arrives (the prototype's `openFrames`). */
export const OPEN_FRAMES: Record<GiftId, Frames> = {
  jar: [
    { transform: "scaleY(.05) rotate(-6deg)", opacity: 0.4 },
    { transform: "scaleY(1.04)", opacity: 1, offset: 0.7 },
    { transform: "none", opacity: 1 },
  ],
  daisy: [
    { transform: "scale(.4) rotate(-20deg)", opacity: 0 },
    { transform: "scale(1.05) rotate(3deg)", opacity: 1, offset: 0.7 },
    { transform: "none", opacity: 1 },
  ],
  deck: [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
  cookies: [
    { transform: "scaleX(.05)", opacity: 0.5 },
    { transform: "scaleX(1)", opacity: 1 },
  ],
};

export const FINAL_FRAMES: Frames = [
  { transform: "scale(.3)", opacity: 0 },
  { transform: "scale(1.06)", opacity: 1, offset: 0.7 },
  { transform: "none", opacity: 1 },
];

/** `element.animate`, or nothing where it does not exist (jsdom, very old
 * browsers): the experience still works, it just does not move. */
export function animate(element: Element | null | undefined, frames: Frames, options: KeyframeAnimationOptions) {
  if (!element || typeof (element as HTMLElement).animate !== "function") return null;
  return (element as HTMLElement).animate(frames, { fill: "both", ...options });
}

export const finished = (animation: Animation | null) => (animation ? animation.finished.then(() => undefined, () => undefined) : Promise.resolve());

/**
 * The gift giving up one reason (the prototype's `take`). `root` is the
 * experience's own gift container; `reduce` collapses every duration to 1ms.
 */
export async function takeAnimation(gift: GiftId, root: HTMLElement | null, index: number, reduce: boolean) {
  if (!root) return;
  const d = (ms: number) => (reduce ? 1 : ms);
  if (gift === "jar") {
    animate(root.querySelector('[data-part="jar"]'), [
      { transform: "rotate(0)" },
      { transform: "rotate(-3deg)" },
      { transform: "rotate(2deg)" },
      { transform: "rotate(0)" },
    ], { duration: d(400), fill: "none" });
    const fold = root.querySelector<HTMLElement>(`[data-part="fold"][data-index="${index}"]`);
    if (fold) {
      const r = fold.style.getPropertyValue("--r");
      await finished(
        animate(fold, [{ transform: `rotate(${r})` }, { transform: "translateY(-260px) rotate(360deg) scale(1.6)", opacity: 0 }], {
          duration: d(650),
          easing: "cubic-bezier(.3,.6,.4,1)",
        })
      );
    }
  } else if (gift === "daisy") {
    const path = root.querySelector(`[data-part="petal"][data-index="${index}"] path`);
    await finished(
      animate(
        path,
        [
          { transform: "none", opacity: 1 },
          { transform: `translate(${(scatter(index, 4) - 0.5) * 160}px,260px) rotate(${(scatter(index, 5) - 0.5) * 300}deg)`, opacity: 0 },
        ],
        { duration: d(900), easing: "cubic-bezier(.4,0,.8,.6)" }
      )
    );
  } else if (gift === "deck") {
    const cards = root.querySelectorAll<HTMLElement>('[data-part="card"]');
    const top = cards[cards.length - 1];
    if (top) {
      await finished(
        animate(top, [{ transform: getComputedStyle(top).transform }, { transform: "translate(0,-40px) rotate(-8deg) scale(1.1)", opacity: 0 }], {
          duration: d(380),
          easing: "ease-out",
        })
      );
    }
  } else {
    const cookie = root.querySelector(`[data-part="cookie"][data-index="${index}"]`);
    if (cookie) {
      animate(cookie.querySelector('[data-part="half-a"]'), [{ transform: "none" }, { transform: "rotate(-28deg) translate(-8px,-4px)" }], {
        duration: d(400),
        easing: "cubic-bezier(.3,1.6,.5,1)",
      });
      await finished(
        animate(cookie.querySelector('[data-part="half-b"]'), [{ transform: "none" }, { transform: "rotate(28deg) translate(8px,-4px)" }], {
          duration: d(400),
          easing: "cubic-bezier(.3,1.6,.5,1)",
        })
      );
      await new Promise((resolve) => setTimeout(resolve, reduce ? 0 : 200));
    }
  }
}
