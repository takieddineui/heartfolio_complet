"""Builds the storefront's capture bundle from the fictional samples.

See `apps/delivery/marketing_samples/build.py` for what is built and how.
Runs only on the throwaway database with mock storage, and leaves nothing
behind (one transaction, always rolled back):

    docker compose exec -T -e DATABASE_URL=postgres://heartfolio:heartfolio@db:5432/heartfolio \\
      -e ASSET_STORAGE_BACKEND=mock api python manage.py render_marketing_samples --stdout > bundle.zip

`frontend-heartfolio/scripts/captures/record.mjs` runs exactly this.
"""

from __future__ import annotations

import sys

from django.core.management.base import BaseCommand, CommandError

from apps.delivery.marketing_samples.build import (
    DEFAULT_SITE_URL,
    LOCALES,
    PRODUCTS,
    SampleInvalid,
    UnsafeEnvironment,
    build_bundle,
)


class Command(BaseCommand):
    help = "Render the marketing capture bundle (live payloads, prints, QR cards) from the fictional samples."

    def add_arguments(self, parser):
        parser.add_argument("--stdout", action="store_true", help="Write the zip to stdout (nothing else is printed there).")
        parser.add_argument("--output", help="Write the zip to this path inside the container.")
        parser.add_argument("--product", action="append", choices=sorted(PRODUCTS), help="Limit to these products.")
        parser.add_argument("--locale", action="append", choices=LOCALES, help="Limit to these locales.")
        parser.add_argument("--site-url", default=DEFAULT_SITE_URL, help="Where the QR cards point.")

    def handle(self, *args, **options):
        if not options["stdout"] and not options["output"]:
            raise CommandError("Pass --stdout or --output.")
        try:
            bundle = build_bundle(
                products=options["product"],
                locales=tuple(options["locale"] or LOCALES),
                site_url=options["site_url"],
            )
        except (UnsafeEnvironment, SampleInvalid) as exc:
            raise CommandError(str(exc)) from exc

        if options["stdout"]:
            sys.stdout.buffer.write(bundle)
            sys.stdout.buffer.flush()
        else:
            with open(options["output"], "wb") as handle:
                handle.write(bundle)
            self.stderr.write(f"wrote {len(bundle)} bytes to {options['output']}")
