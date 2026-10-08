import { describe, expect, it } from "vitest";
import { checkoutErrorMessageKey } from "./checkout-error-mapping";
import { ApiError } from "@/lib/api/errors";
import { MissingPendingFileError, PartialUploadFailure } from "@/lib/studio/media-values";

/**
 * `checkout-flow.tsx`'s own catch block uses this to map these cases to a
 * translated, actionable message instead of showing either a raw client
 * `Error` or a backend message written for a developer (e.g.
 * "events[0].photo is required and must include a non-empty string
 * 'assetId'."). Tested directly against this module rather than by
 * rendering the component, which needs `ProductStateContext`,
 * `ThemeProvider`, routing and Framer Motion all mocked for no additional
 * coverage of the one thing that actually changed here.
 */
describe("checkoutErrorMessageKey", () => {
  it("is checkout.incompletePhotos when a PartialUploadFailure needs a photo re-selected", () => {
    const failure = new PartialUploadFailure({}, [new MissingPendingFileError("photo.jpg")]);
    expect(checkoutErrorMessageKey(failure)).toBe("checkout.incompletePhotos");
  });

  it("is checkout.uploadFailedRetry when a PartialUploadFailure is purely transient — the photo is still pending, no re-select needed", () => {
    const failure = new PartialUploadFailure({}, [new Error("502")]);
    expect(checkoutErrorMessageKey(failure)).toBe("checkout.uploadFailedRetry");
  });

  it("prefers checkout.incompletePhotos when a PartialUploadFailure mixes a lost file with an otherwise-transient one", () => {
    const failure = new PartialUploadFailure({}, [new Error("502"), new MissingPendingFileError("photo.jpg")]);
    expect(checkoutErrorMessageKey(failure)).toBe("checkout.incompletePhotos");
  });

  it("is checkout.incompletePhotos for every renderer-backed 'invalid data' code create_order can return", () => {
    for (const code of [
      "love_story_timeline_invalid_data",
      "song_poster_invalid_data",
      "where_we_met_map_invalid_data",
    ]) {
      const error = new ApiError({ code, message: "developer-facing detail", status: 400 });
      expect(checkoutErrorMessageKey(error)).toBe("checkout.incompletePhotos");
    }
  });

  it("is null for an unrelated 4xx, so its specific message still passes through as-is", () => {
    const error = new ApiError({ code: "delivery_pack_disabled", message: "This pack is unavailable.", status: 400 });
    expect(checkoutErrorMessageKey(error)).toBeNull();
  });

  it("is null for a 5xx, so it still falls to the generic translated message", () => {
    const error = new ApiError({ code: "server_error", message: "boom", status: 500 });
    expect(checkoutErrorMessageKey(error)).toBeNull();
  });

  it("is null for a plain network failure", () => {
    expect(checkoutErrorMessageKey(new Error("network down"))).toBeNull();
  });
});
