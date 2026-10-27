"""Heartfolio social-pack brand kit.

Everything here is built in code from the project's OWN assets — the brand
fonts in `frontend-heartfolio/public/fonts`, the brand colour tokens from
`globals.css`, the logo geometry from `public/assets/logo-full.svg`, and the
REAL product renders (prints rendered by the project's Pillow renderers, and
the committed live-page/QR captures in `public/captures`). No AI imagery, no
invented UI.
"""
from __future__ import annotations
import functools, re
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

REPO = Path(__file__).resolve().parents[2]
FONTS = REPO / "frontend-heartfolio/public/fonts"
CAPTURES = REPO / "frontend-heartfolio/public/captures"
ASSETS = Path(__file__).resolve().parents[1] / "_assets"

# ---- Brand colours (from globals.css / data.py "classic" palette) ----
INK      = "#141b2e"   # ink-navy, headings
NAVY     = "#1d2540"
PARCH    = "#f7f1e6"   # parchment, page
CANDLE   = "#fffdf8"   # candle-white, cards
GOLD     = "#c9a24b"   # champagne-gold
GOLD_HI  = "#d9b968"
TERRA    = "#b5654b"   # dusty-terracotta
SAGE     = "#6b7a5e"
CHAR     = "#3a3a38"   # soft-charcoal, body
FOG      = "#dcd4c4"   # warm-fog
ROSE     = "#e3a79b"   # from logo ribbon midtone
# logo wordmark gradient
WORD_G   = [(0.0, "#E9A9A0"), (0.42, "#E0A487"), (1.0, "#D08F55")]
MARK_G   = ["#EBB0A6", "#DE9B85", "#C5854F"]

# ---- Fonts (the product's real faces) ----
F_SERIF = str(FONTS / "fraunces-latin.woff2")      # Heartfolio Serif
F_SANS  = str(FONTS / "inter-latin.woff2")         # Heartfolio Sans
F_MONO  = str(FONTS / "jetbrains-mono-latin.woff2")
F_KUFI  = str(FONTS / "noto-kufi-arabic.woff2")    # Arabic display
F_NASKH = str(FONTS / "noto-naskh-arabic.woff2")   # Arabic text

@functools.lru_cache(maxsize=256)
def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)

def is_rtl(locale: str) -> bool:
    return locale == "ar"

# Serif/sans picker that swaps to the Arabic faces for Arabic text.
def head_font(locale: str, size: int) -> ImageFont.FreeTypeFont:
    return font(F_KUFI if is_rtl(locale) else F_SERIF, size)

def body_font(locale: str, size: int) -> ImageFont.FreeTypeFont:
    return font(F_NASKH if is_rtl(locale) else F_SANS, size)

def sans_font(locale: str, size: int) -> ImageFont.FreeTypeFont:
    return font(F_NASKH if is_rtl(locale) else F_SANS, size)

def _dir(locale: str):
    return "rtl" if is_rtl(locale) else "ltr"

def _lang(locale: str):
    return "ar" if is_rtl(locale) else "en"

# ---- Text helpers (raqm handles Arabic shaping + joining) ----
def text_size(d: ImageDraw.ImageDraw, s: str, f, locale="en", spacing=4):
    bbox = d.multiline_textbbox((0, 0), s, font=f, spacing=spacing,
                                language=_lang(locale))
    return bbox[2] - bbox[0], bbox[3] - bbox[1]

def line_w(d, s, f, locale="en"):
    b = d.textbbox((0, 0), s, font=f, language=_lang(locale))
    return b[2] - b[0]

def wrap(d, text, f, max_w, locale="en"):
    """Word-wrap to max_w. Works for both scripts (space-separated)."""
    words = text.split()
    lines, cur = [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if line_w(d, trial, f, locale) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur); cur = w
    if cur:
        lines.append(cur)
    return lines

def draw_line(d, xy, s, f, fill, locale="en", anchor=None):
    x, y = xy
    d.text((x, y), s, font=f, fill=fill, direction=_dir(locale),
           language=_lang(locale), anchor=anchor)

def draw_para(img, text, f, fill, *, box, locale="en", align="center",
              line_gap=1.3, valign="top"):
    """Wrap `text` inside box=(x,y,w,h); returns height used. RTL aware."""
    d = ImageDraw.Draw(img)
    x, y, w, h = box
    rtl = is_rtl(locale)
    lines = []
    for para in text.split("\n"):
        lines += wrap(d, para, f, w, locale) if para.strip() else [""]
    asc, desc = f.getmetrics()
    lh = int((asc + desc) * line_gap)
    total = lh * len(lines)
    cy = y
    if valign == "middle":
        cy = y + max(0, (h - total) // 2)
    for ln in lines:
        lw = line_w(d, ln, f, locale) if ln else 0
        if align == "center":
            lx = x + (w - lw) / 2
        elif align == "end":
            lx = x + (w - lw) if not rtl else x + (w - lw)
        elif align == "start":
            lx = x if not rtl else x + (w - lw)
        else:
            lx = x
        # For RTL we anchor the visual run to its right edge by drawing at
        # the computed left with direction=rtl (raqm lays it out correctly).
        if ln:
            d.text((lx, cy), ln, font=f, fill=fill, direction=_dir(locale),
                   language=_lang(locale))
        cy += lh
    return total

# ---- Gradient fill for a text string (the wordmark) ----
def _lerp(c1, c2, t):
    return tuple(round(a + (b - a) * t) for a, b in zip(c1, c2))

def _hex(c):
    c = c.lstrip("#")
    return tuple(int(c[i:i+2], 16) for i in (0, 2, 4))

def h_gradient(size, stops):
    w, h = size
    grad = Image.new("RGB", (w, 1))
    px = grad.load()
    pts = [(p, _hex(c)) for p, c in stops]
    for x in range(w):
        t = x / max(1, w - 1)
        for i in range(len(pts) - 1):
            p0, c0 = pts[i]; p1, c1 = pts[i + 1]
            if p0 <= t <= p1:
                tt = (t - p0) / max(1e-6, p1 - p0)
                px[x, 0] = _lerp(c0, c1, tt); break
        else:
            px[x, 0] = pts[-1][1]
    return grad.resize((w, h))

def v_gradient(size, c_top, c_bot):
    w, h = size
    base = Image.new("RGB", (1, h))
    px = base.load()
    a, b = _hex(c_top), _hex(c_bot)
    for y in range(h):
        px[0, y] = _lerp(a, b, y / max(1, h - 1))
    return base.resize((w, h))

# ---- Logo lockup: brand mark + gradient wordmark ----
@functools.lru_cache(maxsize=8)
def _mark(px: int) -> Image.Image:
    return Image.open(ASSETS / "mark.png").convert("RGBA").resize((px, px), Image.LANCZOS)

def wordmark(height: int, color=None) -> Image.Image:
    """'HEARTFOLIO' in Inter, letter-spaced, brand gradient (or solid)."""
    text = "HEARTFOLIO"
    fsize = int(height * 1.0)
    f = font(F_SANS, fsize)
    tracking = max(2, int(height * 0.16))
    tmp = Image.new("L", (10, 10))
    td = ImageDraw.Draw(tmp)
    widths = [td.textbbox((0, 0), ch, font=f)[2] for ch in text]
    total_w = sum(widths) + tracking * (len(text) - 1)
    asc, desc = f.getmetrics()
    H = asc + desc
    mask = Image.new("L", (total_w + 4, H), 0)
    md = ImageDraw.Draw(mask)
    x = 0
    for ch, w in zip(text, widths):
        md.text((x, 0), ch, font=f, fill=255)
        x += w + tracking
    if color:
        fill = Image.new("RGB", mask.size, _hex(color))
    else:
        fill = h_gradient(mask.size, WORD_G)
    out = Image.new("RGBA", mask.size, (0, 0, 0, 0))
    out.paste(fill, (0, 0), mask)
    return out

def logo_lockup(width: int, *, mono=None, url=False, locale="en") -> Image.Image:
    """Mark centred above the wordmark; optional theheartfolio.com line."""
    mark_px = int(width * 0.34)
    mk = _mark(mark_px)
    wm_h = int(width * 0.12)
    wm = wordmark(wm_h, color=mono)
    if wm.width > width:
        scale = width / wm.width
        wm = wm.resize((width, int(wm.height * scale)), Image.LANCZOS)
    gap1 = int(width * 0.03)
    url_h = int(width * 0.055) if url else 0
    gap2 = int(width * 0.02) if url else 0
    total_h = mk.height + gap1 + wm.height + gap2 + url_h
    canvas = Image.new("RGBA", (width, total_h), (0, 0, 0, 0))
    canvas.alpha_composite(mk, ((width - mk.width) // 2, 0))
    canvas.alpha_composite(wm, ((width - wm.width) // 2, mk.height + gap1))
    if url:
        d = ImageDraw.Draw(canvas)
        uf = font(F_SANS, int(url_h * 0.82))
        s = "theheartfolio.com"
        uw = line_w(d, s, uf)
        d.text(((width - uw) // 2, mk.height + gap1 + wm.height + gap2),
               s, font=uf, fill=_hex(mono or GOLD))
    return canvas

# ---- Canvas + decoration helpers ----
def canvas(w, h, bg=PARCH):
    return Image.new("RGB", (w, h), _hex(bg) if isinstance(bg, str) else bg)

def soft_shadow(size, radius, offset, alpha=90, color=(20, 27, 46)):
    w, h = size
    pad = radius * 3
    sh = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(sh)
    d.rectangle([pad, pad, pad + w, pad + h], fill=color + (alpha,))
    sh = sh.filter(ImageFilter.GaussianBlur(radius))
    return sh, pad

def paste_with_shadow(bg, im, xy, radius=28, offset=(0, 18), alpha=80):
    x, y = xy
    sh, pad = soft_shadow(im.size, radius, offset, alpha)
    bg.paste(sh, (x - pad + offset[0], y - pad + offset[1]), sh)
    if im.mode == "RGBA":
        bg.alpha_composite(im, (x, y)) if bg.mode == "RGBA" else bg.paste(im, (x, y), im)
    else:
        bg.paste(im, (x, y))

def rounded(im, radius):
    im = im.convert("RGBA")
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.size[0], im.size[1]], radius, fill=255)
    im.putalpha(mask)
    return im

def fit(im, box_w, box_h):
    """Scale to fit entirely within box (contain)."""
    w, h = im.size
    s = min(box_w / w, box_h / h)
    return im.resize((max(1, int(w * s)), max(1, int(h * s))), Image.LANCZOS)

def cover(im, box_w, box_h):
    w, h = im.size
    s = max(box_w / w, box_h / h)
    im2 = im.resize((int(w * s), int(h * s)), Image.LANCZOS)
    x = (im2.width - box_w) // 2; y = (im2.height - box_h) // 2
    return im2.crop((x, y, x + box_w, y + box_h))

# ---- Framed-print mockup on a simple wall ----
def framed_print(poster: Image.Image, *, target_h, frame="black", wall=None,
                 mat=True):
    """A framed print: mat + frame moulding, rendered flat (shadowed).
    Returns an RGBA image of just the framed piece (no wall)."""
    p = poster.convert("RGB")
    # scale poster to target_h
    scale = target_h / p.height
    p = p.resize((int(p.width * scale), target_h), Image.LANCZOS)
    mat_w = int(target_h * 0.045) if mat else 0
    frames = {
        "black":  ("#111317", int(target_h * 0.028)),
        "wood":   ("#6b4423", int(target_h * 0.042)),
        "oak":    ("#b08a5a", int(target_h * 0.040)),
        "gold":   ("#b89247", int(target_h * 0.030)),
    }
    fcol, fw = frames.get(frame, frames["black"])
    inner_w = p.width + mat_w * 2
    inner_h = p.height + mat_w * 2
    W = inner_w + fw * 2
    H = inner_h + fw * 2
    piece = Image.new("RGB", (W, H), _hex(fcol))
    # inner bevel highlight on frame
    ImageDraw.Draw(piece).rectangle([fw - 2, fw - 2, W - fw + 1, H - fw + 1],
                                    outline=(255, 255, 255, 30), width=2)
    mat_im = Image.new("RGB", (inner_w, inner_h), _hex(CANDLE))
    piece.paste(mat_im, (fw, fw))
    piece.paste(p, (fw + mat_w, fw + mat_w))
    # subtle inner shadow where print meets mat
    d = ImageDraw.Draw(piece)
    d.rectangle([fw + mat_w - 1, fw + mat_w - 1, fw + mat_w + p.width, fw + mat_w + p.height],
                outline=(0, 0, 0, 60), width=1)
    return piece.convert("RGBA")

def wall_bg(w, h, top="#efe7d7", bottom="#e4d8c3"):
    return v_gradient((w, h), top, bottom).convert("RGB")

# ---- Phone mockup for live-page stills ----
def phone_mockup(screen: Image.Image, *, screen_h, body="#1a1f2e"):
    """A clean phone body (built in code) wrapping a 9:19.5 screen."""
    sw = int(screen_h * 0.462)  # ~ 9:19.5
    scr = cover(screen.convert("RGB"), sw, screen_h)
    bezel = int(screen_h * 0.018)
    radius = int(screen_h * 0.085)
    W = sw + bezel * 2
    H = screen_h + bezel * 2
    phone = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(phone).rounded_rectangle([0, 0, W, H], radius, fill=_hex(body))
    scr = rounded(scr, int(radius * 0.72))
    phone.alpha_composite(scr, (bezel, bezel))
    # camera notch dot
    ImageDraw.Draw(phone).ellipse(
        [W // 2 - bezel // 2, int(bezel * 1.1), W // 2 + bezel // 2, int(bezel * 1.1) + bezel],
        fill=(40, 46, 60, 255))
    return phone

# ---- Loaders for the real material ----
PRINTS = Path("/tmp/claude-0/-home-user-heartfolio-complet/aa860963-8a73-526d-8cf4-3cd205d0543e/scratchpad/work/renders")

def load_print(product_key, variant, locale):
    pre = "lst" if product_key == "love-story-timeline" else "song"
    return Image.open(PRINTS / f"{pre}_{variant}_{locale}.png").convert("RGB")

def load_capture(locale, name):
    return Image.open(CAPTURES / locale / name).convert("RGB")
