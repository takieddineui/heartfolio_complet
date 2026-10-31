/**
 * Photos are shrunk in the browser before they are uploaded (owner, 31 Oct
 * 2026), to the size the server keeps anyway (`apps/assets/images.py`): at
 * most 3,072 px on the short edge, the most any print takes from a photo.
 *
 * Why here as well as on the server: a 48-50 MP phone photo is 12-25 MB, over
 * the 10 MB upload limit, so it used to be refused at pick time; and a phone
 * on mobile data uploads 3-4 MB instead of 25. The server still processes
 * every upload itself (upright, sRGB, no metadata, the same cap), so this is
 * an optimisation, never the safety net.
 *
 * ONLY WHEN IT HELPS. A photo already within the cap and the upload limit is
 * sent as picked: re-encoding it here would cost a generation of JPEG
 * quality and time for nothing. A HEIC/HEIF photo the browser can decode
 * (Safari) is converted to JPEG, which the server accepts.
 *
 * The browser applies the photo's EXIF orientation when it decodes it, and
 * draws into an sRGB canvas, so a resized photo is upright and in sRGB, and
 * like any canvas export it carries no metadata: no GPS leaves the phone.
 * Anything that fails (a decode error, a canvas too large for the device)
 * returns the original file, which the usual checks then accept or refuse.
 */

import { MAX_ASSET_SIZE_BYTES } from "@/lib/api/assets";

/** = `MASTER_SHORT_EDGE` / `MASTER_LONG_EDGE` in `apps/assets/images.py`
 * (pinned by `photo-resize.test.ts`). */
export const MASTER_SHORT_EDGE = 3072;
export const MASTER_LONG_EDGE = 6144;
/** = `MASTER_JPEG_QUALITY`, as a canvas takes it. */
export const UPLOAD_JPEG_QUALITY = 0.92;
/** iOS Safari refuses to draw a canvas above 16,777,216 pixels; only an
 * extreme panorama at the long-edge cap gets near it. */
export const MAX_CANVAS_PIXELS = 16_777_216;
/** A file above this is not even decoded (a phone could run out of memory
 * on it); the size check then refuses it as before. */
export const MAX_SOURCE_PHOTO_MB = 100;

const RESIZABLE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export interface DecodedPhoto {
  /** Upright size, the EXIF orientation applied. */
  width: number;
  height: number;
  /** Draws the photo at `width` x `height` and encodes it. */
  encode(width: number, height: number, type: string, quality: number): Promise<Blob | null>;
  close(): void;
}

export type PhotoDecoder = (file: File) => Promise<DecodedPhoto>;

/** The size a `width` x `height` photo is uploaded at: unchanged within the
 * caps, else scaled down to fit them, keeping its shape. The server's
 * `master_size` plus the canvas limit. */
export function uploadSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(
    1,
    MASTER_SHORT_EDGE / Math.min(width, height),
    MASTER_LONG_EDGE / Math.max(width, height),
    Math.sqrt(MAX_CANVAS_PIXELS / (width * height))
  );
  if (scale >= 1) return { width, height };
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function isHeic(type: string): boolean {
  return type === "image/heic" || type === "image/heif";
}

/** The photo to upload in place of `file`: the same file when nothing needs
 * doing, else a resized (or converted) copy. Never throws. */
export async function prepareImageForUpload(file: File, decode: PhotoDecoder = decodeInBrowser): Promise<File> {
  if (!RESIZABLE_TYPES.includes(file.type) || file.size > MAX_SOURCE_PHOTO_MB * 1024 * 1024) return file;

  let photo: DecodedPhoto;
  try {
    photo = await decode(file);
  } catch {
    return file;
  }
  try {
    const target = uploadSize(photo.width, photo.height);
    const resize = target.width !== photo.width || target.height !== photo.height;
    if (!resize && file.size <= MAX_ASSET_SIZE_BYTES && !isHeic(file.type)) return file;

    // Transparency is kept where the format can hold it; HEIC becomes JPEG.
    const type = file.type === "image/png" || file.type === "image/webp" ? file.type : "image/jpeg";
    const blob = await photo.encode(target.width, target.height, type, UPLOAD_JPEG_QUALITY);
    if (!blob || blob.size === 0) return file;
    const encodedType = blob.type || type;
    const name = encodedType === "image/jpeg" && file.type !== "image/jpeg" ? file.name.replace(/\.[^.]*$/, "") + ".jpg" : file.name;
    return new File([blob], name, { type: encodedType, lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    photo.close();
  }
}

/** Decodes through an `<img>`: every current browser applies the EXIF
 * orientation to its natural size and when drawing it, and a canvas is sRGB
 * by default, so the browser converts wide-colour photos on the way. */
export async function decodeInBrowser(file: File): Promise<DecodedPhoto> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  try {
    await image.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
    encode(width, height, type, quality) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return Promise.resolve(null);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, width, height);
      return new Promise((resolve) =>
        canvas.toBlob((blob) => {
          // Release the bitmap now: a 12 MP canvas holds about 48 MB.
          canvas.width = 0;
          canvas.height = 0;
          resolve(blob);
        }, type, quality)
      );
    },
    close() {
      URL.revokeObjectURL(url);
    },
  };
}
