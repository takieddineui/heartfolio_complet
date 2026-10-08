# Frontend Route Inventory

Every route below was read from `src/app/`. Nothing is assumed.

All page routes live under `/[locale]` with `localePrefix: "always"`, so
every URL carries `/en`, `/fr` or `/ar`. Middleware is `src/proxy.ts`
(Next 16's renamed middleware).

## Route tree

```
/[locale]                          Home                        static-shell? no — dynamic
/[locale]/products                 Collection (?occasion=)     dynamic
/[locale]/products/[slug]          Product detail              dynamic
/[locale]/create                   Product chooser             dynamic
/[locale]/studio/[slug]            Studio (new session)        dynamic
/[locale]/studio                   Studio entry redirect       dynamic
/[locale]/project/[projectId]      Studio (resume project)     dynamic
/[locale]/orders/[orderId]         Order status + downloads    dynamic
/[locale]/waitlist                 Waitlist signup             static
/[locale]/contact                  Contact                     static
/[locale]/terms                    Legal                       static
/[locale]/privacy                  Legal                       static
/[locale]/refunds                  Legal                       static
/[locale]/not-found                404                         —
/api/waitlist                      Route handler (Supabase)    —
/api/backend/*                     Rewrite → Django            (next.config.ts)
/sitemap.xml                       Generated                   app/sitemap.ts
/robots.txt                        Generated                   app/robots.ts
/manifest.webmanifest              Generated                   app/manifest.ts
/icon.svg                          Static icon
/[locale]/opengraph-image          Generated OG card
/[locale]/products/opengraph-image Generated OG card
/[locale]/products/[slug]/opengraph-image  Generated OG card (per product)
```

## Marketing routes

| Route | Purpose | Session | API | Index? | Funnel |
|---|---|---|---|---|---|
| `/[locale]` | Hero, featured keepsakes, how-it-works, occasions, pricing, FAQ, final CTA | none | `GET /products/` (SSR) | **Yes** | Entry |
| `/[locale]/products` | Collection with `?occasion=` filter | none | `GET /products/` (SSR) | **Yes** | Discovery |
| `/[locale]/products/[slug]` | Story, offerings, FAQ, CTA | none | `GET /products/<slug>/` (SSR) | **Yes** | Key conversion page |
| `/[locale]/waitlist` | Signup for deferred products | none | `POST /api/waitlist` | Yes | Deferred products |
| `/[locale]/contact` | Contact details | none | none | Yes | — |
| `/[locale]/terms`, `/privacy`, `/refunds` | Legal | none | none | Yes (low priority) | — |

RTL: all marketing pages render `dir="rtl"` under `/ar`, using logical CSS
properties throughout.

## Customer-flow routes

| Route | Purpose | Session | API | Index? | Funnel |
|---|---|---|---|---|---|
| `/[locale]/create` | Choose a product, then Continue | none yet | `GET /products/` (SSR) | Should be **no** | Funnel entry |
| `/[locale]/studio/[slug]` | Personalize; live preview; pack selection; checkout modal | guest session created at checkout | `GET /products/<slug>/`, then at checkout: `POST /guest/`, `POST /assets/`, `POST /projects/`, `POST /orders/`, `POST /orders/<id>/pay/`, `GET /orders/<id>/`, `GET /orders/<id>/entitlements/` | Should be **no** | Core |
| `/[locale]/studio` | Accepts `?product=`, redirects to the canonical Studio URL | none | none | No | Compatibility |
| `/[locale]/project/[projectId]` | Resume a saved project | **required** — resolves client-side | `GET /projects/<id>/`, `GET /assets/<id>/` | Should be **no** | Recovery |
| `/[locale]/orders/[orderId]` | Order status; polls until paid; pack + per-file downloads | **required** | `GET /orders/<id>/`, `GET /orders/<id>/entitlements/`, `GET /orders/<id>/download/` | Should be **no** | Post-purchase |

The Studio uses physical CSS properties in places (`border-r`, `right-4`),
so its Arabic layout is imperfect — pre-existing, documented in
`PROJECT-STATUS.md`.

## Utility / system routes

| Route | Implementation | Notes |
|---|---|---|
| `/api/waitlist` | `app/api/waitlist/route.ts` | Supabase; the only non-Django API route |
| `/api/backend/:path*` | rewrite in `next.config.ts` | Proxies to `${BACKEND_API_ORIGIN}/api/v1/:path*/` — **appends the trailing slash Django requires** |
| `/[locale]/not-found` | `not-found.tsx` | Localized 404 |
| `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest` | metadata routes | See `SEO-AND-AI-DISCOVERABILITY.md` |
| OG image routes (3) | `opengraph-image.tsx` | Runtime-generated branded cards |

## Known route/SEO defect (not modified)

`app/robots.ts` disallows only `/api/`, with a comment reading *"the Studio
route does not exist yet."* It does now. `/create`, `/studio`, `/project`
and `/orders` are therefore crawlable. They are not secret — every one is
session-gated server-side — but they are thin, non-indexable-quality pages
and `/orders/<id>` should never appear in an index. See
`PROJECT-STATUS.md` → Discovered defects.
