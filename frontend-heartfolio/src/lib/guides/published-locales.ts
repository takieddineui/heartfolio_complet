/**
 * The languages that have at least one PUBLISHED guide, for the footer link.
 * Kept apart from the guides themselves because the footer is a client
 * component: importing `lib/guides/registry` there would ship every guide's
 * text to every page. `guides.test.ts` fails if this list and the guides
 * disagree, so publishing a guide means updating it.
 */
export const GUIDE_INDEX_LOCALES: readonly string[] = [];
