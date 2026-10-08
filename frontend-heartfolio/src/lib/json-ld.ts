/**
 * ---------------------------------------------------------------------
 * SAFE JSON-LD SERIALIZATION (§22)
 * ---------------------------------------------------------------------
 * Structured data has to go into the page as raw text inside a
 * `<script type="application/ld+json">` block, which means
 * `dangerouslySetInnerHTML` — there is no escaped-by-React way to emit it.
 *
 * `JSON.stringify` alone is NOT safe for that. It escapes quotes and
 * backslashes, but it passes `<` through untouched, so a value containing
 * `</script>` closes the tag early and everything after it is parsed as
 * markup. That is a script-injection path, not a rendering quirk.
 *
 * Escaping `<` as `\u003c` closes it. The output is still valid JSON — a
 * parser resolves the escape back to `<` — so consumers read exactly the
 * same data while a browser's HTML tokenizer never sees a tag.
 *
 * WHY THIS MATTERS NOW RATHER THAN LATER
 * ---------------------------------------
 * Today every value reaching JSON-LD comes from translator-authored message
 * files, so nothing here is attacker-controlled and the hazard is
 * theoretical. Two things make it worth closing anyway:
 *
 *   §7c stores customer-written feedback with `is_published` and a
 *   `display_name`, deliberately built so reviews CAN be published later.
 *   The moment they are, product JSON-LD gains an `AggregateRating` and
 *   `Review` block, and customer text lands in exactly this position.
 *
 *   §7d made occasions and sizes editable from the dashboard, so copy that
 *   was compile-time constant is now runtime data.
 *
 * §22's closing note says any new customer-facing HTML surface must follow
 * the escaping pattern already proven in the `__live__` renderer rather
 * than reinventing one. This is that pattern, applied to the one place in
 * the frontend that writes raw HTML.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
