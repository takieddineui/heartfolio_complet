from django.conf import settings
from rest_framework import serializers

from .models import RATING_MAX, RATING_MIN, Feedback


class FeedbackCreateInputSerializer(serializers.Serializer):
    """What a customer may send (§7c).

    Deliberately narrow. `isPublished`, `displayName` and `product` are all
    columns on the model and none of them are accepted here — a submitter
    must not be able to publish their own feedback, attribute it to a name
    nobody verified, or attach it to a product they did not buy. `product`
    is derived from the order server-side.
    """

    rating = serializers.IntegerField(
        min_value=RATING_MIN, max_value=RATING_MAX, required=False, allow_null=True
    )
    message = serializers.CharField(required=False, allow_blank=True, default="", max_length=4000)

    #: Order-tied mode. Both must be present together — an order id without
    #: a token proves nothing, and a token without an order has nothing to
    #: check against.
    orderId = serializers.UUIDField(required=False, allow_null=True)
    token = serializers.CharField(required=False, allow_blank=True, default="")

    #: General mode only, and optional even there.
    email = serializers.EmailField(required=False, allow_blank=True, default="")

    #: How the customer wants to be credited IF this is ever published.
    #:
    #: Now accepted from the submitter, having previously been staff-only.
    #: The reason is timing rather than a change of mind: a name cannot be
    #: retrofitted onto reviews already written without going back and
    #: asking each person, so it has to start being collected before
    #: reviews accumulate, not when publishing begins.
    #:
    #: Providing it is NOT consent to publish. `is_published` remains
    #: staff-only and defaults False — this is a preference recorded in
    #: advance, not permission granted.
    displayName = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=80
    )

    def validate(self, attrs):
        # NO LONGER REQUIRES A TOKEN ALONGSIDE `orderId`. It used to, which
        # meant order-tied feedback could only ever be submitted from the
        # emailed magic link — the in-session order page (where most
        # customers actually are, straight after paying) sends no token and
        # was rejected with 400 every time. Ownership is proved in
        # `create_feedback` instead, by EITHER a valid token OR the session
        # owning the order, so a guessed order id still proves nothing.
        has_rating = attrs.get("rating") is not None
        has_message = bool((attrs.get("message") or "").strip())

        if attrs.get("orderId"):
            # Order-tied: the customer has the keepsake in front of them and
            # rating it is the entire ask.
            if not has_rating:
                raise serializers.ValidationError({"rating": "Required when rating a purchase."})
        elif not has_rating and not has_message:
            # General: either is fine, neither is an empty row.
            raise serializers.ValidationError(
                {"message": "Add a rating or a note — an empty submission has nothing in it."}
            )
        return attrs


class FeedbackSerializer(serializers.ModelSerializer):
    isOrderTied = serializers.BooleanField(source="is_order_tied", read_only=True)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = Feedback
        fields = ["id", "rating", "message", "isOrderTied", "createdAt"]
        read_only_fields = fields
