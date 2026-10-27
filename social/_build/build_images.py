# -*- coding: utf-8 -*-
"""Build every static image in the social pack, for en / fr / ar.

Series A (posters): flats, framed mockups, 8 posts, the six-styles carousel.
Series B (live):     6 posts, How-it-works carousel, Reasons-examples carousel.

Everything is composited from REAL material: prints rendered by the project's
Pillow renderers and the committed live-page/QR captures. No AI imagery.
"""
from __future__ import annotations
import sys
from pathlib import Path
from PIL import Image, ImageDraw
import brandkit as bk
import content as C

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = []  # (series, locale, relpath, title)

def out(series, locale, *parts):
    p = ROOT / series / locale
    for x in parts[:-1]:
        p = p / x
    p.mkdir(parents=True, exist_ok=True)
    return p / parts[-1]

def save(img, series, locale, *parts, title=""):
    path = out(series, locale, *parts)
    img.convert("RGB").save(path, quality=92)
    MANIFEST.append((series, locale, str(path.relative_to(ROOT)), title))
    return path

# ---------------------------------------------------------------- decoration
def footer(img, locale, dark=False, url=True):
    """Small brand mark + wordmark lockup, bottom-centred."""
    w, h = img.size
    lk = bk.logo_lockup(int(w * 0.30), url=url,
                        mono=(bk.PARCH if dark else bk.INK))
    img.paste(lk, ((w - lk.width) // 2, h - lk.height - int(h * 0.055)), lk)

def kicker(img, text, locale, y, color=None, size=None):
    w = img.size[0]
    color = color or bk.TERRA
    f = bk.sans_font(locale, size or int(w * 0.030))
    d = ImageDraw.Draw(img)
    # letter-spaced uppercase kicker (latin); arabic just bold small
    s = text
    tw = bk.line_w(d, s, f, locale)
    d.text(((w - tw) // 2, y), s, font=f, fill=bk._hex(color),
           direction=bk._dir(locale), language=bk._lang(locale))
    return y + f.getmetrics()[0] + int(w * 0.01)

def hairline(img, y, x0, x1, color=bk.FOG, width=3):
    ImageDraw.Draw(img).line([(x0, y), (x1, y)], fill=bk._hex(color), width=width)

# ---------------------------------------------------------------- templates
def framed_on_wall(product, variant, locale, size=(1080, 1350), frame="black",
                   label=None, kick=None, head=None, pad_top=0.0):
    W, H = size
    img = bk.wall_bg(W, H).convert("RGBA")
    poster = bk.load_print(product, variant, locale)
    landscape = poster.width > poster.height
    area_h = int(H * (0.70 if (head or label) else 0.84))
    fr = bk.framed_print(poster, target_h=min(poster.height, 1300), frame=frame)
    fr = bk.fit(fr, int(W * 0.78), area_h)
    y = int(H * (0.085 + pad_top)) if (head) else (H - fr.height) // 2 - int(H*0.02)
    if not head and not label:
        y = (H - fr.height) // 2
    bk.paste_with_shadow(img, fr, ((W - fr.width) // 2, y), radius=36, alpha=70)
    if kick:
        kicker(img, kick, locale, int(H * 0.045))
    if label:
        ly = y + fr.height + int(H * 0.03)
        f = bk.head_font(locale, int(W * 0.052))
        d = ImageDraw.Draw(img)
        tw = bk.line_w(d, label, f, locale)
        d.text(((W - tw) // 2, ly), label, font=f, fill=bk._hex(bk.INK),
               direction=bk._dir(locale), language=bk._lang(locale))
    return img

def flat_card(product, variant, locale, size=(1080, 1350), label=None, kick=None):
    W, H = size
    img = bk.canvas(W, H, bk.PARCH).convert("RGBA")
    poster = bk.load_print(product, variant, locale)
    area_h = int(H * (0.74 if label else 0.84))
    p = bk.fit(poster, int(W * 0.72), area_h)
    # thin keyline around the flat print
    key = Image.new("RGBA", (p.width + 4, p.height + 4), (0, 0, 0, 0))
    ImageDraw.Draw(key).rectangle([0, 0, p.width + 3, p.height + 3],
                                  outline=bk._hex(bk.FOG), width=2)
    y = int(H * 0.085) if label else (H - p.height) // 2
    bk.paste_with_shadow(img, p.convert("RGBA"), ((W - p.width) // 2, y),
                         radius=30, alpha=55)
    img.alpha_composite(key, ((W - p.width) // 2 - 2, y - 2))
    if kick:
        kicker(img, kick, locale, int(H * 0.045))
    if label:
        ly = y + p.height + int(H * 0.035)
        f = bk.head_font(locale, int(W * 0.050))
        d = ImageDraw.Draw(img)
        tw = bk.line_w(d, label, f, locale)
        d.text(((W - tw) // 2, ly), label, font=f, fill=bk._hex(bk.INK),
               direction=bk._dir(locale), language=bk._lang(locale))
    return img

def headline_block(img, head, sub, locale, *, top, color_head=bk.INK,
                   color_sub=bk.CHAR, hsize=0.072, ssize=0.034, align="center"):
    W, H = img.size
    y = top
    hf = bk.head_font(locale, int(W * hsize))
    used = bk.draw_para(img, head, hf, bk._hex(color_head),
                        box=(int(W*0.08), y, int(W*0.84), int(H*0.5)),
                        locale=locale, align=align, line_gap=1.12)
    y += used + int(H * 0.018)
    if sub:
        sf = bk.body_font(locale, int(W * ssize))
        used2 = bk.draw_para(img, sub, sf, bk._hex(color_sub),
                             box=(int(W*0.10), y, int(W*0.80), int(H*0.3)),
                             locale=locale, align=align, line_gap=1.35)
        y += used2
    return y

def post_hero_framed(product, variant, head, sub, locale, frame="black"):
    """1080x1080: framed poster on wall + headline overlay band at top."""
    W = H = 1080
    img = bk.wall_bg(W, H).convert("RGBA")
    poster = bk.load_print(product, variant, locale)
    fr = bk.framed_print(poster, target_h=min(poster.height, 1300), frame=frame)
    fr = bk.fit(fr, int(W * 0.50), int(H * 0.74))
    # poster to the right, copy to the left (center for AR we keep stacked)
    fr_x = int(W * 0.52)
    bk.paste_with_shadow(img, fr, (fr_x, (H - fr.height) // 2), radius=34, alpha=70)
    # left copy column
    colx = int(W * 0.07); colw = int(W * 0.40)
    name = C.PRODUCT_NAME[product][locale]
    kf = bk.sans_font(locale, int(W * 0.026))
    d = ImageDraw.Draw(img)
    d.text((colx, int(H*0.16)), name.upper() if locale!="ar" else name, font=kf,
           fill=bk._hex(bk.TERRA), direction=bk._dir(locale), language=bk._lang(locale))
    yy = int(H*0.22)
    hf = bk.head_font(locale, int(W * 0.070))
    u = bk.draw_para(img, head, hf, bk._hex(bk.INK),
                     box=(colx, yy, colw, int(H*0.4)), locale=locale, align="start", line_gap=1.12)
    yy += u + int(H*0.02)
    if sub:
        sf = bk.body_font(locale, int(W*0.030))
        bk.draw_para(img, sub, sf, bk._hex(bk.CHAR),
                     box=(colx, yy, colw, int(H*0.3)), locale=locale, align="start", line_gap=1.35)
    # brand mark bottom-left
    lk = bk.logo_lockup(int(W*0.26), url=True, mono=bk.INK)
    img.paste(lk, (colx, H - lk.height - int(H*0.07)), lk)
    return img

def claim_post(head, sub, locale, *, bg=bk.INK, accent=bk.GOLD_HI, poster=None):
    """1080x1080 dark claim card, optional faint poster texture at side."""
    W = H = 1080
    img = bk.canvas(W, H, bg).convert("RGBA")
    if poster is not None:
        pw = int(W*0.42)
        p = bk.cover(poster, pw, H).convert("RGBA")
        # horizontal fade: solid at the right edge, gone before mid-card,
        # so no stray text reads and there is no hard seam.
        row = Image.new("L", (pw, 1), 0)
        rpx = row.load()
        for x in range(pw):
            rpx[x, 0] = int(70 * (x / max(1, pw - 1)) ** 1.6)
        p.putalpha(row.resize((pw, H)))
        img.alpha_composite(p, (W - pw, 0))
    kicker(img, C.CLAIM["linkqr"][locale], locale, int(H*0.16), color=accent, size=int(W*0.028))
    hf = bk.head_font(locale, int(W*0.082))
    u = bk.draw_para(img, head, hf, bk._hex(bk.PARCH),
                     box=(int(W*0.09), int(H*0.26), int(W*0.82), int(H*0.4)),
                     locale=locale, align="center", line_gap=1.14)
    if sub:
        sf = bk.body_font(locale, int(W*0.036))
        bk.draw_para(img, sub, sf, bk._hex(bk.FOG),
                     box=(int(W*0.12), int(H*0.26)+u+int(H*0.03), int(W*0.76), int(H*0.25)),
                     locale=locale, align="center", line_gap=1.35)
    footer(img, locale, dark=True)
    return img

def quote_post(quote, locale, *, product, bg=bk.PARCH):
    """1080x1080 example-message card over a soft poster wash."""
    W = H = 1080
    img = bk.canvas(W, H, bg).convert("RGBA")
    # faint poster wash background
    poster = bk.load_print(product, "neat-stack" if product=="love-story-timeline" else "player", locale)
    wash = bk.cover(poster, W, H).convert("RGBA")
    wash.putalpha(26)
    img.alpha_composite(wash, (0, 0))
    overlay = Image.new("RGBA", (W, H), bk._hex(bg) + (170,))
    img.alpha_composite(overlay, (0, 0))
    # big open-quote mark
    qf = bk.head_font("en", int(W*0.22))
    d = ImageDraw.Draw(img)
    d.text((int(W*0.09), int(H*0.085)), "“", font=qf, fill=bk._hex(bk.GOLD))
    # the quote
    hf = bk.head_font(locale, int(W*0.060))
    u = bk.draw_para(img, quote, hf, bk._hex(bk.INK),
                     box=(int(W*0.10), int(H*0.30), int(W*0.80), int(H*0.4)),
                     locale=locale, align="center", line_gap=1.22)
    # example tag
    tf = bk.sans_font(locale, int(W*0.026))
    tag = C.TAG["example"][locale]
    tw = bk.line_w(d, tag, tf, locale)
    ty = int(H*0.30)+u+int(H*0.05)
    hairline(img, ty-int(H*0.012), int(W*0.34), int(W*0.66), color=bk.GOLD)
    d.text(((W-tw)//2, ty), tag, font=tf, fill=bk._hex(bk.TERRA),
           direction=bk._dir(locale), language=bk._lang(locale))
    footer(img, locale, dark=False)
    return img

def phone_post(product, head, sub, locale, *, still_name=None, quote=None, bg=bk.PARCH):
    """1080x1080: real live-page still in a phone + copy beside it."""
    W = H = 1080
    img = bk.canvas(W, H, bg).convert("RGBA")
    still_name = still_name or f"{product}.jpg"
    still = bk.load_capture(locale, still_name)
    ph = bk.phone_mockup(still, screen_h=int(H*0.80))
    ph = bk.fit(ph, int(W*0.44), int(H*0.86))
    phx = int(W*0.55)
    bk.paste_with_shadow(img, ph, (phx, (H-ph.height)//2), radius=30, alpha=55)
    colx = int(W*0.07); colw = int(W*0.42)
    name = C.PRODUCT_NAME[product][locale]
    kf = bk.sans_font(locale, int(W*0.025))
    d = ImageDraw.Draw(img)
    d.text((colx, int(H*0.15)), name.upper() if locale!="ar" else name, font=kf,
           fill=bk._hex(bk.TERRA), direction=bk._dir(locale), language=bk._lang(locale))
    yy = int(H*0.21)
    hf = bk.head_font(locale, int(W*0.062))
    u = bk.draw_para(img, head, hf, bk._hex(bk.INK),
                     box=(colx, yy, colw, int(H*0.4)), locale=locale, align="start", line_gap=1.14)
    yy += u + int(H*0.02)
    if sub:
        sf = bk.body_font(locale, int(W*0.029))
        yy += bk.draw_para(img, sub, sf, bk._hex(bk.CHAR),
                           box=(colx, yy, colw, int(H*0.25)), locale=locale, align="start", line_gap=1.35)
    if quote:
        yy += int(H*0.02)
        hairline(img, yy, colx, colx+int(colw*0.5))
        yy += int(H*0.02)
        qf = bk.head_font(locale, int(W*0.034))
        bk.draw_para(img, "“"+quote+"”", qf, bk._hex(bk.TERRA),
                     box=(colx, yy, colw, int(H*0.22)), locale=locale, align="start", line_gap=1.25)
    lk = bk.logo_lockup(int(W*0.24), url=True, mono=bk.INK)
    img.paste(lk, (colx, H-lk.height-int(H*0.06)), lk)
    return img

def scan_post(locale, product="reasons-i-love-you", bg=bk.PARCH):
    """1080x1080: real QR card beside a real phone showing the live page."""
    W = H = 1080
    img = bk.canvas(W, H, bg).convert("RGBA")
    qr = bk.load_capture(locale, f"{product}-qr.jpg")
    qrc = bk.fit(qr, int(W*0.40), int(H*0.56)).convert("RGBA")
    qrc = bk.rounded(qrc, 24)
    still = bk.load_capture(locale, f"{product}.jpg")
    ph = bk.phone_mockup(still, screen_h=int(H*0.60))
    ph = bk.fit(ph, int(W*0.34), int(H*0.64))
    # phone left, qr right, slightly overlapping band
    bk.paste_with_shadow(img, ph, (int(W*0.08), int(H*0.26)), radius=28, alpha=55)
    bk.paste_with_shadow(img, qrc, (int(W*0.52), int(H*0.30)), radius=24, alpha=50)
    head = C.B_POSTS["b1-scan"]["head"][locale]
    sub = C.B_POSTS["b1-scan"]["sub"][locale]
    hf = bk.head_font(locale, int(W*0.056))
    d = ImageDraw.Draw(img)
    u = bk.draw_para(img, head, hf, bk._hex(bk.INK),
                     box=(int(W*0.08), int(H*0.05), int(W*0.84), int(H*0.2)),
                     locale=locale, align="center", line_gap=1.12)
    footer(img, locale, dark=False)
    return img

# ---------------------------------------------------------------- carousels
def carousel_cover(title, sub, locale, series_color=bk.INK, bg=bk.PARCH, kick=None):
    W, H = 1080, 1350
    img = bk.canvas(W, H, bg).convert("RGBA")
    if kick:
        kicker(img, kick, locale, int(H*0.16))
    hf = bk.head_font(locale, int(W*0.088))
    u = bk.draw_para(img, title, hf, bk._hex(series_color),
                     box=(int(W*0.09), int(H*0.24), int(W*0.82), int(H*0.4)),
                     locale=locale, align="center", line_gap=1.1)
    if sub:
        sf = bk.body_font(locale, int(W*0.034))
        bk.draw_para(img, sub, sf, bk._hex(bk.CHAR),
                     box=(int(W*0.12), int(H*0.24)+u+int(H*0.03), int(W*0.76), int(H*0.3)),
                     locale=locale, align="center", line_gap=1.4)
    sw = bk.sans_font(locale, int(W*0.028))
    d = ImageDraw.Draw(img)
    s = C.TAG["swipe"][locale]
    tw = bk.line_w(d, s, sw, locale)
    d.text(((W-tw)//2, int(H*0.80)), s, font=sw, fill=bk._hex(bk.TERRA),
           direction=bk._dir(locale), language=bk._lang(locale))
    footer(img, locale, dark=False)
    return img

def how_step(step, locale, still_name=None, product=None):
    W, H = 1080, 1350
    img = bk.canvas(W, H, bk.CANDLE).convert("RGBA")
    # number badge (top-left, mirrored to top-right for RTL)
    d = ImageDraw.Draw(img)
    r = int(W*0.072)
    cx = int(W*0.86) if bk.is_rtl(locale) else int(W*0.14)
    cy = int(H*0.11)
    d.ellipse([cx-r, cy-r, cx+r, cy+r], fill=bk._hex(bk.GOLD))
    nf = bk.head_font("en", int(r*1.1))
    nw = bk.line_w(d, step["n"], nf)
    d.text((cx-nw//2, cy-int(r*0.72)), step["n"], font=nf, fill=bk._hex(bk.INK))
    # visual (phone still or qr), kept in a fixed band so the caption never
    # collides with it or the footer in any language
    if still_name:
        if still_name.endswith("-qr.jpg"):
            v = bk.load_capture(locale, still_name)
            vis = bk.fit(v, int(W*0.46), int(H*0.44)).convert("RGBA"); vis = bk.rounded(vis, 20)
        else:
            still = bk.load_capture(locale, still_name)
            vis = bk.phone_mockup(still, screen_h=int(H*0.40))
            vis = bk.fit(vis, int(W*0.46), int(H*0.48))
        top = int(H*0.19) + (int(H*0.48) - vis.height)//2
        bk.paste_with_shadow(img, vis, ((W-vis.width)//2, top), radius=28, alpha=50)
    hf = bk.head_font(locale, int(W*0.046))
    bk.draw_para(img, step["t"][locale], hf, bk._hex(bk.INK),
                 box=(int(W*0.10), int(H*0.70), int(W*0.80), int(H*0.12)),
                 locale=locale, align="center", line_gap=1.22, valign="middle")
    lk = bk.logo_lockup(int(W*0.24), url=False, mono=bk.INK)
    img.paste(lk, ((W-lk.width)//2, H - lk.height - int(H*0.035)), lk)
    return img

def reasons_group_slide(title_local, lines, locale, bg=bk.PARCH):
    W, H = 1080, 1350
    img = bk.canvas(W, H, bg).convert("RGBA")
    kicker(img, C.TAG["example_short"][locale], locale, int(H*0.07), color=bk.TERRA)
    hf = bk.head_font(locale, int(W*0.058))
    d = ImageDraw.Draw(img)
    u = bk.draw_para(img, title_local, hf, bk._hex(bk.INK),
                     box=(int(W*0.09), int(H*0.12), int(W*0.82), int(H*0.15)),
                     locale=locale, align="center", line_gap=1.1)
    hairline(img, int(H*0.12)+u+int(H*0.02), int(W*0.30), int(W*0.70), color=bk.GOLD)
    y = int(H*0.12)+u+int(H*0.06)
    lf = bk.head_font(locale, int(W*0.040))
    for ln in lines:
        card_h_box = (int(W*0.11), y, int(W*0.78), int(H*0.2))
        used = bk.draw_para(img, "“"+ln+"”", lf, bk._hex(bk.CHAR),
                            box=card_h_box, locale=locale, align="center", line_gap=1.25)
        y += used + int(H*0.035)
    footer(img, locale, dark=False, url=False)
    return img

# ---------------------------------------------------------------- build all
def build(locale):
    SA = "series-a-posters"; SB = "series-b-live"
    # ---- A: flats + framed for all 6 LST + 8 SP ----
    for pid, names in C.LST_LAYOUTS:
        lbl = names[locale]
        save(flat_card("love-story-timeline", pid, locale, kick=C.TAG["style"][locale], label=lbl),
             SA, locale, "flats", f"love-story-timeline-{pid}.png", title=f"Flat · LST · {names['en']}")
        save(framed_on_wall("love-story-timeline", pid, locale, kick=C.TAG["style"][locale], label=lbl),
             SA, locale, "framed", f"love-story-timeline-{pid}.png", title=f"Framed · LST · {names['en']}")
    for pid, names in C.SP_THEMES:
        lbl = names[locale]
        save(flat_card("song-poster", pid, locale, kick=C.TAG["theme"][locale], label=lbl),
             SA, locale, "flats", f"song-poster-{pid}.png", title=f"Flat · Song · {names['en']}")
        save(framed_on_wall("song-poster", pid, locale, kick=C.TAG["theme"][locale], label=lbl, frame="oak"),
             SA, locale, "framed", f"song-poster-{pid}.png", title=f"Framed · Song · {names['en']}")

    # ---- A: 8 posts ----
    a = C.A_POSTS
    save(post_hero_framed("love-story-timeline", "neat-stack", a["a1-lst-hero"]["head"][locale], a["a1-lst-hero"]["sub"][locale], locale),
         SA, locale, "posts", "a1-lst-hero.png", title="A1 · LST hero")
    save(framed_on_wall("love-story-timeline", "overlapping-cascade", locale, kick=C.TAG["style"][locale],
                        label=dict(C.LST_LAYOUTS)["overlapping-cascade"][locale], size=(1080,1080)),
         SA, locale, "posts", "a2-lst-cascade.png", title="A2 · LST Overlapping Cascade")
    save(flat_card("love-story-timeline", "dotted-branching", locale, size=(1080,1080),
                   kick=C.TAG["style"][locale], label=dict(C.LST_LAYOUTS)["dotted-branching"][locale]),
         SA, locale, "posts", "a3-lst-dotted.png", title="A3 · LST Dotted Branching")
    save(post_hero_framed("song-poster", "player", a["a4-song-hero"]["head"][locale], a["a4-song-hero"]["sub"][locale], locale, frame="oak"),
         SA, locale, "posts", "a4-song-hero.png", title="A4 · Song hero")
    save(framed_on_wall("song-poster", "mosaic", locale, kick=C.TAG["theme"][locale],
                        label=dict(C.SP_THEMES)["mosaic"][locale], size=(1080,1080), frame="oak"),
         SA, locale, "posts", "a5-song-mosaic.png", title="A5 · Song Mosaic")
    save(flat_card("song-poster", "ledger", locale, size=(1080,1080),
                   kick=C.TAG["theme"][locale], label=dict(C.SP_THEMES)["ledger"][locale]),
         SA, locale, "posts", "a6-song-ledger.png", title="A6 · Song Ledger")
    save(claim_post(a["a7-printready"]["head"][locale], a["a7-printready"]["sub"][locale], locale,
                    poster=bk.load_print("song-poster","award",locale)),
         SA, locale, "posts", "a7-printready.png", title="A7 · Print-ready claim")
    save(quote_post(C.DEDICATION[locale], locale, product="love-story-timeline"),
         SA, locale, "posts", "a8-dedication-quote.png", title="A8 · Example dedication")

    # ---- A: carousel One story, six styles (6 slides: cover shows style 1,
    #       slides 2-6 the other five — all six styles represented) ----
    cc = C.A_CAROUSEL
    first_id, first_names = C.LST_LAYOUTS[0]
    save(six_styles_cover(cc["title"][locale], cc["sub"][locale], first_id, first_names[locale], locale),
         SA, locale, "carousel-six-styles", "slide-1-cover.png", title="Carousel A · cover + Neat Stack")
    slide_n = 2
    for pid, names in C.LST_LAYOUTS[1:]:
        save(framed_on_wall("love-story-timeline", pid, locale, kick=f"{C.TAG['style'][locale]} {slide_n}/6",
                            label=names[locale]),
             SA, locale, "carousel-six-styles", f"slide-{slide_n}-{pid}.png", title=f"Carousel A · {names['en']}")
        slide_n += 1

    # ---- B: 6 posts ----
    save(scan_post(locale, product="reasons-i-love-you"),
         SB, locale, "posts", "b1-scan.png", title="B1 · Scan or tap")
    save(phone_post("love-story-timeline",
                    {"en":"Your story,\none moment at a time.","fr":"Votre histoire,\nun moment à la fois.","ar":"قصّتكما،\nلحظةً تلو الأخرى."}[locale],
                    C.CLAIM["linkqr"][locale], locale),
         SB, locale, "posts", "b2-lst-live.png", title="B2 · LST live")
    save(phone_post("reasons-i-love-you",
                    {"en":"Ten reasons,\nopened one by one.","fr":"Dix raisons,\nouvertes une à une.","ar":"عشرة أسباب،\nتُفتح واحدًا واحدًا."}[locale],
                    None, locale, quote=list(C.REASONS_EXAMPLES[locale].values())[0][0]),
         SB, locale, "posts", "b3-reasons-live.png", title="B3 · Reasons live + example")
    save(phone_post("graduation-keepsake",
                    {"en":"The whole journey,\nnot just the day.","fr":"Tout le parcours,\npas seulement le jour J.","ar":"الرحلة كاملة،\nلا اليوم وحده."}[locale],
                    C.PRODUCT_ONELINER["graduation-keepsake"][locale], locale),
         SB, locale, "posts", "b4-grad-live.png", title="B4 · Graduation live")
    save(phone_post("song-poster",
                    {"en":"A page that\nplays your song.","fr":"Une page qui\njoue votre chanson.","ar":"صفحةٌ تشغّل\nأغنيتكم."}[locale],
                    C.PRODUCT_ONELINER["song-poster"][locale], locale),
         SB, locale, "posts", "b5-song-live.png", title="B5 · Song live")
    save(claim_post(C.B_POSTS["b6-noapp"]["head"][locale], C.B_POSTS["b6-noapp"]["sub"][locale], locale,
                    poster=None),
         SB, locale, "posts", "b6-noapp.png", title="B6 · No app claim")

    # ---- B: How it works carousel (cover + 4 steps) ----
    h = C.B_HOW
    save(carousel_cover(h["cover"][locale], None, locale),
         SB, locale, "carousel-how-it-works", "slide-1-cover.png", title="How it works · cover")
    stills = ["studio-edit.jpg", "studio-preview.jpg", "reasons-i-love-you-qr.jpg", "love-story-timeline.jpg"]
    for i, step in enumerate(h["steps"]):
        save(how_step(step, locale, still_name=stills[i]),
             SB, locale, "carousel-how-it-works", f"slide-{i+2}-step{step['n']}.png",
             title=f"How it works · step {step['n']}")
    # footnote slide not needed; keep 5 slides

    # ---- B: Reasons examples carousel (cover + groups + finale + end) ----
    r = C.B_REASONS
    save(carousel_cover(r["cover"][locale], r["cover_sub"][locale], locale,
                        kick=C.PRODUCT_NAME["reasons-i-love-you"][locale]),
         SB, locale, "carousel-reasons-examples", "slide-1-cover.png", title="Reasons examples · cover")
    sn = 2
    for title_local, lines in C.REASONS_EXAMPLES[locale].items():
        save(reasons_group_slide(title_local, lines, locale),
             SB, locale, "carousel-reasons-examples", f"slide-{sn}-group.png",
             title=f"Reasons examples · {title_local}")
        sn += 1
    # finale example slide
    save(quote_slide_finale(C.REASONS_FINALE[locale], locale),
         SB, locale, "carousel-reasons-examples", f"slide-{sn}-finale.png", title="Reasons examples · finale")
    sn += 1
    save(reasons_end_slide(r["end"][locale], locale),
         SB, locale, "carousel-reasons-examples", f"slide-{sn}-cta.png", title="Reasons examples · CTA")

def six_styles_cover(title, sub, variant, label, locale):
    """Carousel cover: title + the first style framed, so slide 1 both
    opens the set and shows style 1 (keeps the set at six slides)."""
    W, H = 1080, 1350
    img = bk.wall_bg(W, H).convert("RGBA")
    poster = bk.load_print("love-story-timeline", variant, locale)
    fr = bk.framed_print(poster, target_h=min(poster.height, 1300), frame="black")
    fr = bk.fit(fr, int(W*0.42), int(H*0.5))
    bk.paste_with_shadow(img, fr, ((W-fr.width)//2, int(H*0.40)), radius=32, alpha=70)
    kicker(img, C.PRODUCT_NAME["love-story-timeline"][locale], locale, int(H*0.07), color=bk.TERRA)
    hf = bk.head_font(locale, int(W*0.082))
    u = bk.draw_para(img, title, hf, bk._hex(bk.INK),
                     box=(int(W*0.09), int(H*0.12), int(W*0.82), int(H*0.2)),
                     locale=locale, align="center", line_gap=1.1)
    sf = bk.body_font(locale, int(W*0.030))
    bk.draw_para(img, sub, sf, bk._hex(bk.CHAR),
                 box=(int(W*0.12), int(H*0.12)+u+int(H*0.015), int(W*0.76), int(H*0.12)),
                 locale=locale, align="center", line_gap=1.3)
    # style-1 label under the frame
    d = ImageDraw.Draw(img)
    lf = bk.head_font(locale, int(W*0.044))
    lw = bk.line_w(d, f"{C.TAG['style'][locale]} 1/6 · {label}", lf, locale)
    s = f"{C.TAG['style'][locale]} 1/6 · {label}"
    d.text(((W-lw)//2, int(H*0.40)+fr.height+int(H*0.015)), s, font=lf,
           fill=bk._hex(bk.INK), direction=bk._dir(locale), language=bk._lang(locale))
    sw = bk.sans_font(locale, int(W*0.026))
    sws = C.TAG["swipe"][locale]
    sww = bk.line_w(d, sws, sw, locale)
    d.text(((W-sww)//2, int(H*0.93)), sws, font=sw, fill=bk._hex(bk.TERRA),
           direction=bk._dir(locale), language=bk._lang(locale))
    return img

def quote_slide_finale(quote, locale):
    W, H = 1080, 1350
    img = bk.canvas(W, H, bk.INK).convert("RGBA")
    kicker(img, C.TAG["example_short"][locale], locale, int(H*0.14), color=bk.GOLD_HI)
    qf = bk.head_font("en", int(W*0.18))
    ImageDraw.Draw(img).text((int(W*0.1), int(H*0.19)), "“", font=qf, fill=bk._hex(bk.GOLD))
    hf = bk.head_font(locale, int(W*0.056))
    bk.draw_para(img, quote, hf, bk._hex(bk.PARCH),
                 box=(int(W*0.11), int(H*0.34), int(W*0.78), int(H*0.4)),
                 locale=locale, align="center", line_gap=1.25)
    footer(img, locale, dark=True, url=False)
    return img

def reasons_end_slide(line, locale):
    W, H = 1080, 1350
    img = bk.canvas(W, H, bk.PARCH).convert("RGBA")
    still = bk.load_capture(locale, "reasons-i-love-you.jpg")
    ph = bk.phone_mockup(still, screen_h=int(H*0.5))
    ph = bk.fit(ph, int(W*0.5), int(H*0.54))
    bk.paste_with_shadow(img, ph, ((W-ph.width)//2, int(H*0.1)), radius=28, alpha=50)
    hf = bk.head_font(locale, int(W*0.052))
    u = bk.draw_para(img, line, hf, bk._hex(bk.INK),
                     box=(int(W*0.1), int(H*0.68), int(W*0.8), int(H*0.16)),
                     locale=locale, align="center", line_gap=1.2)
    footer(img, locale, dark=False)
    return img

if __name__ == "__main__":
    locs = sys.argv[1:] or list(C.LOCALES)
    for loc in locs:
        build(loc)
        print("built", loc)
    import json
    (ROOT / "_build" / "image_manifest.json").write_text(
        json.dumps(MANIFEST, ensure_ascii=False, indent=1))
    print("TOTAL images:", len(MANIFEST))
