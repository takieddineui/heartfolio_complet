# Frontend Specification

Versions read from `package.json`; behaviour read from source.

## 1. Stack (actual versions)

| Package | Version | Role |
|---|---|---|
| next | **16.2.12** | App Router, SSR, rewrites, metadata routes |
| react / react-dom | **19.2.8** | |
| typescript | ^5.7.2 (lock: **5.9.3**) | `strict`, `noUncheckedIndexedAccess` |
| tailwindcss + @tailwindcss/postcss | ^4.0.0 | design tokens in `globals.css` |
| next-intl | ^4.13.0 | i18n routing + messages |
| framer-motion | ^11.15.0 | `Reveal` animations (marketing only) |
| @paddle/paddle-js | ^1.6.5 | checkout overlay, lazily imported |
| @radix-ui/react-{accordion,dialog,slot} | ^1.2.2 / ^1.1.4 / ^1.1.1 | primitives |
| lucide-react | ^0.469.0 | icons |
| class-variance-authority, clsx, tailwind-merge | ^0.7.1 / ^2.1.1 / ^2.6.0 | variants + class merging |
| @supabase/supabase-js | ^2.47.10 | waitlist only |
| server-only | ^0.0.1 | guards server modules |
| vitest, @testing-library/*, jsdom | ^4.1.10 / … | tests |

**Not used** (despite being common in this stack): shadcn/ui as a
dependency, React Hook Form, Zod, TanStack Query, Zustand. State is plain
React (`useState` + context). Forms are controlled inputs with schema-driven
validation from each product module. Do not add these without a reason.

## 2. Architecture

```
src/
├── app/[locale]/…            routes (see FRONTEND-ROUTES.md)
├── components/
│   ├── ui/                   Landing primitives
│   ├── layout|sections|product|create|motion|theme|legal|illustrations
│   ├── commerce/             order status + downloads
│   └── studio/               entire Studio tree
│       └── ui/               Studio's own primitives (deliberately separate)
├── hooks/                    use-studio-session, use-product-entry
├── i18n/                     routing, request, navigation
├── lib/
│   ├── api/                  client, errors, guest, products, projects,
│   │                         assets, orders, delivery
│   ├── products/             registry, catalog, catalog-server, product-id
│   ├── studio/               engines, product modules, form/theme engines
│   ├── commerce/             paddle-client, use-delivery-packs
│   └── seo.ts, site-config.ts, fonts.ts, og.tsx, utils.ts
├── messages/{en,fr,ar}.json
└── types/                    studio.ts, commerce.ts
```

**Why two `ui/` folders:** Landing and Studio arrived with different `Button`
implementations under the same import path. Merging them would have
restyled one of the two approved designs, so the Studio's primitives live at
`@/components/studio/ui/*`. This is intentional — do not "deduplicate" them.

## 3. API integration

Everything goes through `lib/api/client.ts`. It guarantees three things at
one point instead of at every call site:

1. `credentials: "include"` — the guest identity is Django's session cookie.
2. `X-CSRFToken` on every unsafe method, bootstrapped via `GET /guest` if the
   cookie is missing.
3. Errors become a typed `ApiError` carrying Django's stable `code`.

**Requests are same-origin by design.** The browser calls `/api/backend/...`;
`next.config.ts` rewrites to Django server-side. A cross-site call would
need `SameSite=None`, which Safari's ITP and Firefox's Total Cookie
Protection block — guest identity would work in Chrome and fail for many
real customers.

Paths carry **no trailing slash**; the rewrite appends the one Django
requires (Django refuses to `APPEND_SLASH` a POST).

| Operation | Call | Session | Notes |
|---|---|---|---|
| CSRF bootstrap / read identity | `GET /guest` | no | Creates no Customer |
| Establish identity | `POST /guest {email}` | creates | Idempotent, case-insensitive |
| Catalog list | `GET /products` | no | SSR, `cache: "no-store"` |
| Product detail + packs | `GET /products/<djangoSlug>` | no | `heart-map`, never `where-we-met` |
| Create project | `POST /projects` | **yes** | `{version, values, themeSelections}` |
| Load / update project | `GET|PATCH /projects/<id>` | **yes** | `data` replaced wholesale |
| Upload photo | `POST /assets` (multipart `file`) | **yes** | ≤10 MB, jpeg/png/webp |
| Refresh asset URL | `GET /assets/<id>` | **yes** | Presigned URLs expire in 5 min |
| Create order | `POST /orders {productId, deliveryPackId, projectId}` | **yes** | **No price field exists** |
| Start payment | `POST /orders/<id>/pay` | **yes** | Returns Paddle `transactionId` + public client token |
| Poll status | `GET /orders/<id>` | **yes** | Only source of "paid" |
| Entitlements | `GET /orders/<id>/entitlements` | **yes** | |
| Pack ZIP | `GET /orders/<id>/download` | **yes** | Primary download |
| Single file | `GET /entitlements/<id>/download` | **yes** | Secondary; only route for `__live__` |

## 4. Studio architecture

The Studio is **product-agnostic**. Adding a product must not require
editing the Shell.

- `StudioShell` — resolves product + module, renders load/error states.
- `StudioLayout` — sidebar + canvas; sidebar collapses on mobile.
- `ProductStateProvider` — the only mutable state: `values`,
  `themeSelections`, plus packs/selected pack and checkout open state.
- **Product Modules** (`lib/studio/product-modules/<id>/`) supply
  `formSchema`, `themes`, `renderer`, `pricing`, `delivery`, `messages`,
  `createInitialState`. Registered by **stable id** (`heart-map`), not slug.
- **Engines** — form, theme, pricing, module loader, integrity checks;
  `engines/project-engine.ts` and `engines/checkout-engine.ts` talk to Django.
- **Preview** — a component renderer draws into the canvas; the same
  component is used for the live preview only. Deliverables are rendered
  server-side by Django, never in the browser.
- **Persistence** — projects are saved at checkout, not autosaved, because
  `POST /projects` requires an identity that only exists once the customer
  gives an email.
- **Photos** — picked locally (object URL preview, `File` held in a module
  registry keyed by that URL, never in `values`), uploaded at checkout, and
  the resulting `assetId` stamped into `values…photo.assetId`.

## 5. Localization

- **Mechanism:** next-intl, `localePrefix: "always"`, locales `en`, `fr`,
  `ar`, default `en`. Routing in `i18n/routing.ts`, middleware `src/proxy.ts`.
- **Detection:** next-intl negotiates from the `Accept-Language` header on
  an unprefixed request and redirects to a prefixed URL; an explicit prefix
  always wins.
- **Fallback:** a missing key falls back to the default locale.
- **App messages:** `src/messages/{en,fr,ar}.json` via `useTranslations`.
- **Studio shell strings:** `lib/studio/i18n.ts` (`resolveShellText`) —
  41 / 41 / 41 keys, verified at parity.
- **Product module strings:** each module ships its own `messages`, so a new
  product never edits a central file.
- **RTL:** the root layout sets `dir="rtl"` and an Arabic font stack for
  `/ar`. Marketing uses logical CSS properties throughout; the Studio still
  uses some physical ones (`border-r`, `right-4`) — a known cosmetic gap.

### Paddle checkout locale — documented explicitly

Paddle's overlay is a **third-party surface** with its own supported-locale
list. `lib/commerce/paddle-client.ts` maps:

```
en → en      fr → fr      ar → en  (fallback)
```

**Arabic is not a supported Paddle checkout locale**, so an Arabic customer
sees Heartfolio in Arabic and RTL, then an **English payment overlay**. This
is a Paddle limitation, not a Heartfolio bug. The mapping is one constant;
if Paddle adds Arabic, that map is the only edit.

The overlay also receives the customer's email (prefill) and the site's
light/dark theme. `successUrl` is deliberately never set.
