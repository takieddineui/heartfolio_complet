"""
Text that mixes scripts, drawn the way the browser draws it.

The site's CSS gives Arabic its own face by `unicode-range` (`globals.css`:
"Heartfolio Serif" and "Heartfolio Sans" hand Arabic code points to Noto Kufi
and Noto Naskh, everything else to Fraunces and Inter). A browser therefore
picks the face CHARACTER BY CHARACTER: in "أحبك · HEARTFOLIO" the letters come
from Naskh and the dot and the Latin from the Latin face. A Pillow font is one
face, and the site's Noto files are subsets with no Latin-1 at all (no "…",
"·", "«", "é"), so drawing a whole mixed string in either face loses glyphs.

`MixedScriptFont` is a Pillow font that does what the browser does: it splits
a string into runs by face, orders the runs with the Unicode bidirectional
algorithm, shapes each run in its own direction (raqm), and lays them side by
side. Pillow measures and draws only through `getlength`, `getbbox` and
`getmask2` (`getmask` is `getmask2`), so wrapping, fitting and drawing all see
the same layout. A string with no character for the second face takes
Pillow's own path untouched, so Latin text renders byte for byte as before.

The bidi here is the Unicode algorithm (UAX #9) for one paragraph with
implicit levels only: rules W1-W7, N1-N2, I1-I2 and L1-L2, from the character
classes in `unicodedata`. Explicit embeddings and isolates (U+202A-202E,
U+2066-2069) are treated as neutrals; customer text does not carry them.
"""

from __future__ import annotations

import math
import re
import unicodedata

from PIL import Image, ImageChops, ImageFont

_STRONG = {"L": "L", "R": "R", "AL": "R"}
_NEUTRAL = {"B", "S", "WS", "ON", "BN", "LRE", "RLE", "LRO", "RLO", "PDF", "LRI", "RLI", "FSI", "PDI"}


def parse_unicode_range(css_range: str) -> list[tuple[int, int]]:
    """`"U+0600-06FF, U+FE70-FE74"` -> [(0x600, 0x6FF), (0xFE70, 0xFE74)]."""
    return [
        (int(low, 16), int(high or low, 16))
        for low, high in re.findall(r"U\+([0-9A-Fa-f]{4,6})(?:-([0-9A-Fa-f]{4,6}))?", css_range)
    ]


def bidi_levels(text: str) -> list[int]:
    """Each character's embedding level (UAX #9, one paragraph, implicit)."""
    types = [unicodedata.bidirectional(ch) or "ON" for ch in text]
    paragraph = next((1 if t in ("R", "AL") else 0 for t in types if t in _STRONG), 0)
    sor = "R" if paragraph else "L"

    # W1: a non-spacing mark takes the type of the character before it.
    for i, t in enumerate(types):
        if t == "NSM":
            types[i] = types[i - 1] if i else sor
    # W2: European numbers after Arabic letters are Arabic numbers. W3: AL is R.
    last_strong = sor
    for i, t in enumerate(types):
        if t in ("L", "R", "AL"):
            last_strong = t
        elif t == "EN" and last_strong == "AL":
            types[i] = "AN"
    types = ["R" if t == "AL" else t for t in types]
    # W4: one separator between two numbers of a kind joins them.
    for i in range(1, len(types) - 1):
        before, here, after = types[i - 1], types[i], types[i + 1]
        if here == "ES" and before == after == "EN":
            types[i] = "EN"
        elif here == "CS" and before == after and before in ("EN", "AN"):
            types[i] = before
    # W5: terminators next to European numbers become numbers.
    for i, t in enumerate(types):
        if t == "EN":
            j = i - 1
            while j >= 0 and types[j] == "ET":
                types[j] = "EN"
                j -= 1
            j = i + 1
            while j < len(types) and types[j] == "ET":
                types[j] = "EN"
                j += 1
    # W6: any separator or terminator left is a neutral.
    types = ["ON" if t in ("ES", "ET", "CS") else t for t in types]
    # W7: European numbers after L text are L.
    last_strong = sor
    for i, t in enumerate(types):
        if t in ("L", "R"):
            last_strong = t
        elif t == "EN" and last_strong == "L":
            types[i] = "L"
    # N1/N2: a run of neutrals takes the direction around it when both sides
    # agree (numbers count as R), else the paragraph's.
    i = 0
    while i < len(types):
        if types[i] not in _NEUTRAL:
            i += 1
            continue
        j = i
        while j < len(types) and types[j] in _NEUTRAL:
            j += 1
        before = "L" if i == 0 and sor == "L" else ("R" if i == 0 else ("L" if types[i - 1] == "L" else "R"))
        eos = sor
        after = eos if j == len(types) else ("L" if types[j] == "L" else "R")
        direction = before if before == after else sor
        for k in range(i, j):
            types[k] = direction
        i = j
    # I1/I2: implicit levels.
    levels = []
    for t in types:
        if paragraph == 0:
            levels.append(1 if t == "R" else 2 if t in ("AN", "EN") else 0)
        else:
            levels.append(2 if t in ("L", "EN", "AN") else 1)
    # L1: trailing whitespace returns to the paragraph level.
    for i in range(len(text) - 1, -1, -1):
        if unicodedata.bidirectional(text[i]) in ("WS", "S", "B", "BN") or text[i].isspace():
            levels[i] = paragraph
        else:
            break
    return levels


def visual_order(levels: list[int]) -> list[int]:
    """L2: logical indices in left-to-right display order."""
    order = list(range(len(levels)))
    if not levels:
        return order
    lowest_odd = min(level for level in levels if level % 2) if any(level % 2 for level in levels) else None
    if lowest_odd is None and max(levels) == 0:
        return order
    for level in range(max(levels), (lowest_odd or 1) - 1, -1):
        i = 0
        while i < len(order):
            if levels[order[i]] >= level:
                j = i
                while j < len(order) and levels[order[j]] >= level:
                    j += 1
                order[i:j] = reversed(order[i:j])
                i = j
            else:
                i += 1
    return order


class _GlyphCoverage:
    """Whether a face has a glyph for a character: it draws something other
    than its empty box. Cached per file."""

    _faces: dict = {}

    @classmethod
    def has(cls, face: ImageFont.FreeTypeFont, ch: str) -> bool:
        key = (face.path, ch)
        if key not in cls._faces:
            if face.path not in cls._faces:
                basic = ImageFont.truetype(face.path, 40, layout_engine=ImageFont.Layout.BASIC)
                cls._faces[face.path] = (basic, Image.Image()._new(basic.getmask("")).tobytes())
            basic, box = cls._faces[face.path]
            cls._faces[key] = Image.Image()._new(basic.getmask(ch)).tobytes() != box
        return cls._faces[key]


def has_glyph(face: ImageFont.FreeTypeFont, ch: str) -> bool:
    return _GlyphCoverage.has(face, ch)


class MixedScriptFont(ImageFont.FreeTypeFont):
    """A face (`path`) plus a `second` face that draws every character in
    `second_range`, as a CSS `unicode-range` would. A character either face
    lacks is drawn by the other when that one has it."""

    def __init__(self, path: str, size: int, *, second: ImageFont.FreeTypeFont, second_range: list[tuple[int, int]]):
        super().__init__(path, size=size)
        self.second = second
        self._second_range = second_range
        self._second_pattern = re.compile("[" + "".join(f"{re.escape(chr(low))}-{re.escape(chr(high))}" for low, high in second_range) + "]")
        # MEASUREMENT CACHES, per instance (so a variable face's weight is never
        # confused with another's). A fit search measures the same words
        # thousands of times; without these an Arabic Love Story Timeline print
        # took 5-16x longer to render (18 Oct 2026). Only default-argument
        # measurements are cached; anything else is measured afresh.
        self._runs_cache: dict = {}
        self._run_metrics_cache: dict = {}
        self._line_cache: dict = {}
        self._dy_cache: dict = {}

    # --- which face draws what ------------------------------------------
    def in_second_range(self, ch: str) -> bool:
        code = ord(ch)
        return any(low <= code <= high for low, high in self._second_range)

    def face_for_char(self, ch: str) -> ImageFont.FreeTypeFont:
        preferred, other = (self.second, self) if self.in_second_range(ch) else (self, self.second)
        if ch.isspace() or unicodedata.category(ch) in ("Cf", "Cc") or has_glyph(preferred, ch) or not has_glyph(other, ch):
            return preferred
        return other

    def _mixed(self, text: str) -> bool:
        return self._second_pattern.search(text) is not None

    def runs(self, text: str) -> list[tuple[str, ImageFont.FreeTypeFont, str]]:
        """(text, face, "ltr"/"rtl") runs in left-to-right display order; each
        run's text is in logical order, for raqm to shape in its direction."""
        if text in self._runs_cache:
            return self._runs_cache[text]
        levels = bidi_levels(text)
        faces = [self.face_for_char(ch) for ch in text]
        runs: list[tuple[str, ImageFont.FreeTypeFont, str]] = []
        order = visual_order(levels)
        i = 0
        while i < len(order):
            start = order[i]
            level, face = levels[start], faces[start]
            step = -1 if level % 2 else 1
            j = i + 1
            while j < len(order) and order[j] == order[j - 1] + step and levels[order[j]] == level and faces[order[j]] is face:
                j += 1
            logical = sorted(order[i:j])
            runs.append(("".join(text[k] for k in logical), face, "rtl" if level % 2 else "ltr"))
            i = j
        self._runs_cache[text] = runs
        return runs

    # --- layout -----------------------------------------------------------
    def _run_metrics(self, run: str, face: ImageFont.FreeTypeFont, direction: str) -> tuple[float, tuple]:
        """A run's advance and its box from the pen on the baseline."""
        key = (face is self, run, direction)
        if key not in self._run_metrics_cache:
            if face is self:
                length = ImageFont.FreeTypeFont.getlength(self, run, direction=direction)
                box = ImageFont.FreeTypeFont.getbbox(self, run, direction=direction, anchor="ls")
            else:
                length, box = face.getlength(run, direction=direction), face.getbbox(run, direction=direction, anchor="ls")
            self._run_metrics_cache[key] = (length, box)
        return self._run_metrics_cache[key]

    def _placements(self, text: str):
        """Each run with its pen x from the left of the line."""
        pen, placed = 0.0, []
        for run, face, direction in self.runs(text):
            placed.append((run, face, direction, pen))
            pen += self._run_metrics(run, face, direction)[0]
        return placed, pen

    def _anchor_offset(self, text: str, anchor: str | None, total: float) -> tuple[int, int]:
        """Where the anchor point sits relative to the line's left end on its
        baseline (y down), in whole pixels rounded exactly as Pillow rounds
        them (FreeType's 26.6 fixed point). The vertical anchor is the tallest
        face's own, read from Pillow, so a one-face line is placed exactly as
        Pillow places it."""
        anchor = anchor or "la"
        if len(anchor) != 2 or anchor[0] not in "lmr" or anchor[1] not in "amsd":
            raise ValueError(f"MixedScriptFont does not support anchor {anchor!r}")
        position = round(total * 64)
        dx = {"l": 0, "m": (position // 2 + 32) >> 6, "r": (position + 32) >> 6}[anchor[0]]
        tallest = max({face for _, face, _ in self.runs(text)}, key=lambda face: face.getmetrics()[0])
        key = (tallest is self, anchor[1])
        if key not in self._dy_cache:
            measure = ImageFont.FreeTypeFont.getbbox
            self._dy_cache[key] = measure(tallest, "x", anchor="ls")[1] - measure(tallest, "x", anchor="l" + anchor[1])[1]
        return dx, self._dy_cache[key]

    def getlength(self, text, mode="", direction=None, features=None, language=None):
        if not self._mixed(text):
            return super().getlength(text, mode, direction, features, language)
        return self._placements(text)[1]

    def getbbox(self, text, mode="", direction=None, features=None, language=None, stroke_width=0, anchor=None):
        if not self._mixed(text):
            return super().getbbox(text, mode, direction, features, language, stroke_width, anchor)
        plain = mode in ("", "L") and features is None and language is None and not stroke_width
        key = (text, anchor)
        if plain and key in self._line_cache:
            return self._line_cache[key]
        placed, total = self._placements(text)
        dx, dy = self._anchor_offset(text, anchor, total)
        boxes = []
        for run, face, run_direction, pen in placed:
            if plain:
                x0, y0, x1, y1 = self._run_metrics(run, face, run_direction)[1]
            else:
                x0, y0, x1, y1 = face.getbbox(run, mode, run_direction, features, language, stroke_width, "ls")
            boxes.append((x0 + pen, y0, x1 + pen, y1))
        box = (
            math.floor(min(b[0] for b in boxes) - dx),
            math.floor(min(b[1] for b in boxes) - dy),
            math.ceil(max(b[2] for b in boxes) - dx),
            math.ceil(max(b[3] for b in boxes) - dy),
        )
        if plain:
            self._line_cache[key] = box
        return box

    def getmask(self, text, mode="", *args, **kwargs):
        return self.getmask2(text, mode, *args, **kwargs)[0]

    def getmask2(self, text, mode="", direction=None, features=None, language=None, stroke_width=0, anchor=None, ink=0, start=None, *args, **kwargs):
        if not self._mixed(text):
            return super().getmask2(text, mode, direction, features, language, stroke_width, anchor, ink, start, *args, **kwargs)
        if mode not in ("", "L", "1"):
            raise ValueError(f"MixedScriptFont does not draw mode {mode!r}")
        start_x, start_y = start or (0.0, 0.0)
        placed, total = self._placements(text)
        dx, dy = self._anchor_offset(text, anchor, total)
        baseline = start_y - dy
        pieces = []
        for run, face, run_direction, pen in placed:
            x = start_x - dx + pen
            mask, (ox, oy) = face.getmask2(
                run, mode, run_direction, features, language, stroke_width, "ls", ink,
                (x - math.floor(x), baseline - math.floor(baseline)),
            )
            pieces.append((Image.Image()._new(mask), math.floor(x) + ox, math.floor(baseline) + oy))
        left = min(x for _, x, _ in pieces)
        top = min(y for _, _, y in pieces)
        right = max(x + image.width for image, x, _ in pieces)
        bottom = max(y + image.height for image, _, y in pieces)
        composite = Image.new(pieces[0][0].mode, (max(right - left, 0), max(bottom - top, 0)), 0)
        for image, x, y in pieces:
            if image.width and image.height:
                region = (x - left, y - top, x - left + image.width, y - top + image.height)
                composite.paste(ImageChops.lighter(composite.crop(region), image), region[:2])
        return composite.im, (left, top)
