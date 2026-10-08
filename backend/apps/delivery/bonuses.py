"""Bonus deliverables layered onto a purchase (§18).

Four additions, each attached by a different rule:

  a. a thank-you card — every purchase, every pack
  b. printing advice — Printable Pack only
  c. the printable images also as PDF — Printable Pack only
  d. a QR code to the live page — whenever the pack grants `__live__`

WHY THESE ARE COMPUTED, NOT STORED AS ENTITLEMENTS
---------------------------------------------------
An `Entitlement` is a row recorded at purchase, and it is what proves a
customer may download a given target. Bonuses are not bought — they are
consequences of what was bought. Deriving them from the pack means a change
to what a bonus is applies to every past order too, and it keeps the
entitlement table meaning exactly one thing.

`bonus_targets_for_order` is the single place that decides. Everything else
asks it, so the rules cannot drift between the download endpoint and
whatever else needs to know.

THE PDF SITUATION, WHICH REVERSES AN EARLIER STATE
---------------------------------------------------
Until §18, nothing in this project produced a PDF, and the site copy was
corrected in §16 to stop claiming otherwise — there is a test asserting no
locale mentions one. §18c changes that: printable images are now delivered
as PDF *in addition to* PNG, because print shops commonly prefer it. The
copy may say PDF again, and it will be true. The guard should be narrowed to
the claims that are still false, not removed.
"""

from __future__ import annotations

import io
from pathlib import Path

import qrcode
from django.conf import settings
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from apps.commerce.order_access import generate_order_access_token
from apps.delivery.print_sizes import PRINT_DPI

#: Synthetic target ids. Prefixed `bonus-` so they can never collide with a
#: real render target, and so `infer_delivery_type` — which classifies on
#: `print-`, `story-`, `wallpaper-` — does not mistake one for a purchase.
BONUS_THANK_YOU = "bonus-thank-you"
BONUS_PRINT_ADVICE = "bonus-printing-advice"
BONUS_QR = "bonus-live-qr"

LIVE_TARGET_ID = "__live__"


def bonus_targets_for_order(order) -> list[str]:
    """Which bonuses this order earns (§18).

    Reads the pack's `included_targets` rather than the pack slug. A slug is
    a name someone chose; the targets are what the customer actually
    receives, so a renamed or newly added pack gets the right bonuses
    without anyone remembering to update a list here.
    """
    targets = list(order.delivery_pack.included_targets or [])

    # (a) Every purchase, every pack.
    bonuses = [BONUS_THANK_YOU]

    # (b) Printing advice, only where something is actually printed.
    if any(target.startswith("print-") for target in targets):
        bonuses.append(BONUS_PRINT_ADVICE)

    # (d) A QR code is only meaningful if there is a live page to point at.
    if LIVE_TARGET_ID in targets:
        bonuses.append(BONUS_QR)

    return bonuses


def pdf_targets_for_order(order) -> list[str]:
    """§18c — printable images delivered as PDF as well as PNG.

    Returns the print target ids that should also be emitted as PDF.
    Wallpapers are deliberately excluded: §18c scopes this to the Printable
    Pack, and nobody takes a phone wallpaper to a print shop.
    """
    targets = list(order.delivery_pack.included_targets or [])
    return [target for target in targets if target.startswith("print-")]


def png_to_pdf(png_bytes: bytes, *, width_px: int, height_px: int) -> bytes:
    """Wraps a rendered PNG in a PDF at its true physical size (§18c).

    The page is sized from the pixel dimensions at 300dpi rather than forced
    onto A4. A print shop opening this gets a document whose page *is* the
    artwork — no scaling decision to make, no white margin someone has to
    guess about. Forcing A4 would silently resize a 12x18 poster.

    Pillow could produce this, but it would embed the image without control
    over the page box; reportlab places it exactly.
    """
    from reportlab.lib.utils import ImageReader

    width_pt = width_px / PRINT_DPI * 72.0
    height_pt = height_px / PRINT_DPI * 72.0

    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(width_pt, height_pt))
    pdf.drawImage(
        ImageReader(io.BytesIO(png_bytes)),
        0,
        0,
        width=width_pt,
        height=height_pt,
        preserveAspectRatio=False,
    )
    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def _order_access_url(order) -> str:
    """The order's own magic link — what the BUYER's QR encodes.

    Built from the same token as the §12 receipt, so scanning on a phone
    that has never seen the site still opens the order. A QR pointing at a
    URL that then demands a session cookie is a QR that does not work,
    which is worse than no QR.

    RENAMED from `_live_url` — that name was wrong for what this function
    actually builds (the order page, not the live keepsake) and became
    actively misleading once `_recipient_live_url` below needed to exist
    beside it: two functions in one file, only one of which should mean
    "live," cannot both be called `_live_url`.
    """
    # §12 — the token is a PATH segment now, not `?token=`; see `withToken`
    # in the frontend's lib/api/client.ts for why.
    token = generate_order_access_token(order.id)
    return f"{settings.FRONTEND_URL}/{order.locale}/orders/{order.id}/{token}"


def _recipient_live_url(order) -> str:
    """The live keepsake's own permanent link — what the RECIPIENT's QR
    encodes, pointing straight at the experience instead of at the order.

    NO SIGNED TOKEN HERE, and that is correct rather than an oversight:
    `/live/<id>/` is backed by `PublicExperience`, whose id is ALREADY the
    full access credential by design (§21f/§10 — see that model's own
    docstring) — a permanent, unguessable, revocable bearer id, not a
    session- or expiry-gated one like the order page's. Layering
    `_order_access_url`'s signed-token mechanism on top here would be
    solving a problem this URL doesn't have.

    Resolves through `entitlement.public_experience`, the SAME row
    `get_delivery_for_entitlement`'s digital-delivery branch and the order
    page's "open your live page" link already use — not a second,
    independently-computed URL for the same experience.
    """
    from apps.commerce.models import Entitlement
    from apps.delivery.models import PublicExperience

    try:
        entitlement = order.entitlements.get(target_id=LIVE_TARGET_ID)
        experience = entitlement.public_experience
    except (Entitlement.DoesNotExist, PublicExperience.DoesNotExist):
        experience = None

    if experience is None or experience.status != PublicExperience.STATUS_ACTIVE:
        # Same situation `get_delivery_for_entitlement` already guards
        # against: provisioning failed, or the link was revoked. Every
        # caller here has already confirmed `BONUS_QR in
        # bonus_targets_for_order(order)` before reaching this function,
        # so this should not normally happen — handled anyway rather than
        # trusting that invariant silently.
        from apps.common.exceptions.api_errors import RendererNotAvailable

        raise RendererNotAvailable("The live keepsake for this order is not available.")

    return f"{settings.FRONTEND_URL}/{order.locale}/live/{experience.id}"


def _qr_caption_for_order(order) -> str | None:
    """The names/title to print on a QR card instead of the generic
    caption — just the names themselves (e.g. "Emma & James"), never a
    templated sentence: the card's surrounding text already carries the
    invitation framing, so this is the one piece that is genuinely
    per-order.

    NO i18n KEY FOR THIS STRING, deliberately, the same way
    `join_names()` never translates the names it joins: the return value
    IS the buyer's own entered data (proper nouns), not UI copy — there is
    nothing here for a translation dictionary to own. Every OTHER string
    in this file (the default caption, "HEARTFOLIO", the thank-you and
    printing-advice PDF copy) is hardcoded English with no i18n at all —
    confirmed there is no `gettext`/translation mechanism anywhere in this
    Django backend. Returning `None` here (which falls back to that same
    pre-existing default caption, unchanged) rather than inventing a new
    hardcoded English sentence is what keeps this consistent with that.

    Reads `project.data` the same defensive way `_build_ar_payload`
    already does: `validate_and_normalize`, caught, falling back to `None`
    (→ the generic caption) rather than letting a malformed or
    in-progress project break a bonus download.
    """
    project = order.project
    if project is None or order.product is None:
        return None

    slug = order.product.slug
    values = (project.data or {}).get("values", {})
    theme_selections = (project.data or {}).get("themeSelections", {})

    if slug == "love-story-timeline":
        from apps.delivery.product_renderers.love_story_timeline.data import join_names, validate_and_normalize

        try:
            timeline = validate_and_normalize(values, theme_selections)
        except Exception:  # noqa: BLE001
            return None
        return timeline.poster_title or (join_names(timeline.people, order.locale) if timeline.people else None)

    if slug == "song-poster":
        from apps.delivery.product_renderers.song_poster.data import validate_and_normalize as validate_song

        try:
            song = validate_song(values, theme_selections)
        except Exception:  # noqa: BLE001
            return None
        if song.artist and song.track:
            return f"{song.artist} — {song.track}"
        return song.track or song.artist or None

    # No other product grants `__live__` today (confirmed against the
    # catalog's own delivery packs), so no other branch exists yet. A
    # future product without one here simply gets the generic caption —
    # the same safe default every exception path above already falls
    # back to.
    return None


def _qr_matrix(url: str):
    """The raw QR as a PIL image, no styling.

    High error correction throughout: these are printed, photographed and
    scanned off paper, where a fingerprint or a fold destroys part of the
    symbol. It also buys the headroom that lets a card put a logo near the
    centre without breaking the scan.
    """
    code = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H, box_size=12, border=2)
    code.add_data(url)
    code.make(fit=True)
    return code.make_image(fill_color="black", back_color="white").convert("RGB")


def _mark_on(draw, x: float, y: float, size: float, *, rose, bronze, spark) -> None:
    """The Heartfolio mark, drawn with Pillow primitives.

    A third port of the same geometry — SVG for the web, reportlab paths
    for the PDFs, and this. Duplicated rather than shared because each
    drawing API takes different primitives, and an abstraction over three
    of them would be harder to read than three short functions. If the mark
    changes, all three change; that is the cost, and it is written down
    here so it is not a surprise.
    """
    k = size / 64.0
    w = max(2, int(5 * k))

    def pt(px, py):
        return (x + px * k, y + py * k)

    # Lobes as arcs, flanks as lines — Pillow has no path primitive, so the
    # curve is an arc on a bounding box rather than a cubic.
    draw.arc([*pt(14, 12), *pt(32, 31.5)], start=180, end=360, fill=rose, width=w)
    draw.arc([*pt(32, 12), *pt(50, 31.5)], start=180, end=360, fill=bronze, width=w)
    draw.line([*pt(14, 26), *pt(32, 50)], fill=rose, width=w)
    draw.line([*pt(50, 26), *pt(32, 50)], fill=bronze, width=w)
    draw.line([*pt(41, 23), *pt(23, 40.5)], fill=bronze, width=w)
    draw.line([*pt(23, 23), *pt(41, 40.5)], fill=rose, width=w)

    star = [(51, 7), (52.8, 13.2), (59, 15), (52.8, 16.8), (51, 23), (49.2, 16.8), (43, 15), (49.2, 13.2)]
    draw.polygon([pt(*p) for p in star], fill=spark)


def _recolour_qr(matrix, dark, light):
    """Repaints a black/white QR into two brand colours.

    Pixel-for-pixel, keeping the module edges crisp. Rounded "dots" were
    considered and rejected: rounding erodes the module corners, and with a
    long signed token in the payload the symbol is already dense. A scan
    that fails is not a nicer QR.
    """
    from PIL import Image

    out = Image.new("RGB", matrix.size, light)
    pixels = matrix.load()
    target = out.load()
    for yy in range(matrix.size[1]):
        for xx in range(matrix.size[0]):
            if pixels[xx, yy][0] < 128:
                target[xx, yy] = dark
    return out


#: The card designs. The FIRST is the default — the one shown on the order
#: page and sent in the email; the rest ship in the zip as alternates, for
#: someone who wants the QR on a fridge, in a frame, or beside a gift.
QR_CARD_VARIANTS = ("dark", "cream", "tag")


def render_live_qr_card(order, variant: str = "dark", *, caption: str | None = None) -> bytes:
    """§18d — the BUYER's QR, as a designed card: scanning it opens the
    order page (downloads, order status) — theirs to keep.

    WHY A CARD AND NOT A BARE SYMBOL. The old output was an unlabelled
    black square in a zip. Nobody scans an unlabelled QR: it carries no
    promise about where it goes, and in a keepsake — which is usually given
    to someone else — that matters more than usual. A card says whose it is
    and what happens when you scan it.
    """
    return _render_qr_card(_order_access_url(order), variant, caption=caption or _qr_caption_for_order(order))


def render_recipient_qr_card(order, variant: str = "dark", *, caption: str | None = None) -> bytes:
    """The RECIPIENT's QR, as the same designed card — scanning it opens
    the live keepsake directly, not the order/payment page. Meant to be
    handed to the gift recipient, who has no reason to see the buyer's
    receipt or downloads.

    A SEPARATE, PARALLEL CARD rather than a fourth `QR_CARD_VARIANT`: a
    "variant" here is a design choice (dark/cream/tag), all pointing at
    the same URL for the same audience. This differs in AUDIENCE and
    DESTINATION, not design — mixing it into `QR_CARD_VARIANTS` would make
    "which of these four do I want" a question with no good answer for
    either the buyer or the recipient.
    """
    return _render_qr_card(_recipient_live_url(order), variant, caption=caption or _qr_caption_for_order(order))


def _render_qr_card(url: str, variant: str, *, caption: str | None = None) -> bytes:
    """The shared card drawing body behind both `render_live_qr_card` and
    `render_recipient_qr_card` — identical design, differing only in which
    URL the symbol encodes and what caption is printed under it."""
    from PIL import Image, ImageDraw

    matrix = _qr_matrix(url)

    ink = (20, 27, 46)
    cream = (247, 241, 230)
    rose = (235, 176, 166)
    bronze = (197, 133, 79)
    spark = (246, 204, 146)

    if variant == "cream":
        bg, fg, sub, qr_dark, qr_light = cream, ink, (110, 105, 96), ink, cream
        size = (1000, 1300)
    elif variant == "tag":
        bg, fg, sub, qr_dark, qr_light = ink, cream, rose, ink, cream
        size = (800, 1200)
    else:
        bg, fg, sub, qr_dark, qr_light = ink, cream, (186, 180, 172), ink, cream
        size = (1000, 1300)

    card = Image.new("RGB", size, bg)
    draw = ImageDraw.Draw(card)

    # The QR sits on its own light plate in every variant. A QR printed
    # directly onto a dark card inverts the symbol, and many phone cameras
    # will not read an inverted code at all.
    plate = int(size[0] * 0.62)
    qr = matrix.resize((plate, plate), Image.NEAREST)
    if (qr_dark, qr_light) != ((0, 0, 0), (255, 255, 255)):
        qr = _recolour_qr(qr, qr_dark, qr_light)

    qx = (size[0] - plate) // 2
    qy = int(size[1] * 0.30)
    pad = int(plate * 0.06)
    draw.rounded_rectangle(
        [qx - pad, qy - pad, qx + plate + pad, qy + plate + pad],
        radius=int(plate * 0.05),
        fill=qr_light,
    )
    card.paste(qr, (qx, qy))

    _mark_on(draw, (size[0] - size[0] * 0.16) / 2, size[1] * 0.07, size[0] * 0.16,
             rose=rose, bronze=bronze, spark=spark)

    # Text is drawn with Pillow's default bitmap font, scaled by drawing
    # into a larger box, because the container has no guaranteed TTF and a
    # missing font file would fail the whole bonus rather than one line.
    # Positioned FROM THE PLATE rather than at a fixed fraction of the
    # card: the plate's height depends on the card width, so a hardcoded
    # caption position collided with it on the taller variants.
    plate_bottom = qy + plate + pad
    words = caption or "Scan to open your keepsake"
    _centred(draw, words, size[0], plate_bottom + int(size[1] * 0.045),
             fg, _card_font("DejaVuSerif.ttf", int(size[0] * 0.042)))
    _centred(draw, "HEARTFOLIO", size[0], plate_bottom + int(size[1] * 0.105),
             sub, _card_font("DejaVuSans.ttf", int(size[0] * 0.024)))

    buffer = io.BytesIO()
    card.save(buffer, format="PNG")
    return buffer.getvalue()


#: The product already ships DejaVu with the poster renderer, so the cards
#: use the same faces rather than Pillow's default bitmap font — which has
#: no kerning, cannot be sized, and turned "Scan to open" into "Scan toopen".
_CARD_FONT_DIR = (
    Path(__file__).parent / "product_renderers" / "love_story_timeline" / "fonts"
)


def _card_font(name: str, size: int):
    from PIL import ImageFont

    try:
        return ImageFont.truetype(str(_CARD_FONT_DIR / name), size=size)
    except OSError:
        # A missing font must not fail the whole bonus: the card is worth
        # more with a plain face than not at all.
        return ImageFont.load_default()


def _centred(draw, text: str, width: int, y: int, fill, font) -> None:
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    draw.text(((width - (right - left)) / 2 - left, y - top), text, fill=fill, font=font)


def render_live_qr(order) -> bytes:
    """Backwards-compatible entry point: the default card."""
    return render_live_qr_card(order, QR_CARD_VARIANTS[0])


# ---------------------------------------------------------------------
# Static documents
# ---------------------------------------------------------------------

#: The brand palette, as used on the storefront. Kept here as literals
#: rather than imported from settings: these are design constants, and a
#: PDF whose colours could be changed by an environment variable is a PDF
#: nobody can reason about.
_INK = (0.078, 0.106, 0.180)        # #141B2E — the plate the mark sits on
_INK_SOFT = (0.125, 0.157, 0.235)   # one step up, for rules and panels
_ROSE = (0.922, 0.690, 0.651)       # #EBB0A6
_BRONZE = (0.773, 0.522, 0.310)     # #C5854F
_CREAM = (0.969, 0.945, 0.902)      # body text on dark
_CREAM_DIM = (0.729, 0.706, 0.675)  # secondary text


def _draw_mark(pdf: canvas.Canvas, x: float, y: float, size: float) -> None:
    """Draws the Heartfolio mark, vector, at (x, y) with `size` as its width.

    The same geometry as `icon.svg`, in PDF units. Hand-ported rather than
    embedding the SVG because reportlab cannot place an SVG without an extra
    dependency, and a raster logo in a 300 DPI print document would be the
    one soft thing on an otherwise sharp page.

    TWO-TONE RATHER THAN A GRADIENT. PDF gradients require clipping each
    stroke to its own shading pattern, which triples the code for something
    nobody can see at 14mm. The left bands take rose, the right take bronze,
    which reads as the same warm shift at this size.
    """
    scale = size / 64.0

    def at(px: float, py: float) -> tuple[float, float]:
        # SVG's y grows downward, PDF's grows upward.
        return (x + px * scale, y + (64 - py) * scale)

    pdf.saveState()
    pdf.setLineWidth(5 * scale)
    pdf.setLineCap(1)   # round
    pdf.setLineJoin(1)

    # Left lobe and flank.
    pdf.setStrokeColorRGB(*_ROSE)
    path = pdf.beginPath()
    path.moveTo(*at(32, 22))
    # Cubic approximation of the SVG arc. The control points bulge up and
    # out, which is what gives the lobe its shoulder; pulling them toward
    # the endpoints (an easy mistake) flattens the heart into a chevron.
    path.curveTo(*at(24, 17.5), *at(14, 21), *at(14, 31.5))
    path.lineTo(*at(32, 50))
    pdf.drawPath(path)

    # The band that passes over.
    pdf.setStrokeColorRGB(*_BRONZE)
    path = pdf.beginPath()
    path.moveTo(*at(41, 23))
    path.lineTo(*at(23, 40.5))
    pdf.drawPath(path)

    # The band that passes under.
    pdf.setStrokeColorRGB(*_ROSE)
    path = pdf.beginPath()
    path.moveTo(*at(23, 23))
    path.lineTo(*at(41, 40.5))
    pdf.drawPath(path)

    # Right lobe and flank.
    pdf.setStrokeColorRGB(*_BRONZE)
    path = pdf.beginPath()
    path.moveTo(*at(32, 22))
    path.curveTo(*at(40, 17.5), *at(50, 21), *at(50, 31.5))
    path.lineTo(*at(32, 50))
    pdf.drawPath(path)

    # Sparkle, filled.
    pdf.setFillColorRGB(0.965, 0.800, 0.573)
    star = pdf.beginPath()
    points = [(51, 7), (52.8, 13.2), (59, 15), (52.8, 16.8), (51, 23), (49.2, 16.8), (43, 15), (49.2, 13.2)]
    star.moveTo(*at(*points[0]))
    for point in points[1:]:
        star.lineTo(*at(*point))
    star.close()
    pdf.drawPath(star, stroke=0, fill=1)

    pdf.restoreState()


def _text_pdf(title: str, blocks: list[tuple[str, list[str]]], *, closing: str | None = None) -> bytes:
    """A dark, branded A4 document.

    WAS PLAIN, NOW DESIGNED. The earlier version was deliberately
    typographic — the reasoning being that an unstyled sheet which prints
    correctly beats a branded one that does not. That held while there was
    no brand to apply; now there is, and these are the only two documents a
    customer receives from us directly rather than as artwork.

    PRINTING A DARK PAGE COSTS INK. Accepted for the thank-you card, which
    is a card. Worth knowing for the printing-advice sheet, which some
    people will send to a printer — it is readable either way, but it is not
    an economical page to print.
    """
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    left = 22 * mm
    right = width - 22 * mm

    def new_page() -> float:
        # Full-bleed background first, everything else on top of it.
        pdf.setFillColorRGB(*_INK)
        pdf.rect(0, 0, width, height, stroke=0, fill=1)
        return height - 30 * mm

    y = new_page()

    _draw_mark(pdf, left, y - 6 * mm, 14 * mm)

    pdf.setFillColorRGB(*_CREAM)
    pdf.setFont("Helvetica-Bold", 19)
    pdf.drawString(left + 19 * mm, y + 1 * mm, title)

    # A hairline in bronze under the header, the one piece of ornament.
    y -= 12 * mm
    pdf.setStrokeColorRGB(*_BRONZE)
    pdf.setLineWidth(0.6)
    pdf.line(left, y, right, y)
    y -= 12 * mm

    for heading, lines in blocks:
        if y < 45 * mm:
            pdf.showPage()
            y = new_page()

        if heading:
            pdf.setFillColorRGB(*_ROSE)
            pdf.setFont("Helvetica-Bold", 12)
            pdf.drawString(left, y, heading)
            y -= 7.5 * mm

        pdf.setFont("Helvetica", 10.5)
        for line in lines:
            if y < 28 * mm:
                pdf.showPage()
                y = new_page()
                pdf.setFont("Helvetica", 10.5)
            # An empty string is a deliberate paragraph break, not a bullet.
            pdf.setFillColorRGB(*_CREAM if line else _CREAM_DIM)
            pdf.drawString(left, y, line)
            y -= 5.8 * mm
        y -= 6 * mm

    if closing:
        if y < 40 * mm:
            pdf.showPage()
            y = new_page()
        pdf.setFillColorRGB(*_BRONZE)
        pdf.setFont("Helvetica-Oblique", 11)
        pdf.drawString(left, y, closing)

    # Footer wordmark, same on every page-final render.
    pdf.setFillColorRGB(*_CREAM_DIM)
    pdf.setFont("Helvetica", 8)
    pdf.drawString(left, 16 * mm, "HEARTFOLIO")
    pdf.setFillColorRGB(*_INK_SOFT)
    pdf.setStrokeColorRGB(*_INK_SOFT)

    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def render_printing_advice_pdf() -> bytes:
    """§18b — one combined sheet covering BOTH print methods.

    §18b is explicit that this is a single PDF covering both, because after
    §3 the two variants need genuinely different instructions: the frameless
    file is for glass or acrylic mounting, the edged one for an ordinary
    frame. Splitting them into two documents would mean a customer who
    bought both received two sheets that each looked like the whole answer.
    """
    return _text_pdf(
        "How to print your keepsake",
        [
            (
                "You received two versions of every size",
                [
                    "Frameless - the artwork runs to the edge of the paper, with no border.",
                    "With edges - the artwork sits inside a half-inch margin.",
                    "",
                    "They are different files, not the same file cropped. Use whichever",
                    "matches how you intend to display it.",
                ],
            ),
            (
                "The frameless version - glass or acrylic mounting",
                [
                    "Ask a print shop for an acrylic mount, a glass print, or a face-mount.",
                    "Say the artwork is full-bleed and must not be trimmed or scaled.",
                    "These are pressed under or behind the surface, so nothing overlaps the",
                    "print - which is why this version has no margin to lose.",
                ],
            ),
            (
                "The with-edges version - an ordinary picture frame",
                [
                    "Any print shop, or a home printer, on 200-250gsm matte or satin paper.",
                    "Matte hides fingerprints and reflections; satin gives deeper colour.",
                    "The half-inch margin is there so the frame's lip cannot cover any part",
                    "of the design. Do not trim it off.",
                    "Choose the frame size matching the file: A4 or A3, 8x10 or 16x20,",
                    "12x18 or 24x36.",
                ],
            ),
            (
                "A few things worth knowing",
                [
                    "Every file is 300 DPI, which is full photographic print quality.",
                    "The larger size of each pair is the same file printed bigger - a poster",
                    "at 24x36 lands around 150 DPI, which is normal at that viewing distance.",
                    "Ask for no auto-enhance, no auto-crop and no colour correction. The",
                    "colours were chosen deliberately.",
                    "Both PNG and PDF are included. Most print shops prefer the PDF.",
                ],
            ),
        ],
    )


def render_thank_you_card() -> bytes:
    """§18a — the same card for everyone, not rendered per customer.

    NO LONGER A PLACEHOLDER. This was a plain typographic stand-in while
    there was no brand to apply. It now carries the real mark, the brand
    palette and the dark treatment used across the product, so §18a is
    satisfied by generated output rather than waiting on a designed file.

    Still generated rather than a static asset, deliberately: a PDF built
    here stays in step with wording that has to remain true — the promise
    about access below was wrong once already, and a static file would have
    kept being wrong.
    """
    return _text_pdf(
        "Thank you.",
        [
            (
                "",
                [
                    "Someone made something for someone else, and that is the whole",
                    "point of this. Thank you for letting us be part of it.",
                    "",
                    # WORDING CORRECTED. This used to promise files were yours
                    # "to re-download for as long as you want", which is not
                    # something the product can keep: there are no accounts,
                    # and the link in the receipt expires after 30 days. The
                    # files themselves do last — photos never expire and the
                    # artwork is re-rendered on demand — so the honest version
                    # promises the files and names the way back to them.
                    "Your files are yours. Keep them somewhere safe, and print",
                    "them whenever you like.",
                    "",
                    "The link in your receipt opens your order on any device for",
                    "30 days. If it ever stops working, reply to that email and",
                    "we will send you a fresh one.",
                ],
            )
        ],
        closing="- Heartfolio",
    )
