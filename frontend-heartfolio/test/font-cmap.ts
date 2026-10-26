import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";

/**
 * Which characters a font file can draw: its `cmap`, read from a TTF/OTF or
 * a WOFF2 file. For guards only (no dependency): a face that lacks a letter
 * hands it to the next font in the stack, as Gaegu did with every French
 * accent (26 Oct 2026), and nothing else in a test can see that.
 *
 * WOFF2 (https://www.w3.org/TR/WOFF2/): one Brotli stream holds every table
 * in directory order; `cmap` is never transformed, so it is read as is.
 */

/** WOFF2's known-tag table, by index (only the ones that matter here are
 *  named; the index is all that is needed for the others). */
const KNOWN_TAGS: Record<number, string> = { 0: "cmap", 3: "hmtx", 10: "glyf", 11: "loca" };

function readBase128(data: Buffer, at: { offset: number }): number {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = data[at.offset++]!;
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return value;
  }
  throw new Error("invalid UIntBase128");
}

function cmapTable(file: string): Buffer {
  const data = readFileSync(file);
  const signature = data.toString("latin1", 0, 4);

  if (signature === "wOF2") {
    const numTables = data.readUInt16BE(12);
    const compressedLength = data.readUInt32BE(20);
    const at = { offset: 48 };
    const tables: { tag: string; length: number }[] = [];
    for (let i = 0; i < numTables; i++) {
      const flags = data[at.offset++]!;
      let tag = KNOWN_TAGS[flags & 0x3f] ?? `#${flags & 0x3f}`;
      if ((flags & 0x3f) === 63) {
        tag = data.toString("latin1", at.offset, at.offset + 4);
        at.offset += 4;
      }
      const transform = flags >> 6;
      const original = readBase128(data, at);
      const transformed =
        tag === "glyf" || tag === "loca" ? transform === 0 : transform !== 0;
      const length = transformed ? readBase128(data, at) : original;
      tables.push({ tag, length });
    }
    const stream = brotliDecompressSync(data.subarray(at.offset, at.offset + compressedLength));
    let offset = 0;
    for (const table of tables) {
      if (table.tag === "cmap") return stream.subarray(offset, offset + table.length);
      offset += table.length;
    }
    throw new Error(`${file}: no cmap`);
  }

  // TTF/OTF: the plain table directory.
  const numTables = data.readUInt16BE(4);
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    if (data.toString("latin1", record, record + 4) === "cmap") {
      const offset = data.readUInt32BE(record + 8);
      return data.subarray(offset, offset + data.readUInt32BE(record + 12));
    }
  }
  throw new Error(`${file}: no cmap`);
}

/** Every code point the font maps to a real glyph (not .notdef). */
export function fontCodePoints(file: string): Set<number> {
  const cmap = cmapTable(file);
  const covered = new Set<number>();
  const count = cmap.readUInt16BE(2);
  for (let i = 0; i < count; i++) {
    const platform = cmap.readUInt16BE(4 + i * 8);
    const encoding = cmap.readUInt16BE(6 + i * 8);
    const offset = cmap.readUInt32BE(8 + i * 8);
    if (!((platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0)) continue;
    const format = cmap.readUInt16BE(offset);

    if (format === 4) {
      const segments = cmap.readUInt16BE(offset + 6) / 2;
      const ends = offset + 14;
      const starts = ends + segments * 2 + 2;
      const deltas = starts + segments * 2;
      const rangeOffsets = deltas + segments * 2;
      for (let s = 0; s < segments; s++) {
        const end = cmap.readUInt16BE(ends + s * 2);
        const start = cmap.readUInt16BE(starts + s * 2);
        const delta = cmap.readInt16BE(deltas + s * 2);
        const rangeOffset = cmap.readUInt16BE(rangeOffsets + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let glyph: number;
          if (rangeOffset === 0) glyph = (c + delta) & 0xffff;
          else {
            const at = rangeOffsets + s * 2 + rangeOffset + (c - start) * 2;
            glyph = cmap.readUInt16BE(at);
            if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
          }
          if (glyph !== 0) covered.add(c);
        }
      }
    } else if (format === 12) {
      const groups = cmap.readUInt32BE(offset + 12);
      for (let g = 0; g < groups; g++) {
        const record = offset + 16 + g * 12;
        const start = cmap.readUInt32BE(record);
        const end = cmap.readUInt32BE(record + 4);
        const firstGlyph = cmap.readUInt32BE(record + 8);
        for (let c = start; c <= end; c++) if (firstGlyph + (c - start) !== 0) covered.add(c);
      }
    }
  }
  return covered;
}
