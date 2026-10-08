"""
The QR cards a customer can download.

BOTH audiences' cards are in BOTH places a customer might look:
  - the dedicated QR zip (`download/live-cards/`), offered for every pack
    with a live page, including Digital — which has no whole-pack zip at all;
  - the whole-pack zip's `bonus/` folder, for packs that have files (Complete).

The recipient's cards used to be a separate download with its own button and
route; that route is gone.
"""

import io
import zipfile
from unittest.mock import patch

from django.test import TestCase
from PIL import Image
from rest_framework import status as http_status
from rest_framework.test import APIClient

from apps.common.test_helpers import login_as_guest

from .delivery_types import LIVE_TARGET_SENTINEL
from .renderers import TemporaryFileResult
from .tests import make_paid_order_with_entitlements, make_product

BUYER_CARDS = ["live-page-qr.png", "live-page-qr-cream.png", "live-page-qr-tag.png"]
RECIPIENT_CARDS = [
    "live-page-qr-recipient.png",
    "live-page-qr-recipient-cream.png",
    "live-page-qr-recipient-tag.png",
]


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), (200, 120, 120)).save(buffer, format="PNG")
    return buffer.getvalue()


class _FileRenderer:
    """A real (tiny) PNG, because print targets also get a PDF wrapper made
    from it — arbitrary bytes would log a PDF failure on every run."""

    def render(self, project, delivery_type, delivery_pack, target_id, locale="en"):
        return TemporaryFileResult(content=_png(), content_type="image/png", filename=f"{target_id}.png")


class QrZipContentsTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _order(self, target_ids):
        customer, order, _ = make_paid_order_with_entitlements(
            target_ids=target_ids, product=make_product(slug="love-story-timeline")
        )
        login_as_guest(self.client, email=customer.email)
        return order

    @staticmethod
    def _names(content: bytes) -> list[str]:
        return sorted(zipfile.ZipFile(io.BytesIO(content)).namelist())

    # ---- the dedicated QR zip ---------------------------------------------

    def test_a_digital_only_order_gets_both_audiences_cards_in_one_zip(self):
        """Digital has no whole-pack zip, so this is the ONLY place its
        customer can get the recipient's card as a file."""
        order = self._order([LIVE_TARGET_SENTINEL])

        response = self.client.get(f"/api/v1/orders/{order.id}/download/live-cards/")

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertEqual(self._names(response.content), sorted(BUYER_CARDS + RECIPIENT_CARDS))

    def test_the_zip_keeps_its_existing_filename(self):
        order = self._order([LIVE_TARGET_SENTINEL])

        response = self.client.get(f"/api/v1/orders/{order.id}/download/live-cards/")

        self.assertIn("-live-qr.zip", response["Content-Disposition"])
        self.assertNotIn("recipient", response["Content-Disposition"])

    def test_a_pack_without_a_live_page_has_no_qr_zip(self):
        order = self._order(["print-a4-edged"])

        response = self.client.get(f"/api/v1/orders/{order.id}/download/live-cards/")

        self.assertEqual(response.status_code, http_status.HTTP_404_NOT_FOUND)

    def test_the_old_recipient_zip_url_is_gone(self):
        order = self._order([LIVE_TARGET_SENTINEL])

        response = self.client.get(f"/api/v1/orders/{order.id}/download/live-cards-recipient/")

        self.assertEqual(response.status_code, http_status.HTTP_404_NOT_FOUND)

    # ---- the whole-pack zip -----------------------------------------------

    def _whole_pack(self, order):
        with patch.dict("apps.delivery.registry._REGISTRY", {order.product.slug: _FileRenderer()}):
            response = self.client.get(f"/api/v1/orders/{order.id}/download/")
            return response, b"".join(response.streaming_content)  # lazy: read inside the patch

    def test_a_pack_with_files_and_a_live_page_carries_both_audiences_cards_in_bonus(self):
        """Complete: the 'everything' download carries everything the
        dedicated QR zip does."""
        order = self._order(["print-a4-edged", LIVE_TARGET_SENTINEL])

        response, content = self._whole_pack(order)

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        names = self._names(content)
        for card in BUYER_CARDS + RECIPIENT_CARDS:
            self.assertIn(f"bonus/{card}", names)
        self.assertEqual(len([n for n in names if n.startswith("bonus/live-page-qr")]), 6)

    def test_the_whole_pack_and_the_dedicated_zip_agree_on_which_cards_exist(self):
        """Both come from one shared list, so they cannot drift."""
        order = self._order(["print-a4-edged", LIVE_TARGET_SENTINEL])

        _, whole = self._whole_pack(order)
        dedicated = self.client.get(f"/api/v1/orders/{order.id}/download/live-cards/").content

        in_whole_pack = sorted(n.removeprefix("bonus/") for n in self._names(whole) if n.startswith("bonus/live-page-qr"))
        self.assertEqual(in_whole_pack, self._names(dedicated))

    def test_a_pack_with_no_live_page_gets_no_qr_cards_in_its_whole_pack_zip(self):
        order = self._order(["print-a4-edged"])

        _, content = self._whole_pack(order)

        self.assertEqual([n for n in self._names(content) if "live-page-qr" in n], [])

    def test_the_recipients_cards_in_the_bonus_folder_are_not_the_buyers_cards(self):
        order = self._order(["print-a4-edged", LIVE_TARGET_SENTINEL])

        _, content = self._whole_pack(order)

        archive = zipfile.ZipFile(io.BytesIO(content))
        self.assertNotEqual(archive.read("bonus/live-page-qr.png"), archive.read("bonus/live-page-qr-recipient.png"))
