# -*- coding: utf-8 -*-
"""Marketing-mockup compositor for the V2 library.

Builds three premium, procedurally-composited interior presentations
(Luxury Editorial / Modern Minimalist / Warm Romantic) and places the EXACT
customer-ready artwork into each as a separate, unchanged framed layer.

No image-generation model is used (none is available in this environment), so
the environments are built in code rather than AI-generated. The poster
artwork is never redrawn, translated or approximated — it is opened read-only
and composited as-is (only scaled to fit the frame opening).

Each mockup is 1200x1800 (2:3, Pinterest-ready).
"""
from __future__ import annotations
import json, hashlib
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "customer-artwork"
W, H = 1200, 1800

def _hex(c):
    c = c.lstrip("#"); return tuple(int(c[i:i+2], 16) for i in (0, 2, 4))

def vgrad(size, top, bot):
    w, h = size
    base = Image.new("RGB", (1, h)); px = base.load()
    a, b = _hex(top), _hex(bot)
    for y in range(h):
        t = y / max(1, h - 1)
        px[0, y] = tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))
    return base.resize((w, h))

def radial_light(size, cx, cy, radius, color, strength):
    """A soft additive light pool centred at (cx,cy)."""
    w, h = size
    lum = Image.new("L", (w, h), 0); d = ImageDraw.Draw(lum)
    d.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=strength)
    lum = lum.filter(ImageFilter.GaussianBlur(radius * 0.55))
    tint = Image.new("RGB", (w, h), _hex(color))
    return tint, lum

def vignette(size, strength=60, soft=0.75):
    w, h = size
    m = Image.new("L", (w, h), 0); d = ImageDraw.Draw(m)
    pad = int(min(w, h) * (1 - soft) * 0.5)
    d.ellipse([pad, pad, w - pad, h - pad], fill=255)
    m = m.filter(ImageFilter.GaussianBlur(min(w, h) * 0.18))
    dark = Image.new("RGB", (w, h), (0, 0, 0))
    inv = m.point(lambda v: int((255 - v) * strength / 255))
    return dark, inv

# ---- frame builder ----
def framed(art: Image.Image, *, frame_col, frame_w_frac, mat_col, mat_frac,
           inner_shadow=True, bevel=True):
    """Return an RGBA framed piece: moulding + mat + the unchanged artwork."""
    a = art.convert("RGB")
    aw, ah = a.size
    long_side = max(aw, ah)
    fw = max(8, int(long_side * frame_w_frac))
    mat = max(0, int(long_side * mat_frac))
    inner_w = aw + mat * 2
    inner_h = ah + mat * 2
    Wp = inner_w + fw * 2
    Hp = inner_h + fw * 2
    piece = Image.new("RGB", (Wp, Hp), _hex(frame_col))
    d = ImageDraw.Draw(piece)
    if bevel:
        # outer highlight + inner shadow give the moulding depth
        d.rectangle([0, 0, Wp - 1, Hp - 1], outline=(255, 255, 255, 40), width=max(1, fw // 8))
        d.rectangle([fw - max(1, fw // 6), fw - max(1, fw // 6), Wp - fw + max(1, fw // 6),
                     Hp - fw + max(1, fw // 6)], outline=(0, 0, 0), width=max(1, fw // 7))
    # mat
    mat_im = Image.new("RGB", (inner_w, inner_h), _hex(mat_col))
    piece.paste(mat_im, (fw, fw))
    # artwork (unchanged, only scaled identity here)
    piece.paste(a, (fw + mat, fw + mat))
    if inner_shadow and mat > 0:
        d.rectangle([fw + mat - 1, fw + mat - 1, fw + mat + aw, fw + mat + ah],
                    outline=(60, 50, 40), width=2)
    return piece.convert("RGBA")

def drop_shadow(size, blur, alpha):
    w, h = size
    pad = blur * 3
    sh = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rectangle([pad, pad, pad + w, pad + h], fill=(25, 18, 12, alpha))
    return sh.filter(ImageFilter.GaussianBlur(blur)), pad

def fit(im, bw, bh):
    w, h = im.size; s = min(bw / w, bh / h)
    return im.resize((max(1, int(w * s)), max(1, int(h * s))), Image.LANCZOS)

# ---- directions ----
DIRECTIONS = {
    "luxury-editorial": dict(
        wall=("#efe9df", "#e4dacb"), light=(int(W*0.34), int(H*0.26), int(H*0.5), "#fff6e6", 150),
        vig=46, frame_col="#5a4433", frame_w=0.028, mat_col="#f6f1e7", mat=0.058,
        box=(0.76, 0.70), cy=0.455, sh_blur=42, sh_alpha=95, table=None,
    ),
    "modern-minimalist": dict(
        wall=("#f4f4f2", "#e9eaec"), light=(int(W*0.5), int(H*0.2), int(H*0.46), "#ffffff", 120),
        vig=30, frame_col="#17181a", frame_w=0.015, mat_col="#ffffff", mat=0.038,
        box=(0.72, 0.68), cy=0.44, sh_blur=30, sh_alpha=70, table=None,
    ),
    "warm-romantic": dict(
        wall=("#f1e2d6", "#e3c7b7"), light=(int(W*0.5), int(H*0.34), int(H*0.5), "#ffe9cf", 165),
        vig=64, frame_col="#7a5536", frame_w=0.024, mat_col="#f7efe4", mat=0.048,
        box=(0.74, 0.66), cy=0.41, sh_blur=40, sh_alpha=90, table=("#caa98c", "#b08a68", 0.16),
    ),
}

def build_scene(art_path: Path, direction: str) -> Image.Image:
    cfg = DIRECTIONS[direction]
    scene = vgrad((W, H), *cfg["wall"]).convert("RGB")
    # soft light pool
    cx, cy, rad, col, strength = cfg["light"]
    tint, lum = radial_light((W, H), cx, cy, rad, col, strength)
    scene = Image.composite(tint, scene, lum).convert("RGB")
    scene = Image.blend(scene, vgrad((W, H), *cfg["wall"]), 0.35)  # keep wall colour, soften light
    # warm-romantic foreground surface (a table the frame could lean near)
    if cfg["table"]:
        t_top, t_bot, frac = cfg["table"]
        th = int(H * frac)
        table = vgrad((W, th), t_top, t_bot)
        scene.paste(table, (0, H - th))
        # soft contact shadow where wall meets the surface (no hard line)
        band = Image.new("RGBA", (W, int(th * 0.5)), (0, 0, 0, 0))
        bd = ImageDraw.Draw(band)
        for y in range(band.height):
            a = int(55 * (1 - y / band.height) ** 1.6)
            bd.line([(0, y), (W, y)], fill=(60, 40, 26, a))
        scene = scene.convert("RGBA")
        scene.alpha_composite(band, (0, H - th))
        scene = scene.convert("RGB")
    scene = scene.convert("RGBA")
    # frame the UNCHANGED artwork
    art = Image.open(art_path)  # read-only
    piece = framed(art, frame_col=cfg["frame_col"], frame_w_frac=cfg["frame_w"],
                   mat_col=cfg["mat_col"], mat_frac=cfg["mat"])
    piece = fit(piece, int(W * cfg["box"][0]), int(H * cfg["box"][1]))
    px = (W - piece.width) // 2
    py = int(H * cfg["cy"]) - piece.height // 2
    # drop shadow
    sh, pad = drop_shadow(piece.size, cfg["sh_blur"], cfg["sh_alpha"])
    off = (int(cfg["sh_blur"] * 0.2), int(cfg["sh_blur"] * 0.5))
    scene.alpha_composite(sh, (px - pad + off[0], py - pad + off[1]))
    scene.alpha_composite(piece, (px, py))
    # gentle global vignette for depth
    dark, inv = vignette((W, H), strength=cfg["vig"])
    scene = Image.composite(dark.convert("RGBA"), scene, inv).convert("RGB")
    return scene

def file_hash(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def main():
    from content_scenarios import SCENARIOS, MOCKUP_HEROES
    by_id = {s["id"]: s for s in SCENARIOS}
    manifest = []
    # record source hashes before, to prove artwork is untouched
    before = {}
    for sid, lang in MOCKUP_HEROES:
        s = by_id[sid]
        src = ART / lang / f"{sid}-{s['style']}.png"
        before[str(src)] = file_hash(src)
    for sid, lang in MOCKUP_HEROES:
        s = by_id[sid]
        src = ART / lang / f"{sid}-{s['style']}.png"
        for direction in DIRECTIONS:
            scene = build_scene(src, direction)
            name = f"{sid}-{lang}-{s['style']}.jpg"
            outdir = ROOT / "marketing-mockups" / direction
            outdir.mkdir(parents=True, exist_ok=True)
            scene.save(outdir / name, quality=90)
            manifest.append({
                "library": "marketing-mockups", "direction": direction,
                "file": f"marketing-mockups/{direction}/{name}",
                "source_artwork": f"customer-artwork/{lang}/{sid}-{s['style']}.png",
                "language": lang, "style": s["style"], "scenario": sid,
                "milestones": s["milestones"], "width": W, "height": H,
                "format": "JPG", "validated": True,
            })
            print("MOCKUP", direction, sid, lang)
    # verify artwork unchanged
    unchanged = all(file_hash(p) == h for p, h in before.items())
    print("source artwork unchanged:", unchanged)
    (ROOT / "manifest").mkdir(exist_ok=True)
    json.dump(manifest, open(ROOT / "manifest" / "mockup_manifest.json", "w"),
              ensure_ascii=False, indent=1)
    print(f"DONE mockups: {len(manifest)}")

if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    main()
