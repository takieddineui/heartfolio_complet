/**
 * Django asset storage. The browser never talks to Cloudflare R2 directly
 * and never sees an R2 credential: it posts the file to Django, which
 * writes it to R2 server-side and returns a metadata record.
 *
 * IDENTITY IS REQUIRED — `POST /assets/` resolves the session customer and
 * returns 401 without one, exactly like projects. Per the approved flow,
 * photos are therefore uploaded at checkout (after the email step), and
 * the Studio holds a local preview until then. See `media-values.ts`.
 *
 * URLS ARE SHORT-LIVED AND MUST NOT BE PERSISTED. `url` is a presigned GET
 * generated fresh per request and valid for R2_PRESIGNED_URL_EXPIRY_SECONDS
 * (300s by default). The backend deliberately stores only `storage_key`,
 * never a URL. `assetId` is the durable reference — it is what goes into
 * `project.data.values…photo.assetId`, and what the delivery renderers use
 * to fetch the original bytes server-side.
 */

import { apiFetch } from "./client";

/** Mirrors `apps/assets/serializers.py::AssetSerializer`. */
export interface ApiAsset {
  id: string;
  assetId: string;
  /** Presigned, expires in minutes. Display-only; never store this. */
  url: string;
  mimeType: string;
  filename: string | null;
}

/** Mirrors the backend's own limits so a file that would be rejected can be
 * caught at pick time, where the customer is looking, instead of failing
 * later at checkout. Kept in sync with `MAX_ASSET_SIZE_MB`,
 * `MAX_MEDIA_SIZE_MB` and `ALLOWED_ASSET_MIME_TYPES` in
 * config/settings/base.py.
 *
 * THIS DRIFTED ONCE ALREADY: `ALLOWED_ASSET_MIME_TYPES` here used to list
 * only the three image types, silently rejecting every §5 voice-note/video
 * recording with "isn't a supported format" before it ever reached the
 * backend — which has allowed audio and video since §5 shipped. No
 * customer's recording could ever get past this client-side pre-check,
 * regardless of what the backend or the rest of the pipeline supported. */
export const MAX_ASSET_SIZE_MB = 10;
export const MAX_ASSET_SIZE_BYTES = MAX_ASSET_SIZE_MB * 1024 * 1024;
//: §5 — media (audio/video) gets a much larger ceiling than a photo, the
//: same reasoning `apps/assets/services.py::validate_uploaded_file` gives:
//: the image limit would reject three seconds of phone footage.
export const MAX_MEDIA_SIZE_MB = 50;
export const MAX_MEDIA_SIZE_BYTES = MAX_MEDIA_SIZE_MB * 1024 * 1024;

export const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
//: §5 — mirrors `VIDEO_MIME_TYPES`/`AUDIO_MIME_TYPES` in apps/assets/media.py.
export const ALLOWED_MEDIA_MIME_TYPES = [
  "video/mp4", "video/quicktime", "video/webm",
  "audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "audio/webm",
  // WhatsApp voice notes (.opus/.ogg), iPhone .m4a and .mp3 - the files a
  // graduation organiser RECEIVES. The backend re-encodes all audio to AAC.
  "audio/ogg", "audio/opus", "audio/x-m4a", "audio/mp3",
] as const;
export const ALLOWED_ASSET_MIME_TYPES = [...ALLOWED_IMAGE_MIME_TYPES, ...ALLOWED_MEDIA_MIME_TYPES] as const;

export type AssetRejectionReason = "too-large" | "unsupported-type";

function isMediaMimeType(mimeType: string): boolean {
  return (ALLOWED_MEDIA_MIME_TYPES as readonly string[]).includes(mimeType);
}

/** The size ceiling that applies to a given mime type — for building an
 * accurate `{maxSizeMb}` rejection message, since it differs by kind. */
export function maxSizeMbFor(mimeType: string): number {
  return isMediaMimeType(mimeType) ? MAX_MEDIA_SIZE_MB : MAX_ASSET_SIZE_MB;
}

/** Client-side pre-check. Not a security control — the backend validates
 * independently and authoritatively; this exists purely so the customer
 * finds out immediately rather than after a long upload. */
export function checkFileAccepted(file: File): AssetRejectionReason | null {
  if (!ALLOWED_ASSET_MIME_TYPES.includes(file.type as (typeof ALLOWED_ASSET_MIME_TYPES)[number])) {
    return "unsupported-type";
  }
  const limit = isMediaMimeType(file.type) ? MAX_MEDIA_SIZE_BYTES : MAX_ASSET_SIZE_BYTES;
  if (file.size > limit) return "too-large";
  return null;
}

export async function uploadAsset(file: File, signal?: AbortSignal): Promise<ApiAsset> {
  const formData = new FormData();
  // Field name is fixed by the backend view: `request.FILES.get("file")`.
  formData.append("file", file);
  return apiFetch<ApiAsset>("/assets", { method: "POST", formData, signal });
}

/** Re-resolves an asset, primarily to obtain a fresh presigned URL for a
 * previously-saved project whose stored URL has long since expired. */
export async function getAsset(assetId: string, signal?: AbortSignal): Promise<ApiAsset> {
  return apiFetch<ApiAsset>(`/assets/${assetId}`, { method: "GET", signal });
}

export async function deleteAsset(assetId: string, signal?: AbortSignal): Promise<void> {
  await apiFetch<void>(`/assets/${assetId}`, { method: "DELETE", parse: "none", signal });
}
