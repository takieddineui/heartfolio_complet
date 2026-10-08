import { describe, expect, it } from "vitest";
import { buildZip } from "../../test/zip-fixture";
import { isCompleteZip } from "./zip-integrity";

const blobOf = (bytes: Uint8Array) => new Blob([bytes as BlobPart]);

describe("isCompleteZip", () => {
  it("accepts a complete archive", async () => {
    expect(await isCompleteZip(blobOf(buildZip({ "a.png": "aaaa", "b.png": "bbbbbb" })))).toBe(true);
  });

  it("rejects an archive cut off part-way — the failure a worker timeout produces", async () => {
    const whole = buildZip({ "a.png": "a".repeat(5000), "b.png": "b".repeat(5000) });

    // Truncated at every interesting point: mid-file, and just before the
    // end-of-central-directory record. None may pass.
    for (const keep of [10, 2500, 7000, whole.length - 23, whole.length - 22, whole.length - 1]) {
      expect(await isCompleteZip(blobOf(whole.slice(0, keep))), `kept ${keep} of ${whole.length}`).toBe(false);
    }
  });

  it("rejects bytes that are not a zip at all", async () => {
    expect(await isCompleteZip(blobOf(new TextEncoder().encode("zip-bytes")))).toBe(false);
    expect(await isCompleteZip(blobOf(new Uint8Array(0)))).toBe(false);
    expect(await isCompleteZip(blobOf(new TextEncoder().encode('{"error":{"code":"x"}}')))).toBe(false);
  });

  it("rejects an archive with nothing in it — the backend never builds one on purpose", async () => {
    expect(await isCompleteZip(blobOf(buildZip({})))).toBe(false);
  });

  it("is not fooled by an end-of-central-directory signature appearing inside file data", async () => {
    // A truncated archive whose last bytes happen to contain the signature:
    // the 'comment length' that follows it cannot line up with end-of-file.
    const trap = new Uint8Array(40);
    new DataView(trap.buffer).setUint32(10, 0x06054b50, true);
    expect(await isCompleteZip(blobOf(trap))).toBe(false);
  });

  it("rejects an archive whose directory does not end where the record says", async () => {
    const whole = buildZip({ "a.png": "aaaa" });
    // Drop a byte from the body so the directory offset in the EOCD is stale.
    const corrupted = new Uint8Array(whole.length - 1);
    corrupted.set(whole.slice(0, 5), 0);
    corrupted.set(whole.slice(6), 5);
    expect(await isCompleteZip(blobOf(corrupted))).toBe(false);
  });
});
