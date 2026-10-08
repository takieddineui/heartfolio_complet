"""Tests for the support lookup screen (§9).

The condition logic is the whole value of this screen and is database-free,
so it is tested directly. The query itself needs a database and is covered by
`LookupQueryTests`, which is written to run where one exists.
"""

from types import SimpleNamespace

from django.test import SimpleTestCase, TestCase

from apps.commerce.lookup import LookupResult, _condition, lookup_orders
from apps.commerce.models import Order


def order(status):
    return SimpleNamespace(status=status)


class OrderConditionTests(SimpleTestCase):
    def test_paid_with_nothing_delivered_is_its_own_condition(self):
        """The reason this screen exists.

        `status == "paid"` is not the answer to the question being asked.
        The complaint is "I paid and got nothing", and its shape is a paid
        order with no entitlements. Reporting that as plain "paid" would
        show a reassuring word next to a customer who is complaining.
        """
        condition, label = _condition(order(Order.STATUS_PAID), 0)
        self.assertEqual(condition, "paid_no_entitlements")
        self.assertIn("nothing was delivered", label)

    def test_paid_with_entitlements_is_fine(self):
        condition, _ = _condition(order(Order.STATUS_PAID), 6)
        self.assertEqual(condition, "delivered")

    def test_an_unfinished_order_is_named_as_such(self):
        # "Pending" means the customer never completed payment, which is a
        # different conversation from a failure.
        condition, label = _condition(order(Order.STATUS_PENDING), 0)
        self.assertEqual(condition, "pending")
        self.assertIn("Never completed", label)

    def test_failures_and_cancellations_are_distinguished(self):
        self.assertEqual(_condition(order(Order.STATUS_FAILED), 0)[0], "failed")
        self.assertEqual(_condition(order(Order.STATUS_CANCELLED), 0)[0], "cancelled")

    def test_only_the_actionable_conditions_are_flagged(self):
        # A delivered or cancelled order needs no attention; flagging them
        # would make the flag meaningless.
        def result(condition):
            return LookupResult("id", "e", "p", "k", "1.00", "USD", "s", condition, "l", 0, 0, "now")

        self.assertTrue(result("paid_no_entitlements").needs_attention)
        self.assertTrue(result("failed").needs_attention)
        self.assertTrue(result("pending").needs_attention)
        self.assertFalse(result("delivered").needs_attention)
        self.assertFalse(result("cancelled").needs_attention)

    def test_an_empty_query_returns_nothing_without_touching_the_database(self):
        # Guards against a blank submit scanning every order.
        self.assertEqual(lookup_orders(""), [])
        self.assertEqual(lookup_orders("   "), [])
        self.assertEqual(lookup_orders(None), [])


class LookupQueryTests(TestCase):
    """DATABASE-BACKED, and not run in the environment these were written in
    — there is no Postgres there. Written to run where one exists."""

    def setUp(self):
        # THIS setUp DID NOT EXIST — two tests here reference `self.order`
        # and failed with AttributeError as soon as the suite was really
        # run. One paid order is all the lookup screen needs to match on:
        # a partial id, or the guest email.
        import uuid as _uuid

        from apps.commerce.models import Order
        from apps.customers.models import Customer
        from apps.products.models import DeliveryPack, Product

        email = f"lookup-{_uuid.uuid4().hex[:8]}@example.com"
        customer = Customer.objects.create(email=email)
        product = Product.objects.create(
            slug=f"p-{_uuid.uuid4().hex[:8]}",
            name_i18n_key="product.name",
            category=Product.CATEGORY_TIMELINE,
            status=Product.STATUS_AVAILABLE,
        )
        pack = DeliveryPack.objects.create(
            product=product,
            slug="printable",
            name_i18n_key="packs.printable.name",
            description_i18n_key="packs.printable.description",
            price_cents=1799,
            included_targets=["print-a4-edged"],
        )
        self.order = Order.objects.create(
            customer=customer,
            product=product,
            delivery_pack=pack,
            guest_email=email,
            subtotal_cents=pack.price_cents,
            total_cents=pack.price_cents,
            status=Order.STATUS_PAID,
        )

    def test_a_partial_order_id_matches(self):
        # The realistic input is a fragment pasted from a customer's email;
        # requiring a full UUID would make the screen useless in exactly the
        # situation it was built for.
        results = lookup_orders(str(self.order.id)[:8])
        self.assertEqual(len(results), 1)

    def test_email_matching_ignores_case(self):
        results = lookup_orders(self.order.guest_email.upper())
        self.assertEqual(len(results), 1)

    def test_a_short_fragment_does_not_scan_everything(self):
        # Under four characters is too vague to be a useful search and too
        # broad to be a cheap one.
        self.assertEqual(lookup_orders("ab"), [])
