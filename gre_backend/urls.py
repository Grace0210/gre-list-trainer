from django.contrib import admin
from django.urls import path
from vocab import views

urlpatterns = [
    path('admin/', admin.site.urls),
    path('login/', views.auth_page, name='auth'),
    path('accounts/login/', views.auth_page),
    path('auth/login/', views.login_view, name='login'),
    path('auth/register/', views.register_view, name='register'),
    path('auth/logout/', views.logout_view, name='logout'),
    path('', views.index, name='index'),
    path('api/progress/', views.progress_collection, name='progress_collection'),
    path('api/progress/<str:word_id>/', views.progress_detail, name='progress_detail'),
    path('api/lists/', views.list_progress_collection, name='list_progress_collection'),
    path('api/lists/<int:list_no>/complete/', views.complete_list, name='complete_list'),
]
