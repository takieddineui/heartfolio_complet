/**
 * ---------------------------------------------------------------------
 * MEDIA VALUES — the bridge between a picked file and a persistent asset
 * ---------------------------------------------------------------------
 * A photo passes through three states:
 *
 *   1. PICKED    { url: blob:…, mimeType, filename }        — local only
 *   2. UPLOADED  { url: blob:…, mimeType, filename, assetId } — at checkout
 *   3. RESTORED  { url: presigned, mimeType, filename, assetId } — on reload
 *
 * Why the file itself is not stored in the form values: `values` is
 * serialized to JSON and sent to Django as `project.data.values`, and a
 * `File` would silently serialize to `{}`. Instead the File lives in a
 * module-level registry keyed by its object URL, so the values object stays
 * JSON-safe at every moment and there is no way to accidentally persist a
 * browser handle.
 *
 * Why upload is deferred to checkout: `POST /assets/` requires a customer
 * identity, and identity requires the email collected at checkout. Uploading
 * during editing would 401 for every customer. (Verified against a live
 * backend, not assumed.)
 *
 * Everything here walks `values` generically, matching a media value by its
 * shape rather than by a known field path. That keeps it product-agnostic:
 * Love Story Timeline's `events[].photo` and Where We Met's top-level
 * `photo` are handled by the same code, and a future product needs none.
 */

import { getAsset, uploadAsset, type ApiAsset } from "@/lib/api/assets";

export interface MediaValue {
  url: string;
  mimeType: string;
  filename: string;
  /** The durable Django reference. Absent until the photo is uploaded. */
  assetId?: string;
}

/**
 * One photo, within a `PartialUploadFailure`, that has neither an
 * `assetId` nor a registered pending `File` — i.e. a photo the customer
 * picked, but whose file this tab no longer has a handle to and cannot
 * retry. Recovering requires the customer to re-select this specific
 * photo; see `PartialUploadFailure`'s own docstring for how this differs
 * from an ordinary (retryable) upload failure.
 */
export class MissingPendingFileError extends Error {
  constructor(public readonly filename: string) {
    super(`"${filename}" could not be uploaded — the selected file is no longer available.`);
    this.name = "MissingPendingFileError";
  }
}

/**
 * Thrown by `uploadPendingMedia` when one or more photos failed to
 * upload. Carries `values` — the SAME tree the caller would have gotten
 * back on full success, except the failed entries are left unchanged
 * (still pending, still retryable) instead of stamped with an `assetId`.
 *
 * The caller MUST persist `values` (via `replaceValues`) before retrying
 * or reporting the error, even though this rejects. Skipping that step is
 * exactly the bug this class exists to prevent: see `uploadPendingMedia`'s
 * own docstring for the confirmed failure this replaced (a successful
 * upload's `pendingFiles` entry was forgotten as an unconditional side
 * effect the moment it resolved, but a SIBLING photo's failure still
 * discarded the whole result — so the only record that the first photo
 * had already uploaded (its `assetId`) was silently thrown away, and a
 * retry could no longer re-upload it either, since its file was gone).
 *
 * `causes.some(c => c instanceof MissingPendingFileError)` tells the
 * caller whether a plain retry can work (every cause is a transient
 * upload failure, the file is still pending) or whether the customer
 * must re-select at least one photo first.
 */
export class PartialUploadFailure extends Error {
  constructor(public readonly values: unknown, public readonly causes: unknown[]) {
    super(`${causes.length} photo${causes.length === 1 ? "" : "s"} could not be uploaded.`);
    this.name = "PartialUploadFailure";
  }

  /** Whether recovering requires the customer to re-select a photo,
   * rather than just retrying checkout as-is. */
  get needsRepick(): boolean {
    return this.causes.some((c) => c instanceof MissingPendingFileError);
  }
}

/** Files awaiting upload, keyed by the object URL held in the form value. */
const pendingFiles = new Map<string, File>();

export function registerPendingFile(objectUrl: string, file: File): void {
  pendingFiles.set(objectUrl, file);
}

export function forgetPendingFile(objectUrl: string): void {
  pendingFiles.delete(objectUrl);
}

/** Test seam. */
export function __resetPendingFiles(): void {
  pendingFiles.clear();
}

export function isMediaValue(candidate: unknown): candidate is MediaValue {
  if (typeof candidate !== "object" || candidate === null) return false;
  const value = candidate as Record<string, unknown>;
  return typeof value.url === "string" && typeof value.mimeType === "string";
}

/**
 * Rebuilds `values`, replacing every media value for which `transform`
 * returns a new one. Structure-preserving and immutable: arrays stay
 * arrays, key order is untouched, and anything that isn't a media value is
 * passed through by reference. `values` is opaque product-module state, so
 * this must never reshape it.
 */
async function mapMediaValues(
  values: unknown,
  transform: (media: MediaValue) => Promise<MediaValue | null>
): Promise<unknown> {
  if (Array.isArray(values)) {
    return Promise.all(values.map((item) => mapMediaValues(item, transform)));
  }

  if (isMediaValue(values)) {
    return (await transform(values)) ?? values;
  }

  if (typeof values === "object" && values !== null) {
    const source = values as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      result[key] = await mapMediaValues(value, transform);
    }
    return result;
  }

  return values;
}

/** Every media value in the tree, in document order. */
export function collectMediaValues(values: unknown, found: MediaValue[] = []): MediaValue[] {
  if (Array.isArray(values)) {
    values.forEach((item) => collectMediaValues(item, found));
  } else if (isMediaValue(values)) {
    found.push(values);
  } else if (typeof values === "object" && values !== null) {
    Object.values(values as Record<string, unknown>).forEach((value) => collectMediaValues(value, found));
  }
  return found;
}

export function countPendingUploads(values: unknown): number {
  return collectMediaValues(values).filter((media) => !media.assetId && pendingFiles.has(media.url)).length;
}

/**
 * Uploads every picked-but-not-yet-uploaded photo and returns `values` with
 * each one carrying its `assetId`. Called at checkout, immediately after the
 * guest identity is established and before the project is saved — the
 * renderers require `photo.assetId`, so a project saved without this would
 * be unrenderable after payment.
 *
 * Already-uploaded photos are skipped, so a retried checkout does not
 * re-upload (and re-charge storage for) the same files.
 *
 * A media value with no `assetId` and no registered pending `File` is
 * unrecoverable without the customer re-selecting that specific photo —
 * see `MissingPendingFileError`. This used to instead return the value
 * unchanged, silently, which produced exactly the paid-but-undeliverable
 * failure mode reported and confirmed by reproduction: a Love Story
 * Timeline checkout where `events[0]`/`events[1]`'s photo uploads failed
 * (a proxied `POST /assets/` socket hang-up, forced deliberately to
 * reproduce this), `events[2]`'s upload SUCCEEDED in the same batch, and
 * retrying without reloading produced a project saved with `events[2]`
 * carrying a real `assetId` but `events[0]`/`events[1]` still missing
 * theirs — with a follow-up retry making zero `POST /assets/` requests
 * at all, because by then every event had *some* resolution (a real
 * `assetId`, or the old silent no-op) and nothing looked pending anymore.
 *
 * THE ROOT MECHANISM (not a stale/reloaded tab — the Studio holds no
 * draft outside this page's memory, so a reload clears the picked photos
 * too and the required-field check blocks Continue; confirmed by reading
 * `product-state-context.tsx` and `form-engine.ts`): `mapMediaValues`
 * walks an array (e.g. `events`) via `Promise.all`, so every event's
 * photo uploads CONCURRENTLY. `forgetPendingFile` used to run as soon as
 * an individual upload resolved — before anything is known about its
 * SIBLING uploads in the same batch. If `events[2]`'s upload finished
 * successfully while `events[0]`/`events[1]`'s were still failing,
 * `events[2]`'s file was already forgotten by the time `Promise.all`
 * rejected (because of 0/1's failure) and discarded the whole batch's
 * result — including `events[2]`'s freshly-earned `assetId`, which
 * existed nowhere: not in `pendingFiles` (forgotten) and not in
 * `values` (the caller never applied the rejected batch's result). A
 * retry then found `events[2]` with no `assetId` and no pending file —
 * unrecoverable without a re-pick, and (before this fix) silently passed
 * through instead of failing loudly.
 *
 * THE FIX: no per-item failure is allowed to affect a sibling's outcome.
 * Every upload in a batch is attempted to completion regardless of
 * whether others succeed or fail; failures are collected into
 * `PartialUploadFailure.causes` instead of rejecting the batch immediately,
 * and `PartialUploadFailure.values` carries every entry's best-known state
 * — freshly uploaded ones WITH their `assetId`, still-pending ones
 * unchanged and still retryable. The caller (`checkout-flow.tsx`) applies
 * `values` via `replaceValues` before retrying, so a retry only re-attempts
 * what actually still needs it.
 */
export async function uploadPendingMedia(values: unknown, signal?: AbortSignal): Promise<unknown> {
  const causes: unknown[] = [];

  const result = await mapMediaValues(values, async (media) => {
    if (media.assetId) return null; // already persisted

    const file = pendingFiles.get(media.url);
    if (!file) {
      // Unrecoverable here: no file to retry, and nothing this function
      // does can conjure one back. Recorded rather than thrown, so a
      // SIBLING upload in the same batch (e.g. another milestone's photo)
      // still gets the chance to complete and keep its assetId — see this
      // function's own docstring for why that matters.
      causes.push(new MissingPendingFileError(media.filename));
      return null; // keep the original value: still picked, still visible, just not uploaded
    }

    try {
      const asset: ApiAsset = await uploadAsset(file, signal);
      // Only forgotten once the upload has actually succeeded AND that
      // success is about to be returned as part of this batch's result —
      // never as a side effect that could outlive a sibling's failure.
      forgetPendingFile(media.url);
      return {
        ...media,
        assetId: asset.assetId,
        mimeType: asset.mimeType,
        filename: asset.filename ?? media.filename,
        // Preview keeps using the local object URL: it is already loaded,
        // costs nothing, and cannot expire mid-session the way the
        // presigned URL would.
      };
    } catch (cause) {
      // Deliberately NOT forgotten: `pendingFiles` still has this file,
      // so the very next checkout attempt retries exactly this upload —
      // the customer never needs to re-select it for a transient failure.
      causes.push(cause);
      return null; // keep the original value unchanged
    }
  });

  if (causes.length > 0) {
    throw new PartialUploadFailure(result, causes);
  }

  return result as Record<string, unknown>;
}

/**
 * Replaces stored URLs with freshly-presigned ones when a saved project is
 * reopened. The stored URL is always stale — presigned links live about
 * five minutes and a project may be reopened days later — so the preview
 * would otherwise show broken images.
 *
 * An asset that can no longer be resolved (deleted, or belonging to another
 * guest) is left as-is rather than dropped: silently deleting part of
 * someone's keepsake is worse than showing a broken thumbnail, and the
 * validation layer already reports what is missing.
 */
export async function refreshMediaUrls(values: unknown, signal?: AbortSignal): Promise<unknown> {
  return mapMediaValues(values, async (media) => {
    if (!media.assetId) return null;

    try {
      const asset = await getAsset(media.assetId, signal);
      return { ...media, url: asset.url, mimeType: asset.mimeType, filename: asset.filename ?? media.filename };
    } catch {
      return null;
    }
  }) as Promise<Record<string, unknown>>;
}

/**
 * Strips transient state before persistence. Currently a defensive no-op on
 * the value shape — the pending `File` deliberately never enters `values` —
 * but kept as the single, named place responsible for "what is safe to send
 * to Django", so a future field that does hold a browser handle has an
 * obvious home for its cleanup.
 */
export function toPersistableValues(values: Record<string, unknown>): Record<string, unknown> {
  return values;
}
