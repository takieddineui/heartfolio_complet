/**
 * The direction of one line of the customer's text: that of its first strong
 * letter, as the print decides it (`apps/delivery/mixed_script.py`, the
 * Unicode bidi algorithm's rule) and as `dir="auto"` does.
 *
 * Set as an explicit `dir` rather than `dir="auto"` (19 Oct 2026) so the
 * poster's CSS can see it: a right-to-left line must still start at the
 * poster's left edge, as printed, which takes `[dir="rtl"] { text-align: end }`.
 * `:dir(rtl)` would read `dir="auto"`, but the CSS build rewrites it into
 * `:lang(ar)`-style checks of the PAGE's language, and `text-align:
 * match-parent` is not supported by Chromium.
 *
 * `undefined` when the text has no letter at all (empty, digits, punctuation):
 * the line then keeps the poster's left-to-right.
 */
const STRONG_LETTER = /\p{L}/u;
/** Hebrew, Syriac, Arabic, Thaana, NKo and the rest of U+0590-08FF, plus the
 *  Hebrew and Arabic presentation forms. */
const RIGHT_TO_LEFT = /[֐-ࣿיִ-﷿ﹰ-﻿]/u;

export function lineDirection(text: string | null | undefined): "ltr" | "rtl" | undefined {
  for (const char of text ?? "") {
    if (RIGHT_TO_LEFT.test(char)) return "rtl";
    if (STRONG_LETTER.test(char)) return "ltr";
  }
  return undefined;
}
