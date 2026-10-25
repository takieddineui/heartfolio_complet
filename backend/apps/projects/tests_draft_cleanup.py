"""`cleanup_inactive_drafts` (25 Oct 2026): unbought drafts inactive for 12
months are deleted with their uploads, from storage as well as the database,
and nothing linked to an order is ever touched. Throwaway database, mock
storage."""

import io
from datetime import timedelta
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test import TestCase, override_settings
from django.utils import timezone

from apps.assets.models import Asset
from apps.assets.services import upload_asset
from apps.assets.storage import AssetStorageError, get_asset_storage
from apps.assets.tests import _image_file
from apps.commerce.models import FreemiusCheckoutStaging, Order
from apps.customers.models import Customer
from apps.products.models import DeliveryPack, Product

from .draft_cleanup import build_plan, referenced_asset_ids
from .models import Project

OLD = timedelta(days=400)
RECENT = timedelta(days=300)


@override_settings(ASSET_STORAGE_BACKEND="mock")
class InactiveDraftCleanupTests(TestCase):
    def setUp(self):
        self.product = Product.objects.create(
            slug="love-story-timeline", name_i18n_key="x", category=Product.CATEGORY_TIMELINE, status=Product.STATUS_AVAILABLE
        )
        self.pack = DeliveryPack.objects.create(
            product=self.product, slug="printable", name_i18n_key="p", description_i18n_key="d",
            price_cents=2299, included_targets=["print-png"],
        )
        self.customer = self._customer()
        self.storage = get_asset_storage()

    _n = 0

    def _customer(self):
        InactiveDraftCleanupTests._n += 1
        return Customer.objects.create(email=f"draft-{InactiveDraftCleanupTests._n}@example.com")

    def _asset(self, customer=None):
        return upload_asset(customer or self.customer, _image_file())

    def _draft(self, assets, *, age, customer=None, status=Project.STATUS_DRAFT):
        customer = customer or self.customer
        values = {
            "title": "Our story",
            "events": [{"title": f"m{i}", "photo": {"assetId": str(a.id)}} for i, a in enumerate(assets)],
        }
        project = Project.objects.create(
            customer=customer, product=self.product, status=status,
            data={"version": 1, "values": values, "themeSelections": {"palette": "warm"}},
        )
        # A database trigger (set_updated_at_projects) stamps now() on every
        # UPDATE, which is what makes `updated_at` mean "last activity" in
        # production; it is switched off for this one backdating update, inside
        # the test's own transaction.
        with connection.cursor() as cursor:
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
            cursor.execute("ALTER TABLE projects DISABLE TRIGGER set_updated_at_projects")
            Project.objects.filter(id=project.id).update(updated_at=timezone.now() - age)
            cursor.execute("ALTER TABLE projects ENABLE TRIGGER set_updated_at_projects")
            cursor.execute("SET CONSTRAINTS ALL DEFERRED")
        return project

    def _order_for(self, project, status=Order.STATUS_PENDING):
        return Order.objects.create(
            customer=project.customer, project=project, product=self.product, delivery_pack=self.pack,
            guest_email=project.customer.email, subtotal_cents=2299, discount_cents=0, total_cents=2299, status=status,
        )

    def _run(self, *args, **kwargs):
        out = io.StringIO()
        call_command("cleanup_inactive_drafts", *args, stdout=out, **kwargs)
        return out.getvalue()

    def _gone(self, asset):
        asset.refresh_from_db()
        return asset.status == Asset.STATUS_DELETED and not self.storage.exists(asset.storage_key)

    def _intact(self, asset):
        asset.refresh_from_db()
        return asset.status != Asset.STATUS_DELETED and self.storage.exists(asset.storage_key)

    def test_an_inactive_unbought_draft_and_its_uploads_are_deleted_from_storage_and_database(self):
        photo, other = self._asset(), self._asset()
        draft = self._draft([photo, other], age=OLD)
        self._run(execute=True)
        self.assertFalse(Project.objects.filter(id=draft.id).exists())
        self.assertTrue(self._gone(photo))
        self.assertTrue(self._gone(other))

    def test_saving_a_draft_counts_as_activity(self):
        """The trigger the cleanup relies on: any save moves `updated_at`."""
        draft = self._draft([self._asset()], age=OLD)
        draft.refresh_from_db()
        draft.save(update_fields=["data"])
        self._run(execute=True)
        self.assertTrue(Project.objects.filter(id=draft.id).exists())

    def test_a_draft_saved_within_12_months_is_kept(self):
        photo = self._asset()
        draft = self._draft([photo], age=RECENT)
        self._run(execute=True)
        self.assertTrue(Project.objects.filter(id=draft.id).exists())
        self.assertTrue(self._intact(photo))

    def test_nothing_linked_to_an_order_is_touched_paid_or_not(self):
        for status in (Order.STATUS_PENDING, Order.STATUS_PAID, Order.STATUS_CANCELLED):
            photo = self._asset()
            draft = self._draft([photo], age=OLD)
            self._order_for(draft, status=status)
            self._run(execute=True)
            self.assertTrue(Project.objects.filter(id=draft.id).exists(), status)
            self.assertTrue(self._intact(photo), status)

    def test_an_upload_another_kept_project_uses_is_kept(self):
        shared, own = self._asset(), self._asset()
        old = self._draft([shared, own], age=OLD)
        paid = self._draft([shared], age=OLD, status=Project.STATUS_COMPLETED)
        self._order_for(paid, status=Order.STATUS_PAID)
        self._run(execute=True)
        self.assertFalse(Project.objects.filter(id=old.id).exists())
        self.assertTrue(self._intact(shared))
        self.assertTrue(self._gone(own))

    def test_another_customers_upload_named_in_a_draft_is_never_deleted(self):
        theirs = self._asset(customer=self._customer())
        draft = self._draft([theirs], age=OLD)
        self._run(execute=True)
        self.assertFalse(Project.objects.filter(id=draft.id).exists())
        self.assertTrue(self._intact(theirs))

    def test_an_open_or_completed_freemius_checkout_keeps_the_draft(self):
        for status in (FreemiusCheckoutStaging.STATUS_AWAITING_PAYMENT, FreemiusCheckoutStaging.STATUS_COMPLETED):
            draft = self._draft([self._asset()], age=OLD)
            FreemiusCheckoutStaging.objects.create(
                customer=draft.customer, project=draft, product=self.product, delivery_pack=self.pack,
                guest_email=draft.customer.email, expected_total_cents=2299, status=status,
                expires_at=timezone.now() + timedelta(hours=1),
            )
            self._run(execute=True)
            self.assertTrue(Project.objects.filter(id=draft.id).exists(), status)

    def test_a_completed_project_is_not_a_draft(self):
        project = self._draft([self._asset()], age=OLD, status=Project.STATUS_COMPLETED)
        self._run(execute=True)
        self.assertTrue(Project.objects.filter(id=project.id).exists())

    def test_a_dry_run_changes_nothing(self):
        photo = self._asset()
        draft = self._draft([photo], age=OLD)
        out = self._run()
        self.assertIn("DRY RUN", out)
        self.assertIn("1 draft(s) inactive for 12+ months, with 1 upload(s).", out)
        self.assertTrue(Project.objects.filter(id=draft.id).exists())
        self.assertTrue(self._intact(photo))

    def test_more_drafts_than_the_cap_deletes_nothing_and_alerts(self):
        drafts = [self._draft([self._asset()], age=OLD) for _ in range(3)]
        with patch("apps.projects.management.commands.cleanup_inactive_drafts.send_alert") as alert:
            with self.assertRaises(CommandError):
                self._run(execute=True, max_drafts=2)
        alert.assert_called_once()
        self.assertEqual(Project.objects.filter(id__in=[d.id for d in drafts]).count(), 3)

    def test_the_window_cannot_be_shorter_than_the_privacy_policy_promises(self):
        self._draft([self._asset()], age=OLD)
        with self.assertRaises(CommandError):
            self._run(execute=True, months=6)

    def test_an_upload_storage_cannot_delete_keeps_its_draft_for_the_next_run(self):
        stuck, fine = self._asset(), self._asset()
        draft = self._draft([stuck, fine], age=OLD)
        real_delete = self.storage.delete

        def flaky_delete(key):
            if key == stuck.storage_key:
                raise AssetStorageError("R2 unavailable")
            real_delete(key)

        with patch.object(self.storage, "delete", side_effect=flaky_delete):
            out = self._run(execute=True)
        self.assertIn("1 draft(s) kept", out)
        self.assertTrue(Project.objects.filter(id=draft.id).exists())
        self.assertTrue(self._intact(stuck))
        self.assertTrue(self._gone(fine))
        # The next run finishes the job.
        self._run(execute=True)
        self.assertFalse(Project.objects.filter(id=draft.id).exists())
        self.assertTrue(self._gone(stuck))

    def test_a_draft_that_gains_an_order_before_its_turn_is_kept(self):
        """Checked again under a lock just before deletion: an order created
        after the plan was built still protects the draft."""
        photo = self._asset()
        draft = self._draft([photo], age=OLD)
        from apps.projects import draft_cleanup

        real_build = draft_cleanup.build_plan

        def plan_then_order(months, now=None):
            result = real_build(months, now)
            self._order_for(draft)
            return result

        with patch("apps.projects.management.commands.cleanup_inactive_drafts.build_plan", side_effect=plan_then_order):
            self._run(execute=True)
        self.assertTrue(Project.objects.filter(id=draft.id).exists())
        self.assertTrue(self._intact(photo))

    def test_uploads_no_project_references_are_reported_never_deleted(self):
        orphan = self._asset()
        Asset.objects.filter(id=orphan.id).update(created_at=timezone.now() - OLD)
        self._draft([self._asset()], age=OLD)
        out = self._run(execute=True)
        self.assertIn("1 upload(s) belong to no project at all", out)
        self.assertTrue(self._intact(orphan))

    def test_references_are_found_anywhere_in_the_data_and_bad_ids_are_ignored(self):
        data = {"values": {"a": {"assetId": "x"}, "list": [{"deep": [{"assetId": "y"}]}], "assetIdLike": "z"}}
        self.assertEqual(referenced_asset_ids(data), {"x", "y"})
        draft = self._draft([], age=OLD)
        draft.data = {"version": 1, "values": {"photo": {"assetId": "asset-1"}}, "themeSelections": {}}
        draft.save(update_fields=["data"])
        with connection.cursor() as cursor:
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
            cursor.execute("ALTER TABLE projects DISABLE TRIGGER set_updated_at_projects")
            Project.objects.filter(id=draft.id).update(updated_at=timezone.now() - OLD)
            cursor.execute("ALTER TABLE projects ENABLE TRIGGER set_updated_at_projects")
            cursor.execute("SET CONSTRAINTS ALL DEFERRED")
        plans, _ = build_plan(12)
        self.assertEqual([plan.project.id for plan in plans], [draft.id])
        self.assertEqual(plans[0].assets, [])
