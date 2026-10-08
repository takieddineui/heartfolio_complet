// @vitest-environment node
/**
 * LIVE ASSET INTEGRATION — real uploads through the same-origin proxy into
 * Django, which writes to the configured storage backend (R2 in production,
 * the in-memory backend locally; `apps/assets/storage.py` is the only thing
 * that differs, and production refuses to boot with the mock).
 *
 * Run with:
 *   HEARTFOLIO_INTEGRATION_BASE=http://localhost:3000 npx vitest run assets.integration
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// This file runs in the `node` environment, not jsdom.
//
// Multipart upload is the reason. jsdom supplies its own `File` and
// `FormData`, and Node's fetch does not recognise either — the multipart
// body serializes to nothing and Django replies "No file was uploaded"
// (observed, not theorised). Under `node` the File, FormData and fetch
// implementations all come from the same runtime and the upload is a real
// one. Application code is unaffected: in a browser these are the
// browser's own, which is precisely what this is standing in for.
//
// The one thing `node` lacks is `document`, which the API client reads the
// CSRF cookie from, so the harness supplies a minimal one below.
import { File as NodeFile } from "node:buffer";
import { identifyGuest } from "@/lib/api/guest";
import { checkFileAccepted, getAsset, MAX_ASSET_SIZE_BYTES, uploadAsset } from "@/lib/api/assets";
import { ApiError } from "@/lib/api/errors";
import { realProjectEngine } from "@/lib/studio/engines/project-engine";
import {
  __resetPendingFiles,
  collectMediaValues,
  registerPendingFile,
  uploadPendingMedia,
} from "@/lib/studio/media-values";

// Real multi-megabyte uploads over HTTP; the 5s default is for unit tests.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 30_000 });

const BASE = process.env.HEARTFOLIO_INTEGRATION_BASE;
const suite = BASE ? describe : describe.skip;

function installBrowserLikeFetch(base: string) {
  const jar = new Map<string, string>();
  const realFetch = globalThis.fetch;

  // Minimal stand-in for the browser's cookie store: assigning a single
  // "name=value" appends rather than replaces, which is how document.cookie
  // actually behaves and what `readCookie` in the API client expects.
  const cookieStore = new Map<string, string>();
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      get cookie() {
        return [...cookieStore].map(([k, v]) => `${k}=${v}`).join("; ");
      },
      set cookie(entry: string) {
        const [pair] = entry.split(";");
        const [name, ...rest] = (pair ?? "").split("=");
        if (name) cookieStore.set(name.trim(), rest.join("="));
      },
    },
  });

  globalThis.fetch = async (input, init) => {
    const path = String(input);
    const url = path.startsWith("http") ? path : `${base}${path}`;
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    if (jar.size > 0) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    headers.set("origin", base);

    const response = await realFetch(url, { ...init, headers });
    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const [pair] = cookie.split(";");
      const [name, ...rest] = (pair ?? "").split("=");
      if (!name) continue;
      jar.set(name.trim(), rest.join("="));
      document.cookie = `${name.trim()}=${rest.join("=")}`;
    }
    return response;
  };
  return () => {
    globalThis.fetch = realFetch;
    jar.clear();
  };
}

/** A real, decodable JPEG — the backend stores bytes and the renderers
 * later have to open them, so a random blob would not be a fair test. */
const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

function jpegFile(name: string, sizeBytes?: number): File {
  const binary = Uint8Array.from(atob(TINY_JPEG_BASE64), (c) => c.charCodeAt(0));
  // Typed loosely on purpose: Node's `buffer.File` and the DOM `File` do not
  // agree on `BlobPart` (their `Blob` types differ), and this is the one
  // boundary where a Node file object is handed to browser-shaped code.
  const parts: Uint8Array[] = [binary];
  if (sizeBytes && sizeBytes > binary.length) {
    // Padding after EOI keeps the file decodable while reaching a target size.
    parts.push(new Uint8Array(sizeBytes - binary.length));
  }
  return new NodeFile(parts as never, name, { type: "image/jpeg" }) as unknown as File;
}

let restoreFetch = () => {};

suite("Assets ↔ Django ↔ object storage (live)", () => {
  beforeAll(() => {
    restoreFetch = installBrowserLikeFetch(BASE!);
  });
  afterAll(() => restoreFetch());

  it("refuses an upload before the guest identity exists", async () => {
    __resetPendingFiles();
    const error = await uploadAsset(jpegFile("nope.jpg")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isIdentityRequired).toBe(true);
  });

  it("stores a photo and returns a durable id plus a retrievable URL", async () => {
    await identifyGuest(`step8-basic-${Date.now()}@heartfolio.test`);

    const asset = await uploadAsset(jpegFile("keepsake.jpg"));
    expect(asset.assetId).toMatch(/^[0-9a-f-]{36}$/);
    expect(asset.mimeType).toBe("image/jpeg");
    expect(asset.filename).toBe("keepsake.jpg");
    expect(asset.url).toBeTruthy();

    // Re-resolving yields a fresh URL for the same durable id.
    const again = await getAsset(asset.assetId);
    expect(again.assetId).toBe(asset.assetId);
  });

  it("rejects an unsupported type at the backend, independently of the client check", async () => {
    await identifyGuest(`step8-type-${Date.now()}@heartfolio.test`);
    const pdf = new NodeFile([new Uint8Array(16)], "not-a-photo.pdf", { type: "application/pdf" }) as unknown as File;

    const error = await uploadAsset(pdf).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("invalid_asset_type");
  });

  /**
   * The over-limit case is caught in the browser, and that is what this
   * asserts — because the server-side rejection does NOT survive the proxy.
   *
   * Measured, not assumed: an 11MB upload sent straight to Django returns
   * 400 `asset_too_large` in ~0.1s. The identical upload sent through the
   * Next rewrite returns HTTP 500 after ~30s, because Django rejects and
   * closes the connection while the proxy is still streaming the body, and
   * the proxy reports its own timeout instead of Django's answer.
   *
   * So the client-side guard is not a nicety here, it is the thing that
   * gives the customer a real message instead of a 30-second hang. The
   * backend limit remains authoritative and independent — see the
   * unsupported-type test above, which proves the server rejects on its own
   * for a case that is small enough to reach it intact.
   */
  it("rejects an over-limit file in the browser, before it is ever sent", async () => {
    const tooBig = jpegFile("huge.jpg", MAX_ASSET_SIZE_BYTES + 1024);
    expect(checkFileAccepted(tooBig)).toBe("too-large");
  });

  it("carries an 8MB photo through the Next rewrite proxy intact", async () => {
    await identifyGuest(`step8-large-${Date.now()}@heartfolio.test`);
    const asset = await uploadAsset(jpegFile("large-photo.jpg", 8 * 1024 * 1024));
    expect(asset.assetId).toBeTruthy();
  });

  it.each([
    [
      "love-story-timeline",
      {
        partner1: "Amelia",
        events: [
          { title: "We met", photo: { url: "blob:lst-1", mimeType: "image/jpeg", filename: "met.jpg" } },
          { title: "No photo" },
        ],
      },
      ["blob:lst-1"],
    ],
    [
      "heart-map",
      {
        locationLabel: "Lyon",
        coordinates: { lat: 45.764043, lng: 4.835659 },
        photo: { url: "blob:wwm-1", mimeType: "image/jpeg", filename: "map.jpg" },
      },
      ["blob:wwm-1"],
    ],
  ])(
    "%s: upload → assetId → project → reload returns the same asset, still usable",
    async (productId, values, blobUrls) => {
      __resetPendingFiles();
      await identifyGuest(`step8-${productId}-${Date.now()}@heartfolio.test`);

      for (const url of blobUrls as string[]) {
        registerPendingFile(url, jpegFile(`${url}.jpg`));
      }

      // 1-3. Upload the pending photos, receiving durable ids.
      const uploaded = (await uploadPendingMedia(values)) as Record<string, unknown>;
      const assetIds = collectMediaValues(uploaded).map((m) => m.assetId);
      expect(assetIds.every(Boolean)).toBe(true);

      // 4-5. Those ids go into the project.
      const { projectId } = await realProjectEngine.save(undefined, {
        productId,
        values: uploaded,
        themeSelections: { palette: "dusk" },
      });

      // 6-7. Reload: the same asset ids come back.
      const loaded = await realProjectEngine.load(projectId);
      const reloadedIds = collectMediaValues(loaded!.state.values).map((m) => m.assetId);
      expect(reloadedIds).toEqual(assetIds);

      // 8. The asset is still usable — a fresh URL can be resolved for it.
      for (const assetId of assetIds) {
        const asset = await getAsset(assetId!);
        expect(asset.assetId).toBe(assetId);
        expect(asset.url).toBeTruthy();
      }
    }
  );

  it("does not let another guest read an uploaded photo", async () => {
    await identifyGuest(`step8-owner-${Date.now()}@heartfolio.test`);
    const asset = await uploadAsset(jpegFile("private.jpg"));

    await identifyGuest(`step8-intruder-${Date.now()}@heartfolio.test`);
    const error = await getAsset(asset.assetId).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isAccessDenied).toBe(true);
  });

  it("handles a missing asset safely", async () => {
    await identifyGuest(`step8-missing-${Date.now()}@heartfolio.test`);
    const error = await getAsset("00000000-0000-0000-0000-000000000000").catch((e: unknown) => e);
    expect((error as ApiError).code).toBe("asset_not_found");
  });
});
