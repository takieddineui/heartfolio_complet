import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backendRoot } from "../../../test/backend-root";
import {
  __resetPendingFiles,
  collectMediaValues,
  countPendingUploads,
  isMediaValue,
  MissingPendingFileError,
  PartialUploadFailure,
  refreshMediaUrls,
  registerPendingFile,
  uploadPendingMedia,
  type MediaValue,
} from "./media-values";
import { ALLOWED_ASSET_MIME_TYPES, checkFileAccepted, MAX_ASSET_SIZE_BYTES } from "@/lib/api/assets";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function setCookie(value: string) {
  Object.defineProperty(document, "cookie", { value, writable: true, configurable: true });
}

function fakeFile(name = "photo.jpg", type = "image/jpeg", size = 1024): File {
  const file = new File([new Uint8Array(8)], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

/** Love Story Timeline: photos nested inside an event array. */
const TIMELINE_VALUES = {
  partner1: "Amelia",
  events: [
    { title: "We met", photo: { url: "blob:a", mimeType: "image/jpeg", filename: "a.jpg" } },
    { title: "No photo here" },
    { title: "We moved in", photo: { url: "blob:b", mimeType: "image/png", filename: "b.png" } },
  ],
};

/** Where We Met: a single top-level photo. */
const MAP_VALUES = {
  locationLabel: "Lyon",
  coordinates: { lat: 45.76, lng: 4.83 },
  photo: { url: "blob:c", mimeType: "image/webp", filename: "c.webp" },
};

describe("media value detection", () => {
  it("finds photos wherever a product happens to nest them, with no per-product knowledge", () => {
    expect(collectMediaValues(TIMELINE_VALUES).map((m) => m.filename)).toEqual(["a.jpg", "b.png"]);
    expect(collectMediaValues(MAP_VALUES).map((m) => m.filename)).toEqual(["c.webp"]);
  });

  it("does not mistake other objects for media", () => {
    expect(isMediaValue({ lat: 45.76, lng: 4.83 })).toBe(false);
    expect(isMediaValue({ url: "blob:x" })).toBe(false); // no mimeType
    expect(isMediaValue(null)).toBe(false);
    expect(collectMediaValues(MAP_VALUES.coordinates)).toEqual([]);
  });
});

describe("client-side file checks mirror the backend's limits", () => {
  it("rejects a file over 10MB", () => {
    expect(checkFileAccepted(fakeFile("big.jpg", "image/jpeg", MAX_ASSET_SIZE_BYTES + 1))).toBe("too-large");
  });

  it("accepts one exactly at the limit", () => {
    expect(checkFileAccepted(fakeFile("edge.jpg", "image/jpeg", MAX_ASSET_SIZE_BYTES))).toBeNull();
  });

  it("rejects formats the backend does not allow", () => {
    expect(checkFileAccepted(fakeFile("doc.pdf", "application/pdf"))).toBe("unsupported-type");
    expect(checkFileAccepted(fakeFile("anim.gif", "image/gif"))).toBe("unsupported-type");
  });

  it("accepts every format the backend does", () => {
    // This test used to name only the three image types, so it passed
    // while `ALLOWED_ASSET_MIME_TYPES` silently omitted every audio/video
    // type the backend actually accepts (§5) — the fixture drifted from
    // its own title instead of catching the drift. Every §5 voice-note
    // recording was rejected client-side as "unsupported format" before
    // ever reaching the backend, for every customer, the whole time.
    for (const type of [
      "image/jpeg", "image/png", "image/webp",
      "video/mp4", "video/quicktime", "video/webm",
      "audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "audio/webm",
    ]) {
      expect(checkFileAccepted(fakeFile("f", type))).toBeNull();
    }
  });

  it("lists exactly the types the backend's default setting accepts", () => {
    // The fixture above is hand-kept, and a hand-kept list drifted from the
    // backend once already. This reads the backend's own default
    // (`ALLOWED_ASSET_MIME_TYPES` in config/settings/base.py) and requires the
    // same set, in both directions: a type only the client accepts fails at
    // upload, a type only the server accepts is refused before it is sent.
    const settings = readFileSync(join(backendRoot(), "config", "settings", "base.py"), "utf8");
    const start = settings.indexOf("ALLOWED_ASSET_MIME_TYPES = env.list(");
    expect(start, "ALLOWED_ASSET_MIME_TYPES default not found in base.py").toBeGreaterThan(-1);
    const block = settings.slice(start, settings.indexOf("]", start));
    const backend = [...block.matchAll(/"((?:image|video|audio)\/[a-z0-9.+-]+)"/g)].map((m) => m[1]!);
    expect(backend.length).toBeGreaterThan(0);
    expect([...ALLOWED_ASSET_MIME_TYPES].sort()).toEqual([...backend].sort());
  });

  it("gives audio/video the larger media size ceiling, not the image one", () => {
    // §5 — a 30-second voice note or clip can easily exceed the 10MB image
    // limit without exceeding the 50MB media one; the image limit would
    // have quietly rejected legitimate recordings this size.
    expect(checkFileAccepted(fakeFile("clip.webm", "audio/webm", MAX_ASSET_SIZE_BYTES + 1))).toBeNull();
  });
});

describe("uploadPendingMedia", () => {
  beforeEach(() => {
    __resetPendingFiles();
    setCookie("csrftoken=t");
  });
  afterEach(() => vi.restoreAllMocks());

  it("uploads every pending photo and stamps the assetId into the values", async () => {
    registerPendingFile("blob:a", fakeFile("a.jpg"));
    registerPendingFile("blob:b", fakeFile("b.png", "image/png"));

    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        n += 1;
        return jsonResponse(
          { id: `asset-${n}`, assetId: `asset-${n}`, url: `https://r2/${n}`, mimeType: "image/jpeg", filename: `f${n}` },
          201
        );
      })
    );

    const result = (await uploadPendingMedia(TIMELINE_VALUES)) as typeof TIMELINE_VALUES;

    expect(collectMediaValues(result).map((m) => m.assetId)).toEqual(["asset-1", "asset-2"]);
    // Structure is preserved exactly — this is opaque product state.
    expect(result.partner1).toBe("Amelia");
    expect(result.events).toHaveLength(3);
    expect(result.events[1]).toEqual({ title: "No photo here" });
  });

  it("keeps the local preview URL rather than the expiring presigned one", async () => {
    registerPendingFile("blob:c", fakeFile("c.webp", "image/webp"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ id: "a1", assetId: "a1", url: "https://r2/expires-in-5-min", mimeType: "image/webp", filename: "c.webp" }, 201)
      )
    );

    const result = (await uploadPendingMedia(MAP_VALUES)) as { photo: MediaValue };
    expect(result.photo.url).toBe("blob:c");
    expect(result.photo.assetId).toBe("a1");
  });

  it("does not re-upload a photo that already has an assetId", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const already = { photo: { url: "blob:x", mimeType: "image/jpeg", filename: "x.jpg", assetId: "existing" } };
    const result = (await uploadPendingMedia(already)) as typeof already;

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.photo.assetId).toBe("existing");
  });

  it("propagates a failure instead of saving a project with a missing photo, and keeps the file pending for a retry", async () => {
    registerPendingFile("blob:c", fakeFile("c.webp", "image/webp"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: { code: "asset_too_large" } }, 413)));

    const failure = await uploadPendingMedia(MAP_VALUES).catch((e) => e);
    expect(failure).toBeInstanceOf(PartialUploadFailure);
    expect((failure as PartialUploadFailure).needsRepick).toBe(false); // a transient upload failure, not a lost file
    // The upload failed, but the file itself was never forgotten — a
    // retry re-uploads it without the customer re-selecting anything.
    expect(countPendingUploads(MAP_VALUES)).toBe(1);
  });

  it("a photo with no assetId and no registered pending file needs a re-select, and is reported as such", async () => {
    // Simulates a photo that has genuinely lost its file — the one case
    // `PartialUploadFailure.needsRepick` exists to flag. Nothing
    // registers "blob:a"/"blob:b" here on purpose.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const failure = await uploadPendingMedia(TIMELINE_VALUES).catch((e) => e);
    expect(failure).toBeInstanceOf(PartialUploadFailure);
    const partial = failure as PartialUploadFailure;
    expect(partial.needsRepick).toBe(true);
    expect(partial.causes.every((c) => c instanceof MissingPendingFileError)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("a partial failure within one batch (the confirmed real-world trigger)", () => {
    /**
     * Reproduces the exact reported incident: `mapMediaValues` walks the
     * `events` array via `Promise.all`, so every milestone's photo
     * uploads CONCURRENTLY. Here `events[0]`'s upload fails (a proxied
     * `POST /assets/` socket hang-up, in the real report) while
     * `events[1]`'s succeeds IN THE SAME BATCH. Before the fix,
     * `events[1]`'s `pendingFiles` entry was forgotten as an unconditional
     * side effect the moment its own upload resolved — discarding, when
     * the batch as a whole then rejected because of `events[0]`, the only
     * record that `events[1]` had already uploaded. A retry found
     * `events[1]` with no `assetId` and no pending file: unrecoverable,
     * and — before the `MissingPendingFileError`/`PartialUploadFailure`
     * fix — silently passed through with no `assetId` at all instead of
     * failing loudly.
     */
    type BatchValues = { events: { title: string; photo: MediaValue }[] };

    const BATCH_VALUES: BatchValues = {
      events: [
        { title: "Fails", photo: { url: "blob:fails", mimeType: "image/jpeg", filename: "fails.jpg" } },
        { title: "Succeeds", photo: { url: "blob:succeeds", mimeType: "image/jpeg", filename: "succeeds.jpg" } },
      ],
    };

    it("keeps the successful upload's assetId and the failed upload's file, instead of losing either", async () => {
      registerPendingFile("blob:fails", fakeFile("fails.jpg"));
      registerPendingFile("blob:succeeds", fakeFile("succeeds.jpg"));

      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
          const body = init?.body as FormData | undefined;
          const file = body?.get("file") as File | undefined;
          if (file?.name === "fails.jpg") {
            return jsonResponse({ error: { code: "asset_upload_failed" } }, 502);
          }
          return jsonResponse(
            { id: "asset-succeeds", assetId: "asset-succeeds", url: "https://r2/1", mimeType: "image/jpeg", filename: "succeeds.jpg" },
            201
          );
        })
      );

      const failure = await uploadPendingMedia(BATCH_VALUES).catch((e) => e);
      expect(failure).toBeInstanceOf(PartialUploadFailure);
      const partial = failure as PartialUploadFailure;
      expect(partial.needsRepick).toBe(false);

      const values = partial.values as typeof BATCH_VALUES;
      // The failed one: unchanged, no assetId — its file is still pending.
      expect(values.events[0]!.photo.assetId).toBeUndefined();
      // The succeeded one: DID keep its assetId, even though the overall
      // batch failed because of its sibling.
      expect(values.events[1]!.photo.assetId).toBe("asset-succeeds");

      // And the registry agrees: only the failed one is still pending —
      // the succeeded one was correctly forgotten, not orphaned.
      expect(countPendingUploads(values)).toBe(1);
      expect(countPendingUploads({ events: [values.events[0]!] })).toBe(1);
      expect(countPendingUploads({ events: [values.events[1]!] })).toBe(0);
    });

    it("a retry with the partial values only re-uploads what actually still needs it", async () => {
      registerPendingFile("blob:fails", fakeFile("fails.jpg"));
      registerPendingFile("blob:succeeds", fakeFile("succeeds.jpg"));

      const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const body = init?.body as FormData | undefined;
        const file = body?.get("file") as File | undefined;
        if (file?.name === "fails.jpg") {
          return jsonResponse({ error: { code: "asset_upload_failed" } }, 502);
        }
        return jsonResponse(
          { id: "asset-succeeds", assetId: "asset-succeeds", url: "https://r2/1", mimeType: "image/jpeg", filename: "succeeds.jpg" },
          201
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      const firstAttempt = (await uploadPendingMedia(BATCH_VALUES).catch((e) => e)) as PartialUploadFailure;
      expect(fetchMock).toHaveBeenCalledTimes(2); // both attempted, once each

      // The caller (checkout-flow.tsx) applies `.values` via `replaceValues`
      // before retrying — simulated here by feeding it straight back in.
      fetchMock.mockImplementation(async () =>
        jsonResponse({ id: "asset-fails", assetId: "asset-fails", url: "https://r2/2", mimeType: "image/jpeg", filename: "fails.jpg" }, 201)
      );
      const result = (await uploadPendingMedia(firstAttempt.values)) as typeof BATCH_VALUES;

      // Only ONE more request — for the one photo that actually still
      // needed it. The already-succeeded one was never re-uploaded.
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(result.events[0]!.photo.assetId).toBe("asset-fails");
      expect(result.events[1]!.photo.assetId).toBe("asset-succeeds");
    });
  });

  it("counts what is still pending", () => {
    registerPendingFile("blob:a", fakeFile());
    expect(countPendingUploads(TIMELINE_VALUES)).toBe(1);
    registerPendingFile("blob:b", fakeFile());
    expect(countPendingUploads(TIMELINE_VALUES)).toBe(2);
  });
});

describe("refreshMediaUrls", () => {
  beforeEach(() => setCookie("csrftoken=t"));
  afterEach(() => vi.restoreAllMocks());

  it("re-resolves a fresh presigned URL for a restored project", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ id: "a1", assetId: "a1", url: "https://r2/fresh", mimeType: "image/jpeg", filename: "c.webp" })
      )
    );

    const stored = { photo: { url: "https://r2/long-expired", mimeType: "image/jpeg", filename: "c.webp", assetId: "a1" } };
    const result = (await refreshMediaUrls(stored)) as typeof stored;

    expect(result.photo.url).toBe("https://r2/fresh");
    expect(result.photo.assetId).toBe("a1");
  });

  it("leaves an unresolvable asset in place rather than deleting part of the keepsake", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: { code: "asset_not_found" } }, 404)));

    const stored = { photo: { url: "https://r2/old", mimeType: "image/jpeg", filename: "c.webp", assetId: "gone" } };
    const result = (await refreshMediaUrls(stored)) as typeof stored;

    expect(result.photo.assetId).toBe("gone");
  });

  it("does nothing for a photo that was never uploaded", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await refreshMediaUrls(MAP_VALUES);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
