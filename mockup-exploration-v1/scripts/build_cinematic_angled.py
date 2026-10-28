# -*- coding: utf-8 -*-
"""Angled (3/4 perspective) variants of the sharp cinematic scenes, so the
mockups are not all flat/front-on.

Reuses the scene + frame pipeline from build_cinematic.py. The framed piece is
placed in real perspective (tilted on the wall) with a matching skewed wall
cast shadow. The artwork PNG itself is never edited — the perspective is a
physically-correct foreshortening of the whole framed object, as a real photo
of an angled frame would show. Still a procedural render (no 3D engine / image
model available here), not a photograph.
"""
from __future__ import annotations
import numpy as np, json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import build_cinematic as bc

W, H = bc.W, bc.H

def find_coeffs(src, dst):
    """Coeffs so img.transform(size, PERSPECTIVE, coeffs) maps the source
    rectangle `src` corners onto the `dst` quad."""
    A = []
    for s, d in zip(src, dst):
        A.append([d[0], d[1], 1, 0, 0, 0, -s[0]*d[0], -s[0]*d[1]])
        A.append([0, 0, 0, d[0], d[1], 1, -s[1]*d[0], -s[1]*d[1]])
    A = np.array(A, dtype=float); B = np.array(src, dtype=float).reshape(8)
    return np.linalg.solve(A, B)

def tilt_rect(x0, y0, x1, y1, *, far="right", dz=0.12, vs=0.05):
    w, h = x1-x0, y1-y0
    if far == "right":
        return [(x0, y0), (x1-w*dz, y0+h*vs), (x1-w*dz, y1-h*vs), (x0, y1)]
    else:  # far == "left"
        return [(x0+w*dz, y0+h*vs), (x1, y0), (x1, y1), (x0+w*dz, y1-h*vs)]

def place_angled(scene, piece, cx, cy, *, far, dz, vs, shadow_soft, shadow_dark, shadow_off):
    pw, ph = piece.size
    x0, y0 = cx-pw//2, cy-ph//2; x1, y1 = x0+pw, y0+ph
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0)); layer.alpha_composite(piece, (x0, y0))
    src = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    dst = tilt_rect(x0, y0, x1, y1, far=far, dz=dz, vs=vs)
    layer = layer.transform((W, H), Image.PERSPECTIVE, find_coeffs(src, dst), Image.BICUBIC)
    # wall cast shadow from the tilted silhouette
    alpha = layer.split()[3]
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sh.paste((14, 10, 7, shadow_dark), (0, 0), alpha)
    sh = sh.filter(ImageFilter.GaussianBlur(shadow_soft))
    scene.alpha_composite(sh, shadow_off)
    # tight contact occlusion
    sh2 = Image.new("RGBA", (W, H), (0, 0, 0, 0)); sh2.paste((0, 0, 0, min(255, shadow_dark+60)), (0, 0), alpha)
    scene.alpha_composite(sh2.filter(ImageFilter.GaussianBlur(max(5, shadow_soft//3))), (shadow_off[0]//3, shadow_off[1]//3))
    scene.alpha_composite(layer)

ANGLES = {   # distinct composition per direction
    "luxury-editorial":   dict(far="right", dz=0.14, vs=0.055, cx=int(W*0.46), cy=int(H*0.40)),
    "romantic-lifestyle": dict(far="left",  dz=0.12, vs=0.045, cx=int(W*0.54), cy=int(H*0.40)),
    "modern-minimalist":  dict(far="right", dz=0.09, vs=0.035, cx=int(W*0.52), cy=int(H*0.375)),
}

def main():
    out = bc.LIB / "cinematic"; out.mkdir(exist_ok=True)
    manifest = []
    for direction, (product, rel) in bc.HERO.items():
        src = bc.SRCROOT / product / rel; before = bc.file_hash(src)
        art = Image.open(src)                      # read-only
        scene, deco, cfg = bc.SCENES[direction]()
        bc.DECO[direction](scene, deco)            # decor first (sharp)
        piece = bc.framed(art, frame_col=cfg["frame_col"], frame_w_frac=cfg["frame_w"], mat_col=cfg["mat_col"],
                          mat_frac=cfg["mat"], bevel_light=cfg["bevel_light"])
        piece = bc.fit(piece, int(W*cfg["box"][0]), int(H*cfg["box"][1]))
        a = ANGLES[direction]
        place_angled(scene, piece, a["cx"], a["cy"], far=a["far"], dz=a["dz"], vs=a["vs"],
                     shadow_soft=cfg["soft"], shadow_dark=cfg["dark"], shadow_off=cfg["off"])
        scene = bc.vignette(scene.convert("RGB"), cfg["vig"])
        scene.save(out / f"{direction}-angle.jpg", quality=94)
        assert bc.file_hash(src) == before
        manifest.append({"file": f"cinematic/{direction}-angle.jpg", "direction": direction, "product": product,
                         "source_artwork": f"customer-artwork-library-v2/{product}/{rel}", "canvas": f"{W}x{H}",
                         "view": "3/4 perspective", "format": "JPG", "source_unchanged": True})
        print("rendered angled", direction)
    (bc.LIB/"manifest").mkdir(exist_ok=True)
    json.dump(manifest, open(bc.LIB/"manifest"/"cinematic_angled_manifest.json", "w"), ensure_ascii=False, indent=1)
    print("DONE", len(manifest))

if __name__ == "__main__":
    main()
