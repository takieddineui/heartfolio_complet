"use client";

import { SITE_DOMAIN } from "@/lib/site-config";

/**
 * ---------------------------------------------------------------------
 * PRE-PAYMENT PREVIEW WATERMARK (§20)
 * ---------------------------------------------------------------------
 * Without this, a customer could personalize a timeline, screenshot the
 * live preview at whatever resolution their display offers, and leave with
 * a usable image having paid nothing.
 *
 * WHERE THIS SITS, AND WHY IT MATTERS MORE THAN HOW IT LOOKS
 * ----------------------------------------------------------
 * §20 is emphatic that the watermark must never reach a purchased file, and
 * argues this is structurally guaranteed because preview and delivery are
 * separate render paths — the browser draws the preview, Django renders the
 * real file server-side after payment, behind the entitlement gate. That is
 * true today: nothing in the codebase rasterizes the preview DOM.
 *
 * But `ComponentRenderer` registers the preview node via
 * `registerExportTarget("default", node)`, and `exportTargets` is a ref that
 * currently has no consumer. It exists for a client-side export that has not
 * been written yet. The day someone wires a rasterizer to it, anything
 * *inside* that node becomes part of the output.
 *
 * So this overlay is deliberately a SIBLING of the registered export node,
 * not a child of it. The separation §20 relies on stops being a matter of
 * "no client exporter exists yet" and becomes true of the DOM itself.
 * `preview.test.tsx` asserts that relationship, because it is the one
 * property here whose failure would be silent and expensive — a watermark
 * baked into a paying customer's keepsake.
 *
 * RENDERING NOTES
 * ---------------
 * Drawn with a repeating linear-gradient-free approach: a grid of rotated
 * text nodes rather than a CSS background image, because a background image
 * would need the text rasterized at a fixed size and would blur as
 * `ScaleToFit` scales the canvas. Text nodes scale cleanly with the
 * transform.
 *
 * `aria-hidden` and `pointer-events-none`: this is anti-theft decoration,
 * not content. It must not be announced to screen readers, and it must never
 * intercept a click meant for the artwork beneath it.
 */

/** Enough rows/columns to cover the canvas once rotated 45°, where the
 *  diagonal is roughly 1.5× the longest edge. */
const ROWS = 9;
const COLUMNS = 5;

export function PreviewWatermark({ width, height }: { width: number; height: number }) {
  // Scale the mark to the canvas so it reads the same on a phone wallpaper
  // and on a poster, rather than being enormous on one and invisible on the
  // other.
  const fontSize = Math.max(11, Math.min(width, height) * 0.028);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 select-none overflow-hidden"
      style={{ width, height }}
      data-testid="preview-watermark"
    >
      {/* Centred with flex rather than `left-1/2` + translate: the overlay
          has no reading direction, and using a physical side here would be
          the same latent bug §15 spent two passes removing. */}
      <div className="flex h-full w-full items-center justify-center">
        <div
          className="flex flex-col justify-around"
          style={{
            width: width * 1.6,
            height: height * 1.6,
            flexShrink: 0,
            transform: "rotate(-45deg)",
          }}
        >
          {Array.from({ length: ROWS }).map((_, row) => (
            <div key={row} className="flex justify-around whitespace-nowrap">
              {Array.from({ length: COLUMNS }).map((_, column) => (
                <span
                  key={column}
                  style={{
                    fontSize,
                    opacity: 0.13,
                    color: "currentColor",
                    letterSpacing: "0.08em",
                    fontFamily: "var(--font-sans, system-ui), sans-serif",
                  }}
                >
                  {SITE_DOMAIN}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
