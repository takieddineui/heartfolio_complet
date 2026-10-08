"""Which AR variants each product supports, and which scene it runs (§21b, §21c).

TWO THINGS THAT BELONG TOGETHER
--------------------------------
§21b requires **explicit per-product opt-in**: a product lists which AR
variants it supports, 0 to 3, with no global flag. §21c requires the AR
scene behaviour to be a **product module constant** — the module decides
which scene runs, the way it already decides its PNG layout, and the
customer chooses personalization but never which behaviour executes.

Both are per-product declarations about AR, so both live here rather than
being scattered between the admin, the renderer and the frontend.

THE VARIANTS
------------
  ar-card    A physical card we produce and the customer prints. The scene
             anchors to the printed card via image tracking.
  ar-screen  No printed object. Viewed on the phone directly.
  ar-print   The customer's own printed poster becomes the marker.
             RESERVED ONLY (§21j) — the target string exists so the catalog
             needs no redesign later, but no product supports it and the
             generation pipeline does not exist. See `AR-VR-SCOPING.md` for
             why that pipeline is not trivial.

WHY THIS IS NOT IN THE PNG RENDERER'S TARGET LIST
--------------------------------------------------
`apps/products/admin.py` validates a pack's `included_targets` against what
the product's renderer can produce, which is what stops an undeliverable
target being sold. AR is served by its own endpoint, not by the PNG or HTML
renderers — so an AR target is legitimately absent from those lists and the
guard was correctly rejecting it.

The fix is not to loosen the guard. It is to tell the guard that AR targets
are delivered by a different route and which products opt into them, which
is what this module does.
"""

from __future__ import annotations

from dataclasses import dataclass

AR_CARD = "ar-card"
AR_SCREEN = "ar-screen"
#: Reserved, unsupported by every product. See §21j.
AR_PRINT = "ar-print"

ALL_AR_TARGETS = (AR_CARD, AR_SCREEN, AR_PRINT)

#: Per-product opt-in (§21b). A product absent from this map supports no AR
#: at all, which is the correct default — AR requires a designed scene and a
#: tracking target, neither of which a product gets for free.
PRODUCT_AR_TARGETS: dict[str, set[str]] = {
    "love-story-timeline": {AR_CARD, AR_SCREEN},
    # Where We Met is withdrawn from the storefront (§1) and has no AR scene.
    "heart-map": set(),
}

#: Which scene a product runs (§21c).
#:
#: A module constant, not a customer choice and not a Studio input. The
#: customer personalizes; the product decides what the personalization
#: *does*. Sent to the client in the AR payload so the scene is selected by
#: the product rather than inferred from the data it happens to contain —
#: inference would mean a timeline with no photos silently getting a
#: different experience from one with photos.
PRODUCT_AR_SCENE: dict[str, str] = {
    "love-story-timeline": "timeline-unfold",
}

#: The scene used when a product has none declared. Deliberately explicit
#: rather than falling back to whatever the first scene happens to be.
DEFAULT_AR_SCENE = "static-card"


#: §21i — the CARDS a product offers.
#:
#: A product may offer one, two or many. Love Story Timeline offers two: a
#: generic card whose artwork is the same for everyone, and one carrying the
#: customer's own timeline.
#:
#: `shared_target` is the distinction that matters, and it is an
#: infrastructure decision rather than a design one:
#:
#:   True  — one `.mind` file, compiled once from artwork we design and
#:           shipped with the app. Tracking quality is fully under our
#:           control, because we choose an image that is feature-rich.
#:   False — a `.mind` compiled per order from that customer's own card.
#:           Needs compilation off the request path (the `ar-print` problem
#:           in AR-VR-SCOPING.md), and tracking quality varies with their
#:           photographs and how much text their story carries.
#:
#: Cards are offered ONLY to a customer who bought an AR pack. They are not
#: a bonus and not part of the printable pack: a card with no experience
#: behind it is a piece of paper.


@dataclass(frozen=True)
class ARCard:
    id: str
    #: Resolved as `arCards.<i18nKey>.name` / `.description`.
    i18nKey: str
    #: See the note above — this decides whether a background worker is
    #: needed, not how the card looks.
    shared_target: bool


PRODUCT_AR_CARDS: dict[str, tuple[ARCard, ...]] = {
    "love-story-timeline": (
        ARCard(id="classic", i18nKey="classic", shared_target=True),
        ARCard(id="timeline", i18nKey="timeline", shared_target=False),
    ),
}


#: The printed AR card, in pixels at 300dpi. A5 — big enough to hold a
#: readable timeline and a scannable QR, small enough to sit in an envelope
#: or lean on a shelf.
CARD_TARGET_ID = "ar-card-artwork"
CARD_WIDTH_PX = 1748
CARD_HEIGHT_PX = 2480

#: Where the QR sits, as fractions of the card.
#:
#: Shared between the renderer, which leaves the block empty, and the
#: delivery layer, which composites the code into it. The renderer cannot
#: draw it: the QR encodes the ORDER's own experience URL, and a renderer
#: that knew about orders would be a renderer that could not be tested
#: without one.
CARD_MARGIN_RATIO = 0.07
CARD_QR_BLOCK_RATIO = 0.22


def ar_cards_for(product_slug: str) -> tuple[ARCard, ...]:
    """The cards this product offers. Empty for a product with no AR."""
    if not supported_ar_targets(product_slug):
        # A product that does not support AR offers no cards, regardless of
        # what this map happens to contain — the opt-in above is the single
        # source of whether AR exists for a product at all.
        return ()
    return PRODUCT_AR_CARDS.get(product_slug, ())


def cards_available_for_order(order) -> tuple[ARCard, ...]:
    """Cards offered for a purchase — AR packs only.

    Checked against the pack's targets rather than its name, like every
    other rule in this module. A customer who bought only prints is not
    offered a card for an experience they cannot open.
    """
    targets = list(order.delivery_pack.included_targets or [])
    if not any(target.startswith("ar-") for target in targets):
        return ()
    return ar_cards_for(order.product.slug if order.product else "")


#: §15 — experience levels, layered ON TOP of the surfaces above.
#:
#: These are a different axis from `ar-card` / `ar-screen`. A surface is
#: WHERE the experience happens; a level is HOW RICH it is. Conflating them
#: would have produced six targets meaning two things at once.
AR_LEVEL_BASIC = "basic"
AR_LEVEL_ENHANCED = "enhanced"
#: §15's "advanced / future" — 3D typography, floating photos, spatial
#: audio. Named so the vocabulary exists and nothing has to be renamed
#: later, and deliberately never returned: §15 says not to turn V1 into a
#: giant AR platform.
AR_LEVEL_ADVANCED = "advanced"


def ar_level_for(timeline) -> str:
    """Which level this particular story earns (§14, §15).

    DERIVED, NEVER CHOSEN. §14 is explicit that AR must remain valuable when
    the customer provides no video or audio, and that the core story alone
    is enough. So the level is a consequence of what they gave us, not a
    setting they pick or a tier they buy.

    That matters for what it rules out. If Enhanced were a purchasable
    upgrade, a customer could pay for it and receive Basic because they
    uploaded no media — and they would be right to complain. Deriving it
    means the experience is always exactly as rich as the story allows, and
    a customer who adds a voice note later gets more without buying
    anything.

    `advanced` is never returned. The vocabulary exists; the experience does
    not.
    """
    has_media = timeline.background_music_preset != "none" or any(
        event.video_asset_id or event.audio_asset_id for event in timeline.events
    )
    return AR_LEVEL_ENHANCED if has_media else AR_LEVEL_BASIC


#: §4 — mirrors `presetMusicUrl()` in music-presets.ts exactly. Both sides
#: compute the same `/audio/presets/<id>.mp3` path from the same id, so the
#: convention cannot drift between the two independent places that resolve
#: it: the Studio's in-editor Live preview (frontend) and the server-built
#: AR/Live payload (here).
def preset_music_url(preset_id: str) -> str | None:
    if not preset_id or preset_id == "none":
        return None
    return f"/audio/presets/{preset_id}.mp3"


def supported_ar_targets(product_slug: str) -> set[str]:
    return set(PRODUCT_AR_TARGETS.get(product_slug, set()))


def ar_scene_for(product_slug: str) -> str:
    return PRODUCT_AR_SCENE.get(product_slug, DEFAULT_AR_SCENE)


def is_ar_target(target_id: str) -> bool:
    return target_id.startswith("ar-")
