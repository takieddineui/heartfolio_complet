from django.urls import path

from .views import GuestIdentityView

app_name = "customers"

urlpatterns = [
    path("guest/", GuestIdentityView.as_view(), name="guest-identity"),
]
