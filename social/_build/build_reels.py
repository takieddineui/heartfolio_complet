# -*- coding: utf-8 -*-
"""Build every vertical reel (1080x1920) in the social pack, for en/fr/ar.

Series A: 2 reels — slow-reveal of the poster styles/themes (real prints).
Series B: 4 reels — one per product, built around the REAL live-page capture
          loops (public/captures/<locale>/<product>.mp4), with a hook, text
          beats and an end card.

All text/graphics are pre-rendered in Pillow (so Arabic shapes and joins
correctly); ffmpeg only does motion, compositing and encoding.
"""
from __future__ import annotations
import subprocess, sys, tempfile, os
from pathlib import Path
from PIL import Image, ImageDraw
import brandkit as bk
import content as C

ROOT = Path(__file__).resolve().parents[1]
TMP = Path("/tmp/claude-0/-home-user-heartfolio-complet/aa860963-8a73-526d-8cf4-3cd205d0543e/scratchpad/work/reels")
TMP.mkdir(parents=True, exist_ok=True)
CAPS = bk.CAPTURES
FPS = 30
MANIFEST = []

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("ffmpeg failed:\n" + r.stderr[-2500:])

# ---------------------------------------------------------------- still cards
WALL = ("#efe7d7", "#e4d8c3")

def hook_card(text, locale, *, product=None, bg=bk.INK):
    W, H = 1080, 1920
    img = bk.canvas(W, H, bg).convert("RGBA")
    mk = bk._mark(int(W*0.14))
    img.alpha_composite(mk, ((W-mk.width)//2, int(H*0.17)))
    if product:
        kicker_text = C.PRODUCT_NAME[product][locale]
        kf = bk.sans_font(locale, int(W*0.030))
        d = ImageDraw.Draw(img)
        kw = bk.line_w(d, kicker_text, kf, locale)
        d.text(((W-kw)//2, int(H*0.30)), kicker_text, font=kf, fill=bk._hex(bk.GOLD_HI),
               direction=bk._dir(locale), language=bk._lang(locale))
    hf = bk.head_font(locale, int(W*0.090))
    bk.draw_para(img, text, hf, bk._hex(bk.PARCH),
                 box=(int(W*0.09), int(H*0.37), int(W*0.82), int(H*0.3)),
                 locale=locale, align="center", line_gap=1.12)
    return img

def end_card(product, locale, bg=bk.INK):
    W, H = 1080, 1920
    img = bk.canvas(W, H, bg).convert("RGBA")
    lk = bk.logo_lockup(int(W*0.56), url=True, mono=bk.PARCH)
    img.alpha_composite(lk, ((W-lk.width)//2, int(H*0.30)))
    d = ImageDraw.Draw(img)
    name = C.PRODUCT_NAME[product][locale] if product else None
    y = int(H*0.56)
    if name:
        nf = bk.head_font(locale, int(W*0.060))
        nw = bk.line_w(d, name, nf, locale)
        d.text(((W-nw)//2, y), name, font=nf, fill=bk._hex(bk.GOLD_HI),
               direction=bk._dir(locale), language=bk._lang(locale)); y += int(H*0.06)
    cf = bk.body_font(locale, int(W*0.034))
    line = C.CLAIM["instant"][locale] + " · " + C.CLAIM["noapp"][locale]
    bk.draw_para(img, line, cf, bk._hex(bk.FOG),
                 box=(int(W*0.1), y+int(H*0.01), int(W*0.8), int(H*0.1)),
                 locale=locale, align="center", line_gap=1.3)
    return img

def poster_still(product, variant, label, kick, locale, frame="black"):
    W, H = 1080, 1920
    img = bk.v_gradient((W, H), *WALL).convert("RGBA")
    poster = bk.load_print(product, variant, locale)
    fr = bk.framed_print(poster, target_h=min(poster.height, 1300), frame=frame)
    fr = bk.fit(fr, int(W*0.74), int(H*0.62))
    bk.paste_with_shadow(img, fr, ((W-fr.width)//2, int(H*0.17)), radius=40, alpha=75)
    d = ImageDraw.Draw(img)
    kf = bk.sans_font(locale, int(W*0.030))
    kw = bk.line_w(d, kick, kf, locale)
    d.text(((W-kw)//2, int(H*0.085)), kick, font=kf, fill=bk._hex(bk.TERRA),
           direction=bk._dir(locale), language=bk._lang(locale))
    lf = bk.head_font(locale, int(W*0.070))
    lw = bk.line_w(d, label, lf, locale)
    d.text(((W-lw)//2, int(H*0.83)), label, font=lf, fill=bk._hex(bk.INK),
           direction=bk._dir(locale), language=bk._lang(locale))
    lk = bk.logo_lockup(int(W*0.24), url=True, mono=bk.INK)
    img.alpha_composite(lk, ((W-lk.width)//2, int(H*0.90)))
    return img

def beat_lower_third(text, locale):
    """Transparent 1080x1920 with a bottom scrim + text, for overlay."""
    W, H = 1080, 1920
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    band_h = int(H*0.30)
    scrim = Image.new("RGBA", (W, band_h), (0, 0, 0, 0))
    sp = scrim.load()
    ink = bk._hex(bk.INK)
    for y in range(band_h):
        a = int(220 * (y / band_h) ** 1.2)
        for x in range(0, W, 1):
            pass
    # build scrim via vertical gradient alpha (fast)
    row = Image.new("L", (1, band_h))
    rp = row.load()
    for y in range(band_h):
        rp[0, y] = int(225 * (y / max(1, band_h-1)) ** 1.1)
    scrim = Image.new("RGBA", (W, band_h), ink + (255,))
    scrim.putalpha(row.resize((W, band_h)))
    img.alpha_composite(scrim, (0, H - band_h))
    hf = bk.head_font(locale, int(W*0.056))
    bk.draw_para(img, text, hf, bk._hex(bk.PARCH),
                 box=(int(W*0.09), H - int(band_h*0.56), int(W*0.82), int(band_h*0.5)),
                 locale=locale, align="center", line_gap=1.2)
    return img

def phone_stage_bg(product, locale):
    """Opaque 1080x1920 wall with product kicker (top) + brand (bottom)."""
    W, H = 1080, 1920
    img = bk.v_gradient((W, H), *WALL).convert("RGBA")
    d = ImageDraw.Draw(img)
    name = C.PRODUCT_NAME[product][locale]
    kf = bk.sans_font(locale, int(W*0.032))
    nw = bk.line_w(d, name, kf, locale)
    d.text(((W-nw)//2, int(H*0.055)), name, font=kf, fill=bk._hex(bk.TERRA),
           direction=bk._dir(locale), language=bk._lang(locale))
    one = C.PRODUCT_ONELINER[product][locale]
    sf = bk.body_font(locale, int(W*0.028))
    bk.draw_para(img, one, sf, bk._hex(bk.CHAR),
                 box=(int(W*0.12), int(H*0.085), int(W*0.76), int(H*0.06)),
                 locale=locale, align="center", line_gap=1.25)
    lk = bk.logo_lockup(int(W*0.26), url=True, mono=bk.INK)
    img.alpha_composite(lk, ((W-lk.width)//2, int(H*0.915)))
    return img

PHONE = dict(screen_h=1150)
def phone_geometry():
    sh = PHONE["screen_h"]
    sw = int(sh*0.462)
    bezel = int(sh*0.020)
    radius = int(sh*0.085)
    bodyW = sw + bezel*2; bodyH = sh + bezel*2
    W, H = 1080, 1920
    bx = (W - bodyW)//2
    by = int(H*0.155)
    sx = bx + bezel; sy = by + bezel
    return dict(sw=sw, sh=sh, bezel=bezel, radius=radius, bodyW=bodyW,
                bodyH=bodyH, bx=bx, by=by, sx=sx, sy=sy,
                screen_radius=int(radius*0.72))

def phone_body_png(locale):
    g = phone_geometry()
    W, H = 1080, 1920
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # body
    d.rounded_rectangle([g["bx"], g["by"], g["bx"]+g["bodyW"], g["by"]+g["bodyH"]],
                        g["radius"], fill=bk._hex("#1a1f2e"))
    # punch transparent screen hole
    hole = Image.new("L", (g["sw"], g["sh"]), 0)
    ImageDraw.Draw(hole).rounded_rectangle([0, 0, g["sw"], g["sh"]], g["screen_radius"], fill=255)
    # set alpha 0 in hole region
    region = img.crop((g["sx"], g["sy"], g["sx"]+g["sw"], g["sy"]+g["sh"]))
    ra = region.split()[3]
    from PIL import ImageChops
    ra = ImageChops.subtract(ra, hole)
    region.putalpha(ra)
    img.paste(region, (g["sx"], g["sy"]))
    # camera dot
    d.ellipse([W//2-g["bezel"]//2, g["by"]+int(g["bezel"]*0.9),
               W//2+g["bezel"]//2, g["by"]+int(g["bezel"]*0.9)+g["bezel"]],
              fill=(40,46,60,255))
    return img

# ---------------------------------------------------------------- clip makers
def still_clip(png_path, out_path, dur, zoom_to=1.08, zdir="in"):
    frames = int(dur*FPS)
    if zdir == "in":
        z = f"min(zoom+{(zoom_to-1)/frames:.6f},{zoom_to})"
    else:
        z = f"if(eq(on,0),{zoom_to},max(zoom-{(zoom_to-1)/frames:.6f},1.0))"
    vf = (f"scale=2160:-1,zoompan=z='{z}':d={frames}:x='iw/2-(iw/zoom/2)':"
          f"y='ih/2-(ih/zoom/2)':s=1080x1920:fps={FPS},format=yuv420p")
    run(["ffmpeg","-y","-loop","1","-i",str(png_path),"-t",f"{dur}",
         "-vf",vf,"-r",str(FPS),"-an",str(out_path)])

def xfade_concat(clips, out_path, T, D):
    """Crossfade-chain equal-length clips (duration T, transition D)."""
    inp = []
    for c in clips:
        inp += ["-i", str(c)]
    n = len(clips)
    fc = []
    prev = "[0:v]"
    for k in range(1, n):
        off = k*(T-D)
        lbl = f"[x{k}]"
        fc.append(f"{prev}[{k}:v]xfade=transition=fade:duration={D}:offset={off:.3f}{lbl}")
        prev = lbl
    filter = ";".join(fc)
    run(["ffmpeg","-y",*inp,"-filter_complex",filter,"-map",prev,
         "-r",str(FPS),"-pix_fmt","yuv420p","-c:v","libx264","-crf","20",
         "-movflags","+faststart",str(out_path)])

# ---------------------------------------------------------------- Series A
def series_a_reel(product, variants, hook_text, locale, out_path, T, D):
    clips = []
    kick = C.TAG["style"][locale] if product=="love-story-timeline" else C.TAG["theme"][locale]
    frame = "black" if product=="love-story-timeline" else "oak"
    # hook
    hk = TMP / f"a_{product}_{locale}_hook.png"; hook_card(hook_text, locale, product=product).convert("RGB").save(hk)
    hc = TMP / f"a_{product}_{locale}_hook.mp4"; still_clip(hk, hc, T, zoom_to=1.06); clips.append(hc)
    # styles
    for i,(pid,names) in enumerate(variants, start=1):
        p = TMP / f"a_{product}_{locale}_{pid}.png"
        poster_still(product, pid, names[locale], f"{kick} {i}/{len(variants)}", locale, frame=frame).convert("RGB").save(p)
        c = TMP / f"a_{product}_{locale}_{pid}.mp4"; still_clip(p, c, T, zoom_to=1.07); clips.append(c)
    # end
    ek = TMP / f"a_{product}_{locale}_end.png"; end_card(product, locale).convert("RGB").save(ek)
    ec = TMP / f"a_{product}_{locale}_end.mp4"; still_clip(ek, ec, T, zoom_to=1.05, zdir="out"); clips.append(ec)
    xfade_concat(clips, out_path, T, D)

# ---------------------------------------------------------------- Series B
def series_b_reel(product, locale, out_path):
    g = phone_geometry()
    hook = C.B_REELS[product]["hook"][locale]
    beats = [b[locale] for b in C.B_REELS[product]["beats"]]
    # assets
    hk = TMP / f"b_{product}_{locale}_hook.png"; hook_card(hook, locale, product=product).convert("RGB").save(hk)
    ek = TMP / f"b_{product}_{locale}_end.png"; end_card(product, locale).convert("RGB").save(ek)
    bgp = TMP / f"b_{product}_{locale}_bg.png"; phone_stage_bg(product, locale).convert("RGB").save(bgp)
    bodyp = TMP / f"b_{product}_{locale}_body.png"; phone_body_png(locale).save(bodyp)
    beatps = []
    for i,bt in enumerate(beats):
        bp = TMP / f"b_{product}_{locale}_beat{i}.png"; beat_lower_third(bt, locale).save(bp); beatps.append(bp)
    loop = CAPS / locale / f"{product}.mp4"
    # clips
    T, D = 2.8, 0.5
    hc = TMP / f"b_{product}_{locale}_hook.mp4"; still_clip(hk, hc, T, zoom_to=1.06);
    ec = TMP / f"b_{product}_{locale}_end.mp4"; still_clip(ek, ec, T, zoom_to=1.05, zdir="out")
    # phone scene
    scene_dur = 13.5
    pc = TMP / f"b_{product}_{locale}_scene.mp4"
    inputs = ["-loop","1","-t",f"{scene_dur}","-i",str(bgp),
              "-stream_loop","4","-i",str(loop),
              "-loop","1","-t",f"{scene_dur}","-i",str(bodyp)]
    for bp in beatps:
        inputs += ["-loop","1","-t",f"{scene_dur}","-i",str(bp)]
    # beat timing
    seg = scene_dur/ (len(beatps))
    fc = []
    fc.append(f"[1:v]scale={g['sw']}:{g['sh']},setsar=1[scr]")
    fc.append(f"[0:v][scr]overlay={g['sx']}:{g['sy']}:shortest=0[a0]")
    fc.append(f"[a0][2:v]overlay=0:0[a1]")
    prev = "[a1]"
    for i,bp in enumerate(beatps):
        st = 0.8 + i*seg
        en = st + seg - 0.4
        idx = 3+i
        fc.append(f"[{idx}:v]fade=t=in:st={st:.2f}:d=0.4:alpha=1,fade=t=out:st={en:.2f}:d=0.4:alpha=1[bt{i}]")
        fc.append(f"{prev}[bt{i}]overlay=0:0:enable='between(t,{st:.2f},{en+0.4:.2f})'[s{i}]")
        prev = f"[s{i}]"
    fc.append(f"{prev}format=yuv420p[out]")
    run(["ffmpeg","-y",*inputs,"-filter_complex",";".join(fc),"-map","[out]",
         "-r",str(FPS),"-c:v","libx264","-crf","20","-movflags","+faststart",str(pc)])
    # concat hook + scene + end with xfade (unequal lengths -> manual offsets)
    clips = [hc, pc, ec]; durs = [T, scene_dur, T]
    inp = []
    for c in clips: inp += ["-i", str(c)]
    off1 = durs[0]-D
    off2 = durs[0]+durs[1]-2*D
    fc2 = (f"[0:v][1:v]xfade=transition=fade:duration={D}:offset={off1:.3f}[x1];"
           f"[x1][2:v]xfade=transition=fade:duration={D}:offset={off2:.3f}[out]")
    run(["ffmpeg","-y",*inp,"-filter_complex",fc2,"-map","[out]",
         "-r",str(FPS),"-pix_fmt","yuv420p","-c:v","libx264","-crf","20",
         "-movflags","+faststart",str(out_path)])

def outdir(series, locale):
    p = ROOT / series / locale / "reels"; p.mkdir(parents=True, exist_ok=True); return p

def build(locale):
    # Series A
    da = outdir("series-a-posters", locale)
    o1 = da / "ra1-love-story-timeline-six-styles.mp4"
    series_a_reel("love-story-timeline", C.LST_LAYOUTS, C.A_REELS["ra1-lst"]["hook"][locale], locale, o1, T=2.8, D=0.6)
    MANIFEST.append(("series-a-posters", locale, str(o1.relative_to(ROOT)), "Reel · LST six styles"))
    o2 = da / "ra2-song-poster-eight-themes.mp4"
    series_a_reel("song-poster", C.SP_THEMES, C.A_REELS["ra2-song"]["hook"][locale], locale, o2, T=2.3, D=0.5)
    MANIFEST.append(("series-a-posters", locale, str(o2.relative_to(ROOT)), "Reel · Song eight themes"))
    # Series B
    db = outdir("series-b-live", locale)
    for product in ("love-story-timeline","song-poster","reasons-i-love-you","graduation-keepsake"):
        op = db / f"rb-{product}.mp4"
        series_b_reel(product, locale, op)
        MANIFEST.append(("series-b-live", locale, str(op.relative_to(ROOT)), f"Reel · {product} live"))
    print("reels built", locale)

if __name__ == "__main__":
    locs = sys.argv[1:] or list(C.LOCALES)
    for loc in locs:
        build(loc)
    import json
    (ROOT/"_build"/"reel_manifest.json").write_text(json.dumps(MANIFEST, ensure_ascii=False, indent=1))
    print("TOTAL reels:", len(MANIFEST))
