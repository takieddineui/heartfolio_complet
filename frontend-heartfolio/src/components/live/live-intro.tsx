import type { CSSProperties } from "react";
import { SITE_NAME } from "@/lib/site-config";
import { liveFrameCopy } from "./live-frame-copy";
import type { IntroGround } from "./live-intro-ground";
import { INTRO_DONE_EVENT, INTRO_ID, INTRO_STATE_ID, LIVE_READY_EVENT } from "./live-intro-ids";
import styles from "./live-intro.module.css";

/**
 * THE SHARED HEARTFOLIO INTRO (owner, 27 Oct 2026), in front of every live
 * page; each product's own opening starts when it hands over
 * (`useLiveIntroDone`).
 *
 * - Drawn from FIRST PAINT by CSS: the mark's four strokes (0-0.7s), the
 *   spark, the line and the wordmark (0.45-0.85s), "Skip" from 0.3s.
 * - It leaves 1.25s after it started, or as soon after as the page under it
 *   has hydrated, fading for 0.35s; never later than `capMs` + the fade
 *   (2.5s in all), which the CSS enforces on its own, so it can never trap
 *   the page, with or without script. Measured on the production build
 *   (28 Oct 2026, 390px phone, CPU 4x slower, cold cache): on Fast 4G the page
 *   is ready 0.5-0.6s into the intro, so holding costs nothing; on Slow 4G
 *   2.4-3.1s in, past the cap, which the owner set at 2.5s in all.
 * - A tap anywhere, Esc or Enter skips (0.2s fade). The tap lands on the
 *   intro, never on the gift beneath.
 * - Only on the FIRST open per device, per gift (`localStorage`), and never
 *   under reduced motion: the first inline script decides before the intro
 *   is parsed, so a repeat visit never sees it flash.
 * - In the order's language (`live-frame-copy.ts`), on the gift's own ground
 *   (`live-intro-ground.ts`). Hidden from screen readers: the product's own
 *   heading stays first.
 *
 * The scripts are plain DOM, not React, because the point is to run before
 * hydration; `liveId` is checked to be a UUID before it is written into them.
 */
export const INTRO_TIMING = { leaveAfterMs: 1250, fadeMs: 350, skipFadeMs: 200, capMs: 2150 } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Runs before the intro is parsed: hide it for a repeat visit or reduced motion. */
export function introDecideScript(liveId: string): string {
  if (!UUID.test(liveId)) throw new Error("live id must be a UUID");
  return (
    `(function(){var m=document.getElementById("${INTRO_STATE_ID}"),k="hf-intro:${liveId}",seen=false;` +
    `try{seen=localStorage.getItem(k)==="1"}catch(e){}` +
    `if(seen||window.matchMedia("(prefers-reduced-motion: reduce)").matches){m.setAttribute("data-s","done");return}` +
    `m.setAttribute("data-s","playing");try{localStorage.setItem(k,"1")}catch(e){}})();`
  );
}

/** Runs right after the intro: when it leaves, and skipping. */
export function introRunScript(): string {
  const t = INTRO_TIMING;
  return (
    `(function(){var m=document.getElementById("${INTRO_STATE_ID}"),el=document.getElementById("${INTRO_ID}");` +
    `if(!m||!el||m.getAttribute("data-s")!=="playing")return;var t0=performance.now(),gone=false;` +
    `function done(){m.setAttribute("data-s","done");window.dispatchEvent(new Event("${INTRO_DONE_EVENT}"))}` +
    `function leave(ms){if(gone)return;gone=true;el.style.setProperty("--hf-out",ms+"ms");el.setAttribute("data-state","leaving");setTimeout(done,ms)}` +
    `function ready(){setTimeout(function(){leave(${t.fadeMs})},Math.max(0,${t.leaveAfterMs}-(performance.now()-t0)))}` +
    `if(window.__hfLiveReady)ready();else window.addEventListener("${LIVE_READY_EVENT}",ready,{once:true});` +
    `setTimeout(function(){leave(${t.fadeMs})},${t.capMs});` +
    `el.addEventListener("click",function(){leave(${t.skipFadeMs})});` +
    `document.addEventListener("keydown",function(e){if(e.key==="Escape"||e.key==="Enter")leave(${t.skipFadeMs})})})();`
  );
}

/** The same four strokes and spark as the brand mark (`components/brand/logo.tsx`). */
const MARK_PATHS = [
  "M32 22 A 10 10 0 0 0 14 31.5 L32 50",
  "M41 23 L23 40.5",
  "M23 23 L41 40.5",
  "M32 22 A 10 10 0 0 1 50 31.5 L32 50",
] as const;
const SPARK = "M51 7 L52.8 13.2 L59 15 L52.8 16.8 L51 23 L49.2 16.8 L43 15 L49.2 13.2 Z";

export function LiveIntro({ liveId, locale, ground }: { liveId: string; locale: string; ground: IntroGround }) {
  const copy = liveFrameCopy(locale);
  const lang = locale === "fr" || locale === "ar" ? locale : "en";
  const style = {
    "--intro-bg": ground.bg,
    "--intro-ink": ground.ink,
    "--hf-fade": `${INTRO_TIMING.fadeMs}ms`,
    "--hf-cap": `${INTRO_TIMING.capMs}ms`,
  } as CSSProperties;
  return (
    <>
      {/* The state the scripts write and the products read. */}
      <i id={INTRO_STATE_ID} className={styles.state} hidden suppressHydrationWarning />
      <script dangerouslySetInnerHTML={{ __html: introDecideScript(liveId) }} />
      <div id={INTRO_ID} className={styles.intro} style={style} aria-hidden="true" suppressHydrationWarning>
        <svg className={styles.mark} viewBox="0 0 64 64" aria-hidden="true">
          <g fill="none" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
            {MARK_PATHS.map((d, i) => (
              <path key={d} className={styles.stroke} d={d} pathLength={1} stroke={i % 2 ? "#c5854f" : "#ebb0a6"} />
            ))}
          </g>
          <path className={styles.spark} d={SPARK} />
        </svg>
        <p className={styles.line} lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
          {copy.introLine}
        </p>
        <p className={styles.word}>{SITE_NAME}</p>
        <button type="button" className={styles.skip} tabIndex={-1}>
          {copy.skip}
        </button>
      </div>
      <script dangerouslySetInnerHTML={{ __html: introRunScript() }} />
    </>
  );
}
