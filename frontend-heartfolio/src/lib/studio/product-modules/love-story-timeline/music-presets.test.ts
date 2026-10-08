import { describe, expect, it } from "vitest";
import {
  DEFAULT_MUSIC_PRESET,
  MUSIC_PRESETS,
  isKnownMusicPreset,
  presetMusicUrl,
} from "./music-presets";

/**
 * §4 — background music, as a preset selection.
 *
 * NO AUDIO FILES EXIST YET, by decision — see music-presets.ts's header.
 * These test the CATALOG and the URL-resolution logic, not that any file
 * actually plays; there is nothing to play yet.
 */
describe("music presets", () => {
  it('has "none" as a real, first entry, not a special case', () => {
    // "does the customer see a way to choose no music" and "is that
    // choice a preset like any other" are meant to be the same question.
    expect(MUSIC_PRESETS[0]?.id).toBe("none");
    expect(DEFAULT_MUSIC_PRESET).toBe("none");
  });

  it("has several real choices beyond none", () => {
    expect(MUSIC_PRESETS.length).toBeGreaterThanOrEqual(4);
  });

  it("resolves none to no URL at all", () => {
    expect(presetMusicUrl("none")).toBeNull();
    expect(presetMusicUrl(null)).toBeNull();
    expect(presetMusicUrl(undefined)).toBeNull();
    expect(presetMusicUrl("")).toBeNull();
  });

  it("resolves a real preset to the shared static path convention", () => {
    // Must match `preset_music_url()` in the backend's ar_support.py
    // exactly — both sides compute this independently from the same id.
    expect(presetMusicUrl("tender-piano")).toBe("/audio/presets/tender-piano.mp3");
  });

  it("rejects an unknown preset id rather than building a URL for it", () => {
    // A stale or hand-edited value must not produce a broken <audio src>
    // pointing at a file that was never going to exist under any name.
    expect(presetMusicUrl("a-track-that-does-not-exist")).toBeNull();
  });

  it("every preset resolves a translated name", () => {
    for (const preset of MUSIC_PRESETS) {
      expect(preset.i18nKey.length).toBeGreaterThan(0);
    }
  });

  it("recognizes every catalog id and nothing else", () => {
    for (const preset of MUSIC_PRESETS) {
      expect(isKnownMusicPreset(preset.id)).toBe(true);
    }
    expect(isKnownMusicPreset("not-a-real-preset")).toBe(false);
  });
});
