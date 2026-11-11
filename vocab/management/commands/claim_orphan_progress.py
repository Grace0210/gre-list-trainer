from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from vocab.models import ListProgress, WordProgress


class Command(BaseCommand):
    help = "Assign progress rows created before accounts existed (owner is NULL) to one named user."

    def add_arguments(self, parser):
        parser.add_argument("username")

    def handle(self, *args, **options):
        try:
            user = get_user_model().objects.get(username=options["username"])
        except get_user_model().DoesNotExist as exc:
            raise CommandError(f"No user named {options['username']!r}") from exc
        with transaction.atomic():
            words = WordProgress.objects.filter(owner__isnull=True).update(owner=user)
            lists = ListProgress.objects.filter(owner__isnull=True).update(owner=user)
        self.stdout.write(f"Assigned {words} word rows and {lists} list rows to {user.username}.")
