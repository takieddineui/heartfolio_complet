import { describe, expect, it } from "vitest";
import { PLAYER_COPY, playerCopy } from "./player-copy";

/** The player's words exist in every language, the English ones unchanged
 *  from before they moved here (26 Oct 2026), and an unknown language falls
 *  back to English. */
describe("player copy", () => {
  it("has every label and every error in en, fr and ar", () => {
    for (const [locale, copy] of Object.entries(PLAYER_COPY)) {
      for (const text of [copy.play, copy.pause, copy.seek, copy.errors.unplayable, copy.errors.loadFailed]) {
        expect(text.trim(), locale).not.toBe("");
      }
    }
    expect(PLAYER_COPY.fr.play).not.toBe(PLAYER_COPY.en.play);
    expect(PLAYER_COPY.ar.seek).not.toBe(PLAYER_COPY.en.seek);
  });

  it("keeps the English the page always showed", () => {
    expect(PLAYER_COPY.en).toMatchObject({
      play: "Play",
      pause: "Pause",
      seek: "Seek",
      errors: { unplayable: "This video stopped being playable.", loadFailed: "Could not load the player." },
    });
  });

  it("falls back to English", () => {
    expect(playerCopy("de")).toBe(PLAYER_COPY.en);
    expect(playerCopy(undefined)).toBe(PLAYER_COPY.en);
    expect(playerCopy("ar")).toBe(PLAYER_COPY.ar);
  });
});
