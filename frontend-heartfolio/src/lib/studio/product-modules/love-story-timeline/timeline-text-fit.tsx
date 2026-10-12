"use client";

import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";

/**
 * The smallest fraction of its normal size milestone text may shrink to.
 * The same floor the print uses (`text_fit_floor` in compositions.py, held
 * equal by composition-parity.test.ts): below it, text stops being readable
 * at the size a poster is looked at.
 */
export const TIMELINE_TEXT_FIT_FLOOR = 0.55;

/**
 * The height a text block needs: from its first child's top margin edge to
 * its last child's bottom margin edge, plus its own vertical padding, in
 * layout pixels.
 *
 * Not `scrollHeight`. When a row centres its text (Neat Stack, Cascade), an
 * overflow is split above and below, the part above is not scrollable, and
 * Chrome leaves the padding out — so padding meant to keep milestones apart
 * was invisible to the fit, and fitted text touched the next milestone.
 */
function neededHeight(text: HTMLElement): number {
  const lines = Array.from(text.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && getComputedStyle(child).position !== "absolute"
  );
  const first = lines[0];
  const last = lines[lines.length - 1];
  if (!first || !last) return text.scrollHeight;
  const style = getComputedStyle(text);
  const top = first.offsetTop - parseFloat(getComputedStyle(first).marginTop);
  const bottom = last.offsetTop + last.offsetHeight + parseFloat(getComputedStyle(last).marginBottom);
  return bottom - top + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
}

/**
 * A timeline whose milestone text is fitted to its row.
 *
 * Every milestone gets an equal share of the timeline's height (in the
 * CSS), so with eight milestones and long text a text block can be taller
 * than its row and spill into its neighbours. CSS cannot shrink text to fit
 * a box, so this measures the tallest block against the row height and
 * scales the text down through `--text-fit`, which the layout's text class
 * multiplies into `--text-scale` — the same thing the print renderer does
 * when it measures each milestone.
 *
 * MEASURES IN LAYOUT PIXELS ONLY (`clientHeight`, `offsetTop`). The
 * Studio draws the poster scaled down with a CSS transform, and
 * `getBoundingClientRect()` reports the scaled size: comparing that with an
 * unscaled `scrollHeight` (the first version of this did) shrank the text
 * about 20% more than it needed.
 *
 * `cellClassName` names an element whose height is one row; it may be the
 * text element itself when the text block is the row (Neat Stack).
 *
 * `fitTo="box"` is for the horizontal layouts, whose milestones are COLUMNS:
 * there is no row, and what must fit is the tallest milestone in the
 * timeline's own height (`cellClassName` is then not used).
 */
export function FittedTimeline({
  className,
  textClassName,
  cellClassName,
  fitTo = "row",
  style,
  children,
}: {
  className: string;
  textClassName: string;
  cellClassName: string;
  fitTo?: "row" | "box";
  style?: CSSProperties;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const timeline = ref.current;
    if (!timeline) return;

    const fitsAt = (scale: number) => {
      timeline.style.setProperty("--text-fit", scale.toFixed(3));
      const box = fitTo === "box";
      const row = box ? timeline.clientHeight : timeline.querySelector<HTMLElement>(`.${cellClassName}`)?.clientHeight ?? 0;
      const tallest = Math.max(
        0,
        ...Array.from(timeline.querySelectorAll<HTMLElement>(`.${textClassName}`), (text) =>
          box ? text.offsetHeight : neededHeight(text)
        )
      );
      return !row || tallest <= row;
    };

    // The LARGEST scale that fits, by bisection. Shrinking text changes
    // where lines wrap, so height is not proportional to scale and a single
    // proportional step overshoots (it took one case straight to the floor
    // with a third of the row unused). If even the floor does not fit, the
    // floor is the answer — never smaller than the print.
    const fit = () => {
      if (fitsAt(1)) return;
      if (!fitsAt(TIMELINE_TEXT_FIT_FLOOR)) return;
      let fits = TIMELINE_TEXT_FIT_FLOOR;
      let tooBig = 1;
      for (let step = 0; step < 8; step += 1) {
        const middle = (fits + tooBig) / 2;
        if (fitsAt(middle)) fits = middle;
        else tooBig = middle;
      }
      fitsAt(fits);
    };

    fit();
    // Web fonts can finish loading after the first measurement and change
    // the text's size with no render and no resize; measure again then.
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) fit();
    });
    if (typeof ResizeObserver === "undefined") {
      return () => {
        cancelled = true;
      };
    }
    const observer = new ResizeObserver(fit);
    observer.observe(timeline);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  });

  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}
