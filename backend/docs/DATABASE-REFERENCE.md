# Database Reference

Extracted from the live PostgreSQL schema produced by the current
migrations. Django models and migrations are the source of truth.

8 business tables. All primary keys are `uuid`. All timestamps are
`timestamp with time zone`.

## customers
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | NO | PK |
| email | `citext` | NO | **UNIQUE** — case-insensitive; the identity key |
| created_at / updated_at | timestamptz | NO | |

A guest is a `Customer` with an email and no password. There is no auth user.

## products
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | NO | PK |
| slug | varchar | NO | **UNIQUE** — `heart-map`, not the public slug |
| name_i18n_key | varchar | NO | Resolved client-side |
| category | varchar | NO | CHECK: sky, map, music, timeline, portrait, memorial, other |
| status | varchar | NO | CHECK: available, waitlist, coming_soon, disabled |
| starting_price_cents | integer | NO | CHECK ≥ 0 |
| order | integer | NO | |
| tags | jsonb | NO | CHECK: must be an array |
| created_at / updated_at | timestamptz | NO | |

Only `available` products are returned by the public API.

## delivery_packs
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | NO | PK |
| product_id | uuid | NO | FK → products |
| slug | varchar | NO | **UNIQUE (product_id, slug)** |
| name_i18n_key / description_i18n_key | varchar | NO | Product-module keys |
| price_cents | integer | NO | CHECK ≥ 0 — **the commercial source of truth** |
| currency | char(3) | NO | |
| included_targets | jsonb | NO | CHECK: must be an array |
| status | varchar | NO | CHECK: active, disabled |
| created_at / updated_at | timestamptz | NO | |

## projects
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | NO | PK |
| customer_id | uuid | NO | FK → customers **ON DELETE CASCADE** |
| product_id | uuid | NO | FK → products |
| data | jsonb | NO | CHECK: object, and must contain `version`, `values`, `themeSelections` |
| status | varchar | NO | CHECK: draft, completed |
| created_at / updated_at | timestamptz | NO | |

The backend never inspects `values` or `themeSelections`.

## assets
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | NO | PK |
| customer_id | uuid | **YES** | FK → customers **ON DELETE SET NULL** |
| storage_provider | varchar | NO | **UNIQUE (storage_provider, storage_key)** |
| storage_key | text | NO | R2 object key — never sent to the browser |
| original_filename | varchar | YES | |
| mime_type | varchar | NO | |
| status | varchar | NO | CHECK: pending, uploaded, failed, deleted |
| created_at / updated_at | timestamptz | NO | |

`SET NULL` keeps the storage row addressable for cleanup after a customer
is deleted.

## orders
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | NO | PK |
| customer_id | uuid | NO | FK → customers |
| product_id | uuid | NO | FK → products |
| delivery_pack_id | uuid | NO | FK → delivery_packs |
| project_id | uuid | **YES** | FK → projects **ON DELETE SET NULL** |
| guest_email | citext | NO | Snapshot at purchase |
| currency | char(3) | NO | |
| subtotal_cents / discount_cents / total_cents | integer | NO | each CHECK ≥ 0 |
| status | varchar | NO | CHECK: pending, paid, failed, cancelled |
| created_at / updated_at | timestamptz | NO | |

**CHECK `total_cents = subtotal_cents - discount_cents`** — arithmetic is
enforced by the database, not merely by application code.

## payments
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | NO | PK |
| order_id | uuid | NO | FK → orders **ON DELETE CASCADE** |
| provider | varchar | NO | |
| provider_reference | varchar | **YES** | Paddle `txn_…` |
| amount_cents | integer | NO | CHECK ≥ 0 |
| currency | char(3) | NO | |
| status | varchar | NO | CHECK: pending, success, failed, cancelled |
| created_at / updated_at | timestamptz | NO | |

**Partial unique index** `(provider, provider_reference) WHERE
provider_reference IS NOT NULL` — one payment per Paddle transaction, which
is what makes webhook replay safe.

## entitlements
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | NO | PK |
| order_id | uuid | NO | FK → orders **ON DELETE CASCADE** |
| product_id | uuid | NO | FK → products |
| target_id | varchar | NO | **UNIQUE (order_id, target_id)** |
| created_at | timestamptz | NO | |

One row per delivered target. The unique constraint is the database-level
guarantee that a replayed webhook cannot duplicate fulfilment.

## Relationships

```
Customer 1──* Project      (cascade)
Customer 1──* Order
Customer 1──* Asset        (set null)
Product  1──* DeliveryPack
Product  1──* Project
Order    *──1 Product, DeliveryPack
Order    *──1 Project      (set null — a deleted project must not erase an order)
Order    1──* Payment      (cascade)
Order    1──* Entitlement  (cascade)
```

Delivery is not a table: it is the act of rendering an `Entitlement` on
demand.

## Setup procedures

```bash
# 1. Database
createdb heartfolio                      # or the compose `db` service, or a managed Postgres

# 2. Connect
export DATABASE_URL="postgres://user:pass@host:5432/heartfolio"

# 3. Migrate (production settings on a deployed host)
export DJANGO_SETTINGS_MODULE=config.settings.production
python manage.py migrate --noinput

# 4. Verify no drift
python manage.py makemigrations --check --dry-run     # → "No changes detected"
python manage.py showmigrations                       # all [X]

# 5. Superuser (needed for catalog entry)
python manage.py createsuperuser

# 6. Populate the catalog
#    Django admin → CATALOG-GUIDE.md (9 rows). No fixtures exist by design.

# 7. Rollback one app to a prior migration if ever required
python manage.py migrate <app> <previous_migration_name>
```

All migrations are reversible. There are **no data migrations** — the
catalog is entered through the admin so prices are never buried in code.
