/**
 * Whether a downloaded blob is a COMPLETE zip archive.
 *
 * WHY THIS EXISTS: the pack archive is streamed (`_iter_pack_archive` in
 * apps/delivery/views.py), so the 200 status and the first megabytes are on
 * the wire long before the last entry has rendered. If the server dies
 * mid-render — gunicorn's worker timeout did exactly that — the response
 * simply stops. `fetch` then resolves `response.blob()` with whatever
 * arrived, nothing rejects, and the customer is handed a "successful"
 * download that Windows reports as an invalid folder.
 *
 * A zip's table of contents is its LAST record (the end-of-central-
 * directory, "EOCD"), written by `ZipFile.close()` only after every entry
 * has been written. A truncated archive therefore cannot contain a valid
 * one, which makes "is the EOCD there, and does it describe the bytes in
 * front of it" a complete test for the failure this guards against — no
 * unzip library and no full read of the file needed.
 */

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_LENGTH = 22;
/** The EOCD's trailing comment is at most 65535 bytes, so the record starts
 *  no further than this from the end of the file. */
const MAX_TAIL = EOCD_LENGTH + 0xffff;

export async function isCompleteZip(blob: Blob): Promise<boolean> {
  if (blob.size < EOCD_LENGTH) return false;

  const tailStart = Math.max(0, blob.size - MAX_TAIL);
  const tail = new DataView(await blob.slice(tailStart).arrayBuffer());

  for (let i = tail.byteLength - EOCD_LENGTH; i >= 0; i--) {
    if (tail.getUint32(i, true) !== EOCD_SIGNATURE) continue;

    // The record must end exactly at the end of the file. A byte sequence
    // that merely looks like the signature inside compressed data fails
    // this, because its "comment length" will not line up with EOF.
    const commentLength = tail.getUint16(i + 20, true);
    if (i + EOCD_LENGTH + commentLength !== tail.byteLength) continue;

    const entries = tail.getUint16(i + 10, true);
    const directorySize = tail.getUint32(i + 12, true);
    const directoryOffset = tail.getUint32(i + 16, true);

    // The backend refuses to build an empty pack, so an empty archive is a
    // sign something went wrong rather than a legitimate download.
    if (entries === 0) return false;

    // ZIP64 stores the real values in a separate record. Python writes it
    // only past 4GB, which no pack approaches; the signature and the exact
    // EOF alignment above are all that can be checked in that case.
    const isZip64 = entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff;
    if (isZip64) return true;

    // The central directory must end exactly where the EOCD begins.
    return directoryOffset + directorySize === tailStart + i;
  }

  return false;
}
