from django.urls import path

from .views import AssetDetailView, AssetUploadView

app_name = "assets"

urlpatterns = [
    path("assets/", AssetUploadView.as_view(), name="asset-upload"),
    path("assets/<uuid:asset_id>/", AssetDetailView.as_view(), name="asset-detail"),
]
