"""
`data.values`/`data.themeSelections` are never inspected or reshaped
here — `serializers.JSONField` passes them through byte-for-byte
structurally (as parsed JSON), matching the "opaque product-module
state" rule.
"""

import json

from django.conf import settings
from rest_framework import serializers

from .models import Project


def validate_project_data_size(value):
    """Rejects an oversized `data` payload (§22b).

    Measures the re-serialized JSON rather than the raw request body: the
    body includes `status`, whitespace and transport encoding, none of which
    is what is being bounded. What matters is how large this document will be
    when it is stored, read back on every draft load, and handed to the
    renderer.

    Deliberately says nothing about the payload's *shape*. It does not look
    at `values`, count fields, or cap any individual string — that would
    require the backend to know what a Love Story Timeline is, which is the
    one thing `apps/projects` is built not to know. A single number over the
    whole document stops abuse without touching that boundary.
    """
    if value is None:
        return value

    max_bytes = settings.MAX_PROJECT_DATA_KB * 1024
    size = len(json.dumps(value, separators=(",", ":")).encode("utf-8"))
    if size > max_bytes:
        raise serializers.ValidationError(
            f"Project data exceeds the maximum allowed size of {settings.MAX_PROJECT_DATA_KB}KB."
        )
    return value


class ProjectCreateInputSerializer(serializers.Serializer):
    productId = serializers.CharField()
    data = serializers.JSONField(required=False, validators=[validate_project_data_size])
    status = serializers.ChoiceField(
        choices=[Project.STATUS_DRAFT, Project.STATUS_COMPLETED],
        required=False,
        default=Project.STATUS_DRAFT,
    )


class ProjectUpdateInputSerializer(serializers.Serializer):
    data = serializers.JSONField(required=False, validators=[validate_project_data_size])
    status = serializers.ChoiceField(
        choices=[Project.STATUS_DRAFT, Project.STATUS_COMPLETED],
        required=False,
    )


class ProjectSerializer(serializers.ModelSerializer):
    projectId = serializers.CharField(source="id", read_only=True)
    productId = serializers.CharField(source="product.slug", read_only=True)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)
    updatedAt = serializers.DateTimeField(source="updated_at", read_only=True)

    class Meta:
        model = Project
        fields = ["id", "projectId", "productId", "data", "status", "createdAt", "updatedAt"]
        read_only_fields = fields
