"""
Deliberately minimal. This is not a `ModelSerializer`-backed CRUD
surface — `GuestEmailInputSerializer` validates the one input the guest
identity endpoint accepts, and `CustomerPublicSerializer` shapes the one
output it returns. Nothing here supports listing, filtering, or
arbitrary field updates.
"""

from rest_framework import serializers

from .models import Customer


class GuestEmailInputSerializer(serializers.Serializer):
    email = serializers.EmailField()


class CustomerPublicSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = ["id", "email"]
        read_only_fields = fields
