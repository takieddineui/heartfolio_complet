/**
 * The client-side twin of the backend's `waveform.py` — see that file's
 * own docstring for why this exists (no audio is ever uploaded; the
 * waveform is a stylised shape, seeded per order so two orders do not
 * draw the identical bars the prototype always did).
 *
 * UNLIKE THE PYTHON PORT, this one needed no correctness work: these are
 * the prototype's own `mulberry32`/`strSeed`/envelope/`ds()` functions,
 * lifted verbatim rather than translated — the one and only change is
 * that the seed is now a parameter instead of the fixed module-level
 * `SEED` constant. The Python side is the one that had to be proven
 * against this JS bit-for-bit (see `seeded_random.py`'s docstring); this
 * file IS the reference the Python was checked against.
 */

const MASTER_N = 1400;

/** (position 0–1, height 0–1) control points — identical to `_NODES` in
 *  `waveform.py`; keep the two in sync by hand if either ever changes. */
const NODES: ReadonlyArray<readonly [number, number]> = [
  [0, 0.03], [0.035, 0.28], [0.09, 0.33], [0.17, 0.6], [0.25, 0.56],
  [0.31, 0.88], [0.41, 0.83], [0.46, 0.34], [0.51, 0.4], [0.57, 0.7],
  [0.65, 0.97], [0.73, 0.9], [0.79, 0.42], [0.85, 0.79], [0.92, 0.52],
  [0.965, 0.15], [1, 0.02],
];

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

/** The prototype's own `mulberry32`, unedited. */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The prototype's own `strSeed`, unedited. */
export function strSeed(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 131 + str.charCodeAt(i)) | 0;
  return h >>> 0;
}

/** `str_seed(f"{track}|{artist}")` on the Python side — kept as one
 *  named function on both sides so the separator lives in exactly one
 *  place per language, not duplicated at every call site. */
export function seedForOrder(track: string, artist: string): number {
  return strSeed(`${track}|${artist}`);
}

/** The prototype's own envelope-building IIFE, made callable with a seed
 *  argument instead of running once against the fixed `SEED` constant. */
export function generateEnvelope(seed: number, n: number = MASTER_N): Float64Array {
  const r = mulberry32(seed);
  const out = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);

    let k = 0;
    while (k < NODES.length - 2 && NODES[k + 1]![0] < t) k++;
    const a = NODES[k]!;
    const b = NODES[k + 1]!;

    const u = clamp((t - a[0]) / (b[0] - a[0] || 1), 0, 1);
    const s = u * u * (3 - 2 * u);
    let v = a[1] + (b[1] - a[1]) * s;

    v *= 0.56 + 0.44 * r();
    if (r() < 0.03) v = Math.min(1, v * (1.3 + 0.5 * r()));

    out[i] = clamp(v, 0.012, 1);
  }

  return out;
}

/** The prototype's own `ds(n)` — max-pool downsample, unedited. */
export function downsample(envelope: Float64Array, n: number): Float64Array {
  const out = new Float64Array(n);
  const step = envelope.length / n;

  for (let i = 0; i < n; i++) {
    let m = 0;
    const start = Math.floor(i * step);
    const end = Math.max(start + 1, Math.floor((i + 1) * step));
    for (let j = start; j < end; j++) m = Math.max(m, envelope[j]!);
    out[i] = m;
  }

  return out;
}
