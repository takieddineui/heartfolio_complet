/**
 * ---------------------------------------------------------------------
 * STORY TYPES (§16)
 * ---------------------------------------------------------------------
 * One product, four contexts — couple, family, parents, gift — rather than
 * four products. §16 is explicit about that: a shared underlying model with
 * contextualized copy and presentation, not four separate implementations.
 *
 * WHAT A TYPE ACTUALLY DECIDES, and it is deliberately a short list:
 *
 *   * how the people in the story are labelled ("First partner's name" is
 *     wrong for a family and odd for parents told about by their child)
 *   * the default title Heartfolio proposes (§3)
 *   * the duration phrasing on the artwork — the renderer currently says
 *     "{days} days together", which is right for a couple and wrong for a
 *     family history
 *
 * WHAT IT DOES NOT DECIDE: layouts, print sizes, packs, exports. A family
 * story renders through the same six compositions as a couple's. §16 warns
 * against multiplying the product, and confining types to language and
 * people is what prevents that.
 *
 * `gift` is the odd one. The buyer is not in the story — they are creating
 * it for someone else — so it asks whose story it is rather than for the
 * buyer's own name, and its wording stays in the third person throughout.
 */

export type StoryTypeId = "couple" | "family" | "parents" | "gift";

/**
 * How many names a story may carry — one limit for the whole product, not
 * per story type. Mirrors `MAX_PEOPLE` in the backend's
 * `love_story_timeline/data.py`, which enforces it at order time and on
 * every render; change both together.
 *
 * Two, not more: the names are joined with "&" into one header line, and
 * that line is designed around a pair. Story types do not narrow this —
 * they only change wording.
 */
export const MIN_PEOPLE = 1;
export const MAX_PEOPLE = 2;

export interface StoryType {
  id: StoryTypeId;
  /**
   * Message key suffix for this type's wording. Resolved against the module
   * messages as `storyTypes.<id>.*`, so adding a type is one entry here and
   * one block of copy per language — not a new schema.
   */
  i18nKey: StoryTypeId;
  /**
   * Whether the duration line makes sense. A couple counts days together;
   * a family history counted in "days together" reads as a mistake, so the
   * phrasing is per-type and some types simply omit it.
   */
  supportsDuration: boolean;
}

export const STORY_TYPES: StoryType[] = [
  { id: "couple", i18nKey: "couple", supportsDuration: true },
  { id: "family", i18nKey: "family", supportsDuration: false },
  { id: "parents", i18nKey: "parents", supportsDuration: true },
  { id: "gift", i18nKey: "gift", supportsDuration: false },
];

export const DEFAULT_STORY_TYPE: StoryTypeId = "couple";

export function getStoryType(id: string | undefined | null): StoryType {
  return STORY_TYPES.find((type) => type.id === id) ?? STORY_TYPES[0]!;
}

/**
 * The default title Heartfolio proposes (§3, §17).
 *
 * Returns a MESSAGE KEY, never a string. §22 requires this to work in
 * English, French and Arabic, and a generated English title shown on an
 * Arabic page would be the exact failure §17 warns about — generated
 * content overpowering the customer's own story by being wrong in an
 * obvious way.
 *
 * The customer can always edit it; §17 requires that.
 */
export function defaultTitleKey(storyTypeId: string | undefined | null): string {
  return `storyTypes.${getStoryType(storyTypeId).i18nKey}.defaultTitle`;
}

/** Duration phrasing, or null where the type has none. */
export function durationKey(storyTypeId: string | undefined | null): string | null {
  const type = getStoryType(storyTypeId);
  return type.supportsDuration ? `storyTypes.${type.i18nKey}.duration` : null;
}

/**
 * Proposes a title when the story type changes (§3, §17).
 *
 * THE HARD PART IS NOT PROPOSING — IT IS KNOWING WHEN NOT TO.
 *
 * §17 is explicit that generated content must never overpower the
 * customer's own words, and the customer's title is their words. So this
 * fills the field only when it is empty, or when it still holds a title
 * Heartfolio itself proposed earlier — recognised by comparing against
 * every type's default rather than by tracking a "was generated" flag,
 * which would be state that can go stale or be lost on reload.
 *
 * The consequence: someone who types "The Long Way Round" and then switches
 * from couple to family keeps their title. Someone who never touched the
 * field gets a sensible one for the type they just chose. Neither has to be
 * explained to them.
 *
 * Returns a message KEY resolved by the caller, so the proposed title is in
 * the customer's own language (§22) — an English default on an Arabic page
 * would be the obvious kind of wrong that §17 warns about.
 */
export function proposeTitleKey(
  currentTitle: string,
  nextStoryTypeId: string,
  resolve: (key: string) => string
): string | null {
  const trimmed = (currentTitle ?? "").trim();

  const isGenerated =
    trimmed === "" ||
    STORY_TYPES.some((type) => resolve(defaultTitleKey(type.id)).trim() === trimmed);

  return isGenerated ? defaultTitleKey(nextStoryTypeId) : null;
}
