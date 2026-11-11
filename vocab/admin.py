from django.contrib import admin
from .models import ListProgress, WordProgress


@admin.register(WordProgress)
class WordProgressAdmin(admin.ModelAdmin):
    list_display = ('owner', 'word_id', 'seen', 'correct', 'wrong', 'ease', 'due_at', 'last_seen_at')
    search_fields = ('owner__username', 'word_id')
    list_filter = ('owner', 'due_at')


@admin.register(ListProgress)
class ListProgressAdmin(admin.ModelAdmin):
    list_display = ('owner', 'list_no', 'completed_count', 'updated_at')
    search_fields = ('owner__username', 'list_no')
    list_filter = ('owner',)
