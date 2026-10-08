# From HTML Prototype to Heartfolio Product — Worked Example

Hypothetical: you have `birth-poster.html`. **Nothing below is implemented.**
Birth Poster is not a Heartfolio product and must not be created without an
explicit decision.

## The transformation

```
birth-poster.html
   ↓  extract the data model
   ↓  define the personalization schema
   ↓  create the Product Module
   ↓  React implementation of the renderer component
   ↓  Studio integration (automatic — registry entry only)
   ↓  server-side renderer (Pillow)
   ↓  packs
   ↓  Django catalog rows
   ↓  translations
   ↓  SEO (automatic)
   ↓  tests
   ↓  activation
```

### 1. Extract the data model

Read the prototype and separate what varies from what doesn't. For a birth
poster, likely: child's name, date/time of birth, weight, length, place, an
optional photo, plus style choices (palette, frame, format).

Everything else — layout, spacing, decorative rules — is *design*, not data,
and belongs in the renderer.

### 2. Personalization schema

Becomes `schema.ts`: sections and fields with types the generic form already
supports (`text`, `date`, `number`, `image`, `coordinates`, `group`, …). If
you need a field type that doesn't exist, that is a Shell change — think
hard, because it affects every product.

### 3. Product Module

`lib/studio/product-modules/birth-poster/` with the standard files. The
values type (`BirthPosterValues`) is private to the module; the Shell only
ever sees opaque `values`.

### 4. React renderer — rewrite, don't paste

**Reuse:** the visual design, proportions, typography scale, colour
relationships, layout maths.

**Rewrite:** the markup itself. The prototype's global CSS and ids must
become a **CSS Module** so styles cannot leak into the Studio; inline styles
driven by `themeSelections`; no `document.querySelector`, no global state,
no scripts. The component receives `values` and `themeSelections` and
returns JSX — nothing else.

**Discard:** any client-side export/download code from the prototype.
Deliverables are rendered server-side; a browser exporter would give the
product away before payment.

### 5. Server-side renderer — a second implementation, deliberately

The Python renderer is **not** a port of the React one. It draws with Pillow
at print resolution from the same `values`. Two implementations of the same
design is the intended cost: the browser one is for live preview, the server
one is the product.

Keep them visually consistent by sharing the *specification* (dimensions,
margins, font sizes as ratios), not the code.

### 6. Packs

Decide what is sold, using only targets the Python renderer produces. Prices
go in Django, never in the frontend.

### 7. Catalog, translations, SEO, tests, activation

Admin rows (no migration); `Products.birthPoster` in three locales plus
module messages; SEO and sitemap are automatic from the registry; test as
per `PRODUCT-DEVELOPMENT-GUIDE.md` Stage 6; activation is the pack rows.

## What people get wrong

- Pasting prototype CSS globally — it will bleed into the Studio.
- Building a browser exporter — payment bypass.
- Hardcoding prices in the module — the frontend is not the price authority.
- Registering the module by slug instead of stable id — breaks the moment a
  public slug changes, as it did for Where We Met.
- Adding a migration to add a product — never necessary.
