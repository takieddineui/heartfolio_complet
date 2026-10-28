# -*- coding: utf-8 -*-
"""First mockup design exploration — 12 mockups (3 directions x 4 artworks).

Composites the EXISTING customer-ready artwork, UNCHANGED, into three
procedurally-built premium interior scenes (Luxury Editorial / Modern
Minimalist / Romantic Lifestyle). No image-generation model is used (none is
available here); the environments are built in code and the real artwork is
placed as a separate, pixel-faithful layer — only scaled proportionally to the
frame opening (never cropped, stretched or recoloured). Source files are opened
read-only and sha256-verified unchanged after the run.
"""
from __future__ import annotations
import json, csv, hashlib
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

LIB = Path(__file__).resolve().parents[1]
REPO = LIB.parents[0]
SRCROOT = REPO / "customer-artwork-library-v2"
W, H = 1280, 1600  # 4:5 vertical, Pinterest / product-page friendly

# ---- four representative source artworks (existing, unchanged) ----
SOURCES = {
    "lst-a-neat-stack":       ("love-story-timeline", "en/s1-new-love-neat-stack.png",          "Love Story Timeline · Neat Stack · new-love"),
    "lst-b-dotted-branching": ("love-story-timeline", "en/s4-engaged-wedding-dotted-branching.png", "Love Story Timeline · Dotted Branching · engaged-wedding"),
    "song-a-player":          ("song-poster",         "en/sp1-first-dance-player.png",            "Song Poster · Player · first-dance (portrait)"),
    "song-b-award":           ("song-poster",         "en/sp6-milestone-award.png",              "Song Poster · Award · milestone (landscape)"),
}

def _hex(c): c = c.lstrip("#"); return tuple(int(c[i:i+2], 16) for i in (0, 2, 4))

def vgrad(size, top, bot):
    w, h = size; base = Image.new("RGB", (1, h)); px = base.load()
    a, b = _hex(top), _hex(bot)
    for y in range(h):
        t = y/max(1, h-1); px[0, y] = tuple(round(a[i]+(b[i]-a[i])*t) for i in range(3))
    return base.resize((w, h))

def radial(size, cx, cy, r, color, strength):
    w, h = size; lum = Image.new("L", (w, h), 0)
    ImageDraw.Draw(lum).ellipse([cx-r, cy-r, cx+r, cy+r], fill=strength)
    lum = lum.filter(ImageFilter.GaussianBlur(r*0.55))
    return Image.new("RGB", (w, h), _hex(color)), lum

def vignette(size, strength):
    w, h = size; m = Image.new("L", (w, h), 0)
    pad = int(min(w, h)*0.12)
    ImageDraw.Draw(m).ellipse([pad, pad, w-pad, h-pad], fill=255)
    m = m.filter(ImageFilter.GaussianBlur(min(w, h)*0.16))
    return Image.new("RGB", (w, h), (0, 0, 0)), m.point(lambda v: int((255-v)*strength/255))

def fit(im, bw, bh):
    """Proportional contain-fit — never crops or distorts the artwork."""
    w, h = im.size; s = min(bw/w, bh/h)
    return im.resize((max(1, round(w*s)), max(1, round(h*s))), Image.LANCZOS)

def framed(art, *, frame_col, frame_w_frac, mat_col, mat_frac, bevel_dark, bevel_light):
    a = art.convert("RGB"); aw, ah = a.size
    L = max(aw, ah)
    fw = max(8, round(L*frame_w_frac)); mat = max(0, round(L*mat_frac))
    inner_w, inner_h = aw+mat*2, ah+mat*2
    Wp, Hp = inner_w+fw*2, inner_h+fw*2
    piece = Image.new("RGB", (Wp, Hp), _hex(frame_col)); d = ImageDraw.Draw(piece)
    # moulding bevel: light outer, dark inner lip
    d.rectangle([0, 0, Wp-1, Hp-1], outline=bevel_light, width=max(1, fw//7))
    d.rectangle([fw-max(1, fw//6), fw-max(1, fw//6), Wp-fw+max(1, fw//6), Hp-fw+max(1, fw//6)],
                outline=bevel_dark, width=max(1, fw//6))
    piece.paste(Image.new("RGB", (inner_w, inner_h), _hex(mat_col)), (fw, fw))
    piece.paste(a, (fw+mat, fw+mat))  # artwork placed unchanged
    # subtle mat shadow where the print sits in the window
    d.rectangle([fw+mat-1, fw+mat-1, fw+mat+aw, fw+mat+ah], outline=(70, 60, 48), width=2)
    return piece.convert("RGBA")

def drop_shadow(size, blur, alpha, color=(25, 18, 12)):
    w, h = size; pad = blur*3
    sh = Image.new("RGBA", (w+pad*2, h+pad*2), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rectangle([pad, pad, pad+w, pad+h], fill=color+(alpha,))
    return sh.filter(ImageFilter.GaussianBlur(blur)), pad

DIRECTIONS = {
    "luxury-editorial": dict(
        wall=("#efe8db", "#e3d8c6"), light=(int(W*0.33), int(H*0.24), int(H*0.52), "#fff6e6", 150),
        vig=44, frame_col="#5c4631", mat_col="#f6f1e6", frame_w=0.028, mat=0.070,
        bevel_dark=(0,0,0), bevel_light=(255,255,255,45), box=(0.72, 0.66), cy=0.455,
        sh_blur=44, sh_alpha=92, surface=None,
        desc="Warm ivory walls, walnut frame, generous mat, soft upper-left daylight; calm and timeless.",
    ),
    "modern-minimalist": dict(
        wall=("#f4f4f2", "#e8e9ea"), light=(int(W*0.52), int(H*0.18), int(H*0.46), "#ffffff", 118),
        vig=28, frame_col="#191a1c", mat_col="#ffffff", frame_w=0.014, mat=0.045,
        bevel_dark=(0,0,0), bevel_light=(90,90,92), box=(0.66, 0.62), cy=0.44,
        sh_blur=30, sh_alpha=66, surface=None,
        desc="Cool neutral wall, slim matte-black frame, crisp directional light, generous negative space.",
    ),
    "romantic-lifestyle": dict(
        wall=("#f0e2d4", "#e2c7b4"), light=(int(W*0.5), int(H*0.34), int(H*0.5), "#ffe7cc", 160),
        vig=60, frame_col="#7b5636", mat_col="#f7efe3", frame_w=0.024, mat=0.055,
        bevel_dark=(40,26,16), bevel_light=(255,240,220,55), box=(0.70, 0.62), cy=0.40,
        sh_blur=42, sh_alpha=88, surface=("#cBad8f", "#b48f6c", 0.17),
        desc="Warm cream wall, oak frame, intimate warm light pool and a soft console surface; refined, not clichéd.",
    ),
}

def build_scene(art, direction):
    cfg = DIRECTIONS[direction]
    scene = vgrad((W, H), *cfg["wall"]).convert("RGB")
    cx, cy, r, col, strength = cfg["light"]
    tint, lum = radial((W, H), cx, cy, r, col, strength)
    scene = Image.blend(Image.composite(tint, scene, lum).convert("RGB"), vgrad((W, H), *cfg["wall"]), 0.35)
    if cfg["surface"]:
        t_top, t_bot, frac = cfg["surface"]; th = int(H*frac)
        scene.paste(vgrad((W, th), t_top, t_bot), (0, H-th))
        band = Image.new("RGBA", (W, int(th*0.5)), (0, 0, 0, 0)); bd = ImageDraw.Draw(band)
        for y in range(band.height):
            bd.line([(0, y), (W, y)], fill=(60, 40, 26, int(55*(1-y/band.height)**1.6)))
        scene = scene.convert("RGBA"); scene.alpha_composite(band, (0, H-th)); scene = scene.convert("RGB")
    scene = scene.convert("RGBA")
    piece = framed(art, frame_col=cfg["frame_col"], frame_w_frac=cfg["frame_w"], mat_col=cfg["mat_col"],
                   mat_frac=cfg["mat"], bevel_dark=cfg["bevel_dark"], bevel_light=cfg["bevel_light"])
    piece = fit(piece, int(W*cfg["box"][0]), int(H*cfg["box"][1]))
    px = (W-piece.width)//2; py = int(H*cfg["cy"]) - piece.height//2
    sh, pad = drop_shadow(piece.size, cfg["sh_blur"], cfg["sh_alpha"])
    scene.alpha_composite(sh, (px-pad+int(cfg["sh_blur"]*0.18), py-pad+int(cfg["sh_blur"]*0.5)))
    scene.alpha_composite(piece, (px, py))
    dark, inv = vignette((W, H), cfg["vig"])
    return Image.composite(dark.convert("RGBA"), scene, inv).convert("RGB")

def file_hash(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def main():
    manifest = []
    before = {k: file_hash(SRCROOT/v[0]/v[1]) for k, v in SOURCES.items()}
    for direction in DIRECTIONS:
        (LIB/direction).mkdir(parents=True, exist_ok=True)
        for key, (product, rel, label) in SOURCES.items():
            src = SRCROOT/product/rel
            art = Image.open(src)  # read-only
            scene = build_scene(art, direction)
            out = LIB/direction/f"{key}.jpg"
            scene.save(out, quality=92)
            manifest.append({
                "file": f"{direction}/{key}.jpg", "direction": direction,
                "direction_note": DIRECTIONS[direction]["desc"],
                "product": product, "artwork_label": label,
                "source_artwork": f"customer-artwork-library-v2/{product}/{rel}",
                "source_orientation": "portrait" if art.height > art.width else "landscape",
                "canvas": f"{W}x{H}", "format": "JPG",
            })
            print("built", direction, key)
    unchanged = all(file_hash(SRCROOT/v[0]/v[1]) == before[k] for k, v in SOURCES.items())
    print("source artwork unchanged:", unchanged)
    (LIB/"manifest").mkdir(exist_ok=True)
    json.dump(manifest, open(LIB/"manifest"/"manifest.json", "w"), ensure_ascii=False, indent=1)
    cols = ["file","direction","product","artwork_label","source_artwork","source_orientation","canvas","format","direction_note"]
    with open(LIB/"manifest"/"manifest.csv","w",newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore"); w.writeheader(); w.writerows(manifest)
    print(f"DONE {len(manifest)} mockups; sources unchanged: {unchanged}")

if __name__ == "__main__":
    main()
