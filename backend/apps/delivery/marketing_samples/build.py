"""The storefront's product captures, built from the real product code.

`render_marketing_samples` (the command) calls `build_bundle()`, which turns
each fictional sample in `samples.json` into exactly what a paying customer's
order produces:

- the LIVE PAGE PAYLOAD, from the same `_LIVE_PAYLOAD_BUILDERS` the
  `/live/<id>` endpoint serves, after the same validation;
- for products with a print, ONE PRINT (Classic 8x10, with edges), from the
  same renderer a download uses;
- the GIFT QR CARD, from the same card renderer, but pointing at the
  product's public page (owner's decision: a marketing QR opens the product
  page, never a keepsake).

To get there it creates real rows (customer, product, pack, project, paid
order, entitlements, live experience) and uploads the photos through the real
upload pipeline, inside ONE transaction that is always rolled back. It runs
only with mock asset storage on a local database (`assert_safe_environment`),
so it can never touch Supabase or R2.

Photo links in the payloads come back as mock storage's `mock://assets/<key>`,
which no browser can load; each is rewritten to `/capture-assets/<file>` and
the file's bytes go into the bundle, where the frontend's dev-only capture
page serves them (`frontend-heartfolio/src/app/capture-assets/`).

The bundle is a zip:
  payloads/<product>.<locale>.json
  assets/<file>                     photos as the upload pipeline stored them
  prints/<product>.<locale>.png     Love Story Timeline and Song Poster only
  qr/<product>.<locale>.png
"""

from __future__ import annotations

import io
import json
import re
import zipfile
from pathlib import Path

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection, transaction

SAMPLES_DIR = Path(__file__).resolve().parent
PHOTOS_DIR = SAMPLES_DIR / "photos"
SAMPLES_FILE = SAMPLES_DIR / "samples.json"

#: The public site the marketing QR cards point at.
DEFAULT_SITE_URL = "https://www.theheartfolio.com"

#: Each product's public slug (the URL) and the catalog fields its throwaway
#: row needs. Where We Met is withdrawn and has no sample.
PRODUCTS = {
    "love-story-timeline": {"public_slug": "love-story-timeline", "category": "timeline", "print": True},
    "song-poster": {"public_slug": "song-poster", "category": "music", "print": True},
    "reasons-i-love-you": {"public_slug": "reasons-i-love-you", "category": "other", "print": False},
    "graduation-keepsake": {"public_slug": "graduation-keepsake", "category": "other", "print": False},
}
LOCALES = ("en", "fr", "ar")

#: The one print each printable product shows: the Classic 8x10 with edges,
#: the size most customers frame.
PRINT_TARGET = "print-classic-edged"

#: Hosts the command may run against: the compose `db` service and loopback.
LOCAL_DATABASE_HOSTS = {"db", "localhost", "127.0.0.1", ""}

MOCK_PREFIX = "mock://assets/"
CAPTURE_ASSET_PREFIX = "/capture-assets/"


class UnsafeEnvironment(Exception):
    pass


class SampleInvalid(Exception):
    pass


def assert_safe_environment() -> None:
    """Mock storage and a local database, or nothing runs. Everything is rolled
    back anyway, but uploads to real storage are not part of a transaction."""
    if settings.ASSET_STORAGE_BACKEND != "mock":
        raise UnsafeEnvironment(
            f"ASSET_STORAGE_BACKEND is {settings.ASSET_STORAGE_BACKEND!r}; this command only runs with 'mock'."
        )
    host = connection.settings_dict.get("HOST") or ""
    if host not in LOCAL_DATABASE_HOSTS:
        raise UnsafeEnvironment(f"Database host {host!r} is not the local throwaway database.")


def load_samples() -> dict:
    return json.loads(SAMPLES_FILE.read_text(encoding="utf-8"))


def _with_uploaded_photos(node, upload):
    """Replaces every `{"$photo": file}` with the uploaded asset's reference,
    in the shape the Studio stores after checkout."""
    if isinstance(node, dict):
        if set(node) == {"$photo"}:
            asset = upload(node["$photo"])
            return {"assetId": str(asset.id), "url": "", "mimeType": asset.mime_type, "filename": node["$photo"]}
        return {key: _with_uploaded_photos(value, upload) for key, value in node.items()}
    if isinstance(node, list):
        return [_with_uploaded_photos(item, upload) for item in node]
    return node


_MOCK_URL = re.compile(re.escape(MOCK_PREFIX) + r"([^\s,]+)")


def _rewrite_mock_urls(node, found: dict[str, str]):
    """`mock://assets/<key>` -> `/capture-assets/<file>`, recording each key.
    Every link in a string is rewritten, so a photo's `srcset` (one link per
    web copy) comes through whole."""
    if isinstance(node, str) and MOCK_PREFIX in node:
        def rewrite(match):
            key = match.group(1)
            filename = key.rsplit("/", 1)[-1]
            found[filename] = key
            return CAPTURE_ASSET_PREFIX + filename

        return _MOCK_URL.sub(rewrite, node)
    if isinstance(node, dict):
        return {key: _rewrite_mock_urls(value, found) for key, value in node.items()}
    if isinstance(node, list):
        return [_rewrite_mock_urls(item, found) for item in node]
    return node


def build_bundle(*, products=None, locales=LOCALES, site_url: str = DEFAULT_SITE_URL) -> bytes:
    """Builds the zip described in the module docstring and rolls back every
    row it created. `products` narrows the run (tests use one)."""
    assert_safe_environment()
    samples = load_samples()
    wanted = list(products or PRODUCTS)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as bundle:
        with transaction.atomic():
            _build_into(bundle, samples, wanted, locales, site_url.rstrip("/"))
            transaction.set_rollback(True)
    return out.getvalue()


def _build_into(bundle, samples, wanted, locales, site_url):
    from apps.assets.services import upload_asset
    from apps.assets.storage import get_asset_storage
    from apps.commerce.models import Order
    from apps.commerce.services import grant_entitlements
    from apps.customers.models import Customer
    from apps.delivery.bonuses import _qr_caption_for_order, _render_qr_card
    from apps.delivery.delivery_types import LIVE_TARGET_SENTINEL, infer_delivery_type
    from apps.delivery.live_views import _LIVE_PAYLOAD_BUILDERS
    from apps.delivery.models import PublicExperience
    from apps.delivery.registry import get_renderer
    from apps.products.models import DeliveryPack, Product
    from apps.projects.models import Project

    storage = get_asset_storage()
    customer = Customer.objects.create(email="marketing-samples@example.invalid")
    uploaded = {}

    def upload(filename):
        # One upload per photo, shared across locales, as one customer would.
        if filename not in uploaded:
            data = (PHOTOS_DIR / filename).read_bytes()
            uploaded[filename] = upload_asset(customer, SimpleUploadedFile(filename, data, content_type="image/jpeg"))
        return uploaded[filename]

    written_assets = set()
    for slug in wanted:
        spec = PRODUCTS[slug]
        product, _ = Product.objects.update_or_create(
            slug=slug,
            defaults={"name_i18n_key": slug, "category": spec["category"], "status": Product.STATUS_AVAILABLE},
        )
        targets = [LIVE_TARGET_SENTINEL] + ([PRINT_TARGET] if spec["print"] else [])
        pack, _ = DeliveryPack.objects.update_or_create(
            product=product,
            slug="marketing-sample",
            defaults={
                "name_i18n_key": "packs.sample.name",
                "description_i18n_key": "packs.sample.description",
                "price_cents": 1,
                "included_targets": targets,
                "status": DeliveryPack.STATUS_ACTIVE,
            },
        )

        for locale in locales:
            sample = samples[slug][locale]
            data = _with_uploaded_photos(sample, upload)
            project = Project.objects.create(customer=customer, product=product, data=data, status=Project.STATUS_COMPLETED)
            order = Order.objects.create(
                customer=customer,
                product=product,
                delivery_pack=pack,
                project=project,
                guest_email=customer.email,
                subtotal_cents=pack.price_cents,
                discount_cents=0,
                total_cents=pack.price_cents,
                status=Order.STATUS_PAID,
                locale=locale,
            )
            grant_entitlements(order)
            experience = PublicExperience.objects.get(
                entitlement__order=order, entitlement__target_id=LIVE_TARGET_SENTINEL
            )

            payload = _LIVE_PAYLOAD_BUILDERS[slug](experience, order, project, slug)
            if payload is None:
                raise SampleInvalid(f"{slug}/{locale}: the live page would refuse this sample (it failed validation).")
            found: dict[str, str] = {}
            payload = _rewrite_mock_urls(payload, found)
            bundle.writestr(f"payloads/{slug}.{locale}.json", json.dumps(payload, ensure_ascii=False, indent=2))
            for filename, key in found.items():
                if filename not in written_assets:
                    bundle.writestr(f"assets/{filename}", storage.download(key))
                    written_assets.add(filename)

            if spec["print"]:
                renderer = get_renderer(slug, infer_delivery_type(target_id=PRINT_TARGET, delivery_pack_slug=pack.slug))
                result = renderer.render(project, infer_delivery_type(target_id=PRINT_TARGET), pack, PRINT_TARGET, locale)
                bundle.writestr(f"prints/{slug}.{locale}.png", result.content)

            qr_url = f"{site_url}/{locale}/products/{spec['public_slug']}"
            card = _render_qr_card(qr_url, "dark", caption=_qr_caption_for_order(order), locale=locale)
            bundle.writestr(f"qr/{slug}.{locale}.png", card)
