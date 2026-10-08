# Maintenance Guide

## Safe, routine changes

| Task | How | Deploy needed |
|---|---|---|
| Change a price | Django admin → DeliveryPack → `price_cents` | No |
| Take a product off sale | Product `status` → `disabled`, or disable its packs | No |
| Add a pack | Admin; targets validated against the renderer | No |
| Launch a product | Add Product + packs; module and renderer must already exist | No (if code shipped) |
| Edit copy | `src/messages/*.json` — keep all three locales in parity | Yes |
| Studio strings | `lib/studio/i18n.ts` — currently 41/41/41 | Yes |
| Marketing sections | `components/sections/*` | Yes |
| New product | See `PRODUCT-DEVELOPMENT-GUIDE.md` — no migration | Yes |

## Architecture that must not be casually changed

Each of these is load-bearing. Changing one without understanding why it
exists reintroduces a class of bug that was deliberately closed.

1. **Payment authority.** Only `transaction.paid` marks an order paid.
   Never trust `checkout.completed`, never add `successUrl`, never expose an
   endpoint that sets `paid`.
2. **Pricing authority.** Never accept a price from the client. Never
   restore prices to the frontend registry — the launch products carry
   `offerings: []` on purpose, so a cold-start outage cannot serve a stale
   price or a pack that no longer exists.
3. **Webhook verification.** Raw-body signature check, replay window, amount
   and currency reconciliation. If a live webhook fails verification, fix the
   secret — never relax the check.
4. **Order ownership.** Session-derived customer only. Never accept a
   customer id from the client.
5. **Entitlement creation.** Only the webhook path. The unique constraints
   are the last line of defence against duplicate fulfilment.
6. **Delivery authorization.** Paid + owned + session. Unpaid must stay
   **404**, not 403.
7. **Render-on-demand.** Do not persist rendered deliverables. Storing them
   creates a private object that can leak and an invalidation problem that
   doesn't currently exist.
8. **Same-origin proxy.** Do not switch the browser to calling the backend
   directly. The cookie becomes third-party and Safari/Firefox users break
   while Chrome keeps working — the worst possible failure shape.
9. **Slug boundary.** `where-we-met` (public) vs `heart-map` (Django/module).
   Do not "normalise" them.
10. **Two `ui/` folders.** Landing and Studio primitives differ visually.
    Deduplicating them silently restyles an approved design.

## Routine verification

```bash
# Frontend
npm ci && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build

# Backend
python manage.py check
python manage.py makemigrations --check --dry-run
python manage.py test

# Live integration (needs both servers running)
HEARTFOLIO_INTEGRATION_BASE=http://localhost:3000 npx vitest run src/lib/studio/engines
```

Use `npm ci`, not `npm install` — a bare install pulls TypeScript 6.x
despite the `^5.7.2` range and breaks typecheck.
