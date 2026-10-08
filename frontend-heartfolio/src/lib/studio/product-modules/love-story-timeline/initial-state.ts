import { DEFAULT_LAYOUT_ID } from "./layouts";
import { DEFAULT_STORY_TYPE, type StoryTypeId } from "./story-types";
import { DEFAULT_MUSIC_PRESET } from "./music-presets";
import type { ThemeSelections } from "@/types/studio";
import type { LocationValue } from "@/components/studio/generic-form/field-inputs";

export interface TimelinePhoto {
  url: string;
  mimeType: string;
  filename: string;
  /** Durable Django/R2 reference, stamped in when the photo is uploaded at
   * checkout. The delivery renderers read `photo.assetId` to fetch the
   * original bytes server-side; `url` is only ever a preview. */
  assetId?: string;
}

export interface TimelineEvent {
  date: string;
  title: string;
  description: string;
  /** §4 — optional. */
  /** §6 — a real place, not text. `string` remains valid for a milestone
   *  saved before this field existed (see the backend's `_location_field`,
   *  which accepts both); a customer edits one of those by searching again
   *  and picking a real result, which replaces it with the structured
   *  form. `locationDisplayName()` in renderer.tsx reads either shape. */
  location?: string | LocationValue;
  /** §4 — REQUIRED as of the story rework. Typed optional because a
   *  half-filled draft legitimately lacks one; validation enforces it at
   *  the point it matters, which is checkout, not every keystroke. */
  photo?: TimelinePhoto;
  /** §5 — optional enhancements, used by Digital and AR only. */
  video?: TimelineMedia;
  audio?: TimelineMedia;
}

/** A stored media asset. Mirrors `TimelinePhoto`'s shape: the id is what
 *  the backend resolves securely, the url is for preview only. */
export interface TimelineMedia {
  assetId: string;
  url?: string;
  durationSeconds?: number;
}

export interface StoryPerson {
  name: string;
}

export interface TimelineValues {
  /** §16 — decides labels, default title and duration phrasing. See
   *  `story-types.ts`. */
  storyType: StoryTypeId;
  /** §16 — replaces partner1/partner2. Two hardcoded slots made this
   *  couple-only; a gift buyer is not in the story at all. One or two
   *  names (`MAX_PEOPLE` in `story-types.ts`). */
  people: StoryPerson[];
  posterTitle: string;
  subtitle: string;
  /** §3's dedication. Renamed from `quote` — a dedication is what
   *  customers actually write, and the label shapes what they produce. */
  dedication: string;
  /** §4 — a preset id from `MUSIC_PRESETS` (e.g. "none", "tender-piano"),
   *  never an uploaded asset. See that file for the full reasoning. */
  backgroundMusic: string;
  endingText: string;
  showDuration: boolean;
  autoSort: boolean;
  events: TimelineEvent[];
}

/** A brand-new project's starting values — populated with sample content
 * (rather than blank fields) so the preview shows something meaningful
 * the moment the Studio opens, matching the prototype's own behavior of
 * always rendering a complete poster. */
export function createInitialState(): TimelineValues {
  return {
    storyType: DEFAULT_STORY_TYPE,
    people: [{ name: "Emma" }, { name: "James" }],
    posterTitle: "Our Love Story",
    subtitle: "",
    dedication: "Every love story is beautiful, but ours is my favorite.",
    endingText: "To be continued…",
    backgroundMusic: DEFAULT_MUSIC_PRESET,
    showDuration: true,
    autoSort: true,
    // Three, because that is now the minimum (§4) — a sample story below
    // the floor would put a new project into an invalid state on open.
    events: [
      { date: "2019-04-12", title: "We Met", description: "A rainy afternoon, a shared umbrella.", location: "Lisbon" },
      { date: "2020-06-20", title: "First Trip Together", description: "Three days, one tiny car.", location: "Andalusia" },
      { date: "2022-09-03", title: "He Proposed", description: "On the beach, at sunset.", location: "Cascais" },
    ],
  };
}

export function createInitialThemeSelections(): ThemeSelections {
  return {
    palette: "classic",
    typography: "serif-classic",
    layout: DEFAULT_LAYOUT_ID,
    // §13/§14 — frame and format are no longer customer selections. Frame
    // style is now a single fixed system default (see png_renderer.py's
    // `DEFAULT_FRAME_STYLE`); canvas size is derived from the selected
    // layout's own orientation (`index.ts`'s `intrinsicSize`), not chosen
    // separately.
    scale: 100,
  };
}
