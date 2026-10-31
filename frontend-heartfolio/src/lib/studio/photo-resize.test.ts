import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { backendRoot } from "../../../test/backend-root";
import { MAX_ASSET_SIZE_BYTES } from "@/lib/api/assets";
import {
  MASTER_LONG_EDGE,
  MASTER_SHORT_EDGE,
  MAX_CANVAS_PIXELS,
  UPLOAD_JPEG_QUALITY,
  prepareImageForUpload,
  uploadSize,
  type DecodedPhoto,
  type PhotoDecoder,
} from "./photo-resize";

const MB = 1024 * 1024;

function fileOf(size: number, type = "image/jpeg", name = "IMG_0001.jpg"): File {
  return new File([new Uint8Array(size)], name, { type, lastModified: 1_700_000_000_000 });
}

function decoderFor(width: number, height: number, encoded: Blob | null = new Blob([new Uint8Array(3 * MB)], { type: "image/jpeg" })) {
  const encode = vi.fn<DecodedPhoto["encode"]>(async () => encoded);
  const close = vi.fn<DecodedPhoto["close"]>();
  const photo = { width, height, encode, close };
  return { photo, decode: vi.fn<PhotoDecoder>(async () => photo) };
}

describe("the Studio's photo resize", () => {
  it("uses the server's own cap and quality", () => {
    const source = readFileSync(join(backendRoot(), "apps/assets/images.py"), "utf8");
    const value = (name: string) => Number(source.match(new RegExp(`^${name} = (\\d+)$`, "m"))?.[1]);
    expect(MASTER_SHORT_EDGE).toBe(value("MASTER_SHORT_EDGE"));
    expect(MASTER_LONG_EDGE).toBe(value("MASTER_LONG_EDGE"));
    expect(UPLOAD_JPEG_QUALITY * 100).toBe(value("MASTER_JPEG_QUALITY"));
  });

  it("sizes like the server's master_size, within the canvas limit", () => {
    expect(uploadSize(4032, 3024)).toEqual({ width: 4032, height: 3024 });
    expect(uploadSize(6120, 8160)).toEqual({ width: 3072, height: 4096 });
    expect(uploadSize(8160, 6120)).toEqual({ width: 4096, height: 3072 });
    expect(uploadSize(4000, 6000)).toEqual({ width: 3072, height: 4608 });
    expect(uploadSize(12000, 2000)).toEqual({ width: 6144, height: 1024 });
    expect(uploadSize(800, 600)).toEqual({ width: 800, height: 600 });
    // Within both caps but 18.9 MP: iOS Safari would refuse that canvas.
    const panorama = uploadSize(6144, 3072);
    expect(panorama.width * panorama.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    expect(panorama.width / panorama.height).toBeCloseTo(2, 2);
  });

  it("shrinks a 50 MP photo, upright as decoded, and keeps its name", async () => {
    const { photo, decode } = decoderFor(6120, 8160);
    const result = await prepareImageForUpload(fileOf(26 * MB), decode);

    expect(photo.encode).toHaveBeenCalledWith(3072, 4096, "image/jpeg", 0.92);
    expect(result.size).toBe(3 * MB);
    expect(result.size).toBeLessThanOrEqual(MAX_ASSET_SIZE_BYTES);
    expect(result.type).toBe("image/jpeg");
    expect(result.name).toBe("IMG_0001.jpg");
    expect(photo.close).toHaveBeenCalled();
  });

  it("sends a photo within the cap and the limit exactly as picked", async () => {
    const { photo, decode } = decoderFor(4032, 3024);
    const original = fileOf(4 * MB);
    expect(await prepareImageForUpload(original, decode)).toBe(original);
    expect(photo.encode).not.toHaveBeenCalled();
    expect(photo.close).toHaveBeenCalled();
  });

  it("re-encodes a photo within the cap that is over the upload limit", async () => {
    const { photo, decode } = decoderFor(3000, 2000);
    await prepareImageForUpload(fileOf(12 * MB), decode);
    expect(photo.encode).toHaveBeenCalledWith(3000, 2000, "image/jpeg", 0.92);
  });

  it("keeps PNG transparency and converts HEIC to JPEG", async () => {
    const png = decoderFor(5000, 3500, new Blob([new Uint8Array(10)], { type: "image/png" }));
    const pngResult = await prepareImageForUpload(fileOf(30 * MB, "image/png", "cut.png"), png.decode);
    expect(png.photo.encode).toHaveBeenCalledWith(4389, 3072, "image/png", 0.92);
    expect(pngResult.name).toBe("cut.png");
    expect(pngResult.type).toBe("image/png");

    const heic = decoderFor(4032, 3024, new Blob([new Uint8Array(10)], { type: "image/jpeg" }));
    const heicResult = await prepareImageForUpload(fileOf(2 * MB, "image/heic", "IMG_0002.HEIC"), heic.decode);
    expect(heic.photo.encode).toHaveBeenCalledWith(4032, 3024, "image/jpeg", 0.92);
    expect(heicResult.type).toBe("image/jpeg");
    expect(heicResult.name).toBe("IMG_0002.jpg");
  });

  it("returns the original whenever anything fails, and leaves other files alone", async () => {
    const big = fileOf(26 * MB);
    expect(await prepareImageForUpload(big, vi.fn<PhotoDecoder>(async () => Promise.reject(new Error("decode"))))).toBe(big);
    expect(await prepareImageForUpload(big, decoderFor(6120, 8160, null).decode)).toBe(big);

    const failing = decoderFor(6120, 8160);
    failing.photo.encode.mockRejectedValue(new Error("canvas"));
    expect(await prepareImageForUpload(big, failing.decode)).toBe(big);
    expect(failing.photo.close).toHaveBeenCalled();

    const huge = fileOf(101 * MB);
    const untouched = decoderFor(20000, 15000);
    expect(await prepareImageForUpload(huge, untouched.decode)).toBe(huge);
    expect(untouched.decode).not.toHaveBeenCalled();

    const voice = fileOf(5 * MB, "audio/mp4", "voice.m4a");
    const notAPhoto = decoderFor(1, 1);
    expect(await prepareImageForUpload(voice, notAPhoto.decode)).toBe(voice);
    expect(notAPhoto.decode).not.toHaveBeenCalled();
  });

  it("runs in the Studio before the size check", () => {
    const source = readFileSync(join(__dirname, "../../components/studio/generic-form/field-inputs.tsx"), "utf8");
    const prepared = source.indexOf("await prepareImageForUpload(picked)");
    expect(prepared).toBeGreaterThan(-1);
    expect(prepared).toBeLessThan(source.indexOf("checkFileAccepted(file)"));
  });
});
