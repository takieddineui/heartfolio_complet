# Backend Specification (Django 5.2 + DRF)

## 1. Apps and responsibilities

| App | Owns | Must NOT own |
|---|---|---|
| `customers` | Guest identity: `Customer`, session binding, CSRF-enforced session auth | Anything about what a customer bought |
| `products` | Catalog: `Product`, `DeliveryPack`, admin, read-only public API | Prices in code; personalization |
| `projects` | `Project` — the customer's personalization envelope | Interpreting `values` (opaque by design) |
| `assets` | `Asset` — uploaded input photos, storage abstraction (R2/mock) | Rendered output |
| `commerce` | `Order`, `Payment`, `Entitlement`, Paddle integration, webhook | Rendering, file delivery |
| `delivery` | Authorization for downloads, renderer registry, per-product renderers, ZIP assembly | Payment state; persistence of output |
| `common` | Error envelope, exception handling, test helpers | Business logic |

## 2. API reference

Base: `/api/v1/`. Auth is a Django **session cookie**; every non-GET
requires `X-CSRFToken` (`CsrfEnforcedSessionAuthentication`). Errors use one
envelope: `{"error": {"code", "message", "details"}}`.

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/health/`, `/health/ready/` | GET | none | Liveness / readiness |
| `/guest/` | GET | none | Issues CSRF cookie; reports identity. Creates nothing |
| `/guest/` | POST | CSRF | `{email}` → resolve-or-create Customer, bind to session |
| `/products/` | GET | none | `available` products only |
| `/products/<slug>/` | GET | none | Product + active packs. 404 if not available |
| `/projects/` | POST | session | `{productId, data, status}` |
| `/projects/<uuid>/` | GET/PATCH/DELETE | session + ownership | `data` replaced wholesale |
| `/assets/` | POST | session + CSRF | multipart `file`; ≤10 MB; jpeg/png/webp |
| `/assets/<uuid>/` | GET/DELETE | session + ownership | Fresh presigned URL (300 s) |
| `/orders/` | POST | session + CSRF | `{productId, deliveryPackId, projectId}` — **no price accepted** |
| `/orders/<uuid>/` | GET | session + ownership | Authoritative order status |
| `/orders/<uuid>/pay/` | POST | session + CSRF | Creates/reuses a Paddle transaction |
| `/orders/<uuid>/entitlements/` | GET | session + ownership | Granted targets |
| `/orders/<uuid>/download/` | GET | session + ownership + **paid** | Whole pack as ZIP |
| `/entitlements/<uuid>/download/` | GET | session + ownership + **paid** | One deliverable |
| `/webhooks/paddle/` | POST | **signature** (no session, no CSRF) | Paddle notifications |

## 3. Payment architecture

**Order creation** resolves product and pack server-side, scopes the pack
lookup to `(product, slug)`, rejects disabled packs, verifies the project
belongs to the same customer *and* the same product, then computes
`subtotal / discount / total` from `DeliveryPack.price_cents`. There is no
price field in the input serializer, so a tampered amount has nowhere to
travel.

**Payment start** (`/pay/`) branches on `settings.PAYMENT_PROVIDER`, never on
request data. Under `select_for_update()` it returns the existing payment if
already paid, refuses a cancelled order, and **reuses an existing pending
Paddle transaction** rather than creating a duplicate. It returns
`{transactionId, clientToken}` — the client token is Paddle's public token;
the API key and webhook secret appear in no response.

**Transaction creation** sets `custom_data.orderId`. That is the only way an
order is later identified — never email, amount or product name.

**Webhook** reads `request.body` first with `parser_classes = []` so
signature verification sees exact raw bytes. Invalid signatures are rejected
before any database work. Only `transaction.paid` acts; other events are
acknowledged and ignored. Before mutating anything it reconciles **currency**
and **total** against the order; a mismatch raises and writes nothing.
Already-paid orders return early, and the unique constraints
`(order, target_id)` and `(provider, provider_reference)` make redelivery
idempotent.

> **`transaction.paid` is authoritative. Frontend and browser events never
> grant payment or entitlement.** There is no endpoint by which a client can
> mark an order paid, and `successUrl` is not configured.

Log signals for tracing: `paddle_webhook_received`,
`paddle_webhook_signature_rejected`, `paddle_webhook_payment_confirmed`,
`paddle_webhook_duplicate_delivery`, `paddle_webhook_amount_mismatch`,
`paddle_webhook_currency_mismatch`.

## 4. Delivery architecture

```
GET /entitlements/<id>/download/     one deliverable
GET /orders/<id>/download/           the whole purchased pack, as a ZIP
```

Both resolve the customer from the session, verify ownership, require
`order.status == paid`, then render **on demand** with Pillow and stream the
result. The pack route iterates the order's entitlements through the same
single-file rendering path and assembles a ZIP in memory.

- An unpaid order is reported as **404, not 403**, so the endpoint cannot be
  used to discover which orders exist or which are paid.
- Filenames are sanitised against header injection; responses carry
  `Cache-Control: private, no-store`.
- A digital (`__live__`) entitlement resolves to a URL and is therefore
  skipped in the ZIP; it remains available individually.

**R2 holds customer input photos only.** Rendered deliverables are never
persisted — not the PNGs, not the ZIP. The browser receives bytes and never
a storage URL, which is stronger than signed URLs: there is no private
delivery object to leak.

## 5. Renderers

`apps/delivery/registry.py` maps product slug → renderer.
Registered: `love-story-timeline`, `heart-map`. Anything else resolves to a
`NotImplementedRenderer` that raises `renderer_not_available` (501).

Supported targets are read from each renderer's `TARGET_DIMENSIONS`; the
products admin validates `included_targets` against them so an unsellable
target cannot be saved.
