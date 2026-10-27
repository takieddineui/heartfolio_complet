/**
 * French typography: the space before : ; ? ! and inside guillemets must not
 * break, or a line can start with a lone colon or a closing guillemet. Done
 * here, at display, so the content files stay plain text: a no-break space
 * (U+00A0) before ":" and inside guillemets (U+00AB, U+00BB), a narrow one
 * (U+202F) before ; ? !. Escapes on purpose: these characters are invisible.
 */
export function typeset(text: string, locale: string): string {
  if (locale !== "fr") return text;
  return text
    .replace(/ :/g, "\u00A0:")
    .replace(/ ([;?!])/g, "\u202F$1")
    .replace(/\u00AB /g, "\u00AB\u00A0")
    .replace(/ \u00BB/g, "\u00A0\u00BB");
}
