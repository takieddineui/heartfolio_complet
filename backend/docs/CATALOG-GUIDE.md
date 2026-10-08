# Catalog Guide

## How the catalog works

| Lives in | Owns |
|---|---|
| **Django** | Product existence, status, `starting_price_cents`, packs, `price_cents`, `currency`, `included_targets`. **The commercial source of truth.** |
| **Frontend registry** (`lib/products/registry.ts`) | Public slug, artwork, icon, i18n keys, display order, tags, FAQ count. **No prices** — the two launch products carry `offerings: []` deliberately. |
| **Paddle** | Nothing about the catalog. Transactions are *non-catalog*: the amount is sent per transaction from `DeliveryPack.price_cents`. There are no Paddle Price IDs. |

**The frontend cannot dictate price.** `POST /orders/` accepts only
`productId`, `deliveryPackId` and `projectId`. The server resolves the pack
(scoped to the product), reads `price_cents`, and computes the total, which
the database then re-checks with `total = subtotal - discount`. The webhook
independently reconciles Paddle's amount against the order before marking it
paid.

**Current production catalog: empty.** The rows below have not been entered.

---

# Launch Catalog Data Sheet

Everything you need to type into Django admin, field by field. Values are exact — copy them.

**Where:** `http://localhost:8000/admin/` on local Docker. (This used to be the Railway URL, which is gone; the production address will be the VPS's once it exists.)

---

## Before you start

Redeploy the backend first (it now includes `admin.py`, whitenoise, and `collectstatic` in the start command). Then create your login:

```
docker compose exec api python manage.py createsuperuser
```

That creates the user in whichever database the api container points at — with the real `.env.docker` that is the real one, so be sure that is what you want. (Railway, which this used to run through, is no longer used.) You'll be asked for a username, email and password. There is no other way in — the admin has no signup.

**Sanity check before entering anything:** open `/admin/` and confirm the page looks like a normal styled Django admin. If it renders as plain unstyled text, `collectstatic` didn't run — tell me rather than working around it.

---

## Step 1 — Products (2 rows)

Go to **Products → Products → Add product**.

### Row 1 — Love Story Timeline

| Field | Value |
|---|---|
| Slug | `love-story-timeline` |
| Name i18n key | `loveStoryTimeline` |
| Category | `timeline` |
| Status | `available` |
| Starting price cents | `800` |
| Order | `4` |
| Tags | `["timeline", "anniversary", "wedding", "photos"]` |

### Row 2 — Where We Met Map

| Field | Value |
|---|---|
| Slug | `heart-map` |
| Name i18n key | `whereWeMet` |
| Category | `map` |
| Status | `available` |
| Starting price cents | `800` |
| Order | `3` |
| Tags | `["map", "anniversary", "wedding"]` |

> **The slug really is `heart-map`, not `where-we-met`.** This is the decision we recorded: the public URL says `where-we-met`, the database and the renderer registry say `heart-map`. Typing `where-we-met` here would produce a product whose renderer doesn't exist — the storefront would work right up until someone paid.
>
> `Starting price cents` is `800` on both because the cheapest pack is the $8 wallpaper pack. It's display-only ("From $8"); the amount actually charged always comes from the pack.

---

## Step 2 — Delivery packs (7 rows)

Easiest path: open each product you just saved and use the **Delivery packs** section at the bottom of its page — the product is then filled in for you. Or add them from **Products → Delivery packs**.

Every pack: **Currency** = `USD`, **Status** = `active`.

### Love Story Timeline — 4 packs

| Slug | Name i18n key | Description i18n key | Price cents | Included targets |
|---|---|---|---|---|
| `printable` | `packs.printable.name` | `packs.printable.description` | `1800` | `["print-png"]` |
| `wallpaper` | `packs.wallpaper.name` | `packs.wallpaper.description` | `800` | `["story-png", "landscape-png"]` |
| `live` | `packs.live.name` | `packs.live.description` | `1200` | `["__live__"]` |
| `complete` | `packs.complete.name` | `packs.complete.description` | `3000` | `["story-png", "square-png", "landscape-png", "portrait-png", "print-png", "__live__"]` |

### Where We Met Map — 3 packs

| Slug | Name i18n key | Description i18n key | Price cents | Included targets |
|---|---|---|---|---|
| `printable` | `packs.printable.name` | `packs.printable.description` | `1800` | `["print-png"]` |
| `wallpaper` | `packs.wallpaper.name` | `packs.wallpaper.description` | `800` | `["story-png", "portrait-png"]` |
| `complete` | `packs.complete.name` | `packs.complete.description` | `2400` | `["story-png", "square-png", "portrait-png", "print-png"]` |

> **Where We Met has no `live` pack, and no `landscape-png` anywhere.** Its renderer produces four PNG sizes and nothing else — there is no HTML/digital renderer for it. The admin will reject both if you try; that guard is deliberate.
>
> **Prices are in cents.** `1800` = $18.00. A pack entered as `18` would sell for eighteen cents.

---

## Step 3 — Verify

Open this in a browser:

```
http://localhost:8000/api/v1/products/
```

You should see both products with `"status": "available"`. Then check one in detail:

```
http://localhost:8000/api/v1/products/love-story-timeline/
http://localhost:8000/api/v1/products/heart-map/
```

Each should list its packs with the right `priceCents` and `includedTargets`. If a product returns 404, its status isn't `available`. If `deliveryPacks` is empty, the packs were saved against the wrong product.

Send me those two responses and I'll confirm the catalog matches what the frontend expects before wiring anything to it.

---

## What the admin will stop you doing

`included_targets` is free-form JSON, so a typo there is the one mistake in this whole sheet that wouldn't surface until a paying customer clicked download. The form now rejects, with a message listing the valid targets:

- a target the product's renderer can't produce (`landscape-png` on Where We Met, `__live__` on Where We Met)
- a misspelled target (`landscpae-png`)
- an empty target list
- the same target listed twice

Valid targets, for reference:

| Product | Targets it can actually render |
|---|---|
| `love-story-timeline` | `print-png`, `story-png`, `square-png`, `landscape-png`, `portrait-png`, `__live__` |
| `heart-map` | `print-png`, `story-png`, `square-png`, `portrait-png` |

---

## Known copy gap (not blocking)

Love Story Timeline has `packs.*` translations in English, French and Arabic. **Where We Met Map has none** — so its pack names would currently display in checkout as the raw keys (`packs.printable.name`). I'll add matching translations in all three locales when I wire the real checkout, mirroring the existing Love Story wording. Nothing you need to do; noting it so it isn't a surprise if you look at checkout before then.
