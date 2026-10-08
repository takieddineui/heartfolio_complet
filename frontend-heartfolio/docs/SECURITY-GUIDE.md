# Production Security Checklist

Each item states what is enforced and where, so a reviewer can verify rather
than trust.

## Payment
- [x] **Authority** — only Paddle's `transaction.paid` webhook marks an order
      paid. No endpoint lets a client do it. No `successUrl`.
- [x] **Signature verification** — official Paddle SDK over the exact raw
      body (`parser_classes = []`), rejected before any DB work.
- [x] **Replay protection** — timestamp drift checked; old signatures rejected.
- [x] **Amount + currency reconciliation** — compared against the order
      before mutation; mismatch writes nothing.
- [x] **Idempotency** — unique `(order, target_id)` and partial unique
      `(provider, provider_reference)`; replays log
      `paddle_webhook_duplicate_delivery` and change nothing.
- [x] **Price integrity** — `POST /orders/` has no price field; total derived
      from `DeliveryPack.price_cents`; DB CHECK enforces
      `total = subtotal - discount`.
- [x] **Order resolution** — via `custom_data.orderId`, never email/amount.

## Identity & ownership
- [x] Guest identity is a Django session cookie; the client never sends a
      customer id.
- [x] CSRF enforced on **every** unsafe method, not just login.
- [x] Projects, assets, orders, entitlements all ownership-checked server-side.
- [x] Cross-guest access returns 403; unknown returns 404 — and an **unpaid
      order returns 404**, so paid status cannot be probed.

## Delivery
- [x] Requires session + ownership + `status == paid`.
- [x] Rendered on demand; nothing persisted.
- [x] No storage URL, bucket name or key ever reaches the browser (asserted
      by test).
- [x] `Cache-Control: private, no-store`; `X-Content-Type-Options: nosniff`.
- [x] Filenames sanitised (header injection, path traversal) on both sides.
- [x] Throttled (`delivery_download`) — rendering is real CPU.

## Storage
- [x] R2 holds customer input photos only, read server-side through the
      ownership-checked asset service.
- [x] Presigned URLs are short-lived (300 s) and never persisted.
- [x] Uploads limited to 10 MB and jpeg/png/webp, enforced server-side.

## Transport & cookies
- [x] HTTPS with `SECURE_PROXY_SSL_HEADER` set (it was added for Railway's proxy).
- [ ] On the planned VPS: the TLS-terminating proxy in front of the container
      is the only way to reach it and overwrites any client-supplied
      `X-Forwarded-Proto` — otherwise that header can be forged.
- [x] Session cookie stays **first-party** via the same-origin rewrite —
      `SameSite=Lax` works and third-party cookie blocking is irrelevant.
- [x] CORS and CSRF trusted origins configured explicitly.

## Secrets
- [x] No secret is `NEXT_PUBLIC_`. Paddle API key and webhook secret are
      server-side only and appear in no API response.
- [x] `.env.local` is excluded from the repository and the archives.
- [ ] **Rotate** the Supabase key and Mapbox token that shipped in the
      original Landing ZIP.

## Hygiene
- [x] No mock or simulated commerce in the production path (verified by grep).
- [x] Production refuses to boot with `mock` storage or payment provider.
- [x] Deferred products have no DB rows, so they cannot be ordered.
- [ ] Rate limiting is in-memory per process — fine at one worker, weaker
      when scaled out. Known backend limitation.
