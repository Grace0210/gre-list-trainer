from django.conf import settings
from django.db import models


class WordProgress(models.Model):
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='word_progress',
        null=True,
        blank=True,
    )
    word_id = models.CharField(max_length=120)
    seen = models.PositiveIntegerField(default=0)
    correct = models.PositiveIntegerField(default=0)
    wrong = models.PositiveIntegerField(default=0)
    ease = models.FloatField(default=2.5)
    due_at = models.DateTimeField(null=True, blank=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['word_id']
        constraints = [
            models.UniqueConstraint(fields=['owner', 'word_id'], name='unique_user_word_progress'),
        ]

    def as_client_dict(self):
        return {
            'seen': self.seen,
            'correct': self.correct,
            'wrong': self.wrong,
            'ease': self.ease,
            'due': int(self.due_at.timestamp() * 1000) if self.due_at else 0,
            'last': int(self.last_seen_at.timestamp() * 1000) if self.last_seen_at else 0,
        }


class ListProgress(models.Model):
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='list_progress',
        null=True,
        blank=True,
    )
    list_no = models.PositiveSmallIntegerField()
    completed_count = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['list_no']
        constraints = [
            models.UniqueConstraint(fields=['owner', 'list_no'], name='unique_user_list_progress'),
        ]

    def as_client_dict(self):
        return {
            'completedCount': self.completed_count,
            'updatedAt': int(self.updated_at.timestamp() * 1000) if self.updated_at else 0,
        }
