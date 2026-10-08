"""
Views stay thin: resolve the session customer, validate input via a
serializer, delegate to `apps/projects/services.py`, serialize the
result. No ownership checks or business rules live here — they're all
in the service layer.
"""

from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.customers.authentication import CsrfEnforcedSessionAuthentication
from apps.customers.services import get_current_customer

from .serializers import ProjectCreateInputSerializer, ProjectSerializer, ProjectUpdateInputSerializer
from .services import create_project, delete_project, get_project_for_customer, update_project


class ProjectListCreateView(APIView):
    # No Django auth user exists for a guest (see apps/customers) —
    # ownership is enforced in the service layer via the session
    # customer, not DRF permissions.
    permission_classes = [AllowAny]
    authentication_classes = [CsrfEnforcedSessionAuthentication]

    def post(self, request):
        customer = get_current_customer(request)

        input_serializer = ProjectCreateInputSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)

        project = create_project(
            customer,
            product_slug=input_serializer.validated_data["productId"],
            data=input_serializer.validated_data.get("data"),
            status=input_serializer.validated_data["status"],
        )
        return Response(ProjectSerializer(project).data, status=status.HTTP_201_CREATED)


class ProjectDetailView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = [CsrfEnforcedSessionAuthentication]

    def get(self, request, project_id):
        customer = get_current_customer(request)
        project = get_project_for_customer(customer, project_id)
        return Response(ProjectSerializer(project).data)

    def patch(self, request, project_id):
        customer = get_current_customer(request)

        input_serializer = ProjectUpdateInputSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)

        project = update_project(
            customer,
            project_id,
            data=input_serializer.validated_data.get("data"),
            status=input_serializer.validated_data.get("status"),
        )
        return Response(ProjectSerializer(project).data)

    def delete(self, request, project_id):
        customer = get_current_customer(request)
        delete_project(customer, project_id)
        return Response(status=status.HTTP_204_NO_CONTENT)
