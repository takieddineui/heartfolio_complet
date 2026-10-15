import { afterEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("./client", () => ({ apiFetch }));

import { checkYouTubeLink } from "./youtube";
import { formEngine } from "@/lib/studio/form-engine";
import { resolveShellValidationText } from "@/lib/studio/i18n";
import { songPosterSchema } from "@/lib/studio/product-modules/song-poster/schema";
import { songPosterMessages } from "@/lib/studio/product-modules/song-poster/messages";

afterEach(() => apiFetch.mockReset());

describe("checkYouTubeLink", () => {
  it("asks the backend, with the link exactly as typed", async () => {
    apiFetch.mockResolvedValue({ valid: true, videoId: "KQetemT1sWc", title: "T", authorName: "A", thumbnailUrl: "U" });
    const signal = new AbortController().signal;
    expect(await checkYouTubeLink(" https://youtu.be/KQetemT1sWc ", signal)).toEqual({
      valid: true,
      videoId: "KQetemT1sWc",
      title: "T",
      authorName: "A",
      thumbnailUrl: "U",
    });
    expect(apiFetch).toHaveBeenCalledWith("/youtube/validate", { method: "POST", body: { url: " https://youtu.be/KQetemT1sWc " }, signal });
  });

  it("passes on the backend's reason codes", async () => {
    for (const code of ["empty", "notYoutube", "unavailable", "checkFailed"]) {
      apiFetch.mockResolvedValue({ valid: false, code, reason: "English, for logs" });
      expect(await checkYouTubeLink("x")).toEqual({ valid: false, code });
    }
  });

  it("never treats an answer it does not understand as a yes", async () => {
    for (const answer of [{ valid: true }, { valid: true, videoId: "" }, { valid: false, code: "somethingNew" }, { valid: false }, {}]) {
      apiFetch.mockResolvedValue(answer);
      expect(await checkYouTubeLink("x")).toEqual({ valid: false, code: "checkFailed" });
    }
  });
});

describe("Song Poster's link field", () => {
  const field = songPosterSchema.sections.flatMap((s) => s.fields).find((f) => f.id === "youtubeUrl")!;

  it("is the checked YouTube field, storing its confirmation in youtubeVideoId", () => {
    expect(field).toMatchObject({ type: "youtube", confirmedIdField: "youtubeVideoId", required: true, maxLength: 300 });
  });

  it("keeps its length limit (the form engine applies maxLength to it)", () => {
    const tooLong = "https://www.youtube.com/watch?v=KQetemT1sWc&x=" + "a".repeat(300);
    expect(formEngine.validate(songPosterSchema, { track: "t", artist: "a", youtubeUrl: tooLong, photo: { url: "u" } }).errors.youtubeUrl?.code).toBe("maxLength");
  });

  it("no longer tells the customer to tap a link that does nothing", () => {
    for (const locale of ["en", "fr", "ar"] as const) {
      const message = songPosterMessages[locale]!["validation.notValidated"]!;
      expect(message).toBeTruthy();
      expect(message).not.toMatch(/tap|touchez|اضغط/i);
    }
  });

  it("has every status line in English, French and Arabic", () => {
    const keys = ["checking", "found", "confirmed", "notYoutube", "unavailable", "checkFailed", "retry"].map((k) => `youtube.${k}`);
    for (const locale of ["en", "fr", "ar"]) {
      for (const key of keys) {
        const text = resolveShellValidationText(key, locale);
        expect(text, `${locale} ${key}`).not.toBe(key);
        if (locale !== "en") expect(text, `${locale} ${key} is its own`).not.toBe(resolveShellValidationText(key, "en"));
      }
    }
  });
});
