# Product Catalog — Love Story Timeline

The one product with a complete build: finished renderer, finished
commerce flow, real pricing. ("Where We Met" / `heart-map` exists in the
catalog with a working renderer but predates every later architecture
pass — treat it as present, not maintained.)

## What the customer fills in

Organized into four sidebar sections (this grouping is itself a fix — it
used to be one undifferentiated block of nine fields):

**Whose Story**
- Story type: couple / family / parents / gift — chosen first, since it
  changes labels and duration phrasing everywhere else
- 1–2 names

**Story Text**
- Title, subtitle, dedication, closing line — all optional except a
  sensible per-story-type default is pre-filled

**Music**
- One preset from a closed list of 5 (including "No music") — see
  `music-presets.ts`. **No actual audio files exist yet.**

**Story Options**
- Show duration ("N days together" — suppressed for family/parents
  stories, where it reads as a mistake)
- Auto-sort milestones by date

**Milestones** (3–8 required)
- Date, title, description (all required except description)
- **Location**: Mapbox-backed search, not free text. Stores
  `{ name, lat, lng, mapboxId? }` — the poster only ever displays `name`;
  the coordinates exist for AR and future use. A milestone saved before
  this field existed still opens fine as a plain string.
- Photo (required), optional short video, optional voice note

**Appearance** (separate from the form schema — its own picker)
- Palette: color treatment only, five options
- Story Style (internally still called "layout" — the customer label
  changed, the data key didn't, to avoid touching the renderer/backend/
  tests for a copy change): six real compositions —
  Neat Stack, Alternating Tilt, Overlapping Cascade, Dotted Branching,
  Horizontal Polaroid (landscape), Horizontal Circles (landscape)
- Text scale: a range slider, 70–130%

## What's NOT a customer choice (and why)

- **Frame style** — one fixed default for edged prints; customers used to
  choose from 5 styles, removed as a deliberate product decision
- **Print format / canvas shape** — derives from the selected
  composition's own orientation
- **Export dimensions** — a full customer-facing list of print sizes,
  wallpaper sizes etc. was removed entirely; the delivery pack determines
  outputs, not a manual selector
- **Premium add-on** (Spotify code / coordinates / moon phase) — removed
  completely, including its pricing rule, across both frontend and
  backend; it never shipped as part of the real product

## The five compositions that took real design work

Each exists as CSS (the live Studio preview) *and* Pillow (the actual
rendered file), with a parity test suite proving the two produce
numerically identical layouts. Two are landscape (Horizontal Polaroid,
Horizontal Circles); the rest are portrait.

## Delivery packs (the actual purchasable products)

**Architecture: one `Order` has exactly one `DeliveryPack`. No line
items.** A "combo" pack (e.g. Printable + Wallpapers) is a single,
distinct `DeliveryPack` row whose `included_targets` is the real union of
its two source packs' targets — computed by the seeding/migration SQL,
never hand-typed.

| Pack (customer-facing name) | DB slug | Price | Status |
|---|---|---|---|
| Printable | `printable` | $17.99 | Active |
| Printable + Wallpapers | `printable-plus-wallpaper` | $21.99 | Active |
| Digital | `live` | $10.99 | Active |
| Digital + Wallpapers | `digital-plus-wallpaper` | $14.99 | Active |
| Complete | `complete` | $29.99 | Active |
| *(retired)* Wallpapers alone | `wallpaper` | $8.00 | **Disabled** |

Notes that matter if you're touching this:

- **"Digital" is displayed to the customer; the DB slug is still `live`.**
  Deliberate — renaming the slug would touch the renderer, the Python
  compositions module, `delivery_types.py`'s target mapping, and every
  test keyed on it, for a copy change with zero functional benefit. If
  you ever do need to derive a combo-pack slug from a base slug
  programmatically, this is the one place a naive `${slug}-plus-wallpaper`
  string join breaks — the real combo slug is `digital-plus-wallpaper`,
  not `live-plus-wallpaper`.
- **`wallpaper` is disabled, not deleted.** `create_order` refuses a
  disabled pack at the point of purchase regardless of how the request
  arrives — the storefront never lists it, but a stale bookmark or a
  direct API call gets the identical refusal. Confirmed in code, not
  assumed.
- **Complete does NOT include AR.** No AR `DeliveryPack` row exists at
  all yet. Adding AR to Complete, or creating AR-specific packs, is an
  explicit future decision, not something to infer from "Complete means
  everything."
- **Wallpaper is never sold standalone in the UI**, only as a checkbox on
  Printable or Digital that swaps the *selected pack* between the base
  and combo version — it never adds a second item to the order.

## What each pack actually delivers

- **Printable** — print-ready files at 3 sizes, each in both frameless
  and edged (bordered) variants
- **Digital** — the interactive `/live/<id>` page: scroll-triggered
  milestones, optional background music (once real tracks exist),
  video/audio playback per milestone
- **Wallpapers** (as an add-on to Printable or Digital) — phone, tablet,
  and desktop-sized renders, each respecting that device's safe zones
  (clock, home indicator, dock)
- **Complete** — everything above, bundled

## Commerce flow

```
Configure story (Studio)
      ↓
Choose a delivery pack (three primary cards: Printable / Digital /
Complete, each optionally with the wallpaper checkbox where it applies)
      ↓
Price shown — always the real DeliveryPack.price_cents, never computed
in the browser
      ↓
Checkout via Paddle (or the mock provider in dev)
      ↓
Paddle webhook confirms payment — the ONLY thing that marks an order paid
      ↓
Entitlements granted, one per included_target; provisional video/audio
assets promoted to permanent storage if the pack actually needs them
```

An audit of this entire flow (in `PROJECT-STATE.md` §1) found it already
matched this model — no rewrite was needed, only verification.
