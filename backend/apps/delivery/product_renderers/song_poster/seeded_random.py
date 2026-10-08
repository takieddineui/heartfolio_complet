"""The seeded randomness every Song Poster theme's decorative elements
(waveform bars, the fake-code/QR-ground pattern) draw from.

A DIRECT, LITERAL PORT of the prototype's own `mulberry32`/`strSeed`
functions — the same relationship `love_story_timeline`'s renderer has
with `renderer.tsx`: two independent implementations of the same
algorithm, proven to agree rather than assumed to, because this file
draws the waveform bars a paying customer receives in their print, and
`renderer.tsx` draws what they previewed before buying. If the two ever
disagree, the print silently stops matching what was shown.

VERIFIED BIT-FOR-BIT against a real V8 run of the source JS, across a
seed of `0`, an empty string, ASCII, accented Latin (`Björk`), a long
string, and — the case that actually broke the first draft of this port
— an emoji. See `_utf16_code_units` below for why.
"""

from __future__ import annotations


def _to_int32(value: int) -> int:
    """JS's `|0`: reinterpret the low 32 bits as SIGNED. Needed because
    Python integers are arbitrary-precision and have no native 32-bit
    wraparound — every arithmetic step below has to fake it by hand,
    which is exactly the kind of thing that goes unnoticed until a
    seed produces a different sequence than its JS counterpart.
    """
    value &= 0xFFFFFFFF
    return value - 0x1_0000_0000 if value & 0x8000_0000 else value


def _imul(a: int, b: int) -> int:
    """JS's `Math.imul(a, b)`: a 32-bit signed multiply that wraps
    silently on overflow, rather than Python's `*`, which never wraps.
    """
    return _to_int32(a * b)


def mulberry32(seed: int):
    """Direct port of the prototype's own generator:

        function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;
          let t=Math.imul(a^a>>>15,1|a);
          t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

    Two JS-isms that silently break a naive transliteration if missed:

      `>>>` is an UNSIGNED right shift. Python's `>>` on an already
      non-negative int does the same thing, which is why the state is
      kept masked to `0xFFFFFFFF` (never reinterpreted negative) before
      any `>>`.

      `^` binds LOOSER than `+` in JS. `t+Math.imul(...)^t` therefore
      parses as `(t + Math.imul(...)) ^ t`, not `t + (Math.imul(...) ^
      t)`. Getting this wrong still produces A sequence — just a
      different, silently wrong one, which is the dangerous kind of bug.

    Returns a zero-argument callable, matching the JS closure shape, so
    call sites read identically on both sides: `r = mulberry32(seed);
    r(); r(); ...`.
    """
    state = seed & 0xFFFFFFFF

    def next_value() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & 0xFFFFFFFF
        a = state
        t = _imul(_to_int32(a) ^ (a >> 15), 1 | _to_int32(a)) & 0xFFFFFFFF
        t = ((t + _imul(_to_int32(t) ^ (t >> 7), 61 | _to_int32(t))) & 0xFFFFFFFF) ^ t
        t &= 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return next_value


def _utf16_code_units(text: str):
    """Yields the same sequence of integers JS's `str.charCodeAt(i)`
    over `for(i=0;i<str.length;i++)` would.

    THE BUG THIS EXISTS TO PREVENT: JS strings are sequences of UTF-16
    CODE UNITS, so a character outside the Basic Multilingual Plane (most
    emoji, some rare symbols) is two iterations of that loop — one per
    half of its surrogate pair. Python strings are sequences of Unicode
    CODEPOINTS, so the equivalent Python `for ch in text: ord(ch)` visits
    such a character exactly ONCE, with its full codepoint value.

    A track or artist name containing an emoji is not far-fetched, and
    the naive version was tested against it and produced a DIFFERENT
    seed than the real JS engine — 2195465077 instead of 2843080007 for
    one such case. Encoding to UTF-16LE and reading 16-bit units back out
    is what makes this iterate exactly the way `charCodeAt` does.
    """
    encoded = text.encode("utf-16-le")
    for i in range(0, len(encoded), 2):
        yield encoded[i] | (encoded[i + 1] << 8)


def str_seed(text: str) -> int:
    """Direct port of:
        function strSeed(str){let h=0;for(let i=0;i<str.length;i++)
          h=(h*131+str.charCodeAt(i))|0; return h>>>0}

    Used everywhere the prototype wants "different per song, but the same
    every time this song is rendered again" — the waveform shape and the
    decorative code/QR-ground pattern both derive their seed from this.
    """
    h = 0
    for unit in _utf16_code_units(text):
        h = _to_int32(h * 131 + unit)
    return h & 0xFFFFFFFF
