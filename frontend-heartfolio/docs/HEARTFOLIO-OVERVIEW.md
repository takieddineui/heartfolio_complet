# Heartfolio — Product & Architecture Overview

> Source of truth: the code in this repository. Where older documents
> disagree with the implementation, the implementation wins.

## 1. What Heartfolio is

Heartfolio sells **personalized digital keepsakes**. A customer picks a
product, personalizes it in an in-browser Studio, pays once, and downloads
the finished files. There is no subscription and no account.

**Customer journey**

```
Landing → Product page → /create → Studio (personalize)
      → pick a pack → email → pay (Paddle) → webhook confirms
      → entitlements → download ZIP
```

**Customers:** couples, families, parents, and gift shoppers.

**Value proposition:** an emotionally meaningful, personalized gift that
arrives instantly as files — printable and shareable — with no account to
create and no physical shipping.

**Business model:** one-off purchase of a *delivery pack* per product.
Prices live in the Django catalog and are charged through Paddle.

## 2. Domain model and how the pieces relate

```
Customer ──< Project >── Product ──< DeliveryPack
    │                       │              │
    │                       │              │
    └──< Order >────────────┴──────────────┘
          │  │
          │  └──< Payment            (Paddle transaction state)
          └──< Entitlement           (one row per delivered target)
Asset ── Customer                    (uploaded input photos, stored in R2)
```

| Concept | Meaning |
|---|---|
| **Product** | A keepsake type (`love-story-timeline`, `heart-map`). Owns category, status, starting price |
| **DeliveryPack** | What a customer buys: a named bundle with a price and a list of *targets* |
| **Target** | One deliverable format (`print-png`, `story-png`, `__live__`) |
| **Project** | The customer's personalization: `{version, values, themeSelections}`, opaque to the backend |
| **Asset** | An uploaded input photo, stored in R2, owned by a Customer |
| **Order** | A purchase of one pack for one project, priced server-side |
| **Payment** | The Paddle transaction backing an order |
| **Entitlement** | Proof of ownership of one target. Created only by a verified `transaction.paid` |
| **Delivery** | Rendering an entitlement's file on demand and streaming it |

**The customer buys a pack, not files.** Entitlements are per-target only so
that delivery can be authorized precisely.

## 3. Current product status

**Launch products (implemented, purchasable once seeded)**

| Product | Public slug | Django slug | Targets the renderer supports |
|---|---|---|---|
| Love Story Timeline | `love-story-timeline` | `love-story-timeline` | `print-png`, `story-png`, `square-png`, `landscape-png`, `portrait-png`, `__live__` |
| Where We Met Map | `where-we-met` | **`heart-map`** | `print-png`, `story-png`, `square-png`, `portrait-png` |

> The Where We Met slug split is deliberate and load-bearing: URLs and
> marketing use `where-we-met`; the database, module registry and renderer
> registry all use `heart-map`. Crossing that boundary goes through
> `lib/products/product-id.ts`.

**Deferred products (marketing pages only, waitlist CTA, inert)**
Star Map and Song Poster. They have **no Django rows**, no packs, no Studio
module and no renderer — which is what keeps them unpurchasable.

**Catalog actually present in Django:** at time of writing, **none** — the
production database has not been seeded. Until the 9 rows from
`CATALOG-GUIDE.md` are entered, nothing is purchasable.

## 4. Architecture in one page

- **One Next.js 16 application** (marketing + Studio + checkout).
- **One Django 5.2 backend** (catalog, projects, assets, orders, payments,
  delivery), run in Docker (production is planned as a VPS running the same setup).
- **Cloudflare R2** stores customer input photos only.
- **Paddle** processes payment; its `transaction.paid` webhook is the sole
  authority for marking an order paid.
- The browser calls `/api/backend/*` on its **own origin**; Next rewrites
  that to Django server-side, keeping the guest session cookie first-party.

## 5. Non-negotiable rules

1. `transaction.paid` is the only event that marks an order paid.
2. The browser never proves payment. No `successUrl`.
3. Prices come from `DeliveryPack.price_cents`; the order API accepts no
   price field.
4. Delivery requires a paid order, an owned entitlement, and a session
   customer.
5. Rendered deliverables are produced on demand and never stored.
6. Deferred products stay inert.
7. No mock or simulated commerce may return to the production path.
