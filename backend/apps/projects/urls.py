from django.urls import path

from .views import ProjectDetailView, ProjectListCreateView

app_name = "projects"

urlpatterns = [
    path("projects/", ProjectListCreateView.as_view(), name="project-list-create"),
    path("projects/<uuid:project_id>/", ProjectDetailView.as_view(), name="project-detail"),
]
