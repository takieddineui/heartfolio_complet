# -*- coding: utf-8 -*-
"""Cinematic lifestyle mockups — SHARP / in-focus pipeline (one hero per
direction).

Everything is rendered crisp (no depth-of-field blur): wall treatment,
console/shelf, trim and decor are clean geometric forms with proper shading,
so they read well at full sharpness. Grounding is done with real shadows:
a directional wall cast shadow behind the outer frame, a tight contact line at
the frame edge, soft contact shadows under objects, and a subtle diagonal
glass reflection across the glazing.

The real artwork is composited UNCHANGED (proportional scale only; opened
read-only; sha256-verified unchanged each run). Scenes are built in code
(Pillow) — no image-generation / 3D engine is available in this environment.
"""
from __future__ import annotations
import json, hashlib, random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageChops

LIB = Path(__file__).resolve().parents[1]
SRCROOT = LIB.parents[0] / "customer-artwork-library-v2"
W, H = 2560, 3200           # sharp, high-resolution 4:5
random.seed(7)

def _hex(c): c = c.lstrip("#"); return tuple(int(c[i:i+2], 16) for i in (0, 2, 4))
def _mix(a, b, t): return tuple(round(a[i]+(b[i]-a[i])*t) for i in range(3))

def vgrad(size, top, bot):
    w, h = size; base = Image.new("RGB", (1, h)); px = base.load()
    a, b = _hex(top), _hex(bot)
    for y in range(h): px[0, y] = _mix(a, b, y/max(1, h-1))
    return base.resize((w, h))

def radial(size, cx, cy, r, color, strength):
    w, h = size; lum = Image.new("L", (w, h), 0)
    ImageDraw.Draw(lum).ellipse([cx-r, cy-r, cx+r, cy+r], fill=strength)
    return lum.filter(ImageFilter.GaussianBlur(r*0.5))

def apply_light(scene, cx, cy, r, color, strength, blend=0.5):
    lum = radial(scene.size, cx, cy, r, color, strength)
    return Image.composite(Image.blend(scene, Image.new("RGB", scene.size, _hex(color)), blend), scene, lum)

def vignette(scene, strength, soft=0.80):
    w, h = scene.size; m = Image.new("L", (w, h), 0)
    pad = int(min(w, h)*(1-soft)*0.5)
    ImageDraw.Draw(m).ellipse([pad, pad, w-pad, h-pad], fill=255)
    m = m.filter(ImageFilter.GaussianBlur(min(w, h)*0.14))
    inv = m.point(lambda v: int((255-v)*strength/255))
    return Image.composite(Image.new("RGB", (w, h), (0, 0, 0)), scene, inv)

def plaster(scene, sigma, opacity):
    n = Image.effect_noise(scene.size, sigma).convert("L").filter(ImageFilter.GaussianBlur(1.0))
    sc = scene.convert("RGB")
    return Image.blend(sc, ImageChops.overlay(sc, Image.merge("RGB", (n, n, n))), opacity)

def fit(im, bw, bh):
    w, h = im.size; s = min(bw/w, bh/h)
    return im.resize((max(1, round(w*s)), max(1, round(h*s))), Image.LANCZOS)

# ---------- clean shaded primitives (look good sharp) ----------
def shaded_slab(w, h, col, *, lit="top"):
    """A horizontal surface (console/shelf): body gradient + a lit front edge."""
    base = _hex(col)
    slab = vgrad((w, h), "#%02x%02x%02x" % _mix(base, (255,255,255), 0.12),
                 "#%02x%02x%02x" % _mix(base, (0,0,0), 0.28)).convert("RGBA")
    d = ImageDraw.Draw(slab, "RGBA")
    d.line([(0, 1), (w, 1)], fill=(255, 250, 240, 150), width=max(2, h//24))   # lit top edge
    d.line([(0, h-2), (w, h-2)], fill=(0, 0, 0, 60), width=max(2, h//30))
    return slab

def taper(w_top, w_bot, h, col):
    """A simple vessel/candlestick: clean tapered form with side shading."""
    base = _hex(col); im = Image.new("RGBA", (max(w_top, w_bot), h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im); cx = im.width/2
    pts = [(cx-w_top/2, 0), (cx+w_top/2, 0), (cx+w_bot/2, h), (cx-w_bot/2, h)]
    d.polygon(pts, fill=base+(255,))
    # side shading: light left, dark right
    sh = Image.new("RGBA", im.size, (0, 0, 0, 0)); sd = ImageDraw.Draw(sh)
    sd.polygon([(cx, 0), (cx+w_top/2, 0), (cx+w_bot/2, h), (cx, h)], fill=(0, 0, 0, 70))
    sd.polygon([(cx-w_top/2, 0), (cx-w_top/2+6, 0), (cx-w_bot/2+6, h), (cx-w_bot/2, h)], fill=(255, 250, 240, 90))
    im.alpha_composite(sh)
    return im

def contact_shadow(scene, cx, base_y, width, *, blur, alpha):
    w, h = scene.size; s = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(s).ellipse([cx-width//2, base_y-blur//2, cx+width//2, base_y+blur//2], fill=(0, 0, 0, alpha))
    scene.alpha_composite(s.filter(ImageFilter.GaussianBlur(blur*0.5)))

# ---------- frame: inner-mat shadow + diagonal glass reflection ----------
def framed(art, *, frame_col, frame_w_frac, mat_col, mat_frac, bevel_light, bevel_dark=(0,0,0)):
    a = art.convert("RGB"); aw, ah = a.size; L = max(aw, ah)
    fw = max(14, round(L*frame_w_frac)); mat = max(0, round(L*mat_frac))
    inner_w, inner_h = aw+mat*2, ah+mat*2
    Wp, Hp = inner_w+fw*2, inner_h+fw*2
    piece = Image.new("RGB", (Wp, Hp), _hex(frame_col))
    # subtle moulding sheen (top-left lighter)
    sheen = vgrad((Wp, Hp), "#%02x%02x%02x" % _mix(_hex(frame_col), (255,255,255), 0.14), frame_col)
    piece = Image.blend(piece, sheen, 0.5)
    d = ImageDraw.Draw(piece, "RGBA")
    d.rectangle([0, 0, Wp-1, Hp-1], outline=bevel_light, width=max(3, fw//6))
    d.rectangle([fw-fw//5, fw-fw//5, Wp-fw+fw//5, Hp-fw+fw//5], outline=bevel_dark, width=max(3, fw//6))
    piece.paste(Image.new("RGB", (inner_w, inner_h), _hex(mat_col)), (fw, fw))
    ax, ay = fw+mat, fw+mat
    piece.paste(a, (ax, ay))
    piece = piece.convert("RGBA")
    # inner-mat shadow onto the print (top + left)
    if mat > 0:
        sh = Image.new("RGBA", (aw, ah), (0, 0, 0, 0)); sd = ImageDraw.Draw(sh)
        band = max(8, round(L*0.014))
        for i in range(band):
            al = int(100*(1-i/band)); sd.line([(0, i), (aw, i)], fill=(18, 14, 10, al))
            sd.line([(i, 0), (i, ah)], fill=(18, 14, 10, int(al*0.9)))
        piece.alpha_composite(sh.filter(ImageFilter.GaussianBlur(band*0.35)), (ax, ay))
    # diagonal glass reflection across the glazing
    gx0, gy0, gx1, gy1 = fw, fw, Wp-fw, Hp-fw
    glare = Image.new("L", (Wp, Hp), 0); gd = ImageDraw.Draw(glare)
    gd.polygon([(gx0, gy0), (gx0+inner_w*0.46, gy0), (gx0+inner_w*0.12, gy1), (gx0, gy1)], fill=42)
    gd.polygon([(gx0+inner_w*0.56, gy0), (gx0+inner_w*0.66, gy0), (gx0+inner_w*0.30, gy1), (gx0+inner_w*0.20, gy1)], fill=22)
    glare = glare.filter(ImageFilter.GaussianBlur(fw*1.0))
    clip = Image.new("L", (Wp, Hp), 0); ImageDraw.Draw(clip).rectangle([gx0, gy0, gx1, gy1], fill=255)
    glare = ImageChops.multiply(glare, clip)
    white = Image.new("RGBA", (Wp, Hp), (255, 255, 255, 0)); white.putalpha(glare)
    piece.alpha_composite(white)
    return piece

def frame_wall_shadow(scene, piece, px, py, *, soft, dark, off):
    """Directional wall cast shadow + tight contact line at the frame edge."""
    w, h = piece.size
    pad = soft*3
    dp = Image.new("RGBA", (w+pad*2, h+pad*2), (0, 0, 0, 0))
    ImageDraw.Draw(dp).rectangle([pad, pad, pad+w, pad+h], fill=(14, 10, 7, dark))
    scene.alpha_composite(dp.filter(ImageFilter.GaussianBlur(soft)), (px-pad+off[0], py-pad+off[1]))
    # tight contact occlusion hugging the frame
    pad2 = max(6, soft//3)
    cl = Image.new("RGBA", (w+pad2*2, h+pad2*2), (0, 0, 0, 0))
    ImageDraw.Draw(cl).rectangle([pad2, pad2, pad2+w, pad2+h], fill=(0, 0, 0, min(255, dark+60)))
    scene.alpha_composite(cl.filter(ImageFilter.GaussianBlur(pad2*0.7)), (px-pad2+off[0]//3, py-pad2+off[1]//3))

# ---------------- scenes (all sharp) ----------------
def wood_panels(scene, n=4):
    w, h = scene.size; d = ImageDraw.Draw(scene, "RGBA")
    margin = int(w*0.05); gap = int(w*0.028)
    pw = (w-margin*2-gap*(n-1))/n; top, bot = int(h*0.04), int(h*0.74)
    for i in range(n):
        x0 = int(margin+i*(pw+gap)); x1 = int(x0+pw)
        d.rectangle([x0, top, x1, bot], fill=(0, 0, 0, 30))
        ins = int(pw*0.09)
        d.line([(x0+ins, top+ins), (x1-ins, top+ins)], fill=(12, 8, 5, 150), width=7)
        d.line([(x0+ins, top+ins), (x0+ins, bot-ins)], fill=(12, 8, 5, 130), width=7)
        d.line([(x1-ins, top+ins), (x1-ins, bot-ins)], fill=(255, 238, 214, 55), width=5)
        d.line([(x0+ins, bot-ins), (x1-ins, bot-ins)], fill=(255, 238, 214, 55), width=5)
    grain = Image.effect_noise((w, h), 20).convert("L").resize((w//4, h)).resize((w, h)).filter(ImageFilter.GaussianBlur(0.7))
    sc = Image.blend(scene.convert("RGB"), ImageChops.overlay(scene.convert("RGB"), Image.merge("RGB", (grain, grain, grain))), 0.05)
    scene.paste(sc, (0, 0))

def scene_luxury():
    scene = vgrad((W, H), "#443a2d", "#281f17").convert("RGBA")
    wood_panels(scene, 4)
    scene = apply_light(scene.convert("RGB"), int(W*0.30), int(H*0.26), int(H*0.55), "#f4e2bd", 150, 0.5).convert("RGBA")
    deco = {"console_y": int(H*0.80), "console_col": "#e9e6e0", "veined": True,
            "candles": True}
    return scene, deco, dict(frame_col="#4a3524", frame_w=0.030, mat_col="#f4efe3", mat=0.070,
                             bevel_light=(226,198,142,70), box=(0.74, 0.66), cy=0.405,
                             soft=46, dark=118, off=(30,40), vig=70)

def scene_romantic():
    scene = vgrad((W, H), "#efe0cf", "#e4cBb5").convert("RGB")
    # soft window light (brightness only — light is naturally soft, stays tasteful)
    streak = Image.new("L", (W, H), 0); sd = ImageDraw.Draw(streak)
    for i in range(5): x = int(W*0.60+i*W*0.065); sd.rectangle([x, 0, x+int(W*0.03), H], fill=55)
    streak = streak.filter(ImageFilter.GaussianBlur(55))
    scene = Image.composite(Image.new("RGB", (W, H), _hex("#fff3dd")), scene, streak)
    scene = apply_light(scene, int(W*0.66), int(H*0.30), int(H*0.6), "#ffe9cf", 150, 0.5).convert("RGBA")
    deco = {"console_y": int(H*0.82), "console_col": "#caa471", "veined": False, "vase": True, "throw": True}
    return scene, deco, dict(frame_col="#b1894f", frame_w=0.024, mat_col="#f7efe2", mat=0.056,
                             bevel_light=(255,240,220,70), box=(0.74, 0.66), cy=0.405,
                             soft=40, dark=92, off=(22,30), vig=48)

def scene_minimalist():
    scene = vgrad((W, H), "#f3f2ef", "#e8e7e3").convert("RGB")
    scene = plaster(scene, 8, 0.05)
    scene = apply_light(scene, int(W*0.34), int(H*0.18), int(H*0.5), "#ffffff", 110, 0.45).convert("RGBA")
    deco = {"shelf_y": int(H*0.72), "shelf_col": "#d6bb90", "object": True}
    return scene, deco, dict(frame_col="#17181a", frame_w=0.015, mat_col="#ffffff", mat=0.044,
                             bevel_light=(96,96,98,90), box=(0.68, 0.62), cy=0.40,
                             soft=22, dark=78, off=(16,22), vig=24)

def draw_luxury_deco(scene, deco):
    cy = deco["console_y"]
    slab = shaded_slab(W, H-cy, deco["console_col"])
    if deco["veined"]:
        # smooth stone mottle (soft, cloud-like) — no sharp scratch lines
        mottle = Image.effect_noise((slab.width, slab.height), 26).convert("L")
        mottle = mottle.resize((slab.width//8, slab.height//8)).resize((slab.width, slab.height)).filter(ImageFilter.GaussianBlur(6))
        tint = Image.merge("RGBA", (mottle, mottle, mottle, mottle.point(lambda v: 26)))
        slab.alpha_composite(tint)
    # soft occlusion where console meets wall
    occ = Image.new("RGBA", (W, 60), (0,0,0,0)); ImageDraw.Draw(occ).rectangle([0,0,W,60], fill=(0,0,0,70))
    scene.alpha_composite(occ.filter(ImageFilter.GaussianBlur(26)), (0, cy-30))
    scene.alpha_composite(slab, (0, cy))
    if deco.get("candles"):
        for bx, hh in [(int(W*0.80), 240), (int(W*0.86), 180)]:
            contact_shadow(scene, bx+18, cy+10, 110, blur=40, alpha=90)
            stand = taper(22, 44, hh, "#b78a3f"); scene.alpha_composite(stand, (bx, cy-hh))
            d = ImageDraw.Draw(scene, "RGBA")
            d.ellipse([bx-4, cy-hh-14, bx+40, cy-hh+8], fill=(206,166,96,255))
            d.rectangle([bx+13, cy-hh-80, bx+23, cy-hh], fill=(244,237,223,255))        # candle
            glow = Image.new("RGBA",(W,H),(0,0,0,0)); ImageDraw.Draw(glow).ellipse([bx-2,cy-hh-120,bx+38,cy-hh-70],fill=(255,208,128,130))
            scene.alpha_composite(glow.filter(ImageFilter.GaussianBlur(20)))

def draw_romantic_deco(scene, deco):
    cy = deco["console_y"]
    occ = Image.new("RGBA", (W, 60), (0,0,0,0)); ImageDraw.Draw(occ).rectangle([0,0,W,60], fill=(0,0,0,55))
    scene.alpha_composite(occ.filter(ImageFilter.GaussianBlur(24)), (0, cy-28))
    scene.alpha_composite(shaded_slab(W, H-cy, deco["console_col"]), (0, cy))
    # folded throw (left): clean folded block with fold lines + shading
    tw, th = int(W*0.26), int(H*0.075)
    throw = vgrad((tw, th), "#efe0c9", "#cfb897").convert("RGBA"); td = ImageDraw.Draw(throw, "RGBA")
    for i in range(0, tw, 42): td.line([(i,0),(i-10,th)], fill=(210,194,166,150), width=10)
    td.line([(0,2),(tw,2)], fill=(255,248,232,150), width=6)
    contact_shadow(scene, int(W*0.16), cy+8, tw, blur=36, alpha=70)
    scene.alpha_composite(throw, (int(W*0.03), cy-th+8))
    # bud vase + two stems (right), clean and simple
    vx = int(W*0.84)
    contact_shadow(scene, vx+30, cy+8, 150, blur=34, alpha=80)
    vase = taper(70, 54, 150, "#eceae4"); scene.alpha_composite(vase, (vx, cy-150))
    d = ImageDraw.Draw(scene, "RGBA")
    for dx, dh in [(26, 250), (40, 210)]:
        d.line([(vx+dx, cy-140), (vx+dx+8, cy-dh)], fill=(120,138,96,255), width=6)
        d.ellipse([vx+dx-16, cy-dh-26, vx+dx+24, cy-dh+14], fill=(214,150,138,255))
        d.ellipse([vx+dx-6, cy-dh-16, vx+dx+14, cy-dh+4], fill=(238,206,168,255))

def draw_minimalist_deco(scene, deco):
    sy = deco["shelf_y"]; sx0, sx1 = int(W*0.20), int(W*0.80)
    # crisp under-shadow
    us = Image.new("RGBA", (W, H), (0,0,0,0)); ImageDraw.Draw(us).rectangle([sx0, sy+30, sx1, sy+70], fill=(20,20,22,80))
    scene.alpha_composite(us.filter(ImageFilter.GaussianBlur(16)))
    shelf = shaded_slab(sx1-sx0, 46, deco["shelf_col"]); scene.alpha_composite(shelf, (sx0, sy))
    # one small clean object on the shelf (right)
    ox = int(W*0.64)
    contact_shadow(scene, ox+30, sy+4, 110, blur=20, alpha=70)
    d = ImageDraw.Draw(scene, "RGBA"); d.rectangle([ox, sy-120, ox+60, sy], fill=(206,201,194,255))
    d.rectangle([ox, sy-120, ox+60, sy-112], fill=(230,226,220,255))

DECO = {"luxury-editorial": draw_luxury_deco, "romantic-lifestyle": draw_romantic_deco, "modern-minimalist": draw_minimalist_deco}
SCENES = {"luxury-editorial": scene_luxury, "romantic-lifestyle": scene_romantic, "modern-minimalist": scene_minimalist}
HERO = {
    "luxury-editorial": ("love-story-timeline", "en/s4-engaged-wedding-dotted-branching.png"),
    "romantic-lifestyle": ("love-story-timeline", "en/s1-new-love-neat-stack.png"),
    "modern-minimalist": ("song-poster", "en/sp1-first-dance-player.png"),
}

def file_hash(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def main():
    out = LIB / "cinematic"; out.mkdir(exist_ok=True)
    manifest = []
    for direction, (product, rel) in HERO.items():
        src = SRCROOT / product / rel; before = file_hash(src)
        art = Image.open(src)                               # read-only
        scene, deco, cfg = SCENES[direction]()
        piece = framed(art, frame_col=cfg["frame_col"], frame_w_frac=cfg["frame_w"], mat_col=cfg["mat_col"],
                       mat_frac=cfg["mat"], bevel_light=cfg["bevel_light"])
        piece = fit(piece, int(W*cfg["box"][0]), int(H*cfg["box"][1]))
        px = (W-piece.width)//2; py = int(H*cfg["cy"]) - piece.height//2
        frame_wall_shadow(scene, piece, px, py, soft=cfg["soft"], dark=cfg["dark"], off=cfg["off"])
        DECO[direction](scene, deco)                        # SHARP decor (drawn after wall shadow, before frame)
        scene.alpha_composite(piece, (px, py))
        scene = vignette(scene.convert("RGB"), cfg["vig"])
        scene.save(out / f"{direction}.jpg", quality=94)
        assert file_hash(src) == before, "source changed!"
        manifest.append({"file": f"cinematic/{direction}.jpg", "direction": direction, "product": product,
                         "source_artwork": f"customer-artwork-library-v2/{product}/{rel}",
                         "canvas": f"{W}x{H}", "format": "JPG", "render": "sharp/in-focus", "source_unchanged": True})
        print("rendered", direction, f"{W}x{H}", "(source unchanged:", file_hash(src) == before, ")")
    (LIB/"manifest").mkdir(exist_ok=True)
    json.dump(manifest, open(LIB/"manifest"/"cinematic_manifest.json", "w"), ensure_ascii=False, indent=1)
    print("DONE", len(manifest))

if __name__ == "__main__":
    main()
