"""Tests for feedback submission (§7c).

Mostly about what a submitter must NOT be able to do. The model has fields
that are staff decisions — publication, attribution — and the whole value of
a private inbox is that nothing in it published itself.
"""

import uuid
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase

from apps.commerce.models import Order
from apps.commerce.order_access import generate_order_access_token
from apps.customers.models import Customer
from apps.products.models import DeliveryPack, Product

from .serializers import FeedbackCreateInputSerializer
from .services import FeedbackOrderNotFound, create_feedback


def _make_order(guest_email: str = "buyer@example.com") -> Order:
    product = Product.objects.create(
        slug=f"product-{uuid.uuid4().hex[:8]}",
        name_i18n_key="product.name",
        category=Product.CATEGORY_OTHER,
    )
    pack = DeliveryPack.objects.create(
        product=product,
        slug="printable",
        name_i18n_key="pack.name",
        description_i18n_key="pack.description",
        price_cents=1200,
        included_targets=["print-png"],
    )
    customer = Customer.objects.create(email=guest_email)
    return Order.objects.create(
        customer=customer,
        product=product,
        delivery_pack=pack,
        guest_email=guest_email,
        subtotal_cents=1200,
        total_cents=1200,
    )


class _RaisingDescriptor:
    """A field descriptor that raises on read but accepts a write silently.

    Used to simulate "the email lookup itself fails for some reason"
    against a genuinely real, valid `Order` row — not a mock standing in
    for one — without breaking Django's own `from_db()` population step,
    which needs `setattr(instance, "guest_email", <value from the row>)`
    to succeed even though nothing should ever read it back.
    """

    def __get__(self, obj, objtype=None):
        raise RuntimeError("simulated email lookup failure")

    def __set__(self, obj, value):
        pass


class FeedbackInputTests(SimpleTestCase):
    def test_a_rating_alone_is_a_complete_submission(self):
        # Requiring words would lose the quick five-star tap, which is what
        # most people actually give.
        s = FeedbackCreateInputSerializer(data={"rating": 5})
        self.assertTrue(s.is_valid(), s.errors)

    def test_a_note_alone_is_accepted_for_general_feedback(self):
        # Superseded an earlier rule that required a rating on every
        # submission. General feedback has nothing to rate — see
        # GeneralFeedbackRatingTests below, where this is covered properly.
        self.assertTrue(FeedbackCreateInputSerializer(data={"message": "nice"}).is_valid())

    def test_ratings_outside_one_to_five_are_rejected(self):
        for bad in (0, 6, -1, 99):
            self.assertFalse(
                FeedbackCreateInputSerializer(data={"rating": bad}).is_valid(), f"accepted {bad}"
            )

    def test_an_order_id_without_a_token_is_accepted_by_the_serializer(self):
        # DELIBERATE CHANGE OF RULE. The serializer used to reject this,
        # which meant order-tied feedback could only ever be submitted from
        # the emailed magic link — the in-session order page, where most
        # customers are straight after paying, sends no token and was
        # rejected with 400 every time.
        #
        # A guessed order id still proves nothing: ownership moved to
        # `create_feedback`, which requires EITHER a valid token OR a
        # session that owns the order (see FeedbackOwnershipTests below).
        # This test now asserts only that the serializer lets it through
        # for the service to judge.
        s = FeedbackCreateInputSerializer(data={"rating": 5, "orderId": str(uuid.uuid4())})
        self.assertTrue(s.is_valid(), s.errors)

    def test_a_submitter_cannot_publish_their_own_feedback(self):
        # `isPublished` is a real column and a staff decision. If the
        # serializer accepted it, anything could publish itself.
        s = FeedbackCreateInputSerializer(data={"rating": 5, "isPublished": True})
        self.assertTrue(s.is_valid(), s.errors)
        self.assertNotIn("isPublished", s.validated_data)
        self.assertNotIn("is_published", s.validated_data)

    def test_a_submitter_cannot_choose_the_product(self):
        """`product` is still derived server-side from the order.

        `displayName` used to be refused here too. It is now accepted —
        collected at submission so reviews can be attributed later, since a
        name cannot be retrofitted without going back and asking each
        person. Giving one still grants nothing: see
        `DisplayNameCollectionTests` below, where the publish separation is
        covered properly.
        """
        s = FeedbackCreateInputSerializer(
            data={"rating": 5, "displayName": "Someone Else", "product": "love-story-timeline"}
        )
        self.assertTrue(s.is_valid(), s.errors)
        self.assertNotIn("product", s.validated_data)
        self.assertNotIn("display_name", s.validated_data)

    def test_an_overlong_message_is_rejected(self):
        s = FeedbackCreateInputSerializer(data={"rating": 5, "message": "x" * 5000})
        self.assertFalse(s.is_valid())


class FeedbackOwnershipTests(SimpleTestCase):
    """Order-tied submissions must prove the order is theirs."""

    def test_a_bad_token_is_refused(self):
        with self.assertRaises(FeedbackOrderNotFound):
            create_feedback(rating=5, order_id=uuid.uuid4(), token="not-a-token")

    def test_a_token_for_another_order_is_refused(self):
        # The same scoping §12 relies on: a forwarded receipt is not a
        # skeleton key, here either.
        token = generate_order_access_token(uuid.uuid4())
        with self.assertRaises(FeedbackOrderNotFound):
            create_feedback(rating=5, order_id=uuid.uuid4(), token=token)

    def test_a_valid_token_for_a_missing_order_gives_the_same_error(self):
        # Same exception as a bad token, so probing order ids reveals
        # nothing about which exist.
        order_id = uuid.uuid4()
        token = generate_order_access_token(order_id)
        with patch("apps.feedback.services.Order") as order_model:
            order_model.DoesNotExist = Exception
            order_model.objects.select_related.return_value.get.side_effect = order_model.DoesNotExist
            with self.assertRaises(FeedbackOrderNotFound):
                create_feedback(rating=5, order_id=order_id, token=token)


class FeedbackAlertEmailTests(TestCase):
    """The Telegram alert text, not `Feedback.email` — those are
    deliberately different things. `Feedback.email` stays blank for an
    order-tied submission (unchanged, still asserted below); the alert is
    free to be more useful than the stored row, since it exists purely to
    tell a human who to reply to.
    """

    def test_order_tied_feedback_alert_includes_the_orders_customer_email(self):
        order = _make_order(guest_email="buyer@example.com")
        token = generate_order_access_token(order.id)

        with patch("apps.feedback.services.send_alert") as mock_send_alert:
            feedback = create_feedback(rating=5, order_id=order.id, token=token, message="Lovely.")

        # Feedback.email's own storage behavior is untouched — still blank
        # for an order-tied submission.
        self.assertEqual(feedback.email, "")
        mock_send_alert.assert_called_once()
        alert_text = mock_send_alert.call_args[0][0]
        self.assertIn("email: buyer@example.com", alert_text)

    def test_general_feedback_alert_includes_the_directly_submitted_email(self):
        with patch("apps.feedback.services.send_alert") as mock_send_alert:
            feedback = create_feedback(rating=4, message="Nice.", email="general@example.com")

        self.assertEqual(feedback.email, "general@example.com")
        mock_send_alert.assert_called_once()
        alert_text = mock_send_alert.call_args[0][0]
        self.assertIn("email: general@example.com", alert_text)

    def test_general_feedback_with_no_email_shows_the_placeholder_not_a_blank(self):
        with patch("apps.feedback.services.send_alert") as mock_send_alert:
            create_feedback(rating=3, message="Fine.")

        alert_text = mock_send_alert.call_args[0][0]
        self.assertIn("email: —", alert_text)

    def test_a_broken_email_lookup_does_not_prevent_the_submission_from_succeeding(self):
        # The exact scenario the task called out: enrichment must never
        # turn a successful submission into an error for the customer.
        # `send_alert`'s own "never raises" guarantee (see its module
        # docstring) only covers the network call inside it — this proves
        # the *caller's* string-building is separately guarded too.
        order = _make_order(guest_email="buyer2@example.com")
        token = generate_order_access_token(order.id)

        with patch.object(Order, "guest_email", _RaisingDescriptor()):
            with patch("apps.feedback.services.send_alert") as mock_send_alert:
                feedback = create_feedback(rating=5, order_id=order.id, token=token, message="Still works.")

        # The submission itself must succeed regardless.
        self.assertIsNotNone(feedback.pk)
        self.assertEqual(feedback.rating, 5)
        self.assertEqual(feedback.message, "Still works.")
        # The alert still goes out — just without a real email.
        mock_send_alert.assert_called_once()
        self.assertIn("email: —", mock_send_alert.call_args[0][0])


class GeneralFeedbackRatingTests(SimpleTestCase):
    """The two modes ask for different things (§7c).

    Order-tied always carries a rating; general feedback does not, because
    someone reporting a broken link has nothing to award stars to. Forcing a
    number there would either lose the submission or produce a meaningless
    one that pollutes any future average.
    """

    def test_general_feedback_accepts_a_note_with_no_rating(self):
        s = FeedbackCreateInputSerializer(data={"message": "The Arabic page reads oddly."})
        self.assertTrue(s.is_valid(), s.errors)

    def test_general_feedback_accepts_a_rating_with_no_note(self):
        self.assertTrue(FeedbackCreateInputSerializer(data={"rating": 4}).is_valid())

    def test_general_feedback_rejects_an_entirely_empty_submission(self):
        # Nullable rating makes this reachable, so it needs its own guard —
        # a row with neither a rating nor words means nothing.
        s = FeedbackCreateInputSerializer(data={})
        self.assertFalse(s.is_valid())

    def test_whitespace_is_not_a_message(self):
        s = FeedbackCreateInputSerializer(data={"message": "   \n  "})
        self.assertFalse(s.is_valid())

    def test_order_tied_feedback_still_requires_a_rating(self):
        # The mode that must not lose its rating: the customer is looking at
        # the keepsake, and rating it is the whole ask.
        s = FeedbackCreateInputSerializer(
            data={
                "orderId": str(uuid.uuid4()),
                "token": generate_order_access_token(uuid.uuid4()),
                "message": "Lovely.",
            }
        )
        self.assertFalse(s.is_valid())
        self.assertIn("rating", s.errors)


class DisplayNameCollectionTests(SimpleTestCase):
    """§7c — a name can now be given at submission, but grants nothing."""

    def test_a_display_name_is_accepted(self):
        s = FeedbackCreateInputSerializer(data={"rating": 5, "displayName": "Sara"})
        self.assertTrue(s.is_valid(), s.errors)
        self.assertEqual(s.validated_data["displayName"], "Sara")

    def test_giving_a_name_is_not_consent_to_publish(self):
        """The distinction that matters: a name records how someone would be
        credited IF published, not agreement that they should be."""
        s = FeedbackCreateInputSerializer(data={"rating": 5, "displayName": "Sara", "isPublished": True})
        self.assertTrue(s.is_valid(), s.errors)
        self.assertNotIn("isPublished", s.validated_data)
        self.assertNotIn("is_published", s.validated_data)

    def test_a_name_remains_optional(self):
        # Requiring one would cost submissions from people who simply do not
        # want to be named.
        self.assertTrue(FeedbackCreateInputSerializer(data={"rating": 5}).is_valid())

    def test_an_overlong_name_is_rejected(self):
        s = FeedbackCreateInputSerializer(data={"rating": 5, "displayName": "x" * 200})
        self.assertFalse(s.is_valid())


class PublishedReviewsTests(TestCase):
    """DATABASE-BACKED — not run here; no Postgres in this environment."""

    def test_nothing_is_returned_until_something_is_published(self):
        from apps.feedback.published import published_reviews, rating_summary

        self.assertEqual(published_reviews(), [])
        # None, never a zero: an empty AggregateRating is a structured-data
        # violation and the penalty lands on the domain.
        self.assertIsNone(rating_summary())

    def test_unpublished_feedback_never_leaks(self):
        from apps.feedback.models import Feedback
        from apps.feedback.published import published_reviews

        Feedback.objects.create(rating=5, message="Private note", is_published=False)
        self.assertEqual(published_reviews(), [])

    def test_a_published_review_with_no_words_is_excluded_from_display(self):
        # A bare star with a name under it fills space without telling a
        # reader anything — but it still counts toward the average.
        from apps.feedback.models import Feedback
        from apps.feedback.published import published_reviews, rating_summary

        Feedback.objects.create(rating=5, message="", is_published=True)
        self.assertEqual(published_reviews(), [])
        self.assertIsNotNone(rating_summary())

    def test_a_review_without_a_name_gets_a_fallback_not_an_empty_byline(self):
        from apps.feedback.models import Feedback
        from apps.feedback.published import published_reviews

        Feedback.objects.create(rating=5, message="Lovely.", is_published=True, display_name="")
        self.assertEqual(published_reviews()[0].display_name, "A Heartfolio customer")
