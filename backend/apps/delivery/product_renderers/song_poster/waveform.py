"""The decorative waveform every Song Poster theme draws.

WHY IT EXISTS AND WHAT IT IS NOT. No audio file is ever uploaded — Song
Poster asks for track/artist/duration/moment as text, and links to the
real song via an embedded YouTube video rather than hosting audio
Heartfolio would need a license for. This waveform is therefore never
derived from the actual song; it is a stylised shape, seeded per order
so two different orders do not produce the identical bars the prototype
always did (its `SEED` was a single hardcoded constant, so the shape
never varied — see `seed_for_order` below for what replaces that).

THE OVERALL SHAPE IS FIXED; ONLY THE JITTER VARIES. `_NODES` is a
hand-authored envelope (rises, a mid dip, a late peak) that gives every
poster's waveform the same musical, non-random-looking contour — a
purely random walk reads as noise, not as music. The seed only decides
the fine jitter layered on top of that shape and the placement of the
rare "spike" values. This mirrors the prototype exactly; it is not a
simplification.
"""

from __future__ import annotations

from .seeded_random import mulberry32, str_seed

MASTER_N = 1400

#: (position 0–1, height 0–1) control points, smoothstep-interpolated
#: between them. Copied verbatim from the prototype's own `ENV` nodes —
#: this is authored art, not a formula, and is not something to
#: "improve" independently on one side.
_NODES: tuple[tuple[float, float], ...] = (
    (0, 0.03), (0.035, 0.28), (0.09, 0.33), (0.17, 0.60), (0.25, 0.56),
    (0.31, 0.88), (0.41, 0.83), (0.46, 0.34), (0.51, 0.40), (0.57, 0.70),
    (0.65, 0.97), (0.73, 0.90), (0.79, 0.42), (0.85, 0.79), (0.92, 0.52),
    (0.965, 0.15), (1, 0.02),
)


def _clamp(value: float, lo: float, hi: float) -> float:
    return lo if value < lo else hi if value > hi else value


def seed_for_order(track: str, artist: str) -> int:
    """The seed a real order actually uses: `strSeed(track + "|" + artist)`,
    matching every per-song seed the prototype derives elsewhere (its
    `codeSVG` decoration uses the identical expression). Kept as a named
    function rather than inlining the string join at each call site, so
    the exact separator (`"|"`) lives in exactly one place.
    """
    return str_seed(f"{track}|{artist}")


def generate_envelope(seed: int, n: int = MASTER_N) -> list[float]:
    """Direct port of the prototype's IIFE that builds `ENV`:

        const r=mulberry32(SEED);
        const nodes=[...];
        for(let i=0;i<MASTER_N;i++){
          const t=i/(MASTER_N-1);
          let k=0; while(k<nodes.length-2 && nodes[k+1][0]<t) k++;
          const a=nodes[k], b=nodes[k+1];
          const u=clamp((t-a[0])/(b[0]-a[0]||1),0,1), s=u*u*(3-2*u);
          let v=a[1]+(b[1]-a[1])*s;
          v*=.56+.44*r();
          if(r()<.03) v=Math.min(1,v*(1.3+.5*r()));
          out[i]=clamp(v,.012,1);
        }

    Note the PRNG is called up to 3 times per sample (twice unconditionally,
    a third time only inside the 3%-chance branch) — call order matters for
    matching the JS sequence exactly, so the branch below preserves it
    precisely rather than restructuring for Python idiom.
    """
    r = mulberry32(seed)
    out: list[float] = [0.0] * n

    for i in range(n):
        t = i / (n - 1)

        k = 0
        while k < len(_NODES) - 2 and _NODES[k + 1][0] < t:
            k += 1
        ax, ay = _NODES[k]
        bx, by = _NODES[k + 1]

        u = _clamp((t - ax) / (bx - ax or 1), 0, 1)
        s = u * u * (3 - 2 * u)
        v = ay + (by - ay) * s

        v *= 0.56 + 0.44 * r()
        if r() < 0.03:
            v = min(1.0, v * (1.3 + 0.5 * r()))

        out[i] = _clamp(v, 0.012, 1.0)

    return out


def downsample(envelope: list[float], n: int) -> list[float]:
    """Direct port of `ds(n)`: max-pools `envelope` down to `n` buckets —
    max, not average, so a brief loud moment survives the downsample
    instead of being smoothed away, which is what every theme's bar
    count (60 for Player's `waveEQ`, 90 for Contact Sheet) actually asks
    the full 1400-point envelope to do.
    """
    total = len(envelope)
    step = total / n
    out: list[float] = [0.0] * n

    for i in range(n):
        start = int(i * step)
        end = max(start + 1, int((i + 1) * step))
        out[i] = max(envelope[start:end])

    return out
